/**
 * Security Truthfulness #40/#41: confirms CustomComplianceService's existing
 * property_check evaluation (strict `===`/`!==`, no truthiness) already behaves
 * correctly now that is_encrypted/has_backup can be a genuine `null` -- no code change
 * was made to this file, per the locked decision to preserve existing custom
 * compliance-rule behavior. This is a regression/confirmation test, not a new-behavior
 * test: `null === true` was always `false` under strict equality, so a rule requiring
 * `is_encrypted equals true` already correctly reports "not passing" (not proven
 * compliant) for an unknown resource, without ever needing to special-case null.
 */
import { CustomComplianceService } from '../custom-compliance.service';

describe('CustomComplianceService.evaluatePropertyCheck — unaffected by null is_encrypted/has_backup (no code change)', () => {
  const service = new CustomComplianceService({} as any);

  function evaluate(resource: Record<string, any>, conditions: Record<string, any>) {
    const rule = { conditions } as any;
    return (service as any).evaluatePropertyCheck(rule, resource);
  }

  it('"is_encrypted equals true" passes for a confirmed-true resource (unchanged)', () => {
    const result = evaluate({ is_encrypted: true }, { property: 'is_encrypted', operator: 'equals', value: true });
    expect(result.pass).toBe(true);
  });

  it('"is_encrypted equals true" does not pass for a confirmed-false resource (unchanged)', () => {
    const result = evaluate({ is_encrypted: false }, { property: 'is_encrypted', operator: 'equals', value: true });
    expect(result.pass).toBe(false);
  });

  it('"is_encrypted equals true" does not pass for an unknown (null) resource -- strict equality already excludes it correctly, no special-casing needed', () => {
    const result = evaluate({ is_encrypted: null }, { property: 'is_encrypted', operator: 'equals', value: true });
    expect(result.pass).toBe(false);
    expect(result.error).toBeUndefined(); // not an error condition -- a legitimate "not proven compliant" result
  });

  it('the explicit "exists" operator can be used to distinguish unknown from a definite value if a custom rule author wants that', () => {
    const knownResult = evaluate({ has_backup: false }, { property: 'has_backup', operator: 'exists' });
    const unknownResult = evaluate({ has_backup: null }, { property: 'has_backup', operator: 'exists' });
    expect(knownResult.pass).toBe(true);
    expect(unknownResult.pass).toBe(false);
  });

  it('has_backup equals true does not pass for an unknown (null) resource, same principle as is_encrypted', () => {
    const result = evaluate({ has_backup: null }, { property: 'has_backup', operator: 'equals', value: true });
    expect(result.pass).toBe(false);
  });
});
