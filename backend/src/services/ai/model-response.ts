/**
 * The one way DevControl reads a model response (AI truth PR 1).
 *
 * Every model call site turns the SDK's Message (or the error it threw) into a
 * ModelOutcome here, so no caller assumes the response has one block or that
 * the first block decides what it is. The rules:
 *
 *   - every content block is read; thinking and redacted_thinking blocks are
 *     skipped (their content is never returned, logged or shown), so valid
 *     text after them is kept;
 *   - text blocks are joined in order; mixed blocks never drop valid text;
 *   - a tool_use block makes the outcome 'tool' (with any text alongside it):
 *     a tool answer is never read as text, and a text answer is never read
 *     as a tool call;
 *   - the stop reason decides before the blocks do: 'refusal' is 'refused',
 *     and 'max_tokens' (or any other stop that is not a finished turn) is
 *     'truncated', whatever text arrived -- an incomplete answer is never
 *     presented as a complete one;
 *   - no usable block is 'empty'; a response without a content array, or a
 *     tool_use stop with no tool block, is 'malformed';
 *   - a thrown error becomes 'error' with a code from the SDK's typed error
 *     classes -- never from the error's message, which can echo the request.
 *
 * Stop reason, model and token usage are kept on every outcome that has a
 * response (meta), so the call log can record them without any content.
 */

import Anthropic from '@anthropic-ai/sdk';

export interface ModelResponseMeta {
  /** The response's stop_reason as sent, or null when there was none. */
  stopReason: string | null;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  /** The type of every content block, in order -- names only, never content. */
  blockTypes: string[];
}

export interface ModelToolCall {
  id: string | null;
  name: string;
  input: unknown;
}

export type ModelErrorCode =
  | 'not_configured'
  | 'aborted'
  | 'timeout'
  | 'network'
  | 'rate_limited'
  | 'overloaded'
  | 'server'
  | 'bad_request'
  | 'auth'
  | 'not_found'
  | 'api_error'
  | 'unknown';

export type ModelOutcome =
  | { kind: 'text'; text: string; meta: ModelResponseMeta }
  | { kind: 'tool'; calls: ModelToolCall[]; text: string; meta: ModelResponseMeta }
  /** Stopped before a finished turn (max_tokens, pause_turn, ...). partialText is never a complete answer. */
  | { kind: 'truncated'; partialText: string; meta: ModelResponseMeta }
  | { kind: 'refused'; category: string | null; meta: ModelResponseMeta }
  | { kind: 'empty'; meta: ModelResponseMeta }
  | { kind: 'malformed'; reason: 'no_content_array' | 'tool_use_without_tool_block'; meta: ModelResponseMeta }
  | { kind: 'error'; code: ModelErrorCode; httpStatus: number | null; meta: null };

/** Stop reasons that end a finished turn. Anything else that is not a refusal is an incomplete answer. */
const FINISHED_STOP_REASONS = new Set<string | null>(['end_turn', 'stop_sequence', 'tool_use', null]);

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function metaOf(message: Record<string, any>): ModelResponseMeta {
  const content: unknown[] = Array.isArray(message.content) ? message.content : [];
  return {
    stopReason: typeof message.stop_reason === 'string' ? message.stop_reason : null,
    model: typeof message.model === 'string' ? message.model : null,
    inputTokens: numberOrNull(message.usage?.input_tokens),
    outputTokens: numberOrNull(message.usage?.output_tokens),
    blockTypes: content.map((block) => (block && typeof block === 'object' && typeof (block as any).type === 'string' ? (block as any).type : 'invalid')),
  };
}

/** Reads one complete model response. Never throws. */
export function readModelResponse(message: unknown): ModelOutcome {
  if (!message || typeof message !== 'object') {
    return { kind: 'malformed', reason: 'no_content_array', meta: metaOf({}) };
  }
  const m = message as Record<string, any>;
  const meta = metaOf(m);
  if (!Array.isArray(m.content)) return { kind: 'malformed', reason: 'no_content_array', meta };

  const texts: string[] = [];
  const calls: ModelToolCall[] = [];
  for (const block of m.content as unknown[]) {
    if (!block || typeof block !== 'object') continue;
    const b = block as Record<string, any>;
    if (b.type === 'text' && typeof b.text === 'string') {
      texts.push(b.text);
    } else if (b.type === 'tool_use' && typeof b.name === 'string') {
      calls.push({ id: typeof b.id === 'string' ? b.id : null, name: b.name, input: b.input });
    }
    // thinking, redacted_thinking and any other block type: skipped, never read.
  }
  const text = texts.join('');

  if (meta.stopReason === 'refusal') {
    const category = m.stop_details && typeof m.stop_details.category === 'string' ? m.stop_details.category : null;
    return { kind: 'refused', category, meta };
  }
  if (!FINISHED_STOP_REASONS.has(meta.stopReason)) {
    return { kind: 'truncated', partialText: text, meta };
  }
  if (calls.length > 0) return { kind: 'tool', calls, text, meta };
  if (meta.stopReason === 'tool_use') return { kind: 'malformed', reason: 'tool_use_without_tool_block', meta };
  if (text.trim().length > 0) return { kind: 'text', text, meta };
  return { kind: 'empty', meta };
}

/** instanceof against an SDK error class, tolerating a class that is missing (e.g. a mocked SDK). */
function isInstance(error: unknown, errorClass: unknown): boolean {
  return typeof errorClass === 'function' && error instanceof (errorClass as new (...args: never[]) => unknown);
}

/** The outcome for an error thrown by the SDK (or anything else). Reads only the error's class and status. */
export function classifyModelError(error: unknown): Extract<ModelOutcome, { kind: 'error' }> {
  const sdk = Anthropic as unknown as Record<string, unknown> | undefined;
  const cls = (name: string) => sdk?.[name];
  const status = isInstance(error, cls('APIError')) && typeof (error as { status?: unknown }).status === 'number'
    ? (error as { status: number }).status
    : null;
  let code: ModelErrorCode;
  if (isInstance(error, cls('APIUserAbortError'))) code = 'aborted';
  else if (isInstance(error, cls('APIConnectionTimeoutError'))) code = 'timeout';
  else if (isInstance(error, cls('APIConnectionError'))) code = 'network';
  else if (isInstance(error, cls('RateLimitError'))) code = 'rate_limited';
  else if (isInstance(error, cls('AuthenticationError')) || isInstance(error, cls('PermissionDeniedError'))) code = 'auth';
  else if (isInstance(error, cls('NotFoundError'))) code = 'not_found';
  else if (isInstance(error, cls('BadRequestError')) || isInstance(error, cls('UnprocessableEntityError'))) code = 'bad_request';
  else if (isInstance(error, cls('InternalServerError'))) code = status === 529 ? 'overloaded' : 'server';
  else if (isInstance(error, cls('APIError'))) code = status === 529 ? 'overloaded' : 'api_error';
  else code = 'unknown';
  return { kind: 'error', code, httpStatus: status, meta: null };
}

/**
 * Why a call site did not use the model's answer. The outcome-level reasons
 * come from fallbackReasonFor(); a call site adds its own when an answer it
 * received is not usable (malformed_output, unexpected_tool, no_tool_call).
 */
export type FallbackReason =
  | 'not_configured'
  | 'truncated'
  | 'refused'
  | 'empty'
  | 'malformed'
  | 'malformed_output'
  | 'unexpected_tool'
  | 'no_tool_call'
  | `error_${Exclude<ModelErrorCode, 'not_configured'>}`;

/** The fallback reason an outcome implies on its own: null for text and tool outcomes, which the call site judges. */
export function fallbackReasonFor(outcome: ModelOutcome): FallbackReason | null {
  switch (outcome.kind) {
    case 'text':
    case 'tool':
      return null;
    case 'truncated':
      return 'truncated';
    case 'refused':
      return 'refused';
    case 'empty':
      return 'empty';
    case 'malformed':
      return 'malformed';
    case 'error':
      return outcome.code === 'not_configured' ? 'not_configured' : `error_${outcome.code}`;
  }
}
