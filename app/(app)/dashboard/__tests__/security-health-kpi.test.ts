/**
 * Dashboard Security Posture KPI + Security Key Findings sources.
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
import { complianceScanPending, computeSecurityEvidence, computeSecurityHealthKpi, resourceIssueCount, securityFindingsCaption, securityKpiCaption, securityScopeCaption } from '../securityHealthKpi'

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
  it('the Security Posture KPI reads systemIntelligence.components.security, not the overall status', () => {
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

describe('Security Posture face captions', () => {
  const counts = (critical: number, high: number, medium = 0, low = 0) => ({ critical, high, medium, low })
  const base = { isDemoActive: false, isLoading: false, findingsError: false, resourceComplianceError: false, resourceIssues: null }

  it('counts by severity, zeros omitted, plural from the total', () => {
    expect(securityFindingsCaption(counts(1, 5))).toBe('1 critical · 5 high account findings')
    expect(securityFindingsCaption(counts(1, 0))).toBe('1 critical account finding')
    expect(securityFindingsCaption(counts(0, 0, 2, 1))).toBe('2 medium · 1 low account findings')
    expect(securityFindingsCaption(counts(0, 0))).toBeNull()
    expect(securityFindingsCaption(undefined)).toBeNull()
  })

  it('"compliance scan pending" only from scan_completed === false', () => {
    expect(securityKpiCaption({ ...base, findingCounts: counts(1, 5), resourceScanCompleted: false })).toBe('1 critical · 5 high account findings · compliance scan pending')
    expect(securityKpiCaption({ ...base, findingCounts: counts(1, 5), resourceScanCompleted: true })).toBe('1 critical · 5 high account findings')
    expect(securityKpiCaption({ ...base, findingCounts: counts(1, 5), resourceScanCompleted: undefined })).toBe('1 critical · 5 high account findings')
    expect(securityKpiCaption({ ...base, findingCounts: counts(1, 5), resourceScanCompleted: false, resourceComplianceError: true })).toBe('1 critical · 5 high account findings')
  })

  it('loading, demo, failed, or empty data: the caption is omitted', () => {
    expect(securityKpiCaption({ ...base, isLoading: true, findingCounts: counts(1, 5), resourceScanCompleted: false })).toBeNull()
    expect(securityKpiCaption({ ...base, isDemoActive: true, findingCounts: counts(1, 5), resourceScanCompleted: false })).toBeNull()
    expect(securityKpiCaption({ ...base, findingsError: true, findingCounts: undefined, resourceScanCompleted: undefined })).toBeNull()
    expect(securityKpiCaption({ ...base, findingCounts: counts(0, 0), resourceScanCompleted: true })).toBeNull()
  })
})

describe('Security face caption and panel share one compliance-scan rule', () => {
  const counts = { critical: 1, high: 5, medium: 0, low: 0 }
  const evidence = (o: { resourceScanCompleted: boolean | undefined; resourceComplianceError?: boolean; complianceBreakdown?: string | null; complianceCountsReported?: boolean }) =>
    computeSecurityEvidence({
      isDemoActive: false, isLoading: false, findingCounts: counts, findingsError: false, securityComponent: undefined,
      complianceBreakdown: null, complianceCountsReported: true, resourceComplianceError: false, ...o,
    }).resourceCompliance
  const caption = (o: { resourceScanCompleted: boolean | undefined; resourceComplianceError?: boolean }) =>
    securityKpiCaption({ isDemoActive: false, isLoading: false, findingCounts: counts, findingsError: false, resourceIssues: null, resourceComplianceError: false, ...o })

  it.each([
    [false, false],
    [true, false],
    [undefined, false],
    [false, true],
  ] as const)('scan_completed=%s, request failed=%s: the face says "pending" exactly when the panel does', (resourceScanCompleted, resourceComplianceError) => {
    const pending = complianceScanPending(resourceScanCompleted, resourceComplianceError)
    expect(caption({ resourceScanCompleted, resourceComplianceError })!.includes('compliance scan pending')).toBe(pending)
    expect(evidence({ resourceScanCompleted, resourceComplianceError })!.includes('Compliance scan pending')).toBe(pending)
  })

  it('panel wording per state -- a completed scan is never "Not yet evaluated"', () => {
    expect(evidence({ resourceScanCompleted: false })).toBe('Resource compliance: Compliance scan pending')
    expect(evidence({ resourceScanCompleted: false, complianceBreakdown: '2 High' })).toBe('Resource compliance: Compliance scan pending · 2 High')
    expect(evidence({ resourceScanCompleted: true, complianceBreakdown: '2 High · 1 Low' })).toBe('Resource compliance: 2 High · 1 Low')
    expect(evidence({ resourceScanCompleted: true })).toBe('Resource compliance: No open issues in the completed compliance scan')
    expect(evidence({ resourceScanCompleted: true, complianceCountsReported: false })).toBe('Resource compliance: Not available')
    expect(evidence({ resourceScanCompleted: undefined, complianceCountsReported: false })).toBe('Resource compliance: Not yet evaluated')
    expect(evidence({ resourceScanCompleted: false, resourceComplianceError: true })).toBe('Resource compliance: Unavailable')
    for (const s of [true, false]) expect(evidence({ resourceScanCompleted: s })).not.toContain('Not yet evaluated')
  })
})

describe('Security captions name both scopes', () => {
  const counts = (critical: number, high: number, medium = 0, low = 0) => ({ critical, high, medium, low })
  const base = { isDemoActive: false, isLoading: false, findingsError: false, resourceComplianceError: false, resourceScanCompleted: true }

  it('account findings and resource issues, from the loaded counts; plurals', () => {
    expect(securityKpiCaption({ ...base, findingCounts: counts(1, 5), resourceIssues: 3 })).toBe('1 critical · 5 high account findings · 3 resource issues')
    expect(securityKpiCaption({ ...base, findingCounts: counts(0, 1), resourceIssues: 1 })).toBe('1 high account finding · 1 resource issue')
    expect(securityKpiCaption({ ...base, findingCounts: counts(1, 5), resourceIssues: 2, resourceScanCompleted: false })).toBe('1 critical · 5 high account findings · 2 resource issues · compliance scan pending')
  })

  it('zero or unavailable parts are omitted', () => {
    expect(securityKpiCaption({ ...base, findingCounts: counts(1, 5), resourceIssues: 0 })).toBe('1 critical · 5 high account findings')
    expect(securityKpiCaption({ ...base, findingCounts: counts(1, 5), resourceIssues: null })).toBe('1 critical · 5 high account findings')
    expect(securityKpiCaption({ ...base, findingCounts: counts(0, 0), resourceIssues: 4 })).toBe('4 resource issues')
    expect(securityKpiCaption({ ...base, findingsError: true, findingCounts: undefined, resourceIssues: 4 })).toBe('4 resource issues')
    expect(securityKpiCaption({ ...base, findingCounts: counts(0, 0), resourceIssues: 0 })).toBeNull()
  })

  it('the tile caption is the same two scopes, without "compliance scan pending"', () => {
    expect(securityScopeCaption({ findingCounts: counts(1, 5), findingsError: false, resourceIssues: 3 })).toBe('1 critical · 5 high account findings · 3 resource issues')
    expect(securityScopeCaption({ findingCounts: counts(0, 0), findingsError: false, resourceIssues: 0 })).toBeNull()
  })

  it('resourceIssueCount: the sum of the loaded severity counts; null when failed or absent', () => {
    expect(resourceIssueCount({ bySeverity: counts(1, 2, 3, 4), resourceComplianceError: false })).toBe(10)
    expect(resourceIssueCount({ bySeverity: counts(0, 0), resourceComplianceError: false })).toBe(0)
    expect(resourceIssueCount({ bySeverity: counts(1, 2), resourceComplianceError: true })).toBeNull()
    expect(resourceIssueCount({ bySeverity: null, resourceComplianceError: false })).toBeNull()
    expect(resourceIssueCount({ bySeverity: undefined, resourceComplianceError: false })).toBeNull()
  })
})
