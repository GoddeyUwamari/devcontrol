/**
 * Monitoring Truthfulness Phase 1: ServiceHealthTable previously hardcoded "Uptime (30d)"
 * (no 30-day window exists anywhere in cloudwatch.service.ts's RANGE_CONFIG, max is 7d)
 * and "p95 Latency" (every latency figure computed by cloudwatch.service.ts is an Average,
 * never a percentile). Labels are now prop-driven from the actually-selected range.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ServiceHealthTable } from '../ServiceHealthTable'

const services = [
  { name: 'i-123', description: 'EC2 · i-123', status: 'healthy' as const, uptime: '99.9%', responseTime: '120ms', errorRate: 0, monitored: true, resourceType: 'ec2' },
]

describe('ServiceHealthTable — truthful labels', () => {
  it('labels uptime with the actual selected range, never a hardcoded 30d window', () => {
    render(<ServiceHealthTable services={services} rangeLabel="1h" />)
    expect(screen.getByText('Uptime (1h)')).toBeInTheDocument()
    expect(screen.queryByText('Uptime (30d)')).not.toBeInTheDocument()
  })

  it('reflects a different selected range correctly', () => {
    render(<ServiceHealthTable services={services} rangeLabel="7d" />)
    expect(screen.getByText('Uptime (7d)')).toBeInTheDocument()
  })

  it('labels latency as an average, never claiming a percentile that was never computed', () => {
    render(<ServiceHealthTable services={services} rangeLabel="1h" />)
    expect(screen.getByText('Avg Latency')).toBeInTheDocument()
    expect(screen.queryByText('p95 Latency')).not.toBeInTheDocument()
  })

  it('still renders the "Not monitored" pill and gray status dot for monitored: false rows (regression)', () => {
    render(
      <ServiceHealthTable
        services={[{ name: 'db-1', status: 'unknown', uptime: 'N/A', responseTime: 'N/A', errorRate: null, monitored: false, resourceType: 'rds' }]}
        rangeLabel="1h"
      />
    )
    expect(screen.getByText('Not monitored')).toBeInTheDocument()
  })
})
