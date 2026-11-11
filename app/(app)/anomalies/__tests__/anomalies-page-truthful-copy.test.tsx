/**
 * No detector evaluates measured AWS data (backend AnomalyDetectionService and
 * CustomAnomalyRulesService return nothing), so /anomalies must not claim
 * active monitoring or a healthy result -- it must say plainly that anomaly
 * detection on measured data isn't active (CAT-3: "coming soon"), and offer
 * no scan while there is nothing to run.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const SCAN_MESSAGE = 'No anomalies recorded. Anomaly detection on measured data is not currently active.'

vi.mock('@/lib/hooks/use-plan', () => ({ usePlan: () => ({ status: 'known', isKnown: true, isPro: true }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/services/anomaly.service', () => ({
  anomalyService: {
    getAnomalies: vi.fn(async () => ({ anomalies: [], stats: { active: 0, critical: 0, warning: 0, info: 0 } })),
    getLastScan: vi.fn(async () => new Date('2026-09-25T12:00:00Z')),
    triggerScan: vi.fn(async () => ({ success: true, anomalies: [], count: 0, message: SCAN_MESSAGE })),
  },
}))
vi.mock('@/lib/services/custom-anomaly-rules.service', () => ({
  default: { getRules: vi.fn(async () => []) },
}))

import AnomaliesPage from '../page'

const FORBIDDEN = [
  /healthy/i,
  /continuously monitor/i,
  /Monitoring active/i,
  /Real[ -]?Time/i,
  /Analyzing your infrastructure/i,
  // former custom-rule example chips
  /Detect unusual cost spikes/i,
  /Flag security misconfigurations/i,
  /Monitor abnormal traffic patterns/i,
]

function expectNoForbiddenCopy(text: string) {
  for (const pattern of FORBIDDEN) expect(text).not.toMatch(pattern)
}

describe('/anomalies makes no active-monitoring or healthy claim', () => {
  beforeEach(() => vi.clearAllMocks())

  it('the rendered page (header, status bar, empty state, Estimated Impact, custom rules) never says healthy, continuously monitor, Monitoring active, or Real Time', async () => {
    const { container } = render(<AnomaliesPage />)
    await screen.findByText('No anomalies recorded')

    expectNoForbiddenCopy(container.textContent ?? '')
  })

  it('states plainly that anomaly detection on measured data is not active', async () => {
    const { container } = render(<AnomaliesPage />)
    await screen.findByText('No anomalies recorded')
    const text = container.textContent ?? ''

    expect(text).toContain('Anomaly detection on measured data isn')
    expect(text).toContain('Anomaly detection not active')
    // CAT-3: tiles say "Not active" instead of a number or "Not assessed"; the header says "coming soon".
    expect(text).toContain('Not active')
    expect(text).toContain('Anomaly detection on measured AWS data is coming soon.')
    expect(text).toContain('Custom rules aren')
    expect(text).not.toMatch(/No active issues detected|only default AI detection/i)
  })

  it('with no scan ever recorded, shows a plain "No scan recorded yet" placeholder -- no analysis claim, no spinner', async () => {
    const { anomalyService } = await import('@/lib/services/anomaly.service')
    vi.mocked(anomalyService.getLastScan).mockResolvedValueOnce(null)
    const { container } = render(<AnomaliesPage />)
    const heading = await screen.findByText('No scan recorded yet', { selector: 'p' })

    expect(heading.parentElement?.textContent).toContain('Anomaly detection on measured data isn')
    expect(heading.closest('.bg-white')?.querySelector('.animate-spin')).toBeNull()
    expectNoForbiddenCopy(container.textContent ?? '')
  })

  // CAT-3 (CAT-D13): the scan is a no-op while detection is inactive, so there
  // is no Run Scan button and no scan message to style.
  it('offers no Run Scan while detection is inactive, and never starts a scan', async () => {
    const { anomalyService } = await import('@/lib/services/anomaly.service')
    const { container } = render(<AnomaliesPage />)
    await screen.findByText('No anomalies recorded')

    expect(screen.queryByRole('button', { name: /Run Scan/i })).toBeNull()
    expect(screen.queryByText(SCAN_MESSAGE)).toBeNull()
    expect(anomalyService.triggerScan).not.toHaveBeenCalled()
    expectNoForbiddenCopy(container.textContent ?? '')
  })
})
