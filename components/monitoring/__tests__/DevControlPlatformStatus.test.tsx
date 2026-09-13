/**
 * Monitoring Truthfulness Phase 1: DevControlPlatformStatus is the separated home for
 * DevControl's own Prometheus-backed infrastructure status, deliberately isolated from
 * ServiceHealthTable (AWS Service Health). These tests cover its own render contract in
 * isolation: never renders before the first check completes, never fabricates a value,
 * and correctly displays real service statuses when available.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DevControlPlatformStatus } from '../DevControlPlatformStatus'

describe('DevControlPlatformStatus', () => {
  it('renders nothing before the first check has completed', () => {
    const { container } = render(<DevControlPlatformStatus checked={false} available={false} services={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows an honest unavailable message when Prometheus could not be reached, with no fabricated services', () => {
    render(<DevControlPlatformStatus checked={true} available={false} services={[]} />)
    expect(screen.getByText('DevControl Platform Status')).toBeInTheDocument()
    expect(screen.getByText('Status temporarily unavailable')).toBeInTheDocument()
  })

  it('renders real service statuses, including a genuine response time, when available', () => {
    render(
      <DevControlPlatformStatus
        checked={true}
        available={true}
        services={[
          { name: 'DevControl API', status: 'healthy', responseTimeMs: 42 },
          { name: 'PostgreSQL', status: 'healthy', responseTimeMs: null },
          { name: 'Node Exporter', status: 'down', responseTimeMs: null },
        ]}
      />
    )
    expect(screen.getByText('DevControl API')).toBeInTheDocument()
    expect(screen.getByText('· 42ms')).toBeInTheDocument()
    expect(screen.getByText('Down')).toBeInTheDocument()
    expect(screen.getAllByText('Operational')).toHaveLength(2)
  })

  it('never renders a response time when none was provided -- no fabricated placeholder', () => {
    render(
      <DevControlPlatformStatus
        checked={true}
        available={true}
        services={[{ name: 'PostgreSQL', status: 'healthy', responseTimeMs: null }]}
      />
    )
    expect(screen.queryByText(/ms/)).not.toBeInTheDocument()
  })

  it('reports an unknown status honestly rather than forcing it into healthy or down', () => {
    render(
      <DevControlPlatformStatus
        checked={true}
        available={true}
        services={[{ name: 'DevControl API', status: 'unknown', responseTimeMs: null }]}
      />
    )
    expect(screen.getByText('Unavailable')).toBeInTheDocument()
  })
})
