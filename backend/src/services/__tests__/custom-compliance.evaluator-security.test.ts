/**
 * Evaluator-layer regression coverage for the Phase 1 security foundation's
 * removal of `custom_script`. The API boundary
 * (compliance-frameworks-security-foundation.test.ts) already proves a
 * direct HTTP request can't create a custom_script rule -- this file proves
 * the *other* half: if a `custom_script` rule ever reached
 * CustomComplianceService's evaluator anyway (a legacy/pre-migration row,
 * a future bypass of the API layer, a bug elsewhere), the evaluator itself
 * still refuses to run it, rather than relying solely on the API check.
 *
 * Calls the real, private `evaluateRule` directly (not via `executeScan`),
 * since that method is pure -- no database, network, filesystem, or process
 * interaction at all -- so this test is fully hermetic and doesn't require
 * Postgres to be running.
 */
import { CustomComplianceService } from '../custom-compliance.service';
import { ComplianceFrameworkRule } from '../../repositories/compliance-frameworks.repository';

const CANARY_KEY = '__phase1_custom_script_evaluator_canary__';

describe('CustomComplianceService — custom_script evaluator regression', () => {
  afterEach(() => {
    delete (globalThis as any)[CANARY_KEY];
  });

  it('a rule_type "custom_script" row reaching the evaluator directly is safely rejected, and its script is never executed', async () => {
    // Never queried -- evaluateRule/evaluatePropertyCheck/etc. are pure
    // functions of (rule, resource) with no repository/pool access, so a
    // real Pool is unnecessary here.
    const service = new CustomComplianceService({} as any);

    // If `new Function('resource', script)` (the exact unsandboxed pattern
    // removed from this codebase) were still reachable and executed this,
    // it would bump a canary on `globalThis` -- an unmistakable, observable
    // side effect distinct from the function's own return value, so this
    // test can't pass merely by the evaluator returning a plausible-looking
    // result for the wrong reason.
    const maliciousScript = `
      globalThis['${CANARY_KEY}'] = (globalThis['${CANARY_KEY}'] || 0) + 1;
      return true;
    `;

    const legacyCustomScriptRule: ComplianceFrameworkRule = {
      id: 'legacy-rule-id',
      framework_id: 'fw-id',
      organization_id: 'org-id',
      rule_code: 'LEGACY-CUSTOM-SCRIPT',
      title: 'Legacy custom_script rule',
      description: null,
      severity: 'high',
      category: 'custom',
      // Outside the V1-only ComplianceRuleType by construction -- this is
      // exactly the "a custom_script value somehow reaches the evaluator
      // anyway" scenario (legacy row, pre-migration data, future bypass)
      // that this test exists to cover, so the cast is the point, not an
      // oversight.
      rule_type: 'custom_script' as unknown as ComplianceFrameworkRule['rule_type'],
      conditions: { script: maliciousScript },
      resource_types: [],
      recommendation: 'N/A',
      remediation_url: null,
      enabled: true,
      created_at: new Date(),
      updated_at: new Date(),
    };

    const resource = {
      id: 'res-1',
      resource_arn: 'arn:aws:s3:::example-bucket',
      resource_type: 's3',
      resource_name: 'example-bucket',
      tags: {},
      metadata: {},
    } as any;

    const result = await (service as any).evaluateRule(legacyCustomScriptRule, resource);

    // The existing, already-safe "unsupported rule type" result -- no new
    // code path, no execution, just the evaluator's default branch.
    expect(result).toEqual({
      pass: false,
      error: 'Unknown rule type: custom_script',
    });

    // The script's own observable side effect never happened.
    expect((globalThis as any)[CANARY_KEY]).toBeUndefined();
  });
});
