/**
 * Covers the Dashboard System Status hotfix: the card previously linked to
 * /observability, which has no page (live 404). It must render as a real link
 * to /admin/monitoring -- the same existing page the top nav's "Monitoring
 * Overview" reaches via /monitoring's redirect.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { InfrastructureIntelligence } from '../infrastructure-intelligence'

const systemStatus = { value: 'Operational', label: "DevControl's API and database are responding. Not a status of your AWS resources.", color: 'green', background: 'white', dotColor: 'green' }

describe('InfrastructureIntelligence -- System Status link', () => {
  it('renders System Status as a real link to /admin/monitoring, not /observability', () => {
    render(<InfrastructureIntelligence topRisk={null} topRiskStatus="unavailable" aiSummaryLoading={false} systemStatus={systemStatus} />)

    const link = screen.getByText('System Status').closest('a')
    expect(link).not.toBeNull()
    expect(link!.getAttribute('href')).toBe('/admin/monitoring')
    expect(link!.getAttribute('href')).not.toBe('/observability')
  })

  it('leaves Top Risk unlinked', () => {
    render(<InfrastructureIntelligence topRisk={null} topRiskStatus="unavailable" aiSummaryLoading={false} systemStatus={systemStatus} />)

    expect(screen.getByText('Top Risk').closest('a')).toBeNull()
  })
})

describe('InfrastructureIntelligence -- Top Risk never claims "no risks" from missing evidence', () => {
  it('shows "Risk status unavailable" when risk could not be evaluated', () => {
    render(<InfrastructureIntelligence topRisk={null} topRiskStatus="unavailable" aiSummaryLoading={false} systemStatus={systemStatus} />)

    expect(screen.getByText('Risk status unavailable')).toBeTruthy()
    expect(screen.queryByText('No urgent risks identified')).toBeNull()
    expect(screen.queryByText(/Nothing currently requires immediate attention/)).toBeNull()
  })

  it('shows "No urgent risks identified" only when evaluated security evidence has no active findings', () => {
    render(<InfrastructureIntelligence topRisk={null} topRiskStatus="none_identified" aiSummaryLoading={false} systemStatus={systemStatus} />)

    expect(screen.getByText('No urgent risks identified')).toBeTruthy()
    expect(screen.getByText(/No active findings in DevControl's evaluated security checks/)).toBeTruthy()
  })

  it('shows the identified risk text when there is one', () => {
    render(<InfrastructureIntelligence topRisk="Open SSH to the internet (critical severity)" topRiskStatus="identified" aiSummaryLoading={false} systemStatus={systemStatus} />)

    expect(screen.getByText('Open SSH to the internet (critical severity)')).toBeTruthy()
    expect(screen.queryByText('Risk status unavailable')).toBeNull()
  })
})

describe('InfrastructureIntelligence -- System Status is DevControl\'s own health, not customer AWS', () => {
  it('shows the given status value and a description naming DevControl, never a generic "Healthy"', () => {
    render(<InfrastructureIntelligence topRisk={null} topRiskStatus="unavailable" aiSummaryLoading={false} systemStatus={systemStatus} />)

    const card = screen.getByText('System Status').closest('a')!
    expect(card.textContent).toContain('Operational')
    expect(card.textContent).toMatch(/DevControl/)
    expect(card.textContent).toMatch(/not a status of your AWS resources/i)
    expect(card.textContent).not.toMatch(/\bHealthy\b/)
    expect(card.textContent).not.toMatch(/All systems/i)
  })

  it('has no "Real-time" claim', () => {
    const { container } = render(<InfrastructureIntelligence topRisk={null} topRiskStatus="unavailable" aiSummaryLoading={false} systemStatus={systemStatus} />)

    expect(container.textContent).not.toMatch(/real[- ]?time/i)
  })
})
