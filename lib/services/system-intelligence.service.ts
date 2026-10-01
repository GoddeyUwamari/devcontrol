import api, { handleApiResponse } from '../api';

/** The backend's ContextDataState, as carried on every component and the composite. */
export type EvidenceState = 'available' | 'partial' | 'unavailable' | 'error' | 'not_supported';

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
  /** Evidence behind the score; 'partial' means reason lists what it does not stand on. Never changes the score. */
  state: EvidenceState;
  reason: string | null;
}

/**
 * Observability's score is null whenever nothing was measured (never 0 from a
 * failure), and 'partial' means it measures EC2/RDS alert coverage only --
 * reason says so.
 */
export interface ObservabilityComponentScore extends Omit<SystemIntelligenceComponentScore, 'score'> {
  score: number | null;
}

export interface SystemIntelligenceResult {
  system_score: number | null;
  /** 'partial' when system_score is built on any partial component; composite_reason names each one and why. null with a null score. */
  composite_state: 'available' | 'partial' | null;
  composite_reason: string | null;
  status: 'Healthy' | 'Stable' | 'Degraded' | 'At Risk' | 'Pending';
  components: {
    cost: SystemIntelligenceComponentScore;
    security: SystemIntelligenceComponentScore;
    observability: ObservabilityComponentScore;
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
