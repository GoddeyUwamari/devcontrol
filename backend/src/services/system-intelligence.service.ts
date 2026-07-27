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

  // ── Cost Score ───────────────────────

  private async computeCostScore(
    organizationId: string
  ): Promise<ComponentScore> {
    try {
      // Get savings from active cost recommendations (the table the Dashboard's
      // Savings Actions card also reads — see cost-recommendations.repository.ts).
      const savingsResult = await pool.query(
        `SELECT
           COUNT(*) as total_opps,
           COALESCE(SUM(potential_savings), 0)
             as total_savings
         FROM cost_recommendations
         WHERE organization_id = $1
           AND status = 'ACTIVE'`,
        [organizationId]
      )

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

      const totalSavings = parseFloat(
        savingsResult.rows[0]
          ?.total_savings ?? '0'
      )
      const totalOpps = parseInt(
        savingsResult.rows[0]
          ?.total_opps ?? '0'
      )
      const anomalyCount = parseInt(
        anomalyResult.rows[0]
          ?.count ?? '0'
      )

      const costAnalysisRan = (scanResult.rowCount ?? 0) > 0

      // Real monthly spend: try live Cost Explorer first,
      // fall back to the DB cost estimate — same pattern as
      // stats.controller.ts's dashboard stats endpoint.
      let monthlySpend = 0
      try {
        const liveCost = await awsCostService.fetchMonthlyCosts(organizationId)
        monthlySpend = liveCost.total
      } catch (costErr) {
        console.error('[Intelligence] Live cost fetch failed, falling back to estimate:', costErr)
      }
      if (monthlySpend <= 0) {
        const estimateResult = await pool.query(
          `SELECT COALESCE(SUM(estimated_monthly_cost), 0) as total
           FROM aws_resources
           WHERE organization_id = $1`,
          [organizationId]
        )
        monthlySpend = parseFloat(estimateResult.rows[0]?.total ?? '0')
      }

      // Scoring model:
      // Base: 70 (having scan data
      //   is a positive signal)
      // Penalty: unresolved savings
      //   as % of spend (max -20)
      // Penalty: cost anomalies
      //   (max -10)
      // No penalty for finding waste —
      //   finding it is the product working

      const wasteVsSpend =
        monthlySpend > 0
          ? Math.min(
              totalSavings / monthlySpend,
              1
            )
          : 0

      // Waste penalty: 0–20 pts
      // e.g. spend $585, waste $2039 →
      // ratio > 1 → capped at 1 → -20
      // but $500 waste on $5000 spend →
      // 0.1 ratio → only -2 pts
      const wastePenalty =
        Math.round(wasteVsSpend * 20)

      // Anomaly penalty: -5 per anomaly
      // capped at -10
      const anomalyPenalty =
        Math.min(anomalyCount * 5, 10)

      // Bonus: having completed scans
      // shows active monitoring (+5)
      const scanBonus =
        costAnalysisRan ? 5 : 0

      const raw =
        70 -
        wastePenalty +
        scanBonus -
        anomalyPenalty

      const score = Math.round(
        Math.max(20, Math.min(100, raw))
      )

      const detail =
        totalSavings > 0
          ? `$${Math.round(
              totalSavings
            ).toLocaleString()}/mo savings identified · ${totalOpps} opportunities`
          : costAnalysisRan
            ? 'Last scan found no savings opportunities'
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

  async getSystemIntelligence(
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
