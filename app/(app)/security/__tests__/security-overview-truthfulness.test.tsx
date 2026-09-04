/**
 * Coverage for the Security Overview Truthfulness & Findings Presentation fix.
 *
 * Confirmed issues addressed here:
 *
 * 1. Account Security Findings silently fetched only 5 rows
 *    (`useAccountSecurityFindings(5, ...)`) with no count or "view all"
 *    affordance — a real account with more than 5 active findings had no way
 *    to know the panel was incomplete. Fixed by fetching the full list (the
 *    API itself has no server-side cap) and rendering an explicit
 *    "N unresolved findings" count derived from the real list length.
 *
 * 2. Three Top-Security-Gaps / Active-Anomalies / Security-Score-Trend values
 *    (`riskFactors`, `topAnomalies`, `chartData`/trend badge) fell back to
 *    FALLBACK_RISK_FACTORS / FALLBACK_ANOMALIES / a synthetic sine-wave trend
 *    whenever the real query was loading or errored — not gated by demoMode.
 *    A real account with a transient loading window or a failed fetch would
 *    render fabricated gaps ("Public Access: 78 Warning"), fabricated
 *    anomalies ("Unusual IAM activity detected"), and a fabricated "+5 pts
 *    this month" trend badge. Fixed by gating all three behind demoMode, same
 *    pattern already used for `score`/`findings`/`displayFrameworks`.
 *
 * 3. Four of the five Top Security Gaps ("Public Access", "Resource
 *    Management", "Encryption", "Backup Coverage") linked to
 *    /security/public-access, /security/resources, /security/encryption,
 *    /security/backup — none of which exist as routes (confirmed via
 *    `find app/(app)/security`). Fixed by pointing them at the real,
 *    existing /infrastructure page over the same underlying resource data.
 *    "Compliance" already correctly points at /security#findings from a
 *    prior fix and is unchanged here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import SecurityPage from '../page'

let demoModeValue = false
vi.mock('@/lib/services/demo-mode.service', () => ({
  demoModeService: { isEnabled: () => demoModeValue },
}))

vi.mock('@/lib/hooks/useComplianceFrameworks', () => ({
  useComplianceFrameworks: () => ({ frameworks: [], loading: false }),
}))

const mockUseCurrentRiskScore = vi.fn()
const mockUseRiskScoreTrend = vi.fn()
vi.mock('@/lib/hooks/useRiskScore', () => ({
  useCurrentRiskScore: () => mockUseCurrentRiskScore(),
  useRiskScoreTrend: () => mockUseRiskScoreTrend(),
}))

const mockUseAccountSecurityFindings = vi.fn()
vi.mock('@/lib/hooks/useAccountSecurityFindings', () => ({
  useAccountSecurityFindings: (limit?: number, enabled?: boolean) => mockUseAccountSecurityFindings(limit, enabled),
}))

const mockGetAnomalies = vi.fn()
const mockGetAnomalyStats = vi.fn()
vi.mock('@/lib/services/anomaly.service', () => ({
  anomalyService: {
    getAnomalies: (status?: string) => mockGetAnomalies(status),
    getStats: () => mockGetAnomalyStats(),
    acknowledge: vi.fn(),
    triggerScan: vi.fn().mockResolvedValue({}),
  },
}))

vi.mock('@/lib/services/aws-services.service', () => ({
  default: { discoverServices: vi.fn() },
}))

vi.mock('@/lib/services/account-security-findings.service', () => ({
  accountSecurityFindingsService: {
    acknowledge: vi.fn(),
    dismiss: vi.fn(),
    acceptRisk: vi.fn(),
  },
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

function makeFinding(overrides: Record<string, unknown> = {}) {
  return {
    id: overrides.id ?? 'f-1',
    organization_id: 'org-1',
    finding_key: overrides.id ?? 'f-1',
    category: 'networking',
    severity: 'high',
    title: overrides.title ?? 'Security group allows SSH from anywhere',
    recommendation: 'Restrict access',
    resource_identifier: 'sg-123',
    region: 'us-east-1',
    status: 'active',
    detected_at: new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
    resolved_at: null,
    disposition: null,
    disposition_actor_id: null,
    disposition_at: null,
    disposition_note: null,
    evidence: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    derived_status: 'active',
    framework_mapping: null,
    ...overrides,
  }
}

function renderSecurityPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <SecurityPage />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  demoModeValue = false
  mockUseCurrentRiskScore.mockReturnValue({ data: undefined, isLoading: false })
  mockUseRiskScoreTrend.mockReturnValue({ data: undefined, isLoading: false })
  mockUseAccountSecurityFindings.mockReturnValue({ data: [], isLoading: false })
  mockGetAnomalies.mockResolvedValue({ anomalies: [] })
  mockGetAnomalyStats.mockResolvedValue({ active: 0 })
})

describe('Account Security Findings — no silent truncation', () => {
  it('fetches the findings list with no hardcoded limit', () => {
    renderSecurityPage()
    // First call arg is the `limit` passed to the hook — must not be a hardcoded 5.
    expect(mockUseAccountSecurityFindings).toHaveBeenCalledWith(undefined, true)
  })

  it('shows an explicit "N unresolved findings" count matching the real list length (6, not capped at 5)', () => {
    const sixFindings = Array.from({ length: 6 }, (_, i) => makeFinding({ id: `f-${i}`, title: `Finding ${i}` }))
    mockUseAccountSecurityFindings.mockReturnValue({ data: sixFindings, isLoading: false })

    renderSecurityPage()

    expect(screen.getByText('6 unresolved findings')).toBeInTheDocument()
    // All 6 titles are actually rendered — nothing silently sliced off.
    for (let i = 0; i < 6; i++) {
      expect(screen.getByText(`Finding ${i}`)).toBeInTheDocument()
    }
  })

  it('shows singular "1 unresolved finding" for exactly one finding', () => {
    mockUseAccountSecurityFindings.mockReturnValue({ data: [makeFinding()], isLoading: false })
    renderSecurityPage()
    expect(screen.getByText('1 unresolved finding')).toBeInTheDocument()
  })

  it('shows "No unresolved findings" for an empty real-mode list, not a blank/absent count', () => {
    mockUseAccountSecurityFindings.mockReturnValue({ data: [], isLoading: false })
    renderSecurityPage()
    expect(screen.getByText('No unresolved findings')).toBeInTheDocument()
  })

  it('does not show a count while the findings query is loading', () => {
    mockUseAccountSecurityFindings.mockReturnValue({ data: undefined, isLoading: true })
    renderSecurityPage()
    expect(screen.queryByText(/unresolved finding/)).not.toBeInTheDocument()
  })

  it('demo mode still reports an accurate count for the fallback findings set', () => {
    demoModeValue = true
    renderSecurityPage()
    expect(screen.getByText('3 unresolved findings')).toBeInTheDocument()
  })
})

describe('Top Security Gaps — real-mode fallback leakage', () => {
  it('real mode with no risk score yet renders an honest "Not yet evaluated", never the fabricated fallback gaps', () => {
    mockUseCurrentRiskScore.mockReturnValue({ data: undefined, isLoading: false })
    renderSecurityPage()

    // "Not yet evaluated" also legitimately appears in the separate Compliance
    // Status KPI card (frameworks aren't mocked with data either) — scope to
    // the Top Security Gaps panel specifically so the two don't collide.
    const gapsPanel = screen.getByText('Top Security Gaps').closest('div')!
    expect(within(gapsPanel).getByText('Not yet evaluated')).toBeInTheDocument()
    expect(within(gapsPanel).queryByText('Public access exposed — remediate now')).not.toBeInTheDocument()
    expect(within(gapsPanel).queryByText('Resource management gaps detected')).not.toBeInTheDocument()
    expect(within(gapsPanel).queryByText('Encryption coverage incomplete')).not.toBeInTheDocument()
    expect(within(gapsPanel).queryByText('Backup coverage below threshold')).not.toBeInTheDocument()
  })

  it('real mode while the risk score query is loading shows a spinner, not fabricated gaps', () => {
    mockUseCurrentRiskScore.mockReturnValue({ data: undefined, isLoading: true })
    renderSecurityPage()

    const gapsPanel = screen.getByText('Top Security Gaps').closest('div')!
    expect(within(gapsPanel).queryByText('Public access exposed — remediate now')).not.toBeInTheDocument()
    expect(within(gapsPanel).queryByText('Not yet evaluated')).not.toBeInTheDocument()
    expect(within(gapsPanel).queryByText('All security checks passing')).not.toBeInTheDocument()
  })

  it('real mode with real risk factors renders accurate gap labels pointing at /infrastructure (not the dead /security/* routes)', () => {
    mockUseCurrentRiskScore.mockReturnValue({
      data: {
        score: 58,
        factors: { encryption: 60, publicAccess: 65, backup: 90, compliance: 70, resourceManagement: 95 },
        isPreliminary: false,
      },
      isLoading: false,
    })
    renderSecurityPage()

    const encryptionGap = screen.getByText('Encryption coverage incomplete')
    const encryptionLink = encryptionGap.closest('div')!.querySelector('a')!
    expect(encryptionLink).toHaveAttribute('href', '/infrastructure')

    const publicAccessGap = screen.getByText('Public access exposed — remediate now')
    const publicAccessLink = publicAccessGap.closest('div')!.querySelector('a')!
    expect(publicAccessLink).toHaveAttribute('href', '/infrastructure')

    const complianceGap = screen.getByText('Unresolved security findings')
    const complianceLink = complianceGap.closest('div')!.querySelector('a')!
    expect(complianceLink).toHaveAttribute('href', '/security#findings')

    // resourceManagement (95) and backup (90) both score >= 80 ("Pass"), so
    // they must not appear as gaps at all.
    expect(screen.queryByText('Resource management gaps detected')).not.toBeInTheDocument()
    expect(screen.queryByText('Backup coverage below threshold')).not.toBeInTheDocument()
  })

  it('real mode with all factors passing shows "All security checks passing", never the fallback set', () => {
    mockUseCurrentRiskScore.mockReturnValue({
      data: {
        score: 96,
        factors: { encryption: 100, publicAccess: 100, backup: 100, compliance: 100, resourceManagement: 100 },
        isPreliminary: false,
      },
      isLoading: false,
    })
    renderSecurityPage()

    expect(screen.getByText('All security checks passing')).toBeInTheDocument()
    expect(screen.queryByText('Public access exposed — remediate now')).not.toBeInTheDocument()
  })

  it('demo mode still shows the fallback gap set unchanged', () => {
    demoModeValue = true
    renderSecurityPage()
    expect(screen.getByText('Public access exposed — remediate now')).toBeInTheDocument()
    expect(screen.getByText('Resource management gaps detected')).toBeInTheDocument()
  })
})

describe('Active Anomalies — real-mode fallback leakage', () => {
  it('real mode with a malformed/empty anomaly response renders the honest empty state, never FALLBACK_ANOMALIES', async () => {
    // No `anomalies` field at all — the shape a broken/errored response would have.
    mockGetAnomalies.mockResolvedValue({})
    renderSecurityPage()

    expect(await screen.findByText('No active anomalies · System is secure')).toBeInTheDocument()
    // FALLBACK_ANOMALIES' resource names must not leak into real mode.
    expect(screen.queryByText(/production-worker/)).not.toBeInTheDocument()
    expect(screen.queryByText(/old-backup-bucket/)).not.toBeInTheDocument()
    expect(screen.queryByText(/auth-service/)).not.toBeInTheDocument()
  })

  it('demo mode still shows the fallback anomalies unchanged', async () => {
    demoModeValue = true
    renderSecurityPage()
    expect(await screen.findByText(/production-worker/)).toBeInTheDocument()
  })
})

describe('Security Score Trend — real-mode fallback leakage', () => {
  it('real mode with no trend data yet hides the trend badge, never a fabricated "+5 pts this month"', () => {
    mockUseRiskScoreTrend.mockReturnValue({ data: undefined, isLoading: false })
    renderSecurityPage()
    expect(screen.queryByText(/pts this month/)).not.toBeInTheDocument()
  })

  it('real mode with real trend data shows the real trend badge', () => {
    mockUseRiskScoreTrend.mockReturnValue({
      data: {
        current: {
          score: 58,
          grade: 'D',
          color: '',
          factors: { encryption: 60, publicAccess: 65, backup: 90, compliance: 70, resourceManagement: 95 },
          complianceIssueCounts: { critical: 0, high: 0, medium: 0, low: 0 },
          accountFindingsCounts: { critical: 0, high: 0, medium: 0, low: 0 },
          resourceComplianceCounts: { critical: 0, high: 0, medium: 0, low: 0 },
          frameworksAtRisk: [],
          isPreliminary: false,
        },
        trend: 'improving',
        trendPercentage: 12,
        history: [{ date: new Date().toISOString(), score: 58 }],
        period: { start: '', end: '', days: 30 },
      },
      isLoading: false,
    })
    renderSecurityPage()
    expect(screen.getByText('+12 pts this month')).toBeInTheDocument()
  })

  it('demo mode still shows a trend badge unchanged', () => {
    demoModeValue = true
    renderSecurityPage()
    expect(screen.getByText(/pts this month/)).toBeInTheDocument()
  })
})
