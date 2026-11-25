/**
 * C1b: the regional RDS on-demand instance-hour price table
 * (config/rds-instance-prices.json, built by scripts/build-rds-instance-prices.js)
 * and its lookup (config/aws-pricing.ts rdsInstanceHourlyPrice).
 *
 * The lookup key is exactly region + engine + licence model + instance class +
 * deployment. Each dimension changes the answer; anything not in the table
 * exactly is null -- no fallback to another region, engine, licence or
 * deployment, never a doubled Single-AZ price, never $0. The build script's
 * uniqueness check fails closed (nothing written) on a duplicate, $0 or missing
 * price file. Pinned values are from the evidence sample
 * (review-logs/cost-optimization/c1b-evidence/sample.tsv), version 20261124233028.
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  EBS_SNAPSHOT_STANDARD_PER_GB_MONTH_USD_BY_REGION,
  NAT_GATEWAY_HOURLY_USD_BY_REGION,
  RDS_INSTANCE_HOURLY_PRICE_SOURCE,
  rdsInstanceHourlyPrice,
  rdsPricedEngineLicence,
  rdsPricedRegion,
  type RdsInstancePriceKey,
} from '../aws-pricing';
import PRICE_FILE from '../rds-instance-prices.json';

const table = PRICE_FILE as unknown as {
  source: Record<string, unknown> & { region_sha256: Record<string, string> };
  prices: Record<string, Record<string, Record<string, [number | null, number | null]>>>;
};

const PG = { engine: 'postgres', licenseModel: 'postgresql-license' };
const MYSQL = { engine: 'mysql', licenseModel: 'general-public-license' };
const key = (overrides: Partial<RdsInstancePriceKey>): RdsInstancePriceKey => ({
  region: 'us-east-1', ...PG, instanceClass: 'db.m5.large', multiAz: false, ...overrides,
});

describe('the price table: provenance and shape', () => {
  it('names its source, version, publication and retrieval dates', () => {
    expect(RDS_INSTANCE_HOURLY_PRICE_SOURCE).toEqual({
      url: 'https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonRDS/current/region_index.json',
      version: '20261124233028',
      published: '2026-11-24T23:30:28Z',
      retrieved: '2026-11-25',
    });
    expect(table.source.offer_url_template).toBe('https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonRDS/<version>/<region>/index.json');
  });

  it('covers exactly the 34 commercial regions of the snapshot and NAT tables, each with its offer file hash; no GovCloud or Local Zone', () => {
    const regions = Object.keys(table.prices).sort();
    expect(regions).toHaveLength(34);
    expect(regions).toEqual(Object.keys(NAT_GATEWAY_HOURLY_USD_BY_REGION).sort());
    expect(regions).toEqual(Object.keys(EBS_SNAPSHOT_STANDARD_PER_GB_MONTH_USD_BY_REGION).sort());
    expect(Object.keys(table.source.region_sha256).sort()).toEqual(regions);
    for (const hash of Object.values(table.source.region_sha256)) expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(regions.filter((r) => r.startsWith('us-gov-') || r.split('-').length > 3)).toEqual([]);
  });

  it('stores lookup fields only: every row is [Single-AZ, Multi-AZ], each a positive finite $/hour or null, at least one set', () => {
    let rows = 0;
    for (const byPair of Object.values(table.prices)) {
      for (const [pair, byClass] of Object.entries(byPair)) {
        expect(pair).toMatch(/^[a-z0-9-]+\|[a-z-]+$/);
        for (const [cls, row] of Object.entries(byClass)) {
          rows++;
          expect(cls).toMatch(/^db\.[a-z0-9.-]+$/);
          expect(row).toHaveLength(2);
          expect(row.some((p) => p !== null)).toBe(true);
          for (const p of row) if (p !== null) expect(Number.isFinite(p) && p > 0).toBe(true);
        }
      }
    }
    expect(rows).toBe(34096);
    expect(Object.keys(table)).toEqual(['source', 'prices']);
  });

  it('prices only the approved engine/licence pairs (no Oracle CDB, SQL Server Developer or Db2 marketplace)', () => {
    const pairs = new Set(Object.values(table.prices).flatMap((byPair) => Object.keys(byPair)));
    expect([...pairs].sort()).toEqual([
      'db2-ae|bring-your-own-license', 'db2-se|bring-your-own-license',
      'mariadb|general-public-license', 'mysql|general-public-license',
      'oracle-ee|bring-your-own-license', 'oracle-se2|bring-your-own-license', 'oracle-se2|license-included',
      'postgres|postgresql-license',
      'sqlserver-ee|license-included', 'sqlserver-ex|license-included', 'sqlserver-se|license-included', 'sqlserver-web|license-included',
    ]);
  });
});

describe('rdsInstanceHourlyPrice: each key dimension decides the price', () => {
  it('exact hits from the evidence sample', () => {
    expect(rdsInstanceHourlyPrice(key({}))).toBe(0.178);
    expect(rdsInstanceHourlyPrice(key({ multiAz: true }))).toBe(0.356);
    expect(rdsInstanceHourlyPrice(key({ instanceClass: 'db.t3.micro' }))).toBe(0.018);
    expect(rdsInstanceHourlyPrice(key({ engine: 'sqlserver-se', licenseModel: 'license-included', multiAz: true }))).toBe(1.954);
  });

  it('region: the same database costs more in eu-west-1 and af-south-1 than in us-east-1', () => {
    expect(rdsInstanceHourlyPrice(key({ region: 'eu-west-1' }))).toBe(0.197);
    expect(rdsInstanceHourlyPrice(key({ region: 'af-south-1' }))).toBe(0.234);
  });

  it('engine: MySQL and PostgreSQL differ for the same class, region and deployment', () => {
    expect(rdsInstanceHourlyPrice(key({ ...MYSQL }))).toBe(0.171);
    expect(rdsInstanceHourlyPrice(key({ ...MYSQL, multiAz: true }))).toBe(0.342);
    expect(rdsInstanceHourlyPrice(key({ ...MYSQL }))).not.toBe(rdsInstanceHourlyPrice(key({})));
  });

  it('licence model: Oracle SE2 bring-your-own-license and license-included are different prices', () => {
    expect(rdsInstanceHourlyPrice(key({ engine: 'oracle-se2', licenseModel: 'bring-your-own-license' }))).toBe(0.171);
    expect(rdsInstanceHourlyPrice(key({ engine: 'oracle-se2', licenseModel: 'license-included' }))).toBe(0.438);
  });

  it('instance class: a different class is a different price', () => {
    expect(rdsInstanceHourlyPrice(key({ instanceClass: 'db.t3.medium' }))).toBe(0.072);
  });

  it('deployment: Multi-AZ is AWS\'s own Multi-AZ price, not 2 x Single-AZ (SQL Server Web db.m5.large: 0.311 vs 0.5544)', () => {
    const web = { engine: 'sqlserver-web', licenseModel: 'license-included' };
    const single = rdsInstanceHourlyPrice(key({ ...web }));
    const multi = rdsInstanceHourlyPrice(key({ ...web, multiAz: true }));
    expect(single).toBe(0.311);
    expect(multi).toBe(0.5544);
    expect(multi).not.toBe(2 * (single as number));
    // PostgreSQL db.t3.medium is not exactly 2x either (0.072 vs 0.145).
    expect(rdsInstanceHourlyPrice(key({ instanceClass: 'db.t3.medium', multiAz: true }))).toBe(0.145);
  });
});

describe('rdsInstanceHourlyPrice: no fallback of any kind, never $0', () => {
  it.each([
    ['a GovCloud region (not in the table)', { region: 'us-gov-west-1' }],
    ['an unknown region', { region: 'xx-nowhere-1' }],
    ['a Local Zone "region"', { region: 'us-west-2-lax-1' }],
    ['no region', { region: undefined }],
    ['an empty region', { region: '' }],
    ['an unknown engine', { engine: 'nosql' }],
    ['no engine', { engine: null }],
    ['a licence model that engine never has (postgres + general-public-license)', { licenseModel: 'general-public-license' }],
    ['no licence model', { licenseModel: undefined }],
    ['Oracle CDB (Q4)', { engine: 'oracle-ee-cdb', licenseModel: 'bring-your-own-license' }],
    ['Oracle SE2 CDB, licence included (Q4)', { engine: 'oracle-se2-cdb', licenseModel: 'license-included' }],
    ['SQL Server Developer (Q4)', { engine: 'sqlserver-dev-ee', licenseModel: 'bring-your-own-media' }],
    ['SQL Server Developer, licence included (Q4)', { engine: 'sqlserver-dev-ee', licenseModel: 'license-included' }],
    ['Db2 marketplace (Q4)', { engine: 'db2-se', licenseModel: 'marketplace-license' }],
    ['an unknown class', { instanceClass: 'db.z9.huge' }],
    ['no class', { instanceClass: '' }],
    ['unknown deployment (undefined)', { multiAz: undefined }],
    ['unknown deployment (null)', { multiAz: null }],
    ['a prototype key as region', { region: '__proto__' }],
    ['a prototype key as class', { instanceClass: 'constructor' }],
    ['a prototype key as class (toString)', { instanceClass: 'toString' }],
    ['a "|" smuggled into the engine', { engine: 'postgres|postgresql-license', licenseModel: 'x' }],
  ])('%s -> null', (_label, overrides) => {
    expect(rdsInstanceHourlyPrice(key(overrides as Partial<RdsInstancePriceKey>))).toBeNull();
  });

  it('a non-boolean MultiAZ is never read as Single-AZ', () => {
    expect(rdsInstanceHourlyPrice(key({ multiAz: 'false' as unknown as boolean }))).toBeNull();
    expect(rdsInstanceHourlyPrice(key({ multiAz: 0 as unknown as boolean }))).toBeNull();
  });

  it('a deployment AWS does not publish is null, never doubled (SQL Server Express has no Multi-AZ price)', () => {
    const express = { engine: 'sqlserver-ex', licenseModel: 'license-included', instanceClass: 'db.t3.micro' };
    expect(rdsInstanceHourlyPrice(key({ ...express }))).toBe(0.022);
    expect(rdsInstanceHourlyPrice(key({ ...express, multiAz: true }))).toBeNull();
  });

  it('a class priced in one region is not borrowed by a region that does not price it', () => {
    const inUsEast1 = Object.keys(table.prices['us-east-1']['postgres|postgresql-license']);
    const inMeCentral1 = new Set(Object.keys(table.prices['me-central-1']['postgres|postgresql-license']));
    const missing = inUsEast1.find((cls) => !inMeCentral1.has(cls)) as string;
    expect(missing).toBeDefined();
    expect(rdsInstanceHourlyPrice(key({ instanceClass: missing }))).not.toBeNull();
    expect(rdsInstanceHourlyPrice(key({ region: 'me-central-1', instanceClass: missing }))).toBeNull();
  });

  it('every price the lookup can return is above $0', () => {
    for (const [region, byPair] of Object.entries(table.prices)) {
      for (const [pair, byClass] of Object.entries(byPair)) {
        const [engine, licenseModel] = pair.split('|');
        for (const instanceClass of Object.keys(byClass)) {
          for (const multiAz of [false, true]) {
            const price = rdsInstanceHourlyPrice({ region, engine, licenseModel, instanceClass, multiAz });
            if (price !== null) expect(price).toBeGreaterThan(0);
          }
        }
      }
    }
  }, 60_000); // ~68,000 lookups
});

describe('rdsPricedRegion / rdsPricedEngineLicence', () => {
  it('regions: the 34 in the table only', () => {
    expect(rdsPricedRegion('us-east-1')).toBe(true);
    expect(rdsPricedRegion('us-gov-west-1')).toBe(false);
    expect(rdsPricedRegion('__proto__')).toBe(false);
    expect(rdsPricedRegion(undefined)).toBe(false);
  });

  it('engine/licence pairs: the approved ones only', () => {
    expect(rdsPricedEngineLicence('postgres', 'postgresql-license')).toBe(true);
    expect(rdsPricedEngineLicence('oracle-ee-cdb', 'bring-your-own-license')).toBe(false);
    expect(rdsPricedEngineLicence('sqlserver-dev-ee', 'bring-your-own-media')).toBe(false);
    expect(rdsPricedEngineLicence('db2-se', 'marketplace-license')).toBe(false);
    expect(rdsPricedEngineLicence('postgres', undefined)).toBe(false);
  });
});

// ─── The build script's uniqueness check ────────────────────────────────────

const SCRIPT = path.resolve(__dirname, '../../../scripts/build-rds-instance-prices.js');
const VERSION = '20990101000000';

function offer(region: string, skus: Array<{ sku: string; attrs: Record<string, string>; usd: string; unit?: string; family?: string }>) {
  const products: Record<string, unknown> = {};
  const onDemand: Record<string, unknown> = {};
  for (const s of skus) {
    products[s.sku] = { sku: s.sku, productFamily: s.family ?? 'Database Instance', attributes: { regionCode: region, locationType: 'AWS Region', ...s.attrs } };
    onDemand[s.sku] = { [`${s.sku}.T`]: { priceDimensions: { [`${s.sku}.T.D`]: { unit: s.unit ?? 'Hrs', pricePerUnit: { USD: s.usd } } } } };
  }
  return { version: VERSION, publicationDate: '2099-01-01T00:00:00Z', products, terms: { OnDemand: onDemand } };
}

const pg = (cls: string, deployment: string, extra: Record<string, string> = {}) => ({
  databaseEngine: 'PostgreSQL', licenseModel: 'No license required', instanceType: cls, deploymentOption: deployment,
  usagetype: `${deployment === 'Single-AZ' ? 'InstanceUsage' : 'Multi-AZUsage'}:${cls}`, ...extra,
});

function workDir(regions: Record<string, ReturnType<typeof offer> | null>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c1b-prices-'));
  const index = { publicationDate: '2099-01-01T00:00:00Z', regions: Object.fromEntries(Object.keys(regions).map((r) => [r, { regionCode: r, currentVersionUrl: `/offers/v1.0/aws/AmazonRDS/${VERSION}/${r}/index.json` }])) };
  fs.writeFileSync(path.join(dir, 'region_index.json'), JSON.stringify(index));
  for (const [region, body] of Object.entries(regions)) if (body) fs.writeFileSync(path.join(dir, `${region}.json`), JSON.stringify(body));
  return dir;
}

function build(dir: string): { status: number; stdout: string; out: string } {
  const out = path.join(dir, 'out.json');
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, '--dir', dir, '--out', out, '--retrieved', '2099-01-02'], { encoding: 'utf8' });
    return { status: 0, stdout, out };
  } catch (error) {
    const e = error as { status: number; stdout: string };
    return { status: e.status, stdout: e.stdout, out };
  }
}

describe('build-rds-instance-prices.js: the uniqueness check fails closed', () => {
  const dirs: string[] = [];
  afterAll(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
  const run = (regions: Record<string, ReturnType<typeof offer> | null>) => { const d = workDir(regions); dirs.push(d); return build(d); };

  it('a clean region passes and writes only the lookup fields, keyed by the DescribeDBInstances values; excluded SKUs are ignored', () => {
    const result = run({
      'us-east-1': offer('us-east-1', [
        { sku: 'A', attrs: pg('db.m5.large', 'Single-AZ'), usd: '0.1780000000' },
        { sku: 'B', attrs: pg('db.m5.large', 'Multi-AZ'), usd: '0.3560000000' },
        // Ignored: a capacity reservation, RDS Custom, Outposts, Aurora, a Multi-AZ DB cluster, storage.
        { sku: 'C', attrs: pg('db.m5.large', 'Single-AZ', { usagetype: 'UnusedBox:db.m5.large' }), usd: '9' },
        { sku: 'D', attrs: pg('db.m5.large', 'Single-AZ', { deploymentModel: 'Custom' }), usd: '9' },
        { sku: 'E', attrs: pg('db.m5.large', 'Single-AZ', { locationType: 'AWS Outposts' }), usd: '9' },
        { sku: 'F', attrs: pg('db.m5.large', 'Single-AZ', { databaseEngine: 'Aurora PostgreSQL' }), usd: '9' },
        { sku: 'G', attrs: pg('db.m5.large', 'Multi-AZ (readable standbys)', { usagetype: 'Multi-AZClusterUsage:db.m5.large' }), usd: '9' },
        { sku: 'H', attrs: { volumeType: 'General Purpose' }, usd: '0.115', unit: 'GB-Mo', family: 'Database Storage' },
      ]),
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('PASS us-east-1');
    const written = JSON.parse(fs.readFileSync(result.out, 'utf8'));
    expect(written.prices).toEqual({ 'us-east-1': { 'postgres|postgresql-license': { 'db.m5.large': [0.178, 0.356] } } });
    expect(written.source).toMatchObject({ version: VERSION, published: '2099-01-01T00:00:00Z', retrieved: '2099-01-02' });
  });

  it.each([
    ['two different prices for one identity', [{ sku: 'A', attrs: pg('db.m5.large', 'Single-AZ'), usd: '0.178' }, { sku: 'B', attrs: pg('db.m5.large', 'Single-AZ', { usagetype: 'MirrorUsage:db.m5.large' }), usd: '0.2' }]],
    ['a $0 price', [{ sku: 'A', attrs: pg('db.m5.large', 'Single-AZ'), usd: '0.0000000000' }]],
    ['a non-hourly unit', [{ sku: 'A', attrs: pg('db.m5.large', 'Single-AZ'), usd: '0.178', unit: 'Quantity' }]],
  ])('%s: the region fails and nothing is written', (_label, skus) => {
    const result = run({ 'us-east-1': offer('us-east-1', skus as Parameters<typeof offer>[1]) });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('FAIL us-east-1');
    expect(result.stdout).toContain('STOP');
    expect(fs.existsSync(result.out)).toBe(false);
  });

  it('a region file missing from the directory fails the whole build', () => {
    const result = run({ 'us-east-1': offer('us-east-1', [{ sku: 'A', attrs: pg('db.m5.large', 'Single-AZ'), usd: '0.178' }]), 'eu-west-1': null });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('FAIL eu-west-1: file missing');
    expect(fs.existsSync(result.out)).toBe(false);
  });

  it('a region file of another version fails', () => {
    const stale = { ...offer('us-east-1', [{ sku: 'A', attrs: pg('db.m5.large', 'Single-AZ'), usd: '0.178' }]), version: '20000101000000' };
    const result = run({ 'us-east-1': stale });
    expect(result.status).toBe(1);
    expect(fs.existsSync(result.out)).toBe(false);
  });
});
