/**
 * SOC 2 Readiness Evidence Layer -- Phase 3 customer-evidence service.
 *
 * READ/WRITE only with respect to customer_evidence. This service:
 *   - NEVER calls any AWS SDK / AWS API -- no AWS client is instantiated here
 *   - NEVER calls Soc2EvidenceService's compute methods (computeAndPersistEvidence) or
 *     any other code path that writes soc2_evidence_observations/soc2_control_evaluations
 *   - NEVER writes to aws_resources.compliance_issues, account_security_findings,
 *     security_hub_findings, or Risk Score
 *   - NEVER triggers AWS resource discovery
 *   - Forces provenance to 'SELF_ATTESTED' and status to 'SUBMITTED' at creation,
 *     server-side only -- these are never read from caller input
 *   - Sources submitted_by/organization_id only from the authenticated request context
 *     the route layer passes in, never from a request body/query/path value
 *
 * EXTERNAL REFERENCE: stored as an opaque, length-bounded string only. This service
 * contains no HTTP/network client and performs no fetch, HEAD request, or content
 * retrieval of external_reference at any point -- see validateExternalReference below.
 */
import {
  CreateCustomerEvidenceInput,
  Soc2CustomerEvidenceRepository,
  SupersedeResult,
  UpdateCustomerEvidenceMetadataInput,
} from '../repositories/soc2-customer-evidence.repository';
import {
  SOC2_CUSTOMER_EVIDENCE_TYPES,
  Soc2CustomerEvidence,
  Soc2CustomerEvidenceType,
} from '../types/soc2-evidence.types';
import { getSoc2CriterionConfig } from '../config/soc2CriteriaConfig';
import { soc2CustomerEvidenceAuditService } from './soc2CustomerEvidenceAudit.service';

const TITLE_MAX_LENGTH = 200;
const DESCRIPTION_MAX_LENGTH = 2000;
const EXTERNAL_REFERENCE_MAX_LENGTH = 2000;

export class Soc2CustomerEvidenceValidationError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'Soc2CustomerEvidenceValidationError';
  }
}

/** Distinguishes "not found" from "found but in a status that forbids this
 * transition" -- both cases the repository collapses to `undefined`, so the service
 * does a precise existence check first to report the right one. */
export class Soc2CustomerEvidenceConflictError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'Soc2CustomerEvidenceConflictError';
  }
}

export interface CreateCustomerEvidenceRequest {
  criterionId: string;
  evidenceType: string;
  title: string;
  description?: string | null;
  externalReference?: string | null;
  reviewDate?: string | null;
}

export interface UpdateCustomerEvidenceMetadataRequest {
  evidenceType?: string;
  title?: string;
  description?: string | null;
  externalReference?: string | null;
  reviewDate?: string | null;
}

function validateCriterion(criterionId: unknown): string {
  if (typeof criterionId !== 'string' || !getSoc2CriterionConfig(criterionId)) {
    throw new Soc2CustomerEvidenceValidationError(
      `Unknown criterion "${String(criterionId)}".`,
      'INVALID_CRITERION'
    );
  }
  return criterionId;
}

function validateEvidenceType(evidenceType: unknown): Soc2CustomerEvidenceType {
  if (
    typeof evidenceType !== 'string' ||
    !SOC2_CUSTOMER_EVIDENCE_TYPES.includes(evidenceType as Soc2CustomerEvidenceType)
  ) {
    throw new Soc2CustomerEvidenceValidationError(
      `Unknown evidence type "${String(evidenceType)}". Supported: ${SOC2_CUSTOMER_EVIDENCE_TYPES.join(', ')}.`,
      'INVALID_EVIDENCE_TYPE'
    );
  }
  return evidenceType as Soc2CustomerEvidenceType;
}

function validateTitle(title: unknown): string {
  if (typeof title !== 'string' || title.trim().length === 0) {
    throw new Soc2CustomerEvidenceValidationError('title is required.', 'INVALID_TITLE');
  }
  if (title.length > TITLE_MAX_LENGTH) {
    throw new Soc2CustomerEvidenceValidationError(
      `title must be ${TITLE_MAX_LENGTH} characters or fewer.`,
      'INVALID_TITLE'
    );
  }
  return title;
}

function validateDescription(description: unknown): string | null {
  if (description === undefined || description === null) return null;
  if (typeof description !== 'string') {
    throw new Soc2CustomerEvidenceValidationError('description must be a string.', 'INVALID_DESCRIPTION');
  }
  if (description.length > DESCRIPTION_MAX_LENGTH) {
    throw new Soc2CustomerEvidenceValidationError(
      `description must be ${DESCRIPTION_MAX_LENGTH} characters or fewer.`,
      'INVALID_DESCRIPTION'
    );
  }
  return description;
}

/** Bounded-text validation only -- no URI-scheme allowlisting, no network client, no
 * fetch of any kind. DevControl stores this string; it never resolves it. */
function validateExternalReference(externalReference: unknown): string | null {
  if (externalReference === undefined || externalReference === null) return null;
  if (typeof externalReference !== 'string') {
    throw new Soc2CustomerEvidenceValidationError(
      'externalReference must be a string.',
      'INVALID_EXTERNAL_REFERENCE'
    );
  }
  if (externalReference.length > EXTERNAL_REFERENCE_MAX_LENGTH) {
    throw new Soc2CustomerEvidenceValidationError(
      `externalReference must be ${EXTERNAL_REFERENCE_MAX_LENGTH} characters or fewer.`,
      'INVALID_EXTERNAL_REFERENCE'
    );
  }
  return externalReference;
}

function validateReviewDate(reviewDate: unknown): Date | null {
  if (reviewDate === undefined || reviewDate === null) return null;
  if (typeof reviewDate !== 'string') {
    throw new Soc2CustomerEvidenceValidationError('reviewDate must be a string.', 'INVALID_REVIEW_DATE');
  }
  const parsed = new Date(reviewDate);
  if (Number.isNaN(parsed.getTime())) {
    throw new Soc2CustomerEvidenceValidationError('reviewDate is not a valid date.', 'INVALID_REVIEW_DATE');
  }
  return parsed;
}

export class Soc2CustomerEvidenceService {
  constructor(private repository: Soc2CustomerEvidenceRepository) {}

  async listCustomerEvidence(organizationId: string, criterionId?: string): Promise<Soc2CustomerEvidence[]> {
    if (criterionId !== undefined) validateCriterion(criterionId);
    return this.repository.getCustomerEvidence(organizationId, criterionId);
  }

  async getCustomerEvidenceDetail(
    organizationId: string,
    evidenceId: string
  ): Promise<Soc2CustomerEvidence | undefined> {
    return this.repository.getCustomerEvidenceById(organizationId, evidenceId);
  }

  async createCustomerEvidence(
    organizationId: string,
    actorUserId: string | null,
    request: CreateCustomerEvidenceRequest
  ): Promise<Soc2CustomerEvidence> {
    const criterionId = validateCriterion(request.criterionId);
    const evidenceType = validateEvidenceType(request.evidenceType);
    const title = validateTitle(request.title);
    const description = validateDescription(request.description);
    const externalReference = validateExternalReference(request.externalReference);
    const reviewDate = validateReviewDate(request.reviewDate);

    const input: CreateCustomerEvidenceInput = {
      criterion_id: criterionId,
      evidence_type: evidenceType,
      title,
      description,
      external_reference: externalReference,
      submitted_by: actorUserId,
      review_date: reviewDate,
    };

    const created = await this.repository.createCustomerEvidence(organizationId, input);

    await soc2CustomerEvidenceAuditService.record({
      organizationId,
      action: 'soc2_customer_evidence.created',
      actorId: actorUserId ?? undefined,
      resourceId: created.id,
      metadata: { criterionId, evidenceType },
    });

    return created;
  }

  async updateCustomerEvidenceMetadata(
    organizationId: string,
    evidenceId: string,
    actorUserId: string | null,
    request: UpdateCustomerEvidenceMetadataRequest
  ): Promise<Soc2CustomerEvidence> {
    const existing = await this.repository.getCustomerEvidenceById(organizationId, evidenceId);
    if (!existing) {
      throw new Soc2CustomerEvidenceConflictError('Evidence not found.', 'NOT_FOUND');
    }
    if (existing.status !== 'SUBMITTED') {
      throw new Soc2CustomerEvidenceConflictError(
        `Evidence metadata can only be edited while status is SUBMITTED (current status: ${existing.status}). Use supersede instead.`,
        'INVALID_STATUS_FOR_EDIT'
      );
    }

    const patch: UpdateCustomerEvidenceMetadataInput = {};
    if (request.evidenceType !== undefined) patch.evidence_type = validateEvidenceType(request.evidenceType);
    if (request.title !== undefined) patch.title = validateTitle(request.title);
    if ('description' in request) patch.description = validateDescription(request.description);
    if ('externalReference' in request) patch.external_reference = validateExternalReference(request.externalReference);
    if ('reviewDate' in request) patch.review_date = validateReviewDate(request.reviewDate);

    const updated = await this.repository.updateCustomerEvidenceMetadata(organizationId, evidenceId, patch);
    if (!updated) {
      // Existence + status were just confirmed above; a race (e.g. concurrent
      // supersede) is the only remaining explanation.
      throw new Soc2CustomerEvidenceConflictError(
        'Evidence status changed before the update could be applied.',
        'CONFLICT'
      );
    }

    await soc2CustomerEvidenceAuditService.record({
      organizationId,
      action: 'soc2_customer_evidence.metadata_updated',
      actorId: actorUserId ?? undefined,
      resourceId: evidenceId,
      metadata: { fieldsUpdated: Object.keys(patch) },
    });

    return updated;
  }

  /** DevControl-internal action only -- the route layer must gate this with
   * requirePlatformStaff, never requireMember/requireAdmin. This method itself does not
   * re-check that authorization; it trusts the route layer, exactly like
   * soc2.routes.ts trusts authenticateToken/requireEnterprise upstream of it. */
  async reviewCustomerEvidence(
    organizationId: string,
    evidenceId: string,
    actorUserId: string | null
  ): Promise<Soc2CustomerEvidence> {
    const existing = await this.repository.getCustomerEvidenceById(organizationId, evidenceId);
    if (!existing) {
      throw new Soc2CustomerEvidenceConflictError('Evidence not found.', 'NOT_FOUND');
    }
    if (existing.status !== 'SUBMITTED') {
      throw new Soc2CustomerEvidenceConflictError(
        `Only SUBMITTED evidence can be reviewed (current status: ${existing.status}).`,
        'INVALID_STATUS_TRANSITION'
      );
    }

    const reviewed = await this.repository.reviewCustomerEvidence(organizationId, evidenceId);
    if (!reviewed) {
      throw new Soc2CustomerEvidenceConflictError('Evidence status changed before it could be reviewed.', 'CONFLICT');
    }

    await soc2CustomerEvidenceAuditService.record({
      organizationId,
      action: 'soc2_customer_evidence.reviewed',
      actorId: actorUserId ?? undefined,
      resourceId: evidenceId,
      metadata: { criterionId: reviewed.criterion_id },
    });

    return reviewed;
  }

  /** DevControl-internal, manual action only -- never triggered automatically, and
   * never based on review_date (informational only, see the type's docblock). */
  async expireCustomerEvidence(
    organizationId: string,
    evidenceId: string,
    actorUserId: string | null
  ): Promise<Soc2CustomerEvidence> {
    const existing = await this.repository.getCustomerEvidenceById(organizationId, evidenceId);
    if (!existing) {
      throw new Soc2CustomerEvidenceConflictError('Evidence not found.', 'NOT_FOUND');
    }
    if (existing.status !== 'SUBMITTED' && existing.status !== 'REVIEWED') {
      throw new Soc2CustomerEvidenceConflictError(
        `Only SUBMITTED or REVIEWED evidence can be expired (current status: ${existing.status}).`,
        'INVALID_STATUS_TRANSITION'
      );
    }

    const expired = await this.repository.expireCustomerEvidence(organizationId, evidenceId);
    if (!expired) {
      throw new Soc2CustomerEvidenceConflictError('Evidence status changed before it could be expired.', 'CONFLICT');
    }

    await soc2CustomerEvidenceAuditService.record({
      organizationId,
      action: 'soc2_customer_evidence.expired',
      actorId: actorUserId ?? undefined,
      resourceId: evidenceId,
      metadata: { criterionId: expired.criterion_id },
    });

    return expired;
  }

  /** DevControl-internal action only. Orchestrates the repository's single
   * transactional supersede -- this method does not itself open a transaction; the
   * atomicity guarantee lives entirely in
   * Soc2CustomerEvidenceRepository.supersedeCustomerEvidence. */
  async supersedeCustomerEvidence(
    organizationId: string,
    oldEvidenceId: string,
    actorUserId: string | null,
    replacement: CreateCustomerEvidenceRequest
  ): Promise<SupersedeResult> {
    const existing = await this.repository.getCustomerEvidenceById(organizationId, oldEvidenceId);
    if (!existing) {
      throw new Soc2CustomerEvidenceConflictError('Evidence not found.', 'NOT_FOUND');
    }
    if (existing.status !== 'SUBMITTED' && existing.status !== 'REVIEWED') {
      throw new Soc2CustomerEvidenceConflictError(
        `Only SUBMITTED or REVIEWED evidence can be superseded (current status: ${existing.status}).`,
        'INVALID_STATUS_TRANSITION'
      );
    }

    // criterionId is intentionally NOT taken from `replacement` for the write itself --
    // the repository forces the replacement onto the old record's own criterion_id.
    // Still validated here so a client sending a mismatched criterionId gets a clear
    // 400 rather than a silently-ignored field.
    const suppliedCriterionId = validateCriterion(replacement.criterionId);
    if (suppliedCriterionId !== existing.criterion_id) {
      throw new Soc2CustomerEvidenceValidationError(
        `Replacement criterionId must match the superseded record's criterion ("${existing.criterion_id}").`,
        'CRITERION_MISMATCH'
      );
    }
    const evidenceType = validateEvidenceType(replacement.evidenceType);
    const title = validateTitle(replacement.title);
    const description = validateDescription(replacement.description);
    const externalReference = validateExternalReference(replacement.externalReference);
    const reviewDate = validateReviewDate(replacement.reviewDate);

    const result = await this.repository.supersedeCustomerEvidence(organizationId, oldEvidenceId, {
      evidence_type: evidenceType,
      title,
      description,
      external_reference: externalReference,
      submitted_by: actorUserId,
      review_date: reviewDate,
    });

    if (!result) {
      throw new Soc2CustomerEvidenceConflictError('Evidence status changed before it could be superseded.', 'CONFLICT');
    }

    await soc2CustomerEvidenceAuditService.record({
      organizationId,
      action: 'soc2_customer_evidence.superseded',
      actorId: actorUserId ?? undefined,
      resourceId: result.superseded.id,
      metadata: { criterionId: result.superseded.criterion_id, replacementId: result.replacement.id },
    });
    await soc2CustomerEvidenceAuditService.record({
      organizationId,
      action: 'soc2_customer_evidence.created',
      actorId: actorUserId ?? undefined,
      resourceId: result.replacement.id,
      metadata: { criterionId: result.replacement.criterion_id, evidenceType, supersedesId: result.superseded.id },
    });

    return result;
  }
}
