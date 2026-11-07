/**
 * GET /api/cost-recommendations/optimization-rules -- unlike the rest of
 * this controller, this endpoint reads only the static
 * config/optimization-rules.ts registry, never the database, so this test
 * exercises the real controller method directly against mocked req/res with
 * no Postgres connection (contrast with cost-analysis-runs.test.ts, which
 * needs a live DB because it tests actual persistence).
 */
import { Request, Response } from 'express';
import { CostRecommendationsController } from '../cost-recommendations.controller';
import { getOptimizationRuleSummary } from '../../config/optimization-rules';

function mockReqRes() {
  const req = { user: { organizationId: 'org-1', userId: 'user-1' }, query: {}, params: {}, body: {} } as unknown as Request;
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { json, status } as unknown as Response;
  return { req, res, json, status };
}

describe('CostRecommendationsController.getOptimizationRules', () => {
  const controller = new CostRecommendationsController();

  it('returns the full rule catalog and a matching summary', async () => {
    const { req, res, json } = mockReqRes();

    await controller.getOptimizationRules(req, res);

    expect(json).toHaveBeenCalledTimes(1);
    const payload = json.mock.calls[0][0];
    expect(payload.success).toBe(true);
    expect(Array.isArray(payload.data.rules)).toBe(true);
    expect(payload.data.rules.length).toBeGreaterThan(0);
    expect(payload.data.summary).toEqual(getOptimizationRuleSummary());
  });

  it('distinguishes implemented from planned rules in the response', async () => {
    const { req, res, json } = mockReqRes();

    await controller.getOptimizationRules(req, res);

    const payload = json.mock.calls[0][0];
    const statuses = new Set(payload.data.rules.map((r: any) => r.status));
    expect(statuses.has('implemented')).toBe(true);
    expect(statuses.has('planned')).toBe(true);

    const implemented = payload.data.rules.filter((r: any) => r.status === 'implemented');
    for (const rule of implemented) {
      expect(typeof rule.issue).toBe('string');
      expect(rule.issue.length).toBeGreaterThan(0);
    }
    const planned = payload.data.rules.filter((r: any) => r.status === 'planned');
    for (const rule of planned) {
      expect(rule.issue).toBeUndefined();
    }
  });

  it('never claims all rules are implemented (no fabricated coverage)', async () => {
    const { req, res, json } = mockReqRes();

    await controller.getOptimizationRules(req, res);

    const { summary } = json.mock.calls[0][0].data;
    expect(summary.implementedCount).toBeLessThan(summary.totalRules);
    expect(summary.plannedCount).toBeGreaterThan(0);
  });

  it('does not require organizationId -- the registry is static, not org-scoped data', async () => {
    const req = { user: {}, query: {}, params: {}, body: {} } as unknown as Request;
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const res = { json, status } as unknown as Response;

    await controller.getOptimizationRules(req, res);

    expect(status).not.toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledTimes(1);
    expect(json.mock.calls[0][0].success).toBe(true);
  });

  // Enterprise Workstream 3B, Phase E
  // FP PR 2b: ec2_idle (now the low-activity rule, fixed thresholds) is no longer configurable.
  it('marks lambda_low_usage as configurable, with its parameter definition, and ec2_idle as fixed -- never an organization-specific value', async () => {
    const { req, res, json } = mockReqRes();

    await controller.getOptimizationRules(req, res);

    const { rules } = json.mock.calls[0][0].data;
    const ec2Idle = rules.find((r: any) => r.id === 'ec2_idle');
    const lambdaLowUsage = rules.find((r: any) => r.id === 'lambda_low_usage');

    expect(ec2Idle.configurable).toBe(false);
    expect(ec2Idle.parameters).toEqual([]);
    expect(ec2Idle.name).toBe('Low-activity EC2 instances');
    expect(ec2Idle.detail).toBe('CPU below 10% and network below 5 MB every day for 30 days, and not behind a load balancer or in an Auto Scaling group');
    expect(lambdaLowUsage.configurable).toBe(true);
    expect(lambdaLowUsage.parameters).toEqual([
      { parameterId: 'max_invocations', type: 'integer', default: 10, min: 0, max: 1000, unit: 'invocations_per_30d' },
    ]);

    // Neither parameter definition object carries a `value` or `source` key --
    // those are organization-specific and belong only to
    // GET /optimization-rules/configuration (Enterprise-gated), never here.
    expect(lambdaLowUsage.parameters[0]).not.toHaveProperty('value');
    expect(lambdaLowUsage.parameters[0]).not.toHaveProperty('source');
  });

  it('marks every non-configurable rule with configurable: false and an empty parameters array', async () => {
    const { req, res, json } = mockReqRes();

    await controller.getOptimizationRules(req, res);

    const { rules } = json.mock.calls[0][0].data;
    const nonConfigurable = rules.filter((r: any) => r.id !== 'lambda_low_usage');
    expect(nonConfigurable.length).toBeGreaterThan(0);
    for (const rule of nonConfigurable) {
      expect(rule.configurable).toBe(false);
      expect(rule.parameters).toEqual([]);
    }
  });
});
