/**
 * The inventory-cost guard's reasoned exceptions and the check that applies them
 * (inventory-cost-guard.test.ts). Kept apart from the test so the exact verdict can
 * be run over any tree (the base tree 94f7aa45, review-logs/placeholder-costs/pr1-build.md).
 *
 * Every entry names the exact number of findings it covers, so a new finding that
 * shares the snippet fails instead of being silently allowed. Entries for product
 * pages are PR 2's work list (ruling F-1 split): PR 2 removes them as it moves each
 * surface onto the shared rule.
 */
import { scanInventorySource, type InventoryFinding } from './inventory-cost-scan';

/** The shared rule itself: the one place allowed to name the column and the price table. */
export const RULE_FILE = 'backend/src/services/inventory-cost.ts';

/**
 * [a substring of the finding's line or expression, why it is allowed, exact count].
 * The snippet '*' covers every finding in the file (used for whole PR 2 pages): the exact
 * count still fails on any new read there.
 */
export type InventoryEntry = [snippet: string, reason: string, count: number];

const WRITE_SIDE = 'Discovery write side: PR 1 excludes discovery changes, and every reader masks the stored value through the shared rule (F-11).';
const PR2 = 'Product page or its feed, placeholder-costs PR 2 (Stage A §7, outside the PR 1 brief): it moves onto the shared rule there.';

export const INVENTORY_ALLOWLIST: Record<string, InventoryEntry[]> = {
  'backend/src/services/awsResourceDiscovery.ts': [
    ['RDS_INSTANCE_MONTHLY_USD_US_EAST_1_MYSQL_SINGLE_AZ', `${WRITE_SIDE} The RDS table was moved to config unchanged; discovery still writes it as before.`, 2],
    ['this.estimateEC2Cost(', `${WRITE_SIDE} P3 EC2 table / $50.`, 1],
    ['this.estimateRDSCost(', `${WRITE_SIDE} P4 RDS table / $75.`, 1],
    ['this.estimateS3Cost()', `${WRITE_SIDE} P2 S3 $5.`, 1],
    ['this.estimateLBCost(lb)', `${WRITE_SIDE} P5 load balancer $74.83.`, 1],
    ['this.estimateCloudFrontCost()', `${WRITE_SIDE} P6 CloudFront $8.50.`, 1],
    ['GENERIC_COST_BASELINE[', `${WRITE_SIDE} P1 Resource Explorer baselines.`, 1],
    ['INSERT INTO aws_resources (', `${WRITE_SIDE} The deep and generic upserts.`, 2],
    ['resource.estimated_monthly_cost ?? null', `${WRITE_SIDE} Deep upsert parameter.`, 1],
    ['estimatedMonthlyCost,', `${WRITE_SIDE} Generic upsert parameter.`, 1],
  ],
  'backend/src/services/cost-optimization.service.ts': [
    ['this.estimateEC2Cost(', 'The savings domain\'s own idle-EC2 price lookup (labelled $50 default for unlisted types), ruling F-12, a separate PR; not an inventory cost.', 1],
  ],
  'backend/src/repositories/awsResources.repository.ts': [
    ['SUM(estimated_monthly_cost) as total FROM aws_resources', 'D6 GET /api/aws-resources/stats total_monthly_cost: API field with no renderer (Stage A D6), not in the PR 1 brief; listed in pr1-build.md "noticed, not fixed".', 1],
    ['SELECT resource_type, SUM(estimated_monthly_cost) as total', 'D6 cost_by_type on the same stats endpoint: no renderer; listed in pr1-build.md "noticed, not fixed".', 1],
    ['ORDER BY estimated_monthly_cost DESC', 'getOrphaned: ordering of S3 rows only, no figure is shown or summed.', 1],
  ],
  'backend/src/routes/services.routes.ts': [['*', `${PR2} C5: V2 attention-ranking tie-break.`, 4]],
  'backend/src/services/nl-query-executor.service.ts': [['*', `${PR2} D5: command palette rows, sum and cost filters.`, 7]],
  'backend/src/controllers/infrastructure.controller.ts': [['*', `${PR2} C1: legacy Infrastructure costPerMonth.`, 1]],
  'backend/src/utils/infrastructureRow.ts': [['*', `${PR2} C1: legacy Infrastructure row cost.`, 2]],
  'backend/src/routes/tenants.routes.ts': [['*', 'Not inventory: tenants.monthly_cost is its own caller-supplied table (Stage A D8).', 2]],
  'backend/src/services/monitoring-snapshot.service.ts': [['*', 'Not inventory: monitoring_snapshots.monthly_cost is caller-supplied (Stage A D8).', 1]],
  'app/(app)/costs/efficiency/page.tsx': [['*', `${PR2} D4: Cost Efficiency page tiles, scatter, wasteful table and score (F-8).`, 8]],
  'app/(app)/infrastructure/page.tsx': [['*', `${PR2} C1-C3: legacy Infrastructure table, card and sort.`, 11]],
  'app/(app)/infrastructure/costByResource.ts': [['*', `${PR2} C2: legacy "Largest estimated costs" card.`, 4]],
  'app/(app)/infrastructure/overview/overviewModel.ts': [['*', `${PR2} C5: V2 attention ordering.`, 3]],
  'components/command-palette.tsx': [['*', `${PR2} D5: command palette "est. $X/mo".`, 3]],
  'lib/services/infrastructure.service.ts': [['*', `${PR2} C1: GET /api/infrastructure costPerMonth mapper.`, 1]],
  'app/(app)/infrastructure/new/page.tsx': [['*', 'Not inventory: the manual "new infrastructure" form\'s own costPerMonth input, typed by the user.', 5]],
  'app/(app)/costs/by-team/page.tsx': [['*', 'Demo-mode fixture only (DEMO_DATA.total_monthly_cost); real mode reads describeSpend.', 3]],
  'lib/demo-data/demo-generator.ts': [['*', 'Demo fixture generator: synthetic tags, never a customer row.', 1]],
};

export interface InventoryCheck {
  offenders: Array<{ file: string } & InventoryFinding>;
  wrongCounts: Array<{ file: string; snippet: string; expected: number; actual: number }>;
}

export function checkInventoryFiles(files: readonly string[], read: (file: string) => string | null, allowlist = INVENTORY_ALLOWLIST): InventoryCheck {
  const offenders: InventoryCheck['offenders'] = [];
  const wrongCounts: InventoryCheck['wrongCounts'] = [];
  for (const file of files) {
    if (file === RULE_FILE) continue;
    const text = read(file);
    if (text === null) continue;
    const findings = scanInventorySource(file, text);
    const entries = allowlist[file] ?? [];
    const used = new Map<string, number>();
    for (const f of findings) {
      const entry = entries.find(([snippet]) => snippet !== '*' && (f.lineText.includes(snippet) || f.nodeText.includes(snippet)))
        ?? entries.find(([snippet]) => snippet === '*');
      if (entry) used.set(entry[0], (used.get(entry[0]) ?? 0) + 1);
      else offenders.push({ file, ...f });
    }
    for (const [snippet, , count] of entries) {
      const actual = used.get(snippet) ?? 0;
      if (actual !== count) wrongCounts.push({ file, snippet, expected: count, actual });
    }
  }
  // An entry for a file that no longer exists (or is not scanned) is stale.
  for (const [file, entries] of Object.entries(allowlist)) {
    if (!files.includes(file)) for (const [snippet, , count] of entries) wrongCounts.push({ file, snippet, expected: count, actual: 0 });
  }
  return { offenders, wrongCounts };
}

export { WRITE_SIDE, PR2 };
