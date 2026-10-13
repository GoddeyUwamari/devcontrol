/**
 * Framework applicability resolution and the current-finding rule.
 *
 * A framework is evaluated only when a setting explicitly enables it. Every other
 * situation -- no setting, an unreadable one, an uninterpretable one -- resolves to
 * its own state, and none of them is enabled or disabled. Pure: no database.
 */
import {
  FrameworkSettingsRead,
  REGISTERED_FRAMEWORKS,
  RegisteredFramework,
  activeComplianceFindings,
  isActiveComplianceFinding,
  notConfigured,
  resolveFrameworkApplicability,
  withRegisteredFrameworks,
} from '../frameworkApplicability';

const ok = (rows: unknown): FrameworkSettingsRead => ({ status: 'ok', rows });
const row = (standard_name: unknown, enabled: unknown) => ({ standard_name, enabled });

describe('resolveFrameworkApplicability', () => {
  const cases: Array<[string, FrameworkSettingsRead, Array<[string, string, string]>]> = [
    ['explicitly enabled', ok([row('HIPAA', true)]), [['HIPAA', 'enabled', 'explicitly_enabled']]],
    ['explicitly disabled', ok([row('HIPAA', false)]), [['HIPAA', 'disabled', 'explicitly_disabled']]],
    ['no settings at all', ok([]), [['HIPAA', 'not_configured', 'no_setting']]],
    ['settings read failed', { status: 'unavailable' }, [['HIPAA', 'unavailable', 'settings_unavailable']]],
    ['settings read returned something that is not rows', ok(null), [['HIPAA', 'unavailable', 'settings_unavailable']]],
    ['enabled is NULL', ok([row('HIPAA', null)]), [['HIPAA', 'invalid', 'invalid_enabled_value']]],
    ['enabled is the string "true"', ok([row('HIPAA', 'true')]), [['HIPAA', 'invalid', 'invalid_enabled_value']]],
    ['enabled is 1', ok([row('HIPAA', 1)]), [['HIPAA', 'invalid', 'invalid_enabled_value']]],
    ['enabled is missing from the row', ok([{ standard_name: 'HIPAA' }]), [['HIPAA', 'invalid', 'invalid_enabled_value']]],
    ['one enabled and one disabled setting', ok([row('HIPAA', true), row('HIPAA', false)]), [['HIPAA', 'invalid', 'conflicting_settings']]],
    ['a valid setting beside an unusable one', ok([row('HIPAA', true), row('HIPAA', null)]), [['HIPAA', 'invalid', 'invalid_enabled_value']]],
    ['two settings that agree', ok([row('HIPAA', true), row('hipaa', true)]), [['HIPAA', 'enabled', 'explicitly_enabled']]],
    ['the name in another case or spacing', ok([row(' hipaa ', false)]), [['HIPAA', 'disabled', 'explicitly_disabled']]],
    [
      'an enabled setting for a framework with no checks',
      ok([row('PCI-DSS', true)]),
      [['HIPAA', 'not_configured', 'no_setting'], ['PCI-DSS', 'invalid', 'unrecognized_framework']],
    ],
    [
      'a setting with no framework name',
      ok([row(null, true), row('', true)]),
      [['HIPAA', 'not_configured', 'no_setting'], ['(unnamed)', 'invalid', 'unrecognized_framework']],
    ],
    [
      'a row that is not an object',
      ok(['HIPAA', null]),
      [['HIPAA', 'not_configured', 'no_setting'], ['(unnamed)', 'invalid', 'unrecognized_framework']],
    ],
    [
      'an unrecognized setting does not change a recognized one',
      ok([row('HIPAA', true), row('Made Up', true)]),
      [['HIPAA', 'enabled', 'explicitly_enabled'], ['Made Up', 'invalid', 'unrecognized_framework']],
    ],
  ];

  // The cases above are written for HIPAA. Every other registered framework is
  // resolved by the same code from the same rows; none of these rows names one, so
  // each must come out as "no setting" (or unavailable) and never as enabled.
  it.each(cases)('%s', (_name, read, expected) => {
    const resolved = resolveFrameworkApplicability(read);
    const others = REGISTERED_FRAMEWORKS.map((f) => f.key).filter((key) => key !== 'HIPAA');
    expect(resolved.filter((a) => !others.includes(a.framework)).map((a) => [a.framework, a.state, a.reason_code])).toEqual(expected);
    for (const key of others) {
      const other = resolved.find((a) => a.framework === key);
      expect(['not_configured', 'unavailable']).toContain(other?.state);
    }
    for (const entry of resolved) expect(entry.reason).toEqual(expect.stringMatching(/\S/));
  });

  it('registers HIPAA and SOC 2, in that order', () => {
    expect(REGISTERED_FRAMEWORKS.map((f) => f.key)).toEqual(['HIPAA', 'SOC2']);
  });

  it('only an explicit true resolves to enabled', () => {
    const values: unknown[] = [undefined, null, 'true', 'enabled', 1, {}, [], 'yes', false];
    for (const value of values) {
      const [hipaa] = resolveFrameworkApplicability(ok([row('HIPAA', value)]));
      expect(hipaa.state).not.toBe('enabled');
    }
  });

  it('never puts a setting value or name it did not recognize into the reason', () => {
    const [hipaa] = resolveFrameworkApplicability(ok([row('HIPAA', 'DROP TABLE x')]));
    expect(hipaa.reason).not.toContain('DROP');
  });

  it('resolves each registered framework independently, with no framework named in the resolver', () => {
    const frameworks: RegisteredFramework[] = [{ key: 'ALPHA' }, { key: 'BETA' }, { key: 'GAMMA' }, { key: 'DELTA' }];
    const read = ok([row('alpha', true), row('BETA', false), row('Gamma', null)]);
    expect(resolveFrameworkApplicability(read, frameworks).map((a) => [a.framework, a.state])).toEqual([
      ['ALPHA', 'enabled'],
      ['BETA', 'disabled'],
      ['GAMMA', 'invalid'],
      ['DELTA', 'not_configured'],
    ]);
    // HIPAA is not registered in this set, so its setting is not recognized here.
    expect(resolveFrameworkApplicability(ok([row('HIPAA', true)]), frameworks).map((a) => [a.framework, a.state])).toEqual([
      ['ALPHA', 'not_configured'],
      ['BETA', 'not_configured'],
      ['GAMMA', 'not_configured'],
      ['DELTA', 'not_configured'],
      ['HIPAA', 'invalid'],
    ]);
  });
});

describe('withRegisteredFrameworks', () => {
  it('adds a registered framework that was left out as not configured, never as enabled', () => {
    expect(withRegisteredFrameworks([])).toEqual([notConfigured('HIPAA'), notConfigured('SOC2')]);
    expect(withRegisteredFrameworks([])[0]).toMatchObject({ state: 'not_configured', reason_code: 'no_setting' });
  });

  it('leaves a supplied entry as it is', () => {
    const [supplied] = resolveFrameworkApplicability(ok([row('HIPAA', false)]));
    expect(withRegisteredFrameworks([supplied])).toEqual([supplied, notConfigured('SOC2')]);
  });
});

describe('isActiveComplianceFinding', () => {
  const baseline = { severity: 'high', category: 'encryption', issue: 'EC2 instance has unencrypted EBS volumes', recommendation: 'r' };
  const framework = { ...baseline, issue: 'HIPAA: EBS storing PHI must have automated backups', framework: 'HIPAA', findingKey: 'hipaa.automated_backups' };

  const cases: Array<[string, unknown, boolean]> = [
    ['a baseline finding', baseline, true],
    // Was `true` ("S3 convention, unchanged"): a finding the latest scan could not
    // re-verify is a record of an earlier scan, not a finding of this one.
    ['a baseline finding carried forward unverified, as stored before it recorded a state', { ...baseline, verification: 'unverified' }, false],
    ['a baseline finding carried forward unverified because the bucket could not be read', { ...baseline, verification: 'unverified', evaluation_state: 'unable_to_evaluate', evidence_basis: 'none' }, false],
    ['a baseline finding carried forward unverified because its evaluation threw', { ...baseline, verification: 'unverified', evaluation_state: 'error', evidence_basis: 'none' }, false],
    ['an unverified entry is not current even if something recorded it as failed', { ...baseline, verification: 'unverified', evaluation_state: 'failed' }, false],
    ['a baseline entry that records a state other than failed', { ...baseline, evaluation_state: 'unable_to_evaluate' }, false],
    ['a verification marker nobody knows does not make a finding unverified', { ...baseline, verification: 'verified' }, true],
    ['a failed check of an enabled framework', { ...framework, applicability: 'enabled', evaluation_state: 'failed' }, true],
    ['a failed entry that records no applicability', { ...framework, evaluation_state: 'failed' }, true],
    ['a failed entry whose framework is now disabled', { ...framework, applicability: 'disabled', evaluation_state: 'failed' }, false],
    ['an entry kept because settings were unavailable', { ...framework, applicability: 'unavailable', evaluation_state: 'not_evaluated' }, false],
    ['an entry kept because settings were invalid', { ...framework, applicability: 'invalid', evaluation_state: 'not_evaluated' }, false],
    ['an entry kept after a check error', { ...framework, applicability: 'enabled', evaluation_state: 'error' }, false],
    ['an entry kept when evidence went missing', { ...framework, applicability: 'enabled', evaluation_state: 'unable_to_evaluate' }, false],
    ['a passed record', { ...framework, applicability: 'enabled', evaluation_state: 'passed' }, false],
    ['an evaluation_state nobody knows', { ...framework, applicability: 'enabled', evaluation_state: 'maybe' }, false],
    ['a framework entry that records no evaluation_state', framework, false],
    ['a HIPAA finding written before frameworks had to be enabled', { ...baseline, issue: 'HIPAA: S3 lacks required access logging for audit trails' }, false],
    ['a baseline finding that merely mentions HIPAA', { ...baseline, issue: 'Tagging: HIPAA scope not documented' }, true],
    ['a SOC 2 tag signal written before frameworks had to be enabled (IAM role)', { ...baseline, severity: 'high', category: 'tagging', issue: 'Tagging: IAM role/owner not documented', provenance: 'SELF_ATTESTED' }, false],
    ['a SOC 2 tag signal written before frameworks had to be enabled (monitoring)', { ...baseline, severity: 'high', category: 'networking', issue: 'Observability: Monitoring/logging not documented via tag', provenance: 'SELF_ATTESTED' }, false],
    ['a SOC 2 finding from before the relabel', { ...baseline, issue: 'SOC2: Missing change management tags' }, false],
    ['the required-tags baseline finding', { severity: 'low', category: 'tagging', issue: 'Resource is missing required tags: Owner, Environment, Team', recommendation: 'r' }, true],
    ['an entry with no issue text', { severity: 'low', category: 'tagging' }, true],
    ['null', null, false],
    ['a string', 'HIPAA', false],
    ['an array', [baseline], false],
  ];

  it.each(cases)('%s', (_name, entry, expected) => {
    expect(isActiveComplianceFinding(entry)).toBe(expected);
  });

  it('does not consult severity: the same entry is current or not at every severity', () => {
    for (const severity of ['critical', 'high', 'medium', 'low', undefined]) {
      expect(isActiveComplianceFinding({ ...framework, severity, applicability: 'enabled', evaluation_state: 'failed' })).toBe(true);
      expect(isActiveComplianceFinding({ ...framework, severity, applicability: 'enabled', evaluation_state: 'unable_to_evaluate' })).toBe(false);
    }
  });

  it('severity never rescues an entry that is not current: legacy and unverified entries are excluded at Critical too', () => {
    for (const severity of ['critical', 'high', 'medium', 'low']) {
      expect(isActiveComplianceFinding({ ...baseline, severity, verification: 'unverified' })).toBe(false);
      expect(isActiveComplianceFinding({ ...baseline, severity, issue: 'HIPAA: Resource lacks documented backup retention policy' })).toBe(false);
      expect(isActiveComplianceFinding({ ...baseline, severity, issue: 'Tagging: IAM role/owner not documented' })).toBe(false);
    }
  });
});

describe('activeComplianceFindings', () => {
  const current = { severity: 'high', category: 'encryption', issue: 'EC2 instance has unencrypted EBS volumes', recommendation: 'r' };

  it('keeps the current findings of a stored array, in order, and nothing else', () => {
    const other = { severity: 'low', category: 'tagging', issue: 'Resource is missing required tags: Owner', recommendation: 'r' };
    expect(
      activeComplianceFindings([
        current,
        { ...current, issue: 'HIPAA: RDS must have encryption in transit for PHI data', severity: 'critical' },
        { ...current, issue: 'Tagging: IAM role/owner not documented' },
        { ...current, verification: 'unverified', severity: 'critical' },
        null,
        'text',
        other,
      ])
    ).toEqual([current, other]);
  });

  it.each([null, undefined, {}, 'x', 3])('is empty for a stored value that is not an array: %p', (value) => {
    expect(activeComplianceFindings(value)).toEqual([]);
  });
});
