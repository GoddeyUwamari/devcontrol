/**
 * Authentication: uses the shared `api` Axios client from lib/api.ts, whose request
 * interceptor injects `Authorization: Bearer <accessToken>` -- the same mechanism
 * soc2.service.ts and every other authenticated frontend service use. The backend's
 * authenticateToken middleware only ever reads the Authorization header, never cookies,
 * so this service must not rely on a bespoke or cookie-credentialed request mechanism.
 */

import { api } from '@/lib/api';
import axios from 'axios';

export type SecurityHubCapabilityStatus = 'NOT_GRANTED' | 'NOT_AVAILABLE' | 'ENABLED' | 'ERROR';
export type SecurityHubSyncStatus = 'NEVER_RUN' | 'RUNNING' | 'COMPLETED' | 'PARTIAL' | 'FAILED';
export type FoundationControlStatus =
  | 'PASS'
  | 'FAIL'
  | 'NOT_APPLICABLE'
  | 'UNKNOWN'
  | 'NOT_EVALUATED'
  | 'ERROR'
  | 'NOT_ESTABLISHABLE';

export interface SecurityHubCapability {
  capabilityStatus: SecurityHubCapabilityStatus | null;
  syncStatus: SecurityHubSyncStatus;
  checkedAt: string | null;
  error: string | null;
  enabledStandards: Array<{ standardsArn: string; standardsSubscriptionArn: string; name: string; enabled: boolean }>;
}

export interface FrameworkCoverage {
  totalControls: number;
  evaluated: number;
  passed: number;
  failed: number;
  unknown: number;
  notEvaluated: number;
  notApplicable: number;
  notEstablishable: number;
  errors: number;
}

export interface FrameworkControlResult {
  controlId: string;
  title: string;
  securityHubControlId: string | null;
  status: FoundationControlStatus;
  reason: string;
  mappingType?: 'DIRECT' | 'ADDITIONAL_EVIDENCE';
}

export interface CisReadinessResult {
  framework: 'cis';
  frameworkVersion: string;
  syncStatus: SecurityHubSyncStatus;
  capabilityStatus: SecurityHubCapabilityStatus | null;
  standardEnabled: boolean | null;
  evaluatedAt: string | null;
  coverage: FrameworkCoverage;
  controls: FrameworkControlResult[];
}

export interface PciReadinessResult {
  framework: 'pci';
  frameworkVersion: string;
  syncStatus: SecurityHubSyncStatus;
  capabilityStatus: SecurityHubCapabilityStatus | null;
  standardEnabled: boolean | null;
  evaluatedAt: string | null;
  coverage: FrameworkCoverage;
  controls: FrameworkControlResult[];
}

export interface NistReadinessResult {
  framework: 'nist';
  frameworkVersion: string;
  syncStatus: SecurityHubSyncStatus;
  capabilityStatus: SecurityHubCapabilityStatus | null;
  standardEnabled: boolean | null;
  evaluatedAt: string | null;
  coverage: FrameworkCoverage;
  controls: FrameworkControlResult[];
}

/** A thrown Error augmented with the HTTP status, so callers can distinguish 401 (not
 * authenticated) from 402 (tier) or 5xx without a new error-handling abstraction. */
export interface SecurityHubApiError extends Error {
  statusCode?: number;
}

/**
 * Adapts an Axios failure into an Error whose `message` is the backend's own `error`
 * string (what the hook and page have always surfaced) rather than Axios's generic
 * "Request failed with status code N", and whose `statusCode` is the HTTP status. Anything
 * without a usable string message -- a network failure, a non-JSON body, a non-Axios
 * error -- gets the caller's stable fallback; no response internals are ever exposed.
 */
function toSecurityHubApiError(error: unknown, fallbackMessage: string): SecurityHubApiError {
  let message = fallbackMessage;
  let statusCode: number | undefined;

  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { error?: unknown } | null | undefined;
    if (typeof data?.error === 'string' && data.error.length > 0) {
      message = data.error;
    }
    statusCode = error.response?.status;
  }

  const apiError = new Error(message) as SecurityHubApiError;
  apiError.statusCode = statusCode;
  return apiError;
}

class SecurityHubService {
  private readonly basePath = '/api/security-hub';

  async getCapability(): Promise<SecurityHubCapability> {
    try {
      const response = await api.get(`${this.basePath}/capability`);
      const data = response.data;
      return {
        capabilityStatus: data.capabilityStatus,
        syncStatus: data.syncStatus,
        checkedAt: data.checkedAt,
        error: data.error,
        enabledStandards: data.enabledStandards ?? [],
      };
    } catch (error) {
      throw toSecurityHubApiError(error, 'Failed to fetch Security Hub capability');
    }
  }

  async getCisReadiness(): Promise<CisReadinessResult> {
    try {
      const response = await api.get(`${this.basePath}/frameworks/cis`);
      return response.data.result;
    } catch (error) {
      throw toSecurityHubApiError(error, 'Failed to fetch CIS readiness');
    }
  }

  async getPciReadiness(): Promise<PciReadinessResult> {
    try {
      const response = await api.get(`${this.basePath}/frameworks/pci`);
      return response.data.result;
    } catch (error) {
      throw toSecurityHubApiError(error, 'Failed to fetch PCI DSS readiness');
    }
  }

  async getNistReadiness(): Promise<NistReadinessResult> {
    try {
      const response = await api.get(`${this.basePath}/frameworks/nist`);
      return response.data.result;
    } catch (error) {
      throw toSecurityHubApiError(error, 'Failed to fetch NIST SP 800-53 Rev. 5 readiness');
    }
  }

  async triggerSync(): Promise<void> {
    try {
      await api.post(`${this.basePath}/sync`);
    } catch (error) {
      throw toSecurityHubApiError(error, 'Failed to trigger Security Hub sync');
    }
  }
}

export const securityHubService = new SecurityHubService();
