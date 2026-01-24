import { Request, Response } from 'express'
import axios from 'axios'

const PROMETHEUS_URL = process.env.PROMETHEUS_URL || 'http://localhost:9090'

export class PrometheusController {
  /**
   * Proxy Prometheus query API
   * GET /api/prometheus/query?query=up
   */
  async query(req: Request, res: Response) {
    try {
      const { query, time } = req.query

      if (!query) {
        return res.status(400).json({
          error: 'Query parameter is required',
        })
      }

      const params: any = { query }
      if (time) {
        params.time = time
      }

      const response = await axios.get(`${PROMETHEUS_URL}/api/v1/query`, {
        params,
        timeout: 10000,
      })

      res.json(response.data)
    } catch (error: any) {
      console.error('Prometheus query error:', error.message)

      if (error.code === 'ECONNREFUSED') {
        return res.status(503).json({
          error: 'Unable to connect to Prometheus',
          message: 'Prometheus server is not accessible',
        })
      }

      if (error.response) {
        return res.status(error.response.status).json({
          error: error.response.data,
        })
      }

      res.status(500).json({
        error: 'Failed to query Prometheus',
        message: error.message,
      })
    }
  }

  /**
   * Proxy Prometheus range query API
   * GET /api/prometheus/query_range?query=up&start=...&end=...&step=15s
   */
  async queryRange(req: Request, res: Response) {
    try {
      const { query, start, end, step } = req.query

      if (!query) {
        return res.status(400).json({
          error: 'Query parameter is required',
        })
      }

      const params: any = { query }
      if (start) params.start = start
      if (end) params.end = end
      if (step) params.step = step

      const response = await axios.get(`${PROMETHEUS_URL}/api/v1/query_range`, {
        params,
        timeout: 10000,
      })

      res.json(response.data)
    } catch (error: any) {
      console.error('Prometheus query_range error:', error.message)

      if (error.code === 'ECONNREFUSED') {
        return res.status(503).json({
          error: 'Unable to connect to Prometheus',
          message: 'Prometheus server is not accessible',
        })
      }

      if (error.response) {
        return res.status(error.response.status).json({
          error: error.response.data,
        })
      }

      res.status(500).json({
        error: 'Failed to query Prometheus',
        message: error.message,
      })
    }
  }

  /**
   * Get Prometheus targets
   * GET /api/prometheus/targets
   */
  async targets(req: Request, res: Response) {
    try {
      const response = await axios.get(`${PROMETHEUS_URL}/api/v1/targets`, {
        timeout: 10000,
      })

      res.json(response.data)
    } catch (error: any) {
      console.error('Prometheus targets error:', error.message)

      if (error.code === 'ECONNREFUSED') {
        return res.status(503).json({
          error: 'Unable to connect to Prometheus',
          message: 'Prometheus server is not accessible',
        })
      }

      res.status(500).json({
        error: 'Failed to get Prometheus targets',
        message: error.message,
      })
    }
  }

  /**
   * Get Prometheus health status
   * GET /api/prometheus/health
   */
  async health(req: Request, res: Response) {
    try {
      const response = await axios.get(`${PROMETHEUS_URL}/-/healthy`, {
        timeout: 5000,
      })

      res.json({
        status: 'healthy',
        message: response.data,
        url: PROMETHEUS_URL,
      })
    } catch (error: any) {
      console.error('Prometheus health check error:', error.message)

      res.status(503).json({
        status: 'unhealthy',
        error: 'Unable to connect to Prometheus',
        url: PROMETHEUS_URL,
      })
    }
  }

  /**
   * Get Prometheus config status
   * GET /api/prometheus/config
   */
  async config(req: Request, res: Response) {
    try {
      const response = await axios.get(`${PROMETHEUS_URL}/api/v1/status/config`, {
        timeout: 10000,
      })

      res.json(response.data)
    } catch (error: any) {
      console.error('Prometheus config error:', error.message)

      res.status(503).json({
        error: 'Unable to connect to Prometheus',
        message: error.message,
      })
    }
  }
}
