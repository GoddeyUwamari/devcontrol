'use client'

import { useState, useRef, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid,
} from 'recharts'
import {
  Search, Download, TrendingUp, TrendingDown, Minus,
  Sparkles, Loader2, X, Zap, Lock,
  CreditCard, ChartLine, Leaf, Shield, SquareCheck,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { usePlan } from '@/lib/hooks/use-plan'
import { useAuth } from '@/lib/contexts/auth-context'
import { useCostSummary, useUtcDay } from '@/lib/hooks/useCostSummary'
import { costRecommendationsService, type CostAnalysisRun } from '@/lib/services/cost-recommendations.service'
import { awsResourcesService } from '@/lib/services/aws-resources.service'
import awsAccountsService from '@/lib/services/aws-accounts.service'
import awsServicesService from '@/lib/services/aws-services.service'
import { ConnectAwsHeaderButton, HeaderActionLoading, NotConnectedCard, NotConnectedLoading, UnmeasuredValue } from '@/components/aws/not-connected'
import { pickLatestAnalysis } from '../cost-optimization/costOptimizationStatus'
import { deriveCostScanState, type CostScanState } from '../cost-optimization/costScanState'
import { LAST_ANALYSIS, LAST_ANALYSIS_SOURCE } from '../cost-optimization/costOptimizationCopy'
import { nlQueryService, NLQueryResult, NLQueryOutcome } from '@/lib/services/nl-query.service'
import { useDemoMode } from '@/components/demo/demo-mode-toggle'
import { useSalesDemo } from '@/lib/demo/sales-demo-data'
import Link from 'next/link'
import type { ContextSection, CostRecommendation, CostSpendEvidence } from '@/lib/types'
import { formatSavingsCurrency } from '@/lib/utils'
import { PAGE_SUBTITLE_CLASS, PAGE_TITLE_CLASS } from '@/components/ui/typography'
import { CHART_TICK, CHART_TOOLTIP } from '@/lib/chart-theme'
import { DEFAULT_PRICE_SUFFIX, countSubCentFigures, formatRecommendationSavings, isDefaultPriceEstimate } from '@/lib/savings-basis'
import { describeMonthOverMonth, describeSpend, MOM_BASIS_LABEL, noFinalDayThisMonth, previousMonthLine, roundCents } from './cost-display'
import { isNotReportedYet, isStillUpdating, NOT_REPORTED_TOOLTIP, STILL_UPDATING_LEGEND, TREND_TOTALS_NOTE, unreportedTrendNote } from '@/lib/cost-trend-basis'
import { costsTrendChartData, costsTrendTooltipLines, type CostsTrendRow } from './trend-chart-data'
import {
  acrossCategories, activeChecks, costDrivers, coverageRows, DEFAULT_TREND_RANGE, describeSavingsTile, formatDriverAmount, lastAnalysisParts, opportunityFigure, PAGE_SUBTITLE,
  rankByDisplayedSavings, servicesLine, topDrivers, TREND_RANGES, trendSummary, trendWindow, windowDatesLabel, type CostTrendPointView, type TrendRangeLabel,
} from './cost-intelligence'
import { whyLine } from './why-evidence'
import { CostDriversCard } from './CostDriversCard'
import { OPPORTUNITY_LIMIT, OpportunitiesCard, type OpportunityRow } from './OpportunitiesCard'
import { PageCoverageCard } from './PageCoverageCard'
import { DEMO_FINDING_COUNT, DEMO_GROWTH_PERCENT, DEMO_HOME_REGION, DEMO_STATS, demoAnalysisAt, demoMtdSpend, demoRecommendations, demoTrendPoints } from './demo-data'

/** The Spend Trend series (founder spec item 8): pink fill and line. */
const TREND_LINE = '#BE185D'
const TREND_FILL = '#FBCFE8'
/** The lighter stroke of the day AWS Cost Explorer is still updating. */
const UPDATING_STROKE = '#94A3B8'

/** The Spend Trend tooltip: no amount for a day not reported yet, "so far" for one still updating. */
function SpendTrendTooltip({ active, payload, label, rows }: { active?: boolean; payload?: Array<{ payload?: CostsTrendRow }>; label?: string; rows: CostsTrendRow[] }) {
  if (!active) return null
  // A gap has no drawn value; fall back to the row by its label.
  const row = payload?.find((entry) => entry?.payload)?.payload ?? rows.find((r) => r.date === label)
  const lines = costsTrendTooltipLines(row, 'day')
  if (lines.length === 0) return null
  return (
    <div style={CHART_TOOLTIP.contentStyle} data-testid="spend-trend-tooltip">
      <p style={{ ...CHART_TOOLTIP.labelStyle, margin: 0 }}>{label}</p>
      {lines.map((line) => <p key={line} className="text-meta text-ink-body" style={{ margin: '4px 0 0' }}>{line}</p>)}
    </div>
  )
}

/**
 * The Ask card's title (mock-match item 6). Not the mock's "this account's spend": ruling Q12 words spend as what
 * the connected account can see, and Ask AI also answers about resources and deployments.
 */
const ASK_TITLE = 'Ask about the connected AWS account'

/** Ask AI result header: says whether the question was answered, found nothing, or could not be answered. */
const NL_OUTCOME_LABEL: Record<NLQueryOutcome, (rows: number) => string> = {
  answered: rows => (rows > 0 ? `${rows} result${rows !== 1 ? 's' : ''}` : 'Answered'),
  no_results: () => 'No matches',
  unavailable: () => 'Data not available',
  not_supported: () => "Ask AI can't answer this",
  error: () => 'Could not be retrieved',
}

/** Demo-only month-to-date section, so the demo spend tile reads like a real one (Q14). */
function demoSpendSection(amount: number): ContextSection<CostSpendEvidence> {
  return {
    state: 'available', source: 'Demo data', provenance: 'actual', asOf: null, coverage: null, reason: null,
    data: { amount, basis: 'billed_month_to_date', lastDayInProgress: false },
  }
}

export default function CostsPage() {
  const { isPro } = usePlan()
  const [selectedRange, setSelectedRange] = useState<TrendRangeLabel>(DEFAULT_TREND_RANGE)
  const [nlQuery, setNlQuery] = useState('')
  const [nlResult, setNlResult] = useState<NLQueryResult | null>(null)
  const [nlLoading, setNlLoading] = useState(false)
  const [nlError, setNlError] = useState<string | null>(null)
  const [nlUpgradeBanner, setNlUpgradeBanner] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const demoMode = useDemoMode()
  const salesDemoMode = useSalesDemo((state) => state.enabled)
  const isDemoActive = demoMode || salesDemoMode

  const range = TREND_RANGES.find(r => r.label === selectedRange) ?? TREND_RANGES[1]

  // Source A: month-to-date spend and the month-over-month comparison as evidence
  // sections (actual Cost Explorer / inventory estimate / unavailable / error),
  // the same cost path AI Reports and Ask AI use. A missing figure is a state, never 0.
  // Keyed by organization and UTC day (DAY1-D10), the Dashboard's entry.
  const { organization } = useAuth()
  const orgId = organization?.id
  const utcDay = useUtcDay()
  const { data: costSummary, isLoading: costSummaryLoading, isError: costSummaryError } = useCostSummary(orgId, {
    // AWS cost data changes slowly — long staleTime/gcTime avoids re-hitting Cost Explorer
    // (billed per API call) on every render/tab-switch. Matches dashboard/page.tsx.
    staleTime: 4 * 60 * 60 * 1000, gcTime: 24 * 60 * 60 * 1000,
    refetchOnWindowFocus: false, refetchOnMount: false, retry: false,
    enabled: !isDemoActive,
  })

  // Source A: daily cost trend with each point's report state and per-service breakdown.
  // The key is this page's own: /costs/efficiency caches a failed request under
  // ['cost-trend', '6mo'] as [], which must never read as "no data" here.
  const { data: costTrend = [], isLoading: costTrendLoading, isError: costTrendError } = useQuery<CostTrendPointView[]>({
    queryKey: ['costs-page', 'cost-trend', range.range, orgId ?? null, utcDay],
    queryFn: async () => {
      const token = document.cookie.split(';').find(c => c.trim().startsWith('auth-token='))?.split('=')[1] || localStorage.getItem('accessToken')
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080'}/api/platform/costs/trend?range=${range.range}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: 'include',
      })
      // A failed request is an error, not an empty (zero-spend) series.
      if (!res.ok) throw new Error('The AWS Cost Explorer trend could not be retrieved')
      const json = await res.json()
      return json.data ?? []
    },
    staleTime: 4 * 60 * 60 * 1000, gcTime: 24 * 60 * 60 * 1000,
    refetchOnWindowFocus: false, refetchOnMount: false, retry: false,
    enabled: !isDemoActive && !!orgId,
  })

  // Source C: cost_recommendations — same service Cost Optimization page uses.
  const { data: recStats, isLoading: recStatsLoading, isError: recStatsError } = useQuery({
    queryKey: ['cost-recommendations-stats'],
    queryFn: costRecommendationsService.getStats,
    staleTime: 5 * 60 * 1000,
    enabled: !isDemoActive,
  })

  // Every cost analysis, manual and scheduled (the same list and cache entry as Cost Optimization's
  // Last analysis line). A discovery job is read only for an organization with no run row at all.
  const { data: analysisRuns, isLoading: analysisRunsLoading, isError: analysisRunsError } = useQuery({
    queryKey: ['cost-analysis-runs', 'all', 5],
    queryFn: () => costRecommendationsService.getAnalysisRuns(5, 'all'),
    staleTime: 60_000,
    retry: false,
    enabled: !isDemoActive,
  })
  const { data: discoveryJobs, isLoading: discoveryJobsLoading, isError: discoveryJobsError } = useQuery({
    queryKey: ['discovery-jobs', 5],
    queryFn: () => awsResourcesService.getDiscoveryJobs(5),
    staleTime: 60_000,
    retry: false,
    enabled: !isDemoActive,
  })

  // PR2 empty states: the server's connection state, the same query (and cache entry) as Cost Optimization.
  // Not connected only when the server says so; a failed or ambiguous check is today's page, unchanged.
  const { data: awsAccounts, isError: accountsError } = useQuery({
    queryKey: ['aws-accounts'],
    queryFn: awsAccountsService.getAccountsAndConnection,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: !isDemoActive,
  })
  const notConnected = !isDemoActive && awsAccounts?.connection === 'not_connected'
  const connectionLoading = !isDemoActive && awsAccounts === undefined && !accountsError

  const { data: activeRecs = [], isLoading: activeRecsLoading, isError: activeRecsError } = useQuery<CostRecommendation[]>({
    queryKey: ['cost-recommendations-active'],
    queryFn: () => costRecommendationsService.getAll({ status: 'ACTIVE' }),
    staleTime: 5 * 60 * 1000,
    enabled: !isDemoActive,
  })

  // The Optimization Rule Registry (spec item 6): the active checks and their service categories, never literals.
  // Code-defined metadata, not account data, so the demo reads it too. Same key as Cost Optimization.
  const { data: ruleCatalog, isLoading: rulesLoading, isError: rulesError } = useQuery({
    queryKey: ['optimization-rules'],
    queryFn: costRecommendationsService.getOptimizationRules,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  })

  // Where the cost checks run (What this page covers): the home region from the coverage response.
  const { data: servicesCoverage, isLoading: coverageLoading, isError: coverageError } = useQuery({
    queryKey: ['services-coverage'],
    queryFn: () => awsServicesService.getCoverage(),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
    enabled: !isDemoActive && !notConnected && !connectionLoading,
  })

  const handleNlQuery = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!nlQuery.trim()) return
    setNlLoading(true); setNlError(null); setNlResult(null); setNlUpgradeBanner(false)
    try {
      const result = await nlQueryService.executeQuery(nlQuery)
      setNlResult(result)
    } catch (err: any) {
      if (err?.status === 402) setNlUpgradeBanner(true)
      else setNlError(err?.message && err.message !== 'Failed to execute query'
        ? err.message
        : 'Could not process query. Try: "What is my AWS spend this month?" or "Show running EC2 instances"')
    } finally {
      setNlLoading(false)
    }
  }

  // ── Safeguard 1: ONE set of days for the chart, the cost drivers donut and its total label ──
  // Demo mode (ruling D4): the demo series, findings and last analysis are relative to today (UTC), never fixed dates.
  const demo = useMemo(() => {
    if (!isDemoActive) return null
    const points = demoTrendPoints(utcDay)
    const analysisAt = demoAnalysisAt(Date.now())
    return { points, spendSection: demoSpendSection(demoMtdSpend(points, utcDay)), analysisAt, recommendations: demoRecommendations(analysisAt) }
  }, [isDemoActive, utcDay])
  const trendPoints: CostTrendPointView[] = demo ? demo.points : costTrend
  const windowPoints = useMemo(() => trendWindow(trendPoints, range.days), [trendPoints, range.days])
  // UTC calendar-date labels; a day Cost Explorer has not reported yet is a gap, never $0 (DAY1-D14, DAY1-D15).
  const chartData = useMemo(() => costsTrendChartData(windowPoints), [windowPoints])
  const drivers = useMemo(() => costDrivers(windowPoints), [windowPoints])
  const windowDates = windowDatesLabel(windowPoints)
  const trendNotReportedNote = isDemoActive ? null : unreportedTrendNote(windowPoints, 'day')
  const trendHasUpdating = windowPoints.some(isStillUpdating)
  // Mock-match item 5: the summary line is computed from the chart's window (the days it draws), so it can never
  // cover other days than the chart or the cost drivers; Top drivers from the cost drivers of the same window.
  const summaryLine = useMemo(() => trendSummary(windowPoints), [windowPoints])
  const summaryTopDrivers = topDrivers(drivers)
  // Whether the trend has real Cost Explorer points to show; an empty or failed series is never drawn as $0.
  const hasTrendData = isDemoActive || (!costTrendLoading && !costTrendError && costTrend.length > 0)

  const spend = isDemoActive
    ? { ...describeSpend(demo?.spendSection, { isLoading: false, isError: false }), sub: 'Demo data' }
    : describeSpend(costSummary?.spend, { isLoading: costSummaryLoading, isError: costSummaryError })
  // Month-over-month is FIXED to this month's finished days vs the same days last month (the
  // backend's comparison over a 90-day trend, costSummary.monthOverMonth), independent of the
  // chart range. Shown in a neutral colour whichever way it moves (founder ruling Q3).
  const mom = isDemoActive
    ? { value: `+${DEMO_GROWTH_PERCENT}%`, sub: 'Spend up vs the same days last month · demo data', changePercent: DEMO_GROWTH_PERCENT, direction: 'up' as const, includesToday: false }
    : describeMonthOverMonth(costSummary?.monthOverMonth, { isLoading: costSummaryLoading, isError: costSummaryError }, { noFinishedDay: noFinalDayThisMonth(costSummary?.spend) })

  const savingsMissing = !isDemoActive && (recStatsLoading || recStatsError || !recStats)
  const stats = isDemoActive ? DEMO_STATS : recStats
  const activeRecsCount = stats?.activeRecommendations ?? 0
  // Zero recommendations is only a measured result once the latest analysis
  // (scheduled or manual) has completed.
  const latestAnalysis = pickLatestAnalysis({ latestDiscoveryJob: discoveryJobs?.[0], latestAnalysisRun: analysisRuns?.[0] })
  // Fix round 1, N-4: a partial run (the API's status says 'failed', run_state says 'partial') finished the checks
  // that ran, so zero open findings is a result for those checks: "None found in the checks that ran", like the
  // Last analysis line ("N of M checks ran · 0 found"). The run is the latest analysis only when it was picked
  // over the discovery job ('manual' is pickLatestAnalysis's label for a run row, manual or scheduled).
  const latestRunPartial = latestAnalysis?.source === 'manual' && analysisRuns?.[0]?.run_state === 'partial'
  const zeroRecsState: null | 'loading' | 'unknown' | 'in_progress' | 'failed' | 'not_evaluated' =
    isDemoActive || savingsMissing || activeRecsCount > 0 ? null
      : analysisRunsLoading || discoveryJobsLoading ? 'loading'
      : analysisRunsError || discoveryJobsError ? 'unknown'
      : !latestAnalysis ? 'not_evaluated'
      : latestAnalysis.status === 'running' ? 'in_progress'
      : latestAnalysis.status === 'failed' && !latestRunPartial ? 'failed'
      : null
  const recsUnavailable = savingsMissing || zeroRecsState !== null
  const recsUnavailableSub = !isDemoActive && recStatsLoading ? 'Loading…'
    : savingsMissing ? 'Could not be retrieved'
    : zeroRecsState === 'loading' ? 'Loading…'
    : zeroRecsState === 'unknown' ? 'Could not be retrieved'
    : zeroRecsState === 'in_progress' ? 'Cost analysis in progress'
    : zeroRecsState === 'failed' ? 'Latest cost analysis did not complete'
    : stats && stats.totalPotentialSavings === null ? 'Could not be retrieved'
    : 'No cost analysis has run yet'
  // Founder ruling Q2: Cost Optimization's wording, firm and upper-bound figures apart, grey under $1/mo, never "$0/mo".
  // A stats response with no total is "—" with the unavailable line, like a failed fetch ("Never show $0", S2).
  // Review N-5: open rows that read "Less than $0.01/mo" are named in the "No dollar estimate" sentence (never totalled).
  const describedTile = recsUnavailable || !stats ? null : describeSavingsTile(stats, { partialRun: !isDemoActive && latestRunPartial, openSubCent: demo ? 0 : countSubCentFigures(activeRecs) })
  const savingsTile = describedTile?.kind === 'unavailable' ? null : describedTile
  const savingsStrong = savingsTile?.kind === 'firm' && savingsTile.strong

  const checks = activeChecks(ruleCatalog)

  // The scan state Cost Optimization's Last analysis line reads (runs first; jobs only with no run row).
  const scan: CostScanState = deriveCostScanState({
    connection: { data: awsAccounts?.connection, isError: accountsError },
    runs: { data: analysisRuns, isError: analysisRunsError },
    jobs: { data: discoveryJobs, isError: discoveryJobsError },
    isAnalyzing: false,
  })
  const latestRun: CostAnalysisRun | undefined = analysisRuns?.[0]

  // Opportunities (spec item 11): the top OPPORTUNITY_LIMIT by the savings figure each card shows (N-7), each with
  // its "Why:" line. Each figure is labelled by its savings_basis: "$X/mo", "Up to $X/mo" (a ceiling), or
  // "No dollar estimate".
  const opportunityRows: OpportunityRow[] = rankByDisplayedSavings(demo ? demo.recommendations : activeRecs)
    .slice(0, OPPORTUNITY_LIMIT)
    .map(r => {
      // Green only for a firm figure of $1/mo or more as displayed; an upper bound or a small figure is grey (ruling Q2).
      const figure = opportunityFigure(r)
      return {
        id: r.id,
        title: r.issue || r.resourceName || 'Cost optimization available',
        savingsLabel: `${formatRecommendationSavings(r, formatSavingsCurrency)}${isDefaultPriceEstimate(r) ? ` ${DEFAULT_PRICE_SUFFIX}` : ''}`,
        strong: figure.strong,
        basisNote: figure.note,
        severity: r.severity,
        why: whyLine(r),
      }
    })

  // What this page covers (spec item 12). The demo feeds the same rules with demo signals.
  const pageCoverage = isDemoActive
    ? coverageRows({
        spend: { section: demo?.spendSection, isLoading: false, isError: false },
        trend: { isLoading: false, isError: false },
        scan: { key: 'completed_open', source: 'scheduled', completedAt: null, errorMessage: null, counts: null, failedChecks: 0, uncheckedResources: 0 },
        runs: ruleCatalog && demo ? [demoRun(ruleCatalog.rules.filter((rule) => rule.status === 'implemented').map((rule) => rule.id), demo.analysisAt)] : undefined,
        catalog: { data: ruleCatalog, isError: rulesError },
        coverage: { homeRegion: DEMO_HOME_REGION, multiRegion: null, isLoading: false, isError: false },
      })
    : coverageRows({
        spend: { section: costSummary?.spend, isLoading: costSummaryLoading, isError: costSummaryError },
        trend: { isLoading: costTrendLoading, isError: costTrendError },
        scan,
        runs: analysisRuns,
        catalog: { data: ruleCatalog, isError: rulesError },
        coverage: { homeRegion: servicesCoverage?.account?.home_region ?? null, multiRegion: servicesCoverage?.multi_region, isLoading: coverageLoading, isError: coverageError },
      })

  const handleExportCSV = () => {
    // The export is exactly the days the page shows (fix round 1, N-2): the same window as the chart, the
    // cost drivers and their dates (safeguard 1). Real per-day/per-category numbers, or the demo's own points.
    const rows: (string | number)[][] = []
    // The real rows are trend totals: say so in the file, which travels without the page.
    if (!isDemoActive) rows.push([`AWS Cost Explorer daily totals · ${TREND_TOTALS_NOTE}`])
    rows.push(['Date', 'Service', 'Cost'])
    // Cents, not whole dollars: a sub-dollar day must not export as 0.
    for (const p of windowPoints) {
      // A day Cost Explorer has not reported yet has no amounts, never $0.
      if (isNotReportedYet(p)) {
        rows.push([p.date, 'Total', NOT_REPORTED_TOOLTIP])
        continue
      }
      rows.push([p.date, 'Compute (EC2, Lambda, ECS)', roundCents(p.compute)])
      rows.push([p.date, 'Storage (S3, EBS)',          roundCents(p.storage)])
      rows.push([p.date, 'Database (RDS, DynamoDB)',   roundCents(p.database)])
      rows.push([p.date, 'Network (Data Transfer)',    roundCents(p.network)])
      rows.push([p.date, 'Other Services',              roundCents(p.other)])
      rows.push([p.date, isStillUpdating(p) ? 'Total (still updating; AWS Cost Explorer may still add charges)' : 'Total', roundCents(p.total)])
    }
    // Quote every field: the service names contain commas.
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `cost-overview-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Header status (mock-match item 3): "Account connected" only when the server's connection state says so; the
  // "Cost data as of" date as today (not in demo, not without an account, not while the connection check loads).
  const accountConnected = !isDemoActive && awsAccounts?.connection === 'connected'
  const costDataAsOf = !isDemoActive && costSummary?.spend.asOf && !notConnected && !connectionLoading
    ? new Date(costSummary.spend.asOf).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : null

  // ── KPI row (spec item 6): shown once. Every tile keeps its link; missing or loading is "—" (safeguard 5). ──
  const neutral = 'text-ink-muted'
  /** The tile value size for anything that isn't a headline figure (ruling Q2, SF-1). */
  const SECONDARY_VALUE_SIZE = 'text-ui sm:text-section'
  const kpiTiles: {
    key: string; label: string; value: string; lines: string[]; valueClass: string; href: string; accent: string
    TrendIcon?: typeof Minus; previous?: string | null; basis?: string; names?: string; valueSize?: string
    /** Shown instead of `label` where the tile is too narrow for its longest word (no mid-word wrapping, founder D7). */
    shortLabel?: string
    /** The mock's icon badge in the tile header (decorative): the icon and its tint (background + icon ink). */
    Icon: typeof Minus; badge: string
    /** The visible text link at the foot of the tile, in place of the › (mock-match item 2). The whole tile stays the link. */
    cta?: string
    /** Grid span: full width on a phone ('phone'), or across both columns below lg ('both'), as in the mock's phone board. */
    span?: 'phone' | 'both'
  }[] = [
    {
      key: 'mtd', label: spend.label, value: spend.value, lines: [spend.sub],
      // While no day of this month has finished: last month's total (the Dashboard's line).
      previous: isDemoActive ? null : previousMonthLine(costSummary?.spend),
      valueClass: 'text-slate-900', href: '/invoices', accent: '',
      Icon: CreditCard, badge: 'bg-indigo-50 text-indigo-600', span: 'phone',
    },
    {
      key: 'momchange', label: 'Month-over-Month Change', value: mom.value, lines: [mom.sub],
      TrendIcon: mom.direction === 'up' ? TrendingUp : mom.direction === 'down' ? TrendingDown : Minus,
      // Safeguard 2: the % compares finished days only, not the month to date, and not the selected range.
      basis: `${MOM_BASIS_LABEL} · ${TREND_TOTALS_NOTE}`,
      valueClass: 'text-slate-900', href: '/invoices', accent: '',
      // Neutral whichever way it moves (ruling Q3): a slate badge, never green, amber or red.
      Icon: ChartLine, badge: 'bg-slate-100 text-slate-600', span: 'phone',
    },
    {
      key: 'savings', label: 'Savings Opportunity', shortLabel: 'Savings',
      value: savingsTile?.value ?? '—',
      lines: savingsTile?.lines ?? [recsUnavailableSub],
      // Ruling Q2 / SF-1: green and full KPI size only for a firm figure of $1/mo or more (as displayed, N-3). A
      // smaller firm figure and the words ("Up to … · upper bound only", "No dollar estimate", "None found") are grey
      // (slate-600, text-ink-muted) at the smaller secondary size.
      valueClass: savingsStrong ? 'text-ink-success' : neutral,
      valueSize: savingsTile && !savingsStrong ? SECONDARY_VALUE_SIZE : undefined,
      // No AWS account, or a figure under $1/mo or only an upper bound: no green savings accent (PR2, ruling Q2).
      href: '/cost-optimization', accent: !notConnected && savingsStrong ? 'border-t-[3px] border-t-green-500' : '',
      Icon: Leaf, badge: 'bg-green-50 text-green-700', cta: 'Review savings',
    },
    {
      key: 'activerecs', label: 'Active Findings',
      value: recsUnavailable ? '—' : `${activeRecsCount}`,
      lines: [recsUnavailable ? recsUnavailableSub : activeRecsCount > 0 ? 'Ready to review' : 'No open recommendations'],
      valueClass: 'text-slate-900', href: '/cost-optimization', accent: '',
      Icon: Shield, badge: 'bg-orange-50 text-orange-700', cta: !recsUnavailable && activeRecsCount === 1 ? 'See finding' : 'See findings',
    },
    {
      key: 'checks', label: 'Cost checks',
      value: checks ? `${checks.count}` : '—',
      lines: [checks ? acrossCategories(checks.services.length) : rulesLoading ? 'Loading…' : rulesError ? 'Could not be retrieved' : 'Not available'],
      names: checks ? servicesLine(checks.services) : undefined,
      valueClass: 'text-slate-900', href: '/cost-optimization', accent: '',
      Icon: SquareCheck, badge: 'bg-blue-50 text-blue-700', span: 'both',
    },
  ]

  // Last analysis (spec item 7, ruling Q6): the latest run's own N of M and K found.
  const lastAnalysis = (() => {
    if (isDemoActive) {
      const parts = [...(checks ? [`${checks.count} of ${checks.count} checks ran`] : []), `${DEMO_FINDING_COUNT} found`]
      return `2 hours ago (${LAST_ANALYSIS_SOURCE.scheduled}) · ${parts.join(' · ')}`
    }
    if (scan.key === 'loading') return 'Loading…'
    if (scan.key === 'status_unavailable') return "Couldn't load analysis status"
    if (scan.key === 'never_analyzed') return 'Never'
    if (scan.key === 'running') return 'Running…'
    const when = scan.completedAt ? `${formatDistanceToNow(new Date(scan.completedAt), { addSuffix: true })}${scan.source ? ` (${LAST_ANALYSIS_SOURCE[scan.source]})` : ''}` : '—'
    return [when, ...lastAnalysisParts(scan, latestRun)].join(' · ')
  })()

  return (
    <div className="min-h-screen bg-gray-50 px-4 pt-page-top pb-6 sm:px-6 sm:pb-8 lg:px-14 lg:pb-10 max-w-[1320px] mx-auto overflow-x-hidden">

      {/* ── PAGE HEADER ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-8">
        {/* Title, then (from sm) the status chip beside it and the subtitle under both; on a phone the chip sits under
            the subtitle (the mock's phone board). Only `order` changes per breakpoint. */}
        <div className="min-w-0 flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className={`${PAGE_TITLE_CLASS} order-1`}>Cost Intelligence</h1>
          {demoMode && (
            <span className="order-2 text-label font-semibold bg-amber-50 text-ink-warning border border-amber-200 px-3 py-0.5 rounded-full uppercase tracking-widest">
              Demo Mode
            </span>
          )}
          {accountConnected ? (
            // Mock-match item 3: "Account connected" only when the server says the account is connected, combined with
            // the "Cost data as of" badge. The phone board shows the date only.
            <span className={`order-4 sm:order-3 items-center gap-1.5 text-label font-medium bg-green-50 border border-green-200 rounded-full px-2.5 py-1 text-ink-success ${costDataAsOf ? 'inline-flex' : 'hidden sm:inline-flex'}`} data-testid="header-status-chip">
              <span className="w-1.5 h-1.5 rounded-full bg-green-600 shrink-0" aria-hidden="true" />
              <span className="hidden sm:inline" data-testid="account-connected">Account connected</span>
              {costDataAsOf && <><span className="hidden sm:inline" aria-hidden="true">·</span><span>Cost data as of {costDataAsOf}</span></>}
            </span>
          ) : costDataAsOf ? (
            <span className="order-4 sm:order-3 inline-flex items-center gap-1.5 text-label font-medium bg-slate-100 border border-slate-200 rounded-full px-2.5 py-1 text-ink-muted" data-testid="header-status-chip">
              Cost data as of {costDataAsOf}
            </span>
          ) : null}
          <p className={`${PAGE_SUBTITLE_CLASS} order-3 sm:order-4 basis-full`}>{PAGE_SUBTITLE}</p>
          {!notConnected && !connectionLoading && (
            <p className="order-5 basis-full text-meta text-ink-muted m-0" data-testid="last-analysis">
              {LAST_ANALYSIS}: {lastAnalysis}
            </p>
          )}
        </div>
        {connectionLoading ? <HeaderActionLoading /> : notConnected ? <ConnectAwsHeaderButton /> : (
        <div className="grid grid-cols-2 gap-2.5 sm:flex sm:items-center sm:gap-2 sm:flex-wrap sm:shrink-0">
          <button onClick={handleExportCSV} className="flex items-center justify-center gap-2 bg-white text-slate-900 px-4 py-2.5 min-h-11 rounded-lg text-ui font-semibold border border-slate-200 hover:border-slate-300 cursor-pointer transition-colors whitespace-nowrap">
            <Download size={16} aria-hidden="true" /> Export CSV
          </button>
          <a href="/cost-optimization" className="flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-700 text-white px-4 py-2.5 min-h-11 rounded-lg text-ui font-semibold no-underline transition-colors whitespace-nowrap">
            <Zap size={14} aria-hidden="true" /> Optimize Now
          </a>
        </div>
        )}
      </div>

      {connectionLoading ? <NotConnectedLoading tiles={5} /> : (<>

      {/* ── KPI ROW: shown once (spec item 6); five tiles (founder D1) ── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4 mb-5">
        {kpiTiles.map(({ key, label, value, lines, valueClass, href, accent, TrendIcon, previous, basis, names, valueSize, shortLabel, Icon, badge, cta, span }) => (
          // Each tile fills its grid row, so a wrapped label never leaves the row's tiles at different heights.
          <Link key={key} href={href} className={`no-underline block h-full ${span === 'phone' ? 'col-span-2 sm:col-span-1' : span === 'both' ? 'col-span-2 lg:col-span-1' : ''}`}>
            <div className={`h-full flex flex-col bg-white rounded-xl p-4 sm:p-5 border border-slate-200 cursor-pointer transition-colors hover:border-violet-400 ${accent}`} data-testid={`kpi-${key}`}>
              <div className="flex items-center justify-between mb-3 gap-2">
                <span className="flex items-center gap-2.5 min-w-0">
                  {/* The mock's icon badge (decorative), at every width from 640px (founder, mock-match fixes); not on a
                      phone, as on the phone board. A label that can't fit beside it uses its short form there (D7), never
                      a hidden badge. No AWS account: none, the tile is label and "—" only (PR2). */}
                  {!notConnected && (
                    <span className={`hidden sm:flex w-8 h-8 rounded-lg items-center justify-center shrink-0 ${badge}`} aria-hidden="true" data-testid={`kpi-${key}-badge`}>
                      <Icon size={18} />
                    </span>
                  )}
                  {/* Words never break mid-word (founder D7): a label whose longest word can't fit uses its short form there.
                      With the badge, "OPPORTUNITY" only fails to fit in the five-across row at 1024–1279px (measured in
                      Chromium with Geist), so the short form shows in that tier only. Only `display` changes per breakpoint
                      (fix round 1: toggling sr-only per breakpoint left a label 1px wide); screen readers always get the
                      full label once, from the sr-only copy. */}
                  <span className="text-label font-semibold text-ink-muted uppercase tracking-widest min-w-0 break-normal" data-testid={`kpi-${key}-label`}>
                    {shortLabel ? (<>
                      <span className="hidden lg:inline xl:hidden" aria-hidden="true">{shortLabel}</span>
                      <span className="lg:hidden xl:inline" aria-hidden="true">{label}</span>
                      <span className="sr-only">{label}</span>
                    </>) : label}
                  </span>
                </span>
                {!notConnected && !cta && <span className="text-ink-muted text-ui shrink-0" aria-hidden="true">›</span>}
              </div>
              {/* No AWS account: label and "—" only, nothing under it (PR2). */}
              {notConnected ? <UnmeasuredValue className="text-section sm:text-kpi" /> : (<>
              <div className={`${valueSize ?? 'text-section sm:text-kpi leading-none'} tabular-nums mb-2 break-words ${valueClass}`} data-testid={`kpi-${key}-value`}>{value}</div>
              {lines.map((line) => (
                <div key={line} className={`flex items-start gap-1.5 text-meta ${neutral}`}>
                  {TrendIcon && <TrendIcon size={12} className={`${neutral} mt-1 shrink-0`} aria-hidden="true" />}
                  <span className="leading-relaxed">{line}</span>
                </div>
              ))}
              {names && <p className="text-meta text-slate-700 font-medium mt-1.5 m-0 leading-relaxed" data-testid="kpi-checks-services">{names}</p>}
              {basis && <p className="text-meta text-ink-muted mt-1.5 m-0 leading-relaxed" data-testid="mom-basis">{basis}</p>}
              {previous && <p className="text-meta text-ink-muted mt-2 m-0" data-testid="previous-month-line">{previous}</p>}
              {/* The tile is the link; this is its visible affordance (mock-match item 2). It goes where the tile goes. */}
              {cta && (
                <span className="mt-auto pt-3 text-ui font-semibold text-violet-700" data-testid={`kpi-${key}-cta`}>
                  {cta} <span aria-hidden="true">→</span>
                </span>
              )}
              </>)}
            </div>
          </Link>
        ))}
      </div>

      {notConnected && <NotConnectedCard className="mb-5" />}

      {/* ── SPEND TREND: its own row (spec item 8) ── */}
      <section aria-labelledby="spend-trend-heading" className="bg-white rounded-xl p-4 sm:p-6 border border-slate-200 mb-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-4">
          <div className="min-w-0">
            <h2 id="spend-trend-heading" className="text-section font-semibold text-slate-900 mb-1 tracking-tight">Spend Trend</h2>
            <p className="text-meta text-ink-muted leading-relaxed m-0">
              {isDemoActive ? 'Demo data · daily spend' : `Historical AWS spend by day, from Cost Explorer · ${TREND_TOTALS_NOTE}`}
            </p>
          </div>
          {!notConnected && <div className="flex bg-slate-100 rounded-lg p-1 gap-0.5 overflow-x-auto w-full sm:w-auto sm:shrink-0">
            {TREND_RANGES.map(({ label }) => (
              <button
                key={label}
                onClick={() => setSelectedRange(label)}
                aria-pressed={selectedRange === label}
                className={`flex-1 sm:flex-none px-3 py-1.5 min-h-11 sm:min-h-9 sm:min-w-11 rounded-md text-meta font-semibold border-none cursor-pointer transition-all whitespace-nowrap ${
                  selectedRange === label ? 'bg-white text-slate-900 shadow-sm' : 'bg-transparent text-ink-muted hover:text-slate-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>}
        </div>

        {/* Mock-match item 5: the summary line. The total and the daily average add exactly the amounts the chart draws,
            the window's days and dates are the same days the cost drivers below add up (safeguard 1), and Top drivers are
            those cost drivers' largest services. */}
        {hasTrendData && windowDates && (
          <div className="flex flex-wrap items-baseline gap-x-10 gap-y-2 text-ui text-ink-muted mb-4" data-testid="trend-summary">
            <span>
              {summaryLine && <><span className="text-section font-semibold text-slate-900 tabular-nums" data-testid="trend-total">{formatDriverAmount(summaryLine.total)}</span>{' total, '}</>}
              <span data-testid="trend-window">{windowPoints.length} days · {windowDates}</span>
            </span>
            {summaryLine && (
              <span>
                <span className="text-section font-semibold text-slate-900 tabular-nums" data-testid="trend-daily-average">{formatDriverAmount(summaryLine.dailyAverage)}</span> daily average
              </span>
            )}
            {summaryTopDrivers.length > 0 && (
              // Not on a phone: the phone board's summary line has the total and the daily average only.
              <span className="hidden sm:flex flex-wrap items-center gap-x-3.5 gap-y-1.5" data-testid="trend-top-drivers">
                Top drivers
                {summaryTopDrivers.map((slice) => (
                  <span key={slice.service} className="inline-flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: slice.fill }} aria-hidden="true" />
                    {slice.service} <span className="font-semibold text-slate-900 tabular-nums">{formatDriverAmount(slice.amount)}</span>
                  </span>
                ))}
              </span>
            )}
          </div>
        )}

        {costTrendLoading && !isDemoActive ? (
          <div className={`${notConnected ? 'py-6' : 'h-60'} flex items-center justify-center`}>
            <Loader2 size={20} className="text-slate-400 animate-spin" />
          </div>
        ) : !hasTrendData ? (
          // No AWS account: about the height of the cost drivers' message (PR2).
          <div className={`${notConnected ? 'py-6' : 'h-60'} flex items-center justify-center text-center px-4`}>
            <p className="text-meta text-ink-muted m-0">
              {costTrendError
                ? 'The spend trend could not be retrieved from AWS Cost Explorer.'
                : 'No AWS Cost Explorer spend data is available for this range.'}
            </p>
          </div>
        ) : (
          <div className="overflow-hidden">
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={chartData} margin={{ top: 12, right: 8, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="actualGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={TREND_FILL} stopOpacity={0.9} />
                    <stop offset="100%" stopColor={TREND_FILL} stopOpacity={0.15} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="#F1F5F9" />
                <XAxis dataKey="date" tick={CHART_TICK} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={16} />
                <YAxis tick={{ ...CHART_TICK, fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => v >= 1000 ? `$${(v/1000).toFixed(1)}k` : `$${v}`} width={48} domain={[(d: number) => Math.max(0, Math.floor(d * 0.85)), (d: number) => Math.ceil(d * 1.15)]} />
                <Tooltip filterNull={false} content={<SpendTrendTooltip rows={chartData} />} />
                {/* Straight segments between daily points (mock-match fixes): a smoothed curve can draw bumps or dips
                    between days that aren't in the data. */}
                <Area type="linear" dataKey="actual" stroke={TREND_LINE} strokeWidth={2} fill="url(#actualGradient)" dot={false} connectNulls={false} activeDot={{ r: 4, fill: TREND_LINE, strokeWidth: 0 }} />
                {/* The day Cost Explorer is still updating: the same line, lighter and dashed, joined to the last final point (ruling Q7b). */}
                {trendHasUpdating && (
                  <Area type="linear" dataKey="updating" stroke={UPDATING_STROKE} strokeWidth={2} strokeDasharray="4 3" fill="none" connectNulls={false} isAnimationActive={false}
                    dot={(props: any) => props?.payload?.reportState === 'updating'
                      ? <circle key={props.key ?? `u-${props.index}`} cx={props.cx} cy={props.cy} r={3} fill={UPDATING_STROKE} stroke="none" data-testid="spend-trend-updating-dot" />
                      : <g key={props.key ?? `u-${props.index}`} />}
                    activeDot={{ r: 4, fill: UPDATING_STROKE, strokeWidth: 0 }} />
                )}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Legend */}
        {!notConnected && <div className="flex flex-wrap gap-4 sm:gap-6 mt-4 pt-4 border-t border-slate-100">
          <div className="flex items-center gap-2">
            <svg width="24" height="2" className="shrink-0" aria-hidden="true">
              <line x1="0" y1="1" x2="24" y2="1" stroke={TREND_LINE} strokeWidth="2" />
            </svg>
            <span className="text-label text-ink-muted font-medium">Actual spend</span>
          </div>
          {/* The lighter, dashed line of the day AWS Cost Explorer is still updating. */}
          {trendHasUpdating && hasTrendData && (
            <div className="flex items-center gap-2" data-testid="trend-updating-legend">
              <svg width="24" height="2" className="shrink-0" aria-hidden="true">
                <line x1="0" y1="1" x2="24" y2="1" stroke={UPDATING_STROKE} strokeWidth="2" strokeDasharray="4 3" />
              </svg>
              <span className="text-label text-ink-muted font-medium">{STILL_UPDATING_LEGEND}</span>
            </div>
          )}
          {trendNotReportedNote && hasTrendData && (
            <span className="text-meta text-ink-muted" data-testid="trend-not-reported">{trendNotReportedNote}</span>
          )}
          <span className="text-meta text-ink-muted ml-auto hidden sm:block" data-testid="trend-legend-note">
            Values shown as daily spend{costDataAsOf ? ` · Data as of ${costDataAsOf}` : ''}
          </span>
        </div>}
      </section>

      {/* ── ASK AI: directly after Spend Trend, its own feature (spec item 9) ── */}
      {notConnected ? null : !isPro ? (
        <div className="mb-5 bg-slate-50 border-2 border-dashed border-slate-200 rounded-xl p-7 text-center">
          <div className="w-10 h-10 rounded-xl bg-violet-50 flex items-center justify-center mx-auto mb-3">
            <Lock size={18} className="text-violet-600" />
          </div>
          <p className="text-ui font-semibold text-slate-900 mb-1.5">On the Optimization Engine plan</p>
          <p className="text-meta text-ink-muted mb-4">This feature is on the Optimization Engine plan.</p>
          <a href="/settings/billing/upgrade" className="inline-block bg-violet-600 hover:bg-violet-700 text-white px-5 py-2 rounded-lg text-label font-semibold no-underline transition-colors">
            See plans
          </a>
        </div>
      ) : (
        <>
          {nlUpgradeBanner && (
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between bg-amber-50 border border-amber-400 rounded-xl px-5 py-3.5 mb-4 gap-3">
              <div className="flex items-center gap-2.5">
                <span className="text-section">⚠️</span>
                <span className="text-ui font-medium text-amber-900">This feature is on the Optimization Engine plan.</span>
              </div>
              <a href="/settings/billing/upgrade" className="shrink-0 text-label font-semibold text-white bg-amber-500 hover:bg-amber-600 rounded-lg px-4 py-2 no-underline whitespace-nowrap">
                See plans
              </a>
            </div>
          )}
          {/* Mock-match item 6: the Ask card. Same behaviour and visibility as before (hidden with no AWS account, D2). */}
          <form method="post" onSubmit={handleNlQuery} className="mb-5 bg-white rounded-xl border border-slate-200 p-4" aria-labelledby="ask-ai-title" data-testid="ask-ai">
            <label htmlFor="ask-ai-input" id="ask-ai-title" className="flex items-center gap-2.5 text-ui font-semibold text-slate-900 mb-3">
              <Sparkles size={18} className="text-violet-600 shrink-0" aria-hidden="true" />
              {ASK_TITLE}
            </label>
            <div className="flex flex-col gap-2.5 sm:flex-row">
              <div className="relative flex-1 min-w-0">
                <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" aria-hidden="true" />
                <input
                  id="ask-ai-input"
                  ref={inputRef}
                  value={nlQuery}
                  onChange={e => setNlQuery(e.target.value)}
                  placeholder="e.g. What is my AWS spend this month?"
                  className="w-full min-h-11 pl-10 pr-3.5 rounded-lg border border-slate-300 text-ui text-slate-900 bg-white outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/15 transition-all"
                />
              </div>
              <button
                type="submit"
                disabled={nlLoading}
                className="min-h-11 bg-violet-600 hover:bg-violet-700 text-white px-5 rounded-lg text-ui font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer border-none shrink-0"
              >
                {nlLoading && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
                {nlLoading ? 'Analyzing...' : 'Ask'}
              </button>
            </div>
            <div className="flex flex-wrap gap-2 mt-3">
              {['What is my AWS spend this month?', 'Show running EC2 instances', 'Unencrypted S3 buckets', 'Failed production deployments'].map(chip => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => { setNlQuery(chip); inputRef.current?.focus() }}
                  className="min-h-8 text-meta text-violet-800 bg-violet-50 border border-violet-200 rounded-full px-3 cursor-pointer font-medium hover:bg-violet-100 transition-colors"
                >
                  {chip}
                </button>
              ))}
            </div>
            {nlResult && (
              <div className="mt-3 bg-white border border-violet-200 rounded-xl overflow-hidden">
                <div className="bg-violet-50 px-5 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-6 h-6 rounded-md bg-violet-600 flex items-center justify-center">
                      <Sparkles size={11} className="text-white" />
                    </div>
                    <div>
                      <p className="text-label font-semibold text-slate-900 m-0">{nlResult.intent.explanation}</p>
                      <p className="text-meta text-violet-600 m-0">{NL_OUTCOME_LABEL[nlResult.data.outcome](nlResult.rowCount)} · {nlResult.executionMs}ms</p>
                    </div>
                  </div>
                  <button onClick={() => setNlResult(null)} className="bg-transparent border-none cursor-pointer text-ink-muted hover:text-slate-600">
                    <X size={14} />
                  </button>
                </div>
                <div className="px-5 py-2.5 border-b border-slate-100 bg-slate-50">
                  <p className="text-meta text-ink-muted m-0">{nlResult.data.summary}</p>
                </div>
                {nlResult.data.rows.length > 0 && (
                  <div className="overflow-x-auto">
                    <div className="grid px-5 py-2.5 bg-slate-50 border-b border-slate-100" style={{ gridTemplateColumns: `repeat(${nlResult.data.columns.length}, 1fr)` }}>
                      {nlResult.data.columns.map(col => (
                        <span key={col} className="text-label font-semibold text-ink-muted uppercase tracking-wider">{col}</span>
                      ))}
                    </div>
                    {nlResult.data.rows.map((row, idx) => (
                      <div key={idx} className="grid px-5 py-3 border-b border-slate-50 last:border-b-0 hover:bg-slate-50 items-center" style={{ gridTemplateColumns: `repeat(${nlResult.data.columns.length}, 1fr)` }}>
                        {Object.values(row).slice(0, nlResult.data.columns.length).map((val: any, ci) => (
                          <span key={ci} className={`text-ui text-slate-900 ${ci === 0 ? 'font-semibold' : ''}`}>
                            {val instanceof Date ? new Date(val).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : val == null ? '—' : String(val)}
                          </span>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
                {nlResult.data.outcome === 'no_results' && (
                  <div className="px-5 py-8 text-center">
                    <p className="text-ui text-ink-muted m-0">The data was checked and nothing matched this query.</p>
                  </div>
                )}
              </div>
            )}
            {nlError && <p className="mt-2 text-meta text-ink-warning px-1">{nlError}</p>}
          </form>
        </>
      )}

      {/* ── BOTTOM ROW (mock-match item 1): Cost drivers · Opportunities · What this page covers, three columns from
          1280px (xl), stacked in that order below it. With no AWS account only Cost drivers shows, full width (PR2). ── */}
      <div className={notConnected ? 'mb-5' : 'grid grid-cols-1 xl:grid-cols-3 gap-5 items-stretch mb-5'} data-testid="costs-bottom-row">
      {/* ── COST DRIVERS: by AWS service, the chart's days (spec item 10) ── */}
      <CostDriversCard
        className="h-full"
        drivers={hasTrendData ? drivers : null}
        showBasis={!notConnected && !isDemoActive}
        message={
          !isDemoActive && costTrendLoading ? 'Loading…'
            : costTrendError ? 'Cost by service could not be retrieved from AWS Cost Explorer.'
            : !hasTrendData ? 'No AWS Cost Explorer spend data is available for this range.'
            : 'Cost by AWS service is not available for this range.'
        }
      />

      {/* ── OPPORTUNITIES (spec item 11) ── */}
      {!notConnected && (
        <OpportunitiesCard
          className="h-full"
          rows={!isDemoActive && activeRecsError ? [] : opportunityRows}
          total={stats ? stats.activeRecommendations : null}
          isError={!isDemoActive && activeRecsError}
          // N-1: no empty-state text while the list or the tile's inputs are still loading.
          isLoading={!isDemoActive && (activeRecsLoading || (recsUnavailable && recsUnavailableSub === 'Loading…'))}
          // N-1: after an analysis that left nothing open, the card agrees with the savings tile ("None found").
          emptyText={savingsTile?.kind === 'none_found' ? `${savingsTile.value}. ${savingsTile.lines[0]}.` : undefined}
        />
      )}

      {/* ── WHAT THIS PAGE COVERS (spec item 12) ── */}
      {!notConnected && <PageCoverageCard className="h-full" rows={pageCoverage} />}
      </div>
      </>)}
    </div>
  )
}

/** The demo's coverage input: a run with every active check complete, finished at `at` (demo only, ruling D4). */
function demoRun(ruleIds: string[], at: string): CostAnalysisRun {
  return {
    id: 'demo-run', status: 'completed', run_state: 'completed', source: 'discovery', recommendations_found: null, total_potential_savings: null,
    started_at: at, completed_at: at, created_at: at, error_message: null,
    unknown_resource_count: 0,
    checks: ruleIds.map((rule_id) => ({ rule_id, issue: rule_id, outcome: 'complete' as const, detected: 0, unknown: 0 })),
  }
}
