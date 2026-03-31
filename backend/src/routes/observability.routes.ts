import { Router } from 'express'
import { authenticateToken }
  from '../middleware/auth.middleware'
import {
  ObservabilityReadinessService,
} from '../services/observability-readiness.service'
import {
  SystemIntelligenceService,
} from '../services/system-intelligence.service'

const router = Router()
const readinessService =
  new ObservabilityReadinessService()
const intelligenceService =
  new SystemIntelligenceService()

// GET /api/observability/readiness
router.get(
  '/readiness',
  authenticateToken,
  async (req, res) => {
    try {
      const organizationId =
        (req as any).user?.organizationId
      if (!organizationId) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
        })
      }

      const result =
        await readinessService
          .getReadiness(organizationId)

      if (!result) {
        return res.json({
          success: true,
          data: null,
          connected: false,
        })
      }

      res.json({
        success: true,
        data: result,
        connected: true,
      })
    } catch (err) {
      console.error(
        '[Observability] Readiness error:',
        err
      )
      res.status(500).json({
        success: false,
        error:
          'Failed to compute readiness',
      })
    }
  }
)

// GET /api/observability/intelligence
router.get(
  '/intelligence',
  authenticateToken,
  async (req, res) => {
    try {
      const organizationId =
        (req as any).user?.organizationId
      if (!organizationId) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
        })
      }

      const result =
        await intelligenceService
          .getSystemIntelligence(
            organizationId
          )

      res.json({
        success: true,
        data: result,
      })
    } catch (err) {
      console.error(
        '[System] Intelligence error:',
        err
      )
      res.status(500).json({
        success: false,
        error:
          'Failed to compute system intelligence',
      })
    }
  }
)

export default router
