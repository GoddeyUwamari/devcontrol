/**
 * The evidence size budget (step1 §2.5). Deterministic: the same results and
 * budget always give the same plan.
 *
 *   - Selected providers are filled in order: priority, then id.
 *   - A provider over its own cap is summarised (fewer list items, counts and
 *     totals kept) when it can be; otherwise only its line is kept.
 *   - Once the total budget is reached, later providers keep only their line.
 *   - Every capped provider records `truncation` (kept, total, by), and its
 *     line says so. A provider is never dropped: every line is always printed.
 *
 * Tokens are estimated as characters / 3.5 (no tokenizer call).
 */
import type { ContextSection, EvidenceTruncation } from '../../ai-context-contract';
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
 * A section cut to its line by a cap: its data and untrusted text are dropped,
 * so no consumer (the report's per-section evidence included) prints data its
 * line says was not included. State, source, as-of and reason stay.
 */
function cutToLine<T>(section: ContextSection<T>, by: 'provider_cap' | 'total_budget'): ContextSection<T> {
  return { ...section, data: null, untrusted: [], truncation: { kept: 0, total: itemCount(section), by } };
}

function itemCount(section: ContextSection<unknown>): number {
  const items = (section.data as { items?: unknown } | null)?.items;
  return Array.isArray(items) ? items.length : 1;
}

/** Fits one provider under its own cap; returns the result to use and its token cost. */
function fitProvider(result: ProviderResult, def: ProviderDefinition | undefined): { result: ProviderResult; tokens: number } {
  const maxTokens = def?.maxTokens ?? Number.POSITIVE_INFINITY;
  const full = estimateTokens(renderProviderBlock(result));
  if (full <= maxTokens) return { result: { ...result, mode: 'loaded' }, tokens: full };

  const data = result.section.data;
  if (def?.summarize && data !== null && data !== undefined) {
    for (const maxItems of SUMMARY_STEPS) {
      const summary = def.summarize(data, maxItems);
      if (!summary) break;
      const section = withTruncation(result.section, { kept: summary.kept, total: summary.total, by: 'provider_cap' }, summary.data);
      const candidate: ProviderResult = { ...result, section, mode: 'summarised' };
      const tokens = estimateTokens(renderProviderBlock(candidate));
      if (tokens <= maxTokens) return { result: candidate, tokens };
    }
  }
  return {
    result: { ...result, section: cutToLine(result.section, 'provider_cap'), mode: 'header' },
    tokens: 0,
  };
}

export function applyBudget(
  results: readonly ProviderResult[],
  definitions: ReadonlyMap<string, ProviderDefinition>,
  totalTokens: number
): { results: ProviderResult[]; usedTokens: number } {
  const order = results
    .map((r, index) => ({ r, index }))
    .filter(({ r }) => r.selected)
    .sort((a, b) => a.r.priority - b.r.priority || (a.r.id < b.r.id ? -1 : a.r.id > b.r.id ? 1 : 0));

  const planned = results.map((r) => ({ ...r, mode: 'header' as const })) as ProviderResult[];
  let used = results.length * LINE_TOKENS;

  for (const { r, index } of order) {
    const fitted = fitProvider(r, definitions.get(r.id));
    if (fitted.result.mode !== 'header' && used + fitted.tokens > totalTokens) {
      planned[index] = { ...r, section: cutToLine(r.section, 'total_budget'), mode: 'header' };
      continue;
    }
    planned[index] = fitted.result;
    used += fitted.tokens;
  }
  return { results: planned, usedTokens: used };
}
