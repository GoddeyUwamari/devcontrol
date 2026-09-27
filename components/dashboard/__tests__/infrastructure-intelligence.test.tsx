/**
 * Covers the Dashboard System Status hotfix: the card previously linked to
 * /observability, which has no page (live 404). It must render as a real link
 * to /admin/monitoring -- the same existing page the top nav's "Monitoring
 * Overview" reaches via /monitoring's redirect.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { InfrastructureIntelligence } from '../infrastructure-intelligence'

const systemStatus = { label: 'All systems operational', color: 'green', background: 'white', dotColor: 'green' }

describe('InfrastructureIntelligence -- System Status link', () => {
  it('renders System Status as a real link to /admin/monitoring, not /observability', () => {
    render(<InfrastructureIntelligence topRisk={null} topRiskStatus="unavailable" aiSummaryLoading={false} systemStatus={systemStatus} isLive />)

    const link = screen.getByText('System Status').closest('a')
    expect(link).not.toBeNull()
    expect(link!.getAttribute('href')).toBe('/admin/monitoring')
    expect(link!.getAttribute('href')).not.toBe('/observability')
  })

  it('leaves Top Risk unlinked', () => {
    render(<InfrastructureIntelligence topRisk={null} topRiskStatus="unavailable" aiSummaryLoading={false} systemStatus={systemStatus} isLive />)

    expect(screen.getByText('Top Risk').closest('a')).toBeNull()
  })
})

describe('InfrastructureIntelligence -- Top Risk never claims "no risks" from missing evidence', () => {
  it('shows "Risk status unavailable" when risk could not be evaluated', () => {
    render(<InfrastructureIntelligence topRisk={null} topRiskStatus="unavailable" aiSummaryLoading={false} systemStatus={systemStatus} isLive />)

    expect(screen.getByText('Risk status unavailable')).toBeTruthy()
    expect(screen.queryByText('No urgent risks identified')).toBeNull()
    expect(screen.queryByText(/Nothing currently requires immediate attention/)).toBeNull()
  })

  it('shows "No urgent risks identified" only when evaluated security evidence has no active findings', () => {
    render(<InfrastructureIntelligence topRisk={null} topRiskStatus="none_identified" aiSummaryLoading={false} systemStatus={systemStatus} isLive />)

    expect(screen.getByText('No urgent risks identified')).toBeTruthy()
    expect(screen.getByText(/No active findings in DevControl's evaluated security checks/)).toBeTruthy()
  })

  it('shows the identified risk text when there is one', () => {
    render(<InfrastructureIntelligence topRisk="Open SSH to the internet (critical severity)" topRiskStatus="identified" aiSummaryLoading={false} systemStatus={systemStatus} isLive />)

    expect(screen.getByText('Open SSH to the internet (critical severity)')).toBeTruthy()
    expect(screen.queryByText('Risk status unavailable')).toBeNull()
  })
})
