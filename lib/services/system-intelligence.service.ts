import api, { handleApiResponse } from '../api';

export interface SystemIntelligenceComponentScore {
  score: number;
  label: string;
  detail: string;
  severity: 'critical' | 'high' | 'medium' | 'healthy';
  delta: number | null;
  status: 'good' | 'warning' | 'risk';
  ready: boolean;
  monthlySpend?: number;
  costSource?: 'actual' | 'estimated';
}

export interface SystemIntelligenceResult {
  system_score: number | null;
  status: 'Healthy' | 'Stable' | 'Degraded' | 'At Risk' | 'Pending';
  components: {
    cost: SystemIntelligenceComponentScore;
    security: SystemIntelligenceComponentScore;
    observability: SystemIntelligenceComponentScore;
  };
  top_action: {
    message: string;
    consequence: string;
    path: string;
    severity: 'critical' | 'high' | 'medium';
  } | null;
  top_drivers: unknown[];
  computed_at: string;
}

export const systemIntelligenceService = {
  /**
   * The same canonical computation the Infrastructure page already consumes
   * (GET /api/observability/intelligence, backed by SystemIntelligenceService's
   * shared 2-minute cache) -- so the Dashboard's numeric health KPI reads the
   * identical deterministic score instead of an LLM-mediated copy of it.
   */
  getIntelligence: async (): Promise<SystemIntelligenceResult> => {
    const response = await api.get('/api/observability/intelligence');
    return handleApiResponse(response);
  },
};
