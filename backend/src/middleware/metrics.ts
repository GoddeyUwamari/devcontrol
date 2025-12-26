import { Request, Response, NextFunction } from 'express'
import { httpRequestDuration, httpRequestTotal } from '../metrics'

export const metricsMiddleware = (req: Request, res: Response, next: NextFunction) => {
  if (req.path === '/metrics') {
    return next()
  }

  const start = Date.now()
  const route = req.route?.path || req.path
  const method = req.method

  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000
    const statusCode = res.statusCode.toString()

    httpRequestDuration.observe(
      { method, route, status_code: statusCode },
      duration
    )

    httpRequestTotal.inc({ method, route, status_code: statusCode })
  })

  next()
}
