/**
 * Regression coverage for the AI Insights cost-analysis cache tenant-isolation
 * fix. Before it, generateCacheKey() was `${type}_${current}_${previous}_${pct}`
 * with no organization identity, so two orgs submitting identical cost figures
 * shared one cached Claude response, and POST /clear-cache wiped every org's
 * entries.
 *
 * No DB or network: Anthropic is replaced with a jest mock on the instance,
 * and fake timers keep the constructor's cleanup setInterval from holding the
 * process open (and let the TTL test advance time).
 */
import { Request, Response } from 'express';
import { AIInsightsService, CostData } from '../ai-insights.service';
import { AIInsightsController } from '../../controllers/ai-insights.controller';

const ORG_A = '11111111-1111-1111-1111-111111111111';
const ORG_B = '22222222-2222-2222-2222-222222222222';

const INPUT: CostData = {
  previousCost: 1000,
  currentCost: 1250,
  percentageIncrease: 25,
  topSpenders: [{ service: 'Amazon EC2', cost: 800, change: 30 }],
  timeRange: '30d',
};

function claudeReply(tag: string) {
  return {
    content: [{
      type: 'text',
      text: `ROOT CAUSE: ${tag} root cause\nRECOMMENDATION: ${tag} recommendation\nESTIMATED_SAVINGS: 100`,
    }],
  };
}

function makeService() {
  const service = new AIInsightsService({} as any);
  const create = jest.fn();
  (service as any).anthropic = { messages: { create } };
  return { service, create };
}

describe('AIInsightsService cost-analysis cache — tenant isolation', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('A: identical inputs from two organizations produce separate cache entries', async () => {
    const { service, create } = makeService();
    create.mockResolvedValueOnce(claudeReply('org-a')).mockResolvedValueOnce(claudeReply('org-b'));

    await service.analyzeCostIncrease(ORG_A, INPUT);
    await service.analyzeCostIncrease(ORG_B, INPUT);

    expect(create).toHaveBeenCalledTimes(2);
    const a = service.getCacheStats(ORG_A);
    const b = service.getCacheStats(ORG_B);
    expect(a.size).toBe(1);
    expect(b.size).toBe(1);
    expect(a.keys[0]).not.toBe(b.keys[0]);
  });

  it('B: organization A reuses its own cached result', async () => {
    const { service, create } = makeService();
    create.mockResolvedValueOnce(claudeReply('org-a'));

    const first = await service.analyzeCostIncrease(ORG_A, INPUT);
    const second = await service.analyzeCostIncrease(ORG_A, INPUT);

    expect(create).toHaveBeenCalledTimes(1);
    expect(first.cached).toBeUndefined();
    expect(second.cached).toBe(true);
    expect(second.rootCause).toBe('org-a root cause');
  });

  it("C: organization B never receives organization A's cached result", async () => {
    const { service, create } = makeService();
    create.mockResolvedValueOnce(claudeReply('org-a')).mockResolvedValueOnce(claudeReply('org-b'));

    await service.analyzeCostIncrease(ORG_A, INPUT);
    const forB = await service.analyzeCostIncrease(ORG_B, INPUT);

    expect(create).toHaveBeenCalledTimes(2);
    expect(forB.cached).toBeUndefined();
    expect(forB.rootCause).toBe('org-b root cause');
    expect(forB.rootCause).not.toContain('org-a');
  });

  it('C: isolation holds for decrease and trend analyses too', async () => {
    const { service, create } = makeService();
    create.mockImplementation(async () => claudeReply(`call-${create.mock.calls.length}`));

    const dec = { ...INPUT, currentCost: 700, percentageIncrease: -30 };
    const trend = { ...INPUT, currentCost: 1010, percentageIncrease: 1 };

    const decA = await service.analyzeCostDecrease(ORG_A, dec);
    const decB = await service.analyzeCostDecrease(ORG_B, dec);
    const trendA = await service.analyzeCostTrend(ORG_A, trend);
    const trendB = await service.analyzeCostTrend(ORG_B, trend);

    expect(create).toHaveBeenCalledTimes(4);
    expect(decB.cached).toBeUndefined();
    expect(trendB.cached).toBeUndefined();
    expect(decB.rootCause).not.toBe(decA.rootCause);
    expect(trendB.rootCause).not.toBe(trendA.rootCause);
  });

  it("D: clearing organization A's cache leaves organization B's cache intact", async () => {
    const { service, create } = makeService();
    create.mockResolvedValueOnce(claudeReply('org-a')).mockResolvedValueOnce(claudeReply('org-b'));

    await service.analyzeCostIncrease(ORG_A, INPUT);
    await service.analyzeCostIncrease(ORG_B, INPUT);

    expect(service.clearCache(ORG_A)).toBe(1);
    expect(service.getCacheStats(ORG_A).size).toBe(0);
    expect(service.getCacheStats(ORG_B).size).toBe(1);

    const forB = await service.analyzeCostIncrease(ORG_B, INPUT);
    expect(forB.cached).toBe(true);
    expect(forB.rootCause).toBe('org-b root cause');
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('E: cache read/write/stats/clear fail closed without an organization id', async () => {
    const { service, create } = makeService();
    create.mockResolvedValue(claudeReply('org-a'));
    await service.analyzeCostIncrease(ORG_A, INPUT);

    for (const missing of [undefined, null, '', '   '] as any[]) {
      await expect(service.analyzeCostIncrease(missing, INPUT)).rejects.toThrow(/organizationId is required/);
      await expect(service.analyzeCostDecrease(missing, INPUT)).rejects.toThrow(/organizationId is required/);
      await expect(service.analyzeCostTrend(missing, INPUT)).rejects.toThrow(/organizationId is required/);
      expect(() => service.getCacheStats(missing)).toThrow(/organizationId is required/);
      expect(() => service.clearCache(missing)).toThrow(/organizationId is required/);
    }

    // Nothing was generated or cached for the missing-org calls, and A's entry survived.
    expect(create).toHaveBeenCalledTimes(1);
    expect(service.getCacheStats(ORG_A).size).toBe(1);
  });

  describe('F: same-organization hit/miss behavior is preserved', () => {
    it('misses when any prompt-visible input changes', async () => {
      const { service, create } = makeService();
      create.mockImplementation(async () => claudeReply(`call-${create.mock.calls.length}`));

      await service.analyzeCostIncrease(ORG_A, INPUT);
      await service.analyzeCostIncrease(ORG_A, { ...INPUT, currentCost: 1300, percentageIncrease: 30 });
      await service.analyzeCostIncrease(ORG_A, { ...INPUT, topSpenders: [{ service: 'Amazon RDS', cost: 800, change: 30 }] });
      await service.analyzeCostIncrease(ORG_A, { ...INPUT, timeRange: '7d' });

      expect(create).toHaveBeenCalledTimes(4);
      expect(service.getCacheStats(ORG_A).size).toBe(4);
    });

    it('increase/decrease/trend with the same figures are distinct entries', async () => {
      const { service, create } = makeService();
      create.mockImplementation(async () => claudeReply(`call-${create.mock.calls.length}`));

      await service.analyzeCostIncrease(ORG_A, INPUT);
      await service.analyzeCostDecrease(ORG_A, INPUT);
      await service.analyzeCostTrend(ORG_A, INPUT);

      expect(create).toHaveBeenCalledTimes(3);
    });

    it('still hits on sub-display-precision noise, as before', async () => {
      const { service, create } = makeService();
      create.mockResolvedValueOnce(claudeReply('org-a'));

      await service.analyzeCostIncrease(ORG_A, INPUT);
      const again = await service.analyzeCostIncrease(ORG_A, { ...INPUT, currentCost: 1250.001, percentageIncrease: 25.01 });

      expect(create).toHaveBeenCalledTimes(1);
      expect(again.cached).toBe(true);
    });

    it('expires entries after the 1-hour TTL', async () => {
      const { service, create } = makeService();
      create.mockImplementation(async () => claudeReply(`call-${create.mock.calls.length}`));

      await service.analyzeCostIncrease(ORG_A, INPUT);
      jest.advanceTimersByTime(60 * 60 * 1000 + 1);
      const afterTtl = await service.analyzeCostIncrease(ORG_A, INPUT);

      expect(create).toHaveBeenCalledTimes(2);
      expect(afterTtl.cached).toBeUndefined();
    });

    it('does not cache fallback responses on API error (unchanged)', async () => {
      const { service, create } = makeService();
      jest.spyOn(console, 'error').mockImplementation(() => {});
      create.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(claudeReply('org-a'));

      await service.analyzeCostIncrease(ORG_A, INPUT);
      expect(service.getCacheStats(ORG_A).size).toBe(0);
      const retry = await service.analyzeCostIncrease(ORG_A, INPUT);
      expect(retry.rootCause).toBe('org-a root cause');
    });
  });
});

describe('AIInsightsController — cache endpoints use the authenticated org only', () => {
  function mockRes() {
    const res: any = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res as Response & { status: jest.Mock; json: jest.Mock };
  }

  function mockReq(organizationId: string | undefined, extra: Record<string, unknown> = {}): Request {
    return { user: organizationId ? { organizationId } : undefined, body: {}, query: {}, ...extra } as any;
  }

  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("POST /clear-cache clears only the caller's org, ignoring a client-supplied organizationId", async () => {
    const { service, create } = makeService();
    create.mockResolvedValueOnce(claudeReply('org-a')).mockResolvedValueOnce(claudeReply('org-b'));
    await service.analyzeCostIncrease(ORG_A, INPUT);
    await service.analyzeCostIncrease(ORG_B, INPUT);

    const controller = new AIInsightsController(service);
    const res = mockRes();
    await controller.clearCache(
      mockReq(ORG_A, { body: { organizationId: ORG_B }, query: { organizationId: ORG_B } }),
      res
    );

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    expect(service.getCacheStats(ORG_A).size).toBe(0);
    expect(service.getCacheStats(ORG_B).size).toBe(1);
  });

  it("GET /cache-stats reports only the caller's org entries", async () => {
    const { service, create } = makeService();
    create.mockImplementation(async () => claudeReply('x'));
    await service.analyzeCostIncrease(ORG_A, INPUT);
    await service.analyzeCostIncrease(ORG_B, INPUT);
    await service.analyzeCostTrend(ORG_B, INPUT);

    const controller = new AIInsightsController(service);
    const res = mockRes();
    await controller.getCacheStats(mockReq(ORG_A), res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ cacheSize: 1, cachedKeys: 1 }) })
    );
  });

  it('POST /analyze-cost passes the authenticated org to the service, not a body-supplied one', async () => {
    const { service } = makeService();
    const spy = jest.spyOn(service, 'analyzeCostIncrease').mockResolvedValue({
      rootCause: 'r', recommendation: 'r', estimatedSavings: null, confidence: 'low', rawResponse: '',
    });

    const controller = new AIInsightsController(service);
    const res = mockRes();
    await controller.analyzeCost(mockReq(ORG_A, { body: { ...INPUT, organizationId: ORG_B } }), res);

    expect(spy).toHaveBeenCalledWith(ORG_A, expect.not.objectContaining({ organizationId: expect.anything() }));
  });

  it.each(['analyzeCost', 'getCacheStats', 'clearCache'] as const)(
    '%s returns 401 and touches no cache when the request has no authenticated org',
    async (handler) => {
      const { service, create } = makeService();
      create.mockResolvedValueOnce(claudeReply('org-a'));
      await service.analyzeCostIncrease(ORG_A, INPUT);
      const clearSpy = jest.spyOn(service, 'clearCache');
      const statsSpy = jest.spyOn(service, 'getCacheStats');

      const controller = new AIInsightsController(service);
      const res = mockRes();
      await controller[handler](mockReq(undefined, { body: { ...INPUT, organizationId: ORG_A } }), res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(clearSpy).not.toHaveBeenCalled();
      expect(statsSpy).not.toHaveBeenCalled();
      expect(create).toHaveBeenCalledTimes(1);
      expect(service.getCacheStats(ORG_A).size).toBe(1);
    }
  );
});
