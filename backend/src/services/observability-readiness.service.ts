import {
  CloudWatchClient,
  DescribeAlarmsCommand,
  StateValue,
} from '@aws-sdk/client-cloudwatch'
import { STSClient, AssumeRoleCommand }
  from '@aws-sdk/client-sts'
import { pool } from '../config/database'

// ── Types ────────────────────────────────

export interface AlertCoverageItem {
  service: 'EC2' | 'RDS' | 'Lambda'
    | 'ALB' | 'Other'
  resourceId: string
  hasAlerts: boolean
  alertCount: number
  critical: boolean
  alarmNames: string[]
  alarmStates: string[]
}

export interface MonitoringCoverageItem {
  service: string
  resourceId: string
  reporting: boolean
  lastDatapoint: string | null
  freshnessScore: number
}

export interface ResponseConfig {
  destinationsConfigured: boolean
  channels: string[]
  onCallDefined: boolean
  score: number
}

export interface ReadinessComponent {
  score: number
  label: string
  detail: string
  status: 'good' | 'warning' | 'risk'
}

export interface ReadinessGap {
  type: string
  severity: 'high' | 'medium' | 'low'
  message: string
  action: string
  actionPath: string
}

export interface ReadinessResult {
  readiness_score: number
  status: 'Ready' | 'Partially Ready'
    | 'At Risk'
  components: {
    alert_coverage: ReadinessComponent
    monitoring_coverage: ReadinessComponent
    critical_service_coverage:
      ReadinessComponent
    signal_freshness: ReadinessComponent
    response_config: ReadinessComponent
  }
  top_gaps: ReadinessGap[]
  alert_items: AlertCoverageItem[]
  monitoring_items: MonitoringCoverageItem[]
  computed_at: string
}

// ── Service ──────────────────────────────

export class ObservabilityReadinessService {

  // ── AWS helpers (same pattern as
  //    CloudWatchService) ────────────────

  private async getAccount() {
    const result = await pool.query(
      `SELECT account_id, role_arn,
              nickname
       FROM aws_accounts
       WHERE status = 'active'
       ORDER BY connected_at DESC
       LIMIT 1`
    )
    return result.rows[0] ?? null
  }

  private async assumeRole(
    roleArn: string
  ) {
    const sts = new STSClient({
      region: 'us-east-1',
    })
    const res = await sts.send(
      new AssumeRoleCommand({
        RoleArn: roleArn,
        RoleSessionName:
          'devcontrol-readiness',
        DurationSeconds: 3600,
      })
    )
    if (!res.Credentials)
      throw new Error('Failed to assume role')
    return {
      accessKeyId:
        res.Credentials.AccessKeyId!,
      secretAccessKey:
        res.Credentials.SecretAccessKey!,
      sessionToken:
        res.Credentials.SessionToken!,
    }
  }

  private getCWClient(credentials: {
    accessKeyId: string
    secretAccessKey: string
    sessionToken: string
  }) {
    return new CloudWatchClient({
      region:
        process.env.AWS_DEFAULT_REGION
        || 'us-east-1',
      credentials,
    })
  }

  // ── Step 1: Alert coverage ───────────

  private async getAlertCoverage(
    client: CloudWatchClient
  ): Promise<AlertCoverageItem[]> {
    try {
      const res = await client.send(
        new DescribeAlarmsCommand({
          AlarmTypes: ['MetricAlarm'],
          MaxRecords: 100,
        })
      )

      const alarms =
        res.MetricAlarms ?? []

      // Group alarms by namespace/resource
      const coverageMap = new Map<
        string,
        AlertCoverageItem
      >()

      for (const alarm of alarms) {
        const ns =
          alarm.Namespace ?? 'Other'
        const service = this.nsToService(ns)
        const dims = alarm.Dimensions ?? []
        const resourceId =
          dims[0]?.Value
          ?? alarm.AlarmName
          ?? 'unknown'
        const key =
          `${service}:${resourceId}`

        if (coverageMap.has(key)) {
          const existing =
            coverageMap.get(key)!
          existing.alertCount++
          existing.alarmNames.push(
            alarm.AlarmName ?? ''
          )
          existing.alarmStates.push(
            alarm.StateValue ?? 'UNKNOWN'
          )
        } else {
          coverageMap.set(key, {
            service: service as any,
            resourceId,
            hasAlerts: true,
            alertCount: 1,
            critical:
              service === 'EC2' ||
              service === 'RDS' ||
              service === 'ALB',
            alarmNames: [
              alarm.AlarmName ?? '',
            ],
            alarmStates: [
              alarm.StateValue ?? 'UNKNOWN',
            ],
          })
        }
      }

      return Array.from(
        coverageMap.values()
      )
    } catch (err) {
      console.error(
        '[Readiness] describeAlarms failed:',
        err
      )
      return []
    }
  }

  private nsToService(
    namespace: string
  ): string {
    if (namespace.includes('EC2'))
      return 'EC2'
    if (namespace.includes('RDS'))
      return 'RDS'
    if (namespace.includes('Lambda'))
      return 'Lambda'
    if (
      namespace.includes('ELB') ||
      namespace.includes('ALB')
    )
      return 'ALB'
    return 'Other'
  }

  // ── Step 2: Monitoring coverage ──────

  private async getMonitoringCoverage(
    client: CloudWatchClient
  ): Promise<MonitoringCoverageItem[]> {
    // Use existing EC2 + RDS metrics
    // to determine if resources are
    // actively reporting
    const now = new Date()
    const tenMinAgo = new Date(
      now.getTime() - 10 * 60 * 1000
    )

    const checks = [
      {
        service: 'EC2',
        namespace: 'AWS/EC2',
        metric: 'CPUUtilization',
      },
      {
        service: 'RDS',
        namespace: 'AWS/RDS',
        metric: 'CPUUtilization',
      },
      {
        service: 'Lambda',
        namespace: 'AWS/Lambda',
        metric: 'Invocations',
      },
    ]

    const results:
      MonitoringCoverageItem[] = []

    for (const check of checks) {
      try {
        const { GetMetricStatisticsCommand }
          = await import(
            '@aws-sdk/client-cloudwatch'
          )
        const res = await client.send(
          new GetMetricStatisticsCommand({
            Namespace: check.namespace,
            MetricName: check.metric,
            Dimensions: [],
            StartTime: new Date(
              now.getTime() -
              60 * 60 * 1000
            ),
            EndTime: now,
            Period: 300,
            Statistics: ['Average'],
          })
        )
        const points =
          res.Datapoints ?? []
        const reporting =
          points.length > 0
        const lastPoint =
          points.sort(
            (a, b) =>
              new Date(
                b.Timestamp!
              ).getTime() -
              new Date(
                a.Timestamp!
              ).getTime()
          )[0]

        const lastDatapoint =
          lastPoint?.Timestamp
            ? lastPoint.Timestamp
                .toISOString()
            : null

        const ageMs = lastDatapoint
          ? now.getTime() -
            new Date(
              lastDatapoint
            ).getTime()
          : Infinity

        const freshnessScore =
          !reporting ? 0
          : ageMs < 2 * 60 * 1000
            ? 100
          : ageMs < 5 * 60 * 1000
            ? 80
          : ageMs < 10 * 60 * 1000
            ? 50
          : 20

        results.push({
          service: check.service,
          resourceId: check.service,
          reporting,
          lastDatapoint,
          freshnessScore,
        })
      } catch {
        results.push({
          service: check.service,
          resourceId: check.service,
          reporting: false,
          lastDatapoint: null,
          freshnessScore: 0,
        })
      }
    }

    return results
  }

  // ── Step 3: Response config ──────────

  private async getResponseConfig():
    Promise<ResponseConfig> {
    try {
      const result = await pool.query(
        `SELECT COUNT(*) as count
         FROM alert_configurations
         WHERE is_active = true
         LIMIT 1`
      )
      const hasConfig =
        parseInt(
          result.rows[0]?.count ?? '0'
        ) > 0

      return {
        destinationsConfigured: hasConfig,
        channels: hasConfig
          ? ['email'] : [],
        onCallDefined: false,
        score: hasConfig ? 50 : 0,
      }
    } catch {
      return {
        destinationsConfigured: false,
        channels: [],
        onCallDefined: false,
        score: 0,
      }
    }
  }

  // ── Step 4: Score computation ────────

  private computeReadinessScore(
    alertItems: AlertCoverageItem[],
    monitoringItems:
      MonitoringCoverageItem[],
    responseConfig: ResponseConfig
  ): ReadinessResult {

    // Alert coverage score
    const totalServices =
      Math.max(
        alertItems.length, 2
      ) // min 2 (EC2 + RDS)
    const coveredServices =
      alertItems.filter(
        i => i.hasAlerts
      ).length
    const alertCoveragePct =
      totalServices > 0
        ? (coveredServices /
           totalServices) * 100
        : 0

    // Monitoring coverage score
    const reporting =
      monitoringItems.filter(
        i => i.reporting
      ).length
    const monitoringCoveragePct =
      monitoringItems.length > 0
        ? (reporting /
           monitoringItems.length) * 100
        : 0

    // Critical service coverage
    const criticalItems =
      alertItems.filter(i => i.critical)
    const criticalCovered =
      criticalItems.filter(
        i => i.hasAlerts
      ).length
    const criticalCoveragePct =
      criticalItems.length > 0
        ? (criticalCovered /
           criticalItems.length) * 100
        : monitoringCoveragePct

    // Signal freshness score
    const avgFreshness =
      monitoringItems.length > 0
        ? monitoringItems.reduce(
            (s, i) =>
              s + i.freshnessScore,
            0
          ) / monitoringItems.length
        : 0

    // Weighted score
    const rawScore =
      (alertCoveragePct * 0.35) +
      (monitoringCoveragePct * 0.25) +
      (criticalCoveragePct * 0.20) +
      (avgFreshness * 0.10) +
      (responseConfig.score * 0.10)

    const readiness_score =
      Math.round(rawScore)

    const status =
      readiness_score >= 85
        ? 'Ready'
        : readiness_score >= 65
          ? 'Partially Ready'
          : 'At Risk'

    // Build component objects
    const components = {
      alert_coverage: {
        score: Math.round(
          alertCoveragePct
        ),
        label: 'Alert Coverage',
        detail: `${coveredServices} of ${totalServices} services have alerts`,
        status: (
          alertCoveragePct >= 80
            ? 'good'
            : alertCoveragePct >= 50
              ? 'warning'
              : 'risk'
        ) as 'good' | 'warning' | 'risk',
      },
      monitoring_coverage: {
        score: Math.round(
          monitoringCoveragePct
        ),
        label: 'Monitoring Coverage',
        detail: `${reporting} of ${monitoringItems.length} services reporting metrics`,
        status: (
          monitoringCoveragePct >= 80
            ? 'good'
            : monitoringCoveragePct >= 50
              ? 'warning'
              : 'risk'
        ) as 'good' | 'warning' | 'risk',
      },
      critical_service_coverage: {
        score: Math.round(
          criticalCoveragePct
        ),
        label: 'Critical Coverage',
        detail: `${criticalCovered} of ${criticalItems.length} critical services covered`,
        status: (
          criticalCoveragePct >= 80
            ? 'good'
            : criticalCoveragePct >= 50
              ? 'warning'
              : 'risk'
        ) as 'good' | 'warning' | 'risk',
      },
      signal_freshness: {
        score: Math.round(avgFreshness),
        label: 'Signal Freshness',
        detail: avgFreshness >= 80
          ? 'Metrics up to date'
          : 'Some metrics may be stale',
        status: (
          avgFreshness >= 80
            ? 'good'
            : avgFreshness >= 50
              ? 'warning'
              : 'risk'
        ) as 'good' | 'warning' | 'risk',
      },
      response_config: {
        score: responseConfig.score,
        label: 'Response Setup',
        detail: responseConfig
          .destinationsConfigured
          ? 'Alert destinations configured'
          : 'No alert destinations configured',
        status: (
          responseConfig.score >= 80
            ? 'good'
            : responseConfig.score >= 40
              ? 'warning'
              : 'risk'
        ) as 'good' | 'warning' | 'risk',
      },
    }

    // Build top gaps
    const top_gaps: ReadinessGap[] = []

    if (alertCoveragePct < 80) {
      top_gaps.push({
        type: 'alert_coverage',
        severity: alertCoveragePct < 50
          ? 'high' : 'medium',
        message: `${totalServices - coveredServices} service${totalServices - coveredServices !== 1 ? 's' : ''} lack alert rules — incidents may go undetected`,
        action: 'Configure alerts',
        actionPath:
          '/observability/alerts',
      })
    }

    if (monitoringCoveragePct < 80) {
      top_gaps.push({
        type: 'monitoring_coverage',
        severity: 'medium',
        message: `${monitoringItems.length - reporting} service${monitoringItems.length - reporting !== 1 ? 's' : ''} not reporting metrics to CloudWatch`,
        action: 'Review monitoring',
        actionPath: '/admin/monitoring',
      })
    }

    if (!responseConfig
        .destinationsConfigured) {
      top_gaps.push({
        type: 'response_config',
        severity: 'medium',
        message: 'No alert destinations configured — team will not be notified of incidents',
        action: 'Configure destinations',
        actionPath:
          '/settings/notifications',
      })
    }

    return {
      readiness_score,
      status,
      components,
      top_gaps: top_gaps.slice(0, 3),
      alert_items: alertItems,
      monitoring_items: monitoringItems,
      computed_at:
        new Date().toISOString(),
    }
  }

  // ── Public method ────────────────────

  async getReadiness(
    organizationId: string
  ): Promise<ReadinessResult | null> {
    try {
      const account =
        await this.getAccount()
      if (!account) return null

      const credentials =
        await this.assumeRole(
          account.role_arn
        )
      const client =
        this.getCWClient(credentials)

      const [
        alertItems,
        monitoringItems,
        responseConfig,
      ] = await Promise.all([
        this.getAlertCoverage(client),
        this.getMonitoringCoverage(client),
        this.getResponseConfig(),
      ])

      return this.computeReadinessScore(
        alertItems,
        monitoringItems,
        responseConfig
      )
    } catch (err) {
      console.error(
        '[Readiness] Error:',
        err
      )
      return null
    }
  }
}
