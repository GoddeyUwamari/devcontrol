/**
 * Enterprise Workstream 3B, Phase D: coverage for analyzeAllResources()'s
 * configuration-resolution orchestration -- the properties under test are:
 *
 *   - both configurable rules are resolved exactly ONCE per scan, before any
 *     detector runs, never per-resource;
 *   - the resolved EffectiveOptimizationRuleConfig object is passed directly
 *     into the corresponding detector, not re-derived inside it;
 *   - a configuration-resolution failure (e.g. a database error) fails only
 *     that rule's category via the existing DetectorResult.success:false
 *     convention, without ever invoking that detector, and without
 *     affecting the other configurable rule or any of the other 8 detectors;
 *   - a resolution failure never silently surfaces as if the registry
 *     default were confirmed and applied -- the detector simply never runs
 *     for that category in that scan.
 *
 * Every non-configurable detector is neutralized via spies so this suite is
 * purely about the orchestration wiring, not AWS behavior -- that behavior
 * is already covered by cost-optimization-ec2-idle.test.ts and
 * cost-optimization-lambda.test.ts.
 */
import costOptimizationService from '../cost-optimization.service';
import { AWSClientFactory } from '../aws-client-factory.service';
import { OptimizationRuleConfigService } from '../optimization-rule-config.service';
import { ISSUE_EC2_IDLE_INSTANCE, ISSUE_LAMBDA_LOW_USAGE } from '../../config/optimization-rules';

function mockClients() {
  return {
    enabled: true,
    ec2: {} as any,
    rds: {} as any,
    s3: {} as any,
    lambda: {} as any,
    cloudWatch: {} as any,
    region: 'us-east-1',
  };
}

const DEFAULT_EC2_CONFIG = { ruleId: 'ec2_idle', parameterId: 'cpu_threshold_percent', value: 5, source: 'default' as const };
const DEFAULT_LAMBDA_CONFIG = { ruleId: 'lambda_low_usage', parameterId: 'max_invocations', value: 10, source: 'default' as const };

describe('CostOptimizationService.analyzeAllResources — configuration resolution wiring', () => {
  beforeEach(() => {
    jest.spyOn(AWSClientFactory, 'createClients').mockResolvedValue(mockClients() as any);
    // Neutralize every non-configurable detector -- their own behavior is
    // covered by their dedicated test files, not this one.
    jest.spyOn(costOptimizationService as any, 'detectOversizedRDSInstances').mockResolvedValue({ success: true, issues: [] });
    jest.spyOn(costOptimizationService as any, 'detectUnusedElasticIPs').mockResolvedValue({ success: true, issues: [] });
    jest.spyOn(costOptimizationService as any, 'detectUnattachedEBSVolumes').mockResolvedValue({ success: true, issues: [] });
    jest.spyOn(costOptimizationService as any, 'detectGp2ToGp3Migrations').mockResolvedValue({ success: true, issues: [] });
    jest.spyOn(costOptimizationService as any, 'detectS3LifecycleOptimization').mockResolvedValue({ success: true, issues: [] });
    jest.spyOn(costOptimizationService as any, 'detectDynamoDBCapacityOptimization').mockResolvedValue({ success: true, issues: [] });
    jest.spyOn(costOptimizationService as any, 'detectDynamoDBOnDemandVsProvisionedOptimization').mockResolvedValue({ success: true, issues: [] });
    jest.spyOn(costOptimizationService as any, 'detectReservedInstanceOpportunities').mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('(1) resolves both configurable rules exactly once per scan, keyed by organizationId -- never per resource', async () => {
    const resolveSpy = jest
      .spyOn(OptimizationRuleConfigService.prototype, 'resolveEffectiveConfig')
      .mockResolvedValueOnce(DEFAULT_EC2_CONFIG)
      .mockResolvedValueOnce(DEFAULT_LAMBDA_CONFIG);
    jest.spyOn(costOptimizationService as any, 'detectIdleEC2Instances').mockResolvedValue({ success: true, issues: [] });
    jest.spyOn(costOptimizationService as any, 'detectLowUsageLambdaFunctions').mockResolvedValue({ success: true, issues: [] });

    await costOptimizationService.analyzeAllResources('org-1');

    expect(resolveSpy).toHaveBeenCalledTimes(2);
    expect(resolveSpy).toHaveBeenCalledWith('org-1', 'ec2_idle', 'cpu_threshold_percent');
    expect(resolveSpy).toHaveBeenCalledWith('org-1', 'lambda_low_usage', 'max_invocations');
  });

  it('(2) passes the resolved EC2 config object directly into detectIdleEC2Instances', async () => {
    const resolvedConfig = { ruleId: 'ec2_idle', parameterId: 'cpu_threshold_percent', value: 12, source: 'organization_override' as const };
    jest
      .spyOn(OptimizationRuleConfigService.prototype, 'resolveEffectiveConfig')
      .mockImplementation(async (_org, ruleId) => (ruleId === 'ec2_idle' ? resolvedConfig : DEFAULT_LAMBDA_CONFIG));
    const ec2DetectorSpy = jest.spyOn(costOptimizationService as any, 'detectIdleEC2Instances').mockResolvedValue({ success: true, issues: [] });
    jest.spyOn(costOptimizationService as any, 'detectLowUsageLambdaFunctions').mockResolvedValue({ success: true, issues: [] });

    await costOptimizationService.analyzeAllResources('org-2');

    expect(ec2DetectorSpy).toHaveBeenCalledWith(expect.anything(), expect.anything(), resolvedConfig);
  });

  it('(3) passes the resolved Lambda config object directly into detectLowUsageLambdaFunctions', async () => {
    const resolvedConfig = { ruleId: 'lambda_low_usage', parameterId: 'max_invocations', value: 250, source: 'organization_override' as const };
    jest
      .spyOn(OptimizationRuleConfigService.prototype, 'resolveEffectiveConfig')
      .mockImplementation(async (_org, ruleId) => (ruleId === 'lambda_low_usage' ? resolvedConfig : DEFAULT_EC2_CONFIG));
    jest.spyOn(costOptimizationService as any, 'detectIdleEC2Instances').mockResolvedValue({ success: true, issues: [] });
    const lambdaDetectorSpy = jest.spyOn(costOptimizationService as any, 'detectLowUsageLambdaFunctions').mockResolvedValue({ success: true, issues: [] });

    await costOptimizationService.analyzeAllResources('org-3');

    expect(lambdaDetectorSpy).toHaveBeenCalledWith('org-3', expect.anything(), expect.anything(), resolvedConfig);
  });

  it('(4) a configuration-resolution failure for EC2 fails only that category (success:false), and the detector is never invoked with a guessed default', async () => {
    jest.spyOn(OptimizationRuleConfigService.prototype, 'resolveEffectiveConfig').mockImplementation(async (_org, ruleId) => {
      if (ruleId === 'ec2_idle') throw new Error('connection terminated unexpectedly');
      return DEFAULT_LAMBDA_CONFIG;
    });
    const ec2DetectorSpy = jest.spyOn(costOptimizationService as any, 'detectIdleEC2Instances');
    jest.spyOn(costOptimizationService as any, 'detectLowUsageLambdaFunctions').mockResolvedValue({ success: true, issues: [] });

    const result = await costOptimizationService.analyzeAllResources('org-4');

    expect(ec2DetectorSpy).not.toHaveBeenCalled();
    const ec2Observation = result.observations.find((o) => o.issue === ISSUE_EC2_IDLE_INSTANCE);
    expect(ec2Observation).toEqual({ issue: ISSUE_EC2_IDLE_INSTANCE, success: false, recommendations: [] });

    const lambdaObservation = result.observations.find((o) => o.issue === ISSUE_LAMBDA_LOW_USAGE);
    expect(lambdaObservation?.success).toBe(true);
  });

  it('(5) a configuration-resolution failure for Lambda fails only that category, EC2 is unaffected', async () => {
    jest.spyOn(OptimizationRuleConfigService.prototype, 'resolveEffectiveConfig').mockImplementation(async (_org, ruleId) => {
      if (ruleId === 'lambda_low_usage') throw new Error('connection terminated unexpectedly');
      return DEFAULT_EC2_CONFIG;
    });
    jest.spyOn(costOptimizationService as any, 'detectIdleEC2Instances').mockResolvedValue({ success: true, issues: [] });
    const lambdaDetectorSpy = jest.spyOn(costOptimizationService as any, 'detectLowUsageLambdaFunctions');

    const result = await costOptimizationService.analyzeAllResources('org-5');

    expect(lambdaDetectorSpy).not.toHaveBeenCalled();
    const lambdaObservation = result.observations.find((o) => o.issue === ISSUE_LAMBDA_LOW_USAGE);
    expect(lambdaObservation).toEqual({ issue: ISSUE_LAMBDA_LOW_USAGE, success: false, recommendations: [] });

    const ec2Observation = result.observations.find((o) => o.issue === ISSUE_EC2_IDLE_INSTANCE);
    expect(ec2Observation?.success).toBe(true);
  });

  it('(6) both rules failing to resolve never surfaces as a customer-visible "default" -- neither detector runs, both categories fail', async () => {
    jest.spyOn(OptimizationRuleConfigService.prototype, 'resolveEffectiveConfig').mockRejectedValue(new Error('ECONNREFUSED'));
    const ec2DetectorSpy = jest.spyOn(costOptimizationService as any, 'detectIdleEC2Instances');
    const lambdaDetectorSpy = jest.spyOn(costOptimizationService as any, 'detectLowUsageLambdaFunctions');

    const result = await costOptimizationService.analyzeAllResources('org-6');

    expect(ec2DetectorSpy).not.toHaveBeenCalled();
    expect(lambdaDetectorSpy).not.toHaveBeenCalled();
    expect(result.observations.find((o) => o.issue === ISSUE_EC2_IDLE_INSTANCE)).toEqual({ issue: ISSUE_EC2_IDLE_INSTANCE, success: false, recommendations: [] });
    expect(result.observations.find((o) => o.issue === ISSUE_LAMBDA_LOW_USAGE)).toEqual({ issue: ISSUE_LAMBDA_LOW_USAGE, success: false, recommendations: [] });
  });

  it('(7) other detector categories are entirely unaffected by a configuration-resolution failure', async () => {
    jest.spyOn(OptimizationRuleConfigService.prototype, 'resolveEffectiveConfig').mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await costOptimizationService.analyzeAllResources('org-7');

    expect(result.observations.filter((o) => o.success === true).length).toBeGreaterThanOrEqual(7); // the 7 neutralized non-configurable categories
    expect(result.riRecommendations).toEqual([]);
  });
});
