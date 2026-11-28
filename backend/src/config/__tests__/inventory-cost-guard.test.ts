/**
 * Inventory-cost source guard (placeholder-costs PR 1, founder rulings F-2..F-13;
 * review-logs/placeholder-costs/stage-a.md §6). Modelled on the "Never show $0"
 * guard. CI runs only the backend jest suite, so this guard lives here and scans
 * the frontend too.
 *
 * Over every tracked (and untracked, not ignored) .ts/.tsx/.js/.jsx source file
 * under app/, components/, lib/ and backend/src/ -- tests excluded -- it fails when
 * the stored cost column, an inventory cost field or a flat-placeholder source is
 * used anywhere but the shared rule (services/inventory-cost.ts) and the reasoned
 * allowlist (inventory-cost-allowlist.ts, exact counts). So a flat placeholder or
 * the old cost field cannot reach exports, reports, AI context or totals again
 * without going through the rule.
 */
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';
import { scanInventorySource } from './inventory-cost-scan';
import { checkInventoryFiles, INVENTORY_ALLOWLIST, PR2, RULE_FILE } from './inventory-cost-allowlist';

const REPO = join(__dirname, '..', '..', '..', '..');
const SCANNED_DIRS = ['app', 'components', 'lib', 'backend/src'];

function sourceFiles(): string[] {
  const out = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '--', ...SCANNED_DIRS], { cwd: REPO, encoding: 'utf8' });
  return out.split('\n').filter((f) => /\.(ts|tsx|js|jsx)$/.test(f) && !/(^|\/)__tests__\//.test(f) && !/\.test\.[jt]sx?$/.test(f));
}

describe('inventory-cost source guard', () => {
  const files = sourceFiles();
  const read = (file: string): string | null => { try { return readFileSync(join(REPO, file), 'utf8'); } catch { return null; } };

  it('scans the frontend, the backend and every PR 1 surface', () => {
    for (const f of [
      RULE_FILE,
      'backend/src/services/awsResourcesExport.service.ts',
      'backend/src/services/report-generator.service.ts',
      'backend/src/services/ai/evidence/providers/cost.ts',
      'backend/src/repositories/ai-chat-context.repository.ts',
      'backend/src/services/aws-cost.service.ts',
      'backend/src/services/system-intelligence.service.ts',
      'app/(app)/costs/cost-display.ts',
    ]) {
      expect(files).toContain(f);
    }
  });

  it('no inventory cost or placeholder bypasses the shared rule, except the reasoned allowlist', () => {
    const { offenders, wrongCounts } = checkInventoryFiles(files, read);
    expect(offenders).toEqual([]);
    expect(wrongCounts).toEqual([]);
  });

  it('every allowlist entry carries a reason', () => {
    for (const entries of Object.values(INVENTORY_ALLOWLIST)) for (const [, reason, count] of entries) {
      expect(reason.length).toBeGreaterThan(20);
      expect(count).toBeGreaterThan(0);
    }
  });

  it('every PR 2 entry is marked temporary: "Remove in PR 2."', () => {
    const pr2 = Object.entries(INVENTORY_ALLOWLIST).flatMap(([file, entries]) =>
      entries.filter(([, reason]) => reason.startsWith(PR2)).map(([, reason]) => ({ file, marked: reason.endsWith('Remove in PR 2.') })));
    expect(pr2.length).toBe(10);
    expect(pr2.filter((e) => !e.marked)).toEqual([]);
  });

  it('no PR 1 surface has an allowlist entry: each goes through the rule', () => {
    for (const f of [
      'backend/src/services/awsResourcesExport.service.ts',
      'backend/src/services/report-generator.service.ts',
      'backend/src/services/ai/evidence/providers/cost.ts',
      'backend/src/repositories/ai-chat-context.repository.ts',
      'backend/src/services/cost-context-sections.ts',
      'backend/src/services/ai-chat.service.ts',
      'backend/src/services/ai-report-generator.service.ts',
      'backend/src/services/ai-summary.service.ts',
      'backend/src/services/aws-cost.service.ts',
      'backend/src/services/system-intelligence.service.ts',
      'backend/src/controllers/stats.controller.ts',
    ]) {
      expect({ f, entries: INVENTORY_ALLOWLIST[f] ?? [] }).toEqual({ f, entries: [] });
    }
  });

  describe('catches the shapes it names (self-test)', () => {
    const rules = (code: string, file = 'probe.ts') => scanInventorySource(file, code).map((f) => f.rule);

    it('every pre-fix PR 1 path, in its original form (94f7aa45)', () => {
      // A1: export Monthly Cost formatter.
      expect(rules('const f = (r: any) => { if (r.estimated_monthly_cost == null) return "Not available"; return `$${Number(r.estimated_monthly_cost).toFixed(2)}`; };'))
        .toEqual(['cost-read', 'cost-read']);
      // A3: cost summary total, top 10 and the NULL row as $0.00.
      expect(rules('const q = `SELECT COALESCE(SUM(r.estimated_monthly_cost), 0) as total_cost FROM aws_resources r`;')).toEqual(['sql-cost']);
      expect(rules('const q = `SELECT r.estimated_monthly_cost as cost FROM aws_resources r ${w} ORDER BY r.estimated_monthly_cost DESC NULLS LAST LIMIT 10`;')).toEqual(['sql-cost', 'sql-cost']);
      // B1: top-5 provider.
      expect(rules("const x = { estimatedMonthlyCost: Math.round(parseFloat(row.estimated_monthly_cost) * 100) / 100 };")).toEqual(['cost-read']);
      // B2 / D1 / D3: run-rate sum and its COUNT coverage.
      expect(rules("pool.query(`SELECT COUNT(estimated_monthly_cost) AS estimated_resources, SUM(estimated_monthly_cost) AS total FROM aws_resources`)")).toEqual(['sql-cost']);
      expect(rules("pool.query('SELECT COALESCE(SUM(estimated_monthly_cost), 0) as total FROM aws_resources WHERE organization_id = $1')")).toEqual(['sql-cost']);
      // B3: RDS line, written over two template parts.
      expect(rules('const q = `SELECT COUNT(${a}) as estimated_count, SUM(estimated_monthly_cost) as estimated_cost FROM aws_resources`;')).toEqual(['sql-cost']);
    });

    it('a reintroduced placeholder source', () => {
      expect(rules('const c = AWSResourceDiscoveryService.GENERIC_COST_BASELINE[type] ?? 0;')).toEqual(['placeholder']);
      expect(rules('const c = this.estimateS3Cost();')).toEqual(['placeholder']);
      expect(rules('total += svc.estimateLBCost(lb) + svc.estimateCloudFrontCost();')).toEqual(['placeholder', 'placeholder']);
      expect(rules("import { RDS_INSTANCE_MONTHLY_USD_US_EAST_1_MYSQL_SINGLE_AZ as T } from '../config/aws-pricing'; const x = T['db.t3.micro'];")).toEqual(['placeholder']);
    });

    it('every read shape of a cost field', () => {
      expect(rules("const a = row['estimated_monthly_cost'];")).toEqual(['cost-read']);
      expect(rules('const { estimated_monthly_cost } = row;')).toEqual(['cost-read']);
      expect(rules('const t = rows.reduce((s, r) => s + (r.costPerMonth ?? 0), 0);')).toEqual(['cost-read']);
      expect(rules('const t = stats.total_monthly_cost;')).toEqual(['cost-read']);
      expect(rules('const m = r.monthly_cost;')).toEqual(['cost-read']);
      expect(rules('const x = { costPerMonth };')).toEqual(['cost-read']);
      expect(rules('const v = <span>${r.costPerMonth.toFixed(2)}</span>;', 'probe.tsx')).toEqual(['cost-read']);
    });

    it('declarations and the rule\'s own names are not reads', () => {
      expect(rules('interface R { estimated_monthly_cost: number | null; costPerMonth?: number }')).toEqual([]);
      expect(rules('const out = { estimated_monthly_cost: 12 };')).toEqual([]);
      expect(rules('function f(estimatedMonthlyCost: number) {}')).toEqual([]);
      expect(rules('class S { private estimateS3Cost(): number { return 5; } }')).toEqual([]);
      expect(rules('const q = `SELECT ${inventoryCostColumns()} FROM aws_resources`;')).toEqual([]);
      expect(rules('interface Row { stored_monthly_cost?: unknown }')).toEqual([]);
    });

    it('review fix round S-1: the stored figure under the rule\'s alias, in every read shape a surface could use', () => {
      // The pre-S-1 gap (review mutant G1): the export cell printing the stored figure.
      expect(rules('const f = (r: any) => `$${Number(r.stored_monthly_cost).toFixed(2)}`;')).toEqual(['cost-read']);
      expect(rules('const n = row.stored_monthly_cost;')).toEqual(['cost-read']);
      expect(rules("const n = row['stored_monthly_cost'];")).toEqual(['cost-read']);
      expect(rules('const n = result.rows[0].stored_monthly_cost;')).toEqual(['cost-read']);
      expect(rules('const t = rows.reduce((s, r) => s + Number(r.stored_monthly_cost), 0);')).toEqual(['cost-read']);
      expect(rules('const { stored_monthly_cost } = row;')).toEqual(['cost-read']);
      expect(rules('const { stored_monthly_cost: stored } = row; const x = stored;')).toEqual(['cost-read']);
      expect(rules('const x = { stored_monthly_cost };')).toEqual(['cost-read']);
      // SQL that sums, orders or re-aliases it over the rule's own column fragment.
      expect(rules('const q = `SELECT SUM(stored_monthly_cost) FROM (SELECT ${inventoryCostColumns()} FROM aws_resources) t`;')).toEqual(['sql-cost']);
      expect(rules('const q = `SELECT ${inventoryCostColumns()} FROM aws_resources ORDER BY stored_monthly_cost DESC`;')).toEqual(['sql-cost']);
    });
  });
});
