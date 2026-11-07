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
 * covers (scope, period), when it was obtained (asOf) and read (retrievedAt),
 * how fresh it is (freshness), how much of the requested evidence was
 * actually obtained (completeness/coverage), how it is classified
 * (classification), why it failed (failure, a safe code), what was left out
 * by a size cap (truncation), and which AWS or customer free text it carries
 * (untrusted -- kept out of `data`).
 *
 * Version 2 (AI truth PR 2) adds the states not_built, not_connected,
 * not_entitled and stale, and the fields above. The shared evidence registry
 * (services/ai/evidence/) builds every AI surface's sections on this file.
 */

import { createHash } from 'crypto';
import { isAccessDeniedError, isThrottlingError } from '../utils/awsCallPolicy';

/**
 * Version of the serialized evidence shape (toModelEvidence() /
 * evidenceFingerprint()). Bump it whenever that shape or the meaning of a
 * field changes, so cached AI output or cached context produced under an
 * older shape is detectably stale instead of being read under the new one.
 */
export const AI_CONTEXT_CONTRACT_VERSION = 2;

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
 *                   (kept for existing sections; the registry uses the two
 *                   states it splits into below)
 *   not_built     = DevControl has no product source for this at all
 *   not_connected = the source exists but needs setup (e.g. no AWS account)
 *   not_entitled  = the organization's plan does not include this source;
 *                   nothing was read
 *   stale         = collected and complete for an older time than the
 *                   source's freshness rule allows; the data is kept, never
 *                   presented as current
 *
 * "Empty" is not a state: a real zero is 'available' with an empty data set
 * and an explicit outcome; 'unavailable' means there was nothing to collect.
 */
export type ContextDataState =
  | 'available'
  | 'partial'
  | 'unavailable'
  | 'error'
  | 'not_supported'
  | 'not_built'
  | 'not_connected'
  | 'not_entitled'
  | 'stale';

export const CONTEXT_DATA_STATES: readonly ContextDataState[] = [
  'available', 'partial', 'stale', 'unavailable', 'not_connected', 'error', 'not_entitled', 'not_built', 'not_supported',
];

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
  not_built: 'Not provided by DevControl yet',
  not_connected: 'Not connected',
  not_entitled: 'Not included in this plan',
  stale: 'Out of date',
};

/** What each state means, carried in the serialized evidence itself -- not left to prompt instructions alone. */
export const CONTEXT_STATE_MEANINGS: Record<ContextDataState, string> = {
  available: 'Evidence was obtained and is complete for the stated scope and period.',
  partial: 'Only part of the requested evidence was obtained. Do not present it as complete; state what is missing.',
  unavailable: 'No evidence exists for this. This is NOT zero, none, empty, unchanged, or "no findings".',
  error: 'Collection was attempted and failed. This is missing data -- NOT zero, none, empty, unchanged, or "no findings".',
  not_supported: 'DevControl has no source for this. This is NOT zero, none, empty, unchanged, or "no findings".',
  not_built: 'DevControl does not provide this yet. Never say none were found, and never offer it as something DevControl can do.',
  not_connected: 'The source needs setup before DevControl can read it (for example, no AWS account is connected). This is NOT zero or none.',
  not_entitled: "The organization's plan does not include this, so it was not read. This is NOT \"no data\", zero, or none.",
  stale: 'The data is older than this source\'s freshness rule allows. State its as-of time; never present it as current.',
};

/** States whose section carries data (stale data is kept, labeled out of date). */
export function stateCarriesData(state: ContextDataState): boolean {
  return state === 'available' || state === 'partial' || state === 'stale';
}

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
// Classification (A-D2; replaces provenance, which stays as a derived alias
// for one release)
// ---------------------------------------------------------------------------

/**
 * What kind of fact a section's data is.
 *   billed            = an amount AWS billed (Cost Explorer)
 *   measured          = observed from the source (an inventory record, a
 *                       CloudWatch datapoint, an alarm state, a check result)
 *   calculated        = computed by DevControl from other evidence (a score,
 *                       a comparison, a rate)
 *   estimated         = DevControl's estimate (a list-price run-rate, a
 *                       savings estimate); never billed or realized
 *   configured        = a setting the customer or AWS configuration holds
 *   customer_decision = a decision a person recorded (accepted risk,
 *                       dismissed, resolved)
 * "General knowledge" is not a classification: it is never evidence.
 */
export type EvidenceClassification = 'billed' | 'measured' | 'calculated' | 'estimated' | 'configured' | 'customer_decision';

export const EVIDENCE_CLASSIFICATIONS: readonly EvidenceClassification[] = [
  'billed', 'measured', 'calculated', 'estimated', 'configured', 'customer_decision',
];

export const CLASSIFICATION_MEANINGS: Record<EvidenceClassification, string> = {
  billed: 'An amount AWS billed, as reported by the stated source.',
  measured: 'Observed directly from the stated source.',
  calculated: 'Calculated by DevControl from other evidence -- not itself observed. Say it is calculated.',
  estimated: 'An estimate made by DevControl -- not a billed, observed or realized value. Say it is an estimate.',
  configured: 'A configuration setting, as recorded.',
  customer_decision: 'A decision a person in this organization recorded (for example accepted risk or dismissed).',
};

/** The provenance alias of a classification (kept for one release, A-D2). */
export function provenanceFor(classification: EvidenceClassification): EvidenceProvenance {
  switch (classification) {
    case 'estimated': return 'estimated';
    case 'calculated': return 'derived';
    default: return 'actual';
  }
}

/** The classification an existing section's provenance implies when it states none. */
export function classificationFromProvenance(provenance: EvidenceProvenance | null): EvidenceClassification | null {
  if (provenance === 'estimated') return 'estimated';
  if (provenance === 'derived') return 'calculated';
  if (provenance === 'actual') return 'measured';
  return null;
}

// ---------------------------------------------------------------------------
// Freshness, failure, truncation, untrusted text
// ---------------------------------------------------------------------------

/** The source's own staleness rule, and how old this evidence is against it. */
export interface EvidenceFreshness {
  /** Older than this is 'stale'; null when the source has no age rule. */
  maxAgeSeconds: number | null;
  /** Seconds between asOf and retrievedAt; null when asOf is unknown. */
  ageSeconds: number | null;
  /** The rule in words, e.g. 'two scheduled scans (13 hours)'. */
  rule: string;
}

/**
 * Why collection failed, as a safe code. Never a raw message: SQL, database
 * and AWS error text stays in the server log.
 */
export type EvidenceFailureCode = 'timeout' | 'db_error' | 'aws_denied' | 'aws_throttled' | 'not_connected' | 'internal';

export interface EvidenceFailure {
  code: EvidenceFailureCode;
  retryable: boolean;
}

/** What a size cap left out. A capped section is never silently shortened. */
export interface EvidenceTruncation {
  kept: number;
  total: number;
  /** What capped it, e.g. 'provider_cap' or 'total_budget'. */
  by: string;
}

/**
 * AWS or customer free text (resource and alarm names, tags, finding titles,
 * customer rule titles). Kept out of `data`, which carries ids, counts, enums
 * and numbers only, and rendered to the model inside a fenced, JSON-encoded
 * block (services/ai/evidence/render.ts).
 */
export interface UntrustedText {
  field: string;
  text: string;
}

/** The safe failure code for a thrown error; the error's text is never read into it. */
export function classifyEvidenceFailure(error: unknown): EvidenceFailure {
  const e = error as { name?: unknown; code?: unknown } | null;
  const name = typeof e?.name === 'string' ? e.name : '';
  const code = typeof e?.code === 'string' ? e.code : '';
  if (name === 'AbortError' || name === 'TimeoutError' || name === 'EvidenceTimeoutError') return { code: 'timeout', retryable: true };
  if (name === 'AwsAccountNotConnectedError') return { code: 'not_connected', retryable: false };
  if (isThrottlingError(error)) return { code: 'aws_throttled', retryable: true };
  if (isAccessDeniedError(error)) return { code: 'aws_denied', retryable: false };
  // node-postgres errors carry a five-character SQLSTATE.
  if (/^[0-9A-Z]{5}$/.test(code) || name === 'DatabaseError') return { code: 'db_error', retryable: true };
  return { code: 'internal', retryable: false };
}

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
 * Account-level evidence (security groups, IAM): about the connected account
 * as a whole, not one region's resources.
 */
export interface AccountLevelScope {
  kind: 'account_level';
  connectedAccountId: string | null;
}

/** Evidence read from one region of the connected account (CloudWatch alarms, resource checks). */
export interface AccountRegionScope {
  kind: 'aws_account_region';
  connectedAccountId: string | null;
  region: string | null;
}

/**
 * The connected account's regions as DevControl last recorded them, with each
 * region's scan status. Only the connected account: DevControl reads one
 * account per organization, so no multi-account completeness is implied.
 */
export interface AccountRegionsScope {
  kind: 'aws_account_regions';
  connectedAccountId: string | null;
  homeRegion: string | null;
  regions: Array<{ region: string; status: string }>;
}

/**
 * What a section covers. A new source with a genuinely new scope adds a
 * member here (with a distinct `kind`); it never reuses a scope whose
 * meaning differs -- billing scope and inventory scope stay distinct.
 */
export type ContextScope =
  | CostExplorerScope
  | InventoryScope
  | OrganizationWindowScope
  | AccountLevelScope
  | AccountRegionScope
  | AccountRegionsScope;

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
  /** Present only when state is 'available', 'partial' or 'stale'. */
  data: T | null;
  // -- Contract version 2. Optional in the type so sections built before the
  // registry still compile; every builder in this file and every registry
  // provider sets them, and toModelEvidence() always emits them (null/[]).
  /** When DevControl read the evidence for this answer (asOf is when it was observed). */
  retrievedAt?: string | null;
  freshness?: EvidenceFreshness | null;
  classification?: EvidenceClassification | null;
  untrusted?: UntrustedText[];
  failure?: EvidenceFailure | null;
  truncation?: EvidenceTruncation | null;
}

/** How a section is described before its getter runs. */
export interface SectionMeta {
  source: string;
  provenance?: EvidenceProvenance | null;
  classification?: EvidenceClassification | null;
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
  untrusted?: UntrustedText[];
}

/**
 * What a getter that ran successfully found. An 'unavailable' result may
 * carry completeness to record what was requested vs obtained when too little
 * was obtained to use (e.g. 3 of 14 days of history) -- it stays unavailable
 * with no data; the counts are validated but never promote it.
 */
export type SectionResult<T> =
  | (SectionResultMeta & {
      state: 'available' | 'partial';
      data: T;
      provenance?: EvidenceProvenance | null;
      classification?: EvidenceClassification | null;
      reason?: string | null;
    })
  | (SectionResultMeta & { state: 'unavailable' | 'not_connected' | 'not_built'; reason: string });

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

/** The version-2 fields every builder sets; callers override what they know. */
function v2Fields(meta: SectionMeta, hasData: boolean, retrievedAt: string = new Date().toISOString()) {
  return {
    retrievedAt,
    freshness: null,
    classification: hasData ? meta.classification ?? classificationFromProvenance(meta.provenance ?? null) : null,
    untrusted: [] as UntrustedText[],
    failure: null,
    truncation: null,
  };
}

/**
 * A section whose collection failed. The raw failure can carry SQL, database,
 * or AWS detail: it goes to the server log only (its error name and message,
 * never into the section); the section gets a safe failure code.
 */
export function errorSection<T>(meta: SectionMeta, error: unknown): ContextSection<T> {
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
    ...v2Fields(meta, false),
    failure: classifyEvidenceFailure(error),
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
    const withData = result.state === 'available' || result.state === 'partial' ? result : null;

    // Classification decides; provenance is its alias (A-D2). A section that
    // states only provenance gets the classification that provenance implies.
    const classification = withData
      ? withData.classification ?? meta.classification ?? classificationFromProvenance(
          withData.provenance !== undefined ? withData.provenance : meta.provenance ?? null)
      : null;
    const statedProvenance = withData ? (withData.provenance !== undefined ? withData.provenance : meta.provenance ?? null) : null;
    const provenance = withData
      ? (withData.classification ?? meta.classification) ? provenanceFor(classification as EvidenceClassification) : statedProvenance
      : null;

    return {
      state,
      source: meta.source,
      provenance,
      asOf: result.asOf !== undefined ? result.asOf : meta.asOf ?? null,
      scope: meta.scope ?? null,
      period: result.period !== undefined ? result.period : meta.period ?? null,
      completeness,
      coverage: result.coverage !== undefined ? result.coverage : meta.coverage ?? null,
      reason,
      derivedFrom: null,
      data: withData ? withData.data : null,
      ...v2Fields(meta, false),
      classification,
      untrusted: withData ? result.untrusted ?? [] : [],
    };
  } catch (error: unknown) {
    return errorSection<T>(meta, error);
  }
}

/** A section with no data in one of the no-data states, with its reason. */
function noDataSection<T>(state: 'not_supported' | 'not_built' | 'not_connected' | 'not_entitled', meta: SectionMeta, reason: string): ContextSection<T> {
  return {
    state,
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
    ...v2Fields(meta, false),
  };
}

/** A section DevControl has no connected source for -- never a zero or an empty list. */
export function notSupported<T>(meta: SectionMeta, reason: string): ContextSection<T> {
  return noDataSection('not_supported', meta, reason);
}

/** DevControl has no product source for this yet -- never "none found". */
export function notBuilt<T>(meta: SectionMeta, reason: string): ContextSection<T> {
  return noDataSection('not_built', meta, reason);
}

/** The source exists but needs setup first (e.g. no connected AWS account). */
export function notConnected<T>(meta: SectionMeta, reason: string): ContextSection<T> {
  return noDataSection('not_connected', meta, reason);
}

/** The plan does not include this source; nothing was read -- never "no data". */
export function notEntitled<T>(meta: SectionMeta, reason: string): ContextSection<T> {
  return noDataSection('not_entitled', meta, reason);
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
 * otherwise nothing is calculated and the result names each missing input --
 * so an unavailable or failed input can never become 0, "0%", or "flat".
 * The result's state follows its inputs, by precedence
 * error > unavailable > partial > available:
 *   - any input 'error'                         -> 'error' (a failure stays a failure)
 *   - any input 'not_entitled'                  -> 'not_entitled' (a plan gate stays one)
 *   - any other input without evidence          -> 'unavailable' (incl. stale)
 *   - any input 'partial'                       -> 'partial'
 * No inputs at all is 'unavailable': a derived value must cite its evidence.
 * Provenance is 'derived' (or 'estimated' for projections), never 'actual',
 * and derivedFrom records every input's provenance, scope, and period.
 */
export async function deriveSection<T, Inputs extends readonly ContextSection<any>[]>(
  meta: SectionMeta & { provenance?: Extract<EvidenceProvenance, 'derived' | 'estimated'> },
  inputs: Inputs,
  compute: (inputData: { [K in keyof Inputs]: Inputs[K] extends ContextSection<infer D> ? D : never }) => T | Promise<T>
): Promise<ContextSection<T>> {
  const derivedFrom = inputs.map(referenceTo);
  const provenance = meta.provenance ?? 'derived';
  const noData = (state: 'error' | 'unavailable' | 'not_entitled', reason: string): ContextSection<T> => ({
    state,
    source: meta.source,
    provenance: null,
    asOf: null,
    scope: meta.scope ?? null,
    period: meta.period ?? null,
    completeness: null,
    coverage: null,
    reason,
    derivedFrom,
    data: null,
    ...v2Fields(meta, false),
  });

  if (inputs.length === 0) {
    return noData('unavailable', 'cannot be calculated: no input sections were supplied');
  }

  const missing = inputs.filter(input => !hasEvidence(input));
  if (missing.length > 0) {
    // Input reasons are already customer-safe; only state labels are repeated here.
    // An input whose data a size cap left out says so, not its (data-carrying) state.
    const label = (m: ContextSection<unknown>) => (m.truncation && m.truncation.kept === 0 && m.data === null
      ? 'not included in this answer (too large)'
      : CONTEXT_STATE_LABELS[m.state].toLowerCase());
    const reason = `cannot be calculated: ${missing.map(m => `${m.source}: ${label(m)}`).join('; ')}`;
    // A failure stays a failure, and a plan gate stays a plan gate (never "no data").
    const state = missing.some(m => m.state === 'error') ? 'error'
      : missing.some(m => m.state === 'not_entitled') ? 'not_entitled'
      : 'unavailable';
    return noData(state, reason);
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
      ...v2Fields(meta, true),
      classification: provenance === 'estimated' ? 'estimated' : 'calculated',
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
  classification: EvidenceClassification | null;
  classificationMeaning: string | null;
  /** Alias of classification, kept for one release (A-D2). */
  provenance: EvidenceProvenance | null;
  provenanceMeaning: string | null;
  source: string;
  scope: ContextScope | null;
  period: EvidencePeriod | null;
  asOf: string | null;
  retrievedAt: string | null;
  freshness: EvidenceFreshness | null;
  completeness: (EvidenceCompleteness & { complete: boolean }) | null;
  coverage: string | null;
  reason: string | null;
  failure: EvidenceFailure | null;
  truncation: EvidenceTruncation | null;
  derivedFrom: EvidenceReference[] | null;
  data: T | null;
}

/**
 * The model-facing form. `untrusted` text is deliberately not part of it: it
 * is rendered separately inside a fenced block (services/ai/evidence/render.ts),
 * so AWS or customer text never sits beside the facts as if it were one.
 */
export function toModelEvidence<T>(section: ContextSection<T>): ModelEvidence<T> {
  const present = stateCarriesData(section.state) && section.data !== null;
  const classification = present ? section.classification ?? classificationFromProvenance(section.provenance) : null;
  return {
    contractVersion: AI_CONTEXT_CONTRACT_VERSION,
    state: section.state,
    status: CONTEXT_STATE_LABELS[section.state],
    stateMeaning: CONTEXT_STATE_MEANINGS[section.state],
    evidencePresent: present,
    classification,
    classificationMeaning: classification ? CLASSIFICATION_MEANINGS[classification] : null,
    provenance: present ? section.provenance : null,
    provenanceMeaning: present && section.provenance ? PROVENANCE_MEANINGS[section.provenance] : null,
    source: section.source,
    scope: section.scope,
    period: section.period,
    asOf: section.asOf,
    retrievedAt: section.retrievedAt ?? null,
    freshness: section.freshness ?? null,
    completeness: section.completeness
      ? { ...section.completeness, complete: section.completeness.received === section.completeness.expected }
      : null,
    coverage: section.coverage,
    reason: section.reason,
    failure: section.failure ?? null,
    truncation: section.truncation ?? null,
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
  // retrievedAt is when this request read the evidence, not part of what the
  // evidence says: it never changes the key (asOf, state and data do).
  // Untrusted text is evidence too, so it is part of the key.
  const sections = Object.fromEntries(
    Object.entries(input.sections).map(([name, section]) => [
      name,
      { ...toModelEvidence(section), contractVersion, retrievedAt: null, untrusted: section.untrusted ?? [] },
    ])
  );
  const digest = createHash('sha256')
    .update(stableStringify({ contractVersion, organizationId, promptVersion: input.promptVersion ?? null, sections }))
    .digest('hex');
  return `v${contractVersion}:${digest}`;
}
