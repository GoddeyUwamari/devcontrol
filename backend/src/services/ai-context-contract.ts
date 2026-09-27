/**
 * AI context truth / provenance contract -- the one shared foundation every
 * DevControl AI surface (AI Chat, AI Reports, Ask AI, Forecast, Weekly
 * Summary, Dashboard summary, recommendations, security, monitoring, SLOs)
 * builds its evidence on. Surfaces must not invent their own state,
 * provenance, or "capability" vocabularies; extend this file instead.
 *
 * Three concepts are deliberately kept separate:
 *
 *   STATE      (ContextDataState)   -- can DevControl currently provide this
 *                                     evidence? Decided by the builder, never
 *                                     by the model.
 *   PROVENANCE (EvidenceProvenance) -- where/how a value that DOES exist
 *                                     originated. Never 'unavailable' or
 *                                     'error': those are states, and a section
 *                                     without data has provenance null.
 *   OUTCOME    (DetectorOutcome)    -- what a detector/evaluation concluded.
 *                                     Lives inside `data`; it is not a state.
 *
 * Every section also says where the evidence came from (source), what it
 * covers (scope, period), when it was obtained (asOf), and how much of the
 * requested evidence was actually obtained (completeness/coverage).
 *
 * The cost section of AI Chat still has its own older shape
 * (ChatContext['costs'] in ai-chat.service.ts); later PRs move it onto
 * ContextSection.
 */

import { createHash } from 'crypto';

/**
 * Version of the serialized evidence shape (toModelEvidence() /
 * evidenceFingerprint()). Bump it whenever that shape or the meaning of a
 * field changes, so cached AI output or cached context produced under an
 * older shape is detectably stale instead of being read under the new one.
 */
export const AI_CONTEXT_CONTRACT_VERSION = 1;

export function isCurrentContractVersion(version: unknown): boolean {
  return version === AI_CONTEXT_CONTRACT_VERSION;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/**
 * State of one AI-context dataset, decided by the context builder before the
 * model ever sees it -- so the model never has to guess whether a 0, an empty
 * list, or a missing section means "measured", "not collected", or "failed".
 *   available     = collected, complete for its stated scope and period
 *   partial       = collected, but only some of the requested evidence was
 *                   obtained (completeness/coverage says how much)
 *   unavailable   = nothing to collect (e.g. no connected account, no rows,
 *                   not enough history) -- not an error, and not a zero
 *   error         = collection was attempted and failed
 *   not_supported = DevControl has no source for this data on this surface
 */
export type ContextDataState = 'available' | 'partial' | 'unavailable' | 'error' | 'not_supported';

/**
 * How each state reads in model-facing text. The model repeats what it is
 * given, so it gets these words -- never the raw enum values.
 */
export const CONTEXT_STATE_LABELS: Record<ContextDataState, string> = {
  available: 'Available',
  partial: 'Partial',
  unavailable: 'Not available',
  error: 'Could not be retrieved',
  not_supported: 'Not supported',
};

/** What each state means, carried in the serialized evidence itself -- not left to prompt instructions alone. */
export const CONTEXT_STATE_MEANINGS: Record<ContextDataState, string> = {
  available: 'Evidence was obtained and is complete for the stated scope and period.',
  partial: 'Only part of the requested evidence was obtained. Do not present it as complete; state what is missing.',
  unavailable: 'No evidence exists for this. This is NOT zero, none, empty, unchanged, or "no findings".',
  error: 'Collection was attempted and failed. This is missing data -- NOT zero, none, empty, unchanged, or "no findings".',
  not_supported: 'DevControl has no source for this. This is NOT zero, none, empty, unchanged, or "no findings".',
};

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

/**
 * Where/how a value that exists originated.
 *   actual    = observed directly from the authoritative source (e.g. an
 *               AWS Cost Explorer result, including a real $0 or a net
 *               negative credit total)
 *   estimated = DevControl's estimate, not an observed value (e.g. an
 *               inventory list-price monthly run-rate) -- never "AWS spend"
 *   derived   = calculated by DevControl from other evidence (listed in
 *               derivedFrom); not "actual" even when every input was actual
 */
export type EvidenceProvenance = 'actual' | 'estimated' | 'derived';

/**
 * The provenance a single spend figure can have today: an AWS Cost Explorer
 * result or DevControl's inventory estimate. Shared by the cost code paths
 * (aws-cost.service, system-intelligence, weekly summary, dashboard stats)
 * so they cannot drift from EvidenceProvenance.
 */
export type SpendProvenance = Extract<EvidenceProvenance, 'actual' | 'estimated'>;

export const PROVENANCE_MEANINGS: Record<EvidenceProvenance, string> = {
  actual: 'Observed directly from the stated source.',
  estimated: 'An estimate made by DevControl -- not an observed or billed value. Say it is an estimate.',
  derived: 'Calculated by DevControl from the evidence listed in derivedFrom -- not itself observed. Say it is calculated.',
};

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

/**
 * Scope of a Cost Explorer figure, exactly as the current query establishes
 * it (aws-cost.service.ts fetchMonthlyCosts()/fetchCostTrend(): one
 * GetCostAndUsage call under the connected IAM role, grouped by SERVICE, with
 * no Filter). Deliberately does NOT claim the figure covers one AWS account:
 * with no LINKED_ACCOUNT filter the result is the role account's whole
 * billing scope, and DevControl does not detect whether that account is a
 * management/payer account whose billing scope spans linked accounts.
 */
export interface CostExplorerScope {
  kind: 'cost_explorer';
  /** aws_accounts.account_id of the connected role the call runs under; null if it couldn't be read. */
  connectedAccountId: string | null;
  /** The query is never narrowed to a single linked account. */
  linkedAccountFilter: 'none';
  /** Whether the billing scope is consolidated across linked accounts -- not detected. */
  consolidatedBilling: 'unknown';
  /** The query has no region filter. */
  regions: 'all';
}

/**
 * Scope of DevControl's resource inventory (aws_resources), and so of any
 * figure derived from it: discovery runs under the connected role, in the
 * single region stored on aws_accounts (AWSClientFactory.createClients()),
 * plus services listed account-wide (e.g. S3). Never the same scope as
 * CostExplorerScope.
 */
export interface InventoryScope {
  kind: 'resource_inventory';
  /** aws_accounts.account_id of the connected role; null if it couldn't be read. */
  connectedAccountId: string | null;
  /** aws_accounts.region -- the one region discovery runs in; null if it couldn't be read. */
  discoveryRegion: string | null;
}

/** Data about one organization over a rolling window (e.g. deployment records). */
export interface OrganizationWindowScope {
  kind: 'organization';
  /** The window the data covers, e.g. 'last 30 days'. */
  window: string;
}

/**
 * What a section covers. A new source with a genuinely new scope adds a
 * member here (with a distinct `kind`); it never reuses a scope whose
 * meaning differs -- billing scope and inventory scope stay distinct.
 */
export type ContextScope = CostExplorerScope | InventoryScope | OrganizationWindowScope;

// ---------------------------------------------------------------------------
// Period, completeness, derivation
// ---------------------------------------------------------------------------

/**
 * The time the evidence represents (distinct from asOf, which is when it was
 * obtained).
 *   range         = a bounded period; end is exclusive (the Cost Explorer
 *                   convention). Dates as YYYY-MM-DD or ISO timestamps.
 *   rolling       = a trailing window described in words, e.g. 'last 30 days'
 *   point_in_time = the state of things as of asOf (an inventory snapshot, a
 *                   monthly run-rate estimate) -- not a billed period
 */
export type EvidencePeriod =
  | { kind: 'range'; start: string; endExclusive: string }
  | { kind: 'rolling'; window: string }
  | { kind: 'point_in_time' };

/**
 * How much of the requested evidence was actually obtained, in countable
 * units (days, resources, accounts, regions...). Gaps are reported, never
 * filled: `missing` lists what is absent when known, and no synthetic
 * observation is ever added to make received equal expected.
 */
export interface EvidenceCompleteness {
  unit: string;
  expected: number;
  received: number;
  /** The specific missing items (e.g. dates) when known; null when not itemized. */
  missing: string[] | null;
}

/** One input a derived value was calculated from. */
export interface EvidenceReference {
  source: string;
  state: ContextDataState;
  provenance: EvidenceProvenance | null;
  scope: ContextScope | null;
  period: EvidencePeriod | null;
  asOf: string | null;
}

// ---------------------------------------------------------------------------
// ContextSection
// ---------------------------------------------------------------------------

export interface ContextSection<T> {
  state: ContextDataState;
  /** The authoritative origin of the data, in words the model can repeat. */
  source: string;
  /** How the data originated; null whenever there is no data (state is not available/partial) or it isn't stated. */
  provenance: EvidenceProvenance | null;
  /** When the underlying data was observed or generated; null if unknown. */
  asOf: string | null;
  scope: ContextScope | null;
  /** The time the data represents; null if not applicable or unknown. */
  period: EvidencePeriod | null;
  /** Structured count of what was requested vs obtained; null if not applicable. */
  completeness: EvidenceCompleteness | null;
  /** What was actually queried or discovered, and what was not, in words. */
  coverage: string | null;
  /** Why the data is not (fully) available, or a caveat on data that is. */
  reason: string | null;
  /** For provenance 'derived': the evidence it was calculated from. */
  derivedFrom: EvidenceReference[] | null;
  /** Present only when state is 'available' or 'partial'. */
  data: T | null;
}

/** How a section is described before its getter runs. */
export interface SectionMeta {
  source: string;
  provenance?: EvidenceProvenance | null;
  asOf?: string | null;
  scope?: ContextScope | null;
  period?: EvidencePeriod | null;
  coverage?: string | null;
}

interface SectionResultMeta {
  asOf?: string | null;
  coverage?: string | null;
  period?: EvidencePeriod | null;
  completeness?: EvidenceCompleteness | null;
}

/** What a getter that ran successfully found. */
export type SectionResult<T> =
  | (SectionResultMeta & { state: 'available' | 'partial'; data: T; provenance?: EvidenceProvenance | null; reason?: string | null })
  | (SectionResultMeta & { state: 'unavailable'; reason: string });

/** True when the section actually carries evidence (available or partial, with data). */
export function hasEvidence<T>(section: ContextSection<T>): section is ContextSection<T> & { data: T; state: 'available' | 'partial' } {
  return (section.state === 'available' || section.state === 'partial') && section.data !== null;
}

function validateCompleteness(c: EvidenceCompleteness): void {
  const counts = [c.expected, c.received];
  if (!counts.every(n => Number.isInteger(n) && n >= 0) || c.received > c.expected) {
    throw new Error(`invalid completeness: received ${c.received} of expected ${c.expected} ${c.unit}`);
  }
}

function describeCompleteness(c: EvidenceCompleteness): string {
  const missing = c.missing && c.missing.length > 0 ? ` (missing: ${c.missing.join(', ')})` : '';
  return `${c.received} of ${c.expected} ${c.unit} obtained${missing}`;
}

function errorSection<T>(meta: SectionMeta, error: unknown): ContextSection<T> {
  // The raw failure can carry SQL, database, or AWS detail: server log only.
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[AI Context] ${meta.source} could not be retrieved:`, message);
  return {
    state: 'error',
    source: meta.source,
    provenance: null,
    asOf: null,
    scope: meta.scope ?? null,
    period: meta.period ?? null,
    completeness: null,
    coverage: null,
    reason: `${meta.source} could not be retrieved.`,
    derivedFrom: null,
    data: null,
  };
}

/**
 * Runs one getter and returns its section. A getter that throws becomes
 * state 'error' with data null -- never [], {}, 0, or an apparently valid
 * empty result. The raw failure (which can carry SQL, database, or
 * infrastructure detail) goes to the server log only; the section's reason is
 * a safe diagnostic, since sections reach both the model and the
 * authenticated GET /api/ai-chat/context response.
 *
 * A result claiming 'available' while its completeness shows missing units is
 * recorded as 'partial': incomplete evidence never reads as complete.
 */
export async function collectSection<T>(
  meta: SectionMeta,
  getter: () => Promise<SectionResult<T>>
): Promise<ContextSection<T>> {
  try {
    const result = await getter();
    const completeness = result.completeness ?? null;
    if (completeness) validateCompleteness(completeness);

    const incomplete = completeness !== null && completeness.received < completeness.expected;
    const state = result.state === 'available' && incomplete ? 'partial' : result.state;
    const reason = result.reason ?? (state === 'partial' && completeness ? describeCompleteness(completeness) : null);
    const hasData = result.state !== 'unavailable';

    return {
      state,
      source: meta.source,
      provenance: hasData ? (result.provenance !== undefined ? result.provenance : meta.provenance ?? null) : null,
      asOf: result.asOf !== undefined ? result.asOf : meta.asOf ?? null,
      scope: meta.scope ?? null,
      period: result.period !== undefined ? result.period : meta.period ?? null,
      completeness,
      coverage: result.coverage !== undefined ? result.coverage : meta.coverage ?? null,
      reason,
      derivedFrom: null,
      data: hasData ? result.data : null,
    };
  } catch (error: unknown) {
    return errorSection<T>(meta, error);
  }
}

/** A section DevControl has no connected source for -- never a zero or an empty list. */
export function notSupported<T>(meta: SectionMeta, reason: string): ContextSection<T> {
  return {
    state: 'not_supported',
    source: meta.source,
    provenance: null,
    asOf: null,
    scope: meta.scope ?? null,
    period: meta.period ?? null,
    completeness: null,
    coverage: null,
    reason,
    derivedFrom: null,
    data: null,
  };
}

function referenceTo(section: ContextSection<unknown>): EvidenceReference {
  return {
    source: section.source,
    state: section.state,
    provenance: section.provenance,
    scope: section.scope,
    period: section.period,
    asOf: section.asOf,
  };
}

/**
 * A value calculated from other sections (a comparison, a delta, a share, a
 * forecast). compute() runs only when every input actually carries evidence;
 * otherwise the result is 'unavailable' naming each missing input -- so an
 * unavailable or failed input can never become 0, "0%", or "flat". If any
 * input is partial, so is the result. Provenance is 'derived' (or 'estimated'
 * for projections), never 'actual', and derivedFrom records every input's
 * provenance, scope, and period.
 */
export async function deriveSection<T, Inputs extends readonly ContextSection<any>[]>(
  meta: SectionMeta & { provenance?: Extract<EvidenceProvenance, 'derived' | 'estimated'> },
  inputs: Inputs,
  compute: (inputData: { [K in keyof Inputs]: Inputs[K] extends ContextSection<infer D> ? D : never }) => T | Promise<T>
): Promise<ContextSection<T>> {
  const derivedFrom = inputs.map(referenceTo);
  const provenance = meta.provenance ?? 'derived';

  const missing = inputs.filter(input => !hasEvidence(input));
  if (missing.length > 0) {
    return {
      state: 'unavailable',
      source: meta.source,
      provenance: null,
      asOf: null,
      scope: meta.scope ?? null,
      period: meta.period ?? null,
      completeness: null,
      coverage: null,
      reason: `cannot be calculated: ${missing.map(m => `${m.source}: ${CONTEXT_STATE_LABELS[m.state].toLowerCase()}`).join('; ')}`,
      derivedFrom,
      data: null,
    };
  }

  try {
    const data = await compute(inputs.map(input => input.data) as any);
    const partialInputs = inputs.filter(input => input.state === 'partial');
    return {
      state: partialInputs.length > 0 ? 'partial' : 'available',
      source: meta.source,
      provenance,
      asOf: meta.asOf ?? null,
      scope: meta.scope ?? null,
      period: meta.period ?? null,
      completeness: null,
      coverage: meta.coverage ?? null,
      reason: partialInputs.length > 0
        ? `calculated from partial evidence: ${partialInputs.map(p => p.source).join('; ')}`
        : null,
      derivedFrom,
      data,
    };
  } catch (error: unknown) {
    return { ...errorSection<T>(meta, error), derivedFrom };
  }
}

// ---------------------------------------------------------------------------
// Detector outcomes (data, not state)
// ---------------------------------------------------------------------------

/**
 * What a detector/evaluation concluded. This is section DATA: an available
 * section whose detector found nothing ({ outcome: 'no_candidate_identified' })
 * is a real finding, while an unavailable/error/not_supported section means
 * the detector's conclusion is unknown.
 */
export type DetectorOutcome = 'candidate_identified' | 'no_candidate_identified' | 'insufficient_data' | 'error';

export type DetectorResult<C> =
  | { outcome: 'candidate_identified'; candidates: C[]; reason: null }
  | { outcome: 'no_candidate_identified'; candidates: []; reason: null }
  | { outcome: 'insufficient_data' | 'error'; candidates: []; reason: string };

/** The result of a detector that ran to completion over its whole input. */
export function completedDetection<C>(candidates: C[]): DetectorResult<C> {
  return candidates.length > 0
    ? { outcome: 'candidate_identified', candidates, reason: null }
    : { outcome: 'no_candidate_identified', candidates: [], reason: null };
}

/** A detector that ran but could not reach a conclusion. `reason` must be customer-safe. */
export function inconclusiveDetection<C>(outcome: 'insufficient_data' | 'error', reason: string): DetectorResult<C> {
  return { outcome, candidates: [], reason };
}

/**
 * Whether "no <candidate> was identified" may be stated as fact: only when
 * the section is fully available AND its detector completed AND found none.
 * Never for partial, unavailable, error, or not_supported sections, and never
 * for insufficient_data/error outcomes.
 */
export function canClaimNoCandidate(section: ContextSection<DetectorResult<unknown>>): boolean {
  return section.state === 'available' && section.data?.outcome === 'no_candidate_identified';
}

// ---------------------------------------------------------------------------
// Model input
// ---------------------------------------------------------------------------

/**
 * Deterministic, model-facing form of a section: every field always present
 * (null when absent), in a fixed order, with the meaning of its state and
 * provenance carried alongside the values -- so "unavailable" can't be read
 * as zero and "partial" can't be read as complete even without the prompt's
 * instructions.
 */
export interface ModelEvidence<T> {
  contractVersion: number;
  state: ContextDataState;
  status: string;
  stateMeaning: string;
  evidencePresent: boolean;
  provenance: EvidenceProvenance | null;
  provenanceMeaning: string | null;
  source: string;
  scope: ContextScope | null;
  period: EvidencePeriod | null;
  asOf: string | null;
  completeness: (EvidenceCompleteness & { complete: boolean }) | null;
  coverage: string | null;
  reason: string | null;
  derivedFrom: EvidenceReference[] | null;
  data: T | null;
}

export function toModelEvidence<T>(section: ContextSection<T>): ModelEvidence<T> {
  const present = hasEvidence(section);
  return {
    contractVersion: AI_CONTEXT_CONTRACT_VERSION,
    state: section.state,
    status: CONTEXT_STATE_LABELS[section.state],
    stateMeaning: CONTEXT_STATE_MEANINGS[section.state],
    evidencePresent: present,
    provenance: present ? section.provenance : null,
    provenanceMeaning: present && section.provenance ? PROVENANCE_MEANINGS[section.provenance] : null,
    source: section.source,
    scope: section.scope,
    period: section.period,
    asOf: section.asOf,
    completeness: section.completeness
      ? { ...section.completeness, complete: section.completeness.received === section.completeness.expected }
      : null,
    coverage: section.coverage,
    reason: section.reason,
    derivedFrom: section.derivedFrom,
    data: present ? section.data : null,
  };
}

/**
 * Reusable claim rules for any AI consumer of ModelEvidence. The structured
 * evidence already carries these semantics; this states them once so each
 * surface doesn't write its own variant.
 */
export const EVIDENCE_CLAIM_RULES = [
  'Only make factual claims supported by the supplied evidence.',
  'Attribute every figure to its source, scope, and period, e.g. "The available AWS Cost Explorer data shows...".',
  'A section whose evidencePresent is false has no data: never describe it as zero, none, empty, unchanged, flat, or "no findings" -- say it is not available and why.',
  'A partial section is incomplete: say what is missing (completeness/coverage/reason) and never present it as complete.',
  'Provenance "estimated" is an estimate, not billed or observed spend; "derived" is calculated by DevControl, not observed.',
  'State that nothing was found (e.g. "no recommendation was identified") only when the section is available and its outcome is no_candidate_identified.',
].join('\n');

// ---------------------------------------------------------------------------
// Tenant identity and fingerprinting
// ---------------------------------------------------------------------------

/**
 * Fail closed on a missing organization. The id must come from the
 * authenticated server-side context (req.user.organizationId) -- never a
 * client-supplied value, a default, or a fallback tenant.
 */
export function requireOrganizationId(organizationId: unknown, consumer: string, purpose: string): string {
  if (typeof organizationId !== 'string' || organizationId.trim() === '') {
    throw new Error(`[${consumer}] organizationId is required for ${purpose}`);
  }
  return organizationId;
}

/** JSON with object keys sorted at every level, so equal evidence always hashes equally. */
function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.keys(v).sort().reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = (v as Record<string, unknown>)[k];
        return acc;
      }, {});
    }
    return v;
  });
}

/**
 * Stable identity of one organization's evidence under one contract (and
 * optionally prompt) version -- the input a cache key for AI output built
 * from this evidence must include. Prefixed with the contract version so a
 * shape change is visible in the key itself. Includes asOf, so output that
 * cites "as of" time is not reused after the evidence is re-obtained.
 */
export function evidenceFingerprint(input: {
  organizationId: string;
  sections: Record<string, ContextSection<unknown>>;
  promptVersion?: string | null;
  contractVersion?: number;
}): string {
  const organizationId = requireOrganizationId(input.organizationId, 'AI Context', 'an evidence fingerprint');
  const contractVersion = input.contractVersion ?? AI_CONTEXT_CONTRACT_VERSION;
  const sections = Object.fromEntries(
    Object.entries(input.sections).map(([name, section]) => [name, { ...toModelEvidence(section), contractVersion }])
  );
  const digest = createHash('sha256')
    .update(stableStringify({ contractVersion, organizationId, promptVersion: input.promptVersion ?? null, sections }))
    .digest('hex');
  return `v${contractVersion}:${digest}`;
}
