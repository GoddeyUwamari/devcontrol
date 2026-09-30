/**
 * Incident Readiness panel: renders GET /api/observability/readiness's
 * evidence sections as they are. A null readiness score is never a number
 * ("0/100" was previously rendered from a null score), not-connected and a
 * failed request are distinct, only EC2/RDS alert coverage carries a figure,
 * and every other component reads "Not supported".
 */
import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import {
  IncidentReadinessPanel,
  type ReadinessResult,
  type ReadinessSection,
  type TypeAlertCoverage,
} from '../incident-readiness-panel'

const PARTIAL_REASON =
  'Measures EC2 alert coverage only (0 of 1 in-scope resources covered); monitoring coverage, signal freshness, response setup, and ALB/Lambda alert coverage are not supported yet.'

function section<T>(state: ReadinessSection<T>['state'], reason: string | null, data: T | null = null): ReadinessSection<T> {
  return { state, source: 's', asOf: null, coverage: null, reason, data }
}

function coverage(overrides: Partial<TypeAlertCoverage> = {}): TypeAlertCoverage {
  return {
    resourceType: 'ec2', applicable: true, inScope: 1, covered: 0, coveragePercent: 0,
    statusCounts: { running: 1 }, excluded: { notSeenByGatedRun: 0, otherRegion: 0 },
    nonQualifyingAlarms: { insufficient_data: 0, no_actions: 0, data_unverified: 0 },
    ...overrides,
  }
}

const notSupported = (reason: string) => section<never>('not_supported', reason)

function result(overrides: Partial<ReadinessResult> = {}): ReadinessResult {
  return {
    connected: true,
    state: 'partial',
    reason: PARTIAL_REASON,
    readiness_score: 0,
    status: 'At Risk',
    discovery_run: { completedAt: '2026-09-30T10:04:12.000Z' },
    scope: { connectedAccountId: '111122223333', discoveryRegion: 'us-east-1' },
    components: {
      alert_coverage: {
        ec2: section('available', null, coverage()),
        rds: section('available', 'no RDS resources in scope, so RDS alert coverage is not applicable',
          coverage({ resourceType: 'rds', applicable: false, inScope: 0, coveragePercent: null, statusCounts: {} })),
        alb: notSupported('discovery failures for this type are not recorded'),
        lambda: notSupported('discovery failures for this type are not recorded'),
      },
      monitoring_coverage: notSupported('DevControl does not yet check whether each discovered resource is reporting metrics'),
      signal_freshness: notSupported('DevControl does not yet measure per-resource metric freshness'),
      response_config: notSupported('DevControl does not yet record alert destinations or on-call routing'),
    },
    alarms: section('available', null, {
      total: 12, matched: 0,
      orphaned: Array.from({ length: 11 }, (_, i) => ({ alarmName: `old-${i}` })),
      unsupported: [{ alarmName: 'fleet-math' }], unevaluated: 0,
    }),
    top_gaps: [{ type: 'alert_coverage_ec2', severity: 'high', message: '1 of 1 in-scope EC2 resource has no enabled alarm with actions', action: 'Configure alerts', actionPath: '/observability/alerts' }],
    ...overrides,
  }
}

const loaded = (r: ReadinessResult) => render(<IncidentReadinessPanel load={{ kind: 'loaded', result: r }} />)

describe('connection and request states', () => {
  it('not connected: a connect prompt, no score', () => {
    render(<IncidentReadinessPanel load={{ kind: 'not_connected' }} />)
    expect(screen.getByTestId('readiness-not-connected')).toHaveTextContent('Connect an AWS account')
    expect(screen.queryByTestId('readiness-score')).not.toBeInTheDocument()
  })

  it('a failed request is an error, distinct from not connected, and not a zero', () => {
    render(<IncidentReadinessPanel load={{ kind: 'request_error' }} />)
    expect(screen.getByTestId('readiness-request-error')).toHaveTextContent('Readiness could not be loaded')
    expect(screen.queryByText(/Connect/)).not.toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/\b0\s*(\/100|%)/)
  })

  it('loading renders nothing', () => {
    const { container } = render(<IncidentReadinessPanel load={{ kind: 'loading' }} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('null scores are never numbers', () => {
  it('state error (e.g. the AWS role could not be assumed): "—", the reason, and no 0/100', () => {
    const failed = section<TypeAlertCoverage>('error', 'the connected AWS role could not be assumed')
    loaded(result({
      state: 'error', reason: 'the connected AWS role could not be assumed', readiness_score: null, status: null, discovery_run: null,
      components: { ...result().components, alert_coverage: { ...result().components.alert_coverage, ec2: failed, rds: failed } },
      alarms: section('error', 'the connected AWS role could not be assumed'), top_gaps: [],
    }))
    expect(within(screen.getByTestId('readiness-score')).getByText('—')).toBeInTheDocument()
    expect(screen.getByTestId('readiness-state')).toHaveTextContent('Could not be retrieved')
    expect(screen.getByTestId('readiness-reason')).toHaveTextContent('the connected AWS role could not be assumed')
    expect(within(screen.getByTestId('coverage-EC2')).getByText('Could not be retrieved')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/0\/100|\/100/)
    expect(document.body.textContent).not.toMatch(/at risk \(0/i)
  })

  it('state unavailable (nothing in scope): "—" with the reason', () => {
    loaded(result({ state: 'unavailable', reason: 'no EC2 or RDS resources are in scope, so alert coverage is not applicable', readiness_score: null, status: null, top_gaps: [] }))
    expect(within(screen.getByTestId('readiness-score')).getByText('—')).toBeInTheDocument()
    expect(screen.getByTestId('readiness-state')).toHaveTextContent('Not available')
    expect(document.body.textContent).not.toMatch(/\/100/)
  })
})

describe('partial readiness', () => {
  it('a measured 0% is shown as 0%, labeled Partial with its reason', () => {
    loaded(result())
    expect(screen.getByTestId('readiness-score')).toHaveTextContent('0%')
    expect(screen.getByTestId('readiness-state')).toHaveTextContent('Partial')
    expect(screen.getByTestId('readiness-reason')).toHaveTextContent(PARTIAL_REASON)
    expect(screen.getByTestId('coverage-EC2')).toHaveTextContent('0 of 1 in-scope resource covered')
    expect(screen.getByTestId('coverage-RDS')).toHaveTextContent('Not applicable')
  })

  it('shows orphaned, insufficient-data, and unsupported alarm counts', () => {
    const r = result()
    r.components.alert_coverage.ec2 = section('available', null, coverage({ nonQualifyingAlarms: { insufficient_data: 2, no_actions: 1, data_unverified: 1 } }))
    loaded(r)
    const summary = screen.getByTestId('alarm-summary')
    expect(summary).toHaveTextContent('11 orphaned (no in-scope match)')
    expect(summary).toHaveTextContent('2 matched in INSUFFICIENT_DATA')
    expect(summary).toHaveTextContent('1 unsupported')
    const ec2 = screen.getByTestId('coverage-EC2')
    expect(ec2).toHaveTextContent('2 matched alarms in INSUFFICIENT_DATA')
    expect(ec2).toHaveTextContent('1 matched alarm with no enabled actions')
    expect(ec2).toHaveTextContent('1 matched alarm with data unverified')
  })

  it('an alarm read failure is stated, not counted as zero alarms', () => {
    loaded(result({ alarms: section('error', 'CloudWatch alarms could not be read') }))
    expect(screen.getByTestId('alarm-summary')).toHaveTextContent('CloudWatch alarms: Could not be retrieved — CloudWatch alarms could not be read')
  })

  it('every unmeasured component reads "Not supported" -- none has a score', () => {
    loaded(result())
    const list = screen.getByTestId('not-supported')
    for (const label of ['ALB alert coverage', 'Lambda alert coverage', 'Monitoring coverage', 'Signal freshness', 'Response setup']) {
      expect(list).toHaveTextContent(`${label} — Not supported`)
    }
    expect(list.textContent).not.toMatch(/%/)
  })

  it('makes none of the removed claims', () => {
    loaded(result())
    const text = document.body.textContent ?? ''
    expect(text).not.toMatch(/AI Insight/)
    expect(text).not.toMatch(/team will not be notified/i)
    expect(text).not.toMatch(/2 services/)
    expect(text).not.toMatch(/Critical Coverage/i)
  })
})
