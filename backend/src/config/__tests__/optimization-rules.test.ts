/**
 * Guards the Optimization Rule Registry (config/optimization-rules.ts):
 *
 *  - stable, unique, machine-readable rule IDs
 *  - the exact set of rules the Phase 1 product spec calls "implemented"
 *    today, no more and no less -- this is the test that would fail if
 *    someone flipped a 'planned' rule to 'implemented' without actually
 *    wiring an analyzer for it (or vice versa)
 *  - every 'implemented' rule carries the `issue` identity its detector
 *    actually emits (cost-optimization.service.ts), and no 'planned' rule
 *    fabricates one
 *  - every rule's `service` is one of the 12 canonical coverage groups
 *  - summary counts are derived, never hardcoded, and stay internally
 *    consistent with the registry contents
 */
import {
  OPTIMIZATION_RULES,
  OPTIMIZATION_RULE_SERVICES,
  getOptimizationRules,
  getImplementedOptimizationRules,
  getOptimizationRuleSummary,
  ISSUE_EC2_IDLE_INSTANCE,
  ISSUE_RDS_OVERSIZED_INSTANCE,
  ISSUE_EC2_UNUSED_ELASTIC_IP,
  ISSUE_EC2_RESERVED_INSTANCE_OPPORTUNITY,
  ISSUE_EBS_UNATTACHED_VOLUME,
  ISSUE_EBS_GP2_TO_GP3,
  ISSUE_S3_LIFECYCLE_OPTIMIZATION,
  ISSUE_LAMBDA_LOW_USAGE,
  ISSUE_DYNAMODB_CAPACITY,
  ISSUE_DYNAMODB_ON_DEMAND_VS_PROVISIONED,
} from '../optimization-rules';

describe('OPTIMIZATION_RULES: identity', () => {
  it('has no duplicate rule IDs', () => {
    const ids = OPTIMIZATION_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('uses lower_snake_case IDs', () => {
    for (const rule of OPTIMIZATION_RULES) {
      expect(rule.id).toMatch(/^[a-z0-9]+(_[a-z0-9]+)*$/);
    }
  });

  it('every rule belongs to one of the 12 canonical coverage services', () => {
    for (const rule of OPTIMIZATION_RULES) {
      expect(OPTIMIZATION_RULE_SERVICES).toContain(rule.service);
    }
  });

  it('covers all 12 canonical services with at least one rule', () => {
    const covered = new Set(OPTIMIZATION_RULES.map((r) => r.service));
    for (const service of OPTIMIZATION_RULE_SERVICES) {
      expect(covered.has(service)).toBe(true);
    }
  });
});

describe('OPTIMIZATION_RULES: implemented vs planned truthfulness', () => {
  // The only rules with a real analyzer as of Phase 1 -- must match
  // cost-optimization.service.ts's analyzeAllResources() exactly. Changing
  // this list here without also wiring (or removing) the corresponding
  // detector is exactly the "claim a rule is implemented merely because it
  // exists in the registry" failure this test exists to catch.
  const EXPECTED_IMPLEMENTED_IDS = [
    'ec2_idle',
    'ec2_unused_elastic_ip',
    'ec2_reserved_instances',
    'rds_rightsizing',
    'ebs_unattached',
    'ebs_gp2_to_gp3',
    's3_lifecycle',
    'lambda_low_usage',
    'dynamodb_capacity',
    'dynamodb_capacity_mode',
  ].sort();

  it('marks exactly the currently-wired detectors as implemented', () => {
    const implementedIds = getImplementedOptimizationRules().map((r) => r.id).sort();
    expect(implementedIds).toEqual(EXPECTED_IMPLEMENTED_IDS);
  });

  it('every implemented rule carries the exact issue identity its detector emits', () => {
    const byId = Object.fromEntries(OPTIMIZATION_RULES.map((r) => [r.id, r]));
    expect(byId['ec2_idle'].issue).toBe(ISSUE_EC2_IDLE_INSTANCE);
    expect(byId['ec2_unused_elastic_ip'].issue).toBe(ISSUE_EC2_UNUSED_ELASTIC_IP);
    expect(byId['ec2_reserved_instances'].issue).toBe(ISSUE_EC2_RESERVED_INSTANCE_OPPORTUNITY);
    expect(byId['rds_rightsizing'].issue).toBe(ISSUE_RDS_OVERSIZED_INSTANCE);
    expect(byId['ebs_unattached'].issue).toBe(ISSUE_EBS_UNATTACHED_VOLUME);
    expect(byId['ebs_gp2_to_gp3'].issue).toBe(ISSUE_EBS_GP2_TO_GP3);
    expect(byId['s3_lifecycle'].issue).toBe(ISSUE_S3_LIFECYCLE_OPTIMIZATION);
    expect(byId['lambda_low_usage'].issue).toBe(ISSUE_LAMBDA_LOW_USAGE);
    expect(byId['dynamodb_capacity'].issue).toBe(ISSUE_DYNAMODB_CAPACITY);
    expect(byId['dynamodb_capacity_mode'].issue).toBe(ISSUE_DYNAMODB_ON_DEMAND_VS_PROVISIONED);
  });

  it('no planned rule fabricates an issue identity', () => {
    const planned = OPTIMIZATION_RULES.filter((r) => r.status === 'planned');
    expect(planned.length).toBeGreaterThan(0);
    for (const rule of planned) {
      expect(rule.issue).toBeUndefined();
    }
  });

  it('every rule status is either implemented or planned -- no other value slips in', () => {
    for (const rule of OPTIMIZATION_RULES) {
      expect(['implemented', 'planned']).toContain(rule.status);
    }
  });
});

describe('OPTIMIZATION_RULES: the 30 target rule IDs from the Phase 1 product spec exist', () => {
  const TARGET_30_IDS = [
    'ec2_idle', 'ec2_rightsizing', 'ec2_old_generation', 'ec2_graviton',
    'ebs_unattached', 'ebs_gp2_to_gp3', 'ebs_oversized',
    'rds_idle', 'rds_rightsizing', 'rds_storage', 'rds_reserved_instance',
    's3_lifecycle', 's3_storage_class', 's3_noncurrent_versions',
    'lambda_memory', 'lambda_runtime', 'lambda_low_usage',
    'dynamodb_capacity', 'dynamodb_capacity_mode',
    'nat_gateway_data_processing',
    'ecs_rightsizing', 'ecs_capacity',
    'eks_capacity', 'eks_underutilized_nodes',
    'cloudwatch_unused_logs', 'cloudwatch_log_retention',
    'redshift_rightsizing', 'redshift_idle',
    'aurora_rightsizing', 'aurora_idle',
  ];

  it('registers all 30 target rule IDs', () => {
    expect(TARGET_30_IDS).toHaveLength(30);
    const registeredIds = new Set(OPTIMIZATION_RULES.map((r) => r.id));
    for (const id of TARGET_30_IDS) {
      expect(registeredIds.has(id)).toBe(true);
    }
  });
});

describe('getOptimizationRuleSummary', () => {
  it('derives counts that always sum correctly against the registry', () => {
    const summary = getOptimizationRuleSummary();
    expect(summary.totalRules).toBe(OPTIMIZATION_RULES.length);
    expect(summary.implementedCount + summary.plannedCount).toBe(summary.totalRules);
    expect(summary.implementedCount).toBe(getImplementedOptimizationRules().length);
  });

  it('never hardcodes 30 as the total -- the registry legitimately has more (2 pre-existing detectors outside the 30-rule target list)', () => {
    const summary = getOptimizationRuleSummary();
    expect(summary.totalRules).toBeGreaterThan(30);
  });

  it('per-service counts sum to the same total as the flat registry', () => {
    const summary = getOptimizationRuleSummary();
    const summedTotal = summary.services.reduce((sum, s) => sum + s.totalCount, 0);
    const summedImplemented = summary.services.reduce((sum, s) => sum + s.implementedCount, 0);
    expect(summedTotal).toBe(summary.totalRules);
    expect(summedImplemented).toBe(summary.implementedCount);
  });

  it('lists all 12 canonical services, even ones with zero implemented rules', () => {
    const summary = getOptimizationRuleSummary();
    expect(summary.services.map((s) => s.service)).toEqual([...OPTIMIZATION_RULE_SERVICES]);
    const zeroImplemented = summary.services.filter((s) => s.implementedCount === 0);
    expect(zeroImplemented.length).toBeGreaterThan(0);
  });
});

describe('getOptimizationRules', () => {
  it('returns the same array the registry exports', () => {
    expect(getOptimizationRules()).toBe(OPTIMIZATION_RULES);
  });
});
