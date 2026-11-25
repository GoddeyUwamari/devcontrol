#!/usr/bin/env node
/**
 * Builds backend/src/config/rds-instance-prices.json, the regional on-demand
 * instance-hour prices the idle RDS rule's estimate uses (C1b). Run by hand,
 * never at runtime; it makes no network call.
 *
 * Input: a directory holding AWS's public RDS Price List bulk offer files for
 * ONE published version, downloaded beforehand:
 *   <dir>/region_index.json  from https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonRDS/current/region_index.json
 *   <dir>/<region>.json      from https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonRDS/<version>/<region>/index.json
 *                            for EVERY region the index lists.
 *
 *   node backend/scripts/build-rds-instance-prices.js --dir <dir> --check-only
 *   node backend/scripts/build-rds-instance-prices.js --dir <dir> --out backend/src/config/rds-instance-prices.json [--retrieved YYYY-MM-DD] [--sample <file>]
 *
 * The uniqueness check runs first, over every region in the index: for every
 * running-instance price identity (region, engine + edition, licence model,
 * instance class, Single-AZ / Multi-AZ) there must be exactly one on-demand
 * price, in USD per hour, above zero. Any region failing that, or any file
 * that is missing, of another version or unreadable, stops the build: nothing
 * is written.
 *
 * Kept SKUs ("running-instance" prices): productFamily 'Database Instance',
 * locationType 'AWS Region' (not Outposts), not Aurora, deploymentModel not
 * 'Custom' (RDS Custom), deploymentOption 'Single-AZ' or 'Multi-AZ', usage type
 * InstanceUsage / Multi-AZUsage / MirrorUsage (not UnusedBox capacity
 * reservations, Aurora I/O-Optimized, or Multi-AZ DB clusters). The idle RDS
 * rule never evaluates Aurora, RDS Custom or cluster members.
 *
 * Output (only what the lookup needs):
 *   { "source": {...provenance: URLs, version, published, retrieved, unit...},
 *     "prices": { "<region>": { "<api engine>|<api licence model>": { "<class>": [singleAz, multiAz] } } } }
 * keyed by the values DescribeDBInstances returns (Engine, LicenseModel,
 * DBInstanceClass), with null where AWS publishes no price for that deployment.
 * Only the engine/licence pairs in ENGINE_LICENCE_MAP are written; any other
 * pair (Oracle CDB, SQL Server Developer, Db2 marketplace, anything unknown) has
 * no entry, so it gets no dollar figure.
 *
 * The table carries no per-file SHA-256: the hashes are printed by the check
 * (one line per region) and kept with the build evidence, never committed. A
 * 64-hex hash can hold a 12-digit run, which the repository's account-ID guard
 * (config/__tests__/aws-account-id-literals.test.ts) rightly rejects.
 *
 * Regions written: every region in the index except EXCLUDED_REGIONS, the
 * same 34 commercial regions as the EBS snapshot and NAT gateway tables
 * (config/aws-pricing.ts). They are still checked.
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const INDEX_URL = 'https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonRDS/current/region_index.json';
const OFFER_URL_TEMPLATE = 'https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonRDS/<version>/<region>/index.json';

/** Checked, never written: another partition, or a Local Zone (not a home region). */
const EXCLUDED_REGIONS = Object.freeze({
  'us-gov-east-1': 'AWS GovCloud (another partition)',
  'us-gov-west-1': 'AWS GovCloud (another partition)',
  'us-west-2-lax-1': 'Local Zone (Los Angeles), not a home region',
});

/**
 * DescribeDBInstances Engine + LicenseModel -> the price list's databaseEngine,
 * databaseEdition and licenseModel. Values from the RDS API reference
 * (CreateDBInstance Engine / LicenseModel valid values).
 */
const ENGINE_LICENCE_MAP = Object.freeze({
  'mysql|general-public-license': ['MySQL', null, 'No license required'],
  'mariadb|general-public-license': ['MariaDB', null, 'No license required'],
  'postgres|postgresql-license': ['PostgreSQL', null, 'No license required'],
  'oracle-ee|bring-your-own-license': ['Oracle', 'Enterprise', 'Bring your own license'],
  'oracle-se2|bring-your-own-license': ['Oracle', 'Standard Two', 'Bring your own license'],
  'oracle-se2|license-included': ['Oracle', 'Standard Two', 'License included'],
  'sqlserver-ee|license-included': ['SQL Server', 'Enterprise', 'License included'],
  'sqlserver-se|license-included': ['SQL Server', 'Standard', 'License included'],
  'sqlserver-web|license-included': ['SQL Server', 'Web', 'License included'],
  'sqlserver-ex|license-included': ['SQL Server', 'Express', 'License included'],
  'db2-se|bring-your-own-license': ['Db2', 'Standard', 'Bring your own license'],
  'db2-ae|bring-your-own-license': ['Db2', 'Advanced', 'Bring your own license'],
});

const RUNNING_USAGE = /(^|-)(InstanceUsage|Multi-AZUsage|MirrorUsage):/;
const DEPLOYMENTS = ['Single-AZ', 'Multi-AZ'];

function args(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check-only') out.checkOnly = true;
    else if (a.startsWith('--')) out[a.slice(2)] = argv[++i];
  }
  return out;
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** One region's running-instance prices, or the reasons it fails the check. */
function readRegion(file, region, version) {
  const problems = [];
  const offer = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (offer.version !== version) problems.push(`version ${offer.version} != index ${version}`);
  const onDemand = (offer.terms && offer.terms.OnDemand) || {};
  const identities = new Map(); // key -> Set of prices
  for (const [sku, product] of Object.entries(offer.products || {})) {
    if (product.productFamily !== 'Database Instance') continue;
    const a = product.attributes || {};
    if (a.locationType !== 'AWS Region') continue;
    if (String(a.databaseEngine || '').startsWith('Aurora')) continue;
    if (a.deploymentModel === 'Custom') continue;
    if (!DEPLOYMENTS.includes(a.deploymentOption)) continue;
    if (!RUNNING_USAGE.test(a.usagetype || '')) continue;
    if (a.regionCode !== region) problems.push(`sku ${sku} regionCode ${a.regionCode}`);
    const key = [a.databaseEngine, a.databaseEdition ?? '', a.licenseModel, a.instanceType, a.deploymentOption].join('|');
    const dims = Object.values(onDemand[sku] || {}).flatMap((term) => Object.values(term.priceDimensions || {}));
    if (dims.length !== 1) problems.push(`${key}: ${dims.length} on-demand price dimensions on sku ${sku}`);
    for (const dim of dims) {
      const usd = Number(dim.pricePerUnit && dim.pricePerUnit.USD);
      if (dim.unit !== 'Hrs') problems.push(`${key}: unit ${dim.unit}`);
      if (!Number.isFinite(usd) || usd <= 0) problems.push(`${key}: price ${dim.pricePerUnit && dim.pricePerUnit.USD}`);
      if (!identities.has(key)) identities.set(key, new Set());
      identities.get(key).add(usd);
    }
  }
  for (const [key, prices] of identities) {
    if (prices.size !== 1) problems.push(`${key}: ${prices.size} distinct prices (${[...prices].join(', ')})`);
  }
  return { identities, problems, publicationDate: offer.publicationDate };
}

function main() {
  const opt = args(process.argv);
  if (!opt.dir) throw new Error('--dir is required');
  const index = JSON.parse(fs.readFileSync(path.join(opt.dir, 'region_index.json'), 'utf8'));
  const versions = new Set(Object.values(index.regions).map((r) => r.currentVersionUrl.split('/')[5]));
  if (versions.size !== 1) throw new Error(`region index names ${versions.size} versions`);
  const [version] = versions;
  const regions = Object.keys(index.regions).sort();

  const results = {};
  let failed = 0;
  for (const region of regions) {
    const file = path.join(opt.dir, `${region}.json`);
    if (!fs.existsSync(file)) {
      results[region] = { problems: ['file missing'] };
      failed++;
      console.log(`FAIL ${region}: file missing`);
      continue;
    }
    let r;
    try {
      r = readRegion(file, region, version);
    } catch (error) {
      r = { identities: new Map(), problems: [`unreadable: ${error.message}`] };
    }
    r.sha256 = sha256(file);
    r.bytes = fs.statSync(file).size;
    results[region] = r;
    const status = r.problems.length === 0 ? 'PASS' : 'FAIL';
    if (status === 'FAIL') failed++;
    console.log(`${status} ${region}: ${r.identities.size} identities, ${r.problems.length} problems, ${r.bytes} bytes, sha256 ${r.sha256}${EXCLUDED_REGIONS[region] ? ` (checked, not written: ${EXCLUDED_REGIONS[region]})` : ''}`);
    for (const p of r.problems.slice(0, 10)) console.log(`    ${p}`);
  }
  console.log(`\nuniqueness check: ${regions.length - failed}/${regions.length} regions pass; index published ${index.publicationDate}, version ${version}`);
  if (failed > 0) {
    console.log('STOP: at least one region failed; nothing written.');
    process.exit(1);
  }
  if (opt.checkOnly) return;
  if (!opt.out) throw new Error('--out is required unless --check-only');

  const prices = {};
  const sample = [];
  for (const region of regions) {
    if (EXCLUDED_REGIONS[region]) continue;
    const byPair = {};
    for (const [pair, [engine, edition, licence]] of Object.entries(ENGINE_LICENCE_MAP)) {
      const classes = {};
      for (const [key, set] of results[region].identities) {
        const [e, ed, l, cls, dep] = key.split('|');
        if (e !== engine || ed !== (edition ?? '') || l !== licence) continue;
        if (!classes[cls]) classes[cls] = [null, null];
        classes[cls][DEPLOYMENTS.indexOf(dep)] = [...set][0];
      }
      const sorted = Object.fromEntries(Object.keys(classes).sort().map((c) => [c, classes[c]]));
      if (Object.keys(sorted).length > 0) byPair[pair] = sorted;
    }
    prices[region] = byPair;
  }

  const output = {
    source: {
      index_url: INDEX_URL,
      offer_url_template: OFFER_URL_TEMPLATE,
      version,
      published: index.publicationDate,
      retrieved: opt.retrieved || null,
      unit: 'USD per instance hour, on-demand',
    },
    prices,
  };
  const text = `${JSON.stringify(output)}\n`;
  fs.writeFileSync(opt.out, text);
  console.log(`wrote ${opt.out}: ${Buffer.byteLength(text)} bytes, ${Object.keys(prices).length} regions, ${Object.values(prices).reduce((n, p) => n + Object.values(p).reduce((m, c) => m + Object.keys(c).length, 0), 0)} class rows`);

  if (opt.sample) {
    const picks = [
      ['us-east-1', 'postgres|postgresql-license', 'db.t3.micro'],
      ['us-east-1', 'mysql|general-public-license', 'db.m5.large'],
      ['us-east-1', 'postgres|postgresql-license', 'db.m5.large'],
      ['us-east-1', 'sqlserver-se|license-included', 'db.m5.large'],
      ['us-east-1', 'oracle-se2|license-included', 'db.m5.large'],
      ['eu-west-1', 'postgres|postgresql-license', 'db.m5.large'],
      ['af-south-1', 'postgres|postgresql-license', 'db.m5.large'],
      ['ap-southeast-2', 'mysql|general-public-license', 'db.t4g.micro'],
      ['sa-east-1', 'mariadb|general-public-license', 'db.r6g.large'],
    ];
    for (const [region, pair, cls] of picks) {
      const row = prices[region] && prices[region][pair] && prices[region][pair][cls];
      sample.push([region, pair, cls, row ? row[0] : 'none', row ? row[1] : 'none'].join('\t'));
    }
    fs.writeFileSync(opt.sample, `region\tengine|licence\tclass\tsingle_az_usd_per_hour\tmulti_az_usd_per_hour\n${sample.join('\n')}\n`);
  }
}

main();
