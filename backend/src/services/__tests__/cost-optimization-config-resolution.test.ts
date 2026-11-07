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
 * is covered by cost-optimization-low-activity.test.ts and
 * cost-optimization-lambda.test.ts.
 *
 * FP PR 2b: the low-activity EC2 rule replaced the configurable CPU-average
 * check; only lambda_low_usage is resolved now.
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

const DEFAULT_LAMBDA_CONFIG = { ruleId: 'lambda_low_usage', parameterId: 'max_invocations', value: 10, source: 'default' as const };

describe('CostOptimizationService.analyzeAllResources — configuration resolution wiring', () => {
  beforeEach(() => {
    jest.spyOn(AWSClientFactory, 'createClients').mockResolvedValue(mockClients() as any);
    // Neutralize every non-configurable detector -- their own behavior is
    // covered by their dedicated test files, not this one.
    jest.spyOn(costOptimizationService as any, 'detectUnusedElasticIPs').mockResolvedValue({ success: true, issues: [] });
    jest.spyOn(costOptimizationService as any, 'detectUnattachedEBSVolumes').mockResolvedValue({ success: true, issues: [] });
    jest.spyOn(costOptimizationService as any, 'detectGp2ToGp3Migrations').mockResolvedValue({ success: true, issues: [] });
    jest.spyOn(costOptimizationService as any, 'detectS3LifecycleOptimization').mockResolvedValue({ success: true, issues: [] });
    jest.spyOn(costOptimizationService as any, 'detectDynamoDBCapacityOptimization').mockResolvedValue({ success: true, issues: [] });
    jest.spyOn(costOptimizationService as any, 'detectDynamoDBOnDemandVsProvisionedOptimization').mockResolvedValue({ success: true, issues: [] });
    jest.spyOn(costOptimizationService as any, 'detectReservedInstanceOpportunities').mockResolvedValue({ success: true, issues: [] });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // FP PR 2b: the low-activity EC2 rule has fixed thresholds (config/low-activity-rule.ts).
  // ec2_idle/cpu_threshold_percent is no longer resolved, and its detector runs whatever
  // the Lambda configuration does.
  it('(1) resolves the Lambda rule exactly once per scan, keyed by organizationId, and never ec2_idle', async () => {
    const resolveSpy = jest
      .spyOn(OptimizationRuleConfigService.prototype, 'resolveEffectiveConfig')
      .mockResolvedValue(DEFAULT_LAMBDA_CONFIG);
    jest.spyOn(costOptimizationService as any, 'detectLowActivityEC2Instances').mockResolvedValue({ success: true, issues: [] });
    jest.spyOn(costOptimizationService as any, 'detectLowUsageLambdaFunctions').mockResolvedValue({ success: true, issues: [] });

    await costOptimizationService.analyzeAllResources('org-1');

    expect(resolveSpy).toHaveBeenCalledTimes(1);
    expect(resolveSpy).toHaveBeenCalledWith('org-1', 'lambda_low_usage', 'max_invocations');
    expect(resolveSpy).not.toHaveBeenCalledWith('org-1', 'ec2_idle', expect.anything());
  });

  it('(2) runs the low-activity detector with the scan\'s own clients and home region', async () => {
    jest.spyOn(OptimizationRuleConfigService.prototype, 'resolveEffectiveConfig').mockResolvedValue(DEFAULT_LAMBDA_CONFIG);
    const ec2DetectorSpy = jest.spyOn(costOptimizationService as any, 'detectLowActivityEC2Instances').mockResolvedValue({ success: true, issues: [] });
    jest.spyOn(costOptimizationService as any, 'detectLowUsageLambdaFunctions').mockResolvedValue({ success: true, issues: [] });

    await costOptimizationService.analyzeAllResources('org-2');

    expect(ec2DetectorSpy).toHaveBeenCalledTimes(1);
    const [clients, region] = ec2DetectorSpy.mock.calls[0] as [any, string];
    expect(region).toBe('us-east-1');
    expect(clients.region).toBe('us-east-1');
    expect(clients.enabled).toBe(true);
  });

  it('(3) passes the resolved Lambda config object directly into detectLowUsageLambdaFunctions', async () => {
    const resolvedConfig = { ruleId: 'lambda_low_usage', parameterId: 'max_invocations', value: 250, source: 'organization_override' as const };
    jest.spyOn(OptimizationRuleConfigService.prototype, 'resolveEffectiveConfig').mockResolvedValue(resolvedConfig);
    jest.spyOn(costOptimizationService as any, 'detectLowActivityEC2Instances').mockResolvedValue({ success: true, issues: [] });
    const lambdaDetectorSpy = jest.spyOn(costOptimizationService as any, 'detectLowUsageLambdaFunctions').mockResolvedValue({ success: true, issues: [] });

    await costOptimizationService.analyzeAllResources('org-3');

    // The last argument is the clients' connection identity (AWS connect PR B): none for these fake clients.
    expect(lambdaDetectorSpy).toHaveBeenCalledWith('org-3', expect.anything(), expect.anything(), resolvedConfig, 'us-east-1', null);
  });

  it('(4) the Idle observation carries the low-activity detector\'s result, its counts and the unknown-row rule (FP2b-Q12, Q21)', async () => {
    jest.spyOn(OptimizationRuleConfigService.prototype, 'resolveEffectiveConfig').mockResolvedValue(DEFAULT_LAMBDA_CONFIG);
    const lowActivity = { evaluated: 2, low_activity: 0, not_low_activity: { cpu_peak: 1, network: 0, load_balancer: 0, auto_scaling: 0 }, couldnt_check: { too_new_or_restarted: 1, cloudwatch_failed: 0, cloudwatch_incomplete: 0, topology_unreadable: 0 } };
    jest.spyOn(costOptimizationService as any, 'detectLowActivityEC2Instances').mockResolvedValue({
      success: true, issues: [], unknownResourceIds: ['i-1234567890abcdef0'], endActiveForUnknown: true, lowActivity,
    });
    jest.spyOn(costOptimizationService as any, 'detectLowUsageLambdaFunctions').mockResolvedValue({ success: true, issues: [] });

    const result = await costOptimizationService.analyzeAllResources('org-4');

    expect(result.observations.find((o) => o.issue === ISSUE_EC2_IDLE_INSTANCE)).toEqual({
      issue: ISSUE_EC2_IDLE_INSTANCE, success: true, recommendations: [], unknownResourceIds: ['i-1234567890abcdef0'], endActiveForUnknown: true, lowActivity,
    });
  });

  it('(5) a configuration-resolution failure for Lambda fails only that category, EC2 is unaffected', async () => {
    jest.spyOn(OptimizationRuleConfigService.prototype, 'resolveEffectiveConfig').mockRejectedValue(new Error('connection terminated unexpectedly'));
    const ec2DetectorSpy = jest.spyOn(costOptimizationService as any, 'detectLowActivityEC2Instances').mockResolvedValue({ success: true, issues: [] });
    const lambdaDetectorSpy = jest.spyOn(costOptimizationService as any, 'detectLowUsageLambdaFunctions');

    const result = await costOptimizationService.analyzeAllResources('org-5');

    expect(lambdaDetectorSpy).not.toHaveBeenCalled();
    expect(ec2DetectorSpy).toHaveBeenCalledTimes(1);
    const lambdaObservation = result.observations.find((o) => o.issue === ISSUE_LAMBDA_LOW_USAGE);
    expect(lambdaObservation).toEqual({ issue: ISSUE_LAMBDA_LOW_USAGE, success: false, recommendations: [] });

    const ec2Observation = result.observations.find((o) => o.issue === ISSUE_EC2_IDLE_INSTANCE);
    expect(ec2Observation?.success).toBe(true);
  });

  it('(6) a Lambda resolution failure never surfaces as a customer-visible "default" -- the Lambda detector does not run', async () => {
    jest.spyOn(OptimizationRuleConfigService.prototype, 'resolveEffectiveConfig').mockRejectedValue(new Error('ECONNREFUSED'));
    jest.spyOn(costOptimizationService as any, 'detectLowActivityEC2Instances').mockResolvedValue({ success: true, issues: [] });
    const lambdaDetectorSpy = jest.spyOn(costOptimizationService as any, 'detectLowUsageLambdaFunctions');

    const result = await costOptimizationService.analyzeAllResources('org-6');

    expect(lambdaDetectorSpy).not.toHaveBeenCalled();
    expect(result.observations.find((o) => o.issue === ISSUE_LAMBDA_LOW_USAGE)).toEqual({ issue: ISSUE_LAMBDA_LOW_USAGE, success: false, recommendations: [] });
  });

  it('(7) other detector categories are entirely unaffected by a configuration-resolution failure', async () => {
    jest.spyOn(OptimizationRuleConfigService.prototype, 'resolveEffectiveConfig').mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await costOptimizationService.analyzeAllResources('org-7');

    expect(result.observations.filter((o) => o.success === true).length).toBeGreaterThanOrEqual(7); // the 7 neutralized non-configurable categories
    expect(result.riRecommendations).toEqual([]);
  });
});
