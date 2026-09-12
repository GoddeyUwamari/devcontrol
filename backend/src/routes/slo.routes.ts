import { Router } from 'express'
import { Pool } from 'pg'
import { SloService, SloValidationError, SloNotFoundError } from '../services/slo.service'
import { authenticateToken } from '../middleware/auth.middleware'
import { requireEnterprise } from '../middleware/subscription.middleware'
import { SUPPORTED_SLIS, SUPPORTED_WINDOWS } from '../services/slo-evaluation'

/**
 * SLO 3A API. Every route enforces authenticateToken + requireEnterprise server-side —
 * the frontend's usePlan().isEnterprise check (app/(app)/monitoring/slos/page.tsx) is
 * UX only, not the security boundary; a direct HTTP request from a Free/Starter/Pro
 * organization is rejected here regardless of what the frontend renders. Organization
 * isolation is enforced twice over: every service-layer query is scoped by
 * organizationId in the SQL itself (see slo.service.ts), on top of the table's own RLS
 * policy keyed off app.current_organization_id (set per-request in auth.middleware.ts).
 */
export const createSloRoutes = (pool: Pool): Router => {
  const router = Router()
  const service = new SloService(pool)

  router.use(authenticateToken)
  router.use(requireEnterprise)

  // GET /api/slos/options — the canonical supported domain (resource types / SLIs /
  // windows), so the frontend form derives its choices from the backend's actual
  // capabilities instead of hardcoding a second copy that could drift out of sync.
  router.get('/options', (req, res) => {
    res.json({ success: true, data: { slis: SUPPORTED_SLIS, windows: SUPPORTED_WINDOWS } })
  })

  // GET /api/slos — list all SLOs for the org
  router.get('/', async (req, res) => {
    try {
      const organizationId = (req as any).user?.organizationId
      if (!organizationId) return res.status(401).json({ success: false, message: 'Unauthorized' })

      const slos = await service.listSlos(organizationId)
      return res.json({ success: true, data: slos })
    } catch (err: any) {
      console.error('[SLO GET]', err)
      return res.status(500).json({ success: false, message: 'Failed to retrieve SLOs' })
    }
  })

  // POST /api/slos — create a new SLO
  router.post('/', async (req, res) => {
    try {
      const organizationId = (req as any).user?.organizationId
      if (!organizationId) return res.status(401).json({ success: false, message: 'Unauthorized' })

      const { name, resourceId, sli, targetValue, evaluationWindow } = req.body
      const slo = await service.createSlo(organizationId, {
        name, resourceId, sli, targetValue: typeof targetValue === 'string' ? parseFloat(targetValue) : targetValue, evaluationWindow,
      })
      return res.status(201).json({ success: true, data: slo, message: 'SLO created' })
    } catch (err: any) {
      console.error('[SLO POST]', err)
      const status = err instanceof SloValidationError ? 400 : 500
      return res.status(status).json({ success: false, message: err.message ?? 'Failed to create SLO' })
    }
  })

  // PATCH /api/slos/:id — update an SLO
  router.patch('/:id', async (req, res) => {
    try {
      const organizationId = (req as any).user?.organizationId
      if (!organizationId) return res.status(401).json({ success: false, message: 'Unauthorized' })

      const { name, resourceId, targetValue, evaluationWindow, enabled } = req.body
      const slo = await service.updateSlo(req.params.id, organizationId, {
        name, resourceId, evaluationWindow, enabled,
        targetValue: targetValue === undefined ? undefined : (typeof targetValue === 'string' ? parseFloat(targetValue) : targetValue),
      })
      return res.json({ success: true, data: slo })
    } catch (err: any) {
      console.error('[SLO PATCH]', err)
      const status = err instanceof SloNotFoundError ? 404 : err instanceof SloValidationError ? 400 : 500
      return res.status(status).json({ success: false, message: err.message ?? 'Failed to update SLO' })
    }
  })

  // DELETE /api/slos/:id — delete an SLO
  router.delete('/:id', async (req, res) => {
    try {
      const organizationId = (req as any).user?.organizationId
      if (!organizationId) return res.status(401).json({ success: false, message: 'Unauthorized' })

      await service.deleteSlo(req.params.id, organizationId)
      return res.json({ success: true, message: 'SLO deleted' })
    } catch (err: any) {
      console.error('[SLO DELETE]', err)
      const status = err instanceof SloNotFoundError ? 404 : 500
      return res.status(status).json({ success: false, message: err.message ?? 'Failed to delete SLO' })
    }
  })

  // GET /api/slos/:id/evaluate — live, on-demand evaluation of one SLO
  router.get('/:id/evaluate', async (req, res) => {
    try {
      const organizationId = (req as any).user?.organizationId
      if (!organizationId) return res.status(401).json({ success: false, message: 'Unauthorized' })

      const result = await service.evaluateSloById(req.params.id, organizationId)
      return res.json({ success: true, data: result })
    } catch (err: any) {
      console.error('[SLO EVALUATE]', err)
      const status = err instanceof SloNotFoundError ? 404 : 500
      return res.status(status).json({ success: false, message: err.message ?? 'Failed to evaluate SLO' })
    }
  })

  // GET /api/slos/evaluate — live, on-demand evaluation of every enabled SLO for the org
  // (what the dashboard page loads on open). No route-ordering hazard with
  // '/:id/evaluate' above — that pattern requires two path segments, this one has one.
  router.get('/evaluate', async (req, res) => {
    try {
      const organizationId = (req as any).user?.organizationId
      if (!organizationId) return res.status(401).json({ success: false, message: 'Unauthorized' })

      const results = await service.evaluateAllSlos(organizationId)
      return res.json({ success: true, data: results })
    } catch (err: any) {
      console.error('[SLO EVALUATE ALL]', err)
      return res.status(500).json({ success: false, message: 'Failed to evaluate SLOs' })
    }
  })

  return router
}
