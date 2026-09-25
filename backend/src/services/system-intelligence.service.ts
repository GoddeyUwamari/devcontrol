import { PoolClient } from 'pg'
import { pool } from '../config/database'
import {
  ObservabilityReadinessService,
} from './observability-readiness.service'
import { CloudWatchService }
  from './cloudwatch.service'
import awsCostService from './aws-cost.service'
import { RiskTrackingService }
  from './risk-tracking.service'
import { CostRecommendationsRepository }
  from '../repositories/cost-recommendations.repository'

// ── Types ────────────────────────────────

export interface ComponentScore {
  score: number
  label: string
  detail: string
  severity: 'critical' | 'high'
    | 'medium' | 'healthy'
  delta: number | null
  status: 'good' | 'warning' | 'risk'
  // true only when this component has a real
  // computed result behind it (a completed scan,
  // a stored score, non-null readiness) — false
  // for every error/fallback path so callers can
  // tell "bad score" apart from "no data yet"
  ready: boolean
  // Raw monthly cloud spend in USD (live Cost Explorer, falling back to the
  // DB cost estimate — see computeCostScore). Only populated on the cost
  // component, so other callers (e.g. ai-summary.service.ts) can reuse this
  // already-fetched figure instead of re-calling Cost Explorer themselves.
  monthlySpend?: number
  // Which path produced monthlySpend above -- 'actual' for a live Cost Explorer
  // read, 'estimated' for the DB cost-estimate fallback (see AWSCostService.
  // getMonthlySpendWithFallback). Only populated on the cost component, so
  // callers that narrate monthlySpend (e.g. ai-summary.service.ts) can say so
  // truthfully instead of presenting an estimate as an observed fact.
  costSource?: 'actual' | 'estimated'
}

export interface SystemDriver {
  id: string
  type: 'cost' | 'security'
    | 'observability'
  severity: 'critical' | 'high'
    | 'medium' | 'low'
  message: string
  consequence: string
  impact_score: number
  action: {
    label: string
    path: string
  }
}

export interface TopAction {
  message: string
  consequence: string
  path: string
  severity: 'critical' | 'high'
    | 'medium'
}

export interface SystemIntelligenceResult {
  system_score: number | null
  status: 'Healthy' | 'Stable'
    | 'Degraded' | 'At Risk' | 'Pending'
  components: {
    cost: ComponentScore
    security: ComponentScore
    observability: ComponentScore
  }
  top_action: TopAction | null
  top_drivers: SystemDriver[]
  computed_at: string
}

// ── Service ──────────────────────────────

export class SystemIntelligenceService {
  private readinessService =
    new ObservabilityReadinessService()
  private cloudWatchService =
    new CloudWatchService()
  private riskTrackingService =
    new RiskTrackingService(pool)
  private costRecommendationsRepository =
    new CostRecommendationsRepository()

  // getSystemIntelligence() result cache -- see the public method below for
  // full cache-semantics rationale. Single-process (PM2 fork_mode) in-memory
  // Map, same pattern as AWSCostService.monthlyCostCache/monthlyCostInFlight
  // and CloudWatchService's metricsCache.
  private intelligenceCache: Map<string, { result: SystemIntelligenceResult; timestamp: number }> = new Map()
  private static readonly INTELLIGENCE_CACHE_TTL = 2 * 60 * 1000
  private intelligenceInFlight: Map<string, Promise<SystemIntelligenceResult>> = new Map()

  // ── Cost Score ───────────────────────

  private async computeCostScore(
    organizationId: string
  ): Promise<ComponentScore> {
    try {
      // Savings aggregate and active-opportunity count -- reused from the same
      // canonical source the Dashboard's Savings Actions card and the cost-
      // recommendations API read (cost-recommendations.repository.ts::getStats()),
      // instead of this service independently re-running the same
      // SUM(potential_savings) WHERE status='ACTIVE' query.
      const recommendationStats = await this.costRecommendationsRepository.getStats(organizationId)
      const totalSavings = recommendationStats.total_potential_savings
      const totalOpps = recommendationStats.active_recommendations

      // Has a cost analysis ever completed for this org? cost_recommendations row
      // count alone can't distinguish "never analyzed" from "analyzed, found
      // nothing" — this flag (set by awsResourceDiscovery.ts::discoverAllResources)
      // is the real readiness signal.
      const scanResult = await pool.query(
        `SELECT 1 FROM resource_discovery_jobs
         WHERE organization_id = $1 AND cost_analysis_completed = true
         LIMIT 1`,
        [organizationId]
      )

      // Get active cost anomalies
      const anomalyResult = await pool.query(
        `SELECT COUNT(*) as count
         FROM anomaly_detections
         WHERE organization_id = $1
           AND type ILIKE '%cost%'
           AND status = 'active'`,
        [organizationId]
      )

      const anomalyCount = parseInt(
        anomalyResult.rows[0]
          ?.count ?? '0'
      )

      const costAnalysisRan = (scanResult.rowCount ?? 0) > 0

      // Real monthly spend: canonical live-Cost-Explorer-or-DB-estimate decision,
      // shared with stats.controller.ts's dashboard stats endpoint (see
      // AWSCostService.getMonthlySpendWithFallback) -- also carries which path
      // produced it (costSource), so callers like ai-summary.service.ts can tell
      // an observed spend from an estimate instead of losing that distinction here.
      const { amount: monthlySpend, source: costSource } =
        await awsCostService.getMonthlySpendWithFallback(organizationId)

      // Scoring model — continuous weighted-coverage-ratio, same shape as
      // Security's riskScoring.ts and Observability's computeReadinessScore:
      // every term is a real ratio scaled to 0–100, combined with fixed
      // weights. No base value with bolted-on flat bonuses/penalties.
      const hasSpendData = monthlySpend > 0

      // Cost efficiency ratio: what fraction of the dollars under
      // consideration (spend + identified waste) are NOT flagged as waste.
      // Same shape as Security's (1 - bad/total)*100 sub-scores. Unlike the
      // old wasteVsSpend/20 formula, this is never capped at a ratio of 1 —
      // waste at 1x spend (ratio=0.5 → 50) and waste at 50x spend
      // (ratio≈0.02 → 2) land in meaningfully different places instead of
      // both hitting the same ceiling.
      const costEfficiencyRatio =
        hasSpendData
          ? (monthlySpend / (monthlySpend + totalSavings)) * 100
          : 0

      // Anomaly score: deduct-from-100 with a floor, same shape as
      // Security's complianceScore (100 - weighted finding counts). Floors
      // naturally at 5+ active cost anomalies instead of an arbitrary early
      // cap like the old min(anomalyCount*5, 10).
      const anomalyScore =
        Math.max(0, 100 - anomalyCount * 20)

      // No spend data at all means the efficiency ratio above is
      // meaningless (nothing to divide by) — fall back to a fixed neutral
      // score so it doesn't read as a false "clean" result. The detail
      // string below is forced to match this branch so score and text
      // never contradict each other.
      const score =
        hasSpendData
          ? Math.round(
              costEfficiencyRatio * 0.75 +
              anomalyScore * 0.25
            )
          : 50

      const detail =
        !hasSpendData
          ? costAnalysisRan
            ? 'Spend data unavailable — cost efficiency cannot be assessed'
            : 'No cost scan run yet'
          : totalSavings > 0
            ? `$${Math.round(
                totalSavings
              ).toLocaleString()}/mo estimated savings identified · ${totalOpps} opportunities`
            // A completed scan with nothing active is not evidence of no savings:
            // a check may have failed or lacked data, and that is not recorded yet.
            : costAnalysisRan
              ? totalOpps > 0
                ? `${totalOpps} active opportunit${totalOpps !== 1 ? 'ies' : 'y'} · no estimated savings figure`
                : 'Cost scan ran · per-check results are not yet recorded'
              : 'No cost scan run yet'

      const severity =
        score >= 80 ? 'healthy'
        : score >= 65 ? 'medium'
        : score >= 50 ? 'high'
        : 'critical'

      return {
        score,
        label: 'Cost Efficiency',
        detail,
        severity,
        delta: null,
        status:
          score >= 75 ? 'good'
          : score >= 55 ? 'warning'
          : 'risk',
        ready: costAnalysisRan,
        monthlySpend,
        costSource,
      }
    } catch (err) {
      console.error(
        '[Intelligence] Cost score error:',
        err
      )
      return {
        score: 0,
        label: 'Cost Efficiency',
        detail: 'Cost score unavailable — please try again shortly',
        severity: 'critical',
        delta: null,
        status: 'risk',
        ready: false,
      }
    }
  }

  // ── Security Score ───────────────────

  private async computeSecurityScore(
    organizationId: string
  ): Promise<ComponentScore> {
    let client: PoolClient | undefined
    try {
      client = await pool.connect()

      // Session-scoped (is_local = false): this same `client` is threaded through
      // calculateCurrentRiskScore -> getStats (~10 sequential queries) and the
      // anomaly lookup below, with no wrapping BEGIN/COMMIT — a `true` (local)
      // value would revert before the first RLS-protected query ever ran, silently
      // zeroing out aws_resources/resource_discovery_jobs results on whatever
      // connection the pool handed back next. Same fix as a1f894b / 3687608.
      await client.query(
        "SELECT set_config('app.current_organization_id', $1, false)",
        [organizationId]
      )

      // Live risk score — same computation and readiness signal
      // (resource_discovery_jobs.compliance_scan_completed, via
      // AWSResourcesRepository.getStats().scan_completed) that backs
      // risk-tracking.service.ts / the Security Posture dashboard card.
      const riskScore =
        await this.riskTrackingService
          .calculateCurrentRiskScore(
            organizationId,
            client
          )

      // Get critical anomalies
      const anomalyResult =
        await client.query(
          `SELECT COUNT(*) as count
           FROM anomaly_detections
           WHERE organization_id = $1
             AND severity = 'critical'
             AND status = 'active'`,
          [organizationId]
        )

      // Get critical account security findings — without this, criticalIssues
      // only reflected anomaly_detections, so "No critical issues" could show
      // in the detail string even while real critical findings existed and
      // were already dragging riskScore.score down.
      const criticalFindingsResult =
        await client.query(
          `SELECT COUNT(*) as count
           FROM account_security_findings
           WHERE organization_id = $1
             AND severity = 'critical'
             AND status = 'active'`,
          [organizationId]
        )

      const criticalIssues = parseInt(
        anomalyResult.rows[0]
          ?.count ?? '0'
      ) + parseInt(
        criticalFindingsResult.rows[0]
          ?.count ?? '0'
      )

      // No separate penalty here: criticalIssues (anomalies + account_security_findings)
      // is now detail-string-only. Account findings already penalize riskScore.score
      // upstream via RiskTrackingService.calculateCurrentRiskScore -> combineSeverityCounts,
      // so subtracting criticalIssues * 5 here would double-weight them. The old anomaly-only
      // penalty is gone too, since criticalIssues no longer isolates anomalies as a signal
      // that isn't already in the score.
      const score =
        Math.round(riskScore.score)

      return {
        score,
        label: 'Security Posture',
        detail: criticalIssues > 0
          ? `${criticalIssues} critical issue${criticalIssues !== 1 ? 's' : ''} active · Score ${score}/100`
          : `Score ${score}/100 · No critical issues`,
        severity:
          score >= 80 ? 'healthy'
          : score >= 65 ? 'medium'
          : score >= 50 ? 'high'
          : 'critical',
        delta: null,
        status:
          score >= 80 ? 'good'
          : score >= 60 ? 'warning'
          : 'risk',
        // isPreliminary is true until compliance scanning + orphaned-resource
        // detection have actually run for this org — mirrors costAnalysisRan.
        ready: !riskScore.isPreliminary,
      }
    } catch (err) {
      console.error(
        '[Intelligence] Security score error:',
        err
      )
      return {
        score: 0,
        label: 'Security Posture',
        detail: 'Security score unavailable — please try again shortly',
        severity: 'critical',
        delta: null,
        status: 'risk',
        ready: false,
      }
    } finally {
      client?.release()
    }
  }

  // ── Observability Score ──────────────

  private async computeObservabilityScore(
    organizationId: string
  ): Promise<ComponentScore> {
    const readiness =
      await this.readinessService
        .getReadiness(organizationId)

    if (!readiness) {
      return {
        score: 0,
        label: 'Observability',
        detail: 'No AWS account connected',
        severity: 'critical',
        delta: null,
        status: 'risk',
        ready: false,
      }
    }

    const score = readiness.readiness_score

    return {
      score,
      label: 'Observability',
      detail: `${readiness.status} · ${readiness.top_gaps.length} gap${readiness.top_gaps.length !== 1 ? 's' : ''} identified`,
      severity:
        score >= 80 ? 'healthy'
        : score >= 65 ? 'medium'
        : score >= 50 ? 'high'
        : 'critical',
      delta: null,
      status:
        score >= 80
          ? 'good'
          : score >= 60
            ? 'warning'
            : 'risk',
      ready: true,
    }
  }

  // ── Top Drivers ──────────────────────

  private buildDrivers(
    cost: ComponentScore,
    security: ComponentScore,
    observability: ComponentScore
  ): SystemDriver[] {
    const drivers: SystemDriver[] = []

    if (cost.ready && cost.status !== 'good') {
      drivers.push({
        id: 'cost-efficiency',
        type: 'cost',
        severity:
          cost.score < 50 ? 'high'
          : 'medium',
        message: cost.detail,
        consequence:
          cost.score < 50
            ? 'Significant ongoing waste is reducing budget available for growth'
            : 'Cost inefficiency is reducing system score and budget runway',
        impact_score: Math.round(
          (100 - cost.score) * 0.30
        ),
        action: {
          label: 'Review savings',
          path: '/costs/cost-optimization',
        },
      })
    }

    if (security.ready && security.status !== 'good') {
      const securitySeverity =
        security.score < 50
          ? 'critical'
          : security.score < 70
            ? 'high'
            : 'medium'
      const securityConsequence =
        securitySeverity === 'critical'
          ? 'Critical security gaps expose infrastructure to breach risk'
          : securitySeverity === 'high'
            ? 'Security gaps may expose infrastructure to risk'
            : 'Security posture needs attention'
      drivers.push({
        id: 'security-posture',
        type: 'security',
        severity: securitySeverity,
        message: security.detail,
        consequence: securityConsequence,
        impact_score: Math.round(
          (100 - security.score) * 0.40
        ),
        action: {
          label: 'Review security',
          path: '/security',
        },
      })
    }

    if (observability.ready && observability.status !== 'good') {
      drivers.push({
        id: 'observability-readiness',
        type: 'observability',
        severity:
          observability.score < 50
            ? 'high'
            : 'medium',
        message: observability.detail,
        consequence:
          observability.score < 50
            ? 'Incidents may go undetected and team will not be notified'
            : 'Detection and response gaps may delay incident resolution',
        impact_score: Math.round(
          (100 - observability.score) * 0.30
        ),
        action: {
          label: 'Fix coverage gaps',
          path: '/observability/alert-history',
        },
      })
    }

    return drivers
      .sort((a, b) =>
        b.impact_score - a.impact_score
      )
      .slice(0, 3)
  }

  // ── Top Action ───────────────────────

  private buildTopAction(
    drivers: SystemDriver[]
  ): TopAction | null {
    if (drivers.length === 0) return null
    const top = drivers[0]
    return {
      message: top.message,
      consequence: top.consequence,
      path: top.action.path,
      severity: top.severity as any,
    }
  }

  // ── Status mapping ───────────────────

  private scoreToStatus(
    score: number
  ): SystemIntelligenceResult['status'] {
    if (score >= 85) return 'Healthy'
    if (score >= 70) return 'Stable'
    if (score >= 50) return 'Degraded'
    return 'At Risk'
  }

  // ── Public method ────────────────────

  /**
   * Canonical, cached entry point -- the single computation both
   * observability.routes.ts (Infrastructure page) and ai-summary.service.ts
   * (Dashboard) call through, so they read the same number within the same
   * short window instead of two independently-computed values on different
   * staleness windows (previously: Infrastructure page always fresh,
   * Dashboard bound to ai-summary's own 4h cache).
   *
   * 2-minute TTL, keyed by organizationId only -- see intelligenceCache above.
   * Only a fully-ready result (system_score != null) is cached as a normal
   * positive entry: a null/Pending result means at least one component isn't
   * ready yet (still scanning, or that component's own error-fallback), which
   * can resolve within seconds, so caching it for the full TTL would make a
   * freshly-completed scan invisible until a stale "Pending" entry expired.
   * A rejected computation (e.g. computeObservabilityScore throwing) is never
   * cached either, and propagates to the caller exactly as it did before this
   * cache existed.
   *
   * The cached result object is shared by reference across cache hits for the
   * same org (never cloned per read) -- the same convention already used by
   * AWSCostService.monthlyCostCache/CloudWatchService.metricsCache elsewhere
   * in this codebase. No current consumer mutates the result it receives.
   */
  async getSystemIntelligence(
    organizationId: string
  ): Promise<SystemIntelligenceResult> {
    const cached = this.intelligenceCache.get(organizationId)
    if (cached && Date.now() - cached.timestamp < SystemIntelligenceService.INTELLIGENCE_CACHE_TTL) {
      return cached.result
    }

    const inFlight = this.intelligenceInFlight.get(organizationId)
    if (inFlight) {
      return inFlight
    }

    const computePromise = this.computeSystemIntelligenceUncached(organizationId)
      .then((result) => {
        if (result.system_score !== null) {
          this.intelligenceCache.set(organizationId, { result, timestamp: Date.now() })
        }
        return result
      })
      .finally(() => {
        this.intelligenceInFlight.delete(organizationId)
      })

    this.intelligenceInFlight.set(organizationId, computePromise)
    return computePromise
  }

  private async computeSystemIntelligenceUncached(
    organizationId: string
  ): Promise<SystemIntelligenceResult> {
    const [cost, security, observability] =
      await Promise.all([
        this.computeCostScore(
          organizationId
        ),
        this.computeSecurityScore(
          organizationId
        ),
        this.computeObservabilityScore(
          organizationId
        ),
      ])

    const allReady =
      cost.ready &&
      security.ready &&
      observability.ready

    let system_score: number | null = null
    let status: SystemIntelligenceResult['status'] = 'Pending'

    if (allReady) {
      system_score = Math.round(
        cost.score * 0.30 +
        security.score * 0.40 +
        observability.score * 0.30
      )
      status = this.scoreToStatus(system_score)
    }

    const top_drivers =
      this.buildDrivers(
        cost,
        security,
        observability
      )

    const top_action =
      this.buildTopAction(top_drivers)

    return {
      system_score,
      status,
      components: {
        cost,
        security,
        observability,
      },
      top_action,
      top_drivers,
      computed_at:
        new Date().toISOString(),
    }
  }
}

// Canonical shared instance -- observability.routes.ts and ai-summary.service.ts
// both import this singleton (instead of each instantiating their own) so the
// intelligenceCache above is actually shared between them. Same pattern as
// aws-cost.service.ts's `export default new AWSCostService()`.
export default new SystemIntelligenceService()
