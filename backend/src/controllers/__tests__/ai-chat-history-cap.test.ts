/**
 * Server-side chat history cap (AI truth PR 1, founder decision A-D15): only
 * the newest 20 messages reach the model, starting at a user message, and a
 * message over 8,000 characters is refused rather than silently cut.
 */
import { AIChatController, CHAT_MAX_MESSAGES, CHAT_MAX_MESSAGE_CHARS, prepareChatHistory } from '../ai-chat.controller';
import { AIChatService, type ChatMessage } from '../../services/ai-chat.service';
import { AIChatContextRepository } from '../../repositories/ai-chat-context.repository';

const turn = (i: number): ChatMessage => ({ role: i % 2 === 0 ? 'user' : 'assistant', content: `message ${i}` });

describe('prepareChatHistory', () => {
  it('the cap is 20 messages of at most 8,000 characters', () => {
    expect(CHAT_MAX_MESSAGES).toBe(20);
    expect(CHAT_MAX_MESSAGE_CHARS).toBe(8000);
  });

  it('keeps a history at or under the cap unchanged', () => {
    const history = Array.from({ length: 19 }, (_, i) => turn(i));
    expect(prepareChatHistory(history)).toEqual({ ok: true, messages: history });
  });

  it('keeps only the newest 20, starting at a user message', () => {
    const history = Array.from({ length: 31 }, (_, i) => turn(i)); // 0..30, ends with a user message
    const result = prepareChatHistory(history);
    if (!result.ok) throw new Error('expected ok');
    // The newest 20 are 11..30; 11 is an assistant message, so the kept history starts at 12.
    expect(result.messages.map((m) => m.content)).toEqual(Array.from({ length: 19 }, (_, i) => `message ${i + 12}`));
    expect(result.messages.length).toBeLessThanOrEqual(CHAT_MAX_MESSAGES);
    expect(result.messages[0].role).toBe('user');
    expect(result.messages[result.messages.length - 1].content).toBe('message 30');
  });

  it('a message of exactly 8,000 characters is accepted; one character more is refused', () => {
    expect(prepareChatHistory([{ role: 'user', content: 'x'.repeat(8000) }]).ok).toBe(true);
    expect(prepareChatHistory([{ role: 'user', content: 'x'.repeat(8001) }])).toEqual({ ok: false, error: 'Each message must be at most 8,000 characters' });
  });

  it('an over-long message anywhere in the history is refused, even one the cap would drop', () => {
    const history = [{ role: 'user' as const, content: 'x'.repeat(9000) }, ...Array.from({ length: 25 }, (_, i) => turn(i + 1))];
    expect(prepareChatHistory(history).ok).toBe(false);
  });

  it('refuses invalid messages and a history with no user message', () => {
    expect(prepareChatHistory([{ role: 'system', content: 'x' }]).ok).toBe(false);
    expect(prepareChatHistory([{ role: 'user', content: '   ' }]).ok).toBe(false);
    expect(prepareChatHistory([{ role: 'assistant', content: 'x' }]).ok).toBe(false);
  });

  it('copies only role and content', () => {
    const result = prepareChatHistory([{ role: 'user', content: 'hi', extra: 'dropped' } as any]);
    expect(result).toEqual({ ok: true, messages: [{ role: 'user', content: 'hi' }] });
  });
});

describe('both chat endpoints apply the cap before the model is reached', () => {
  let received: ChatMessage[][];

  beforeEach(() => {
    received = [];
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(AIChatContextRepository.prototype, 'gatherContext').mockResolvedValue({
      services: { state: 'unavailable', data: null },
      costs: { current: null, state: 'unavailable', source: 'unavailable', asOf: null },
      discovery: { data: null },
      alerts: { state: 'not_supported', data: null },
    } as never);
    jest.spyOn(AIChatService.prototype, 'chat').mockImplementation(async function* (messages: ChatMessage[]) {
      received.push(messages);
      yield 'ok';
    } as never);
  });

  afterEach(() => jest.restoreAllMocks());

  function res() {
    const r: any = { statusCode: 200, body: undefined, written: [] as string[] };
    r.status = (code: number) => { r.statusCode = code; return r; };
    r.json = (body: unknown) => { r.body = body; return r; };
    r.setHeader = () => r;
    r.flushHeaders = () => undefined;
    r.write = (chunk: string) => { r.written.push(chunk); return true; };
    r.end = () => r;
    return r;
  }

  const req = (messages: unknown) => ({ body: { messages }, user: { organizationId: 'org-1' } }) as any;

  it.each(['chat', 'chatSync'] as const)('%s: 31 messages -> the model sees at most 20', async (handler) => {
    const controller = new AIChatController({} as any);
    const response = res();
    await controller[handler](req(Array.from({ length: 31 }, (_, i) => turn(i))), response);
    expect(received).toHaveLength(1);
    expect(received[0].length).toBeLessThanOrEqual(20);
    expect(received[0][0].role).toBe('user');
  });

  it.each(['chat', 'chatSync'] as const)('%s: an over-long message is a 400 and the model is never reached', async (handler) => {
    const controller = new AIChatController({} as any);
    const response = res();
    await controller[handler](req([{ role: 'user', content: 'x'.repeat(8001) }]), response);
    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({ success: false, error: 'Each message must be at most 8,000 characters' });
    expect(received).toHaveLength(0);
  });
});
