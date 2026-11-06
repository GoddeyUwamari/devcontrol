/**
 * Reads that several evidence providers share, made at most once per
 * collection: the latest discovery run, the connected account row, the
 * inventory scope they establish, the cost evidence, the scan coverage, the
 * inventory stats, and the active account security findings and cost
 * recommendations.
 *
 * A basis is created for one organization and one collection and is never
 * reused: every memoized promise is bound to that organization, so nothing
 * here can answer for another tenant. Each read uses the organization-scoped
 * repository the product already uses for it.
 */
import { pool } from '../../../config/database';
import type { ContextSection, InventoryScope } from '../../ai-context-contract';
import type { ChatContext, ChatCostSection } from '../../ai-chat.service';
import { AIChatContextRepository } from '../../../repositories/ai-chat-context.repository';
import { AWSResourcesRepository } from '../../../repositories/awsResources.repository';
import { AccountSecurityFindingsRepository, type AccountSecurityFinding } from '../../../repositories/account-security-findings.repository';
import { CostRecommendationsRepository } from '../../../repositories/cost-recommendations.repository';
import type { ServicesCoverage } from '../../../routes/services-coverage.routes';
import type { CostRecommendation } from '../../../types';

export type InventoryStats = Awaited<ReturnType<AWSResourcesRepository['getStats']>>;

export interface EvidenceBasis {
  readonly organizationId: string;
  discovery(): Promise<ContextSection<{ completedAt: string }>>;
  account(): Promise<ContextSection<{ accountId: string | null; region: string | null }>>;
  inventoryScope(): Promise<InventoryScope>;
  costs(): Promise<ChatCostSection>;
  coverage(): Promise<ServicesCoverage>;
  inventoryStats(): Promise<InventoryStats>;
  activeAccountFindings(): Promise<AccountSecurityFinding[]>;
  /** Active cost recommendations, highest estimated savings first. */
  activeCostRecommendations(): Promise<CostRecommendation[]>;
  /** AI Chat's inventory and DORA sections, read by the chat context repository that started this collection. */
  resourceTypes(): Promise<ChatContext['services']>;
  computeDetail(): Promise<ChatContext['resources']>;
  dora(): Promise<ChatContext['dora']>;
}

/** The repositories a basis reads through; tests replace them. */
export interface BasisSources {
  context: Pick<AIChatContextRepository, 'gatherInventoryBasis' | 'collectCosts' | 'getServices' | 'getResourceData' | 'getDORAMetrics'>;
  resources: Pick<AWSResourcesRepository, 'getStats'>;
  accountFindings: Pick<AccountSecurityFindingsRepository, 'getActive'>;
  costRecommendations: Pick<CostRecommendationsRepository, 'findAll'>;
  coverage: (organizationId: string) => Promise<ServicesCoverage>;
}

export function defaultBasisSources(): BasisSources {
  return {
    context: new AIChatContextRepository(pool),
    resources: new AWSResourcesRepository(pool),
    accountFindings: new AccountSecurityFindingsRepository(),
    costRecommendations: new CostRecommendationsRepository(),
    // Loaded on first use: the coverage read lives beside its route, and
    // importing a routes module at load time would register its routers.
    coverage: async (organizationId) => (await import('../../../routes/services-coverage.routes')).readServicesCoverage(pool, organizationId),
  };
}

/** One lazily started, shared promise; a rejection is shared too (each reader turns it into its own error). */
function once<T>(start: () => Promise<T>): () => Promise<T> {
  let promise: Promise<T> | null = null;
  return () => {
    if (!promise) {
      promise = start();
      promise.catch(() => undefined);
    }
    return promise;
  };
}

export function createEvidenceBasis(organizationId: string, sources: BasisSources = defaultBasisSources()): EvidenceBasis {
  const inventory = once(() => sources.context.gatherInventoryBasis(organizationId));
  return {
    organizationId,
    discovery: once(async () => (await inventory()).discovery),
    account: once(async () => (await inventory()).account),
    inventoryScope: once(async () => (await inventory()).inventoryScope),
    costs: once(async () => {
      const basis = await inventory();
      return sources.context.collectCosts(
        organizationId,
        basis.discovery.data?.completedAt ?? null,
        basis.account.data?.accountId ?? null,
        basis.inventoryScope
      );
    }),
    coverage: once(() => sources.coverage(organizationId)),
    inventoryStats: once(() => sources.resources.getStats(organizationId)),
    activeAccountFindings: once(() => sources.accountFindings.getActive(organizationId)),
    activeCostRecommendations: once(() => sources.costRecommendations.findAll(organizationId, { status: 'ACTIVE' })),
    resourceTypes: once(async () => {
      const b = await inventory();
      return sources.context.getServices(organizationId, b.discovery, b.inventoryScope);
    }),
    computeDetail: once(async () => {
      const b = await inventory();
      return sources.context.getResourceData(organizationId, b.discovery, b.inventoryScope);
    }),
    dora: once(() => sources.context.getDORAMetrics(organizationId)),
  };
}
