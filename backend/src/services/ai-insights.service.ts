/**
 * AI Insights Service
 *
 * Turns the Dashboard summary's fact-only prompt (built by ai-summary.service.ts)
 * into the summary's 4 fields through one tool call.
 *
 * The other model paths this service used to hold -- cost-change analysis
 * (POST /api/ai-insights/analyze-cost, which fed client-supplied numbers to
 * the model), its cache endpoints, the plain-text dashboard summary and the
 * weekly-summary text -- had no caller in the product and were retired in AI
 * truth PR 1 (founder decision A-D8).
 */

import Anthropic from '@anthropic-ai/sdk';
import { getModelClient, runModel, type Interpretation } from './ai/model-client';

// Structured Dashboard Summary Types
export interface StructuredDashboardSummary {
  overallHealth: { score: number | null; context: string | null };
  topRisk: string | null;
  cloudSpend: string | null;
  systemStatus: string | null;
}

export const DASHBOARD_SUMMARY_TOOL_NAME = 'render_dashboard_summary';

const NULLABLE_STRING = (description: string) => ({ anyOf: [{ type: 'string' }, { type: 'null' }], description });

/** Strict tool: every object closes with additionalProperties false; nullable fields use anyOf. */
export const DASHBOARD_SUMMARY_TOOL: Anthropic.Tool = {
  name: DASHBOARD_SUMMARY_TOOL_NAME,
  description: 'Render the dashboard summary as 4 distinct fields for a scannable executive view.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      overallHealth: {
        type: 'object',
        additionalProperties: false,
        description: 'Composite health assessment.',
        properties: {
          score: {
            anyOf: [{ type: 'number' }, { type: 'null' }],
            description: 'Composite System Intelligence score out of 100, exactly as given in the facts, or null if not available.',
          },
          context: NULLABLE_STRING('One brief clause of context for the score (e.g. what is driving it), or null if not available.'),
        },
        required: ['score', 'context'],
      },
      topRisk: NULLABLE_STRING('The single most urgent finding, one short sentence, or null if there is none.'),
      cloudSpend: NULLABLE_STRING('Current spend, trend, and optimization potential in one short sentence, or null if no spend data is available.'),
      systemStatus: NULLABLE_STRING('Outage/incident state in one short clause, or null if not available.'),
    },
    required: ['overallHealth', 'topRisk', 'cloudSpend', 'systemStatus'],
  },
};

/** Tool choice is 'auto' (forced tool choice is not used), so the prompt asks for the call. */
const TOOL_INSTRUCTION = `\n\nRespond only by calling the ${DASHBOARD_SUMMARY_TOOL_NAME} tool once.`;

function nullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value === 'string') return value.trim().length > 0 ? value : null;
  return undefined; // wrong type
}

/** The tool input as summary fields, or null when any field has the wrong type. */
export function parseDashboardSummaryInput(input: unknown): StructuredDashboardSummary | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const i = input as Record<string, unknown>;
  const health = i.overallHealth;
  if (!health || typeof health !== 'object' || Array.isArray(health)) return null;
  const h = health as Record<string, unknown>;
  const score = h.score === null ? null : typeof h.score === 'number' && Number.isFinite(h.score) ? h.score : undefined;
  const context = nullableString(h.context);
  const topRisk = nullableString(i.topRisk);
  const cloudSpend = nullableString(i.cloudSpend);
  const systemStatus = nullableString(i.systemStatus);
  if (score === undefined || context === undefined || topRisk === undefined || cloudSpend === undefined || systemStatus === undefined) return null;
  return { overallHealth: { score, context }, topRisk, cloudSpend, systemStatus };
}

export class AIInsightsService {
  /**
   * The summary as 4 distinct fields (overallHealth, topRisk, cloudSpend,
   * systemStatus) from one strict tool call, so the dashboard can render a
   * scannable layout. Returns null -- never canned text -- when there is no
   * API key, the call fails, or the answer is not one valid tool call, so the
   * caller shows only its deterministic fields.
   */
  async generateStructuredDashboardSummary(prompt: string): Promise<StructuredDashboardSummary | null> {
    if (!getModelClient()) {
      console.log('[AI Insights] No API key - skipping dashboard summary');
      return null;
    }

    const result = await runModel(
      'dashboard_summary',
      'dashboard_summary',
      { messages: [{ role: 'user', content: `${prompt}${TOOL_INSTRUCTION}` }], tools: [DASHBOARD_SUMMARY_TOOL] },
      (outcome): Interpretation<StructuredDashboardSummary> => {
        if (outcome.kind === 'text') return { ok: false, reason: 'no_tool_call' };
        const call = outcome.calls.find((c) => c.name === DASHBOARD_SUMMARY_TOOL_NAME);
        if (!call) return { ok: false, reason: 'unexpected_tool' };
        const fields = parseDashboardSummaryInput(call.input);
        return fields ? { ok: true, value: fields } : { ok: false, reason: 'malformed_output' };
      }
    );
    return result.ok ? result.value : null;
  }
}
