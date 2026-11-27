/**
 * "Never show $0", part B (founder rulings 2026-11-26, review-logs/never-zero/
 * stage-a.md Addendum 1, Q2 safeguard): a detector records the unrounded
 * amount of a positive figure that DECIMAL(10,2) stores as 0.00, in
 * metadata.savings_unrounded_usd, at detection time -- and never for 0, a
 * gate-blocked figure, or anything stored as at least $0.01. The stored
 * potential_savings figure and its rounding are unchanged.
 */
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { S3Client } from '@aws-sdk/client-s3';
import costOptimizationService from '../cost-optimization.service';
import { codeLinesOf } from '../../__tests__/helpers/source-scan';
import { EffectiveOptimizationRuleConfig } from '../optimization-rule-config.service';
import {
  countSavingsFindings,
  aggregateEstimatedSavings,
  SAVINGS_UNROUNDED_FIELD,
  savingsFigure,
  storesAsZeroCents,
  subCentSavingsMetadata,
} from '../estimated-savings';

function withMockedSend<T extends object>(client: T, send: jest.Mock): T {
  (client as unknown as { send: jest.Mock }).send = send;
  return client;
}

type DetectorIssue = { potentialSavings: number; description: string; metadata: Record<string, unknown> };
type DetectorResult = { issues: DetectorIssue[] };
const detectors = costOptimizationService as unknown as {
  detectLowUsageLambdaFunctions: (org: string, lambda: LambdaClient, cw: CloudWatchClient, config: EffectiveOptimizationRuleConfig) => Promise<DetectorResult>;
  detectS3LifecycleOptimization: (s3: S3Client, cw: CloudWatchClient) => Promise<DetectorResult>;
};

const LAMBDA_CONFIG: EffectiveOptimizationRuleConfig = { ruleId: 'lambda_low_usage', parameterId: 'max_invocations', value: 10, source: 'default' };
// Bucket sizes as CloudWatch BucketSizeBytes (literal bytes: about 0.2 GiB and 100 GiB), so no 2^30 conversion lives here (c3-rule-identity guard).
const SMALL_BUCKET_BYTES = 214_748_365;
const LARGE_BUCKET_BYTES = 107_374_182_400;

describe('storesAsZeroCents / subCentSavingsMetadata', () => {
  it('exactly the positive amounts DECIMAL(10,2) rounds to 0.00', () => {
    expect(SAVINGS_UNROUNDED_FIELD).toBe('savings_unrounded_usd');
    for (const amount of [0.000001, 0.0012, 0.0049, 0.00499999]) {
      expect(storesAsZeroCents(amount)).toBe(true);
      expect(subCentSavingsMetadata(amount)).toEqual({ savings_unrounded_usd: amount });
    }
    for (const amount of [0, -0, -0.001, 0.005, 0.0051, 0.01, 1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(storesAsZeroCents(amount)).toBe(false);
      expect(subCentSavingsMetadata(amount)).toEqual({});
    }
  });

  it('a recorded amount never enters a total or a count (stored 0.00 stays 0)', () => {
    const rows = [
      { resource_type: 'Lambda', potential_savings: '0.00', metadata: { savings_basis: 'estimated: x', savings_unrounded_usd: 0.003 } },
      { resource_type: 'S3', potential_savings: '0.00', metadata: { savings_basis: 'ceiling: x', savings_unrounded_usd: 0.004 } },
    ];
    expect(aggregateEstimatedSavings(rows)).toEqual({ total: 0, byResourceType: { Lambda: 0 }, ceilingTotal: 0, ceilingByResourceType: { S3: 0 } });
    expect(countSavingsFindings(rows).estimatedFindings).toBe(0);
    // But each row reads as a genuine sub-cent figure.
    expect(savingsFigure(rows[0])).toEqual({ kind: 'estimate', amount: 0.003, subCent: true });
    expect(savingsFigure(rows[1])).toEqual({ kind: 'ceiling', amount: 0.004, subCent: true });
  });
});

describe('low-usage Lambda records a sub-cent estimate', () => {
  const run = async (invocations: number, durationMs: number, memoryMB: number) => {
    const lambdaClient = withMockedSend(new LambdaClient({ region: 'us-east-1' }), jest.fn().mockResolvedValueOnce({ Functions: [{ FunctionName: 'fn', MemorySize: memoryMB }] }));
    const cwSend = jest.fn().mockResolvedValueOnce({ Datapoints: invocations === 0 ? [] : [{ Sum: invocations }] });
    if (invocations > 0) cwSend.mockResolvedValueOnce({ Datapoints: [{ Average: durationMs }] });
    const cwClient = withMockedSend(new CloudWatchClient({ region: 'us-east-1' }), cwSend);
    const result = await detectors.detectLowUsageLambdaFunctions('test-org', lambdaClient, cwClient, LAMBDA_CONFIG);
    expect(result.issues).toHaveLength(1);
    return result.issues[0];
  };

  it('a positive figure under half a cent: the unrounded amount is recorded, the figure itself unchanged', async () => {
    const issue = await run(3, 250, 512);
    expect(issue.potentialSavings).toBeGreaterThan(0);
    expect(issue.potentialSavings).toBeLessThan(0.005);
    expect(issue.metadata[SAVINGS_UNROUNDED_FIELD]).toBe(issue.potentialSavings);
  });

  it('zero invocations (a real $0): no field', async () => {
    const issue = await run(0, 0, 128);
    expect(issue.potentialSavings).toBe(0);
    expect(issue.metadata).not.toHaveProperty(SAVINGS_UNROUNDED_FIELD);
  });

  it('a figure stored as at least $0.01: no field', async () => {
    // 10 invocations x 30 s x 10 GB: about $0.05.
    const issue = await run(10, 30_000, 10_240);
    expect(issue.potentialSavings).toBeGreaterThanOrEqual(0.005);
    expect(issue.metadata).not.toHaveProperty(SAVINGS_UNROUNDED_FIELD);
  });

  it('the description stays true without a shown figure (no "below")', async () => {
    for (const issue of [await run(3, 250, 512), await run(0, 0, 128)]) {
      expect(issue.description).not.toMatch(/below/i);
    }
  });
});

describe('S3 lifecycle records a sub-cent ceiling', () => {
  const run = async (bytes: number, rules?: unknown) => {
    const s3Send = jest.fn()
      .mockResolvedValueOnce({ Buckets: [{ Name: 'bucket' }] })
      .mockResolvedValueOnce({});
    if (rules) s3Send.mockResolvedValueOnce({ Rules: rules });
    else s3Send.mockRejectedValueOnce({ name: 'NoSuchLifecycleConfiguration' });
    const s3Client = withMockedSend(new S3Client({ region: 'us-east-1' }), s3Send);
    const cwClient = withMockedSend(new CloudWatchClient({ region: 'us-east-1' }), jest.fn().mockResolvedValueOnce({ Datapoints: [{ Average: bytes, Timestamp: new Date() }] }));
    const result = await detectors.detectS3LifecycleOptimization(s3Client, cwClient);
    expect(result.issues).toHaveLength(1);
    return result.issues[0];
  };

  it('a small bucket (0.2 GB): the unrounded ceiling is recorded, the figure itself unchanged', async () => {
    const issue = await run(SMALL_BUCKET_BYTES);
    const sizeGB = issue.metadata.standard_storage_gb as number;
    expect(sizeGB).toBeCloseTo(0.2, 6);
    expect(issue.potentialSavings).toBeCloseTo(sizeGB * (0.023 - 0.0125), 10);
    expect(issue.potentialSavings).toBeLessThan(0.005);
    expect(issue.metadata[SAVINGS_UNROUNDED_FIELD]).toBe(issue.potentialSavings);
  });

  it('a bucket whose ceiling is stored as at least $0.01: no field', async () => {
    const issue = await run(LARGE_BUCKET_BYTES);
    expect(issue.metadata).not.toHaveProperty(SAVINGS_UNROUNDED_FIELD);
  });

  it('both descriptions stay true without a shown figure (no "below")', async () => {
    expect((await run(SMALL_BUCKET_BYTES)).description).not.toMatch(/below/i);
    const transitionOnly = await run(SMALL_BUCKET_BYTES, [{ Status: 'Enabled', ID: 'r1', Transitions: [{ Days: 30, StorageClass: 'STANDARD_IA' }] }]);
    expect(transitionOnly.description).not.toMatch(/below/i);
  });
});

describe('which detectors record it', () => {
  // Every other detector's smallest positive figure is stored as at least $0.01 (see build.md "Part B"):
  // EBS volume/gp2->gp3 and snapshots are whole-GB sizes x >= $0.015/GB, EIP is $3.60, EC2/RDS/NAT are
  // hourly prices x 730 h, DynamoDB capacity cuts whole capacity units (>= ~$0.09), and the DynamoDB
  // comparison is either gated to 0 (no field: a gate-blocked figure has no genuine amount) or at least $15.
  it('only the low-usage Lambda and S3 lifecycle detectors call subCentSavingsMetadata', () => {
    const source = readFileSync(join(__dirname, '..', 'cost-optimization.service.ts'), 'utf8');
    const calls = source.match(/\.\.\.subCentSavingsMetadata\((\w+)\)/g) ?? [];
    expect(calls).toEqual(['...subCentSavingsMetadata(monthlySavingsCeiling)', '...subCentSavingsMetadata(monthlyCost)']);
    // The DynamoDB comparison's gate-blocked figure never gets one. The anchor must exist (review N-3):
    // a renamed anchor would otherwise slice an empty string and pass without checking anything.
    const anchor = source.indexOf('recommendationGate.recommend ?');
    expect(anchor).toBeGreaterThanOrEqual(0);
    const ddb = source.slice(anchor, anchor + 2000);
    expect(ddb).toMatch(/potentialSavings/);
    expect(ddb).not.toMatch(/subCentSavingsMetadata|savings_unrounded_usd|SAVINGS_UNROUNDED_FIELD/);
  });

  // Review N-3: every backend source file is scanned (comments removed), not one. Any new mention of the
  // field, its constant or its helper anywhere -- a direct `savings_unrounded_usd:` write, a jsonb_set, a
  // new detector -- changes this map and fails until it is reviewed here.
  it('the field is written only through subCentSavingsMetadata, from those two detectors; one file reads it', () => {
    const repo = join(__dirname, '..', '..', '..', '..');
    const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '--', 'backend/src'], { cwd: repo, encoding: 'utf8' })
      .split('\n').filter((f) => /\.[jt]sx?$/.test(f) && !/(^|\/)__tests__\//.test(f) && !/\.test\.[jt]sx?$/.test(f));
    expect(files).toContain('backend/src/services/cost-optimization.service.ts');
    const mentions: Record<string, string[]> = {};
    for (const file of files) {
      let text: string;
      try { text = readFileSync(join(repo, file), 'utf8'); } catch { continue; }
      if (!/savings_unrounded_usd|SAVINGS_UNROUNDED_FIELD|subCentSavingsMetadata/i.test(text)) continue;
      const lines = codeLinesOf(text).map(({ text: line }) => line.trim()).filter((line) => /savings_unrounded_usd|SAVINGS_UNROUNDED_FIELD|subCentSavingsMetadata/i.test(line));
      if (lines.length > 0) mentions[file] = lines;
    }
    expect(mentions).toEqual({
      // Definitions: the field name, the writer helper (only for 0 < x < 0.005) and the reader.
      'backend/src/services/estimated-savings.ts': [
        "export const SAVINGS_UNROUNDED_FIELD = 'savings_unrounded_usd';",
        'export function subCentSavingsMetadata(amount: number): { [SAVINGS_UNROUNDED_FIELD]?: number } {',
        'return storesAsZeroCents(amount) ? { [SAVINGS_UNROUNDED_FIELD]: amount } : {};',
        'const value = metadata?.[SAVINGS_UNROUNDED_FIELD];',
      ],
      // The only writers: S3 lifecycle and low-usage Lambda, through the helper.
      'backend/src/services/cost-optimization.service.ts': [
        'subCentSavingsMetadata,',
        '...subCentSavingsMetadata(monthlySavingsCeiling),',
        '...subCentSavingsMetadata(monthlyCost),',
      ],
      // A reader: selects the JSON value and passes it to savingsFigure in a local object (no write).
      'backend/src/services/activity-feed.service.ts': [
        "import { EC2_PRICE_SOURCE_DEFAULT, LESS_THAN_ONE_CENT, SAVINGS_UNROUNDED_FIELD, savingsFigure } from './estimated-savings';",
        "metadata->'savings_unrounded_usd' AS savings_unrounded_usd,",
        'type Row = { potential_savings: unknown; savings_basis: unknown; price_source?: unknown; savings_unrounded_usd?: unknown };',
        'metadata: { savings_basis: row.savings_basis, [SAVINGS_UNROUNDED_FIELD]: row.savings_unrounded_usd },',
      ],
    });
  });
});
