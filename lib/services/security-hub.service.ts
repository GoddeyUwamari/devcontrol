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

class SecurityHubService {
  private baseUrl = process.env.NEXT_PUBLIC_API_URL
    ? `${process.env.NEXT_PUBLIC_API_URL}/api/security-hub`
    : 'http://localhost:8080/api/security-hub';

  async getCapability(): Promise<SecurityHubCapability> {
    const response = await fetch(`${this.baseUrl}/capability`, { credentials: 'include' });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to fetch Security Hub capability' }));
      throw new Error(error.error || 'Failed to fetch Security Hub capability');
    }
    const data = await response.json();
    return {
      capabilityStatus: data.capabilityStatus,
      syncStatus: data.syncStatus,
      checkedAt: data.checkedAt,
      error: data.error,
      enabledStandards: data.enabledStandards ?? [],
    };
  }

  async getCisReadiness(): Promise<CisReadinessResult> {
    const response = await fetch(`${this.baseUrl}/frameworks/cis`, { credentials: 'include' });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to fetch CIS readiness' }));
      throw new Error(error.error || 'Failed to fetch CIS readiness');
    }
    const data = await response.json();
    return data.result;
  }

  async getPciReadiness(): Promise<PciReadinessResult> {
    const response = await fetch(`${this.baseUrl}/frameworks/pci`, { credentials: 'include' });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to fetch PCI DSS readiness' }));
      throw new Error(error.error || 'Failed to fetch PCI DSS readiness');
    }
    const data = await response.json();
    return data.result;
  }

  async getNistReadiness(): Promise<NistReadinessResult> {
    const response = await fetch(`${this.baseUrl}/frameworks/nist`, { credentials: 'include' });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to fetch NIST SP 800-53 Rev. 5 readiness' }));
      throw new Error(error.error || 'Failed to fetch NIST SP 800-53 Rev. 5 readiness');
    }
    const data = await response.json();
    return data.result;
  }

  async triggerSync(): Promise<void> {
    const response = await fetch(`${this.baseUrl}/sync`, {
      method: 'POST',
      credentials: 'include',
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to trigger Security Hub sync' }));
      throw new Error(error.error || 'Failed to trigger Security Hub sync');
    }
  }
}

export const securityHubService = new SecurityHubService();
