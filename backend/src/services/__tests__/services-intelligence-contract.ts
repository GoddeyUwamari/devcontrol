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
    health: z
      .object({ state: notEvaluated, group: z.null(), reasons: z.array(z.never()), signal: z.null() })
      .strict(),
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
    health: z.object({ state: notEvaluated, resource_counts: z.null() }).strict(),
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
    health: z.object({ state: notEvaluated, kind: z.null(), counts_toward_at_risk: z.null() }).strict(),
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
