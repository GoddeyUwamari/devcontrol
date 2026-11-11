/**
 * CAT-3 (CAT-D13, C3-D2): while anomaly detection is inactive the KPI tiles
 * say "Not active" instead of a number, there is no Run Scan, the page and the
 * custom-rules header carry "Coming soon", and the rules count says the rules
 * are saved but not running. Nothing changes about who sees what: the rules
 * section, its Enterprise badge and New Rule stay for every plan that sees the
 * page today.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'

const plan = vi.hoisted(() => ({ value: { status: 'known', isKnown: true, isPro: true, isEnterprise: false } as Record<string, unknown> }))
vi.mock('@/lib/hooks/use-plan', () => ({ usePlan: () => plan.value }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/services/anomaly.service', () => ({
  anomalyService: {
    getAnomalies: vi.fn(async () => ({ anomalies: [], stats: { active: 0, critical: 0, warning: 0, info: 0 } })),
    getLastScan: vi.fn(async () => new Date('2026-11-10T12:00:00Z')),
    triggerScan: vi.fn(async () => ({ success: true, anomalies: [], count: 0, message: 'x' })),
  },
}))
const RULES = [
  { id: 'r1', name: 'EC2 cost', metric: 'cost', condition: 'greater_than', threshold: 500, timeWindow: '1h', severity: 'warning', enabled: true },
  { id: 'r2', name: 'Lambda errors', metric: 'error_rate', condition: 'greater_than', threshold: 5, timeWindow: '1h', severity: 'critical', enabled: false },
]
vi.mock('@/lib/services/custom-anomaly-rules.service', () => ({
  default: { getRules: vi.fn(async () => RULES) },
}))

import AnomaliesPage from '../page'
import { anomalyService } from '@/lib/services/anomaly.service'

const rulesHeader = () => screen.getByRole('heading', { name: 'Custom Detection Rules' }).parentElement as HTMLElement

beforeEach(() => {
  vi.clearAllMocks()
  plan.value = { status: 'known', isKnown: true, isPro: true, isEnterprise: false }
})

describe('/anomalies while detection is inactive', () => {
  it('the four KPI tiles show "—" and "Not active", never a number', async () => {
    render(<AnomaliesPage />)
    await screen.findByText('No anomalies recorded')

    const tiles = screen.getAllByTestId('anomaly-kpi')
    expect(tiles).toHaveLength(4)
    expect(tiles.map((t) => t.querySelector('p')!.textContent)).toEqual(['Active Issues', 'Critical Issues', 'Systems Impacted', 'Estimated Impact'])
    for (const tile of tiles) {
      expect(within(tile).getByText('—')).toBeInTheDocument()
      expect(within(tile).getByText('Not active')).toBeInTheDocument()
      expect(tile.textContent).not.toMatch(/\d/)
    }
    expect(document.body.textContent).not.toMatch(/Requiring immediate attention|Highest severity · action needed|Active resources affected|Not assessed/)
  })

  it('has no Run Scan button and never starts a scan', async () => {
    render(<AnomaliesPage />)
    await screen.findByText('No anomalies recorded')

    expect(screen.queryByRole('button', { name: /Run Scan|Scanning/ })).toBeNull()
    expect(anomalyService.triggerScan).not.toHaveBeenCalled()
  })

  it('the title carries "Coming soon" and the subtitle says so', async () => {
    render(<AnomaliesPage />)
    await screen.findByText('No anomalies recorded')

    const title = screen.getByRole('heading', { level: 1, name: 'Anomaly Detection' })
    expect(title.parentElement!.textContent).toContain('Coming soon')
    expect(document.body.textContent).toContain('Anomaly detection on measured AWS data is coming soon. Nothing is being monitored here yet.')
  })

  it('Revenue Protection: the rules header says the saved rules are not running', async () => {
    plan.value = { status: 'known', isKnown: true, isPro: true, isEnterprise: true }
    render(<AnomaliesPage />)
    await screen.findByText('EC2 cost')

    expect(rulesHeader().textContent).toContain('2 rules saved · not running yet')
    expect(rulesHeader().textContent).toContain('Coming soon')
    expect(rulesHeader().textContent).toContain('Enterprise')
    expect(document.body.textContent).not.toMatch(/rules active/)
  })

  it('Optimization Engine: the section, its badge, the count and New Rule are all still there (no tier change, nothing hidden)', async () => {
    render(<AnomaliesPage />)
    await screen.findByText('No anomalies recorded')

    expect(rulesHeader().textContent).toContain('Enterprise')
    expect(rulesHeader().textContent).toContain('Coming soon')
    expect(rulesHeader().textContent).toContain('0 rules saved · not running yet')
    expect(within(rulesHeader().parentElement!.parentElement!).getByRole('button', { name: /New Rule/ })).toBeInTheDocument()
  })
})
