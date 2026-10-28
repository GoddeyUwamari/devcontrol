import { Router } from 'express'
import { authenticateToken } from '../middleware/auth.middleware'
import { cloudWatchAlarmsService } from '../services/cloudwatch-alarms.service'

/**
 * GET /api/observability/alarms: the caller's organization's CloudWatch alarms
 * (cloudwatch-alarms.service.ts). Any current member may read it. The
 * organization comes from the authenticated membership only; no query or body
 * parameter chooses the account, role or region.
 *
 * Mounted at /api/observability only (not at /api/system, where
 * observability.routes.ts is also mounted).
 */
const router = Router()

router.get('/alarms', authenticateToken, async (req, res) => {
  const organizationId = req.user?.organizationId
  if (!organizationId) {
    return res.status(401).json({ success: false, error: 'Unauthorized' })
  }
  try {
    const data = await cloudWatchAlarmsService.getAlarms(organizationId)
    res.json({ success: true, data })
  } catch (err) {
    console.error('[Alarms] unexpected error:', err instanceof Error ? err.name : typeof err)
    res.json({
      success: true,
      data: {
        status: 'error',
        reason: 'failed',
        checked_at: new Date().toISOString(),
        region: null,
        in_alarm: null,
        in_alarm_complete: null,
        configured_count: null,
        configured_count_complete: null,
        truncated: null,
      },
    })
  }
})

export default router
