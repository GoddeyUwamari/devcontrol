/**
 * AIInsightsService's cache-cleanup interval. The service is created when its
 * modules are imported (routes/ai-insights.routes.ts, ai-summary.service.ts),
 * so the interval must not keep the process alive on its own: it is unref'd.
 * It still runs, and still removes entries older than the one-hour TTL.
 *
 * No DB or network.
 */
import { AIInsightsService } from '../ai-insights.service';

const FIFTEEN_MINUTES = 15 * 60 * 1000;

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it('the cleanup interval does not hold the process open', () => {
  const setIntervalSpy = jest.spyOn(global, 'setInterval');

  new AIInsightsService({} as any);

  expect(setIntervalSpy).toHaveBeenCalledTimes(1);
  expect(setIntervalSpy.mock.calls[0][1]).toBe(FIFTEEN_MINUTES);
  const timer = setIntervalSpy.mock.results[0].value as NodeJS.Timeout;
  try {
    expect(timer.hasRef()).toBe(false);
  } finally {
    clearInterval(timer);
  }
});

it('every 15 minutes it removes entries older than an hour and keeps the rest', () => {
  jest.useFakeTimers();
  const service = new AIInsightsService({} as any);
  const cache: Map<string, { timestamp: number }> = (service as any).cache;
  const now = Date.now();
  cache.set('expired', { timestamp: now - 61 * 60 * 1000 } as any);
  cache.set('fresh', { timestamp: now - 5 * 60 * 1000 } as any);

  jest.advanceTimersByTime(FIFTEEN_MINUTES);

  expect(cache.has('expired')).toBe(false);
  expect(cache.has('fresh')).toBe(true);
});
