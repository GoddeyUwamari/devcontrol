/**
 * Remediation Workflow Routes
 * Every route, reads included, is Enterprise-only.
 * Execution endpoints require admin/owner role.
 * Creating a draft requires member, admin or owner.
 * IMPORTANT: No AWS action is taken without explicit human approval.
 */

import { Router, Request, Response } from 'express';
import { AWS_ACCOUNT_AMBIGUOUS_MESSAGE, isAwsAccountAmbiguous } from '../repositories/aws-accounts.repository';
import { Pool } from 'pg';
import { z } from 'zod';
import { authenticateToken } from '../middleware/auth.middleware';
import { requireEnterprise } from '../middleware/subscription.middleware';
import { requireMember } from '../middleware/rbac.middleware';
import { remediationExecuteRateLimiter } from '../middleware/rateLimiter';
import {
  RemediationService,
  ACTION_UNAVAILABLE_PREFIX,
  TARGET_MISMATCH_PREFIX,
  REGION_MISMATCH_PREFIX,
  REGION_UNKNOWN_MESSAGE,
  REGION_AMBIGUOUS_MESSAGE,
  REGION_INVENTORY_MISMATCH_MESSAGE,
  REGION_BINDING_CONFLICT_MESSAGE,
  SELF_PROTECTION_PUBLIC_MESSAGE,
  isRegionBlocked,
  isSelfProtectionRefusal,
} from '../services/remediation.service';
import { CostRecommendationsRepository } from '../repositories/cost-recommendations.repository';
import { safeErrorFields } from '../utils/safe-error-log';

const recommendationIdSchema = z.string().uuid();

function orgId(req: Request): string {
  return (req as any).organizationId || (req as any).user?.organizationId;
}

function userId(req: Request): string {
  return (req as any).user?.userId || (req as any).user?.id;
}

function userRole(req: Request): string {
  return (req as any).user?.role || 'member';
}

// Refusals written in remediation.service.ts whose text is safe to show the
// caller: fixed sentences, or ones that add only a workflow status. Any other
// error (AWS SDK and database errors included) is answered with the route's
// fixed message, and its detail goes to the server log only.
const PUBLIC_REFUSALS = new Set<string>([
  'Workflow not found',
  'DRY_RUN_MODE: Automated remediation is disabled. No AWS action was taken.',
  'REMEDIATION_BLOCKED: Workflow action target does not match its resource_id. No AWS action was taken.',
  REGION_UNKNOWN_MESSAGE,
  REGION_AMBIGUOUS_MESSAGE,
  REGION_INVENTORY_MISMATCH_MESSAGE,
  REGION_BINDING_CONFLICT_MESSAGE,
  'Rollback is not available for this workflow',
  'Can only rollback completed workflows',
  'No active AWS account configured. Connect an AWS account first.',
  'Failed to obtain temporary AWS credentials',
]);

const PUBLIC_REFUSAL_PATTERNS: RegExp[] = [
  /^Cannot (approve|reject) workflow in status: [a-z_]+$/,
  /^Workflow must be approved before executing\. Current status: [a-z_]+$/,
  new RegExp(`^${REGION_MISMATCH_PREFIX} actionParams\\.region must be an AWS region$`),
  new RegExp(`^${REGION_MISMATCH_PREFIX} the resource is in more than one region; its region cannot be chosen$`),
  new RegExp(`^${REGION_MISMATCH_PREFIX} actionParams\\.region must be the resource's region \\([a-z]{2}(-[a-z]+)+-\\d+\\)$`),
];

/** The error text the caller may see, or `fallback` for anything else. */
function publicMessage(err: any, fallback: string): string {
  const message = err?.message;
  if (typeof message !== 'string') return fallback;
  if (isSelfProtectionRefusal(message)) return SELF_PROTECTION_PUBLIC_MESSAGE;
  if (PUBLIC_REFUSALS.has(message)) return message;
  // Every producer of these two prefixes writes a fixed sentence.
  if (message.startsWith(ACTION_UNAVAILABLE_PREFIX) || message.startsWith(TARGET_MISMATCH_PREFIX)) return message;
  if (PUBLIC_REFUSAL_PATTERNS.some((pattern) => pattern.test(message))) return message;
  return fallback;
}

/** Logs a failed remediation request without the error object (see safeErrorFields). */
function logRemediationError(operation: string, workflowId: string | undefined, err: unknown): void {
  console.error(`[Remediation] ${operation} error:`, { workflowId, ...safeErrorFields(err) });
}

function requireAdminOrOwner(req: Request, res: Response): boolean {
  const role = userRole(req);
  if (role !== 'admin' && role !== 'owner') {
    res.status(403).json({
      success: false,
      error: 'Only admins and owners can approve, reject, execute, or roll back remediation workflows.',
    });
    return false;
  }
  return true;
}

export function createRemediationRoutes(pool: Pool): Router {
  const router = Router();
  const service = new RemediationService(pool);
  const recommendations = new CostRecommendationsRepository();

  // All routes require authentication and an Enterprise plan, reads included.
  // The plan is checked before any role gate.
  router.use(authenticateToken);
  router.use(requireEnterprise);

  // ─── List workflows ──────────────────────────────────────────────────────
  router.get('/', async (req: Request, res: Response) => {
    try {
      const status = req.query.status as string | undefined;
      const workflows = await service.listWorkflows(orgId(req), status);
      res.json({ success: true, data: workflows });
    } catch (err: any) {
      logRemediationError('list', undefined, err);
      res.status(500).json({ success: false, error: 'Failed to list workflows' });
    }
  });

  // ─── Create workflow ─────────────────────────────────────────────────────
  // A draft only: two database rows, no AWS call. Viewers are refused.
  router.post('/', requireMember, async (req: Request, res: Response) => {
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

      if (typeof resourceId !== 'string') {
        res.status(400).json({ success: false, error: 'resourceId must be a string' });
        return;
      }

      if (actionParams != null && (typeof actionParams !== 'object' || Array.isArray(actionParams))) {
        res.status(400).json({ success: false, error: 'actionParams must be an object' });
        return;
      }

      // A referenced recommendation must belong to the caller's organization.
      // Another organization's recommendation is answered exactly like one
      // that does not exist.
      if (recommendationId != null) {
        if (!recommendationIdSchema.safeParse(recommendationId).success) {
          res.status(400).json({ success: false, error: 'recommendationId must be a valid UUID' });
          return;
        }
        const recommendation = await recommendations.findById(recommendationId, orgId(req));
        if (!recommendation) {
          res.status(404).json({ success: false, error: 'Recommendation not found' });
          return;
        }
        // ...and be a recommendation for the resource the workflow acts on.
        if (recommendation.resource_id !== resourceId) {
          res.status(400).json({
            success: false,
            error: `${TARGET_MISMATCH_PREFIX} recommendationId must be a recommendation for resourceId`,
          });
          return;
        }
      }

      const workflow = await service.createWorkflow(
        orgId(req),
        {
          recommendationId: recommendationId ?? undefined,
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
      logRemediationError('create', undefined, err);
      if (
        err?.message?.startsWith(ACTION_UNAVAILABLE_PREFIX) ||
        err?.message?.startsWith(TARGET_MISMATCH_PREFIX) ||
        err?.message?.startsWith(REGION_MISMATCH_PREFIX)
      ) {
        res.status(400).json({ success: false, error: publicMessage(err, 'Failed to create workflow') });
        return;
      }
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
      logRemediationError('get', req.params.id, err);
      res.status(500).json({ success: false, error: 'Failed to fetch workflow' });
    }
  });

  // ─── Approve ─────────────────────────────────────────────────────────────
  router.post('/:id/approve', async (req: Request, res: Response) => {
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
      logRemediationError('approve', req.params.id, err);
      const status = err?.message?.includes('not found') ? 404 : 400;
      res.status(status).json({ success: false, error: publicMessage(err, 'Failed to approve workflow') });
    }
  });

  // ─── Reject ──────────────────────────────────────────────────────────────
  router.post('/:id/reject', async (req: Request, res: Response) => {
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
      logRemediationError('reject', req.params.id, err);
      const status = err?.message?.includes('not found') ? 404 : 400;
      res.status(status).json({ success: false, error: publicMessage(err, 'Failed to reject workflow') });
    }
  });

  // ─── Execute — Enterprise only, admin/owner only, rate-limited ───────────
  router.post(
    '/:id/execute',
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
        logRemediationError('execute', req.params.id, err);
        if (isAwsAccountAmbiguous(err)) {
          res.status(409).json({ success: false, error: AWS_ACCOUNT_AMBIGUOUS_MESSAGE });
          return;
        }
        const message: string = typeof err?.message === 'string' ? err.message : '';
        const status =
          message.includes('not found') ? 404 :
          message.includes('must be approved') ? 400 :
          message.startsWith('DRY_RUN_MODE') ? 400 :
          message.startsWith(ACTION_UNAVAILABLE_PREFIX) ? 400 :
          isRegionBlocked(message) ? 409 : 500;
        res.status(status).json({ success: false, error: publicMessage(err, 'Failed to execute workflow') });
      }
    }
  );

  // ─── Rollback ─────────────────────────────────────────────────────────────
  router.post('/:id/rollback', async (req: Request, res: Response) => {
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
      logRemediationError('rollback', req.params.id, err);
      if (isAwsAccountAmbiguous(err)) {
        res.status(409).json({ success: false, error: AWS_ACCOUNT_AMBIGUOUS_MESSAGE });
        return;
      }
      const message: string = typeof err?.message === 'string' ? err.message : '';
      const status =
        message.includes('not found') ? 404 :
        isRegionBlocked(message) ? 409 : 400;
      res.status(status).json({ success: false, error: publicMessage(err, 'Failed to roll back workflow') });
    }
  });

  return router;
}
