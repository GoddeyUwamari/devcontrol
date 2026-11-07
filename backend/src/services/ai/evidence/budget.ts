/**
 * The evidence size budget (step1 §2.5). Deterministic: the same results and
 * budget always give the same plan.
 *
 *   - Selected providers are filled in order: band ('fact' sections before
 *     'list' sections, budgetBandOf), then priority, then id.  So a list is
 *     shortened or left out before any status fact is.
 *   - A provider whose own data is over its cap is summarised (fewer list
 *     items, counts and totals kept) when it can be; otherwise it is cut to its
 *     line, state 'omitted'. The cap measures the provider's data and untrusted
 *     text, not the envelope every section shares.
 *   - A section without data (not built, error, not entitled...) is never cut,
 *     and it respects the total too: its block is counted only while it fits
 *     (its line is always counted), so it never pushes the total over.
 *   - A list over what is left of the total is shortened further to fit it;
 *     only when even its smallest step does not fit is it cut to its line.
 *   - Every capped provider records `truncation` (kept, total, by), and its
 *     line says so. A provider is never dropped: every line is always printed.
 *
 * Tokens are estimated as characters / 3.5 (no tokenizer call).
 */
import { OMITTED_REASON, stateCarriesData, type ContextSection, type EvidenceTruncation } from '../../ai-context-contract';
import { renderProviderBlock } from './render';
import type { ProviderDefinition, ProviderResult } from './types';

export const ESTIMATED_CHARS_PER_TOKEN = 3.5;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / ESTIMATED_CHARS_PER_TOKEN);
}

/** Item counts tried, largest first, when a provider is over its cap. */
const SUMMARY_STEPS = [25, 10, 5, 3, 1];

/** Lines and headings the block list costs on top of the data (generous). */
const LINE_TOKENS = 60;

/**
 * The section with its truncation recorded. With summarised data, untrusted
 * text of items that were cut goes too (an entry's field starts with its
 * item's ref and a space, e.g. "f3 title"); entries not tied to an item stay.
 */
function withTruncation<T>(section: ContextSection<T>, truncation: EvidenceTruncation, data?: T): ContextSection<T> {
  if (data === undefined) return { ...section, truncation };
  const items = (data as { items?: unknown } | null)?.items;
  const untrusted = Array.isArray(items)
    ? (() => {
        const kept = new Set(items.map((i) => (i as { ref?: unknown })?.ref).filter((r): r is string => typeof r === 'string'));
        return (section.untrusted ?? []).filter((u) => {
          const space = u.field.indexOf(' ');
          return space === -1 || kept.has(u.field.slice(0, space));
        });
      })()
    : section.untrusted ?? [];
  return { ...section, data, untrusted, truncation };
}

/**
 * A section cut to its line by a cap: state 'omitted' with OMITTED_REASON, and
 * its data and untrusted text dropped, so every consumer states it as "not
 * included in this answer (too large)" -- never "available" with no data, and
 * never "not available". Source and as-of stay.
 */
function cutToLine<T>(section: ContextSection<T>, by: 'provider_cap' | 'total_budget'): ContextSection<T> {
  return {
    ...section,
    state: 'omitted',
    reason: OMITTED_REASON,
    classification: null,
    provenance: null,
    data: null,
    untrusted: [],
    truncation: { kept: 0, total: itemCount(section), by },
  };
}

function itemCount(section: ContextSection<unknown>): number {
  const items = (section.data as { items?: unknown } | null)?.items;
  return Array.isArray(items) ? items.length : 1;
}

/**
 * What a provider's cap measures: its own data and untrusted text. The fixed
 * envelope every section carries (state meaning, classification meaning,
 * scope...) is the same for every provider and is not the provider's size.
 */
export function dataTokens(section: ContextSection<unknown>): number {
  return estimateTokens(`${JSON.stringify(section.data)}${JSON.stringify(section.untrusted ?? [])}`);
}

/** Only a section that carries data can be summarised or cut; a no-data state is always stated as it is. */
function carriesData(section: ContextSection<unknown>): boolean {
  return stateCarriesData(section.state) && section.data !== null && section.data !== undefined;
}

/**
 * Each budgeted result's section as collected, before the budget shortened or
 * cut it. Kept outside the result objects (a WeakMap keyed by the result), so
 * JSON.stringify, a spread or a response body can never include it. Read only
 * by consumers that make no model call (the chat fallback), to which size does
 * not apply -- through collectedSectionOf().
 */
const COLLECTED = new WeakMap<ProviderResult, ContextSection<unknown>>();

/** The section as collected, before the budget; undefined for a result the budget did not plan. */
export function collectedSectionOf<T>(result: ProviderResult | undefined): ContextSection<T> | undefined {
  return result ? (COLLECTED.get(result) as ContextSection<T> | undefined) : undefined;
}

/** A provider's budget band: its own, or 'list' when it can summarise a list, else 'fact'. */
export function budgetBandOf(def: Pick<ProviderDefinition, 'budgetBand' | 'summarize'> | undefined): 'fact' | 'list' {
  return def?.budgetBand ?? (def?.summarize ? 'list' : 'fact');
}

const BAND_ORDER = { fact: 0, list: 1 } as const;

/** Fits one provider under its own cap; returns the result to use and its token cost. */
function fitProvider(result: ProviderResult, def: ProviderDefinition | undefined): { result: ProviderResult; tokens: number } {
  const maxTokens = def?.maxTokens ?? Number.POSITIVE_INFINITY;
  const full = estimateTokens(renderProviderBlock(result));
  if (!carriesData(result.section) || dataTokens(result.section) <= maxTokens) return { result: { ...result, mode: 'loaded' }, tokens: full };

  const data = result.section.data;
  if (def?.summarize && data !== null && data !== undefined) {
    for (const maxItems of SUMMARY_STEPS) {
      // Nothing to cut at this size (the list is already this short): try the next, smaller one.
      const summary = def.summarize(data, maxItems);
      if (!summary) continue;
      const section = withTruncation(result.section, { kept: summary.kept, total: summary.total, by: 'provider_cap' }, summary.data);
      if (dataTokens(section) <= maxTokens) {
        const candidate: ProviderResult = { ...result, section, mode: 'summarised' };
        return { result: candidate, tokens: estimateTokens(renderProviderBlock(candidate)) };
      }
    }
  }
  return {
    result: { ...result, section: cutToLine(result.section, 'provider_cap'), mode: 'header' },
    tokens: 0,
  };
}

/**
 * A list section over what is left of the total: shortened further (fewer
 * items, counts and totals kept) until its block fits what is left, or null
 * when even the smallest step does not fit.
 */
function shortenToFit(original: ProviderResult, fitted: ProviderResult, def: ProviderDefinition | undefined, remaining: number): { result: ProviderResult; tokens: number } | null {
  const data = original.section.data;
  if (!def?.summarize || data === null || data === undefined) return null;
  const current = fitted.section.truncation && fitted.mode === 'summarised' ? fitted.section.truncation.kept : Number.POSITIVE_INFINITY;
  for (const maxItems of SUMMARY_STEPS) {
    if (maxItems >= current) continue;
    const summary = def.summarize(data, maxItems);
    if (!summary) continue;
    const candidate: ProviderResult = {
      ...original,
      section: withTruncation(original.section, { kept: summary.kept, total: summary.total, by: 'total_budget' }, summary.data),
      mode: 'summarised',
    };
    const tokens = estimateTokens(renderProviderBlock(candidate));
    if (tokens <= remaining) return { result: candidate, tokens };
  }
  return null;
}

export function applyBudget(
  results: readonly ProviderResult[],
  definitions: ReadonlyMap<string, ProviderDefinition>,
  totalTokens: number
): { results: ProviderResult[]; usedTokens: number } {
  const order = results
    .map((r, index) => ({ r, index }))
    .filter(({ r }) => r.selected)
    .sort((a, b) =>
      BAND_ORDER[budgetBandOf(definitions.get(a.r.id))] - BAND_ORDER[budgetBandOf(definitions.get(b.r.id))] ||
      a.r.priority - b.r.priority ||
      (a.r.id < b.r.id ? -1 : a.r.id > b.r.id ? 1 : 0));

  const planned = results.map((r) => ({ ...r, mode: 'header' as const })) as ProviderResult[];
  let used = results.length * LINE_TOKENS;

  for (const { r, index } of order) {
    const fitted = fitProvider(r, definitions.get(r.id));
    // A section without data is never cut (it keeps its state and line), and it
    // respects the total: its block is counted only while it fits.
    if (!carriesData(fitted.result.section)) {
      planned[index] = fitted.result;
      if (used + fitted.tokens <= totalTokens) used += fitted.tokens;
      continue;
    }
    if (fitted.result.mode !== 'header' && used + fitted.tokens > totalTokens) {
      // Over what is left of the total: a list is shortened to fit first; cut only when nothing fits.
      const shorter = shortenToFit(r, fitted.result, definitions.get(r.id), totalTokens - used);
      if (shorter) {
        planned[index] = shorter.result;
        used += shorter.tokens;
        continue;
      }
      planned[index] = { ...r, section: cutToLine(r.section, 'total_budget'), mode: 'header' };
      continue;
    }
    planned[index] = fitted.result;
    used += fitted.tokens;
  }
  // Each result's section as collected, outside the result object (COLLECTED).
  const out = planned.map((p) => ({ ...p }));
  out.forEach((p, i) => COLLECTED.set(p, results[i].section));
  return { results: out, usedTokens: used };
}
