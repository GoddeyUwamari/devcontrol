/**
 * Review L1 (AI truth PR 1): no request holds its pooled database connection
 * while a long model call runs. The report, chat (streamed and sync) and
 * forecast handlers give the request's connection back
 * (releaseRequestConnection) after their database reads and before the model
 * is called. A report whose stream stalls then ends at the report deadline
 * as the deterministic fallback, saved with reason error_timeout.
 *
 * The lease is the real one (leaseRequestClient); the connection is a stub.
 * No database, AWS or model access.
 */
import { EventEmitter } from 'events';
import { leaseRequestClient } from '../../middleware/request-lifecycle';
import { setModelClientForTests } from '../../services/ai/model-client';
import { fakeModel } from '../../services/ai/__tests__/fake-model';
import { AIReportsController } from '../ai-reports.controller';
import { AIReportGeneratorService } from '../../services/ai-report-generator.service';
import { AIChatController } from '../ai-chat.controller';
import { AIChatService } from '../../services/ai-chat.service';
import { AIChatContextRepository } from '../../repositories/ai-chat-context.repository';
import { ForecastController } from '../forecast.controller';
import { CostForecastService } from '../../services/cost-forecast.service';
import { ForecastAIService } from '../../services/forecast-ai.service';

const ORG = '11111111-1111-1111-1111-111111111111';

/** A response the real lease can watch, plus a stub connection leased to it. */
function leasedRequest(body: unknown) {
  const res: any = new EventEmitter();
  res.statusCode = 200;
  res.headersSent = false;
  res.status = jest.fn((code: number) => { res.statusCode = code; return res; });
  res.json = jest.fn(() => res);
  res.setHeader = jest.fn(() => res);
  res.write = jest.fn(() => true);
  res.end = jest.fn(() => res);
  const connection = { query: jest.fn(async () => ({ rows: [] })), release: jest.fn() };
  const lease = leaseRequestClient(connection as any, res);
  lease.bindVerifiedOrganization(ORG);
  const req: any = { body, query: {}, user: { organizationId: ORG } };
  return { req, res, connection, lease };
}

const chatContext = {
  services: { state: 'unavailable', data: null },
  costs: { current: null, state: 'unavailable', source: 'unavailable', asOf: null },
  discovery: { data: null },
  alerts: { state: 'not_supported', data: null },
} as never;

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  setModelClientForTests(undefined);
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('the request connection is not held across a model call', () => {
  it('report: released after the data is read and before the model is called; a stalled stream ends at 90 s as a saved fallback', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
    const data = { organizationId: ORG, reportType: 'weekly_summary', dateRange: { from: '2026-10-29', to: '2026-11-05' }, sections: {} };
    const fetchReportData = jest.spyOn(AIReportGeneratorService.prototype, 'fetchReportData').mockResolvedValue(data);
    const save = jest.spyOn(AIReportGeneratorService.prototype, 'saveGeneratedReport').mockResolvedValue('report-id');
    const fake = fakeModel([{ stall: true }]);
    setModelClientForTests(fake.client);
    const { req, res, connection, lease } = leasedRequest({ reportType: 'weekly_summary' });

    const handled = new AIReportsController().generateReport(req, res);
    await jest.advanceTimersByTimeAsync(0);

    // The model call is in flight, and the request's connection is already back in the pool.
    expect(fake.stream).toHaveBeenCalledTimes(1);
    expect(lease.released).toBe(true);
    expect(connection.release).toHaveBeenCalledTimes(1);
    expect(fetchReportData.mock.invocationCallOrder[0]).toBeLessThan(connection.release.mock.invocationCallOrder[0]);
    expect(connection.release.mock.invocationCallOrder[0]).toBeLessThan(fake.stream.mock.invocationCallOrder[0]);
    expect(save).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(90_000);
    await handled;

    expect(fake.requests[0].options?.signal.aborted).toBe(true);
    expect(fake.aborts).toHaveLength(1);
    expect(save).toHaveBeenCalledWith(ORG, expect.any(Object), data.dateRange, 'weekly_summary', undefined, true, 'error_timeout');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, data: expect.objectContaining({ wasFallback: true }) }));
    expect(connection.release).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it.each(['chat', 'chatSync'] as const)('%s: released after the context is read and before the model is called', async (handler) => {
    const gatherContext = jest.spyOn(AIChatContextRepository.prototype, 'gatherContext').mockResolvedValue(chatContext);
    const { req, res, connection, lease } = leasedRequest({ messages: [{ role: 'user', content: 'What is my spend?' }] });
    const releasedAtModelCall: boolean[] = [];
    if (handler === 'chat') {
      jest.spyOn(AIChatService.prototype, 'chat').mockImplementation(async function* () {
        releasedAtModelCall.push(lease.released);
        yield 'ok';
      } as never);
    } else {
      jest.spyOn(AIChatService.prototype, 'chatSync').mockImplementation(async () => {
        releasedAtModelCall.push(lease.released);
        return 'ok';
      });
    }

    await new AIChatController({} as any)[handler](req, res);

    expect(gatherContext).toHaveBeenCalledWith(ORG);
    expect(gatherContext.mock.invocationCallOrder[0]).toBeLessThan(connection.release.mock.invocationCallOrder[0]);
    expect(releasedAtModelCall).toEqual([true]);
    expect(connection.release).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
  });

  it('forecast: released after the forecast is computed and before the model is called', async () => {
    const generateForecast = jest.spyOn(CostForecastService.prototype, 'generateForecast').mockResolvedValue({ id: 'f' } as never);
    const { req, res, connection, lease } = leasedRequest({});
    const releasedAtModelCall: boolean[] = [];
    jest.spyOn(ForecastAIService.prototype, 'analyzeForecast').mockImplementation(async (forecast) => {
      releasedAtModelCall.push(lease.released);
      return forecast;
    });

    await new ForecastController({} as any).getForecast(req, res);

    expect(generateForecast).toHaveBeenCalledWith(ORG, '90d');
    expect(generateForecast.mock.invocationCallOrder[0]).toBeLessThan(connection.release.mock.invocationCallOrder[0]);
    expect(releasedAtModelCall).toEqual([true]);
    expect(connection.release).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith({ success: true, forecast: { id: 'f' } });
  });
});
