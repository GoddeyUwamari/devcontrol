/**
 * Risk and status row: Top Risk and DevControl System Health.
 *
 * Top Risk never claims "no risks" from missing evidence, takes its severity
 * badge and tint only from the finding's own severity (the backend's
 * deterministic "<title> (<severity> severity)" format, whose suffix the chip
 * replaces in the visible title), and links to the findings only when a risk
 * is identified.
 *
 * System Health is DevControl's own /health check, never the customer's AWS:
 * its one caption says so in every state, "responding" is claimed only when
 * operational, and its title links to /admin/monitoring (the System Status
 * hotfix: /observability has no page).
 */
import { describe, it, expect } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { InfrastructureIntelligence, parseTopRiskSeverity, topRiskTitle } from '../infrastructure-intelligence'

const OPERATIONAL = { value: 'Operational', caption: 'API and database responding · not your AWS resources', operational: true, color: 'var(--text-success)', dotColor: 'green' }
const DEGRADED = { value: 'Degraded', caption: "DevControl's own services are degraded. Not a status of your AWS resources.", operational: false, color: 'var(--text-warning)', dotColor: 'orange' }

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

  it('shows the identified risk title once, its severity suffix replaced by the chip', () => {
    renderRow({ topRisk: 'Open SSH to the internet (critical severity)', topRiskStatus: 'identified' })
    expect(screen.getAllByText('Open SSH to the internet')).toHaveLength(1)
    expect(topRiskCard().textContent).not.toContain('(critical severity)')
    expect(within(topRiskCard()).getByTestId('top-risk-severity')).toHaveTextContent('Critical')
    expect(topRiskCard().closest('a')).toBeNull()
    expect(screen.queryByText('Risk status unavailable')).toBeNull()
  })

  it('text without a parseable suffix is shown whole -- nothing is stripped or guessed', () => {
    expect(topRiskTitle('3 resource compliance issues currently active')).toBe('3 resource compliance issues currently active')
    expect(topRiskTitle('Thing (Critical Severity)')).toBe('Thing (Critical Severity)')
    expect(topRiskTitle('Rule (high severity) was changed later')).toBe('Rule (high severity) was changed later')
    renderRow({ topRisk: '3 resource compliance issues currently active', topRiskStatus: 'identified' })
    expect(screen.getByText('3 resource compliance issues currently active')).toBeTruthy()
  })

  it('has one title line: no second line is invented (the risk carries no structured resource IDs)', () => {
    renderRow({ topRisk: 'Security group launch-wizard-2 allows SSH from 0.0.0.0/0 (high severity)', topRiskStatus: 'identified' })
    const paragraphs = [...topRiskCard().querySelectorAll('p')].map((p) => p.textContent)
    expect(paragraphs).toEqual(['Top Risk', 'Security group launch-wizard-2 allows SSH from 0.0.0.0/0'])
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
  it('an identified risk has one arrow button to /security#findings; the card itself is not a link and has no chevron', () => {
    renderRow({ topRisk: 'Open SSH (high severity)', topRiskStatus: 'identified' })
    expect(topRiskCard().closest('a')).toBeNull()
    const links = within(topRiskCard()).getAllByRole('link')
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveAccessibleName('Open top risk')
    expect(links[0]).toHaveAttribute('href', '/security#findings')
    expect(topRiskCard().querySelector('svg.lucide-chevron-right')).toBeNull()
  })

  it('no arrow (no link) in the empty states or while loading -- the existing rule', () => {
    for (const props of [{ topRiskStatus: 'unavailable' as const }, { topRiskStatus: 'none_identified' as const }, { topRisk: 'Open SSH (high severity)', topRiskStatus: 'identified' as const, aiSummaryLoading: true }]) {
      const { unmount } = renderRow(props)
      expect(topRiskCard().closest('a')).toBeNull()
      expect(within(topRiskCard()).queryAllByRole('link')).toHaveLength(0)
      expect(topRiskCard().querySelector('svg.lucide-chevron-right')).toBeNull()
      unmount()
    }
  })
})

describe('DevControl System Health is DevControl\'s own health, not customer AWS', () => {
  it('titles the card "DevControl System Health" (not a link) and its one arrow opens /status', () => {
    renderRow()
    expect(screen.getByText('DevControl System Health').closest('a')).toBeNull()
    const links = within(healthCard()).getAllByRole('link')
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveAccessibleName('Open DevControl status')
    expect(links[0]).toHaveAttribute('href', '/status')
  })

  it('operational: "Operational", one caption ("responding · not your AWS resources"), and a green tint', () => {
    renderRow()
    const card = healthCard()
    expect(card).toHaveTextContent('Operational')
    expect(within(card).getByTestId('system-health-caption')).toHaveTextContent('API and database responding · not your AWS resources')
    expect(card.querySelectorAll('[data-testid="system-health-caption"]')).toHaveLength(1)
    expect(card.style.background).toBe('var(--bg-success)')
    expect(card.textContent).not.toMatch(/\bHealthy\b|All systems|All API & database services live/i)
  })

  it('not operational: existing wording, no "responding" claim, not-your-AWS still on the face, no green tint', () => {
    renderRow({ systemStatus: DEGRADED })
    const card = healthCard()
    expect(within(card).getByTestId('system-health-caption')).toHaveTextContent("DevControl's own services are degraded. Not a status of your AWS resources.")
    expect(card.textContent).not.toMatch(/responding|Live/)
    expect(card.querySelectorAll('[data-testid="system-health-caption"]')).toHaveLength(1)
    expect(card.style.background).toBe('var(--surface-2)')
  })

  it('the longer explanation is behind the info button, not on the face', () => {
    renderRow()
    expect(healthCard().textContent).not.toMatch(/health check/)
    fireEvent.click(within(healthCard()).getByRole('button', { name: 'About DevControl System Health' }))
    const dialog = screen.getByRole('dialog', { name: 'How this is calculated' })
    expect(dialog).toHaveTextContent('DevControl System Health')
    expect(dialog).toHaveTextContent("Measures whether DevControl's API and database respond to a health check. This indicator reflects DevControl application availability, not your connected AWS infrastructure uptime.")
    expect(dialog.textContent).not.toMatch(/telemetry/i)
  })

  it('has no "Real-time" claim and no "Infrastructure Intelligence" heading', () => {
    const { container } = renderRow()
    expect(container.textContent).not.toMatch(/real[- ]?time/i)
    expect(container.textContent).not.toMatch(/Infrastructure Intelligence/)
  })
})
