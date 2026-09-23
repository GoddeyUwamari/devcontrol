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
    render(<InfrastructureIntelligence topRisk={null} aiSummaryLoading={false} systemStatus={systemStatus} isLive />)

    const link = screen.getByText('System Status').closest('a')
    expect(link).not.toBeNull()
    expect(link!.getAttribute('href')).toBe('/admin/monitoring')
    expect(link!.getAttribute('href')).not.toBe('/observability')
  })

  it('leaves Top Risk unlinked', () => {
    render(<InfrastructureIntelligence topRisk={null} aiSummaryLoading={false} systemStatus={systemStatus} isLive />)

    expect(screen.getByText('Top Risk').closest('a')).toBeNull()
  })
})
