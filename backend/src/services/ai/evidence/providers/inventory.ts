/**
 * Resource inventory (S4): totals by type, the discovered resource types,
 * AI Chat's EC2/RDS/Lambda detail, and the change history DevControl does not
 * keep. Every inventory read is gated on the latest discovery run: an empty
 * result is a confirmed zero only once that run completed.
 */
import {
  collectSection,
  notBuilt,
  type ContextSection,
  type SectionMeta,
  type UntrustedText,
} from '../../../ai-context-contract';
import type { InventoryResources } from '../../../ai-chat.service';
import { defineProvider } from './shared';

/**
 * An inventory-backed read: 'available' (and an empty result a confirmed
 * zero) only once the latest discovery run has completed. Otherwise an empty
 * result is 'unavailable' and existing rows are 'partial'. The same gate AI
 * Chat's inventory sections use (ai-chat-context.repository.ts).
 */
export function discoveryGated<T>(
  meta: SectionMeta,
  discovery: ContextSection<{ completedAt: string }>,
  isEmpty: (data: T) => boolean,
  query: () => Promise<{ data: T; untrusted?: UntrustedText[] }>
): Promise<ContextSection<T>> {
  return collectSection<T>(meta, async () => {
    const { data, untrusted } = await query();
    if (discovery.state === 'available' && discovery.data) {
      return { state: 'available', data, asOf: discovery.data.completedAt, untrusted };
    }
    const problem = discovery.state === 'error'
      ? 'the status of the latest discovery run could not be determined'
      : 'the latest discovery run has not completed';
    if (isEmpty(data)) {
      return { state: 'unavailable', reason: `${problem}, so an empty result is not a confirmed zero` };
    }
    return { state: 'partial', data, asOf: null, reason: `${problem}; data may be stale or incomplete`, untrusted };
  });
}

export interface ResourceCounts {
  total: number;
  byType: Record<string, number>;
}

export const resourceCountsProvider = defineProvider<ResourceCounts>({
  id: 'inventory.resource_counts',
  version: 1,
  title: 'Discovered resource inventory',
  source: 'DevControl resource inventory (periodic AWS discovery)',
  dataSourceIds: ['S4'],
  topics: ['inventory', 'regions'],
  priority: 1,
  maxTokens: 800,
  async collect({ basis }) {
    const [discovery, inventoryScope] = await Promise.all([basis.discovery(), basis.inventoryScope()]);
    return discoveryGated<ResourceCounts>(
      {
        source: 'DevControl resource inventory (periodic AWS discovery)',
        classification: 'measured',
        scope: inventoryScope,
        period: { kind: 'point_in_time' },
      },
      discovery,
      (d) => d.total === 0,
      async () => {
        const stats = await basis.inventoryStats();
        const byType: Record<string, number> = {};
        Object.entries(stats.by_type ?? {}).forEach(([key, value]) => { byType[key] = value as number; });
        return { data: { total: stats.total_resources, byType } };
      }
    );
  },
});

export const resourceTypesProvider = defineProvider<string[]>({
  id: 'inventory.resource_types',
  version: 1,
  title: 'Services in use (discovered resource types)',
  source: 'DevControl resource inventory (periodic AWS discovery)',
  dataSourceIds: ['S4'],
  topics: ['inventory'],
  priority: 2,
  maxTokens: 600,
  async collect({ basis }) {
    return basis.resourceTypes();
  },
});

export const computeDetailProvider = defineProvider<InventoryResources>({
  id: 'inventory.compute_detail',
  version: 1,
  title: 'EC2, RDS and Lambda inventory',
  source: 'DevControl resource inventory (periodic AWS discovery)',
  dataSourceIds: ['S4'],
  topics: ['inventory', 'cost'],
  priority: 2,
  maxTokens: 800,
  async collect({ basis }) {
    return basis.computeDetail();
  },
});

export const RESOURCE_CHANGE_NOT_BUILT_REASON =
  'DevControl keeps only the current resource inventory, not its state at an earlier time, so resources added or removed over a period cannot be determined';

export const resourceChangeHistoryProvider = defineProvider<never>({
  id: 'inventory.change_history',
  version: 1,
  title: 'Resource changes over time',
  source: 'DevControl resource inventory history',
  dataSourceIds: ['S4'],
  topics: ['inventory'],
  priority: 3,
  maxTokens: 200,
  async collect({ basis }) {
    return notBuilt<never>({ source: 'DevControl resource inventory history', scope: await basis.inventoryScope() }, RESOURCE_CHANGE_NOT_BUILT_REASON);
  },
});
