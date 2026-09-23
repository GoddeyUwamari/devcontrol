/**
 * Dashboard Security Health KPI + Security Key Findings sources.
 *
 * The KPI used to read the Pro-gated /api/risk-score/trend: lower plans got a
 * 402, which rendered as a false "Scanning…" / "Scan in progress", and it used
 * benchmark-sounding labels ("Elite Tier", "Above baseline") with no benchmark
 * behind them. It now reads the canonical System Intelligence security
 * component. The Key Findings card now reads the same two repository reads
 * the risk score is built from, via their own org-scoped, non-gated endpoints.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { computeSecurityHealthKpi } from '../securityHealthKpi'

const pageSource = readFileSync(join(__dirname, '../page.tsx'), 'utf-8')
const helperSource = readFileSync(join(__dirname, '../securityHealthKpi.ts'), 'utf-8')

const base = { isDemoActive: false, hasOrganization: true, isLoading: false }
const ready = (score: number, status: 'good' | 'warning' | 'risk') => ({ score, status, ready: true })

describe('computeSecurityHealthKpi -- canonical security component', () => {
  it.each([
    [92, 'good', 'Strong', 'var(--text-success)'],
    [72, 'warning', 'Needs attention', 'var(--text-warning)'],
    [57, 'risk', 'At risk', 'var(--text-danger)'],
  ] as const)('ready score %i with component status "%s" -> "%s"', (score, status, label, color) => {
    const kpi = computeSecurityHealthKpi({ ...base, securityComponent: ready(score, status) })
    expect(kpi.value).toBe(String(score))
    expect(kpi.score).toBe(score)
    expect(kpi.badge?.label).toBe(label)
    expect(kpi.badge?.color).toBe(color)
  })

  it('uses the component\'s own status, not re-derived thresholds (status wins over the number)', () => {
    // A mismatched pair proves the label comes from the canonical status field.
    expect(computeSecurityHealthKpi({ ...base, securityComponent: ready(95, 'risk') }).badge?.label).toBe('At risk')
  })

  it('a ready score of 0 is a real score, not missing data', () => {
    const kpi = computeSecurityHealthKpi({ ...base, securityComponent: ready(0, 'risk') })
    expect(kpi.value).toBe('0')
    expect(kpi.score).toBe(0)
    expect(kpi.badge?.label).toBe('At risk')
  })

  it('a not-ready component (preliminary, or the backend error placeholder) shows no number and an honest label', () => {
    const kpi = computeSecurityHealthKpi({ ...base, securityComponent: { score: 0, status: 'risk', ready: false } })
    expect(kpi.value).toBe('—')
    expect(kpi.score).toBeNull()
    expect(kpi.badge?.label).toBe('Not yet available')
  })

  it('no System Intelligence data after loading (e.g. the request failed) is "Unavailable", never a scan claim', () => {
    const kpi = computeSecurityHealthKpi({ ...base, securityComponent: undefined })
    expect(kpi.value).toBe('—')
    expect(kpi.badge?.label).toBe('Unavailable')
  })

  it('while loading (or before the organization is known) shows "Calculating…" with no badge', () => {
    expect(computeSecurityHealthKpi({ ...base, isLoading: true, securityComponent: undefined })).toEqual({ value: 'Calculating…', score: null })
    expect(computeSecurityHealthKpi({ ...base, hasOrganization: false, securityComponent: undefined })).toEqual({ value: 'Calculating…', score: null })
  })

  it('demo keeps its fixed 87 with the same truthful label', () => {
    const kpi = computeSecurityHealthKpi({ ...base, isDemoActive: true, securityComponent: undefined })
    expect(kpi.value).toBe('87')
    expect(kpi.badge?.label).toBe('Strong')
  })

  it('never emits benchmark or false scan-state wording', () => {
    // As string literals -- comments may still name the removed wording.
    for (const text of ['Elite Tier', 'Above baseline', 'Scan in progress', 'Scanning…']) {
      expect(helperSource).not.toContain(`'${text}'`)
      expect(pageSource).not.toContain(`'${text}'`)
    }
  })
})

describe('Dashboard page wiring', () => {
  it('the Security Health KPI reads systemIntelligence.components.security, not the overall status', () => {
    expect(pageSource).toMatch(/computeSecurityHealthKpi\(\{[^]*?securityComponent: systemIntelligence\?\.components\?\.security,[^]*?\}\)/)
    expect(pageSource).toMatch(/value=\{securityKpi\.value\}/)
    // The overall status stays confined to the Infrastructure Health badge.
    expect(pageSource.match(/systemIntelligence\?\.status/g)).toHaveLength(1)
    expect(pageSource).toMatch(/const displayedHealthStatus = isDemoActive \? 'Healthy' : \(systemIntelligence\?\.status \?\? null\)/)
  })

  it('no longer calls the Pro-gated /api/risk-score/trend (whose 402 caused the false states)', () => {
    expect(pageSource).not.toMatch(/useRiskScoreTrend|riskScoreData|riskScoreService|@\/lib\/hooks\/useRiskScore/)
  })

  it('Key Findings counts come from the org-scoped account-findings and aws-resources stats endpoints, keyed by organization', () => {
    expect(pageSource).toMatch(/queryKey: \['account-security-findings-stats', organization\?\.id\][^]*?queryFn: \(\) => accountSecurityFindingsService\.getStats\(\)/)
    expect(pageSource).toMatch(/queryKey: \['aws-resources-stats', organization\?\.id\][^]*?queryFn: \(\) => awsResourcesService\.getStats\(\)/)
    expect(pageSource).toMatch(/findingCounts=\{isDemoActive \? \{ critical: 1, high: 3, medium: 5, low: 0 \} : \(accountFindingStats\?\.bySeverity \?\? null\)\}/)
    expect(pageSource).toMatch(/formatSeverityCounts\(resourceStats\?\.compliance_stats\?\.by_severity\)/)
  })

  it('findings stay in a loading state until the organization is known (no false empty flash)', () => {
    expect(pageSource).toMatch(/const securityFindingsLoading = !isDemoActive && \(!organization\?\.id \|\| accountFindingStatsLoading \|\| resourceStatsLoading\)/)
    expect(pageSource).toMatch(/riskDataLoading=\{securityFindingsLoading\}/)
  })
})
