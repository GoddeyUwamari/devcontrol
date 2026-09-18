/**
 * SOC 2 Readiness Evidence Layer -- Phase 4 frontend service.
 *
 * Talks to the already-deployed Phase 2 (technical readiness, GET /api/soc2/readiness*)
 * and Phase 3 (customer evidence, /api/soc2/customer-evidence*) APIs. Every field below
 * mirrors the backend's real response shape exactly (see backend/src/routes/soc2.routes.ts
 * and soc2-customer-evidence.routes.ts) -- no field here is invented.
 *
 * This service performs NO fetch/proxy of externalReference, NEVER computes a combined
 * score, and NEVER exposes review/expire/supersede -- those are DevControl-internal
 * (requirePlatformStaff) actions with no customer-facing UI representation here.
 */

// ---- Phase 2: technical readiness ---------------------------------------

export type Soc2DispositionClass =
  | 'A_OBSERVABLE'
  | 'B_DERIVABLE'
  | 'C_SELF_ATTESTED'
  | 'D_ADDITIONAL_EVIDENCE'
  | 'E_NOT_ESTABLISHABLE';

export type Soc2EvidenceProvenance = 'OBSERVED' | 'DERIVED' | 'SELF_ATTESTED';
export type Soc2EvidenceResult = 'SUPPORTS' | 'CONTRADICTS' | 'UNKNOWN';

export interface Soc2EvidenceSummary {
  supports: number;
  contradicts: number;
  unknown: number;
}

export interface Soc2ReadinessCriterion {
  criterionId: string;
  name: string;
  evidenceClaim: string;
  limitation: string;
  dispositionClass: Soc2DispositionClass;
  evaluated: boolean;
  evidenceSummary: Soc2EvidenceSummary | null;
  computedAt: string | null;
}

export interface Soc2Observation {
  criterionId: string;
  resourceArn: string | null;
  resourceType: string;
  provenance: Soc2EvidenceProvenance;
  result: Soc2EvidenceResult;
  observedAt: string | null;
  collectedAt: string;
  source: Record<string, unknown>;
  explanation: string;
  schemaVersion: number;
}

export interface Soc2ReadinessDetail {
  criterion: Soc2ReadinessCriterion;
  evidence: Soc2Observation[];
}

// ---- Phase 3: customer-provided evidence ---------------------------------

export type Soc2CustomerEvidenceStatus = 'SUBMITTED' | 'REVIEWED' | 'EXPIRED' | 'SUPERSEDED';
export type Soc2CustomerEvidenceType = 'policy' | 'procedure' | 'training' | 'attestation' | 'other';

export interface Soc2CustomerEvidence {
  evidenceId: string;
  criterionId: string;
  evidenceType: Soc2CustomerEvidenceType;
  title: string;
  description: string | null;
  externalReference: string | null;
  provenance: 'SELF_ATTESTED';
  status: Soc2CustomerEvidenceStatus;
  submittedBy: string | null;
  submittedAt: string;
  reviewDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCustomerEvidenceRequest {
  criterionId: string;
  evidenceType: Soc2CustomerEvidenceType;
  title: string;
  description?: string | null;
  externalReference?: string | null;
  reviewDate?: string | null;
}

/** PATCH accepts only these fields -- never provenance/status/organizationId/submittedBy,
 * matching backend/src/routes/soc2-customer-evidence.routes.ts's PATCH handler exactly. */
export interface UpdateCustomerEvidenceMetadataRequest {
  evidenceType?: Soc2CustomerEvidenceType;
  title?: string;
  description?: string | null;
  externalReference?: string | null;
  reviewDate?: string | null;
}

/** A thrown Error augmented with the HTTP status, so callers can distinguish 402
 * (Enterprise required) from other failures without a new error-handling abstraction. */
export interface Soc2ApiError extends Error {
  statusCode?: number;
}

function apiError(message: string, statusCode?: number): Soc2ApiError {
  const err = new Error(message) as Soc2ApiError;
  err.statusCode = statusCode;
  return err;
}

class Soc2Service {
  private baseUrl = process.env.NEXT_PUBLIC_API_URL
    ? `${process.env.NEXT_PUBLIC_API_URL}/api/soc2`
    : 'http://localhost:8080/api/soc2';

  async getReadiness(): Promise<Soc2ReadinessCriterion[]> {
    const response = await fetch(`${this.baseUrl}/readiness`, { credentials: 'include' });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to fetch SOC 2 readiness' }));
      throw apiError(error.error || 'Failed to fetch SOC 2 readiness', response.status);
    }
    const data = await response.json();
    return data.criteria ?? [];
  }

  async getReadinessDetail(criterionId: string): Promise<Soc2ReadinessDetail> {
    const response = await fetch(`${this.baseUrl}/readiness/${encodeURIComponent(criterionId)}`, { credentials: 'include' });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to fetch SOC 2 criterion detail' }));
      throw apiError(error.error || 'Failed to fetch SOC 2 criterion detail', response.status);
    }
    const data = await response.json();
    return { criterion: data.criterion, evidence: data.evidence ?? [] };
  }

  async getEvidence(criterionId?: string): Promise<Soc2Observation[]> {
    const qs = criterionId ? `?criterionId=${encodeURIComponent(criterionId)}` : '';
    const response = await fetch(`${this.baseUrl}/evidence${qs}`, { credentials: 'include' });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to fetch AWS-observed evidence' }));
      throw apiError(error.error || 'Failed to fetch AWS-observed evidence', response.status);
    }
    const data = await response.json();
    return data.evidence ?? [];
  }

  async getCustomerEvidence(criterionId?: string): Promise<Soc2CustomerEvidence[]> {
    const qs = criterionId ? `?criterionId=${encodeURIComponent(criterionId)}` : '';
    const response = await fetch(`${this.baseUrl}/customer-evidence${qs}`, { credentials: 'include' });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to fetch customer evidence' }));
      throw apiError(error.error || 'Failed to fetch customer evidence', response.status);
    }
    const data = await response.json();
    return data.customerEvidence ?? [];
  }

  async getCustomerEvidenceById(evidenceId: string): Promise<Soc2CustomerEvidence> {
    const response = await fetch(`${this.baseUrl}/customer-evidence/${encodeURIComponent(evidenceId)}`, { credentials: 'include' });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to fetch evidence detail' }));
      throw apiError(error.error || 'Failed to fetch evidence detail', response.status);
    }
    const data = await response.json();
    return data.customerEvidence;
  }

  async createCustomerEvidence(request: CreateCustomerEvidenceRequest): Promise<Soc2CustomerEvidence> {
    const response = await fetch(`${this.baseUrl}/customer-evidence`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to submit evidence' }));
      throw apiError(error.error || 'Failed to submit evidence', response.status);
    }
    const data = await response.json();
    return data.customerEvidence;
  }

  async updateCustomerEvidenceMetadata(
    evidenceId: string,
    request: UpdateCustomerEvidenceMetadataRequest
  ): Promise<Soc2CustomerEvidence> {
    const response = await fetch(`${this.baseUrl}/customer-evidence/${encodeURIComponent(evidenceId)}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to update evidence' }));
      throw apiError(error.error || 'Failed to update evidence', response.status);
    }
    const data = await response.json();
    return data.customerEvidence;
  }
}

export const soc2Service = new Soc2Service();
