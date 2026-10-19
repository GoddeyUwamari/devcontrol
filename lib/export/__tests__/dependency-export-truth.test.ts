/**
 * The dependency CSV and PDF exports contain only recorded data: each row's
 * services, type, critical flag and description, counts computed from those
 * rows, and the detected cycle paths. Nothing the old exports made up -- a
 * "direct" type for every row, an "active" status, "architecture is healthy",
 * "require immediate attention", generic recommended actions, a devcontrol.io
 * URL -- and a failed cycle check is "Unavailable", never 0.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { exportDependenciesToCSV } from '../csv-export'
import { exportDependencyReport } from '../pdf-export'
import { prepareDependencyExport } from '@/components/dependencies/ExportMenu'
import type { CircularDependency, ServiceDependency } from '@/lib/types'

const pdfText: string[] = []
const tables: { head: string[][]; body: string[][] }[] = []

vi.mock('jspdf', () => {
  class FakePdf {
    text(value: string | string[]) { pdfText.push(...(Array.isArray(value) ? value : [value])) }
    setFontSize() {} setTextColor() {} setFont() {} setFillColor() {} setDrawColor() {} setLineWidth() {}
    rect() {} addPage() {} addImage() {} setPage() {} save() {}
    getNumberOfPages() { return 1 }
    getTextWidth() { return 1 }
  }
  return { jsPDF: FakePdf }
})
vi.mock('jspdf-autotable', () => ({
  default: (_doc: unknown, options: { head: string[][]; body: string[][] }) => { tables.push({ head: options.head, body: options.body }) },
}))
vi.mock('html-to-image', () => ({ toPng: vi.fn().mockResolvedValue('data:image/png;base64,') }))

function dep(id: string, source: string, target: string, type: ServiceDependency['dependencyType'], isCritical: boolean, description?: string): ServiceDependency {
  return {
    id, organizationId: 'org', sourceServiceId: source, targetServiceId: target,
    sourceServiceName: source.toUpperCase(), targetServiceName: target.toUpperCase(),
    dependencyType: type, isCritical, description,
    createdBy: 'owner@example.invalid', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
  }
}

const DEPS = [
  dep('d1', 'api', 'db', 'data', true, 'reads orders'),
  dep('d2', 'api', 'queue', 'runtime', false),
]
const CYCLES: CircularDependency[] = [
  { cycle: [{ serviceId: 'api', serviceName: 'API' }, { serviceId: 'queue', serviceName: 'QUEUE' }], path: 'API → QUEUE → API', dependencyIds: [], severity: 'error' },
]
const NOW = new Date('2026-10-19T12:00:00.000Z')

const MADE_UP = /\bdirect\b|transitive|\bactive\b|healthy|immediate attention|Recommended Actions|mediator|event-driven|devcontrol\.io|Tags|Status/i

describe('prepareDependencyExport', () => {
  it('maps each recorded dependency and counts from the rows', () => {
    const { exportData, stats } = prepareDependencyExport(DEPS, CYCLES, NOW)
    expect(exportData).toEqual([
      { serviceName: 'API', dependsOn: 'DB', dependencyType: 'data', isCritical: true, description: 'reads orders' },
      { serviceName: 'API', dependsOn: 'QUEUE', dependencyType: 'runtime', isCritical: false, description: '' },
    ])
    expect(stats).toEqual({
      totalServices: 3,
      totalDependencies: 2,
      criticalDependencies: 1,
      circularDependencies: 1,
      exportDate: '2026-10-19T12:00:00.000Z',
    })
  })

  it('cycles that failed to load are null, not 0', () => {
    expect(prepareDependencyExport(DEPS, null, NOW).stats.circularDependencies).toBeNull()
  })
})

describe('CSV export', () => {
  let csv = ''

  beforeEach(() => {
    csv = ''
    vi.spyOn(console, 'log').mockImplementation(() => {})
    URL.createObjectURL = vi.fn((blob: Blob) => {
      void blob.text().then((text) => { csv = text })
      return 'blob:csv'
    }) as typeof URL.createObjectURL
    URL.revokeObjectURL = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  })

  it('has the recorded columns and counts, and nothing made up', async () => {
    const { exportData, stats } = prepareDependencyExport(DEPS, CYCLES, NOW)
    await exportDependenciesToCSV(exportData, stats)
    await vi.waitFor(() => expect(csv).not.toBe(''))

    const lines = csv.split('\r\n')
    expect(lines).toContain('"Services in dependencies","3"')
    expect(lines).toContain('"Total dependencies","2"')
    expect(lines).toContain('"Critical dependencies","1"')
    expect(lines).toContain('"Circular dependencies","1"')
    expect(lines).toContain('"Service Name","Depends On","Type","Critical","Description"')
    expect(lines).toContain('"API","DB","data","Yes","reads orders"')
    expect(lines).toContain('"API","QUEUE","runtime","No",""')
    expect(csv).not.toMatch(MADE_UP)
  })

  it('a failed cycle check is "Unavailable"', async () => {
    const { exportData, stats } = prepareDependencyExport(DEPS, null, NOW)
    await exportDependenciesToCSV(exportData, stats)
    await vi.waitFor(() => expect(csv).not.toBe(''))
    expect(csv.split('\r\n')).toContain('"Circular dependencies","Unavailable"')
  })
})

describe('PDF report', () => {
  beforeEach(() => {
    pdfText.length = 0
    tables.length = 0
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  it('reports the recorded counts, table and detected cycle paths, and nothing made up', async () => {
    const { exportData, stats } = prepareDependencyExport(DEPS, CYCLES, NOW)
    await exportDependencyReport(exportData, stats, null, CYCLES.map((c) => c.path))

    const text = pdfText.join('\n')
    expect(text).toContain('Services in dependencies: 3')
    expect(text).toContain('Total Dependencies: 2')
    expect(text).toContain('• 1 of 2 dependencies are marked critical')
    expect(text).toContain('1. API -> QUEUE -> API')
    expect(tables).toEqual([{
      head: [['Service', 'Depends On', 'Type', 'Critical', 'Description']],
      body: [['API', 'DB', 'data', 'Yes', 'reads orders'], ['API', 'QUEUE', 'runtime', 'No', '']],
    }])
    expect(text).not.toMatch(MADE_UP)
  })

  it('no cycles: says none were detected, without calling the architecture healthy', async () => {
    const { exportData, stats } = prepareDependencyExport(DEPS, [], NOW)
    await exportDependencyReport(exportData, stats, null, [])
    const text = pdfText.join('\n')
    expect(text).toContain('• No circular dependencies detected')
    expect(text).not.toMatch(MADE_UP)
  })

  it('a failed cycle check says it was unavailable', async () => {
    const { exportData, stats } = prepareDependencyExport(DEPS, null, NOW)
    await exportDependencyReport(exportData, stats, null, [])
    expect(pdfText.join('\n')).toContain('Circular dependency detection was unavailable for this report')
  })
})
