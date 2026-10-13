/**
 * Compliance-framework applicability: which frameworks an organization has
 * explicitly enabled, and which persisted findings are current.
 *
 * A framework's checks run only when a setting explicitly enables it. A missing
 * setting, an unreadable one, and one that cannot be interpreted each resolve to
 * their own state; none of them is read as enabled or as disabled.
 *
 * Settings are the organization's built-in rows in compliance_frameworks
 * (framework_type = 'built_in', standard_name = the framework), read by
 * readBuiltInFrameworkSettings in compliance-frameworks.repository.ts. Customer-
 * authored (custom) frameworks are evaluated by CustomComplianceService and are
 * not settings for these checks.
 */
import { ComplianceIssue, FrameworkApplicabilityState } from '../types/aws-resources.types';
import { normalizeFrameworkName } from './reservedFrameworkNames';

export interface RegisteredFramework {
  /** The framework's key, as written on its findings and matched against standard_name. */
  key: string;
  /**
   * Prefix of the issue text this framework's findings carried before they recorded
   * a `framework` field. Those entries were written when the checks ran for every
   * organization, so none of them came from an explicit enablement.
   */
  legacyIssuePrefix?: string;
  /**
   * Exact issue texts this framework's findings carried before they recorded a
   * `framework` field, for findings whose text does not start with the prefix.
   */
  legacyIssueTexts?: readonly string[];
}

/** The frameworks the resource scanner has checks for. Adding one here is what makes its setting recognized. */
export const REGISTERED_FRAMEWORKS: readonly RegisteredFramework[] = [
  { key: 'HIPAA', legacyIssuePrefix: 'HIPAA:' },
  {
    // The SOC 2 checks were written for every organization, first under a "SOC2:"
    // prefix and later relabelled to the two texts below. Each was the absence of a
    // tag reported as a High finding.
    key: 'SOC2',
    legacyIssuePrefix: 'SOC2:',
    legacyIssueTexts: [
      'Tagging: IAM role/owner not documented',
      'Observability: Monitoring/logging not documented via tag',
    ],
  },
];

export type FrameworkApplicabilityReasonCode =
  | 'explicitly_enabled'
  | 'explicitly_disabled'
  | 'no_setting'
  | 'settings_unavailable'
  | 'invalid_enabled_value'
  | 'conflicting_settings'
  | 'unrecognized_framework';

export interface FrameworkApplicability {
  framework: string;
  state: FrameworkApplicabilityState;
  reason_code: FrameworkApplicabilityReasonCode;
  /** Fixed wording, safe to show: never a setting's raw value or an error's text. */
  reason: string;
}

/** The outcome of reading an organization's settings: the rows, or the fact that they could not be read. */
export type FrameworkSettingsRead =
  | { status: 'ok'; rows: unknown }
  | { status: 'unavailable' };

/**
 * Why a check has its evaluation state. Stored and transported as the code;
 * the wording below is the only text ever shown for it. A code is never built
 * from an error message, a setting's value or anything else read at run time.
 */
export type EvaluationReasonCode =
  | FrameworkApplicabilityReasonCode
  | 'no_backup_reported'
  | 'backup_reported'
  | 'backup_state_unknown'
  | 'encryption_state_unknown'
  | 'covered_by_baseline_encryption_check'
  | 'tag_only_evidence'
  | 'no_evidence_collected'
  | 'check_exception'
  | 'no_checks_registered'
  | 'check_not_applicable_to_resource'
  | 'check_retired'
  | 'no_evaluation_recorded'
  | 'evidence_unavailable_not_reverified'
  | 'check_exception_not_reverified';

const REASONS: Record<FrameworkApplicabilityReasonCode, string> = {
  explicitly_enabled: 'Framework is explicitly enabled for this organization',
  explicitly_disabled: 'Framework is explicitly disabled for this organization',
  no_setting: 'No setting is recorded for this framework; a framework is evaluated only when explicitly enabled',
  settings_unavailable: 'Framework settings could not be read',
  invalid_enabled_value: 'Framework setting has no usable enabled/disabled value',
  conflicting_settings: 'Framework has conflicting settings: both enabled and disabled',
  unrecognized_framework: 'Setting names a framework that has no checks here',
};

const EVALUATION_REASONS: Record<EvaluationReasonCode, string> = {
  ...REASONS,
  no_backup_reported: 'AWS Backup reports no backup for this resource',
  backup_reported: 'AWS Backup reports a backup for this resource',
  backup_state_unknown: 'Backup state of this resource is unknown',
  encryption_state_unknown: 'Encryption state of this resource is unknown',
  covered_by_baseline_encryption_check: 'Resource is not encrypted; that is reported by the encryption-at-rest check',
  tag_only_evidence: 'The control is documented only by a resource tag, which is self-attested and not verified against AWS',
  no_evidence_collected: 'No AWS evidence for this control is collected for this resource',
  check_exception: 'Check could not be completed',
  no_checks_registered: 'No checks are registered for this framework',
  check_not_applicable_to_resource: 'Check does not apply to this resource',
  check_retired: 'Check is no longer part of this framework',
  no_evaluation_recorded: 'No evaluation of this check has been recorded for this resource',
  evidence_unavailable_not_reverified:
    'The configuration this check reads could not be read on the latest scan; this finding is from an earlier scan and was not re-verified',
  check_exception_not_reverified:
    'The check could not be completed on the latest scan; this finding is from an earlier scan and was not re-verified',
};

/** The fixed wording for a reason code; a code nobody knows gets a neutral sentence, never the code's own text. */
export function evaluationReasonText(code: unknown): string {
  return typeof code === 'string' && Object.prototype.hasOwnProperty.call(EVALUATION_REASONS, code)
    ? EVALUATION_REASONS[code as EvaluationReasonCode]
    : 'No further detail is recorded';
}

function applicability(
  framework: string,
  state: FrameworkApplicabilityState,
  reason_code: FrameworkApplicabilityReasonCode
): FrameworkApplicability {
  return { framework, state, reason_code, reason: REASONS[reason_code] };
}

/** Applicability for a framework no setting was supplied for. */
export function notConfigured(framework: string): FrameworkApplicability {
  return applicability(framework, 'not_configured', 'no_setting');
}

function settingName(row: unknown): string | null {
  if (!row || typeof row !== 'object') return null;
  const name = (row as Record<string, unknown>).standard_name;
  return typeof name === 'string' && name.trim().length > 0 ? name : null;
}

function resolveOne(framework: string, rows: unknown[]): FrameworkApplicability {
  const values = rows.map((row) => (row as Record<string, unknown>).enabled);
  if (values.length === 0) return notConfigured(framework);
  // Checked before anything else: a NULL or non-boolean value beside a valid one is
  // still a setting nobody can read with confidence.
  if (values.some((value) => typeof value !== 'boolean')) {
    return applicability(framework, 'invalid', 'invalid_enabled_value');
  }
  const enabled = values.some((value) => value === true);
  const disabled = values.some((value) => value === false);
  if (enabled && disabled) return applicability(framework, 'invalid', 'conflicting_settings');
  return enabled
    ? applicability(framework, 'enabled', 'explicitly_enabled')
    : applicability(framework, 'disabled', 'explicitly_disabled');
}

/**
 * One entry per registered framework, in registration order, followed by one
 * 'invalid' entry per setting that names no registered framework (or no framework
 * at all). Those extra entries are never evaluated and never change a registered
 * framework's state.
 */
export function resolveFrameworkApplicability(
  read: FrameworkSettingsRead,
  frameworks: readonly RegisteredFramework[] = REGISTERED_FRAMEWORKS
): FrameworkApplicability[] {
  if (read.status !== 'ok' || !Array.isArray(read.rows)) {
    return frameworks.map((f) => applicability(f.key, 'unavailable', 'settings_unavailable'));
  }

  const byFramework = new Map<string, unknown[]>(frameworks.map((f) => [normalizeFrameworkName(f.key), []]));
  const unrecognized = new Map<string, string>();
  for (const row of read.rows) {
    const name = settingName(row);
    const matched = name === null ? undefined : byFramework.get(normalizeFrameworkName(name));
    if (matched) {
      matched.push(row);
    } else {
      const label = name === null ? '(unnamed)' : name.trim();
      unrecognized.set(label.toLowerCase(), label);
    }
  }

  return [
    ...frameworks.map((f) => resolveOne(f.key, byFramework.get(normalizeFrameworkName(f.key)) ?? [])),
    ...Array.from(unrecognized.values())
      .sort()
      .map((label) => applicability(label, 'invalid', 'unrecognized_framework')),
  ];
}

/** `supplied`, plus a not_configured entry for every registered framework it leaves out. */
export function withRegisteredFrameworks(
  supplied: readonly FrameworkApplicability[],
  frameworks: readonly RegisteredFramework[] = REGISTERED_FRAMEWORKS
): FrameworkApplicability[] {
  const present = new Set(supplied.map((a) => a.framework));
  return [...supplied, ...frameworks.filter((f) => !present.has(f.key)).map((f) => notConfigured(f.key))];
}

/**
 * Whether a persisted compliance_issues entry is a current finding, i.e. one that
 * may count toward a score or an at-risk flag.
 *
 *   - An entry carried forward from an earlier scan because the latest one could
 *     not re-evaluate it (verification: 'unverified') is never current.
 *   - An entry that records an evaluation_state is current only when that state is
 *     'failed' and, where it records an applicability, the framework was enabled.
 *   - An entry that records none is a baseline finding and is current -- unless it
 *     is a registered framework's finding from before entries recorded their
 *     framework (see RegisteredFramework.legacyIssuePrefix / legacyIssueTexts).
 *
 * Severity is not consulted: it says how much a current finding matters, not
 * whether an entry is one.
 */
export function isActiveComplianceFinding(
  entry: unknown,
  frameworks: readonly RegisteredFramework[] = REGISTERED_FRAMEWORKS
): boolean {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
  const issue = entry as Record<string, unknown>;

  if (issue.verification === 'unverified') return false;
  if (issue.evaluation_state !== undefined && issue.evaluation_state !== null) {
    if (issue.evaluation_state !== 'failed') return false;
    return issue.applicability === undefined || issue.applicability === null || issue.applicability === 'enabled';
  }
  if (issue.framework !== undefined && issue.framework !== null) return false;

  const text = issue.issue;
  if (typeof text !== 'string') return true;
  return !frameworks.some(
    (f) =>
      (f.legacyIssuePrefix !== undefined && text.startsWith(f.legacyIssuePrefix)) ||
      (f.legacyIssueTexts !== undefined && f.legacyIssueTexts.includes(text))
  );
}

/** The current findings among a stored compliance_issues value; [] when it is not an array. */
export function activeComplianceFindings(complianceIssues: unknown): ComplianceIssue[] {
  return Array.isArray(complianceIssues)
    ? (complianceIssues.filter((issue) => isActiveComplianceFinding(issue)) as ComplianceIssue[])
    : [];
}
