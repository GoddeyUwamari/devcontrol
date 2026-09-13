/**
 * Enterprise Workstream 3B, Phase E: coverage for
 * CostRecommendationsController's three new Enterprise Optimization Controls
 * endpoints (getOptimizationRulesConfiguration, updateOptimizationRuleConfiguration,
 * resetOptimizationRuleConfiguration).
 *
 * OptimizationRuleConfigService's own persistence/resolution correctness is
 * already proven against real Postgres in optimization-rule-config.service.test.ts
 * (Phase C) -- this file spies on its prototype methods instead of hitting a
 * real database again, matching this controller's own established convention
 * (cost-analysis-runs.test.ts spies on costOptimizationService.analyzeAllResources
 * rather than re-testing AWS behavior at the controller layer). What this file
 * actually proves: organizationId is always sourced from the authenticated
 * request context (never the URL or body), response shapes are correct,
 * validation errors map to 400 while unexpected errors map to 500, and an
 * unsupported rule/parameter combination is rejected before any deletion.
 *
 * Enterprise-only route authorization (authenticateToken + requireEnterprise)
 * is enforced in cost-recommendations.routes.ts, not in these controller
 * methods themselves -- requireEnterprise's own correctness against real
 * organization tiers is already proven generically (see
 * slo-enterprise-gating.middleware.test.ts), and this controller's one other
 * pre-existing Enterprise-gated action (executeRemediation) has no dedicated
 * per-route gating test either; this file follows that same established
 * boundary rather than re-proving shared middleware.
 */
import { Request, Response } from 'express';
import { CostRecommendationsController } from '../cost-recommendations.controller';
import { OptimizationRuleConfigService, OptimizationRuleConfigValidationError } from '../../services/optimization-rule-config.service';

function mockReqRes(overrides: { user?: any; params?: any; body?: any } = {}) {
  const req = {
    user: overrides.user ?? { organizationId: 'org-1', userId: 'user-1' },
    query: {},
    params: overrides.params ?? {},
    body: overrides.body ?? {},
  } as unknown as Request;
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { json, status } as unknown as Response;
  return { req, res, json, status };
}

describe('CostRecommendationsController.getOptimizationRulesConfiguration', () => {
  const controller = new CostRecommendationsController();

  afterEach(() => jest.restoreAllMocks());

  it('(1) returns 401 when the request has no authenticated organizationId', async () => {
    const { req, res, status, json } = mockReqRes({ user: {} });

    await controller.getOptimizationRulesConfiguration(req, res);

    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });

  it('(2) resolves and returns the effective configuration for every configurable rule, scoped to the authenticated organization', async () => {
    const resolveSpy = jest.spyOn(OptimizationRuleConfigService.prototype, 'resolveEffectiveConfig').mockImplementation(async (_org, ruleId, parameterId) =>
      ruleId === 'ec2_idle'
        ? { ruleId, parameterId, value: 5, source: 'default' }
        : { ruleId, parameterId, value: 10, source: 'default' }
    );
    const { req, res, json } = mockReqRes({ user: { organizationId: 'org-42' } });

    await controller.getOptimizationRulesConfiguration(req, res);

    expect(resolveSpy).toHaveBeenCalledWith('org-42', 'ec2_idle', 'cpu_threshold_percent');
    expect(resolveSpy).toHaveBeenCalledWith('org-42', 'lambda_low_usage', 'max_invocations');

    const { data } = json.mock.calls[0][0];
    const ec2Entry = data.find((d: any) => d.ruleId === 'ec2_idle');
    expect(ec2Entry).toEqual({
      ruleId: 'ec2_idle',
      parameterId: 'cpu_threshold_percent',
      value: 5,
      source: 'default',
      default: 5,
      min: 1,
      max: 20,
      unit: 'percent',
      type: 'number',
    });
  });

  it('(3) reflects an organization_override source and value when one is in effect', async () => {
    jest.spyOn(OptimizationRuleConfigService.prototype, 'resolveEffectiveConfig').mockImplementation(async (_org, ruleId, parameterId) =>
      ruleId === 'ec2_idle'
        ? { ruleId, parameterId, value: 15, source: 'organization_override' }
        : { ruleId, parameterId, value: 10, source: 'default' }
    );
    const { req, res, json } = mockReqRes();

    await controller.getOptimizationRulesConfiguration(req, res);

    const { data } = json.mock.calls[0][0];
    const ec2Entry = data.find((d: any) => d.ruleId === 'ec2_idle');
    expect(ec2Entry.value).toBe(15);
    expect(ec2Entry.source).toBe('organization_override');
  });

  it('(4) a resolver failure returns 500, not a fabricated default', async () => {
    jest.spyOn(OptimizationRuleConfigService.prototype, 'resolveEffectiveConfig').mockRejectedValue(new Error('ECONNREFUSED'));
    const { req, res, status } = mockReqRes();

    await controller.getOptimizationRulesConfiguration(req, res);

    expect(status).toHaveBeenCalledWith(500);
  });
});

describe('CostRecommendationsController.updateOptimizationRuleConfiguration', () => {
  const controller = new CostRecommendationsController();

  afterEach(() => jest.restoreAllMocks());

  it('(5) returns 401 when the request has no authenticated organizationId', async () => {
    const { req, res, status } = mockReqRes({ user: {}, params: { ruleId: 'ec2_idle', parameterId: 'cpu_threshold_percent' }, body: { value: 10 } });

    await controller.updateOptimizationRuleConfiguration(req, res);

    expect(status).toHaveBeenCalledWith(401);
  });

  it('(6) upserts using the authenticated organizationId, never one from params/body, and returns the override with source "organization_override"', async () => {
    const upsertSpy = jest
      .spyOn(OptimizationRuleConfigService.prototype, 'upsertOverride')
      .mockResolvedValue({ id: 'row-1', organizationId: 'org-7', ruleId: 'ec2_idle', parameterId: 'cpu_threshold_percent', value: 12, createdAt: new Date(), updatedAt: new Date() });
    const { req, res, json } = mockReqRes({
      user: { organizationId: 'org-7' },
      params: { ruleId: 'ec2_idle', parameterId: 'cpu_threshold_percent' },
      body: { value: 12, organizationId: 'attacker-controlled-org' }, // must be ignored
    });

    await controller.updateOptimizationRuleConfiguration(req, res);

    expect(upsertSpy).toHaveBeenCalledWith('org-7', 'ec2_idle', 'cpu_threshold_percent', 12);
    const payload = json.mock.calls[0][0];
    expect(payload.success).toBe(true);
    expect(payload.data).toEqual({ ruleId: 'ec2_idle', parameterId: 'cpu_threshold_percent', value: 12, source: 'organization_override' });
  });

  it('(7) coerces a string-encoded numeric value from the request body', async () => {
    const upsertSpy = jest
      .spyOn(OptimizationRuleConfigService.prototype, 'upsertOverride')
      .mockResolvedValue({ id: 'row-2', organizationId: 'org-1', ruleId: 'lambda_low_usage', parameterId: 'max_invocations', value: 50, createdAt: new Date(), updatedAt: new Date() });
    const { req, res } = mockReqRes({ params: { ruleId: 'lambda_low_usage', parameterId: 'max_invocations' }, body: { value: '50' } });

    await controller.updateOptimizationRuleConfiguration(req, res);

    expect(upsertSpy).toHaveBeenCalledWith('org-1', 'lambda_low_usage', 'max_invocations', 50);
  });

  it('(8) a validation error from the service maps to 400, not 500', async () => {
    jest.spyOn(OptimizationRuleConfigService.prototype, 'upsertOverride').mockRejectedValue(new OptimizationRuleConfigValidationError('cpu_threshold_percent must be between 1 and 20'));
    const { req, res, status, json } = mockReqRes({ params: { ruleId: 'ec2_idle', parameterId: 'cpu_threshold_percent' }, body: { value: 999 } });

    await controller.updateOptimizationRuleConfiguration(req, res);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: false, error: expect.stringContaining('between 1 and 20') }));
  });

  it('(9) an unexpected (non-validation) error maps to 500', async () => {
    jest.spyOn(OptimizationRuleConfigService.prototype, 'upsertOverride').mockRejectedValue(new Error('ECONNREFUSED'));
    const { req, res, status } = mockReqRes({ params: { ruleId: 'ec2_idle', parameterId: 'cpu_threshold_percent' }, body: { value: 10 } });

    await controller.updateOptimizationRuleConfiguration(req, res);

    expect(status).toHaveBeenCalledWith(500);
  });
});

describe('CostRecommendationsController.resetOptimizationRuleConfiguration', () => {
  const controller = new CostRecommendationsController();

  afterEach(() => jest.restoreAllMocks());

  it('(10) returns 401 when the request has no authenticated organizationId', async () => {
    const { req, res, status } = mockReqRes({ user: {}, params: { ruleId: 'ec2_idle', parameterId: 'cpu_threshold_percent' } });

    await controller.resetOptimizationRuleConfiguration(req, res);

    expect(status).toHaveBeenCalledWith(401);
  });

  it('(11) deletes the override using the authenticated organizationId', async () => {
    const deleteSpy = jest.spyOn(OptimizationRuleConfigService.prototype, 'deleteOverride').mockResolvedValue(undefined);
    const { req, res, json } = mockReqRes({ user: { organizationId: 'org-9' }, params: { ruleId: 'lambda_low_usage', parameterId: 'max_invocations' } });

    await controller.resetOptimizationRuleConfiguration(req, res);

    expect(deleteSpy).toHaveBeenCalledWith('org-9', 'lambda_low_usage', 'max_invocations');
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('(12) rejects an unsupported rule/parameter combination with 400 before ever calling deleteOverride', async () => {
    const deleteSpy = jest.spyOn(OptimizationRuleConfigService.prototype, 'deleteOverride');
    const { req, res, status } = mockReqRes({ params: { ruleId: 'rds_idle', parameterId: 'cpu_threshold_percent' } });

    await controller.resetOptimizationRuleConfiguration(req, res);

    expect(status).toHaveBeenCalledWith(400);
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it('(13) a reset on an already-default parameter still returns success (idempotent no-op)', async () => {
    jest.spyOn(OptimizationRuleConfigService.prototype, 'deleteOverride').mockResolvedValue(undefined);
    const { req, res, json, status } = mockReqRes({ params: { ruleId: 'ec2_idle', parameterId: 'cpu_threshold_percent' } });

    await controller.resetOptimizationRuleConfiguration(req, res);

    expect(status).not.toHaveBeenCalledWith(400);
    expect(status).not.toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });
});
