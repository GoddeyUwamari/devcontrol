import crypto from 'crypto'
import { Router, Request, Response, NextFunction } from 'express'
import { register } from '../metrics'

const router = Router()

// Both sides are hashed first so timingSafeEqual always compares equal-length
// buffers and the comparison time does not depend on the presented token.
function tokenMatches(presented: string, expected: string): boolean {
  const a = crypto.createHash('sha256').update(presented).digest()
  const b = crypto.createHash('sha256').update(expected).digest()
  return crypto.timingSafeEqual(a, b)
}

// Without METRICS_TOKEN, or without the right bearer token, the request falls
// through to the app's 404 handler so the endpoint looks like any unknown path.
export function requireMetricsToken(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.METRICS_TOKEN
  if (!expected) {
    return next('router')
  }
  const header = req.headers.authorization
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
    return next('router')
  }
  if (!tokenMatches(header.slice('Bearer '.length), expected)) {
    return next('router')
  }
  next()
}

router.get('/metrics', requireMetricsToken, async (req: Request, res: Response) => {
  try {
    res.set('Content-Type', register.contentType)
    const metrics = await register.metrics()
    res.end(metrics)
  } catch (error) {
    res.status(500).end(error)
  }
})

export default router
