/**
 * Natural Language Query Service (Frontend)
 * Communicates with NL Query API
 */

export interface NLQueryIntent {
  action: 'navigate' | 'filter' | 'search';
  target: 'infrastructure' | 'services' | 'deployments' | 'alerts' | 'costs' | 'teams';
  filters?: Record<string, string>;
  explanation: string;
  confidence: 'high' | 'medium' | 'low';
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

class NLQueryServiceClient {
  async parseQuery(query: string): Promise<NLQueryIntent> {
    const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;

    if (!token) {
      throw new Error('Authentication required');
    }

    const response = await fetch(`${API_BASE_URL}/api/nl-query/parse`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ query }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'Failed to parse query');
    }

    const result = await response.json();
    return result.data;
  }
}

export const nlQueryService = new NLQueryServiceClient();
