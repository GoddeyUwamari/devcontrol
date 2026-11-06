/**
 * A stub model client for tests (no network). Every request is recorded with
 * its options; each response is a scripted Message, a scripted stream, or a
 * thrown error. Install it with setModelClientForTests(fake.client).
 */

export interface RecordedRequest {
  transport: 'create' | 'stream';
  body: Record<string, any>;
  options: Record<string, any> | undefined;
}

export type Scripted =
  | { message: Record<string, unknown> }
  | { error: unknown }
  /** Stream events, then the final message (or an error part-way). */
  | { events: Array<Record<string, unknown> | { throw: unknown }>; message?: Record<string, unknown>; finalError?: unknown };

export function msg(content: unknown[], stop_reason: string | null = 'end_turn', extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-sonnet-5',
    content, stop_reason, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 50 }, ...extra,
  };
}

export const thinkingBlock = (t = '') => ({ type: 'thinking', thinking: t, signature: 'sig' });
export const textBlock = (t: string) => ({ type: 'text', text: t, citations: null });
export const toolBlock = (name: string, input: unknown) => ({ type: 'tool_use', id: 'toolu_1', name, input });

export const thinkingDelta = (t: string) => ({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: t } });
export const textDelta = (t: string) => ({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: t } });

export function fakeModel(script: Scripted[] = []) {
  const queue = [...script];
  const requests: RecordedRequest[] = [];
  const aborts: number[] = [];
  const next = (): Scripted => {
    const item = queue.shift();
    if (!item) throw new Error('fake model: no scripted response left');
    return item;
  };

  const create = jest.fn(async (body: Record<string, any>, options?: Record<string, any>) => {
    requests.push({ transport: 'create', body, options });
    const item = next();
    if ('error' in item) throw item.error;
    if ('message' in item && !('events' in item)) return item.message;
    return (item as any).message;
  });

  const stream = jest.fn((body: Record<string, any>, options?: Record<string, any>) => {
    requests.push({ transport: 'stream', body, options });
    const item = next();
    let aborted = false;
    return {
      abort: () => { aborted = true; aborts.push(requests.length); },
      async *[Symbol.asyncIterator]() {
        if ('error' in item) throw item.error;
        if ('events' in item) {
          for (const event of item.events) {
            if (aborted) return;
            if ('throw' in event) throw event.throw;
            yield event;
          }
        }
      },
      finalMessage: async () => {
        if ('error' in item) throw item.error;
        if ('events' in item && item.finalError !== undefined) throw item.finalError;
        return item.message;
      },
    };
  });

  return { client: { messages: { create, stream } } as any, requests, aborts, create, stream, remaining: () => queue.length };
}
