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

describe('ServiceHealthTable — Service Health Coverage Expansion (EBS/CloudFront)', () => {
  const mixedServices = [
    { name: 'vol-abc123', description: 'EBS · gp3', status: 'healthy' as const, uptime: 'N/A', responseTime: 'N/A', errorRate: null, monitored: true, resourceType: 'ebs' },
    { name: 'd111.cloudfront.net', description: 'CloudFront distribution', status: 'degraded' as const, uptime: 'N/A', responseTime: 'N/A', errorRate: 8.2, monitored: true, resourceType: 'cloudfront' },
    { name: 'i-123', description: 'EC2 · i-123', status: 'healthy' as const, uptime: '99.9%', responseTime: '120ms', errorRate: 0, monitored: true, resourceType: 'ec2' },
  ]

  it('renders EBS and CloudFront rows generically, with no special-cased branching required', () => {
    render(<ServiceHealthTable services={mixedServices} rangeLabel="1h" />)
    expect(screen.getByText('vol-abc123')).toBeInTheDocument()
    expect(screen.getByText('EBS · gp3')).toBeInTheDocument()
    expect(screen.getByText('d111.cloudfront.net')).toBeInTheDocument()
    expect(screen.getByText('CloudFront distribution')).toBeInTheDocument()
  })

  it('shows EBS and CloudFront filter tabs with counts derived from the actual services passed in', () => {
    render(<ServiceHealthTable services={mixedServices} rangeLabel="1h" />)
    expect(screen.getByText('EBS (1)')).toBeInTheDocument()
    expect(screen.getByText('CloudFront (1)')).toBeInTheDocument()
    expect(screen.getByText('All (3)')).toBeInTheDocument()
  })

  it('an EBS/CloudFront-only fleet still shows every other known-type tab at (0), not hidden', () => {
    render(
      <ServiceHealthTable
        services={[{ name: 'vol-1', status: 'healthy' as const, uptime: 'N/A', responseTime: 'N/A', errorRate: null, monitored: true, resourceType: 'ebs' }]}
        rangeLabel="1h"
      />
    )
    expect(screen.getByText('EBS (1)')).toBeInTheDocument()
    expect(screen.getByText('CloudFront (0)')).toBeInTheDocument()
    expect(screen.getByText('EC2 (0)')).toBeInTheDocument()
  })
})
