import { Router } from 'express'
import { authenticateToken } from '../middleware/auth.middleware'
import { CloudWatchService } from '../services/cloudwatch.service'

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
// Returns live CloudWatch metrics for the org's connected AWS account
router.get('/metrics', authenticateToken, async (req, res) => {
  try {
    const organizationId = (req as any).user?.organizationId
    if (!organizationId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' })
    }
    const metrics = await cloudWatchService.getMetrics(organizationId)
    if (!metrics) {
      return res.json({ success: true, data: null, connected: false })
    }
    res.json({ success: true, data: metrics, connected: true })
  } catch (err) {
    console.error('[CloudWatch] Metrics error:', err)
    res.status(500).json({ success: false, error: 'Failed to fetch CloudWatch metrics' })
  }
})

export default router
