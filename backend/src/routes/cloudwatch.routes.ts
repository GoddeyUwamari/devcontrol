import { Router } from 'express'
import { authenticateToken } from '../middleware/auth.middleware'
import { CloudWatchService } from '../services/cloudwatch.service'
import { clampPageSize, decodeCursor, paginateServices, InvalidCursorError } from '../services/cloudwatch-pagination.util'

const router = Router()
const cloudWatchService = new CloudWatchService()

// GET /api/cloudwatch/status
// Returns whether the org has a connected AWS account
router.get('/status', authenticateToken, async (req, res) => {
  try {
    const organizationId = (req as any).user?.organizationId
    if (!organizationId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' })
    }
    const connected = await cloudWatchService.hasConnectedAccount(organizationId)
    res.json({ success: true, data: { connected } })
  } catch (err) {
    console.error('[CloudWatch] Status error:', err)
    res.status(500).json({ success: false, error: 'Failed to check connection status' })
  }
})

// GET /api/cloudwatch/metrics
// Returns live CloudWatch metrics for the org's connected AWS account. Cached for 45s
// per (organization, range) -- see CloudWatchService.getMetrics() -- unless the caller
// passes ?refresh=true, which is how a manual refresh is represented through this same
// existing endpoint: no separate route, just an explicit opt-out of the cache read.
//
// CloudWatch Scalability Phase 2D: `services` in the cached/computed CloudWatchMetrics
// is now the COMPLETE evaluated fleet (the per-type evaluation cap was removed in
// computeMetrics()). Pagination is applied HERE, after the cache read, via
// `?pageSize=`/`?cursor=` -- deliberately not inside getMetrics()/computeMetrics(), so
// the cache key stays organization+range only and paginating through a large fleet never
// triggers a redundant AWS evaluation. `healthSummary`/`systemStatus` on `metrics` are
// already complete-fleet-derived and pass through unchanged regardless of which page is
// requested.
router.get('/metrics', authenticateToken, async (req, res) => {
  try {
    const organizationId = (req as any).user?.organizationId
    if (!organizationId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' })
    }
    const range = typeof req.query.range === 'string' ? req.query.range : undefined
    const forceRefresh = req.query.refresh === 'true'
    const metrics = await cloudWatchService.getMetrics(organizationId, range, forceRefresh)
    if (!metrics) {
      return res.json({ success: true, data: null, connected: false })
    }

    let cursor
    try {
      cursor = decodeCursor(typeof req.query.cursor === 'string' ? req.query.cursor : undefined)
    } catch (err) {
      if (err instanceof InvalidCursorError) {
        return res.status(400).json({ success: false, error: 'Invalid pagination cursor' })
      }
      throw err
    }
    const pageSize = clampPageSize(req.query.pageSize)
    const { services, pagination } = paginateServices(metrics.services, cursor, pageSize)

    res.json({ success: true, data: { ...metrics, services, pagination }, connected: true })
  } catch (err) {
    console.error('[CloudWatch] Metrics error:', err)
    res.status(500).json({ success: false, error: 'Failed to fetch CloudWatch metrics' })
  }
})

export default router
