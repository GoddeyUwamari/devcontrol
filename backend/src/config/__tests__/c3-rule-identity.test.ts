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
import { readFileSync } from 'fs';
import { join } from 'path';
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
      expect(meetsStoredSizeFloor(bad as any)).toBe(false);
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

  it('no other C3 module converts bytes to GB on its own', () => {
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
});
