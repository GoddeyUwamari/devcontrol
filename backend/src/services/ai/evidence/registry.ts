/**
 * The shared evidence registry (AI truth PR 2, step1 §2.1-§2.5).
 *
 * Providers are registered additively: each has a stable id and a version, and
 * a duplicate id is refused. collectEvidence() runs every registered provider
 * for one authenticated organization -- one failed provider never affects the
 * others -- and returns a bundle with every provider's section, so every
 * context can state every source's state. Which providers' data reaches the
 * model is decided by the topics selected and the size budget, never by
 * leaving a provider out.
 *
 * Per provider, the wrapper here (collectProvider) does what is the same for
 * every source:
 *   1. plan entitlement first (entitlement.ts): below the required plan the
 *      section is 'not_entitled' and collect() is never called; a plan that
 *      cannot be read fails closed ('error', nothing read);
 *   2. a timeout: collect() that has not finished is 'error' / 'timeout';
 *   3. a throw is 'error' with a safe failure code, never raw text;
 *   4. retrievedAt, classification and the other contract fields are set;
 *   5. the provider's freshness rule: data older than it is 'stale'.
 */
import {
  classificationFromProvenance,
  CONTEXT_DATA_STATES,
  errorSection,
  notEntitled,
  requireOrganizationId,
  stateCarriesData,
  type ContextSection,
  type EvidenceFreshness,
} from '../../ai-context-contract';
import { PLAN_ENTITLEMENTS } from '../../../config/plan-entitlements';
import { applyBudget } from './budget';
import { createEvidenceBasis, type EvidenceBasis } from './basis';
import { entitlementFor, NOT_ENTITLED_REASON, type EntitlementCheck } from './entitlement';
import type { EvidenceBundle, EvidenceTopic, ProviderContext, ProviderDefinition, ProviderResult } from './types';

export const DEFAULT_PROVIDER_TIMEOUT_MS = 10_000;

const PROVIDER_ID = /^[a-z]+(\.[a-z_]+)+$/;

export class EvidenceRegistry {
  private readonly providers: ProviderDefinition[] = [];
  private readonly byId = new Map<string, ProviderDefinition>();

  /** Adds a provider. A duplicate id, a bad version or an unknown plan key is refused. */
  register<T>(definition: ProviderDefinition<T>): this {
    const d = definition as ProviderDefinition;
    if (!PROVIDER_ID.test(d.id)) throw new Error(`evidence provider id "${d.id}" must look like "area.name"`);
    if (this.byId.has(d.id)) throw new Error(`evidence provider "${d.id}" is already registered`);
    if (!Number.isInteger(d.version) || d.version < 1) throw new Error(`evidence provider "${d.id}" needs a positive integer version`);
    if (d.dataSourceIds.length === 0) throw new Error(`evidence provider "${d.id}" must name the data sources it covers`);
    if (d.topics.length === 0) throw new Error(`evidence provider "${d.id}" must name at least one topic`);
    if (!(d.maxTokens > 0)) throw new Error(`evidence provider "${d.id}" needs a positive maxTokens`);
    if (d.entitlementKey !== undefined && !(d.entitlementKey in PLAN_ENTITLEMENTS)) {
      throw new Error(`evidence provider "${d.id}" names plan entitlement "${d.entitlementKey}", which is not in PLAN_ENTITLEMENTS`);
    }
    this.providers.push(d);
    this.byId.set(d.id, d);
    return this;
  }

  /** In registration order (the order every context lists them in). */
  list(): readonly ProviderDefinition[] {
    return this.providers;
  }

  get(id: string): ProviderDefinition | undefined {
    return this.byId.get(id);
  }

  definitions(): ReadonlyMap<string, ProviderDefinition> {
    return this.byId;
  }
}

class EvidenceTimeoutError extends Error {
  constructor(providerId: string) {
    super(`evidence provider ${providerId} timed out`);
    this.name = 'EvidenceTimeoutError';
  }
}

function freshnessOf(definition: ProviderDefinition, section: ContextSection<unknown>, retrievedAt: Date): EvidenceFreshness {
  const asOf = section.asOf ? Date.parse(section.asOf) : NaN;
  const ageSeconds = Number.isFinite(asOf) ? Math.max(0, Math.round((retrievedAt.getTime() - asOf) / 1000)) : null;
  return definition.freshness
    ? { maxAgeSeconds: definition.freshness.maxAgeSeconds, ageSeconds, rule: definition.freshness.rule }
    : { maxAgeSeconds: null, ageSeconds, rule: 'no age limit for this source' };
}

/** The contract fields every provider section carries, whatever collect() set. */
function normalize<T>(definition: ProviderDefinition, section: ContextSection<T>, retrievedAt: Date): ContextSection<T> {
  if (!CONTEXT_DATA_STATES.includes(section.state)) {
    return errorSection<T>({ source: definition.source }, new Error(`unknown evidence state from ${definition.id}`));
  }
  const freshness = freshnessOf(definition, section, retrievedAt);
  const carriesData = stateCarriesData(section.state) && section.data !== null;
  const tooOld = carriesData && freshness.maxAgeSeconds !== null && freshness.ageSeconds !== null && freshness.ageSeconds > freshness.maxAgeSeconds;
  return {
    ...section,
    state: tooOld ? 'stale' : section.state,
    reason: tooOld
      ? `as of ${section.asOf}, older than ${freshness.rule}${section.reason ? `; ${section.reason.replace(/\.$/, '')}` : ''}`
      : section.reason,
    retrievedAt: retrievedAt.toISOString(),
    freshness,
    classification: carriesData ? section.classification ?? classificationFromProvenance(section.provenance) : null,
    untrusted: carriesData ? section.untrusted ?? [] : [],
    failure: section.state === 'error' ? section.failure ?? { code: 'internal', retryable: false } : null,
    truncation: section.truncation ?? null,
  };
}

/** One provider, wrapped (see the file header). Never throws. */
export async function collectProvider<T>(
  definition: ProviderDefinition<T>,
  ctx: Omit<ProviderContext, 'signal'>,
  entitlement: EntitlementCheck = entitlementFor
): Promise<ContextSection<T>> {
  const d = definition as ProviderDefinition;
  const meta = { source: d.source };

  if (d.entitlementKey) {
    let entitled: boolean;
    try {
      entitled = await entitlement(ctx.organizationId, d.entitlementKey);
    } catch (error: unknown) {
      // The plan could not be read: fail closed -- nothing is read.
      return normalize(d, errorSection<T>(meta, error), ctx.now);
    }
    if (!entitled) return normalize(d, notEntitled<T>(meta, NOT_ENTITLED_REASON), ctx.now);
  }

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new EvidenceTimeoutError(d.id));
    }, d.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS);
  });
  const work = Promise.resolve().then(() => definition.collect({ ...ctx, signal: controller.signal }));
  // A late rejection after the timeout is expected; it must not surface as unhandled.
  work.catch(() => undefined);
  timeout.catch(() => undefined);

  try {
    const section = await Promise.race([work, timeout]);
    return normalize(d, section, ctx.now);
  } catch (error: unknown) {
    return normalize(d, errorSection<T>(meta, error), ctx.now);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface CollectOptions {
  organizationId: string;
  /** For the selection log line only. */
  consumer: string;
  /** Data is loaded for providers matching any topic or listed id; neither = priority 1. */
  select?: { topics?: readonly EvidenceTopic[]; providerIds?: readonly string[] };
  /** Total evidence budget, in estimated tokens. */
  budgetTokens: number;
  /** The period for period-based providers (end exclusive); default the last 30 days. */
  period?: { from: string; to: string };
  now?: Date;
  /** A basis already used by the consumer, so shared reads happen once. */
  basis?: EvidenceBasis;
  entitlement?: EntitlementCheck;
}

function defaultPeriod(now: Date): { from: string; to: string } {
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return { from: day(new Date(to.getTime() - 30 * 86_400_000)), to: day(to) };
}

function isSelected(d: ProviderDefinition, select: CollectOptions['select']): boolean {
  const topics = select?.topics ?? [];
  const ids = select?.providerIds ?? [];
  if (topics.length === 0 && ids.length === 0) return d.priority === 1;
  return ids.includes(d.id) || d.topics.some((t) => topics.includes(t));
}

/**
 * Every registered provider for one organization. The organization must be
 * the authenticated caller's; it is never taken from a request body.
 */
export async function collectEvidence(registry: EvidenceRegistry, options: CollectOptions): Promise<EvidenceBundle> {
  const organizationId = requireOrganizationId(options.organizationId, 'AI Evidence', 'evidence collection');
  const now = options.now ?? new Date();
  const basis = options.basis ?? createEvidenceBasis(organizationId);
  if (basis.organizationId !== organizationId) {
    throw new Error('[AI Evidence] the evidence basis belongs to a different organization');
  }
  const ctx = { organizationId, now, period: options.period ?? defaultPeriod(now), basis };

  const definitions = registry.list();
  const sections = await Promise.all(definitions.map((d) => collectProvider(d, ctx, options.entitlement)));
  const results: ProviderResult[] = definitions.map((d, i) => ({
    id: d.id,
    version: d.version,
    title: d.title,
    topics: d.topics,
    priority: d.priority,
    fingerprint: d.fingerprint ?? 'full',
    section: sections[i],
    selected: isSelected(d, options.select),
    mode: 'header',
  }));

  const budgeted = applyBudget(results, registry.definitions(), options.budgetTokens);
  const bundle: EvidenceBundle = {
    organizationId,
    retrievedAt: now.toISOString(),
    results: budgeted.results,
    topics: [...(options.select?.topics ?? [])],
    budget: { totalTokens: options.budgetTokens, usedTokens: budgeted.usedTokens },
  };

  // Ids, states and load modes only: never data, reasons or the question.
  console.log('[AI Evidence]', JSON.stringify({
    consumer: options.consumer,
    topics: bundle.topics,
    providers: bundle.results.map((r) => ({ id: r.id, state: r.section.state, mode: r.mode })),
    usedTokens: bundle.budget.usedTokens,
  }));
  return bundle;
}

/** One provider in a bundle summary: its id, state, fixed reason, source, as-of and counts. Never data or free text. */
export interface ProviderSummary {
  id: string;
  state: ContextSection<unknown>['state'];
  reason: string | null;
  source: string;
  asOf: string | null;
  /** Items kept and total, when the provider or the budget already counted them; else null. */
  counts: { kept: number; total: number } | null;
}

/**
 * A bundle as a small per-provider summary, for a response body (GET
 * /api/ai-chat/context). No evidence data, no untrusted (AWS or customer)
 * text, no pre-budget copy: only what DevControl's own code wrote.
 */
export function summarizeBundle(bundle: EvidenceBundle): { retrievedAt: string; providers: ProviderSummary[] } {
  return {
    retrievedAt: bundle.retrievedAt,
    providers: bundle.results.map((r) => ({
      id: r.id,
      state: r.section.state,
      reason: r.section.reason ?? null,
      source: r.section.source,
      asOf: r.section.asOf ?? null,
      counts: r.section.truncation ? { kept: r.section.truncation.kept, total: r.section.truncation.total } : null,
    })),
  };
}

/** A provider's section from a bundle; throws if the id is not registered (a programming error). */
export function sectionOf<T>(bundle: EvidenceBundle, id: string): ContextSection<T> {
  const result = bundle.results.find((r) => r.id === id);
  if (!result) throw new Error(`[AI Evidence] no provider "${id}" in this bundle`);
  return result.section as ContextSection<T>;
}

/**
 * The sections to fingerprint for a cache of AI output built from a bundle,
 * keyed by provider id and version:
 *   - a provider whose data was loaded: its whole section, except asOf for a
 *     'state_and_data' provider (a live read or a figure computed at read
 *     time, whose asOf is the read itself), and never its freshness age;
 *   - a provider listed by its line only: its state and source, since its
 *     data did not reach the model.
 * Any change in a loaded provider's state, data, reason or (full) asOf, or in
 * any provider's state, changes the fingerprint.
 */
export function fingerprintSections(bundle: EvidenceBundle): Record<string, ContextSection<unknown>> {
  return Object.fromEntries(bundle.results.map((r): [string, ContextSection<unknown>] => {
    const key = `${r.id}@${r.version}`;
    if (r.mode === 'header') {
      return [key, { ...r.section, asOf: null, data: null, reason: null, coverage: null, completeness: null, untrusted: [], freshness: null, truncation: r.section.truncation }];
    }
    return [key, r.fingerprint === 'state_and_data' ? { ...r.section, asOf: null, freshness: null } : { ...r.section, freshness: null }];
  }));
}
