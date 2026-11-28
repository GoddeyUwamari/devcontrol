/**
 * The one rule for an inventory resource's monthly cost (placeholder-costs PR 1,
 * founder rulings F-2, F-6, F-7, F-9, F-10, F-11; review-logs/placeholder-costs/).
 *
 * Governing principle: a resource cost is either supported by a defensible pricing
 * basis or it is not presented as a dollar figure. An unknown price never becomes a
 * customer-specific number, and a missing price stays visibly distinct from a
 * genuine $0.
 *
 * Every reader of aws_resources cost (exports, the scheduled cost report, AI
 * context, the run-rate fallback and its gate) goes through inventoryCost() and
 * aggregateInventoryCosts(). Nothing else may read estimated_monthly_cost for a
 * figure: the source guard (config/__tests__/inventory-cost-guard.test.ts)
 * enforces it.
 *
 * Read-side only (F-11: no migration, no discovery change). The stored
 * estimated_monthly_cost is never shown on its own: old rows carry flat
 * placeholders (ECS 9, EKS 73, Aurora 150, S3 5, load balancer 74.83, ...) and
 * re-scans do not overwrite Resource Explorer rows. A figure is produced only
 * when the stored configuration establishes every assumption of a documented price
 * table, and then it is computed from that table, not taken from the stored value.
 *
 * Kinds:
 *   priced            an amount with its basis: "us-east-1 list-price estimate" (F-2)
 *   not_running       stopped EC2 (F-6) and stopped RDS (AWS RDS User Guide, "Stopping
 *                     an Amazon RDS DB instance temporarily": "While the instance is
 *                     stopped, you're not charged for DB instance hours.")
 *   no_direct_charge  VPC (F-7), always with VPC_SEPARATE_CHARGES_LINE
 *   no_price          everything else, including every flat placeholder
 *
 * Totals sum ONLY priced amounts and always carry "K of N": no_price is never 0,
 * and a total with nothing priced has no amount (null), never $0.00.
 */
import {
  EBS_PER_GB_MONTH_USD,
  estimateLambdaMonthlyCostFromUsage,
  RDS_INSTANCE_MONTHLY_USD_US_EAST_1_MYSQL_SINGLE_AZ,
} from '../config/aws-pricing';

/** The basis label of every priced figure (ruling F-2). */
export const INVENTORY_PRICE_BASIS = 'us-east-1 list-price estimate';
export const NO_PRICE_TEXT = 'No price';
export const NOT_RUNNING_TEXT = 'Not running: no instance-hour charge';
export const NO_DIRECT_CHARGE_TEXT = 'No direct charge';
/** F-7: shown wherever "No direct charge" is shown. */
export const VPC_SEPARATE_CHARGES_LINE = 'NAT gateways, endpoints and data transfer are charged separately.';

/** The only region the tables price (F-2). */
export const PRICED_REGION = 'us-east-1';
/**
 * RDS starts a stopped instance by itself after seven consecutive days (AWS RDS User
 * Guide, "Automatic restart of a stopped DB instance"). A stored "stopped" older than
 * that may no longer be true, so it is not shown as not running.
 */
export const RDS_STOPPED_STATUS_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The columns every reader selects for the rule (the guard requires readers to use
 * this, never their own estimated_monthly_cost read). `alias` is the table alias.
 */
export function inventoryCostColumns(alias?: string): string {
  const p = alias ? `${alias}.` : '';
  return `${p}resource_type, ${p}region, ${p}status, ${p}metadata, ${p}estimated_monthly_cost AS stored_monthly_cost, ${p}last_synced_at`;
}

export interface InventoryCostRow {
  resource_type?: unknown;
  region?: unknown;
  status?: unknown;
  metadata?: unknown;
  /** The stored figure (inventoryCostColumns names it stored_monthly_cost). Required present for a priced kind, never used as the amount. */
  stored_monthly_cost?: unknown;
  last_synced_at?: unknown;
}

export type InventoryCost =
  | { kind: 'priced'; amount: number; basis: typeof INVENTORY_PRICE_BASIS; detail: string }
  | { kind: 'not_running'; reason: string }
  | { kind: 'no_direct_charge'; reason: string }
  | { kind: 'no_price'; reason: string };

export type InventoryCostKind = InventoryCost['kind'];

function metadataOf(row: InventoryCostRow): Record<string, unknown> {
  let m = row.metadata;
  if (typeof m === 'string') {
    try { m = JSON.parse(m); } catch { return {}; }
  }
  return m !== null && typeof m === 'object' && !Array.isArray(m) ? (m as Record<string, unknown>) : {};
}

const finite = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

const ownNumber = (table: Readonly<Record<string, number>>, key: unknown): number | null =>
  typeof key === 'string' && Object.prototype.hasOwnProperty.call(table, key) ? finite(table[key]) : null;

const noPrice = (reason: string): InventoryCost => ({ kind: 'no_price', reason });
const priced = (amount: number, detail: string): InventoryCost => ({ kind: 'priced', amount, basis: INVENTORY_PRICE_BASIS, detail });

function observedWithin(lastSynced: unknown, maxAgeMs: number, now: Date): boolean {
  if (lastSynced === null || lastSynced === undefined) return false;
  const t = lastSynced instanceof Date ? lastSynced.getTime() : new Date(String(lastSynced)).getTime();
  if (!Number.isFinite(t)) return false;
  const age = now.getTime() - t;
  return age >= 0 && age <= maxAgeMs;
}

function rdsCost(row: InventoryCostRow, m: Record<string, unknown>, now: Date): InventoryCost {
  const engine = typeof m.engine === 'string' ? m.engine : null;
  // F-10: an Aurora member instance never carries a figure (its cluster row doesn't either).
  if (engine !== null && engine.toLowerCase().startsWith('aurora')) return noPrice('Aurora instance: no defensible Aurora price yet');
  if (row.status === 'stopped') {
    return observedWithin(row.last_synced_at, RDS_STOPPED_STATUS_MAX_AGE_MS, now)
      ? { kind: 'not_running', reason: 'stopped DB instance: no DB instance-hour charge (storage and backups are still charged)' }
      : noPrice('stopped status older than seven days: RDS restarts a stopped instance after seven days');
  }
  if (row.region !== PRICED_REGION) return noPrice('region is not us-east-1');
  if (engine !== 'mysql' && engine !== 'mariadb') return noPrice('engine is not one the price table covers (MySQL, MariaDB)');
  if (m.multi_az !== false) return noPrice('Single-AZ deployment not established');
  if (row.status !== 'available') return noPrice('running state not established');
  const monthly = ownNumber(RDS_INSTANCE_MONTHLY_USD_US_EAST_1_MYSQL_SINGLE_AZ, m.db_instance_class);
  if (monthly === null) return noPrice('instance class not in the price table');
  if (finite(row.stored_monthly_cost) === null) return noPrice('no stored figure');
  return priced(monthly, 'instance hours only; excludes storage, I/O and backups');
}

/** gp3 includes 3,000 IOPS and 125 MiB/s; above that AWS charges extra, which the table leaves out. */
const GP3_BASELINE_IOPS = 3000;
const GP3_BASELINE_THROUGHPUT = 125;
/** Volume types whose whole charge is the per-GB rate (io1/io2 add IOPS, magnetic adds I/O requests). */
const EBS_STORAGE_ONLY_TYPES = new Set(['gp2', 'gp3', 'st1', 'sc1']);

function ebsCost(row: InventoryCostRow, m: Record<string, unknown>): InventoryCost {
  if (row.region !== PRICED_REGION) return noPrice('region is not us-east-1');
  if (row.status !== 'in-use' && row.status !== 'available') return noPrice('volume state not established');
  const type = typeof m.volume_type === 'string' ? m.volume_type : null;
  if (type === null || !EBS_STORAGE_ONLY_TYPES.has(type)) return noPrice('volume type not fully priced by the table');
  if (type === 'gp3') {
    const iops = finite(m.iops);
    const throughput = finite(m.throughput);
    if (iops === null || throughput === null || iops > GP3_BASELINE_IOPS || throughput > GP3_BASELINE_THROUGHPUT) {
      return noPrice('gp3 performance above the included baseline, or not recorded');
    }
  }
  const size = finite(m.size_gb);
  const rate = ownNumber(EBS_PER_GB_MONTH_USD, type);
  if (size === null || !(size > 0) || rate === null) return noPrice('volume size not recorded');
  if (finite(row.stored_monthly_cost) === null) return noPrice('no stored figure');
  return priced(size * rate, 'volume storage only');
}

function lambdaCost(row: InventoryCostRow, m: Record<string, unknown>): InventoryCost {
  if (row.region !== PRICED_REGION) return noPrice('region is not us-east-1');
  if (m.architecture !== 'x86_64') return noPrice('x86_64 architecture not established');
  if (typeof m.cost_basis !== 'string' || !m.cost_basis.startsWith('usage_based:')) return noPrice('no recorded usage basis');
  if (m.usage_state !== 'normal_usage' && m.usage_state !== 'zero_usage') return noPrice('usage not read on the latest discovery');
  const invocations = finite(m.invocations_30d);
  const duration = finite(m.avg_duration_ms);
  const memory = finite(m.memory);
  if (invocations === null || invocations < 0 || duration === null || duration < 0 || memory === null || !(memory > 0)) {
    return noPrice('usage inputs not recorded');
  }
  if (finite(row.stored_monthly_cost) === null) return noPrice('no stored figure');
  return priced(
    estimateLambdaMonthlyCostFromUsage(invocations, duration, memory),
    'requests and duration from 30 days of CloudWatch usage; excludes the free tier'
  );
}

/** The one rule: what a resource row's monthly cost is. */
export function inventoryCost(row: InventoryCostRow, now: Date = new Date()): InventoryCost {
  const m = metadataOf(row);
  if (row.status === 'terminated') return noPrice('terminated');
  switch (row.resource_type) {
    case 'vpc':
      return { kind: 'no_direct_charge', reason: 'a VPC itself has no charge' };
    case 'ec2':
      // F-6. Otherwise F-2 cannot be met: operating system and tenancy are not recorded.
      return row.status === 'stopped'
        ? { kind: 'not_running', reason: 'stopped instance: no instance-hour charge (EBS storage is charged separately)' }
        : noPrice('operating system and tenancy are not recorded');
    case 'rds':
      return rdsCost(row, m, now);
    case 'ebs':
      return ebsCost(row, m);
    case 'lambda':
      return lambdaCost(row, m);
    case 'aurora':
      return noPrice('Aurora cluster: no defensible Aurora price yet');
    default:
      // ECS (incl. Fargate, F-9), EKS, DynamoDB, API Gateway, ElastiCache, SQS, SNS, S3,
      // load balancers, CloudFront and anything else: their stored figure is a flat
      // placeholder, never a price.
      return noPrice('no defensible price for this resource type');
  }
}

/** USD with cents; a positive amount under a cent reads "<$0.01", never "$0.00". */
export function formatInventoryUsd(amount: number): string {
  if (amount > 0 && amount < 0.005) return '<$0.01';
  return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** The words for a non-priced kind (exports, report rows). */
export function inventoryCostWords(cost: Exclude<InventoryCost, { kind: 'priced' }>): string {
  switch (cost.kind) {
    case 'not_running': return NOT_RUNNING_TEXT;
    case 'no_direct_charge': return `${NO_DIRECT_CHARGE_TEXT}. ${VPC_SEPARATE_CHARGES_LINE}`;
    default: return NO_PRICE_TEXT;
  }
}

/** One cell: "$12.00 (us-east-1 list-price estimate; instance hours only)", or the kind's exact words. */
export function inventoryCostCell(cost: InventoryCost): string {
  return cost.kind === 'priced'
    ? `${formatInventoryUsd(cost.amount)} (${cost.basis}; ${cost.detail})`
    : inventoryCostWords(cost);
}

export interface InventoryCostTotal {
  /** K: resources with a priced figure. */
  pricedResources: number;
  /** N: every resource considered. */
  totalResources: number;
  /** Sum of priced amounts; null when nothing is priced (never 0 for "nothing priced"). */
  amount: number | null;
  notRunning: number;
  noDirectCharge: number;
  noPrice: number;
}

/** The one aggregation: sums only priced amounts and returns K of N. */
export function aggregateInventoryCosts(costs: readonly InventoryCost[]): InventoryCostTotal {
  let amount = 0;
  const total: InventoryCostTotal = { pricedResources: 0, totalResources: costs.length, amount: null, notRunning: 0, noDirectCharge: 0, noPrice: 0 };
  for (const c of costs) {
    if (c.kind === 'priced') { total.pricedResources++; amount += c.amount; }
    else if (c.kind === 'not_running') total.notRunning++;
    else if (c.kind === 'no_direct_charge') total.noDirectCharge++;
    else total.noPrice++;
  }
  total.amount = total.pricedResources > 0 ? amount : null;
  return total;
}

/** Rows straight to a total. */
export function aggregateInventoryRows(rows: readonly InventoryCostRow[], now: Date = new Date()): InventoryCostTotal {
  return aggregateInventoryCosts(rows.map((r) => inventoryCost(r, now)));
}

/** The completeness unit of every inventory estimate section: K of N resources priced. */
export const PRICED_RESOURCES_UNIT = 'discovered resources with a defensible price';

/** F-5's label: "Estimated from K of N priced resources". */
export function inventoryCoverageText(total: Pick<InventoryCostTotal, 'pricedResources' | 'totalResources'>): string {
  return `Estimated from ${total.pricedResources} of ${total.totalResources} priced resources`;
}
