/**
 * PR 3d-1 (founder decision D6): region coverage outside the Services page
 * comes from the Services truth module (servicesTruth.ts), which reads the
 * server's home_only_coverage / multi_region.scan. The old M6 helper
 * regionCounts() counted every region_status row with a failed, denied or
 * timed-out status, and a former home's old ok, as "checked", so no file
 * outside app/(app)/services may use it.
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

const ROOT = process.cwd()
const SERVICES = path.join(ROOT, 'app', '(app)', 'services')
const SCAN_DIRS = ['app', 'components', 'lib', 'hooks'].map((d) => path.join(ROOT, d))
const USES = /\bregionCounts\b/

function sourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__') continue
      out.push(...sourceFiles(full))
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

describe('regionCounts() is used only inside the Services page', () => {
  it('the pattern finds an import and a call (self-check)', () => {
    expect(USES.test("import { regionCounts } from '../../services/regionCoverage'")).toBe(true)
    expect(USES.test('const n = regionCounts(c)')).toBe(true)
    expect(USES.test('const n = regionCountsLike(c)')).toBe(false)
  })

  it('no source file outside app/(app)/services names it', () => {
    const files = SCAN_DIRS.flatMap(sourceFiles)
    expect(files.length).toBeGreaterThan(200)
    const outside = files.filter((f) => !f.startsWith(SERVICES + path.sep) && USES.test(fs.readFileSync(f, 'utf8')))
    expect(outside.map((f) => path.relative(ROOT, f))).toEqual([])
  })

  it('Infrastructure, Security, the Dashboard and Connect AWS read the Services truth module', () => {
    for (const file of [
      'app/(app)/infrastructure/overview/overviewModel.ts',
      'app/(app)/security/overview/securityModel.ts',
      'app/(app)/dashboard/dashboardFreshness.ts',
      'app/(app)/connect-aws/ConnectedView.tsx',
    ]) {
      expect(fs.readFileSync(path.join(ROOT, file), 'utf8'), file).toMatch(/from '(\.\.\/)+services\/servicesTruth'/)
    }
  })
})
