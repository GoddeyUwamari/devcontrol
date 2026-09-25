/**
 * No detector evaluates measured AWS data (backend AnomalyDetectionService and
 * CustomAnomalyRulesService return nothing), so /anomalies must not claim
 * active monitoring or a healthy result -- it must say plainly that anomaly
 * detection on measured data isn't active, and show the scan message
 * neutrally.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'

const SCAN_MESSAGE = 'No anomalies recorded. Anomaly detection on measured data is not currently active.'

vi.mock('@/lib/hooks/use-plan', () => ({ usePlan: () => ({ isPro: true }) }))
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
    expect(text).toContain('Not assessed')
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

  it('shows the scan message neutrally, not styled as a green success', async () => {
    const { container } = render(<AnomaliesPage />)
    await screen.findByText('No anomalies recorded')

    fireEvent.click(screen.getByRole('button', { name: /Run Scan/i }))
    const message = await screen.findByText(SCAN_MESSAGE)

    expect(message.className).not.toMatch(/green/)
    expect(message.className).toMatch(/slate/)
    await waitFor(() => expectNoForbiddenCopy(container.textContent ?? ''))
  })
})
