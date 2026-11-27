/**
 * C3a: the unused CloudWatch log group rule's identity is pinned, like the C1
 * and C2 rules'. Every finding stores the rule verbatim with rule_version, so
 * changing the window, metric, floor, scope or stream check without bumping
 * `version` would make old and new findings claim the same rule. Add a pinned
 * entry (never edit one) when the rule changes.
 *
 * Also pins the ONE stored-size conversion (config/cloudwatch-logs-size.ts,
 * founder ruling D9 + binding condition 2): the floor in bytes, 2^30 bytes per
 * GB, the display rule, and that the floor, the catalog detail and every
 * displayed size come from that one module -- a test here fails if any C3 code
 * converts bytes on its own.
 */
import { readdirSync, readFileSync } from 'fs';
import { join, relative, sep } from 'path';
import { CLOUDWATCH_LOGS_UNUSED_RULE, CLOUDWATCH_LOG_GROUP_RESOURCE_TYPE, MAX_LOG_GROUP_NAME_LENGTH } from '../cloudwatch-logs-unused-rule';
import {
  BYTES_PER_GB,
  CLOUDWATCH_LOGS_UNUSED_FLOOR_BYTES,
  CLOUDWATCH_LOGS_UNUSED_FLOOR_GB,
  formatStoredGb,
  isStoredBytes,
  meetsStoredSizeFloor,
} from '../cloudwatch-logs-size';
import { OPTIMIZATION_RULES, OPTIMIZATION_RULE_SERVICES } from '../optimization-rules';
import { logGroupUnusedDescription } from '../../services/cloudwatch-logs-unused-evaluation';

const FLOOR = 38_347_922_286;

const PINNED: Record<number, unknown> = {
  1: {
    id: 'cloudwatch_unused_logs',
    version: 1,
    window: { days: 90, basis: 'complete_utc_days', settle_lag_hours: 2 },
    listing: { api: 'DescribeLogGroups', page_size: 50, name_pattern_filter: false, linked_accounts: false, region: 'home' },
    scope: {
      excluded_log_group_classes: ['DELIVERY'],
      created_before_window: true,
      max_name_length: 255,
      on_longer_name: 'skip_and_count',
      on_missing_stored_bytes: 'couldnt_check',
      on_missing_creation_time: 'couldnt_check',
    },
    floor: { stored_bytes_min: 38347922286, bytes_per_gb: 1073741824, source: 'DescribeLogGroups.storedBytes', below_floor: 'summary_line' },
    metric: {
      namespace: 'AWS/Logs',
      metric: 'IncomingBytes',
      dimension: 'LogGroupName',
      stat: 'Sum',
      period_seconds: 86400,
      unused_when: 'no_datapoint_above_zero',
      on_failed_read: 'couldnt_check',
    },
    newest_stream: {
      api: 'DescribeLogStreams',
      order_by: 'LastEventTime',
      descending: true,
      limit: 1,
      required: true,
      last_event_before_window: true,
      last_ingestion_before_window: true,
      on_no_streams: 'couldnt_check',
      on_missing_time: 'couldnt_check',
      on_failed_read: 'couldnt_check',
    },
    activity_wins: true,
    savings: { dollar_figure: false, reason: 'stored_size_billing_basis_unconfirmed', severity: 'LOW' },
  },
};

describe('CLOUDWATCH_LOGS_UNUSED_RULE identity', () => {
  it('matches the pinned definition of its version exactly (bump the version on any change)', () => {
    expect(CLOUDWATCH_LOGS_UNUSED_RULE.id).toBe('cloudwatch_unused_logs');
    expect(JSON.parse(JSON.stringify(CLOUDWATCH_LOGS_UNUSED_RULE))).toEqual(PINNED[CLOUDWATCH_LOGS_UNUSED_RULE.version]);
  });

  it('cannot be changed at run time', () => {
    expect(Object.isFrozen(CLOUDWATCH_LOGS_UNUSED_RULE)).toBe(true);
    expect(Object.isFrozen(CLOUDWATCH_LOGS_UNUSED_RULE.floor)).toBe(true);
    expect(Object.isFrozen(CLOUDWATCH_LOGS_UNUSED_RULE.scope.excluded_log_group_classes)).toBe(true);
  });

  it('writes the CloudWatch resource type, its catalog service, and the 255-character identity limit', () => {
    expect(CLOUDWATCH_LOG_GROUP_RESOURCE_TYPE).toBe('CloudWatch');
    expect(OPTIMIZATION_RULE_SERVICES).toContain(CLOUDWATCH_LOG_GROUP_RESOURCE_TYPE);
    expect(MAX_LOG_GROUP_NAME_LENGTH).toBe(255);
  });

  it('claims no dollar figure (ruling D3) and a fixed Low severity (ruling D4)', () => {
    expect(CLOUDWATCH_LOGS_UNUSED_RULE.savings).toEqual({ dollar_figure: false, reason: 'stored_size_billing_basis_unconfirmed', severity: 'LOW' });
  });
});

describe('the stored-size floor (ruling D9)', () => {
  it('is 38,347,922,286 bytes at 2^30 bytes per GB', () => {
    expect(CLOUDWATCH_LOGS_UNUSED_FLOOR_BYTES).toBe(FLOOR);
    expect(BYTES_PER_GB).toBe(2 ** 30);
    // The internal derivation (never customer-facing): $1 / $0.028 per GB-month = 250/7 GB, x 2^30, rounded up.
    expect(Math.ceil((250 / 7) * 2 ** 30)).toBe(FLOOR);
  });

  it.each([
    [FLOOR - 1, false],
    [FLOOR, true],
    [FLOOR + 1, true],
    [0, false],
  ])('meetsStoredSizeFloor(%s) is %s', (bytes, expected) => {
    expect(meetsStoredSizeFloor(bytes)).toBe(expected);
  });

  it('a stored size is a finite, whole, non-negative number of bytes', () => {
    for (const bad of [undefined, null, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '38347922286']) {
      expect(isStoredBytes(bad)).toBe(false);
      expect(meetsStoredSizeFloor(bad as unknown as number)).toBe(false);
    }
  });
});

describe('the one stored-size display (binding condition 2)', () => {
  it('shows one decimal, rounded down, thousands separated', () => {
    expect(formatStoredGb(0)).toBe('0.0');
    expect(formatStoredGb(BYTES_PER_GB)).toBe('1.0');
    expect(formatStoredGb(BYTES_PER_GB - 1)).toBe('0.9');
    expect(formatStoredGb(Math.floor(1.99 * BYTES_PER_GB))).toBe('1.9');
    expect(formatStoredGb(Math.floor(1234.56 * BYTES_PER_GB))).toBe('1,234.5');
    expect(() => formatStoredGb(-1)).toThrow();
  });

  it('the floor displays as 35.7 GB, and every size at or above it displays at or above that', () => {
    expect(CLOUDWATCH_LOGS_UNUSED_FLOOR_GB).toBe('35.7');
    expect(formatStoredGb(FLOOR - 1)).toBe('35.7');
    expect(formatStoredGb(FLOOR)).toBe('35.7');
    expect(formatStoredGb(FLOOR + 1)).toBe('35.7');
    const asNumber = (s: string) => Number(s.replace(/,/g, ''));
    for (const extra of [0, 1, Math.floor(BYTES_PER_GB / 10), BYTES_PER_GB, 10 * BYTES_PER_GB, 1000 * BYTES_PER_GB]) {
      expect(asNumber(formatStoredGb(FLOOR + extra))).toBeGreaterThanOrEqual(asNumber(CLOUDWATCH_LOGS_UNUSED_FLOOR_GB));
    }
  });

  it('the catalog detail and the finding description use the same conversion as the floor', () => {
    const rule = OPTIMIZATION_RULES.find((r) => r.id === 'cloudwatch_unused_logs')!;
    expect(rule.detail).toContain(`about ${CLOUDWATCH_LOGS_UNUSED_FLOOR_GB} GB or more`);
    expect(logGroupUnusedDescription({ storedBytes: FLOOR, neverExpire: false, deletionProtection: false })).toContain(`stores ${CLOUDWATCH_LOGS_UNUSED_FLOOR_GB} GB.`);
    expect(logGroupUnusedDescription({ storedBytes: 100 * BYTES_PER_GB, neverExpire: false, deletionProtection: false })).toContain('stores 100.0 GB.');
    expect(CLOUDWATCH_LOGS_UNUSED_RULE.floor.bytes_per_gb).toBe(BYTES_PER_GB);
    expect(CLOUDWATCH_LOGS_UNUSED_RULE.floor.stored_bytes_min).toBe(CLOUDWATCH_LOGS_UNUSED_FLOOR_BYTES);
  });

  it('no other C3 module converts bytes to GB on its own (C3 files, decimal forms too)', () => {
    const files = [
      '../cloudwatch-logs-unused-rule.ts',
      '../optimization-rules.ts',
      '../../services/cloudwatch-logs-unused-evaluation.ts',
    ];
    for (const file of files) {
      const source = readFileSync(join(__dirname, file), 'utf-8');
      expect({ file, ok: !/1024|1073741824|1_073_741_824|2\s*\*\*\s*30|1e9|1_000_000_000/.test(source) }).toEqual({ file, ok: true });
    }
    // The detector's own block in the service.
    const service = readFileSync(join(__dirname, '../../services/cost-optimization.service.ts'), 'utf-8');
    const start = service.indexOf('private async detectUnusedLogGroups(');
    const end = service.indexOf('private async readNewestLogStream(');
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    expect(/1024|1073741824|2\s*\*\*\s*30|1e9/.test(service.slice(start, end))).toBe(false);
  });

  // Fix round 1, review N-3: every file under backend/src, every way of writing 2^30. The only C3 location is
  // config/cloudwatch-logs-size.ts. Each other file is listed with the exact number of conversions it holds today and
  // why; a new file, or one more conversion in a listed file, fails here.
  it('across all of backend/src, a 2^30 conversion appears only in cloudwatch-logs-size.ts or a listed, unrelated place', () => {
    const SRC = join(__dirname, '..', '..');
    const FORMS = /1073741824|1_073_741_824|\b1\s*<<\s*30\b|\b2\s*\*\*\s*30\b|Math\.pow\(\s*2\s*,\s*30\s*\)|\b1024\s*\*\s*1024\s*\*\s*1024\b/g;
    const ALLOWED: Record<string, { count: number; reason: string }> = {
      'config/cloudwatch-logs-size.ts': { count: 1, reason: 'C3: BYTES_PER_GB, the one stored-size conversion (ruling D9)' },
      'services/cost-optimization.service.ts': { count: 1, reason: 'pre-existing S3 lifecycle check: BucketSizeBytes to GB (getBucketStandardStorageGB), not C3' },
      'services/__tests__/cost-optimization-s3-lifecycle.test.ts': { count: 1, reason: 'pre-existing S3 lifecycle test fixture GB constant, not C3' },
      'services/__tests__/cost-optimization-savings-basis-guard.test.ts': { count: 1, reason: 'pre-existing savings-basis guard S3 fixture GB constant, not C3' },
      'services/__tests__/region-correctness.test.ts': { count: 1, reason: 'pre-existing region test S3 fixture GB constant, not C3' },
      'config/__tests__/c3-rule-identity.test.ts': { count: 17, reason: 'this test: pins BYTES_PER_GB and the floor to literal 2^30 values, and holds these guards and their sample forms' },
    };
    const found: Record<string, number> = {};
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== 'node_modules') walk(full);
        } else if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry.name)) {
          const matches = readFileSync(full, 'utf-8').match(FORMS);
          if (matches) found[relative(SRC, full).split(sep).join('/')] = matches.length;
        }
      }
    };
    walk(SRC);
    expect(found).toEqual(Object.fromEntries(Object.entries(ALLOWED).map(([file, entry]) => [file, entry.count])));
  });

  it('the backend-wide guard catches every form of 2^30 it names', () => {
    const FORMS = /1073741824|1_073_741_824|\b1\s*<<\s*30\b|\b2\s*\*\*\s*30\b|Math\.pow\(\s*2\s*,\s*30\s*\)|\b1024\s*\*\s*1024\s*\*\s*1024\b/;
    for (const form of ['x / 1073741824', 'x / 1_073_741_824', 'x / (1 << 30)', 'x / 2 ** 30', 'x / Math.pow(2, 30)', 'x / (1024 * 1024 * 1024)', 'x / 1024*1024*1024']) {
      expect({ form, caught: FORMS.test(form) }).toEqual({ form, caught: true });
    }
  });
});
