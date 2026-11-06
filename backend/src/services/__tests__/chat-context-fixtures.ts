/**
 * Test helpers (not a test file) for AI Chat fixtures after AI truth PR 2:
 *   - chatCosts(): the pre-PR-2 cost fixture shape (state, source, current,
 *     period {start, endExclusive}, topSpenders, estimateCoverage, ...) as the
 *     ChatCostSection the chat now reads, field for field;
 *   - evidenceBundle(): an evidence bundle with the given provider sections.
 */
import type { ContextDataState, ContextScope, ContextSection } from '../ai-context-contract';
import type { ChatCostSection, CostComparison } from '../ai-chat.service';
import type { EvidenceBundle, ProviderResult } from '../ai/evidence/types';
import { createDefaultEvidenceRegistry } from '../ai/evidence/providers';

const TITLES = new Map(createDefaultEvidenceRegistry().list().map((p) => [p.id, p.title]));

export interface LegacyChatCosts {
  state: ContextDataState;
  source: 'actual' | 'estimated' | 'unavailable';
  current: number | null;
  asOf: string | null;
  period: { start: string; endExclusive: string } | null;
  scope: ContextScope | null;
  topSpenders: Array<{ service: string; cost: number; percentage: number | null }> | null;
  costExplorer: { state: ContextDataState; reason: string | null };
  estimateCoverage: { estimatedResources: number; totalResources: number } | null;
  comparison: CostComparison;
}

export function chatCosts(c: LegacyChatCosts): ChatCostSection {
  const hasFigure = c.current !== null && c.source !== 'unavailable';
  return {
    state: c.state,
    source: c.source === 'actual' ? 'AWS Cost Explorer' : c.source === 'estimated' ? 'DevControl inventory cost estimate' : 'AWS Cost Explorer and DevControl inventory cost estimate',
    provenance: c.source === 'unavailable' ? null : c.source,
    classification: c.source === 'actual' ? 'billed' : c.source === 'estimated' ? 'estimated' : null,
    asOf: c.asOf,
    scope: c.scope,
    period: c.period ? { kind: 'range', start: c.period.start, endExclusive: c.period.endExclusive } : c.source === 'estimated' ? { kind: 'point_in_time' } : null,
    completeness: c.estimateCoverage
      ? { unit: 'discovered resources with a cost estimate', expected: c.estimateCoverage.totalResources, received: c.estimateCoverage.estimatedResources, missing: null }
      : null,
    coverage: null,
    reason: null,
    derivedFrom: null,
    data: hasFigure ? { current: c.current as number, topSpenders: c.topSpenders, estimateCoverage: c.estimateCoverage } : null,
    retrievedAt: c.asOf,
    freshness: null,
    untrusted: [],
    failure: c.state === 'error' ? { code: 'internal', retryable: true } : null,
    truncation: null,
    costExplorer: c.costExplorer,
    comparison: c.comparison,
  };
}

export function evidenceBundle(sections: Record<string, ContextSection<unknown>> = {}, organizationId = 'org-fixture'): EvidenceBundle {
  const results: ProviderResult[] = Object.entries(sections).map(([id, section]) => ({
    id, version: 1, title: TITLES.get(id) ?? id, topics: ['ops'], priority: 1, fingerprint: 'full', section, selected: true, mode: 'loaded',
  }));
  return { organizationId, retrievedAt: '2026-11-06T12:00:00.000Z', results, topics: [], budget: { totalTokens: 12_000, usedTokens: 0 } };
}
