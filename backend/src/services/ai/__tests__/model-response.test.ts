/**
 * The shared model response reader (AI truth PR 1, step1.md §4 fixtures 1-12).
 *
 * Fixtures are realistic Messages API shapes (SDK 0.72.1 types), built here --
 * no network, no recorded production responses (founder decision A-D5).
 */
import Anthropic from '@anthropic-ai/sdk';
import { classifyModelError, fallbackReasonFor, readModelResponse, type ModelOutcome } from '../model-response';

function message(content: unknown[], stop_reason: string | null = 'end_turn', extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-5',
    content,
    stop_reason,
    stop_sequence: null,
    usage: { input_tokens: 1200, output_tokens: 340 },
    ...extra,
  };
}

const thinking = (text = '') => ({ type: 'thinking', thinking: text, signature: 'sig' });
const redacted = () => ({ type: 'redacted_thinking', data: 'opaque' });
const text = (t: string) => ({ type: 'text', text: t, citations: null });
const toolUse = (name: string, input: unknown) => ({ type: 'tool_use', id: 'toolu_1', name, input });

describe('readModelResponse: fixture table', () => {
  const cases: Array<[string, Record<string, unknown> | unknown, Partial<ModelOutcome> & { kind: ModelOutcome['kind'] }]> = [
    ['1. [thinking(""), text] end_turn -- the report failure shape: the text is kept', message([thinking(''), text('{"a":1}')]), { kind: 'text', text: '{"a":1}' }],
    ['2. [text] end_turn', message([text('hello')]), { kind: 'text', text: 'hello' }],
    ['3. [thinking] only, max_tokens -- the budget went on thinking', message([thinking('')], 'max_tokens'), { kind: 'truncated', partialText: '' }],
    ['4. [thinking, text(partial JSON)] max_tokens -- never a complete answer', message([thinking(''), text('{"summary": "half')], 'max_tokens'), { kind: 'truncated', partialText: '{"summary": "half' }],
    ['5. [] refusal with stop_details', message([], 'refusal', { stop_details: { type: 'refusal', category: 'cyber', explanation: 'x' } }), { kind: 'refused', category: 'cyber' }],
    ['5b. partial text then refusal -- the partial text is not an answer', message([text('Sure, here')], 'refusal', { stop_details: { type: 'refusal', category: null } }), { kind: 'refused', category: null }],
    ['6a. [thinking, tool_use] tool_use', message([thinking(''), toolUse('render', { a: 1 })], 'tool_use'), { kind: 'tool' }],
    ['6b. [tool_use] end_turn', message([toolUse('render', { a: 1 })], 'end_turn'), { kind: 'tool' }],
    ['7. [text, text] -- split text is joined in order', message([text('part one, '), text('part two')]), { kind: 'text', text: 'part one, part two' }],
    ['8. redacted_thinking first', message([redacted(), text('answer')]), { kind: 'text', text: 'answer' }],
    ['9. pause_turn -- not a finished turn', message([text('working')], 'pause_turn'), { kind: 'truncated', partialText: 'working' }],
    ['9b. an unknown stop reason (e.g. context window) is not a finished turn', message([text('x')], 'model_context_window_exceeded'), { kind: 'truncated' }],
    ['empty content, end_turn', message([]), { kind: 'empty' }],
    ['only whitespace text', message([text('  \n ')]), { kind: 'empty' }],
    ['only thinking, end_turn', message([thinking('hidden')]), { kind: 'empty' }],
    ['tool_use stop with no tool block', message([text('x')], 'tool_use'), { kind: 'malformed', reason: 'tool_use_without_tool_block' }],
    ['no content array', { stop_reason: 'end_turn' }, { kind: 'malformed', reason: 'no_content_array' }],
    ['not an object', 'not a message', { kind: 'malformed', reason: 'no_content_array' }],
    ['null', null, { kind: 'malformed', reason: 'no_content_array' }],
    ['unknown block types are skipped, valid text kept', message([{ type: 'server_tool_use', id: 's', name: 'web', input: {} }, null, 42, text('kept')]), { kind: 'text', text: 'kept' }],
    ['a text block whose text is not a string is skipped', message([{ type: 'text', text: 5 }, text('ok')]), { kind: 'text', text: 'ok' }],
    ['a missing stop reason with text is a finished answer', message([text('ok')], null), { kind: 'text', text: 'ok' }],
  ];

  it.each(cases)('%s', (_name, input, expected) => {
    const outcome = readModelResponse(input);
    expect(outcome).toMatchObject(expected);
  });

  it('a tool answer keeps its calls and any text alongside it; it is never read as text', () => {
    const outcome = readModelResponse(message([text('Calling the tool.'), toolUse('render', { a: 1 }), toolUse('other', { b: 2 })], 'tool_use'));
    expect(outcome).toEqual({
      kind: 'tool',
      calls: [{ id: 'toolu_1', name: 'render', input: { a: 1 } }, { id: 'toolu_1', name: 'other', input: { b: 2 } }],
      text: 'Calling the tool.',
      meta: expect.any(Object),
    });
  });

  it('keeps stop reason, model, usage and block types -- names only -- and never thinking content', () => {
    const outcome = readModelResponse(message([thinking('SECRET-THINKING'), text('answer')]));
    expect(outcome.meta).toEqual({ stopReason: 'end_turn', model: 'claude-sonnet-5', inputTokens: 1200, outputTokens: 340, blockTypes: ['thinking', 'text'] });
    expect(JSON.stringify(outcome)).not.toContain('SECRET-THINKING');
  });

  it('missing usage reads as null, never 0', () => {
    const outcome = readModelResponse({ content: [text('a')], stop_reason: 'end_turn' });
    expect(outcome.meta).toMatchObject({ inputTokens: null, outputTokens: null, model: null });
  });
});

describe('classifyModelError: fixture 11 (typed SDK errors), by class -- never by message', () => {
  const headers = new Headers();
  const cases: Array<[string, unknown, string, number | null]> = [
    ['timeout', new Anthropic.APIConnectionTimeoutError(), 'timeout', null],
    ['connection', new Anthropic.APIConnectionError({ message: 'socket hang up' }), 'network', null],
    ['aborted', new Anthropic.APIUserAbortError(), 'aborted', null],
    ['rate limit', new Anthropic.RateLimitError(429, { type: 'error' }, 'rate', headers), 'rate_limited', 429],
    ['overloaded 529', new Anthropic.InternalServerError(529, { type: 'error' }, 'overloaded', headers), 'overloaded', 529],
    ['server 500', new Anthropic.InternalServerError(500, { type: 'error' }, 'oops', headers), 'server', 500],
    ['bad request', new Anthropic.BadRequestError(400, { type: 'error' }, 'bad', headers), 'bad_request', 400],
    ['auth', new Anthropic.AuthenticationError(401, { type: 'error' }, 'key', headers), 'auth', 401],
    ['permission', new Anthropic.PermissionDeniedError(403, { type: 'error' }, 'no', headers), 'auth', 403],
    ['not found (model id)', new Anthropic.NotFoundError(404, { type: 'error' }, 'model', headers), 'not_found', 404],
    ['generic API error (stream error event)', new Anthropic.APIError(undefined, { type: 'error' }, 'overloaded_error', undefined), 'api_error', null],
    ['not an SDK error', new Error('rate limit exceeded 429'), 'unknown', null],
    ['a thrown string', 'boom', 'unknown', null],
  ];

  it.each(cases)('%s', (_name, error, code, status) => {
    expect(classifyModelError(error)).toEqual({ kind: 'error', code, httpStatus: status, meta: null });
  });
});

describe('fallbackReasonFor', () => {
  it('maps every non-answer outcome to its own reason; text and tool are judged by the call site', () => {
    const meta = readModelResponse(message([text('x')])).meta!;
    expect(fallbackReasonFor({ kind: 'text', text: 'x', meta })).toBeNull();
    expect(fallbackReasonFor({ kind: 'tool', calls: [], text: '', meta })).toBeNull();
    expect(fallbackReasonFor({ kind: 'truncated', partialText: '', meta })).toBe('truncated');
    expect(fallbackReasonFor({ kind: 'refused', category: null, meta })).toBe('refused');
    expect(fallbackReasonFor({ kind: 'empty', meta })).toBe('empty');
    expect(fallbackReasonFor({ kind: 'malformed', reason: 'no_content_array', meta })).toBe('malformed');
    expect(fallbackReasonFor({ kind: 'error', code: 'timeout', httpStatus: null, meta: null })).toBe('error_timeout');
    expect(fallbackReasonFor({ kind: 'error', code: 'not_configured', httpStatus: null, meta: null })).toBe('not_configured');
  });
});
