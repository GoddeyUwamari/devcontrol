/**
 * Risk and status row: Top Risk and DevControl System Health.
 *
 * Top Risk never claims "no risks" from missing evidence, takes its severity
 * badge and tint only from the finding's own severity (the backend's
 * deterministic "<title> (<severity> severity)" format), and links to the
 * findings only when a risk is identified.
 *
 * System Health is DevControl's own /health check, never the customer's AWS:
 * the disclaimer is always on the face, "Live" is claimed only when
 * operational, and its title links to /admin/monitoring (the System Status
 * hotfix: /observability has no page).
 */
import { describe, it, expect } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { InfrastructureIntelligence, parseTopRiskSeverity } from '../infrastructure-intelligence'

const OPERATIONAL = { value: 'Operational', detail: 'Platform API & Database Services Live', operational: true, color: 'var(--text-success)', dotColor: 'green' }
const DEGRADED = { value: 'Degraded', detail: "DevControl's own services are degraded.", operational: false, color: 'var(--text-warning)', dotColor: 'orange' }

function renderRow(overrides: Partial<ComponentProps<typeof InfrastructureIntelligence>> = {}) {
  return render(<InfrastructureIntelligence topRisk={null} topRiskStatus="unavailable" aiSummaryLoading={false} systemStatus={OPERATIONAL} {...overrides} />)
}
const topRiskCard = () => screen.getByTestId('top-risk-card')
const healthCard = () => screen.getByTestId('system-health-card')

describe('Top Risk never claims "no risks" from missing evidence', () => {
  it('shows "Risk status unavailable" when risk could not be evaluated', () => {
    renderRow()
    expect(screen.getByText('Risk status unavailable')).toBeTruthy()
    expect(screen.queryByText('No urgent risks identified')).toBeNull()
    expect(screen.queryByText(/Nothing currently requires immediate attention/)).toBeNull()
  })

  it('shows "No urgent risks identified" only when evaluated security evidence has no active findings', () => {
    renderRow({ topRiskStatus: 'none_identified' })
    expect(screen.getByText('No urgent risks identified')).toBeTruthy()
    expect(screen.getByText(/No active findings in DevControl's evaluated security checks/)).toBeTruthy()
  })

  it('shows the identified risk text, once', () => {
    renderRow({ topRisk: 'Open SSH to the internet (critical severity)', topRiskStatus: 'identified' })
    expect(screen.getAllByText('Open SSH to the internet (critical severity)')).toHaveLength(1)
    expect(screen.queryByText('Risk status unavailable')).toBeNull()
  })

  it('the title is always "Top Risk", never a fixed alert headline', () => {
    renderRow({ topRisk: 'Open SSH to the internet (critical severity)', topRiskStatus: 'identified' })
    expect(within(topRiskCard()).getByText('Top Risk')).toBeTruthy()
    expect(topRiskCard().textContent).not.toMatch(/Critical Risk Alert/)
  })
})

describe('Top Risk severity follows the finding\'s actual severity', () => {
  it('pins the backend format: "<title> (<severity> severity)" with critical/high/medium/low', () => {
    expect(parseTopRiskSeverity('Root account has no MFA (critical severity)')).toBe('critical')
    expect(parseTopRiskSeverity('Open SSH (high severity)')).toBe('high')
    expect(parseTopRiskSeverity('Old access key (medium severity)')).toBe('medium')
    expect(parseTopRiskSeverity('Unused role (low severity)')).toBe('low')
  })

  it('anything else has no severity: the resource-compliance line, demo text, a mid-string mention, other words', () => {
    expect(parseTopRiskSeverity('3 resource compliance issues currently active')).toBeNull()
    expect(parseTopRiskSeverity('Lambda invocation spike on payment-processor (+178%) — review before it affects downstream services.')).toBeNull()
    expect(parseTopRiskSeverity('Rule (critical severity) was changed later')).toBeNull()
    expect(parseTopRiskSeverity('Thing (informational severity)')).toBeNull()
    expect(parseTopRiskSeverity('Thing (Critical Severity)')).toBeNull()
    expect(parseTopRiskSeverity(null)).toBeNull()
  })

  it.each([
    ['critical', 'Critical', 'var(--bg-danger)'],
    ['high', 'High', 'var(--bg-danger)'],
    ['medium', 'Medium', 'var(--bg-warning)'],
    ['low', 'Low', 'var(--surface-2)'],
  ])('%s: "%s" badge, tinted %s (red only for critical/high)', (severity, label, background) => {
    renderRow({ topRisk: `Some finding (${severity} severity)`, topRiskStatus: 'identified' })
    expect(within(topRiskCard()).getByTestId('top-risk-severity')).toHaveTextContent(label)
    expect(topRiskCard().style.background).toBe(background)
    expect(topRiskCard()).toHaveAttribute('data-severity', severity)
  })

  it('an identified risk without a parseable severity gets no badge and a neutral tint', () => {
    renderRow({ topRisk: '3 resource compliance issues currently active', topRiskStatus: 'identified' })
    expect(screen.queryByTestId('top-risk-severity')).toBeNull()
    expect(topRiskCard().style.background).toBe('var(--surface-2)')
  })

  it('the word "high" outside the "(<severity> severity)" suffix gets no badge and a neutral tint', () => {
    renderRow({ topRisk: 'High CPU on api-server (high utilization) — severity high', topRiskStatus: 'identified' })
    expect(screen.queryByTestId('top-risk-severity')).toBeNull()
    expect(topRiskCard().style.background).toBe('var(--surface-2)')
    expect(topRiskCard()).toHaveAttribute('data-severity', 'none')
  })

  it('the empty states get no badge and a neutral tint', () => {
    for (const topRiskStatus of ['unavailable', 'none_identified'] as const) {
      const { unmount } = renderRow({ topRiskStatus })
      expect(screen.queryByTestId('top-risk-severity')).toBeNull()
      expect(topRiskCard().style.background).toBe('var(--surface-2)')
      unmount()
    }
  })
})

describe('Top Risk link', () => {
  it('an identified risk links to /security#findings with a chevron', () => {
    renderRow({ topRisk: 'Open SSH (high severity)', topRiskStatus: 'identified' })
    const link = topRiskCard().closest('a')
    expect(link).not.toBeNull()
    expect(link!.getAttribute('href')).toBe('/security#findings')
    expect(topRiskCard().querySelector('svg.lucide-chevron-right')).not.toBeNull()
  })

  it('no link and no chevron in the empty states or while loading', () => {
    for (const props of [{ topRiskStatus: 'unavailable' as const }, { topRiskStatus: 'none_identified' as const }, { topRisk: 'Open SSH (high severity)', topRiskStatus: 'identified' as const, aiSummaryLoading: true }]) {
      const { unmount } = renderRow(props)
      expect(topRiskCard().closest('a')).toBeNull()
      expect(topRiskCard().querySelector('svg.lucide-chevron-right')).toBeNull()
      unmount()
    }
  })
})

describe('DevControl System Health is DevControl\'s own health, not customer AWS', () => {
  it('titles the card "DevControl System Health" and links it to /admin/monitoring, not /observability', () => {
    renderRow()
    const link = screen.getByText('DevControl System Health').closest('a')
    expect(link).not.toBeNull()
    expect(link!.getAttribute('href')).toBe('/admin/monitoring')
  })

  it('operational: "Operational", the "Live" micro-copy, the disclaimer, and a green tint', () => {
    renderRow()
    const card = healthCard()
    expect(card).toHaveTextContent('Operational')
    expect(card).toHaveTextContent('Platform API & Database Services Live')
    expect(card).toHaveTextContent('Not a status of your AWS resources.')
    expect(card.style.background).toBe('var(--bg-success)')
    expect(card.textContent).not.toMatch(/\bHealthy\b|All systems|All API & database services live/i)
  })

  it('not operational: existing wording, no "Live" claim, disclaimer still visible, no green tint', () => {
    renderRow({ systemStatus: DEGRADED })
    const card = healthCard()
    expect(card).toHaveTextContent("DevControl's own services are degraded.")
    expect(card.textContent).not.toMatch(/Live/)
    expect(card).toHaveTextContent('Not a status of your AWS resources.')
    expect(card.style.background).toBe('var(--surface-2)')
  })

  it('the longer explanation is behind the info button, not on the face', () => {
    renderRow()
    expect(healthCard().textContent).not.toMatch(/health check/)
    fireEvent.click(within(healthCard()).getByRole('button', { name: 'DevControl System Health details' }))
    const dialog = screen.getByRole('dialog', { name: 'DevControl Platform Health' })
    expect(dialog).toHaveTextContent("Measures whether DevControl's API and database respond to a health check. This indicator reflects DevControl application availability, not your connected AWS infrastructure uptime.")
    expect(dialog.textContent).not.toMatch(/telemetry/i)
  })

  it('has no "Real-time" claim and no "Infrastructure Intelligence" heading', () => {
    const { container } = renderRow()
    expect(container.textContent).not.toMatch(/real[- ]?time/i)
    expect(container.textContent).not.toMatch(/Infrastructure Intelligence/)
  })
})
