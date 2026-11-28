/**
 * Placeholder-costs PR 1: every PR 1 surface goes through the shared inventory
 * pricing rule (services/inventory-cost.ts).
 *
 *   A1/A2  inventory export (CSV/PDF) and the scheduled report's CSV: the
 *          "Monthly Cost" column, and the PDF's basis note
 *   A3     the Cost Summary PDF (F-4): billed headline in both Cost Explorer
 *          states, the inventory appendix with "K of N", no "$0.00" for missing
 *   B1     AI top-estimated-resources evidence: priced rows only, their basis,
 *          partial coverage when anything is unpriced
 *   B1-B3  claim rules in every AI prompt
 *   D1/D2  the dashboard stats run-rate carries K of N; placeholders never make it a figure
 *
 * One legacy fixture inventory is used throughout: every flat placeholder stored
 * the old way (a value, no basis), a VPC 0, an Aurora cluster with two member
 * rows, a stopped EC2 instance, and two rows whose basis is established.
 */
import type { Pool } from 'pg';
import { AWSResourcesExportService, INVENTORY_COST_BASIS_NOTE } from '../awsResourcesExport.service';
import {
  costSummaryAppendixLines,
  costSummaryHeadlineLines,
  inventoryGroupCell,
  ReportGeneratorService,
  type BilledSpendHeadline,
} from '../report-generator.service';
import { AWSCostService, type MonthlyCost } from '../aws-cost.service';

import { LAMBDA_PRICED, LAMBDA_ZERO_AS_DISCOVERED, LAMBDA_ZERO_INCOMPLETE, LAMBDA_ZERO_PROVISIONED, LAMBDA_ZERO_USAGE, LEGACY_ROWS, MONEY_ZERO, PLACEHOLDER_AMOUNTS, legacyRow as row } from './inventory-cost-fixtures';

/** jsPDF text (uncompressed): every string drawn with Tj/TJ, unescaped and joined. */
function pdfText(buffer: Buffer): string {
  const raw = buffer.toString('latin1');
  const parts: string[] = [];
  const re = /\(((?:\\.|[^\\)])*)\)\s*Tj/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) parts.push(m[1].replace(/\\([()\\])/g, '$1'));
  return parts.join(' ');
}

function mockClient(rows: unknown[]) {
  return {
    query: jest.fn(async (sql: string) => (/COUNT\(\*\) as total/i.test(sql) ? { rows: [{ total: String(rows.length) }] } : { rows })),
  } as unknown as Pool;
}

describe('A1/A2: the inventory export "Monthly Cost" column', () => {
  const cell = (r: unknown) => (AWSResourcesExportService as any).COLUMN_MAPPINGS.cost.formatter(r) as string;

  it('every flat placeholder and every unpriced row reads "No price"', () => {
    for (const r of LEGACY_ROWS.filter((x) => !['network', 'ec2-stopped', 'orders-db', 'data-vol'].includes(x.resource_name))) {
      expect({ name: r.resource_name, cell: cell(r) }).toEqual({ name: r.resource_name, cell: 'No price' });
    }
  });

  it('VPC, stopped EC2 and priced rows read their exact words, with the basis', () => {
    const byName = (n: string) => cell(LEGACY_ROWS.find((r) => r.resource_name === n));
    expect(byName('network')).toBe('No direct charge. NAT gateways, endpoints and data transfer are charged separately.');
    expect(byName('ec2-stopped')).toBe('Not running: no instance-hour charge');
    expect(byName('orders-db')).toBe('$124.83 (us-east-1 list-price estimate; instance hours only; excludes storage, I/O and backups)');
    // Fix round 1 (ruling 8): stored 'stopped' but AWS said "stopping" -> No price.
    expect(byName('ec2-stopping')).toBe('No price');
    expect(byName('data-vol')).toBe('$20.00 (us-east-1 list-price estimate; volume storage only)');
  });

  it('the CSV (export and scheduled report) never shows a placeholder amount or a money zero', async () => {
    const csv = (await new AWSResourcesExportService(mockClient(LEGACY_ROWS)).generateCSV('org', {}, ['resource_name', 'resource_type', 'cost'])).toString('utf8');
    for (const amount of PLACEHOLDER_AMOUNTS) expect(csv).not.toContain(`$${amount}`);
    expect(csv).not.toMatch(MONEY_ZERO);
    expect(csv).toContain('orders-db,RDS,"$124.83 (us-east-1 list-price estimate; instance hours only; excludes storage, I/O and backups)"');
    expect(csv.split('\n')[0]).toBe('Resource Name,Resource Type,Monthly Cost');
  });

  it('the scheduled Cost Summary CSV uses the same column', async () => {
    const service = new ReportGeneratorService(mockClient(LEGACY_ROWS), async () => { throw new Error('AWS_NOT_CONNECTED'); });
    const { csv } = await service.generateCostSummaryReport({ organizationId: 'org', format: 'csv' });
    const text = csv!.toString('utf8');
    expect(text).toContain('Monthly Cost');
    expect(text).toContain('No price');
    for (const amount of PLACEHOLDER_AMOUNTS) expect(text).not.toContain(`$${amount}`);
  });

  it('the PDF carries the basis note when the column is exported, and only then', async () => {
    const service = new AWSResourcesExportService(mockClient(LEGACY_ROWS));
    const withCost = pdfText(await service.generatePDF('org', {}, ['resource_name', 'cost']));
    expect(withCost).toContain('us-east-1 list-price estimate');
    // Fix round 1 (ruling 9): the column's coverage, N excluding not-running / no-direct-charge.
    expect(withCost).toContain(`Monthly Cost coverage: 2 of ${LEGACY_ROWS.length - 2} priced · 2 not running, with no direct charge, or with no billable usage.`);
    expect(withCost).toContain('it is not $0');
    expect(withCost).toContain('No price');
    for (const amount of PLACEHOLDER_AMOUNTS) expect(withCost).not.toContain(`$${amount}`);
    const withoutCost = pdfText(await service.generatePDF('org', {}, ['resource_name']));
    expect(withoutCost).not.toContain('list-price estimate');
    expect(INVENTORY_COST_BASIS_NOTE.join(' ')).toContain('not AWS billed spend');
  });
});

describe('A3: Cost Summary report (F-4)', () => {
  const billed = (total: number, state = 'month_to_date'): MonthlyCost => ({
    total,
    byService: [{ service: 'Amazon Relational Database Service', amount: total * 0.6 }, { service: 'Amazon Elastic Compute Cloud - Compute', amount: total * 0.4 }],
    period: { start: '2026-11-01', end: '2026-11-28' },
    previousMonth: null,
    monthState: { state, amountUsable: state !== 'no_billed_days_yet' } as unknown as MonthlyCost['monthState'],
  });
  const fetchSummary = (rows: unknown[], reader: (org: string) => Promise<MonthlyCost>) =>
    (new ReportGeneratorService({} as Pool, reader) as any).fetchCostSummaryData('org', {}, mockClient(rows));
  const pdf = async (rows: unknown[], reader: (org: string) => Promise<MonthlyCost>) =>
    pdfText((await new ReportGeneratorService(mockClient(rows), reader).generateCostSummaryReport({ organizationId: 'org', format: 'pdf' })).pdf!);

  it('Cost Explorer usable: the headline is billed spend, labelled "billed", account-wide', async () => {
    const data = await fetchSummary(LEGACY_ROWS, async () => billed(1234.5));
    expect(data.billed).toMatchObject({ state: 'usable', amount: 1234.5 });
    expect(costSummaryHeadlineLines(data.billed)).toEqual([
      'Billed spend, month to date: $1,234.50',
      'AWS Cost Explorer, billed 2026-11-01 through 2026-11-27 (UTC).',
      "Account-wide billed spend: not filtered by this report's resource filters.",
    ]);
    const text = await pdf(LEGACY_ROWS, async () => billed(1234.5));
    expect(text).toContain('Billed spend, month to date: $1,234.50');
    expect(text).toContain('Billed spend by AWS service');
    expect(text).not.toContain('Total Monthly Cost');
  });

  it.each([
    ['Cost Explorer fails', async () => { throw new Error('ThrottlingException'); }, 'the AWS Cost Explorer request failed'],
    ['no connected account', async () => { throw new Error('AWS_NOT_CONNECTED: none'); }, 'no connected AWS account'],
    ['no billed days yet', async () => billed(0, 'no_billed_days_yet'), 'AWS Cost Explorer has no billed days yet this month'],
  ])('Cost Explorer unusable (%s): the headline says billed spend is unavailable -- never an inventory sum, never $0.00', async (_n, reader, reason) => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const data = await fetchSummary(LEGACY_ROWS, reader as () => Promise<MonthlyCost>);
    expect(data.billed).toEqual({ state: 'unavailable', reason });
    const lines = costSummaryHeadlineLines(data.billed);
    expect(lines[0]).toBe('Billed spend: unavailable');
    expect(lines.join(' ')).not.toMatch(/\$\d/);
    const text = await pdf(LEGACY_ROWS, reader as () => Promise<MonthlyCost>);
    expect(text).toContain('Billed spend: unavailable');
    expect(text).not.toContain('Total Monthly Cost');
    expect(text).not.toMatch(MONEY_ZERO);
  });

  it('a real $0.00 billed month is billing data and is shown as such', () => {
    const lines = costSummaryHeadlineLines({ state: 'usable', amount: 0, periodStart: '2026-11-01', periodEndExclusive: '2026-11-03', latestDaysUpdating: true, topServices: [] } as BilledSpendHeadline);
    expect(lines[0]).toBe('Billed spend, month to date: $0.00');
    expect(lines[1]).toContain('latest days are still updating');
  });

  it('the appendix sums only priced rows with "K of N resources priced"; groups and the top 10 list priced rows only', async () => {
    const data = await fetchSummary(LEGACY_ROWS, async () => billed(10));
    expect(data.inventory).toMatchObject({ pricedResources: 2, totalResources: LEGACY_ROWS.length - 2, excludedResources: 2, amount: expect.closeTo(144.83, 6) });
    expect(costSummaryAppendixLines(data.inventory)).toEqual([
      `Coverage: 2 of ${LEGACY_ROWS.length - 2} priced · 2 not running, with no direct charge, or with no billable usage.`,
      'Estimated monthly cost of the 2 priced resources: $144.83 (us-east-1 list-price estimate; not AWS billed spend). Resources without a price are not included and are not $0.',
    ]);
    expect(data.topPriced.map((r: { resource: string }) => r.resource)).toEqual(['orders-db', 'data-vol']);
    const prod = data.inventoryByEnvironment.find((g: { name: string }) => g.name === 'production');
    const unknown = data.inventoryByEnvironment.find((g: { name: string }) => g.name === 'Unknown');
    expect(inventoryGroupCell(prod.total)).toBe('$144.83 (us-east-1 list-price estimate)');
    expect(inventoryGroupCell(unknown.total)).toBe('No price');
    const text = await pdf(LEGACY_ROWS, async () => billed(10));
    for (const amount of PLACEHOLDER_AMOUNTS) expect(text).not.toContain(`$${amount}`);
    expect(text).toContain('No price');
  });

  it('nothing priced: no inventory total at all (never "$0.00"), and no row shows "$0.00"', async () => {
    const unpriced = LEGACY_ROWS.filter((r) => !['orders-db', 'data-vol'].includes(r.resource_name));
    const data = await fetchSummary(unpriced, async () => { throw new Error('x'); });
    expect(data.inventory.amount).toBeNull();
    expect(data.topPriced).toEqual([]);
    expect(costSummaryAppendixLines(data.inventory)[1]).toBe('No resource has a defensible price, so there is no inventory estimate.');
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const text = await pdf(unpriced, async () => { throw new Error('x'); });
    expect(text).not.toMatch(MONEY_ZERO);
    expect(text).toContain('No resource has a defensible price.');
  });

  it('a NULL-cost row never becomes $0.00 (the old parseFloat(r.cost || 0))', async () => {
    const data = await fetchSummary([row('fn', 'lambda', null)], async () => billed(5));
    expect(data.topPriced).toEqual([]);
    expect(data.inventory).toMatchObject({ pricedResources: 0, totalResources: 1, excludedResources: 0, amount: null });
  });
});

describe('D1/D2: the run-rate fallback and the "has billing data" figure', () => {
  const service = (rows: unknown[]) => new AWSCostService({ query: jest.fn(async () => ({ rows })) } as unknown as Pool);

  it('sums only priced resources and reports K of N', async () => {
    await expect(service(LEGACY_ROWS).getInventoryPricedRunRate('org')).resolves.toMatchObject({ pricedResources: 2, totalResources: LEGACY_ROWS.length - 2, excludedResources: 2, amount: expect.closeTo(144.83, 6) });
  });

  it('D2: placeholders alone never become a spend figure (amount 0 -> statsHasSpendFigure false), with 0 of N', async () => {
    const unpriced = LEGACY_ROWS.filter((r) => !['orders-db', 'data-vol'].includes(r.resource_name));
    const s = service(unpriced);
    jest.spyOn(s, 'fetchMonthlyCosts').mockRejectedValue(new Error('AccessDeniedException'));
    await expect(s.getMonthlySpendWithFallback('org')).resolves.toEqual({
      amount: 0, source: 'estimated', estimateCoverage: { pricedResources: 0, totalResources: unpriced.length - 2, excludedResources: 2, pricedLambdaResources: 0 },
    });
  });

});

describe('review fix round: Lambda in totals (S-2) and zero-usage Lambda (never $0.00)', () => {
  const cell = (r: unknown) => (AWSResourcesExportService as any).COLUMN_MAPPINGS.cost.formatter(r) as string;
  const billed = (total: number): MonthlyCost => ({
    total, byService: [], period: { start: '2026-11-01', end: '2026-11-28' }, previousMonth: null,
    monthState: { state: 'month_to_date', amountUsable: true } as unknown as MonthlyCost['monthState'],
  });
  const fetchSummary = (rows: unknown[]) =>
    (new ReportGeneratorService({} as Pool, async () => billed(10)) as any).fetchCostSummaryData('org', {}, mockClient(rows));
  const pdf = async (rows: unknown[]) =>
    pdfText((await new ReportGeneratorService(mockClient(rows), async () => billed(10)).generateCostSummaryReport({ organizationId: 'org', format: 'pdf' })).pdf!);
  const exportCsv = async (rows: unknown[]) =>
    (await new AWSResourcesExportService(mockClient(rows)).generateCSV('org', {}, ['resource_name', 'cost'])).toString('utf8');

  it('export: a zero-usage function reads "No billable usage recorded"; incomplete usage reads "No price"; neither is $0.00', async () => {
    expect(cell(LAMBDA_ZERO_USAGE)).toBe('No billable usage recorded');
    expect(cell(LAMBDA_ZERO_INCOMPLETE)).toBe('No price');
    const csv = await exportCsv([LAMBDA_ZERO_USAGE, LAMBDA_ZERO_INCOMPLETE]);
    expect(csv).toContain('No billable usage recorded');
    expect(csv).not.toMatch(MONEY_ZERO);
    expect(INVENTORY_COST_BASIS_NOTE.join(' ')).toContain('"No billable usage recorded" is a Lambda function with provisioned concurrency confirmed absent and no invocations');
    expect(INVENTORY_COST_BASIS_NOTE.join(' ')).toContain('A Lambda figure is requests and duration at us-east-1 list price, before free tier');
  });

  it('follow-up ruling: zero invocations with provisioned concurrency configured or unknown is "No price" on every surface', async () => {
    // Configured: billed with no requests.
    expect(cell(LAMBDA_ZERO_PROVISIONED)).toBe('No price');
    // Unknown: discovery records no provisioned concurrency today, so every real zero-usage row reads "No price".
    expect(cell(LAMBDA_ZERO_AS_DISCOVERED)).toBe('No price');
    const rows = [LAMBDA_ZERO_PROVISIONED, LAMBDA_ZERO_AS_DISCOVERED];
    const csv = await exportCsv(rows);
    expect(csv).not.toContain('No billable usage recorded');
    expect(csv).not.toMatch(MONEY_ZERO);
    const data = await fetchSummary(rows);
    // Unpriced: inside N, never in M, never a total.
    expect(data.inventory).toMatchObject({ pricedResources: 0, totalResources: 2, excludedResources: 0, noBillableUsage: 0, amount: null });
    const pdfText = await pdf(rows);
    // The only occurrence is the basis note's legend line; no row, group or total uses the label.
    const occurrences = (t: string) => t.split('No billable usage recorded').length - 1;
    expect(occurrences(pdfText)).toBe(occurrences(INVENTORY_COST_BASIS_NOTE.join(' ')));
    expect(pdfText).toContain('Unknown 0 of 2 priced No price');
    expect(pdfText).not.toMatch(MONEY_ZERO);
  });

  it('report appendix and group cells: a total that sums a Lambda figure says "Lambda before free tier"', async () => {
    const data = await fetchSummary([...LEGACY_ROWS, LAMBDA_PRICED]);
    expect(data.inventory).toMatchObject({ pricedResources: 3, pricedLambdaResources: 1 });
    const lines = costSummaryAppendixLines(data.inventory);
    expect(lines[1]).toMatch(/^Estimated monthly cost of the 3 priced resources: \$[\d,.]+ \(us-east-1 list-price estimates; Lambda before free tier; not AWS billed spend\)\./);
    const unknownEnv = data.inventoryByEnvironment.find((g: { name: string }) => g.name === 'Unknown');
    const prod = data.inventoryByEnvironment.find((g: { name: string }) => g.name === 'production');
    expect(inventoryGroupCell(unknownEnv.total)).toMatch(/^\$[\d,.]+ \(us-east-1 list-price estimates; Lambda before free tier\)$/);
    expect(inventoryGroupCell(prod.total)).toBe('$144.83 (us-east-1 list-price estimate)');
    expect(await pdf([...LEGACY_ROWS, LAMBDA_PRICED])).toContain('Lambda before free tier');
  });

  it('report: zero-usage functions alone give no total (never $0.00) and are counted outside N', async () => {
    const data = await fetchSummary([LAMBDA_ZERO_USAGE, LAMBDA_ZERO_INCOMPLETE]);
    expect(data.inventory).toMatchObject({ pricedResources: 0, totalResources: 1, excludedResources: 1, amount: null });
    expect(costSummaryAppendixLines(data.inventory)).toEqual([
      'Coverage: 0 of 1 priced · 1 not running, with no direct charge, or with no billable usage.',
      'No resource has a defensible price, so there is no inventory estimate.',
    ]);
    expect(await pdf([LAMBDA_ZERO_USAGE, LAMBDA_ZERO_INCOMPLETE])).not.toMatch(MONEY_ZERO);
  });

  it('run-rate fallback carries how many priced figures are Lambda (the label\'s qualification)', async () => {
    const s = new AWSCostService({ query: jest.fn(async () => ({ rows: [...LEGACY_ROWS, LAMBDA_PRICED, LAMBDA_ZERO_USAGE] })) } as unknown as Pool);
    jest.spyOn(s, 'fetchMonthlyCosts').mockRejectedValue(new Error('AccessDeniedException'));
    const r = await s.getMonthlySpendWithFallback('org');
    expect(r.estimateCoverage).toEqual({ pricedResources: 3, totalResources: LEGACY_ROWS.length - 1, excludedResources: 3, pricedLambdaResources: 1 });
  });
});
