/**
 * The public shape of GET /api/services/intelligence, as a strict schema.
 *
 * Written out independently of the implementation's types so that a change
 * to the response -- a key added, removed, or renamed, a type or nullability
 * change, a new state or enum value -- fails the suites that parse with it
 * until this file is changed on purpose. Every object is strict: unknown
 * keys are errors.
 */
import { z } from 'zod';

const isoTimestamp = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
const notEvaluated = z.literal('not_evaluated');

const remediationSchema = z
  .object({
    available: z.literal(true),
    path: z.literal('cost_recommendation_execute'),
    action_type: z.string().min(1),
    recommendation_id: z.string().uuid(),
    requires: z.object({ role: z.literal('admin'), plan: z.literal('enterprise') }).strict(),
  })
  .strict();

const evaluationStates = ['failed', 'passed', 'unable_to_evaluate', 'error', 'not_evaluated', 'not_applicable'] as const;

const findingSchema = z
  .object({
    source: z.enum(['resource_scan', 'cost_recommendation']),
    source_id: z.string().uuid().nullable(),
    finding_key: z.string().min(1).nullable(),
    verification: z.string().min(1).nullable(),
    severity: z.enum(['critical', 'high', 'medium', 'low']).nullable(),
    source_severity: z.string().nullable(),
    category: z.string().nullable(),
    title: z.string().nullable(),
    provenance: z.enum(['OBSERVED', 'DERIVED', 'SELF_ATTESTED']).nullable(),
    framework: z.string().min(1).nullable(),
    applicability: z.enum(['enabled', 'disabled', 'not_configured', 'unavailable', 'invalid']).nullable(),
    evaluation_state: z.enum(evaluationStates).nullable(),
    evidence_basis: z.enum(['aws_api', 'tag', 'none']).nullable(),
    evaluation_reason: z.string().min(1).nullable(),
    current: z.boolean(),
    not_current_reason: z
      .enum(['legacy_unattributed', 'not_current_state', 'not_reverified', 'storage_unavailable', 'no_evaluation_record', 'stale_evaluation'])
      .nullable(),
    remediation: remediationSchema.nullable(),
  })
  .strict()
  .refine((f) => f.current === (f.not_current_reason === null), 'a finding is current exactly when no reason says otherwise')
  .refine((f) => f.framework === null || f.source === 'resource_scan', 'only a resource scan finding belongs to a framework');

const reasonCode = z.string().regex(/^[a-z][a-z0-9_]{0,47}$/);

/** Every stored outcome of a check, findings or not. Severity only on a failure; a pass or fail only on AWS evidence. */
const checkEvaluationSchema = z
  .object({
    source: z.object({ kind: z.literal('framework'), key: z.string().min(1) }).strict(),
    check: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,95}$/),
    evaluation_state: z.enum(evaluationStates),
    severity: z.enum(['critical', 'high', 'medium', 'low']).nullable(),
    evidence_basis: z.enum(['aws_api', 'tag', 'none']).nullable(),
    provenance: z.enum(['OBSERVED', 'DERIVED', 'SELF_ATTESTED']).nullable(),
    reason_code: reasonCode,
    reason: z.string().min(1),
    error_code: reasonCode.nullable(),
    evaluated_at: isoTimestamp.nullable(),
    recorded: z.boolean(),
    stale: z.boolean(),
    last_conclusive: z
      .object({
        state: z.enum(['failed', 'passed']),
        at: isoTimestamp,
        severity: z.enum(['critical', 'high', 'medium', 'low']).nullable(),
      })
      .strict()
      .refine((l) => (l.state === 'failed') === (l.severity !== null), 'a last conclusive result has a severity exactly when it was a failure')
      .nullable(),
  })
  .strict()
  .refine((c) => (c.evaluation_state === 'failed') === (c.severity !== null), 'severity is set on a failure and on nothing else')
  .refine((c) => (c.evaluation_state === 'error') === (c.error_code !== null), 'an error code is set on an error and on nothing else')
  .refine(
    (c) => !['failed', 'passed'].includes(c.evaluation_state) || (c.evidence_basis === 'aws_api' && c.provenance !== null && c.provenance !== 'SELF_ATTESTED'),
    'a pass or a failure rests on AWS evidence, never on a tag or on nothing'
  )
  .refine((c) => c.recorded === (c.evaluated_at !== null), 'an evaluation time exists exactly when an evaluation is recorded')
  .refine(
    (c) => c.recorded || (c.evaluation_state === 'not_evaluated' && !c.stale && c.last_conclusive === null && c.reason_code === 'no_evaluation_recorded'),
    'an unrecorded check is not_evaluated and is never a stale stored result'
  )
  .refine((c) => c.last_conclusive === null || c.last_conclusive.state !== c.evaluation_state, 'a last conclusive result is shown only when the current state is not it');

const stateCount = z.number().int().nonnegative();

const frameworkSummarySchema = z
  .object({
    framework: z.string().min(1),
    applicability: z.enum(['enabled', 'disabled', 'not_configured', 'unavailable', 'invalid']).nullable(),
    applicability_reason_code: reasonCode.nullable(),
    applicability_reason: z.string().min(1).nullable(),
    latest_run: z
      .object({
        status: z.enum(['complete', 'partial']),
        started_at: isoTimestamp,
        finished_at: isoTimestamp,
        evaluator_version: z.string().min(1),
      })
      .strict()
      .nullable(),
    running: z.boolean(),
    last_attempt_failed: z.boolean(),
    stale: z.boolean(),
    stale_reason: z.enum(['no_run', 'run_too_old']).nullable(),
    counts: z
      .object({
        failed: stateCount, passed: stateCount, unable_to_evaluate: stateCount, error: stateCount,
        not_evaluated: stateCount, not_applicable: stateCount, stale: stateCount,
      })
      .strict(),
    reconciliation_required: stateCount,
  })
  .strict()
  .refine((f) => f.stale === (f.stale_reason !== null), 'a framework is stale exactly when a reason says so')
  .refine(
    (f) =>
      (f.latest_run === null) === (f.applicability === null) &&
      (f.latest_run === null) === (f.applicability_reason_code === null) &&
      (f.latest_run === null) === (f.applicability_reason === null) &&
      (f.latest_run === null) === (f.stale_reason === 'no_run'),
    'applicability is what the latest finished run applied: without one, none is claimed'
  );

const frameworkEvaluationSchema = z
  .object({ storage: z.enum(['available', 'unavailable']), frameworks: z.array(frameworkSummarySchema) })
  .strict()
  .refine((b) => b.storage === 'available' || b.frameworks.length === 0, 'nothing is claimed about any framework when storage is unavailable');

const frameworkReconciliationSchema = z
  .object({
    required: z.literal(true),
    since: isoTimestamp,
    last_attempt_at: isoTimestamp,
    attempts: z.number().int().positive(),
    reason_code: reasonCode,
  })
  .strict();

const healthSource = z.literal('resource_checks_cache');
const healthStates = ['checks_passing', 'check_failing', 'no_signal', 'not_supported'] as const;

// `group` and `signal` are PR 1 fields: still present, still null.
const resourceHealthSchema = z
  .object({
    state: z.enum(healthStates),
    group: z.null(),
    reasons: z.array(
      z.object({ kind: z.enum(['no_telemetry', 'undetermined', 'not_running', 'evaluation_unavailable']) }).strict()
    ),
    signal: z.null(),
    checks: z.array(
      z
        .object({
          name: z.string().regex(/^[a-z0-9_]+$/),
          result: z.enum(['passing', 'failing', 'undetermined']),
          observed_at: isoTimestamp,
        })
        .strict()
    ),
    evaluated_at: isoTimestamp.nullable(),
    source: healthSource.nullable(),
  })
  .strict()
  // The rules a value has to satisfy beyond its shape.
  .superRefine((health, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
    const results = health.checks.map((c) => c.result);
    if ((health.state === 'no_signal') !== (health.reasons.length > 0)) fail('reasons are given for no_signal, and only for it');
    if (health.state === 'checks_passing' && !(results.length > 0 && results.every((r) => r === 'passing'))) fail('checks_passing needs every check passing');
    if (health.state === 'check_failing' && !results.includes('failing')) fail('check_failing needs a failing check');
    if (health.state === 'no_signal' && results.some((r) => r !== 'undetermined')) fail('no_signal carries no passing or failing check');
    if (health.state === 'not_supported' && (results.length > 0 || health.evaluated_at !== null)) fail('not_supported carries no evaluation');
    if ((health.evaluated_at === null) !== (health.source === null)) fail('evaluated_at and source are set together');
    if (results.length > 0 && health.evaluated_at === null) fail('a check result needs an evaluation time');
  });

const resourceSchema = z
  .object({
    id: z.string().uuid(),
    arn: z.string().min(1),
    resource_id: z.string().min(1),
    name: z.string().nullable(),
    type: z.string().min(1),
    region: z.string().min(1),
    lifecycle_state: z.string().nullable(),
    service_id: z.string().uuid().nullable(),
    last_seen_at: isoTimestamp.nullable(),
    findings: z.array(findingSchema),
    check_evaluations: z.array(checkEvaluationSchema),
    framework_reconciliation: frameworkReconciliationSchema.nullable(),
    health: resourceHealthSchema,
    cost: z.object({ state: notEvaluated, amount: z.null(), basis: z.null(), display: z.null() }).strict(),
  })
  .strict();

const serviceSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    description: z.string().nullable(),
    owner_declared: z.string().nullable(),
    team: z.object({ id: z.string().uuid(), name: z.string() }).strict().nullable(),
    resources: z
      .object({
        count: z.number().int().nonnegative(),
        by_type: z.record(z.string(), z.number().int().positive()),
        items: z.array(resourceSchema),
      })
      .strict(),
    // No service verdict: `state` is still not_evaluated; only the counts are filled.
    health: z
      .object({
        state: notEvaluated,
        resource_counts: z
          .object({
            checks_passing: z.number().int().nonnegative(),
            check_failing: z.number().int().nonnegative(),
            no_signal: z.number().int().nonnegative(),
            not_supported: z.number().int().nonnegative(),
          })
          .strict(),
      })
      .strict(),
    cost: z
      .object({ state: notEvaluated, amount: z.null(), priced_resources: z.null(), unpriced_resources: z.null() })
      .strict(),
  })
  .strict();

const capabilitySchema = z
  .object({
    discovery: z
      .object({
        source: z.enum(['describe', 'resource_explorer']),
        region_scope: z.enum(['primary', 'per_resource', 'global']),
      })
      .strict(),
    health: z
      .object({
        state: z.enum(['supported', 'not_supported']),
        kind: z.enum(['aws_status_check', 'cloudwatch_metric', 'control_plane']).nullable(),
        counts_toward_at_risk: z.null(),
        checks: z.array(z.string().regex(/^[a-z0-9_]+$/)),
      })
      .strict()
      .refine((h) => (h.state === 'supported') === (h.kind !== null && h.checks.length > 0), 'supported means a kind and at least one check'),
    pricing: z.object({ state: notEvaluated, basis: z.null() }).strict(),
    tags: z.object({ collected: z.boolean() }).strict(),
    remediation: z.object({ action_types: z.array(z.string().min(1)) }).strict(),
  })
  .strict();

const discoverySchema = z
  .object({
    primary_region: z.string().nullable(),
    scope: z.literal('single_region_plus_global'),
    regions_present: z.array(z.string()),
    last_attempt: z
      .object({
        job_id: z.string().uuid(),
        started_at: isoTimestamp.nullable(),
        completed_at: isoTimestamp.nullable(),
        status: z.string(),
      })
      .strict()
      .nullable(),
    inventory_refreshed_at: isoTimestamp.nullable(),
  })
  .strict();

export const servicesIntelligenceSchema = z
  .object({
    contract_version: z.literal('1'),
    generated_at: isoTimestamp,
    organization_id: z.string().uuid(),
    discovery: discoverySchema.nullable(),
    remediation_execution_enabled: z.boolean(),
    health: z
      .object({
        evaluated_at: isoTimestamp.nullable(),
        source: healthSource.nullable(),
        range: z.literal('1h'),
        cache: z.enum(['hit', 'miss']),
        max_age_seconds: z.literal(900),
      })
      .strict()
      .refine((h) => (h.cache === 'hit') === (h.evaluated_at !== null) && (h.cache === 'hit') === (h.source !== null), 'a hit, and only a hit, has an evaluation time and source'),
    framework_evaluation: frameworkEvaluationSchema,
    capabilities: z.record(z.string(), capabilitySchema),
    totals: z
      .object({
        resources: z.number().int().nonnegative(),
        services: z.number().int().nonnegative(),
        unassigned_resources: z.number().int().nonnegative(),
      })
      .strict(),
    services: z.array(serviceSchema),
    unassigned: z.object({ resources: z.array(resourceSchema) }).strict(),
  })
  .strict()
  .refine((body) => {
    if (body.framework_evaluation.storage === 'available') return true;
    const resources = [...body.unassigned.resources, ...body.services.flatMap((s) => s.resources.items)];
    return resources.every(
      (r) => r.check_evaluations.length === 0 && r.findings.every((f) => f.framework === null || !f.current)
    );
  }, 'with storage unavailable there are no check evaluations and no framework finding is current')
  .refine((body) => {
    // A current framework finding is backed by a recorded, failed, non-stale evaluation of the same check.
    const resources = [...body.unassigned.resources, ...body.services.flatMap((s) => s.resources.items)];
    return resources.every((r) =>
      r.findings
        .filter((f) => f.framework !== null && f.current)
        .every((f) =>
          r.check_evaluations.some(
            (c) => c.source.key === f.framework && c.check === f.finding_key && c.recorded && !c.stale && c.evaluation_state === 'failed'
          )
        )
    );
  }, 'a current framework finding is backed by a current failed evaluation');

/** The HTTP envelope around it. */
export const servicesIntelligenceResponseSchema = z
  .object({ success: z.literal(true), data: servicesIntelligenceSchema })
  .strict();
