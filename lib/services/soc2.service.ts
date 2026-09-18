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
 *
 * Authentication: uses the shared `api` Axios client from lib/api.ts, whose request
 * interceptor injects `Authorization: Bearer <accessToken>` from localStorage -- the same
 * mechanism every other authenticated frontend service uses (see risk-score.service.ts,
 * account-security-findings.service.ts, stripe.service.ts). The backend's authenticateToken
 * middleware only ever reads the Authorization header, never cookies, so this service must
 * not rely on a bespoke raw-fetch / cookie-credentialed mechanism.
 */

import { api } from '@/lib/api';
import axios from 'axios';

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

/**
 * Adapts an Axios failure into the service's existing Soc2ApiError contract: the HTTP
 * status (so callers can distinguish 401/402/403/404/500) and the backend's own `error`
 * message (falling back to a per-call default), exactly as the previous raw-fetch-based
 * implementation did with `response.status` / the parsed error body's `error` field.
 */
function toSoc2ApiError(error: unknown, fallbackMessage: string): Soc2ApiError {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { error?: string } | undefined;
    return apiError(data?.error || fallbackMessage, error.response?.status);
  }
  return apiError(error instanceof Error ? error.message : fallbackMessage);
}

class Soc2Service {
  private readonly basePath = '/api/soc2';

  async getReadiness(): Promise<Soc2ReadinessCriterion[]> {
    try {
      const response = await api.get(`${this.basePath}/readiness`);
      return response.data.criteria ?? [];
    } catch (error) {
      throw toSoc2ApiError(error, 'Failed to fetch SOC 2 readiness');
    }
  }

  async getReadinessDetail(criterionId: string): Promise<Soc2ReadinessDetail> {
    try {
      const response = await api.get(`${this.basePath}/readiness/${encodeURIComponent(criterionId)}`);
      return { criterion: response.data.criterion, evidence: response.data.evidence ?? [] };
    } catch (error) {
      throw toSoc2ApiError(error, 'Failed to fetch SOC 2 criterion detail');
    }
  }

  async getEvidence(criterionId?: string): Promise<Soc2Observation[]> {
    try {
      const response = await api.get(`${this.basePath}/evidence`, {
        params: criterionId ? { criterionId } : undefined,
      });
      return response.data.evidence ?? [];
    } catch (error) {
      throw toSoc2ApiError(error, 'Failed to fetch AWS-observed evidence');
    }
  }

  async getCustomerEvidence(criterionId?: string): Promise<Soc2CustomerEvidence[]> {
    try {
      const response = await api.get(`${this.basePath}/customer-evidence`, {
        params: criterionId ? { criterionId } : undefined,
      });
      return response.data.customerEvidence ?? [];
    } catch (error) {
      throw toSoc2ApiError(error, 'Failed to fetch customer evidence');
    }
  }

  async getCustomerEvidenceById(evidenceId: string): Promise<Soc2CustomerEvidence> {
    try {
      const response = await api.get(`${this.basePath}/customer-evidence/${encodeURIComponent(evidenceId)}`);
      return response.data.customerEvidence;
    } catch (error) {
      throw toSoc2ApiError(error, 'Failed to fetch evidence detail');
    }
  }

  async createCustomerEvidence(request: CreateCustomerEvidenceRequest): Promise<Soc2CustomerEvidence> {
    try {
      const response = await api.post(`${this.basePath}/customer-evidence`, request);
      return response.data.customerEvidence;
    } catch (error) {
      throw toSoc2ApiError(error, 'Failed to submit evidence');
    }
  }

  async updateCustomerEvidenceMetadata(
    evidenceId: string,
    request: UpdateCustomerEvidenceMetadataRequest
  ): Promise<Soc2CustomerEvidence> {
    try {
      const response = await api.patch(`${this.basePath}/customer-evidence/${encodeURIComponent(evidenceId)}`, request);
      return response.data.customerEvidence;
    } catch (error) {
      throw toSoc2ApiError(error, 'Failed to update evidence');
    }
  }
}

export const soc2Service = new Soc2Service();
