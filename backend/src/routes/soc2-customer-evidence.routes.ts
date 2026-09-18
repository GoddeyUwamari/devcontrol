/**
 * SOC 2 Readiness Evidence Layer -- Phase 3 customer-evidence API.
 *
 * Deliberately a separate route file/namespace from soc2.routes.ts (Phase 2), mounted
 * at /api/soc2/customer-evidence, not merged into GET /api/soc2/evidence -- Phase 2's
 * three endpoints (GET /readiness, /readiness/:criterionId, /evidence) are untouched by
 * this file and keep returning technical observations only. See the Phase 3 audit's
 * "Phase 2 compatibility" finding for why this separation is required, not optional.
 *
 * ENTITLEMENT: every route below requires requireEnterprise -- a locked product
 * decision, not a default chosen here. Customer self-service routes (create/read/patch)
 * additionally require requireMember; internal lifecycle routes (review/expire/
 * supersede) require requirePlatformStaff INSTEAD of requireMember/requireAdmin (a
 * locked micro-decision: platform staff acting on a customer's evidence are DevControl
 * employees, not members of that organization, so requireMember would incorrectly
 * exclude them -- and a customer must never be able to self-approve their own evidence).
 *
 * NO DELETE ROUTE EXISTS -- v1 has no hard delete. Superseding and expiring are the only
 * ways evidence stops being current, and both are status transitions on
 * Soc2CustomerEvidenceRepository, never a DELETE statement.
 */
import { Router, Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth.middleware';
import { requireEnterprise } from '../middleware/subscription.middleware';
import { requireMember } from '../middleware/rbac.middleware';
import { requirePlatformStaff } from '../middleware/platformAuth.middleware';
import { pool } from '../config/database';
import { Soc2CustomerEvidenceRepository } from '../repositories/soc2-customer-evidence.repository';
import {
  Soc2CustomerEvidenceConflictError,
  Soc2CustomerEvidenceService,
  Soc2CustomerEvidenceValidationError,
} from '../services/soc2-customer-evidence.service';
import { Soc2CustomerEvidence } from '../types/soc2-evidence.types';

const router = Router();
const repository = new Soc2CustomerEvidenceRepository(pool);
const service = new Soc2CustomerEvidenceService(repository);

router.use(authenticateToken, requireEnterprise);

function toPublicCustomerEvidence(evidence: Soc2CustomerEvidence) {
  return {
    evidenceId: evidence.id,
    criterionId: evidence.criterion_id,
    evidenceType: evidence.evidence_type,
    title: evidence.title,
    description: evidence.description,
    externalReference: evidence.external_reference,
    provenance: evidence.provenance,
    status: evidence.status,
    submittedBy: evidence.submitted_by,
    submittedAt: evidence.submitted_at,
    reviewDate: evidence.review_date,
    createdAt: evidence.created_at,
    updatedAt: evidence.updated_at,
  };
}

/** Maps a service-layer error to the matching HTTP response. Returns true if the error
 * was handled (a response was sent), false if the caller should treat it as an
 * unexpected 500. */
function handleServiceError(error: unknown, res: Response): boolean {
  if (error instanceof Soc2CustomerEvidenceValidationError) {
    res.status(400).json({ success: false, error: error.message, code: error.code });
    return true;
  }
  if (error instanceof Soc2CustomerEvidenceConflictError) {
    const status = error.code === 'NOT_FOUND' ? 404 : 409;
    res.status(status).json({ success: false, error: error.message, code: error.code });
    return true;
  }
  return false;
}

router.post('/', requireMember, async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = req.organizationId;
    if (!organizationId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const created = await service.createCustomerEvidence(organizationId, req.user?.userId ?? null, {
      criterionId: req.body?.criterionId,
      evidenceType: req.body?.evidenceType,
      title: req.body?.title,
      description: req.body?.description,
      externalReference: req.body?.externalReference,
      reviewDate: req.body?.reviewDate,
    });

    res.status(201).json({ success: true, customerEvidence: toPublicCustomerEvidence(created) });
  } catch (error: unknown) {
    if (handleServiceError(error, res)) return;
    console.error('[Soc2CustomerEvidence] Error creating evidence:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

router.get('/', requireMember, async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = req.organizationId;
    if (!organizationId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const criterionId = typeof req.query.criterionId === 'string' ? req.query.criterionId : undefined;
    const evidence = await service.listCustomerEvidence(organizationId, criterionId);
    res.json({ success: true, customerEvidence: evidence.map(toPublicCustomerEvidence) });
  } catch (error: unknown) {
    if (handleServiceError(error, res)) return;
    console.error('[Soc2CustomerEvidence] Error listing evidence:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

router.get('/:evidenceId', requireMember, async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = req.organizationId;
    if (!organizationId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const evidence = await service.getCustomerEvidenceDetail(organizationId, req.params.evidenceId);
    if (!evidence) {
      res.status(404).json({ success: false, error: 'Evidence not found.', code: 'NOT_FOUND' });
      return;
    }

    res.json({ success: true, customerEvidence: toPublicCustomerEvidence(evidence) });
  } catch (error: unknown) {
    console.error('[Soc2CustomerEvidence] Error fetching evidence:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

/**
 * Metadata-only. Explicitly destructures only the allowed fields from req.body --
 * organization_id/criterion_id/provenance/status/submittedBy/submittedAt are never read
 * from the request at all, so no value the client sends for those keys can ever reach
 * the service or repository, regardless of what the body contains.
 */
router.patch('/:evidenceId', requireMember, async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = req.organizationId;
    if (!organizationId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const patchRequest: Record<string, unknown> = {};
    if ('evidenceType' in (req.body ?? {})) patchRequest.evidenceType = req.body.evidenceType;
    if ('title' in (req.body ?? {})) patchRequest.title = req.body.title;
    if ('description' in (req.body ?? {})) patchRequest.description = req.body.description;
    if ('externalReference' in (req.body ?? {})) patchRequest.externalReference = req.body.externalReference;
    if ('reviewDate' in (req.body ?? {})) patchRequest.reviewDate = req.body.reviewDate;

    const updated = await service.updateCustomerEvidenceMetadata(
      organizationId,
      req.params.evidenceId,
      req.user?.userId ?? null,
      patchRequest
    );

    res.json({ success: true, customerEvidence: toPublicCustomerEvidence(updated) });
  } catch (error: unknown) {
    if (handleServiceError(error, res)) return;
    console.error('[Soc2CustomerEvidence] Error updating evidence metadata:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

/** DevControl-internal review action -- requirePlatformStaff, deliberately not
 * requireMember/requireAdmin. A customer can never review (approve) their own evidence. */
router.post('/:evidenceId/review', requirePlatformStaff, async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = req.organizationId;
    if (!organizationId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const reviewed = await service.reviewCustomerEvidence(organizationId, req.params.evidenceId, req.user?.userId ?? null);
    res.json({ success: true, customerEvidence: toPublicCustomerEvidence(reviewed) });
  } catch (error: unknown) {
    if (handleServiceError(error, res)) return;
    console.error('[Soc2CustomerEvidence] Error reviewing evidence:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

/** DevControl-internal, manual-only action -- requirePlatformStaff. Never triggered by
 * a cron/job; review_date is informational only and plays no role here. */
router.post('/:evidenceId/expire', requirePlatformStaff, async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = req.organizationId;
    if (!organizationId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const expired = await service.expireCustomerEvidence(organizationId, req.params.evidenceId, req.user?.userId ?? null);
    res.json({ success: true, customerEvidence: toPublicCustomerEvidence(expired) });
  } catch (error: unknown) {
    if (handleServiceError(error, res)) return;
    console.error('[Soc2CustomerEvidence] Error expiring evidence:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

/** DevControl-internal action -- requirePlatformStaff. Body carries the replacement
 * evidence's fields; criterionId (if supplied) must match the superseded record's own
 * criterion (enforced in the service) -- the write itself always uses the old record's
 * criterion_id regardless. */
router.post('/:evidenceId/supersede', requirePlatformStaff, async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = req.organizationId;
    if (!organizationId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const result = await service.supersedeCustomerEvidence(organizationId, req.params.evidenceId, req.user?.userId ?? null, {
      criterionId: req.body?.criterionId,
      evidenceType: req.body?.evidenceType,
      title: req.body?.title,
      description: req.body?.description,
      externalReference: req.body?.externalReference,
      reviewDate: req.body?.reviewDate,
    });

    res.json({
      success: true,
      superseded: toPublicCustomerEvidence(result.superseded),
      replacement: toPublicCustomerEvidence(result.replacement),
    });
  } catch (error: unknown) {
    if (handleServiceError(error, res)) return;
    console.error('[Soc2CustomerEvidence] Error superseding evidence:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

export default router;
