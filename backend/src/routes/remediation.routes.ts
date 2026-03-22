/**
 * Remediation Workflow Routes
 * All execution endpoints are Enterprise-only and require admin/owner role.
 * IMPORTANT: No AWS action is taken without explicit human approval.
 */

import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { authenticateToken } from '../middleware/auth.middleware';
import { requireEnterprise } from '../middleware/subscription.middleware';
import { remediationExecuteRateLimiter } from '../middleware/rateLimiter';
import { RemediationService } from '../services/remediation.service';

function orgId(req: Request): string {
  return (req as any).organizationId || (req as any).user?.organizationId;
}

function userId(req: Request): string {
  return (req as any).user?.userId || (req as any).user?.id;
}

function userRole(req: Request): string {
  return (req as any).user?.role || 'member';
}

function requireAdminOrOwner(req: Request, res: Response): boolean {
  const role = userRole(req);
  if (role !== 'admin' && role !== 'owner') {
    res.status(403).json({
      success: false,
      error: 'Only admins and owners can approve, reject, or execute remediation workflows.',
    });
    return false;
  }
  return true;
}

export function createRemediationRoutes(pool: Pool): Router {
  const router = Router();
  const service = new RemediationService(pool);

  // All routes require authentication
  router.use(authenticateToken);

  // ─── List workflows ──────────────────────────────────────────────────────
  router.get('/', async (req: Request, res: Response) => {
    try {
      const status = req.query.status as string | undefined;
      const workflows = await service.listWorkflows(orgId(req), status);
      res.json({ success: true, data: workflows });
    } catch (err: any) {
      console.error('[Remediation] list error:', err);
      res.status(500).json({ success: false, error: 'Failed to list workflows' });
    }
  });

  // ─── Create workflow ─────────────────────────────────────────────────────
  router.post('/', requireEnterprise, async (req: Request, res: Response) => {
    try {
      const {
        recommendationId,
        resourceId,
        resourceType,
        actionType,
        actionParams,
        estimatedSavings,
        riskLevel,
      } = req.body;

      if (!resourceId || !resourceType || !actionType || !riskLevel) {
        res.status(400).json({
          success: false,
          error: 'resourceId, resourceType, actionType, and riskLevel are required',
        });
        return;
      }

      const workflow = await service.createWorkflow(
        orgId(req),
        {
          recommendationId,
          resourceId,
          resourceType,
          actionType,
          actionParams: actionParams || {},
          estimatedSavings: Number(estimatedSavings) || 0,
          riskLevel,
        },
        userId(req)
      );

      res.status(201).json({ success: true, data: workflow });
    } catch (err: any) {
      console.error('[Remediation] create error:', err);
      res.status(500).json({ success: false, error: 'Failed to create workflow' });
    }
  });

  // ─── Get single workflow with audit trail ────────────────────────────────
  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const workflow = await service.getWorkflowWithAudit(req.params.id, orgId(req));
      if (!workflow) {
        res.status(404).json({ success: false, error: 'Workflow not found' });
        return;
      }
      res.json({ success: true, data: workflow });
    } catch (err: any) {
      console.error('[Remediation] get error:', err);
      res.status(500).json({ success: false, error: 'Failed to fetch workflow' });
    }
  });

  // ─── Approve ─────────────────────────────────────────────────────────────
  router.post('/:id/approve', requireEnterprise, async (req: Request, res: Response) => {
    if (!requireAdminOrOwner(req, res)) return;

    try {
      const workflow = await service.approve(
        req.params.id,
        orgId(req),
        userId(req),
        req.ip
      );
      res.json({ success: true, data: workflow });
    } catch (err: any) {
      console.error('[Remediation] approve error:', err);
      const status = err.message.includes('not found') ? 404 : 400;
      res.status(status).json({ success: false, error: err.message });
    }
  });

  // ─── Reject ──────────────────────────────────────────────────────────────
  router.post('/:id/reject', requireEnterprise, async (req: Request, res: Response) => {
    if (!requireAdminOrOwner(req, res)) return;

    try {
      const { reason } = req.body;
      const workflow = await service.reject(
        req.params.id,
        orgId(req),
        userId(req),
        reason || 'No reason provided',
        req.ip
      );
      res.json({ success: true, data: workflow });
    } catch (err: any) {
      console.error('[Remediation] reject error:', err);
      const status = err.message.includes('not found') ? 404 : 400;
      res.status(status).json({ success: false, error: err.message });
    }
  });

  // ─── Execute — Enterprise only, admin/owner only, rate-limited ───────────
  router.post(
    '/:id/execute',
    requireEnterprise,
    remediationExecuteRateLimiter,
    async (req: Request, res: Response) => {
      if (!requireAdminOrOwner(req, res)) return;

      try {
        const workflow = await service.execute(
          req.params.id,
          orgId(req),
          userId(req),
          req.ip
        );
        res.json({ success: true, data: workflow });
      } catch (err: any) {
        console.error('[Remediation] execute error:', err);
        const status =
          err.message.includes('not found') ? 404 :
          err.message.includes('must be approved') ? 400 : 500;
        res.status(status).json({ success: false, error: err.message });
      }
    }
  );

  // ─── Rollback ─────────────────────────────────────────────────────────────
  router.post('/:id/rollback', requireEnterprise, async (req: Request, res: Response) => {
    if (!requireAdminOrOwner(req, res)) return;

    try {
      const workflow = await service.rollback(
        req.params.id,
        orgId(req),
        userId(req),
        req.ip
      );
      res.json({ success: true, data: workflow });
    } catch (err: any) {
      console.error('[Remediation] rollback error:', err);
      const status = err.message.includes('not found') ? 404 : 400;
      res.status(status).json({ success: false, error: err.message });
    }
  });

  return router;
}
