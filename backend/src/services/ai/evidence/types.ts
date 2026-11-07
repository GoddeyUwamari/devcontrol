/**
 * The shared evidence registry's types (AI truth PR 2, step1 §2.2).
 *
 * A provider is one evidence source DevControl holds, described once: a
 * stable id and version, the data-source inventory ids it covers
 * (data-sources.ts), the question topics it answers, its budget priority and
 * cap, its plan entitlement (config/plan-entitlements.ts), its freshness rule,
 * and collect(), which returns one ContextSection (ai-context-contract.ts) --
 * the contract every AI surface already uses. There is no second contract.
 *
 * collect() decides the evidence's state; the registry wrapper adds what is
 * the same for every provider: the plan check before anything is read, the
 * timeout, the freshness check, the safe failure code, and the size budget.
 */
import type { ContextDataState, ContextSection } from '../../ai-context-contract';
import type { PlanEntitlement } from '../../../config/plan-entitlements';
import type { EvidenceBasis } from './basis';

export type EvidenceTopic =
  | 'cost'
  | 'savings'
  | 'security'
  | 'compliance'
  | 'ops'
  | 'telemetry'
  | 'delivery'
  | 'inventory'
  | 'regions';

export const EVIDENCE_TOPICS: readonly EvidenceTopic[] = [
  'cost', 'savings', 'security', 'compliance', 'ops', 'telemetry', 'delivery', 'inventory', 'regions',
];

/** What a provider is given. Everything is bound to one authenticated organization. */
export interface ProviderContext {
  organizationId: string;
  now: Date;
  /** Aborted when the registry's timeout for this provider passes. */
  signal: AbortSignal;
  /** The period a period-based provider covers; `to` is exclusive. */
  period: { from: string; to: string };
  /** Reads shared by several providers, memoized for this one collection only. */
  basis: EvidenceBasis;
}

export interface ProviderDefinition<T = unknown> {
  /** Stable id, e.g. 'security.account_findings': the key tests, logs and the model see. */
  id: string;
  /** Bump when the data shape or meaning changes; part of the evidence fingerprint. */
  version: number;
  /** Model-facing name of the source, e.g. 'Account security findings'. */
  title: string;
  /** In words the model can repeat; used when collect() never ran (plan gate, timeout). */
  source: string;
  /** Data-source inventory ids (data-sources.ts) this provider covers. */
  dataSourceIds: string[];
  topics: EvidenceTopic[];
  /** Budget order within its band: 1 first. Also the default load set when no topic matched. */
  priority: 1 | 2 | 3;
  /**
   * Budget band. 'fact': a small status section, or one a consumer formats as
   * a fact line (System Status, Top Risk, the security and health lines...).
   * 'list': a large list section (cost findings, the region list...). Every
   * 'fact' section is filled into the total budget before any 'list' section,
   * so lists are shortened or left out before a status fact is. One budget:
   * no section is exempt. Default: 'list' when the provider can summarise a
   * list, otherwise 'fact'.
   */
  budgetBand?: 'fact' | 'list';
  /** Cap on this provider's rendered evidence, in estimated tokens. */
  maxTokens: number;
  /** Plan gate: a key of PLAN_ENTITLEMENTS. Absent = no plan gate. */
  entitlementKey?: PlanEntitlement;
  /** Evidence older than this (asOf to retrievedAt) is 'stale'. */
  freshness?: { maxAgeSeconds: number; rule: string };
  /**
   * 'state_and_data': the cache fingerprint ignores asOf. For a live read that
   * is re-checked every minute (CloudWatch alarms), so the time of the check
   * alone does not regenerate cached AI output; any change in state or data does.
   */
  fingerprint?: 'full' | 'state_and_data';
  /** Milliseconds before the registry gives up on collect(); default DEFAULT_PROVIDER_TIMEOUT_MS. */
  timeoutMs?: number;
  collect(ctx: ProviderContext): Promise<ContextSection<T>>;
  /**
   * Shrinks data to at most maxItems list items. Returns null when the data
   * has nothing to shrink. Must keep counts and totals, so a summarised
   * section still states what was left out.
   */
  summarize?(data: T, maxItems: number): { data: T; kept: number; total: number } | null;
}

/** How much of a provider reached the model. A provider is never left out. */
export type LoadMode = 'loaded' | 'summarised' | 'header';

export interface ProviderResult<T = unknown> {
  id: string;
  version: number;
  title: string;
  topics: EvidenceTopic[];
  priority: 1 | 2 | 3;
  fingerprint: 'full' | 'state_and_data';
  section: ContextSection<T>;
  /** Whether this question asked for the provider's data. */
  selected: boolean;
  mode: LoadMode;
  // The section as collected, before the budget, is kept outside this object
  // (budget.ts, collectedSectionOf), so serializing a result never includes it.
}

export interface EvidenceBundle {
  organizationId: string;
  retrievedAt: string;
  /** Every registered provider, in registry order, whatever its state. */
  results: ProviderResult[];
  topics: EvidenceTopic[];
  budget: { totalTokens: number; usedTokens: number };
}

/** The per-request selection log line: provider ids and states only, never data. */
export interface SelectionPlanEntry {
  id: string;
  state: ContextDataState;
  mode: LoadMode;
}
