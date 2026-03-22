/** Natural Language Query Service (Frontend) */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

export interface NLQueryIntent {
  action: 'navigate' | 'filter' | 'search';
  target: 'infrastructure' | 'services' | 'deployments' | 'alerts' | 'costs' | 'teams';
  filters?: Record<string, string>;
  explanation: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface NLQueryResultData {
  type: 'resources' | 'costs' | 'deployments' | 'alerts' | 'anomalies' | 'services' | 'empty';
  rows: any[];
  summary: string;
  columns: string[];
}

export interface NLQueryResult {
  intent: NLQueryIntent;
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
    if (!response.ok) throw new Error('Failed to execute query');
    const result = await response.json();
    return result.data;
  }
}

export const nlQueryService = new NLQueryServiceClient();
