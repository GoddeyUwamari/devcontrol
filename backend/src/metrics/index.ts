import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client'

export const register = new Registry()

collectDefaultMetrics({ register, prefix: 'devcontrol_' })

// HTTP Metrics
export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.001, 0.01, 0.1, 0.5, 1, 2, 5, 10],
  registers: [register],
})

export const httpRequestTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
})

// Service Metrics
export const servicesTotal = new Gauge({
  name: 'services_total',
  help: 'Total services',
  registers: [register],
})

export const servicesActive = new Gauge({
  name: 'services_active',
  help: 'Active services',
  registers: [register],
})

// Deployment Metrics
export const deploymentsTotal = new Counter({
  name: 'deployments_total',
  help: 'Total deployments',
  labelNames: ['environment', 'status'],
  registers: [register],
})

// Infrastructure Metrics
export const infrastructureCostTotal = new Gauge({
  name: 'infrastructure_cost_monthly_total',
  help: 'Monthly infrastructure cost (USD)',
  registers: [register],
})

// Cost Optimization Metrics
export const costOptimizationPotentialSavings = new Gauge({
  name: 'cost_optimization_potential_savings_total',
  help: 'Total potential monthly savings from cost optimization recommendations (USD)',
  registers: [register],
})

export const costOptimizationRecommendationsActive = new Gauge({
  name: 'cost_optimization_recommendations_active',
  help: 'Number of active cost optimization recommendations',
  labelNames: ['severity'],
  registers: [register],
})

// DORA Metrics
export const doraDeploymentFrequency = new Gauge({
  name: 'dora_deployment_frequency',
  help: 'DORA metric: Deployment frequency (deployments per day)',
  registers: [register],
})

export const doraLeadTimeHours = new Gauge({
  name: 'dora_lead_time_hours',
  help: 'DORA metric: Lead time for changes (hours)',
  registers: [register],
})

export const doraChangeFailureRate = new Gauge({
  name: 'dora_change_failure_rate',
  help: 'DORA metric: Change failure rate (percentage)',
  registers: [register],
})

export const doraMTTRMinutes = new Gauge({
  name: 'dora_mttr_minutes',
  help: 'DORA metric: Mean time to recovery (minutes)',
  registers: [register],
})

// Update business metrics from database and AWS
export async function updateBusinessMetrics(dbPool: any) {
  try {
    // Services
    const services = await dbPool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'active') as active
      FROM services
    `)

    if (services.rows.length > 0) {
      servicesTotal.set(Number(services.rows[0].total))
      servicesActive.set(Number(services.rows[0].active))
    }

    // Infrastructure cost - Check for AWS_COST_TOTAL first, then sum other resources
    const awsTotalRecord = await dbPool.query(`
      SELECT cost_per_month
      FROM infrastructure_resources
      WHERE resource_type = 'AWS_COST_TOTAL' AND aws_id = 'cost-explorer-total'
      LIMIT 1
    `)

    if (awsTotalRecord.rows.length > 0) {
      // Use real AWS Cost Explorer total if available
      const awsCost = Number(awsTotalRecord.rows[0].cost_per_month)
      infrastructureCostTotal.set(awsCost)
      console.log(`Updated infrastructure cost from AWS Cost Explorer: $${awsCost.toFixed(2)}`)
    } else {
      // Fallback to summing database costs (for resources not synced with AWS)
      const infra = await dbPool.query(`
        SELECT COALESCE(SUM(cost_per_month), 0) as total_cost
        FROM infrastructure_resources
        WHERE status IN ('Running', 'Active')
        AND resource_type != 'AWS_COST_TOTAL'
      `)

      if (infra.rows.length > 0) {
        infrastructureCostTotal.set(Number(infra.rows[0].total_cost))
      }
    }

    // Cost Optimization Recommendations
    const recommendations = await dbPool.query(`
      SELECT
        COALESCE(SUM(potential_savings), 0) as total_savings,
        COALESCE(SUM(CASE WHEN severity = 'HIGH' THEN 1 ELSE 0 END), 0) as high,
        COALESCE(SUM(CASE WHEN severity = 'MEDIUM' THEN 1 ELSE 0 END), 0) as medium,
        COALESCE(SUM(CASE WHEN severity = 'LOW' THEN 1 ELSE 0 END), 0) as low
      FROM cost_recommendations
      WHERE status = 'ACTIVE'
    `)

    if (recommendations.rows.length > 0) {
      const row = recommendations.rows[0]
      costOptimizationPotentialSavings.set(Number(row.total_savings))
      costOptimizationRecommendationsActive.set({ severity: 'HIGH' }, Number(row.high))
      costOptimizationRecommendationsActive.set({ severity: 'MEDIUM' }, Number(row.medium))
      costOptimizationRecommendationsActive.set({ severity: 'LOW' }, Number(row.low))
    }

    // DORA Metrics (30-day window)
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    // Deployment Frequency
    const deploymentFreq = await dbPool.query(`
      SELECT COUNT(*) as total
      FROM deployments
      WHERE deployed_at >= $1
    `, [thirtyDaysAgo])

    if (deploymentFreq.rows.length > 0) {
      const deploymentsPerDay = Number(deploymentFreq.rows[0].total) / 30
      doraDeploymentFrequency.set(deploymentsPerDay)
    }

    // Lead Time (average time between consecutive successful deployments)
    const leadTime = await dbPool.query(`
      WITH successful_deployments AS (
        SELECT
          deployed_at,
          LAG(deployed_at) OVER (PARTITION BY service_id ORDER BY deployed_at) as previous_deploy_at
        FROM deployments
        WHERE status = 'success'
          AND deployed_at >= $1
      )
      SELECT AVG(EXTRACT(EPOCH FROM (deployed_at - previous_deploy_at)) / 3600) as avg_hours
      FROM successful_deployments
      WHERE previous_deploy_at IS NOT NULL
    `, [thirtyDaysAgo])

    if (leadTime.rows.length > 0 && leadTime.rows[0].avg_hours) {
      doraLeadTimeHours.set(Number(leadTime.rows[0].avg_hours))
    }

    // Change Failure Rate
    const failureRate = await dbPool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'failed') as failed
      FROM deployments
      WHERE deployed_at >= $1
    `, [thirtyDaysAgo])

    if (failureRate.rows.length > 0) {
      const total = Number(failureRate.rows[0].total)
      const failed = Number(failureRate.rows[0].failed)
      const rate = total > 0 ? (failed / total) * 100 : 0
      doraChangeFailureRate.set(rate)
    }

    // Mean Time to Recovery (MTTR)
    const mttr = await dbPool.query(`
      WITH deployments_ordered AS (
        SELECT
          status,
          deployed_at,
          LEAD(status) OVER (PARTITION BY service_id ORDER BY deployed_at) as next_status,
          LEAD(deployed_at) OVER (PARTITION BY service_id ORDER BY deployed_at) as next_deploy_at
        FROM deployments
        WHERE deployed_at >= $1
      )
      SELECT AVG(EXTRACT(EPOCH FROM (next_deploy_at - deployed_at)) / 60) as avg_minutes
      FROM deployments_ordered
      WHERE status = 'failed'
        AND next_status = 'success'
        AND next_deploy_at IS NOT NULL
    `, [thirtyDaysAgo])

    if (mttr.rows.length > 0 && mttr.rows[0].avg_minutes) {
      doraMTTRMinutes.set(Number(mttr.rows[0].avg_minutes))
    }
  } catch (error) {
    console.error('Error updating metrics:', error)
  }
}
