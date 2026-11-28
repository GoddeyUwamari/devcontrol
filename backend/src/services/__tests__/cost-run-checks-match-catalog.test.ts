/**
 * Cost Intelligence PR B, safeguard 3 (review-logs/cost-intelligence/stage-a.md, Addendum 1; Stage A risk R5):
 * the Costs page's "Cost checks" tile shows GET /optimization-rules' summary.implementedCount (the registry), and
 * the result banner's M is the run's checksTotal (buildCostRunResult over summarizeDetectors over the observations
 * analyzeAllResources returns). The two come from different code, so nothing else stops them drifting apart: a
 * detector wired without a registry rule, or a rule marked implemented without a detector, would make the tile and
 * the banner disagree for the same run. This runs the REAL analyzeAllResources (every detector stubbed to answer,
 * no AWS) and pins checksTotal to the catalog's count, rule for rule.
 */
import costOptimizationService from '../cost-optimization.service';
import { AWSClientFactory } from '../aws-client-factory.service';
import { OptimizationRuleConfigService } from '../optimization-rule-config.service';
import { summarizeDetectors } from '../cost-analysis-outcome';
import { buildCostRunResult, type CostRunResult } from '../cost-run-result';
import { getImplementedOptimizationRules, getOptimizationRuleSummary } from '../../config/optimization-rules';

/** Every detector analyzeAllResources runs. A detector added without a stub here answers from fake clients and fails test 1. */
const DETECTORS = [
  'detectLowActivityEC2Instances',
  'detectUnusedElasticIPs',
  'detectUnattachedEBSVolumes',
  'detectGp2ToGp3Migrations',
  'detectS3LifecycleOptimization',
  'detectLowUsageLambdaFunctions',
  'detectDynamoDBCapacityOptimization',
  'detectDynamoDBOnDemandVsProvisionedOptimization',
  'detectReservedInstanceOpportunities',
  'detectIdleRDSInstances',
  'detectOldEBSSnapshots',
  'detectIdleNatGateways',
  'detectUnusedLogGroups',
] as const;

function stubDetectors(failing: readonly string[] = []) {
  for (const name of DETECTORS) {
    jest.spyOn(costOptimizationService as any, name).mockResolvedValue(
      failing.includes(name) ? { success: false, issues: [], failureReason: 'permissions' } : { success: true, issues: [] }
    );
  }
}

/** One run's banner facts, built exactly as the analyze endpoint builds them. */
async function runResult(): Promise<{ result: CostRunResult; checkRuleIds: (string | null)[] }> {
  const { observations, riSucceeded, riRecommendations, riFailureReason } = await costOptimizationService.analyzeAllResources('org-test');
  const summary = summarizeDetectors(observations, riSucceeded, riRecommendations, riFailureReason);
  const result = buildCostRunResult({
    id: 'run-test', state: summary.state, completedAt: null, checks: summary.checks,
    newCount: 0, openCount: 0, unknownResourceCount: summary.unknownResourceCount, message: null, findingsUnchanged: false,
  });
  return { result, checkRuleIds: summary.checks.map((check) => check.rule_id) };
}

/** What the tile shows: the count and the service categories with an implemented rule (costs/cost-intelligence.ts activeChecks). */
function tile() {
  const summary = getOptimizationRuleSummary();
  return {
    count: summary.implementedCount,
    services: summary.services.filter((s) => s.implementedCount > 0).map((s) => s.displayName),
  };
}

describe('safeguard 3: the "Cost checks" tile count equals the banner\'s M for the same run', () => {
  beforeEach(() => {
    jest.spyOn(AWSClientFactory, 'createClients').mockResolvedValue({
      enabled: true, ec2: {}, rds: {}, s3: {}, lambda: {}, cloudWatch: {}, region: 'xx-test-1',
    } as any);
    jest.spyOn(OptimizationRuleConfigService.prototype, 'resolveEffectiveConfig').mockResolvedValue({
      ruleId: 'lambda_low_usage', parameterId: 'max_invocations', value: 10, source: 'default',
    } as any);
  });
  afterEach(() => jest.restoreAllMocks());

  it('every check ran (green): M = checksTotal = checksRan = the catalog\'s implementedCount, across the tile\'s service categories', async () => {
    stubDetectors();
    const { result } = await runResult();
    expect(result.state).toBe('completed');
    expect(result.checksTotal).toBe(tile().count);
    expect(result.checksRan).toBe(tile().count);
    expect(result.services).toEqual(tile().services);
    for (const name of DETECTORS) expect((costOptimizationService as any)[name]).toHaveBeenCalledTimes(1);
  });

  it('some checks couldn\'t run (amber "N of M"): M is still the catalog\'s implementedCount', async () => {
    stubDetectors(['detectIdleNatGateways', 'detectReservedInstanceOpportunities']);
    const { result } = await runResult();
    expect(result.state).toBe('partial');
    expect(result.checksTotal).toBe(tile().count);
    expect(result.checksRan).toBe(tile().count - 2);
  });

  it('rule for rule: each check in the run names a different implemented rule, and every implemented rule is a check', async () => {
    stubDetectors();
    const { checkRuleIds } = await runResult();
    expect(checkRuleIds).not.toContain(null);
    expect(new Set(checkRuleIds).size).toBe(checkRuleIds.length);
    expect([...checkRuleIds].sort()).toEqual(getImplementedOptimizationRules().map((rule) => rule.id).sort());
  });
});
