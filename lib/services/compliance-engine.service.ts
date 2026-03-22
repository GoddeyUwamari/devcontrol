const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

export type ControlStatus = 'pass' | 'fail' | 'not_applicable';
export type ControlSeverity = 'critical' | 'high' | 'medium' | 'low';
export type ControlFramework = 'soc2' | 'hipaa';

export interface ControlEvidence {
  totalResources?: number;
  passingCount?: number;
  failingCount?: number;
  details?: string;
}

export interface ControlResult {
  id: string;
  controlId: string;
  framework: ControlFramework;
  category: string;
  name: string;
  description: string;
  severity: ControlSeverity;
  status: ControlStatus;
  score: number;
  evidence: ControlEvidence;
  remediationGuidance: string;
}

export interface FrameworkScanResult {
  framework: ControlFramework;
  overallScore: number;
  controlsPassed: number;
  controlsFailed: number;
  controlsTotal: number;
  controlResults: ControlResult[];
  scannedAt: string;
}

function authHeaders(): HeadersInit {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  return token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
}

export const complianceEngineService = {
  /** Get latest cached results for both frameworks */
  async getAllResults(): Promise<{ soc2: FrameworkScanResult | null; hipaa: FrameworkScanResult | null }> {
    const res = await fetch(`${API_BASE}/api/compliance/results`, { headers: authHeaders() });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed to fetch compliance results');
    return data.results;
  },

  /** Get latest cached result for one framework */
  async getResult(framework: ControlFramework): Promise<FrameworkScanResult | null> {
    const res = await fetch(`${API_BASE}/api/compliance/results/${framework}`, { headers: authHeaders() });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed to fetch compliance result');
    return data.result;
  },

  /** Run a fresh scan for all frameworks (Enterprise) */
  async runAllScans(): Promise<{ soc2: FrameworkScanResult; hipaa: FrameworkScanResult }> {
    const res = await fetch(`${API_BASE}/api/compliance/scan`, {
      method: 'POST',
      headers: authHeaders(),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Compliance scan failed');
    return data.results;
  },

  /** Run a fresh scan for one framework (Enterprise) */
  async runScan(framework: ControlFramework): Promise<FrameworkScanResult> {
    const res = await fetch(`${API_BASE}/api/compliance/scan/${framework}`, {
      method: 'POST',
      headers: authHeaders(),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Compliance scan failed');
    return data.result;
  },

  /** Get historical scores for trend chart */
  async getHistory(framework: ControlFramework, days = 90): Promise<Array<{ scannedAt: string; score: number }>> {
    const res = await fetch(`${API_BASE}/api/compliance/history/${framework}?days=${days}`, {
      headers: authHeaders(),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed to fetch history');
    return data.history;
  },

  /** Download PDF audit report — returns blob URL */
  getReportUrl(framework: ControlFramework): string {
    return `${API_BASE}/api/compliance/report/${framework}`;
  },
};
