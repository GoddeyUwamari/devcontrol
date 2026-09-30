import { AlertTriangle, CheckCircle2, CircleSlash, XCircle } from 'lucide-react'
import type { EvidenceState } from '@/lib/services/system-intelligence.service'

/** One evidence section from GET /api/observability/readiness (the backend's ContextSection). */
export interface ReadinessSection<T> {
  state: EvidenceState
  source: string
  asOf: string | null
  coverage: string | null
  reason: string | null
  data: T | null
}

export type AlarmDisqualifier = 'insufficient_data' | 'no_actions' | 'data_unverified'

export interface TypeAlertCoverage {
  resourceType: 'ec2' | 'rds'
  applicable: boolean
  inScope: number
  covered: number
  coveragePercent: number | null
  statusCounts: Record<string, number>
  excluded: { notSeenByGatedRun: number; otherRegion: number }
  nonQualifyingAlarms: Record<AlarmDisqualifier, number>
}

export interface AlarmInventory {
  total: number
  matched: number
  orphaned: Array<{ alarmName: string }>
  unsupported: Array<{ alarmName: string }>
  unevaluated: number
}

export interface ReadinessGap {
  type: string
  severity: 'high' | 'medium' | 'low'
  message: string
  action: string
  actionPath: string
}

export interface ReadinessResult {
  connected: true | null
  state: EvidenceState
  reason: string | null
  readiness_score: number | null
  status: 'Ready' | 'Partially Ready' | 'At Risk' | null
  discovery_run: { completedAt: string } | null
  scope: { connectedAccountId: string | null; discoveryRegion: string | null } | null
  components: {
    alert_coverage: {
      ec2: ReadinessSection<TypeAlertCoverage>
      rds: ReadinessSection<TypeAlertCoverage>
      alb: ReadinessSection<never>
      lambda: ReadinessSection<never>
    }
    monitoring_coverage: ReadinessSection<never>
    signal_freshness: ReadinessSection<never>
    response_config: ReadinessSection<never>
  }
  alarms: ReadinessSection<AlarmInventory>
  top_gaps: ReadinessGap[]
}

/** What the page fetched: not connected (no account row) is distinct from a failed request. */
export type ReadinessLoad =
  | { kind: 'loading' }
  | { kind: 'request_error' }
  | { kind: 'not_connected' }
  | { kind: 'loaded'; result: ReadinessResult }

const STATE_LABEL: Record<EvidenceState, string> = {
  available: 'Available',
  partial: 'Partial',
  unavailable: 'Not available',
  error: 'Could not be retrieved',
  not_supported: 'Not supported',
}

const scoreColor = (s: number) => (s >= 85 ? '#059669' : s >= 65 ? '#D97706' : '#DC2626')

function sum(values: Array<number | undefined>): number {
  return values.reduce<number>((n, v) => n + (v ?? 0), 0)
}

function CoverageCard({ label, section }: { label: string; section: ReadinessSection<TypeAlertCoverage> }) {
  const data = section.data
  const measured = data?.applicable && data.coveragePercent !== null
  const nonQualifying = data?.nonQualifyingAlarms
  const notRunning = data ? sum(Object.entries(data.statusCounts).filter(([s]) => s !== 'running' && s !== 'available').map(([, n]) => n)) : 0
  return (
    <div data-testid={`coverage-${label}`} className="rounded-xl p-3.5 border bg-slate-50 border-slate-100">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">{label} alert coverage</p>
        {measured
          ? (data!.coveragePercent === 100 ? <CheckCircle2 size={12} className="text-green-600 shrink-0" /> : <AlertTriangle size={12} className="text-amber-500 shrink-0" />)
          : section.state === 'error' ? <XCircle size={12} className="text-red-600 shrink-0" /> : <CircleSlash size={12} className="text-slate-400 shrink-0" />}
      </div>
      {measured ? (
        <>
          <div className="text-xl font-bold leading-none mb-1.5" style={{ color: scoreColor(data!.coveragePercent!) }}>{data!.coveragePercent}%</div>
          <p className="text-xs text-slate-500 leading-snug">{data!.covered} of {data!.inScope} in-scope resource{data!.inScope !== 1 ? 's' : ''} covered by an enabled alarm with actions</p>
          {notRunning > 0 && <p className="text-xs text-slate-500 leading-snug mt-1">{notRunning} not running/available (still counted)</p>}
        </>
      ) : (
        <>
          <div className="text-base font-bold text-slate-400 leading-none mb-1.5">{data && !data.applicable ? 'Not applicable' : STATE_LABEL[section.state]}</div>
          {section.reason && <p className="text-xs text-slate-500 leading-snug">{section.reason}</p>}
        </>
      )}
      {nonQualifying && (nonQualifying.insufficient_data > 0 || nonQualifying.no_actions > 0 || nonQualifying.data_unverified > 0) && (
        <ul className="text-xs text-slate-500 leading-snug mt-2 list-none p-0 m-0">
          {nonQualifying.insufficient_data > 0 && <li>{nonQualifying.insufficient_data} matched alarm{nonQualifying.insufficient_data !== 1 ? 's' : ''} in INSUFFICIENT_DATA</li>}
          {nonQualifying.no_actions > 0 && <li>{nonQualifying.no_actions} matched alarm{nonQualifying.no_actions !== 1 ? 's' : ''} with no enabled actions</li>}
          {nonQualifying.data_unverified > 0 && <li>{nonQualifying.data_unverified} matched alarm{nonQualifying.data_unverified !== 1 ? 's' : ''} with data unverified (missing data treated as OK)</li>}
        </ul>
      )}
    </div>
  )
}

function AlarmSummary({ section, insufficientData }: { section: ReadinessSection<AlarmInventory>; insufficientData: number }) {
  const data = section.data
  if (!data) {
    return (
      <p data-testid="alarm-summary" className="text-xs text-slate-500 mt-4">
        CloudWatch alarms: {STATE_LABEL[section.state]}{section.reason ? ` — ${section.reason}` : ''}
      </p>
    )
  }
  const parts = [
    `${data.total} metric alarm${data.total !== 1 ? 's' : ''} read`,
    `${data.matched} matched to in-scope resources`,
    `${data.orphaned.length} orphaned (no in-scope match)`,
    `${insufficientData} matched in INSUFFICIENT_DATA`,
    `${data.unsupported.length} unsupported (metric math, dimensionless, or unmapped)`,
  ]
  if (data.unevaluated > 0) parts.push(`${data.unevaluated} not evaluated`)
  return <p data-testid="alarm-summary" className="text-xs text-slate-500 mt-4">{parts.join(' · ')}</p>
}

/**
 * Incident readiness, measured from evidence only: EC2/RDS alert coverage
 * against DevControl's discovered inventory. Every other component is shown
 * as not supported -- never as a score -- and a null readiness score is never
 * rendered as a number.
 */
export function IncidentReadinessPanel({ load }: { load: ReadinessLoad }) {
  if (load.kind === 'loading') return null

  if (load.kind === 'request_error') {
    return (
      <div data-testid="readiness-request-error" className="bg-white rounded-xl border border-slate-200 p-5 sm:p-7 mb-5">
        <p className="text-sm font-semibold text-slate-900 mb-1">Incident Readiness</p>
        <p className="text-xs text-slate-500">Readiness could not be loaded. This is missing data, not a score of zero.</p>
      </div>
    )
  }

  if (load.kind === 'not_connected') {
    return (
      <div data-testid="readiness-not-connected" className="bg-white rounded-xl border border-slate-200 p-5 sm:p-7 mb-5">
        <p className="text-sm font-semibold text-slate-900 mb-1">Incident Readiness</p>
        <p className="text-xs text-slate-500 mb-3">Connect an AWS account to measure alert coverage for your EC2 and RDS resources.</p>
        <a href="/connect-aws" className="text-xs font-semibold text-violet-600 no-underline">Connect AWS →</a>
      </div>
    )
  }

  const r = load.result
  const c = r.components
  const score = r.readiness_score
  const insufficientData = sum([
    c.alert_coverage.ec2.data?.nonQualifyingAlarms.insufficient_data,
    c.alert_coverage.rds.data?.nonQualifyingAlarms.insufficient_data,
  ])
  const unsupported: Array<[string, ReadinessSection<never>]> = [
    ['ALB alert coverage', c.alert_coverage.alb],
    ['Lambda alert coverage', c.alert_coverage.lambda],
    ['Monitoring coverage', c.monitoring_coverage],
    ['Signal freshness', c.signal_freshness],
    ['Response setup', c.response_config],
  ]

  return (
    <div data-testid="readiness-panel" className="bg-white rounded-xl border border-slate-200 p-5 sm:p-7 mb-5">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-5">
        <div className="flex items-start gap-4">
          <div
            data-testid="readiness-score"
            className="w-14 h-14 rounded-full border-2 flex flex-col items-center justify-center shrink-0 bg-slate-50 border-slate-300"
            style={score !== null ? { borderColor: scoreColor(score) } : undefined}
          >
            {score !== null ? (
              <>
                <span className="text-sm font-bold leading-none" style={{ color: scoreColor(score) }}>{score}%</span>
                <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-widest">alerts</span>
              </>
            ) : (
              <span className="text-sm font-bold text-slate-400">—</span>
            )}
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <p className="text-sm font-semibold text-slate-900">Incident Readiness</p>
              <span data-testid="readiness-state" className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600">{STATE_LABEL[r.state]}</span>
              {score !== null && r.status && (
                <span className="text-xs font-bold px-2.5 py-0.5 rounded-full" style={{ color: scoreColor(score), background: '#F8FAFC' }}>{r.status}</span>
              )}
            </div>
            {r.reason && <p data-testid="readiness-reason" className="text-xs text-slate-500 leading-snug max-w-2xl">{r.reason}</p>}
            {r.discovery_run && r.scope && (
              <p className="text-xs text-slate-400 mt-1">
                Based on the discovery run completed {new Date(r.discovery_run.completedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                {r.scope.discoveryRegion ? ` · ${r.scope.discoveryRegion}` : ''}
              </p>
            )}
          </div>
        </div>
        {r.top_gaps[0] && (
          <a href={r.top_gaps[0].actionPath} className="bg-violet-600 hover:bg-violet-700 text-white px-4 py-2 rounded-lg text-xs font-semibold no-underline transition-colors whitespace-nowrap self-start">
            {r.top_gaps[0].action} →
          </a>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <CoverageCard label="EC2" section={c.alert_coverage.ec2} />
        <CoverageCard label="RDS" section={c.alert_coverage.rds} />
      </div>

      <AlarmSummary section={r.alarms} insufficientData={insufficientData} />

      <div data-testid="not-supported" className="mt-4 pt-4 border-t border-slate-100">
        <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Not measured yet</p>
        <ul className="list-none p-0 m-0 flex flex-col gap-1">
          {unsupported.map(([label, section]) => (
            <li key={label} className="text-xs text-slate-500">
              <span className="font-semibold text-slate-600">{label}</span> — {STATE_LABEL[section.state]}{section.reason ? `: ${section.reason}` : ''}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
