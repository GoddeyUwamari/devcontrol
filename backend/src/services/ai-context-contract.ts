/**
 * AI context state / provenance contract.
 *
 * Every non-cost section of the AI Assistant's context is a ContextSection:
 * the data itself plus enough truth about it (state, source, as-of, scope,
 * coverage) that the model never has to guess whether an empty list, a 0, or
 * a missing value means "measured none", "not collected", or "failed".
 *
 * The cost section keeps its own richer shape (ChatContext['costs'] in
 * ai-chat.service.ts), which already carries the same fields -- state,
 * source, asOf, scope, coverage -- for cost-specific cases (actual vs
 * estimated, billing vs inventory scope, period comparison).
 */

import type { CostExplorerScope, InventoryScope } from './ai-chat.service';

/**
 * State of one AI-context dataset, decided by the context builder before the
 * model ever sees it -- so the model never has to guess whether a 0, an empty
 * list, or a missing section means "measured", "not collected", or "failed".
 *   available     = collected, complete for its stated scope
 *   partial       = collected, but only some of its stated scope is covered
 *                   (the section's coverage says how much)
 *   unavailable   = nothing to collect (e.g. no connected account, no rows,
 *                   not enough history) -- not an error, and not a zero
 *   error         = collection was attempted and failed
 *   not_supported = DevControl has no source for this data
 */
export type ContextDataState = 'available' | 'partial' | 'unavailable' | 'error' | 'not_supported';

/** Data about one organization over a rolling window (e.g. deployment records). */
export interface OrganizationWindowScope {
  kind: 'organization';
  /** The window the data covers, e.g. 'last 30 days'. */
  window: string;
}

export type ContextScope = CostExplorerScope | InventoryScope | OrganizationWindowScope;

export interface ContextSection<T> {
  state: ContextDataState;
  /** The authoritative origin of the data, in words the model can repeat. */
  source: string;
  /** When the underlying data was observed or generated; null if unknown. */
  asOf: string | null;
  scope: ContextScope | null;
  /** What was actually queried or discovered, and what was not. */
  coverage: string | null;
  /** Why the data is not (fully) available, or a caveat on data that is. */
  reason: string | null;
  /** Present only when state is 'available' or 'partial'. */
  data: T | null;
}

/** How a section is described before its getter runs. */
export interface SectionMeta {
  source: string;
  asOf?: string | null;
  scope?: ContextScope | null;
  coverage?: string | null;
}

/** What a getter that ran successfully found. */
export type SectionResult<T> =
  | { state: 'available' | 'partial'; data: T; asOf?: string | null; coverage?: string | null; reason?: string | null }
  | { state: 'unavailable'; reason: string; asOf?: string | null; coverage?: string | null };

/**
 * Runs one getter and returns its section. A getter that throws becomes
 * state 'error' with data null -- never [], {}, 0, or an apparently valid
 * empty result. The raw failure (which can carry SQL, database, or
 * infrastructure detail) goes to the server log only; the section's reason is
 * a safe diagnostic, since sections reach both the model and the
 * authenticated GET /api/ai-chat/context response.
 */
export async function collectSection<T>(
  meta: SectionMeta,
  getter: () => Promise<SectionResult<T>>
): Promise<ContextSection<T>> {
  try {
    const result = await getter();
    return {
      state: result.state,
      source: meta.source,
      asOf: result.asOf !== undefined ? result.asOf : meta.asOf ?? null,
      scope: meta.scope ?? null,
      coverage: result.coverage !== undefined ? result.coverage : meta.coverage ?? null,
      reason: result.reason ?? null,
      data: result.state === 'unavailable' ? null : result.data,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[AI Context] ${meta.source} could not be retrieved:`, message);
    return {
      state: 'error',
      source: meta.source,
      asOf: null,
      scope: meta.scope ?? null,
      coverage: null,
      reason: `${meta.source} could not be retrieved.`,
      data: null,
    };
  }
}

/** A section DevControl has no connected source for -- never a zero or an empty list. */
export function notSupported<T>(meta: SectionMeta, reason: string): ContextSection<T> {
  return {
    state: 'not_supported',
    source: meta.source,
    asOf: null,
    scope: meta.scope ?? null,
    coverage: null,
    reason,
    data: null,
  };
}
