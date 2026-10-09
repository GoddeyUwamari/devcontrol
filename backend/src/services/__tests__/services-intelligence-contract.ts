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
    remediation: remediationSchema.nullable(),
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
  .strict();

/** The HTTP envelope around it. */
export const servicesIntelligenceResponseSchema = z
  .object({ success: z.literal(true), data: servicesIntelligenceSchema })
  .strict();
