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

// Update business metrics from database
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

    // Infrastructure cost
    const infra = await dbPool.query(`
      SELECT COALESCE(SUM(cost_per_month), 0) as total_cost
      FROM infrastructure_resources
      WHERE status = 'Running'
    `)

    if (infra.rows.length > 0) {
      infrastructureCostTotal.set(Number(infra.rows[0].total_cost))
    }
  } catch (error) {
    console.error('Error updating metrics:', error)
  }
}
