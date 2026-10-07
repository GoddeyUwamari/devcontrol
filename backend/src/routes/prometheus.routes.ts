import { Router } from 'express'
import { PrometheusController } from '../controllers/prometheus.controller'
import { MonitoringDiagnosticService } from '../services/monitoring-diagnostic.service'
import { MonitoringSnapshotService } from '../services/monitoring-snapshot.service'
import { authenticateToken } from '../middleware/auth.middleware'
import { requireAdmin } from '../middleware/rbac.middleware'
import { requirePlatformStaff } from '../middleware/platformAuth.middleware'

const router = Router()
const controller = new PrometheusController()

router.use(authenticateToken)

// Prometheus proxy endpoints — one shared Prometheus instance for the whole
// platform (PROMETHEUS_URL), not per-org, so there's no organization_id to
// scope these by; authenticateToken just requires a logged-in user.
router.get('/query', controller.query.bind(controller))
router.get('/query_range', controller.queryRange.bind(controller))
router.get('/targets', controller.targets.bind(controller))
router.get('/health', controller.health.bind(controller))
router.get('/config', controller.config.bind(controller))

// POST /api/prometheus/diagnose
// Runs a full connectivity diagnostic against the configured Prometheus endpoint.
// Platform staff only: it probes the one Prometheus instance every organization
// shares and reports on platform infrastructure, so no organization role --
// which every customer holds in their own organization -- can authorize it.
const diagnosticService = new MonitoringDiagnosticService()
router.post('/diagnose', requirePlatformStaff, async (req, res) => {
  try {
    const result = await diagnosticService.diagnose()
    res.json({ success: true, data: result })
  } catch (err) {
    console.error('[Monitoring Diagnostic] Error:', err)
    res.status(500).json({ success: false, error: 'Diagnostic failed' })
  }
})

// GET /api/prometheus/snapshot
// Returns the most recent cached monitoring snapshot for the org
const snapshotService = new MonitoringSnapshotService()
router.get('/snapshot', async (req, res) => {
  try {
    const organizationId = (req as any).user?.organizationId
    if (!organizationId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' })
    }
    const snapshot = await snapshotService.getLatestSnapshot(organizationId)
    if (!snapshot) {
      return res.json({ success: true, data: null })
    }
    res.json({ success: true, data: snapshot })
  } catch (err) {
    console.error('[Monitoring Snapshot] Error:', err)
    res.status(500).json({ success: false, error: 'Failed to load snapshot' })
  }
})

// POST /api/prometheus/snapshot
// Saves a new monitoring snapshot for the org. Owner/admin only: it writes (and
// prunes) only the caller's own organization's rows, from caller-supplied values.
router.post('/snapshot', requireAdmin, async (req, res) => {
  try {
    const organizationId = (req as any).user?.organizationId
    if (!organizationId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' })
    }
    const { uptime, responseTimeMs, requestsPerMinute, monthlyCost, services, slos, systemStatus } = req.body
    await snapshotService.saveSnapshot({
      organizationId,
      uptime: uptime ?? null,
      responseTimeMs: responseTimeMs ?? null,
      requestsPerMinute: requestsPerMinute ?? null,
      monthlyCost: monthlyCost ?? null,
      services: services ?? [],
      slos: slos ?? [],
      systemStatus: systemStatus ?? 'operational',
    })
    await snapshotService.pruneOldSnapshots(organizationId)
    res.json({ success: true })
  } catch (err) {
    console.error('[Monitoring Snapshot] Error:', err)
    res.status(500).json({ success: false, error: 'Failed to save snapshot' })
  }
})

export default router
