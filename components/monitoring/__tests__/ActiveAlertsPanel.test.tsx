/**
 * The panel's "N critical • N warnings" line is a count of confirmed alerts. When
 * the alert list is not a confirmed result (loading, unavailable, failed), an empty
 * list must not be rendered as zero counts.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ActiveAlertsPanel } from '../ActiveAlertsPanel'

describe('ActiveAlertsPanel severity counts', () => {
  it('does not render zero counts when the alert data is unavailable', () => {
    render(<ActiveAlertsPanel alerts={[]} countsAvailable={false} emptyMessage="Could not be retrieved" />)

    expect(screen.queryByText(/critical •/)).not.toBeInTheDocument()
    expect(screen.getByText('No alerts to show')).toBeInTheDocument()
    expect(screen.getByText('Could not be retrieved')).toBeInTheDocument()
  })

  it('does not render zero counts while the alert data is loading', () => {
    render(<ActiveAlertsPanel alerts={[]} countsAvailable={false} emptyMessage="Loading…" />)

    expect(screen.queryByText(/critical •/)).not.toBeInTheDocument()
  })

  it('renders genuine zero counts for a confirmed empty result', () => {
    render(<ActiveAlertsPanel alerts={[]} countsAvailable emptyMessage="No firing alerts" />)

    expect(screen.getByText('0 critical • 0 warnings')).toBeInTheDocument()
  })

  it('counts confirmed alerts by severity', () => {
    const triggeredAt = new Date(Date.now() - 5 * 60 * 1000)
    render(
      <ActiveAlertsPanel
        countsAvailable
        emptyMessage=""
        alerts={[
          { id: '1', title: 'High CPU', message: 'CPU above threshold', severity: 'critical', service: 'api', triggeredAt },
          { id: '2', title: 'Slow responses', message: 'Latency above threshold', severity: 'warning', service: 'api', triggeredAt },
          { id: '3', title: 'Disk filling', message: 'Disk above threshold', severity: 'warning', service: 'db', triggeredAt },
        ]}
      />
    )

    expect(screen.getByText('1 critical • 2 warnings')).toBeInTheDocument()
  })
})
