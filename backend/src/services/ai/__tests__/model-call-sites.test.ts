/**
 * Every model call site, through the shared client and reader (AI truth PR 1):
 * the request each route sends, what each response shape does at each site,
 * and the one log line per call. No network: a stub client is installed with
 * setModelClientForTests(). No database: the pools are stubs.
 */
import Anthropic from '@anthropic-ai/sdk';
import { setModelClientForTests, runModel, ROUTE_CONFIG, MODEL_MAX_RETRIES, AI_MODEL, type AIRoute } from '../model-client';
import { fakeModel, msg, textBlock, thinkingBlock, toolBlock, textDelta, thinkingDelta, type Scripted } from './fake-model';
import { AIReportGeneratorService, REPORT_OUTPUT_SCHEMA, type ReportData } from '../../ai-report-generator.service';
import { AIChatService, CHAT_ERROR_REPLY, CHAT_REFUSAL_REPLY, CHAT_TRUNCATED_NOTICE, type ChatContext } from '../../ai-chat.service';
import { NLQueryService, NLParserUnavailableError } from '../../nl-query.service';
import { AIInsightsService, DASHBOARD_SUMMARY_TOOL, DASHBOARD_SUMMARY_TOOL_NAME } from '../../ai-insights.service';
import { ForecastAIService } from '../../forecast-ai.service';
import { AnomalyAIService } from '../../anomaly-ai.service';
import { chatCosts, evidenceBundle } from '../../__tests__/chat-context-fixtures';

const ORG = '11111111-1111-1111-1111-111111111111';
let logs: string[];

beforeEach(() => {
  logs = [];
  const capture = (...args: unknown[]) => { logs.push(args.map(String).join(' ')); };
  jest.spyOn(console, 'log').mockImplementation(capture);
  jest.spyOn(console, 'warn').mockImplementation(capture);
  jest.spyOn(console, 'error').mockImplementation(capture);
});

afterEach(() => {
  setModelClientForTests(undefined);
  jest.restoreAllMocks();
});

function install(script: Scripted[]) {
  const fake = fakeModel(script);
  setModelClientForTests(fake.client);
  return fake;
}

/** The structured line the client writes for each call. */
function modelLogs(): Array<Record<string, any>> {
  return logs.filter((l) => l.startsWith('[AI Model] ')).map((l) => JSON.parse(l.slice('[AI Model] '.length)));
}

const stubPool = { query: jest.fn(async () => ({ rows: [] })), connect: jest.fn() } as any;

// ---------------------------------------------------------------------------
// Fixtures for each call site
// ---------------------------------------------------------------------------

const VALID_REPORT = {
  summary: 'Model summary.',
  keyHighlights: ['h1'],
  topRecommendations: [{ title: 'Review idle resources', impact: 'medium', description: 'd', effort: 'low' }],
  executiveSummary: 'Model executive summary.',
};

const reportData: ReportData = { organizationId: ORG, reportType: 'weekly_summary', dateRange: { from: '2026-10-29', to: '2026-11-05' }, sections: {} };

const none = (source: string) => ({ state: 'unavailable' as const, source, provenance: null, asOf: null, scope: null, period: null, completeness: null, coverage: null, reason: 'no data', derivedFrom: null, data: null });
const chatContext: ChatContext = {
  discovery: none('discovery'),
  account: none('account'),
  services: none('services'),
  costs: chatCosts({
    state: 'unavailable', source: 'unavailable', current: null, asOf: null, period: null, scope: null, topSpenders: null,
    costExplorer: { state: 'unavailable', reason: null }, estimateCoverage: null,
    comparison: { state: 'unavailable', note: null, currentWindow: null, previousWindow: null, currentWindowTotal: null, previousWindowTotal: null, changeAmount: null, changePercent: null, coverage: null, currentWindowIncludesToday: false, finishedThrough: null, asOf: null, basis: 'b' },
  }),
  inventoryScope: { kind: 'resource_inventory', connectedAccountId: null, discoveryRegion: null },
  resources: none('resources'),
  dora: none('dora'),
  evidence: evidenceBundle(),
};

const forecast: any = {
  id: 'f', organizationId: ORG, generatedAt: new Date(), historicalData: [{ date: '2026-10-01', value: 1 }], historicalStartDate: new Date(), historicalEndDate: new Date(),
  historicalAverage: 10, historicalTotal: 900, predictions: [], predictionStartDate: new Date(), predictionEndDate: new Date(), forecastPeriod: '30d', forecastMethod: 'linear',
  predicted30Day: 300, predicted60Day: 600, predicted90Day: 900, predictedQuarter: 900, predictedYear: 3600,
  trend: 'increasing', growthRate: 5, volatility: 20, confidence: 80, confidenceInterval: { lower: 250, upper: 350 },
};

const anomaly: any = {
  id: 'a', organizationId: ORG, type: 'cost_spike', severity: 'warning', metric: 'cost', currentValue: 200, expectedValue: 100, deviation: 100,
  historicalAverage: 100, historicalStdDev: 10, detectedAt: new Date(), timeWindow: '24h', region: 'us-east-1',
  title: 'Statistical title', description: 'Statistical description', aiExplanation: '', impact: '', recommendation: '', confidence: 0,
};

async function chatOutput(): Promise<string> {
  let out = '';
  for await (const chunk of new AIChatService(stubPool).chat([{ role: 'user', content: 'What is my spend?' }], chatContext)) out += chunk;
  return out;
}

// ---------------------------------------------------------------------------
// Request shapes, one per route, from the call sites themselves
// ---------------------------------------------------------------------------

describe('request shape per route (sent by the real call site)', () => {
  const options = (route: keyof typeof ROUTE_CONFIG) => ({ timeout: ROUTE_CONFIG[route].timeoutMs, maxRetries: 0, signal: expect.any(AbortSignal) });

  it('model and retries are pinned in one place', () => {
    expect(AI_MODEL).toBe('claude-sonnet-5');
    expect(MODEL_MAX_RETRIES).toBe(0);
  });

  it('report: streamed, adaptive thinking (omitted), no effort, 16000 tokens, structured output', async () => {
    const fake = install([{ message: msg([textBlock(JSON.stringify(VALID_REPORT))]) }]);
    await new AIReportGeneratorService(stubPool).generateWeeklyReport(reportData);
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]).toEqual({
      transport: 'stream',
      body: {
        model: 'claude-sonnet-5',
        max_tokens: 16000,
        system: expect.any(String),
        messages: [{ role: 'user', content: expect.any(String) }],
        output_config: { format: { type: 'json_schema', schema: REPORT_OUTPUT_SCHEMA } },
      },
      options: options('report'),
    });
  });

  it('chat: streamed, adaptive thinking (omitted), no effort, 8000 tokens, no tools', async () => {
    const fake = install([{ events: [textDelta('hi')], message: msg([textBlock('hi')]) }]);
    await chatOutput();
    expect(fake.requests[0]).toEqual({
      transport: 'stream',
      body: { model: 'claude-sonnet-5', max_tokens: 8000, system: expect.any(String), messages: [{ role: 'user', content: expect.stringContaining('User question: What is my spend?') }] },
      options: options('chat'),
    });
  });

  it('nl_parse: thinking disabled, no effort, 512 tokens', async () => {
    const fake = install([{ message: msg([textBlock('TARGET: costs\nCONFIDENCE: high\nPERIOD: none')]) }]);
    await new NLQueryService(stubPool).parseQuery('what is my aws spend', ORG);
    expect(fake.requests[0]).toEqual({
      transport: 'create',
      body: { model: 'claude-sonnet-5', max_tokens: 512, thinking: { type: 'disabled' }, messages: [{ role: 'user', content: expect.any(String) }] },
      options: options('nl_parse'),
    });
  });

  it('dashboard_summary: thinking disabled, no effort, 1024 tokens, one strict tool with tool_choice auto (never forced)', async () => {
    const fake = install([{ message: msg([toolBlock(DASHBOARD_SUMMARY_TOOL_NAME, { overallHealth: { score: 70, context: 'c' }, topRisk: null, cloudSpend: null, systemStatus: null })], 'tool_use') }]);
    await new AIInsightsService().generateStructuredDashboardSummary('Facts: none');
    expect(fake.requests[0]).toEqual({
      transport: 'create',
      body: {
        model: 'claude-sonnet-5', max_tokens: 1024, thinking: { type: 'disabled' },
        messages: [{ role: 'user', content: expect.stringContaining(`Respond only by calling the ${DASHBOARD_SUMMARY_TOOL_NAME} tool once.`) }],
        tools: [DASHBOARD_SUMMARY_TOOL], tool_choice: { type: 'auto' },
      },
      options: options('dashboard_summary'),
    });
    expect(DASHBOARD_SUMMARY_TOOL.strict).toBe(true);
    expect((DASHBOARD_SUMMARY_TOOL.input_schema as any).additionalProperties).toBe(false);
    expect((DASHBOARD_SUMMARY_TOOL.input_schema as any).properties.overallHealth.additionalProperties).toBe(false);
  });

  it('forecast: adaptive thinking (omitted), no effort, 8000 tokens', async () => {
    const fake = install([{ message: msg([textBlock('SUMMARY: s')]) }]);
    await new ForecastAIService().analyzeForecast(forecast);
    expect(fake.requests[0]).toEqual({
      transport: 'create',
      body: { model: 'claude-sonnet-5', max_tokens: 8000, messages: [{ role: 'user', content: expect.any(String) }] },
      options: options('forecast'),
    });
  });

  it('anomaly: thinking disabled, no effort, 1024 tokens', async () => {
    const fake = install([{ message: msg([textBlock('CONFIRMED: yes\nCONFIDENCE: 90')]) }]);
    await new AnomalyAIService().explainAnomalies([anomaly]);
    expect(fake.requests[0]).toEqual({
      transport: 'create',
      body: { model: 'claude-sonnet-5', max_tokens: 1024, thinking: { type: 'disabled' }, messages: [{ role: 'user', content: expect.any(String) }] },
      options: options('anomaly'),
    });
  });

  it('no route configures effort (deferred to the model-upgrade PR)', () => {
    for (const [route, config] of Object.entries(ROUTE_CONFIG)) {
      expect([route, config.effort]).toEqual([route, null]);
    }
  });

  it('no request from any call site contains output_config.effort', async () => {
    const fake = install([
      { message: msg([textBlock(JSON.stringify(VALID_REPORT))]) },
      { events: [textDelta('hi')], message: msg([textBlock('hi')]) },
      { message: msg([textBlock('TARGET: costs\nCONFIDENCE: high\nPERIOD: none')]) },
      { message: msg([toolBlock(DASHBOARD_SUMMARY_TOOL_NAME, { overallHealth: { score: 70, context: 'c' }, topRisk: null, cloudSpend: null, systemStatus: null })], 'tool_use') },
      { message: msg([textBlock('SUMMARY: s')]) },
      { message: msg([textBlock('CONFIRMED: yes\nCONFIDENCE: 90')]) },
    ]);
    await new AIReportGeneratorService(stubPool).generateWeeklyReport(reportData);
    await chatOutput();
    await new NLQueryService(stubPool).parseQuery('what is my aws spend', ORG);
    await new AIInsightsService().generateStructuredDashboardSummary('Facts: none');
    await new ForecastAIService().analyzeForecast(forecast);
    await new AnomalyAIService().explainAnomalies([anomaly]);

    expect(fake.requests).toHaveLength(6);
    expect(fake.remaining()).toBe(0);
    for (const request of fake.requests) {
      expect(request.body.output_config?.effort).toBeUndefined();
      // output_config, when present, carries only the structured-output format.
      // (A string check would be wrong: the report schema has a recommendation field named "effort".)
      expect(Object.keys(request.body.output_config ?? {}).filter((k) => k !== 'format')).toEqual([]);
      expect(Object.keys(request.body)).not.toContain('effort');
    }
  });

  it('every structured-output object closes with additionalProperties: false', () => {
    const objects: any[] = [];
    const walk = (node: any) => {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'object') objects.push(node);
      Object.values(node).forEach(walk);
    };
    walk(REPORT_OUTPUT_SCHEMA);
    walk(DASHBOARD_SUMMARY_TOOL.input_schema);
    expect(objects.length).toBeGreaterThan(4);
    for (const o of objects) expect(o.additionalProperties).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Overall deadline per route (review L1)
// ---------------------------------------------------------------------------

describe('overall deadline per route (review L1)', () => {
  const PENDING = Symbol('still pending');
  /** Advances fake time by `ms`, then reports the call's result, or PENDING if it has not settled. */
  async function after<T>(call: Promise<T>, ms: number): Promise<T | typeof PENDING> {
    await jest.advanceTimersByTimeAsync(ms);
    return Promise.race([call, new Promise<typeof PENDING>((resolve) => setImmediate(() => resolve(PENDING)))]);
  }

  beforeEach(() => jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] }));
  afterEach(() => jest.useRealTimers());

  it('every route has one: reports 90 s, chat 120 s, the others their SDK timeout, which never exceeds it', () => {
    const deadlines = Object.fromEntries(Object.entries(ROUTE_CONFIG).map(([route, config]) => [route, config.deadlineMs]));
    expect(deadlines).toEqual({ chat: 120_000, report: 90_000, nl_parse: 30_000, dashboard_summary: 30_000, forecast: 120_000, anomaly: 30_000 });
    for (const config of Object.values(ROUTE_CONFIG)) expect(config.timeoutMs).toBeLessThanOrEqual(config.deadlineMs);
  });

  it.each([false, true])('report: a stalled stream is aborted at 90 s and the report falls back with reason error_timeout (transport ignores the abort: %s)', async (ignoresAbort) => {
    const fake = install([{ stall: true, ignoresAbort }]);
    const call = new AIReportGeneratorService(stubPool).generateWeeklyReport(reportData);
    expect(await after(call, 89_999)).toBe(PENDING);
    const result = await after(call, 1);
    expect(result).toMatchObject({ wasFallback: true, fallbackReason: 'error_timeout' });
    expect(fake.requests[0].options?.signal.aborted).toBe(true);
    expect(fake.aborts).toHaveLength(1);
    expect(jest.getTimerCount()).toBe(0);
    expect(modelLogs()).toEqual([expect.objectContaining({ route: 'report', outcome: 'error', errorCode: 'timeout', fallbackReason: 'error_timeout' })]);
  });

  it.each([false, true])('chat: a stream that stalls part-way is aborted at 120 s; the partial text is kept and the existing error reply follows (transport ignores the abort: %s)', async (ignoresAbort) => {
    const fake = install([{ stall: true, ignoresAbort, events: [textDelta('Partial answer')] }]);
    const call = chatOutput();
    expect(await after(call, 119_999)).toBe(PENDING);
    expect(await after(call, 1)).toBe(`Partial answer\n\n${CHAT_ERROR_REPLY}`);
    expect(fake.requests[0].options?.signal.aborted).toBe(true);
    expect(fake.aborts).toHaveLength(1);
    expect(jest.getTimerCount()).toBe(0);
    expect(modelLogs()).toEqual([expect.objectContaining({ route: 'chat', outcome: 'error', errorCode: 'timeout', fallbackReason: 'error_timeout' })]);
  });

  it.each<AIRoute>(['nl_parse', 'dashboard_summary', 'forecast', 'anomaly'])('%s: a request that never answers ends at its deadline as error_timeout', async (route) => {
    const fake = install([{ stall: true, ignoresAbort: true }]);
    const call = runModel(route, 'deadline_test', { messages: [{ role: 'user', content: 'q' }] }, () => ({ ok: true, value: 'used' }));
    expect(await after(call, ROUTE_CONFIG[route].deadlineMs - 1)).toBe(PENDING);
    expect(await after(call, 1)).toMatchObject({ ok: false, reason: 'error_timeout' });
    expect(fake.requests[0].options?.signal.aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('a call that finishes in time is used, and leaves no timer behind', async () => {
    install([
      { message: msg([textBlock(JSON.stringify(VALID_REPORT))]) },
      { events: [textDelta('hi')], message: msg([textBlock('hi')]) },
    ]);
    expect(await new AIReportGeneratorService(stubPool).generateWeeklyReport(reportData)).toMatchObject({ wasFallback: false });
    expect(await chatOutput()).toBe('hi');
    expect(jest.getTimerCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// AI Reports
// ---------------------------------------------------------------------------

describe('AI Reports', () => {
  const generate = () => new AIReportGeneratorService(stubPool).generateWeeklyReport(reportData);

  it('fixture 1, [thinking(""), text]: the model report is used (regression for "Unexpected response type")', async () => {
    install([{ message: msg([thinkingBlock(''), textBlock(JSON.stringify(VALID_REPORT))]) }]);
    const result = await generate();
    expect(result.wasFallback).toBe(false);
    expect(result.fallbackReason).toBeNull();
    expect(result.report.summary).toBe('Model summary.');
    expect(logs.join('\n')).not.toMatch(/Unexpected response type/);
  });

  it.each<[string, Scripted, string]>([
    ['truncated JSON at max_tokens', { message: msg([thinkingBlock(''), textBlock('{"summary": "par')], 'max_tokens') }, 'truncated'],
    ['a complete-looking JSON that still stopped at max_tokens', { message: msg([textBlock(JSON.stringify(VALID_REPORT))], 'max_tokens') }, 'truncated'],
    ['only thinking at max_tokens', { message: msg([thinkingBlock('')], 'max_tokens') }, 'truncated'],
    ['a refusal', { message: msg([], 'refusal', { stop_details: { type: 'refusal', category: 'cyber' } }) }, 'refused'],
    ['an empty response', { message: msg([]) }, 'empty'],
    ['malformed (no content array)', { message: { stop_reason: 'end_turn' } }, 'malformed'],
    ['text that is not JSON (fixture 12)', { message: msg([textBlock('Here is your report: great job!')]) }, 'malformed_output'],
    ['JSON missing required fields', { message: msg([textBlock(JSON.stringify({ summary: 's' }))]) }, 'malformed_output'],
    ['JSON with a wrong enum', { message: msg([textBlock(JSON.stringify({ ...VALID_REPORT, topRecommendations: [{ title: 't', impact: 'huge', description: 'd', effort: 'low' }] }))]) }, 'malformed_output'],
    ['a tool call instead of text', { message: msg([toolBlock('x', {})], 'tool_use') }, 'unexpected_tool'],
    ['a timeout', { error: new Anthropic.APIConnectionTimeoutError() }, 'error_timeout'],
    ['overloaded', { error: new Anthropic.InternalServerError(529, { type: 'error' }, 'overloaded', new Headers()) }, 'error_overloaded'],
  ])('%s: the deterministic report, with the reason recorded', async (_name, scripted, reason) => {
    const fake = install([scripted]);
    const result = await generate();
    expect(result.wasFallback).toBe(true);
    expect(result.fallbackReason).toBe(reason);
    expect(result.report.summary).not.toBe('Model summary.');
    expect(fake.requests).toHaveLength(1); // no retry: no second model cost
    expect(modelLogs()).toEqual([expect.objectContaining({ feature: 'ai_reports', route: 'report', fallbackReason: reason })]);
  });

  it('no API key: the deterministic report, reason not_configured, no request', async () => {
    setModelClientForTests(null);
    const result = await generate();
    expect(result).toMatchObject({ wasFallback: true, fallbackReason: 'not_configured' });
  });

  it('the model cannot add fields: only the schema fields are kept', async () => {
    install([{ message: msg([textBlock(JSON.stringify({ ...VALID_REPORT, meta: { wasFallback: false, injected: true }, topRecommendations: [{ ...VALID_REPORT.topRecommendations[0], estimatedSavingsPriceUnknown: false, extra: 1 }] }))]) }]);
    const { report } = await generate();
    expect(report).not.toHaveProperty('meta');
    expect(report.topRecommendations[0]).toEqual({ title: 'Review idle resources', impact: 'medium', description: 'd', effort: 'low' });
  });

  it('a whole-text code fence is tolerated; prose around the JSON is not', async () => {
    install([
      { message: msg([textBlock('```json\n' + JSON.stringify(VALID_REPORT) + '\n```')]) },
      { message: msg([textBlock('Report:\n' + JSON.stringify(VALID_REPORT))]) },
    ]);
    expect((await generate()).wasFallback).toBe(false);
    expect(await generate()).toMatchObject({ wasFallback: true, fallbackReason: 'malformed_output' });
  });

  it('saveGeneratedReport records the fallback reason in report_data.meta', async () => {
    const query = jest.fn(async () => ({ rows: [{ id: 'r1' }] }));
    const service = new AIReportGeneratorService({ query } as any);
    await service.saveGeneratedReport(ORG, VALID_REPORT as any, reportData.dateRange, 'weekly_summary', undefined, true, 'truncated');
    await service.saveGeneratedReport(ORG, VALID_REPORT as any, reportData.dateRange, 'weekly_summary', undefined, false, null);
    const stored = (query.mock.calls as any[]).map((call) => JSON.parse(call[1][5]));
    expect(stored[0].meta).toEqual({ wasFallback: true, fallbackReason: 'truncated' });
    expect(stored[0].summary).toBe('Model summary.');
    expect(stored[1].meta).toEqual({ wasFallback: false, fallbackReason: null });
  });
});

// ---------------------------------------------------------------------------
// AI Chat (streamed)
// ---------------------------------------------------------------------------

describe('AI Chat', () => {
  it('thinking deltas are never streamed; text after thinking is', async () => {
    install([{ events: [thinkingDelta('SECRET-THINKING'), textDelta('Your spend '), textDelta('is unknown.')], message: msg([thinkingBlock('SECRET-THINKING'), textBlock('Your spend is unknown.')]) }]);
    const out = await chatOutput();
    expect(out).toBe('Your spend is unknown.');
    expect(out).not.toContain('SECRET-THINKING');
  });

  it('the approved chat copy, verbatim', () => {
    expect(CHAT_TRUNCATED_NOTICE).toBe('(Answer cut short: it reached the maximum response length. Ask a narrower question for a complete answer.)');
    expect(CHAT_REFUSAL_REPLY).toBe("I can't help with that request.");
    expect(CHAT_ERROR_REPLY).toBe('I apologize, but I encountered an error processing your request. Please try again.');
  });

  it('max_tokens: the streamed text is followed by the "answer cut short" notice', async () => {
    install([{ events: [textDelta('Part of an answer')], message: msg([textBlock('Part of an answer')], 'max_tokens') }]);
    expect(await chatOutput()).toBe(`Part of an answer\n\n${CHAT_TRUNCATED_NOTICE}`);
    expect(modelLogs()).toEqual([expect.objectContaining({ route: 'chat', outcome: 'truncated', stopReason: 'max_tokens', fallbackReason: 'truncated' })]);
  });

  it('max_tokens spent on thinking alone: only the notice', async () => {
    install([{ events: [thinkingDelta('x')], message: msg([thinkingBlock('x')], 'max_tokens') }]);
    expect(await chatOutput()).toBe(CHAT_TRUNCATED_NOTICE);
  });

  it.each<[string, Scripted, string]>([
    ['a refusal with no text', { events: [], message: msg([], 'refusal', { stop_details: { type: 'refusal', category: null } }) }, CHAT_REFUSAL_REPLY],
    ['an empty answer', { events: [], message: msg([]) }, CHAT_ERROR_REPLY],
    ['a failed request', { error: new Anthropic.RateLimitError(429, { type: 'error' }, 'rate', new Headers()) }, CHAT_ERROR_REPLY],
  ])('%s: the refusal reply for a refusal, the existing error reply otherwise', async (_name, scripted, expected) => {
    install([scripted]);
    expect(await chatOutput()).toBe(expected);
  });

  it('a refusal or error after some text: the refusal or error reply follows it, never a silent stop', async () => {
    install([
      { events: [textDelta('Sure, here')], message: msg([textBlock('Sure, here')], 'refusal', { stop_details: { type: 'refusal', category: null } }) },
      { events: [textDelta('Partial'), { throw: new Anthropic.APIError(undefined, { type: 'error' }, 'overloaded_error', undefined) }] },
    ]);
    expect(await chatOutput()).toBe(`Sure, here\n\n${CHAT_REFUSAL_REPLY}`);
    expect(await chatOutput()).toBe(`Partial\n\n${CHAT_ERROR_REPLY}`);
  });

  it('no retry after a failure (one request only)', async () => {
    const fake = install([{ error: new Anthropic.APIConnectionTimeoutError() }]);
    await chatOutput();
    expect(fake.stream).toHaveBeenCalledTimes(1);
    expect(fake.requests[0].options).toMatchObject({ maxRetries: 0 });
  });

  it('a consumer that stops early aborts the model stream and the call is still logged', async () => {
    const fake = install([{ events: [textDelta('one'), textDelta('two'), textDelta('three')], message: msg([textBlock('onetwothree')]) }]);
    const iterator = new AIChatService(stubPool).chat([{ role: 'user', content: 'q' }], chatContext);
    expect((await iterator.next()).value).toBe('one');
    await iterator.return(undefined);
    expect(fake.aborts).toHaveLength(1);
    expect(modelLogs()).toEqual([expect.objectContaining({ route: 'chat', outcome: 'error', errorCode: 'aborted' })]);
  });
});

// ---------------------------------------------------------------------------
// Ask AI (NL parse), Dashboard summary, Forecast, Anomaly
// ---------------------------------------------------------------------------

describe('Ask AI parser', () => {
  const parse = () => new NLQueryService(stubPool).parseQuery('what is my aws spend', ORG);

  it('a complete text answer after a thinking block is parsed', async () => {
    install([{ message: msg([thinkingBlock(''), textBlock('TARGET: costs\nCONFIDENCE: high\nPERIOD: none')]) }]);
    await expect(parse()).resolves.toMatchObject({ target: 'costs' });
  });

  it.each<[string, Scripted, string]>([
    ['max_tokens', { message: msg([textBlock('TARGET: cos')], 'max_tokens') }, 'truncated'],
    ['refusal', { message: msg([], 'refusal') }, 'refused'],
    ['empty', { message: msg([]) }, 'empty'],
    ['a tool call', { message: msg([toolBlock('x', {})], 'tool_use') }, 'unexpected_tool'],
    ['an error', { error: new Anthropic.APIConnectionError({ message: 'reset' }) }, 'error_network'],
  ])('%s: "Ask AI unavailable", never a partial parse', async (_name, scripted, reason) => {
    install([scripted]);
    await expect(parse()).rejects.toThrow(NLParserUnavailableError);
    expect(modelLogs()).toEqual([expect.objectContaining({ route: 'nl_parse', fallbackReason: reason })]);
  });
});

describe('Dashboard summary (one strict tool, tool_choice auto)', () => {
  const summarize = () => new AIInsightsService().generateStructuredDashboardSummary('Facts: none');
  const input = { overallHealth: { score: 72, context: 'cost is driving it' }, topRisk: 'SSH open', cloudSpend: '', systemStatus: null };

  it('a valid tool call, with text alongside it, is used', async () => {
    install([{ message: msg([textBlock('Here you go.'), toolBlock(DASHBOARD_SUMMARY_TOOL_NAME, input)], 'tool_use') }]);
    expect(await summarize()).toEqual({ overallHealth: { score: 72, context: 'cost is driving it' }, topRisk: 'SSH open', cloudSpend: null, systemStatus: null });
  });

  it.each<[string, Scripted, string]>([
    ['a prose answer (no tool call)', { message: msg([textBlock('Overall health is 72.')]) }, 'no_tool_call'],
    ['another tool', { message: msg([toolBlock('other_tool', input)], 'tool_use') }, 'unexpected_tool'],
    ['a wrong field type', { message: msg([toolBlock(DASHBOARD_SUMMARY_TOOL_NAME, { ...input, overallHealth: { score: 'high', context: null } })], 'tool_use') }, 'malformed_output'],
    ['max_tokens mid tool call', { message: msg([toolBlock(DASHBOARD_SUMMARY_TOOL_NAME, {})], 'max_tokens') }, 'truncated'],
    ['a bad request', { error: new Anthropic.BadRequestError(400, { type: 'error' }, 'bad', new Headers()) }, 'error_bad_request'],
  ])('%s: null (the deterministic fields only)', async (_name, scripted, reason) => {
    install([scripted]);
    expect(await summarize()).toBeNull();
    expect(modelLogs()).toEqual([expect.objectContaining({ route: 'dashboard_summary', fallbackReason: reason })]);
  });
});

describe('Forecast AI', () => {
  it('a text answer is used', async () => {
    install([{ message: msg([thinkingBlock(''), textBlock('SUMMARY: Costs rise.\nRISKS:\n- A long enough risk line\nRECOMMENDATIONS:\n- A long enough recommendation')]) }]);
    const result = await new ForecastAIService().analyzeForecast(forecast);
    expect(result.aiSummary).toBe('Costs rise.');
  });

  it('max_tokens: the basic analysis, never a partial one', async () => {
    install([{ message: msg([textBlock('SUMMARY: Costs ri')], 'max_tokens') }]);
    const result = await new ForecastAIService().analyzeForecast(forecast);
    expect(result.aiSummary).toMatch(/^Based on 1 days of data/);
  });
});

describe('Anomaly AI', () => {
  it('a failed call keeps the statistical detection with fallback copy, logged without the error object', async () => {
    const error = new Anthropic.InternalServerError(500, { type: 'error' }, 'SDK-ERROR-DETAIL', new Headers());
    install([{ error }]);
    const [result] = await new AnomalyAIService().explainAnomalies([anomaly]);
    expect(result).toMatchObject({ title: 'Statistical title', confidence: 50 });
    expect(result.aiExplanation.length).toBeGreaterThan(0);
    for (const call of (console.error as jest.Mock).mock.calls) expect(call).not.toContain(error);
    expect(logs.join('\n')).not.toContain('SDK-ERROR-DETAIL');
    expect(modelLogs()).toEqual([expect.objectContaining({ route: 'anomaly', errorCode: 'server', httpStatus: 500 })]);
  });

  it('max_tokens: fallback, not a partial enrichment', async () => {
    install([{ message: msg([textBlock('CONFIRMED: yes\nTITLE: Half')], 'max_tokens') }]);
    const [result] = await new AnomalyAIService().explainAnomalies([anomaly]);
    expect(result.title).toBe('Statistical title');
  });
});

// ---------------------------------------------------------------------------
// The call log
// ---------------------------------------------------------------------------

describe('the model call log', () => {
  const PROMPT_MARK = 'PROMPT-MARK-7d1e';
  const RESPONSE_MARK = 'RESPONSE-MARK-3b9a';
  const THINKING_MARK = 'THINKING-MARK-55c0';
  const ERROR_MARK = 'ERROR-MARK-a0f2';
  const KEY = 'sk-ant-test-KEY-MARK-91aa';

  it('one line per call, with outcome, stop reason and usage -- never prompt, response, thinking, evidence, key or SDK message', async () => {
    const original = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = KEY;
    try {
      install([
        { message: msg([thinkingBlock(THINKING_MARK), textBlock(`TARGET: costs ${RESPONSE_MARK}\nCONFIDENCE: high\nPERIOD: none`)]) },
        { message: msg([thinkingBlock(THINKING_MARK), textBlock(RESPONSE_MARK)], 'max_tokens') },
        { error: new Anthropic.BadRequestError(400, { type: 'error', error: { message: ERROR_MARK } }, ERROR_MARK, new Headers()) },
        { events: [thinkingDelta(THINKING_MARK), textDelta(RESPONSE_MARK)], message: msg([thinkingBlock(THINKING_MARK), textBlock(RESPONSE_MARK)], 'refusal') },
      ]);
      await new NLQueryService(stubPool).parseQuery(`what is my aws spend ${PROMPT_MARK}`, ORG).catch(() => undefined);
      await new ForecastAIService().analyzeForecast({ ...forecast, trend: PROMPT_MARK });
      await new AIInsightsService().generateStructuredDashboardSummary(`Facts: ${PROMPT_MARK}`);
      for await (const _ of new AIChatService(stubPool).chat([{ role: 'user', content: PROMPT_MARK }], chatContext)) { /* drain */ }

      const lines = modelLogs();
      expect(lines.map((l) => l.route)).toEqual(['nl_parse', 'forecast', 'dashboard_summary', 'chat']);
      expect(lines[0]).toMatchObject({ outcome: 'text', stopReason: 'end_turn', inputTokens: 100, outputTokens: 50, blockTypes: ['thinking', 'text'], fallbackReason: null });
      expect(lines[1]).toMatchObject({ outcome: 'truncated', stopReason: 'max_tokens', fallbackReason: 'truncated' });
      expect(lines[2]).toMatchObject({ outcome: 'error', errorCode: 'bad_request', httpStatus: 400, fallbackReason: 'error_bad_request' });
      expect(lines[3]).toMatchObject({ outcome: 'refused', fallbackReason: 'refused' });

      const everything = logs.join('\n');
      for (const mark of [PROMPT_MARK, RESPONSE_MARK, THINKING_MARK, ERROR_MARK, KEY, 'KEY-MARK']) {
        expect(everything).not.toContain(mark);
      }
    } finally {
      if (original === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = original;
    }
  });
});
