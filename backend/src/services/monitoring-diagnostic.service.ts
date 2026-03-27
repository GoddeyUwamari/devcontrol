import axios from 'axios'

const PROMETHEUS_URL = process.env.PROMETHEUS_URL || 'http://localhost:9090'

export interface DiagnosticResult {
  reachable: boolean
  responseTimeMs: number | null
  authStatus: 'ok' | 'unauthorized' | 'unknown'
  prometheusVersion: string | null
  issue: 'connection_timeout' | 'connection_refused' | 'unauthorized' | 'invalid_url' | 'none' | 'unknown'
  suggestedFix: string
  checkedAt: string
}

export class MonitoringDiagnosticService {
  async diagnose(): Promise<DiagnosticResult> {
    const start = Date.now()
    const checkedAt = new Date().toISOString()

    // Validate URL format
    try {
      new URL(PROMETHEUS_URL)
    } catch {
      return {
        reachable: false,
        responseTimeMs: null,
        authStatus: 'unknown',
        prometheusVersion: null,
        issue: 'invalid_url',
        suggestedFix: 'The configured Prometheus URL is invalid. Check your PROMETHEUS_URL environment variable.',
        checkedAt,
      }
    }

    try {
      const res = await axios.get(`${PROMETHEUS_URL}/-/healthy`, {
        timeout: 5000,
        validateStatus: (status) => status < 600,
      })

      const responseTimeMs = Date.now() - start

      if (res.status === 401 || res.status === 403) {
        return {
          reachable: true,
          responseTimeMs,
          authStatus: 'unauthorized',
          prometheusVersion: null,
          issue: 'unauthorized',
          suggestedFix: 'Prometheus is reachable but requires authentication. Check your credentials in monitoring settings.',
          checkedAt,
        }
      }

      if (res.status === 200) {
        // Try to get version
        let prometheusVersion: string | null = null
        try {
          const buildRes = await axios.get(`${PROMETHEUS_URL}/api/v1/status/buildinfo`, { timeout: 3000 })
          prometheusVersion = buildRes.data?.data?.version ?? null
        } catch {
          // version is optional
        }

        return {
          reachable: true,
          responseTimeMs,
          authStatus: 'ok',
          prometheusVersion,
          issue: 'none',
          suggestedFix: 'Connection is healthy.',
          checkedAt,
        }
      }

      return {
        reachable: false,
        responseTimeMs,
        authStatus: 'unknown',
        prometheusVersion: null,
        issue: 'unknown',
        suggestedFix: `Prometheus returned an unexpected status ${res.status}. Check your monitoring configuration.`,
        checkedAt,
      }
    } catch (err: any) {
      const responseTimeMs = Date.now() - start

      if (err.code === 'ECONNREFUSED') {
        return {
          reachable: false,
          responseTimeMs,
          authStatus: 'unknown',
          prometheusVersion: null,
          issue: 'connection_refused',
          suggestedFix: 'Connection refused — Prometheus is not running or not accessible at the configured URL. Verify the service is running and the port is open.',
          checkedAt,
        }
      }

      if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
        return {
          reachable: false,
          responseTimeMs,
          authStatus: 'unknown',
          prometheusVersion: null,
          issue: 'connection_timeout',
          suggestedFix: 'Connection timed out — Prometheus is not responding within 5 seconds. Check firewall rules and network access.',
          checkedAt,
        }
      }

      return {
        reachable: false,
        responseTimeMs,
        authStatus: 'unknown',
        prometheusVersion: null,
        issue: 'unknown',
        suggestedFix: 'An unexpected error occurred. Check your monitoring settings and try again.',
        checkedAt,
      }
    }
  }
}
