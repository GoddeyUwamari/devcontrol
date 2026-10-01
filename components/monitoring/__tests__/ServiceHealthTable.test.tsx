/**
 * Monitoring Truthfulness Phase 1: ServiceHealthTable previously hardcoded "Uptime (30d)"
 * (no 30-day window exists anywhere in cloudwatch.service.ts's RANGE_CONFIG, max is 7d)
 * and "p95 Latency" (every latency figure computed by cloudwatch.service.ts is an Average,
 * never a percentile). Labels are now prop-driven from the actually-selected range.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ServiceHealthTable, checkResultLabel } from '../ServiceHealthTable'

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

  it('still renders the no-telemetry pill and gray status dot for monitored: false rows (regression), with no check result', () => {
    render(
      <ServiceHealthTable
        services={[{ name: 'db-1', status: 'unknown', uptime: 'N/A', responseTime: 'N/A', errorRate: null, monitored: false, resourceType: 'rds' }]}
        rangeLabel="1h"
      />
    )
    expect(screen.getByText('No telemetry received')).toBeInTheDocument()
    expect(screen.queryByText('Not monitored')).not.toBeInTheDocument()
    expect(screen.queryByTestId('check-result')).not.toBeInTheDocument()
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

describe('ServiceHealthTable — Aurora Service Health', () => {
  const services = [
    { name: 'prod-aurora-cluster', description: 'Aurora · aurora-postgresql', status: 'healthy' as const, uptime: 'N/A', responseTime: 'N/A', errorRate: null, monitored: true, resourceType: 'aurora' },
    { name: 'i-123', description: 'EC2 · i-123', status: 'healthy' as const, uptime: '99.9%', responseTime: '120ms', errorRate: 0, monitored: true, resourceType: 'ec2' },
  ]

  it('renders an Aurora row generically and shows the Aurora filter tab with a count derived from the actual services passed in', () => {
    render(<ServiceHealthTable services={services} rangeLabel="1h" />)
    expect(screen.getByText('prod-aurora-cluster')).toBeInTheDocument()
    expect(screen.getByText('Aurora · aurora-postgresql')).toBeInTheDocument()
    expect(screen.getByText('Aurora (1)')).toBeInTheDocument()
  })

  it('renders the no-telemetry pill for an Aurora row with monitored: false, same as every other type', () => {
    render(
      <ServiceHealthTable
        services={[{ name: 'stale-cluster', status: 'unknown' as const, uptime: 'N/A', responseTime: 'N/A', errorRate: null, monitored: false, resourceType: 'aurora' }]}
        rangeLabel="1h"
      />
    )
    expect(screen.getByText('No telemetry received')).toBeInTheDocument()
  })
})

describe('ServiceHealthTable — terminology', () => {
  it('is titled Resource Checks, not Service Health', () => {
    render(<ServiceHealthTable services={[]} rangeLabel="1h" />)
    expect(screen.getByText('Resource Checks')).toBeInTheDocument()
    expect(screen.queryByText('Service Health')).not.toBeInTheDocument()
  })
})

describe('checkResultLabel — names the check that produced each status', () => {
  type Row = Parameters<typeof checkResultLabel>[0]
  const row = (resourceType: string, status: Row['status'], uptime = 'N/A'): Row => ({ resourceType, status, uptime, monitored: true })

  it.each([
    ['ec2 status-check pass', row('ec2', 'healthy', '99.95%'), 'Status checks passing'],
    ['ec2 status-check issue', row('ec2', 'degraded', '98.5%'), 'Status check issue detected'],
    ['ec2 CPU-only pass', row('ec2', 'healthy'), 'Within thresholds'],
    ['ec2 CPU-only breach', row('ec2', 'degraded'), 'Threshold exceeded'],
    ['ec2 stopped', row('ec2', 'down'), 'Not running'],
    ['ebs pass', row('ebs', 'healthy'), 'Status checks passing'],
    ['ebs warning', row('ebs', 'degraded'), 'Status check issue detected'],
    ['ebs impaired', row('ebs', 'critical'), 'Status check issue detected'],
    ['alb pass', row('load-balancer', 'healthy'), 'Within thresholds'],
    ['alb breach', row('load-balancer', 'degraded'), 'Threshold exceeded'],
    ['lambda pass', row('lambda', 'healthy'), 'Within thresholds'],
    ['lambda breach', row('lambda', 'degraded'), 'Threshold exceeded'],
    ['aurora pass', row('aurora', 'healthy'), 'Within thresholds'],
    ['aurora critical (threshold only)', row('aurora', 'critical'), 'Threshold exceeded'],
    ['aurora degraded (threshold or failover)', row('aurora', 'degraded'), 'Issue detected'],
    ['ecs control plane pass', row('ecs', 'healthy'), 'No issues detected'],
    ['ecs control plane issue', row('ecs', 'critical'), 'Issue detected'],
    ['any unknown', row('ebs', 'unknown'), 'Undetermined'],
  ])('%s', (_name, input, expected) => {
    expect(checkResultLabel(input)).toBe(expected)
  })

  it('never says "Healthy", "Unhealthy", or "At Risk"', () => {
    const statuses: Row['status'][] = ['healthy', 'degraded', 'critical', 'down', 'unknown']
    const types = ['ec2', 'ebs', 'load-balancer', 'lambda', 'dynamodb', 'cloudfront', 'aurora', 'ecs', 'eks', 'rds']
    for (const t of types) for (const st of statuses) {
      expect(checkResultLabel(row(t, st, '99.9%'))).not.toMatch(/healthy|at risk/i)
    }
  })

  it('a row with no telemetry, or no resource type (demo), gets no check label', () => {
    expect(checkResultLabel({ ...row('rds', 'healthy'), monitored: false })).toBeNull()
    expect(checkResultLabel({ status: 'healthy', uptime: '99%', monitored: true })).toBeNull()
  })

  it('renders the label on the row', () => {
    render(
      <ServiceHealthTable
        services={[{ name: 'i-1', status: 'healthy', uptime: '99.99%', responseTime: 'N/A', errorRate: null, monitored: true, resourceType: 'ec2' }]}
        rangeLabel="1h"
      />
    )
    expect(screen.getByTestId('check-result')).toHaveTextContent('Status checks passing')
  })
})
