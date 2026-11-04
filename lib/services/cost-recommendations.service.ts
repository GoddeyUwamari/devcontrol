import api, { handleApiResponse } from '../api';
import type {
  CostRecommendation,
  RecommendationStats,
  AnalysisResult,
  AnalysisCounts,
  ApiResponse,
} from '../types';

// Sanitized shape returned by GET /api/cost-recommendations/analysis-runs --
// see CostRecommendationsController.getAnalysisRuns(): error_message here is
// already a safe, classified string (or null), never the raw stored error.
export interface CostAnalysisRun {
  id: string;
  status: 'running' | 'completed' | 'failed';
  recommendations_found: number | null;
  total_potential_savings: string | null;
  started_at: string;
  completed_at: string | null;
  created_at: string;
  error_message: string | null;
  // Added by the run record (PR 1). Optional: an older backend omits them.
  // Every count is null when not recorded, never 0.
  run_state?: CostAnalysisRunState;
  source?: 'manual' | 'discovery';
  detected_count?: number | null;
  new_count?: number | null;
  refreshed_count?: number | null;
  suppressed_resolved_count?: number | null;
  suppressed_dismissed_count?: number | null;
  duplicate_count?: number | null;
  persisted_count?: number | null;
  failed_detector_count?: number | null;
  unknown_resource_count?: number | null;
  checks?: CostAnalysisCheck[] | null;
}

export type CostAnalysisRunState = 'running' | 'completed' | 'partial' | 'failed' | 'interrupted';

/** One detector's result in a run. Never error text, ARNs or resource IDs. */
export interface CostAnalysisCheck {
  rule_id: string | null;
  issue: string;
  outcome: 'complete' | 'failed';
  detected: number;
  unknown: number;
}

// GET /api/cost-recommendations/hidden (PR 3a): resolved and dismissed
// findings, one item per finding, each judged by the backend's still-detected
// rule. The page renders these fields as given and never derives them.
export type HiddenDetectionState = 'still_detected' | 'not_confirmed';
export type NotConfirmedReason = 'not_checked_since' | 'check_failed' | 'not_fully_checked' | 'analysis_incomplete';

export interface HiddenFinding {
  /** The latest decision row's id; reopen and dismiss act on it. */
  id: string;
  decision: 'RESOLVED' | 'DISMISSED';
  decidedAt: string;
  decidedBy: string | null;
  decisionCount: number;
  issue: string;
  resourceId: string;
  resourceName: string | null;
  resourceType: string;
  awsRegion: string | null;
  detection: {
    state: HiddenDetectionState;
    reason: NotConfirmedReason | null;
    lastDetectedAt: string | null;
    potentialSavings: number | null;
    savingsBasis: string | null;
    severity: string | null;
    description: string | null;
  };
}

export interface HiddenFindings {
  latestRun: { id: string; runState: string; completedAt: string | null } | null;
  summary: {
    resolved: number;
    dismissed: number;
    stillDetected: {
      count: number;
      estimatedMonthlySavings: number;
      ceilingMonthlySavings: number;
      ceilingByResourceType: Record<string, number>;
    };
    notConfirmed: number;
  };
  items: HiddenFinding[];
}

/** POST /api/cost-recommendations/:id/reopen */
export type ReopenOutcome =
  | { reopened: true; rowsEnded: number; activeNow: boolean }
  | { reopened: false; reason: 'already_open' };

// Mirrors backend/src/config/optimization-rules.ts -- the Optimization Rule
// Registry. 'implemented' means a real analyzer runs for it today
// (cost-optimization.service.ts); 'planned' means it's registered for
// roadmap/UI purposes only and produces no recommendations yet. `issue` is
// only present for 'implemented' rules.
export type OptimizationRuleStatus = 'implemented' | 'planned';

// Enterprise Workstream 3B: static parameter DEFINITIONS only (type/default/
// min/max/unit) -- never any organization's actual configured value. Present
// on every rule (empty array when not configurable) since this comes from
// the non-Enterprise-gated GET /optimization-rules catalog -- see
// getOptimizationRuleConfiguration() below for the separate, Enterprise-
// gated endpoint that returns an organization's real effective value.
export interface OptimizationRuleParameterDefinition {
  parameterId: string;
  type: 'number' | 'integer';
  default: number;
  min: number;
  max: number;
  unit: string;
}

export interface OptimizationRule {
  id: string;
  service: string;
  name: string;
  detail: string;
  status: OptimizationRuleStatus;
  issue?: string;
  configurable: boolean;
  parameters: OptimizationRuleParameterDefinition[];
}

export type OptimizationRuleConfigSource = 'default' | 'organization_override';

// One entry per configurable (ruleId, parameterId) pair, scoped to the
// caller's own organization -- returned only by the Enterprise-gated
// GET /optimization-rules/configuration endpoint.
export interface EffectiveOptimizationRuleConfig {
  ruleId: string;
  parameterId: string;
  value: number;
  source: OptimizationRuleConfigSource;
  default: number;
  min: number;
  max: number;
  unit: string;
  type: 'number' | 'integer';
}

export interface OptimizationRuleServiceCoverage {
  service: string;
  implementedCount: number;
  plannedCount: number;
  totalCount: number;
}

export interface OptimizationRuleSummary {
  totalRules: number;
  implementedCount: number;
  plannedCount: number;
  services: OptimizationRuleServiceCoverage[];
}

export interface OptimizationRuleCatalog {
  rules: OptimizationRule[];
  summary: OptimizationRuleSummary;
}

/** POST /analyze `counts`: null unless every count is a number (never coerced to 0). */
function parseAnalysisCounts(raw: unknown): AnalysisCounts | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  const keys = ['detected', 'new', 'refreshed', 'suppressedResolved', 'suppressedDismissed', 'duplicate', 'persisted'] as const;
  if (!keys.every((key) => typeof c[key] === 'number')) return null;
  return {
    detected: c.detected as number,
    new: c.new as number,
    refreshed: c.refreshed as number,
    suppressedResolved: c.suppressedResolved as number,
    suppressedDismissed: c.suppressedDismissed as number,
    duplicate: c.duplicate as number,
    persisted: c.persisted as number,
  };
}

export const costRecommendationsService = {
  // Get all recommendations. limit/offset are already supported by the backend
  // (repository.findAll -- ORDER BY potential_savings DESC, created_at DESC) but were
  // not previously exposed here; no backend change needed to add them.
  getAll: async (filters?: {
    severity?: string;
    status?: string;
    resourceType?: string;
    limit?: number;
    offset?: number;
  }): Promise<CostRecommendation[]> => {
    const params = new URLSearchParams();
    if (filters?.severity) params.append('severity', filters.severity);
    if (filters?.status) params.append('status', filters.status);
    if (filters?.resourceType) params.append('resource_type', filters.resourceType);
    if (filters?.limit != null) params.append('limit', String(filters.limit));
    if (filters?.offset != null) params.append('offset', String(filters.offset));

    const queryString = params.toString() ? `?${params.toString()}` : '';
    const response = await api.get<ApiResponse<any>>(
      `/api/cost-recommendations${queryString}`
    );
    const result = handleApiResponse(response);

    // Transform backend snake_case to frontend camelCase
    return (result || []).map((r: any) => ({
      id: r.id,
      resourceId: r.resource_id,
      resourceName: r.resource_name,
      resourceType: r.resource_type,
      issue: r.issue,
      description: r.description,
      potentialSavings: parseFloat(r.potential_savings) || 0,
      severity: r.severity,
      status: r.status,
      awsRegion: r.aws_region,
      metadata: r.metadata,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      resolvedAt: r.resolved_at,
    }));
  },

  // Get recommendation statistics
  getStats: async (): Promise<RecommendationStats> => {
    const response = await api.get<ApiResponse<any>>('/api/cost-recommendations/stats');
    const result = handleApiResponse(response);

    return {
      totalRecommendations: result.total_recommendations || 0,
      activeRecommendations: result.active_recommendations || 0,
      totalPotentialSavings: parseFloat(result.total_potential_savings) || 0,
      potentialSavingsByResourceType: result.potential_savings_by_resource_type ?? {},
      potentialSavingsCeiling: parseFloat(result.potential_savings_ceiling) || 0,
      potentialSavingsCeilingByResourceType: result.potential_savings_ceiling_by_resource_type ?? {},
      bySeverity: {
        high: result.by_severity?.high || 0,
        medium: result.by_severity?.medium || 0,
        low: result.by_severity?.low || 0,
      },
    };
  },

  // Get recommendation by ID
  getById: async (id: string): Promise<CostRecommendation> => {
    const response = await api.get<ApiResponse<any>>(`/api/cost-recommendations/${id}`);
    const r = handleApiResponse(response);

    return {
      id: r.id,
      resourceId: r.resource_id,
      resourceName: r.resource_name,
      resourceType: r.resource_type,
      issue: r.issue,
      description: r.description,
      potentialSavings: parseFloat(r.potential_savings) || 0,
      severity: r.severity,
      status: r.status,
      awsRegion: r.aws_region,
      metadata: r.metadata,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      resolvedAt: r.resolved_at,
    };
  },

  // Analyze AWS resources to generate recommendations
  analyze: async (): Promise<AnalysisResult> => {
    const response = await api.post<ApiResponse<any>>('/api/cost-recommendations/analyze');
    const result = handleApiResponse(response);

    return {
      recommendationsFound: result.recommendationsFound || 0,
      totalPotentialSavings: parseFloat(result.totalPotentialSavings) || 0,
      bySeverity: {
        high: result.bySeverity?.high || 0,
        medium: result.bySeverity?.medium || 0,
        low: result.bySeverity?.low || 0,
      },
      timestamp: result.timestamp,
      // An older backend sends none of these: they stay absent. Sent but not a valid count: null, never 0.
      ...('runState' in result ? { runState: result.runState === 'completed' || result.runState === 'partial' ? result.runState : undefined } : {}),
      ...('unknownResourceCount' in result ? { unknownResourceCount: typeof result.unknownResourceCount === 'number' ? result.unknownResourceCount : null } : {}),
      ...('counts' in result ? { counts: parseAnalysisCounts(result.counts) } : {}),
    };
  },

  // History of manual "Run cost analysis" invocations, latest first -- the
  // manual-run counterpart to awsResourcesService.getDiscoveryJobs(), which
  // only covers the separate scheduled discovery cron.
  // source 'all' adds the cost step of scheduled discovery scans.
  getAnalysisRuns: async (limit: number = 5, source?: 'all'): Promise<CostAnalysisRun[]> => {
    const response = await api.get<ApiResponse<CostAnalysisRun[]>>(
      `/api/cost-recommendations/analysis-runs?limit=${limit}${source === 'all' ? '&source=all' : ''}`
    );
    return handleApiResponse(response);
  },

  // The Optimization Rule Registry catalog -- what DevControl actually checks
  // today (implemented) vs. what's registered/planned but has no analyzer
  // yet. Replaces the frontend's own previously-hardcoded SCAN_CHECKS list
  // as the authoritative source for the Cost Optimization page's "What
  // DevControl checks" / coverage / planned sections.
  getOptimizationRules: async (): Promise<OptimizationRuleCatalog> => {
    const response = await api.get<ApiResponse<OptimizationRuleCatalog>>(
      '/api/cost-recommendations/optimization-rules'
    );
    return handleApiResponse(response);
  },

  // Enterprise Workstream 3B, Phase F: this organization's actual effective
  // configuration (default or override, plus provenance) for every
  // configurable rule/parameter. Enterprise-gated server-side
  // (requireEnterprise on the route) -- organizationId is derived from the
  // authenticated session on the backend, never sent from here.
  getOptimizationRuleConfiguration: async (): Promise<EffectiveOptimizationRuleConfig[]> => {
    const response = await api.get<ApiResponse<EffectiveOptimizationRuleConfig[]>>(
      '/api/cost-recommendations/optimization-rules/configuration'
    );
    return handleApiResponse(response);
  },

  // Sets (upserts) this organization's override for one parameter. The
  // authoritative min/max/integer validation lives server-side
  // (OptimizationRuleConfigService) -- a rejected value surfaces here as a
  // thrown error whose message the caller can show to the user.
  updateOptimizationRuleConfiguration: async (
    ruleId: string,
    parameterId: string,
    value: number
  ): Promise<{ ruleId: string; parameterId: string; value: number; source: OptimizationRuleConfigSource }> => {
    const response = await api.put<
      ApiResponse<{ ruleId: string; parameterId: string; value: number; source: OptimizationRuleConfigSource }>
    >(`/api/cost-recommendations/optimization-rules/configuration/${ruleId}/${parameterId}`, { value });
    return handleApiResponse(response);
  },

  // Resets this organization's parameter back to the registry default by
  // deleting its override row. Idempotent -- resetting an already-default
  // parameter still returns success.
  resetOptimizationRuleConfiguration: async (ruleId: string, parameterId: string): Promise<void> => {
    await api.delete(`/api/cost-recommendations/optimization-rules/configuration/${ruleId}/${parameterId}`);
  },

  // Mark recommendation as resolved
  resolve: async (id: string): Promise<CostRecommendation> => {
    const response = await api.patch<ApiResponse<any>>(
      `/api/cost-recommendations/${id}/resolve`
    );
    const r = handleApiResponse(response);

    return {
      id: r.id,
      resourceId: r.resource_id,
      resourceName: r.resource_name,
      resourceType: r.resource_type,
      issue: r.issue,
      description: r.description,
      potentialSavings: parseFloat(r.potential_savings) || 0,
      severity: r.severity,
      status: r.status,
      awsRegion: r.aws_region,
      metadata: r.metadata,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      resolvedAt: r.resolved_at,
    };
  },

  // Execute real remediation for an Idle EC2 recommendation (stops the instance
  // via RemediationService). Only valid for resourceType === 'EC2' && issue ===
  // 'Idle Instance' recommendations — the backend rejects anything else.
  executeRemediation: async (
    id: string
  ): Promise<{ recommendation: CostRecommendation; workflow: any; message: string }> => {
    const response = await api.post<ApiResponse<{ recommendation: any; workflow: any }> & { message?: string }>(
      `/api/cost-recommendations/${id}/execute-remediation`
    );

    if (!response.data.success) {
      throw new Error((response.data as any).error || 'Execution failed');
    }

    const { recommendation: r, workflow } = response.data.data!;

    return {
      recommendation: {
        id: r.id,
        resourceId: r.resource_id,
        resourceName: r.resource_name,
        resourceType: r.resource_type,
        issue: r.issue,
        description: r.description,
        potentialSavings: parseFloat(r.potential_savings) || 0,
        severity: r.severity,
        status: r.status,
        awsRegion: r.aws_region,
        metadata: r.metadata,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        resolvedAt: r.resolved_at,
      },
      workflow,
      message: response.data.message || 'Remediation executed.',
    };
  },

  // Resolved and dismissed findings (one per finding) and whether each is still detected.
  getHidden: async (): Promise<HiddenFindings> => {
    const response = await api.get<ApiResponse<HiddenFindings>>('/api/cost-recommendations/hidden');
    return handleApiResponse(response);
  },

  // Reopen the finding a hidden decision row belongs to. Member or above.
  reopen: async (id: string): Promise<ReopenOutcome> => {
    const response = await api.post<ApiResponse<any>>(`/api/cost-recommendations/${id}/reopen`);
    const r = handleApiResponse(response);
    if (r?.reopened === true) return { reopened: true, rowsEnded: Number(r.rowsEnded) || 0, activeNow: r.activeNow === true };
    if (r?.reopened === false && r.reason === 'already_open') return { reopened: false, reason: 'already_open' };
    throw new Error('Unexpected reopen response');
  },

  // Mark recommendation as dismissed
  dismiss: async (id: string): Promise<CostRecommendation> => {
    const response = await api.patch<ApiResponse<any>>(
      `/api/cost-recommendations/${id}/dismiss`
    );
    const r = handleApiResponse(response);

    return {
      id: r.id,
      resourceId: r.resource_id,
      resourceName: r.resource_name,
      resourceType: r.resource_type,
      issue: r.issue,
      description: r.description,
      potentialSavings: parseFloat(r.potential_savings) || 0,
      severity: r.severity,
      status: r.status,
      awsRegion: r.aws_region,
      metadata: r.metadata,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      resolvedAt: r.resolved_at,
    };
  },

  // Delete recommendation
  delete: async (id: string): Promise<void> => {
    await api.delete(`/api/cost-recommendations/${id}`);
  },

  // Get count of active recommendations
  getActiveCount: async (): Promise<number> => {
    const stats = await costRecommendationsService.getStats();
    return stats.activeRecommendations;
  },
};
