/**
 * OB2.1: breakdownOf() -- the explicit split behind typeSummaryOf()'s "other",
 * per type and over the fleet. Pure; every check_status and unknown_reason.
 */
import { breakdownOf, typeSummaryOf, ObservabilityBreakdown, ObservabilityRow, UnknownReason } from '../observability-states'

type Row = Pick<ObservabilityRow, 'resource_type' | 'check_status' | 'unknown_reason' | 'telemetry'>

const r = (resource_type: string, check_status: Row['check_status'], telemetry: Row['telemetry'], unknown_reason: UnknownReason | null = null): Row => ({
  resource_type,
  check_status,
  unknown_reason,
  telemetry,
})

function expectInvariants(b: ObservabilityBreakdown) {
  expect(b.measured + b.neutral + b.not_measured + b.outside_scope).toBe(b.count)
  expect(b.passing + b.needs_attention + b.failing + b.check_unknown).toBe(b.measured)
  expect(b.stopped + b.no_activity + b.not_enough_traffic).toBe(b.neutral)
  expect(b.reporting + b.no_telemetry + b.unknown).toBe(b.measured)
}

describe('breakdownOf', () => {
  it('(B1) judged rows are measured, with their telemetry', () => {
    const { fleet } = breakdownOf([r('ec2', 'passing', 'reporting'), r('ec2', 'needs_attention', 'reporting'), r('ec2', 'failing', 'no_telemetry')])
    expect(fleet).toMatchObject({ count: 3, measured: 3, passing: 1, needs_attention: 1, failing: 1, check_unknown: 0, reporting: 2, no_telemetry: 1, unknown: 0 })
    expectInvariants(fleet)
  })

  it('(B2) stopped is neutral: not measured, not passing, not failing, telemetry not counted', () => {
    const { fleet } = breakdownOf([r('ec2', 'stopped', 'no_telemetry')])
    expect(fleet).toMatchObject({ count: 1, measured: 0, passing: 0, failing: 0, neutral: 1, stopped: 1, no_telemetry: 0 })
    expectInvariants(fleet)
  })

  it.each(['no_activity', 'not_enough_traffic'] as const)('(B3) unknown/%s is neutral (D2)', (reason) => {
    const { fleet } = breakdownOf([r('lambda', 'unknown', 'no_telemetry', reason)])
    expect(fleet).toMatchObject({ count: 1, measured: 0, check_unknown: 0, neutral: 1, [reason]: 1, no_telemetry: 0 })
    expectInvariants(fleet)
  })

  it.each(['outside_region', 'outside_account'] as const)('(B4) unknown/%s is outside scope, not measured', (reason) => {
    const { fleet } = breakdownOf([r('ec2', 'unknown', 'unknown', reason)])
    expect(fleet).toMatchObject({ count: 1, measured: 0, outside_scope: 1, neutral: 0, unknown: 0 })
    expectInvariants(fleet)
  })

  it.each(['access_denied', 'throttled', 'query_failed', 'not_supported', 'no_telemetry'] as const)('(B5) unknown/%s is measured and check_unknown, never passing', (reason) => {
    const telemetry = reason === 'no_telemetry' ? 'no_telemetry' : 'unknown'
    const { fleet } = breakdownOf([r('ec2', 'unknown', telemetry, reason)])
    expect(fleet).toMatchObject({ count: 1, measured: 1, passing: 0, check_unknown: 1, [telemetry]: 1 })
    expectInvariants(fleet)
  })

  it('(B6) not_measured counts nowhere else', () => {
    const { fleet } = breakdownOf([r('s3', 'not_measured', 'unknown')])
    expect(fleet).toMatchObject({ count: 1, measured: 0, not_measured: 1, unknown: 0, neutral: 0 })
    expectInvariants(fleet)
  })

  it('(B7) per type and fleet agree with typeSummaryOf; other = check_unknown + neutral + not_measured + outside_scope', () => {
    const rows = [
      r('ec2', 'passing', 'reporting'),
      r('ec2', 'stopped', 'no_telemetry'),
      r('ec2', 'unknown', 'unknown', 'access_denied'),
      r('ec2', 'unknown', 'unknown', 'outside_region'),
      r('load-balancer', 'needs_attention', 'reporting'),
      r('load-balancer', 'not_measured', 'unknown'),
      r('load-balancer', 'unknown', 'reporting', 'not_enough_traffic'),
      r('lambda', 'unknown', 'no_telemetry', 'no_activity'),
      r('rds', 'failing', 'reporting'),
    ]
    const { byType, fleet } = breakdownOf(rows)
    const summary = typeSummaryOf(rows)
    expect(Object.keys(byType).sort()).toEqual(Object.keys(summary).sort())
    for (const [type, s] of Object.entries(summary)) {
      const b = byType[type]
      expect([b.count, b.passing, b.needs_attention, b.failing]).toEqual([s.count, s.passing, s.needs_attention, s.failing])
      expect(b.check_unknown + b.neutral + b.not_measured + b.outside_scope).toBe(s.other)
      expectInvariants(b)
    }
    expect(fleet).toEqual({
      count: 9,
      measured: 4,
      passing: 1,
      needs_attention: 1,
      failing: 1,
      check_unknown: 1,
      neutral: 3,
      stopped: 1,
      no_activity: 1,
      not_enough_traffic: 1,
      not_measured: 1,
      outside_scope: 1,
      reporting: 3,
      no_telemetry: 0,
      unknown: 1,
    })
    expectInvariants(fleet)
  })

  it('(B8) no rows: an all-zero fleet and no types', () => {
    const { byType, fleet } = breakdownOf([])
    expect(byType).toEqual({})
    expect(Object.values(fleet).every((n) => n === 0)).toBe(true)
  })
})
