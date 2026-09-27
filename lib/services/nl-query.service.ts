/** Natural Language Query Service (Frontend) */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

export interface NLQueryIntent {
  action: 'navigate' | 'filter' | 'search';
  target: 'infrastructure' | 'services' | 'deployments' | 'alerts' | 'costs' | 'teams';
  filters?: Record<string, string>;
  explanation: string;
  confidence: 'high' | 'medium' | 'low';
}

/**
 * answered      = evidence obtained (including an actual $0 spend)
 * no_results    = the query ran over available data and matched nothing
 * unavailable   = the data source has nothing to query
 * not_supported = DevControl has no evidence for this kind of question
 * error         = the query failed (sent as HTTP 500, never as an empty result)
 */
export type NLQueryOutcome = 'answered' | 'no_results' | 'unavailable' | 'not_supported' | 'error';

export interface NLQueryEvidence {
  state: 'available' | 'partial' | 'unavailable' | 'error' | 'not_supported';
  source: string;
  provenance: 'actual' | 'estimated' | 'derived' | null;
  period: unknown;
  asOf: string | null;
  reason: string | null;
}

export interface NLQueryResultData {
  type: 'resources' | 'costs' | 'deployments' | 'services' | 'none';
  outcome: NLQueryOutcome;
  rows: any[];
  summary: string;
  columns: string[];
  evidence: NLQueryEvidence;
}

export interface NLQueryResult {
  /** Validated intent; `explanation` is written by DevControl, not the model. */
  intent: { target: string; filters: Record<string, unknown>; explanation: string };
  data: NLQueryResultData;
  executedAt: string;
  rowCount: number;
  executionMs: number;
}

class NLQueryServiceClient {
  private getHeaders() {
    const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
    return {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }

  /** Legacy: parse intent only (no data) */
  async parseQuery(query: string): Promise<NLQueryIntent> {
    const response = await fetch(`${API_BASE_URL}/api/nl-query/parse`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ query }),
    });
    if (!response.ok) throw new Error('Failed to parse query');
    const result = await response.json();
    return result.data;
  }

  /** New: parse intent AND return real AWS data */
  async executeQuery(query: string): Promise<NLQueryResult> {
    const response = await fetch(`${API_BASE_URL}/api/nl-query/execute`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ query }),
    });
    if (!response.ok) {
      // The server's message is already sanitized (never raw SQL/AWS detail).
      const body = await response.json().catch(() => null);
      const err = new Error(typeof body?.message === 'string' ? body.message : 'Failed to execute query');
      (err as any).status = response.status;
      throw err;
    }
    const result = await response.json();
    return result.data;
  }
}

export const nlQueryService = new NLQueryServiceClient();
