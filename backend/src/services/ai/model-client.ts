/**
 * The one place a DevControl model request is configured and sent (AI truth PR 1).
 *
 * Every route's thinking, effort, max_tokens, timeout and transport is set in
 * ROUTE_CONFIG below, and every request goes through buildModelRequest(), so a
 * route can't silently inherit a model default. Calls go through runModel()
 * (complete responses) or streamModelText() (streamed text), which read the
 * response with model-response.ts and write exactly one structured log line
 * per call -- with no prompt, response, evidence, key or SDK error message.
 *
 * Notes on the installed SDK (@anthropic-ai/sdk 0.72.1):
 *   - its ThinkingConfigParam has only 'enabled' (budget_tokens, which
 *     claude-sonnet-5 rejects) and 'disabled'. claude-sonnet-5 runs adaptive
 *     thinking when `thinking` is omitted, so 'adaptive' here means "omit it";
 *   - its OutputConfig types only `format`. `effort` is a documented
 *     output_config field the SDK sends through unchanged; set a route's
 *     effort to null to stop sending it;
 *   - forced tool_choice ('any' / 'tool') is not offered: tools are 'auto'
 *     with strict schemas, steered by the prompt.
 *
 * SDK retries are off (maxRetries 0): a request retried after a timeout can be
 * generated -- and billed -- twice. A failed call falls back instead.
 */

import Anthropic from '@anthropic-ai/sdk';
import {
  classifyModelError,
  fallbackReasonFor,
  readModelResponse,
  type FallbackReason,
  type ModelOutcome,
} from './model-response';

export const AI_MODEL = 'claude-sonnet-5';

export type AIRoute = 'chat' | 'report' | 'nl_parse' | 'dashboard_summary' | 'forecast' | 'anomaly';

export type ModelEffort = 'low' | 'medium' | 'high';

export interface RouteConfig {
  /** 'adaptive' omits `thinking` (the model's adaptive default); 'disabled' sends { type: 'disabled' }. */
  thinking: 'adaptive' | 'disabled';
  /** output_config.effort; null sends none. */
  effort: ModelEffort | null;
  /** The cap on thinking plus answer tokens together. */
  maxTokens: number;
  timeoutMs: number;
  /** 'stream' reads a complete response through the streaming API (no long-request timeout). */
  transport: 'create' | 'stream';
}

const ROUTES: Record<AIRoute, RouteConfig> = {
  chat: { thinking: 'adaptive', effort: 'medium', maxTokens: 8000, timeoutMs: 120_000, transport: 'stream' },
  report: { thinking: 'adaptive', effort: 'medium', maxTokens: 16000, timeoutMs: 180_000, transport: 'stream' },
  nl_parse: { thinking: 'disabled', effort: 'low', maxTokens: 512, timeoutMs: 30_000, transport: 'create' },
  dashboard_summary: { thinking: 'disabled', effort: 'low', maxTokens: 1024, timeoutMs: 30_000, transport: 'create' },
  forecast: { thinking: 'adaptive', effort: 'medium', maxTokens: 8000, timeoutMs: 120_000, transport: 'create' },
  anomaly: { thinking: 'disabled', effort: 'low', maxTokens: 1024, timeoutMs: 30_000, transport: 'create' },
};
for (const config of Object.values(ROUTES)) Object.freeze(config);

export const ROUTE_CONFIG: Readonly<Record<AIRoute, Readonly<RouteConfig>>> = Object.freeze(ROUTES);

export const MODEL_MAX_RETRIES = 0;

export interface ModelRequestInput {
  system?: string;
  messages: Anthropic.MessageParam[];
  /** Tools are always offered with tool_choice 'auto'. */
  tools?: Anthropic.Tool[];
  /** A JSON schema for output_config.format (structured output). */
  jsonSchema?: Record<string, unknown>;
}

type OutputConfigWithEffort = Anthropic.OutputConfig & { effort?: ModelEffort };

/** The exact request a route sends. Pure, so tests can pin each route's shape. */
export function buildModelRequest(route: AIRoute, input: ModelRequestInput): Anthropic.MessageCreateParamsNonStreaming {
  const config = ROUTE_CONFIG[route];
  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model: AI_MODEL,
    max_tokens: config.maxTokens,
    messages: input.messages,
  };
  if (input.system !== undefined) params.system = input.system;
  if (config.thinking === 'disabled') params.thinking = { type: 'disabled' };
  if (input.tools && input.tools.length > 0) {
    params.tools = input.tools;
    params.tool_choice = { type: 'auto' };
  }
  const outputConfig: OutputConfigWithEffort = {};
  if (config.effort !== null) outputConfig.effort = config.effort;
  if (input.jsonSchema) outputConfig.format = { type: 'json_schema', schema: input.jsonSchema };
  if (Object.keys(outputConfig).length > 0) params.output_config = outputConfig;
  return params;
}

/** The subset of the SDK client the call paths use (so tests can supply a stub). */
export type ModelClient = Pick<Anthropic, 'messages'>;

let client: ModelClient | null = null;
let clientKey: string | null = null;
let testClient: ModelClient | null | undefined;

/**
 * The shared client, or null when ANTHROPIC_API_KEY is not set. Built once
 * per key value, so a changed key is picked up without a restart of this module.
 */
export function getModelClient(): ModelClient | null {
  if (testClient !== undefined) return testClient;
  const key = process.env.ANTHROPIC_API_KEY || '';
  if (key === '') return null;
  if (client === null || clientKey !== key) {
    client = new Anthropic({ apiKey: key, maxRetries: MODEL_MAX_RETRIES });
    clientKey = key;
  }
  return client;
}

/** Tests only: use this client (null = "no key"); undefined goes back to the environment. */
export function setModelClientForTests(replacement: ModelClient | null | undefined): void {
  testClient = replacement;
}

export interface ModelCallLogEntry {
  feature: string;
  route: AIRoute;
  outcome: ModelOutcome;
  durationMs: number;
  /** Why the call site did not use the answer; null when it did. */
  fallbackReason: FallbackReason | null;
}

/**
 * One line per model call. Only enumerations, counts and our own tool names:
 * no prompt, response or thinking text, no evidence, no key, no SDK message.
 */
export function logModelCall(entry: ModelCallLogEntry): void {
  const { outcome } = entry;
  const meta = outcome.meta;
  const line = {
    feature: entry.feature,
    route: entry.route,
    model: meta?.model ?? AI_MODEL,
    outcome: outcome.kind,
    stopReason: meta?.stopReason ?? null,
    errorCode: outcome.kind === 'error' ? outcome.code : null,
    httpStatus: outcome.kind === 'error' ? outcome.httpStatus : null,
    refusalCategory: outcome.kind === 'refused' ? outcome.category : null,
    toolNames: outcome.kind === 'tool' ? outcome.calls.map((c) => c.name) : null,
    blockTypes: meta?.blockTypes ?? null,
    inputTokens: meta?.inputTokens ?? null,
    outputTokens: meta?.outputTokens ?? null,
    durationMs: entry.durationMs,
    fallbackReason: entry.fallbackReason,
  };
  if (entry.fallbackReason) console.warn('[AI Model]', JSON.stringify(line));
  else console.log('[AI Model]', JSON.stringify(line));
}

const NOT_CONFIGURED: ModelOutcome = { kind: 'error', code: 'not_configured', httpStatus: null, meta: null };

async function requestMessage(route: AIRoute, input: ModelRequestInput): Promise<ModelOutcome> {
  const api = getModelClient();
  if (!api) return NOT_CONFIGURED;
  const config = ROUTE_CONFIG[route];
  const options = { timeout: config.timeoutMs, maxRetries: MODEL_MAX_RETRIES };
  try {
    const body = buildModelRequest(route, input);
    const message = config.transport === 'stream'
      ? await api.messages.stream(body, options).finalMessage()
      : await api.messages.create(body, options);
    return readModelResponse(message);
  } catch (error: unknown) {
    return classifyModelError(error);
  }
}

/** What a call site decided about a usable (text or tool) outcome. */
export type Interpretation<T> = { ok: true; value: T } | { ok: false; reason: FallbackReason };

export type ModelResult<T> =
  | { ok: true; value: T; outcome: ModelOutcome }
  | { ok: false; reason: FallbackReason; outcome: ModelOutcome };

/**
 * Sends one request and reads it. `interpret` runs only for 'text' and 'tool'
 * outcomes; every other outcome is a fallback with its own reason. Logs once.
 * Never throws.
 */
export async function runModel<T>(
  route: AIRoute,
  feature: string,
  input: ModelRequestInput,
  interpret: (outcome: Extract<ModelOutcome, { kind: 'text' | 'tool' }>) => Interpretation<T>
): Promise<ModelResult<T>> {
  const started = Date.now();
  const outcome = await requestMessage(route, input);
  let result: ModelResult<T>;
  if (outcome.kind === 'text' || outcome.kind === 'tool') {
    let decided: Interpretation<T>;
    try {
      decided = interpret(outcome);
    } catch {
      decided = { ok: false, reason: 'malformed_output' };
    }
    result = decided.ok ? { ok: true, value: decided.value, outcome } : { ok: false, reason: decided.reason, outcome };
  } else {
    result = { ok: false, reason: fallbackReasonFor(outcome) as FallbackReason, outcome };
  }
  logModelCall({ feature, route, outcome, durationMs: Date.now() - started, fallbackReason: result.ok ? null : result.reason });
  return result;
}

/**
 * Streams a route's text deltas (thinking deltas are never yielded), then
 * returns the outcome read from the final message. A stream that ends in
 * max_tokens returns 'truncated' even though its text was already yielded:
 * the caller must say the answer was cut short. Logs once. Never throws.
 */
export async function* streamModelText(
  route: AIRoute,
  feature: string,
  input: ModelRequestInput
): AsyncGenerator<string, ModelOutcome, undefined> {
  const started = Date.now();
  const api = getModelClient();
  let outcome: ModelOutcome | null = null;
  let stream: ReturnType<ModelClient['messages']['stream']> | null = null;
  try {
    if (!api) {
      outcome = NOT_CONFIGURED;
    } else {
      const config = ROUTE_CONFIG[route];
      try {
        stream = api.messages.stream(buildModelRequest(route, input), { timeout: config.timeoutMs, maxRetries: MODEL_MAX_RETRIES });
        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            yield event.delta.text;
          }
        }
        outcome = readModelResponse(await stream.finalMessage());
      } catch (error: unknown) {
        outcome = classifyModelError(error);
      }
    }
    return outcome;
  } finally {
    // The consumer stopped early (e.g. the client went away): stop generating.
    if (outcome === null) {
      stream?.abort();
      outcome = { kind: 'error', code: 'aborted', httpStatus: null, meta: null };
    }
    const fallbackReason = outcome.kind === 'text' ? null : (fallbackReasonFor(outcome) ?? 'unexpected_tool');
    logModelCall({ feature, route, outcome, durationMs: Date.now() - started, fallbackReason });
  }
}
