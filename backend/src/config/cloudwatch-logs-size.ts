/**
 * C3: the ONE conversion between a CloudWatch Logs stored size in bytes
 * (DescribeLogGroups storedBytes) and the "GB" figure DevControl shows.
 *
 * Founder ruling D9 (c3-stage-a.md Addendum 2, binding condition 2): the
 * detection floor and every displayed size use the same 2^30-bytes-per-GB
 * conversion, through this module, so the threshold can never disagree with a
 * displayed size. Nothing else may divide stored bytes by its own constant.
 *
 * Display rule: one decimal place, rounded DOWN (truncated), so a displayed
 * size never claims more than AWS reported; thousands separated ("1,234.5").
 * Truncation is monotonic, so every size at or above the floor displays at or
 * above the floor's own display (formatStoredGb(CLOUDWATCH_LOGS_UNUSED_FLOOR_BYTES)).
 *
 * Pure: no AWS calls, no database.
 */

/** Bytes per displayed GB: 2^30 (the repo's convention, as the S3 storage figures). */
export const BYTES_PER_GB = 1024 * 1024 * 1024;

/**
 * Rule B's stored-size floor, in bytes (founder ruling D9). A log group storing
 * fewer bytes is not listed; it is counted in the run's below-floor summary line.
 *
 * Internal derivation only (binding condition 1: never shown to customers; no
 * C3 copy states a dollar amount): $1.00 / $0.028 per GB-month (eu-north-1, the
 * lowest commercial Standard CloudWatch Logs storage price in the pricing page's
 * price file, meteredUnitMaps/cloudwatch/USD/current/cloudwatch.json, published
 * 2026-11-25T15:02:40Z) = 250/7 GB; x 2^30 bytes = 38,347,922,285.71..., rounded
 * up. That is about $1/month or more in every priced region IF storedBytes is
 * the billed (compressed) size, which AWS does not document (gate G-S,
 * unconfirmed); it is a volume floor, not a dollar figure.
 */
export const CLOUDWATCH_LOGS_UNUSED_FLOOR_BYTES = 38_347_922_286;

/** A stored size AWS reported: a finite, non-negative whole number of bytes. */
export function isStoredBytes(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}

/** Whether a stored size reaches the floor (the detection side of the shared conversion). */
export function meetsStoredSizeFloor(storedBytes: number): boolean {
  return isStoredBytes(storedBytes) && storedBytes >= CLOUDWATCH_LOGS_UNUSED_FLOOR_BYTES;
}

/** Tenths of a GB, rounded down: the integer the display is built from. */
function tenthsOfGb(storedBytes: number): number {
  // Integer arithmetic first, so no float rounding can lift a value over a tenth boundary.
  return Math.floor((storedBytes * 10) / BYTES_PER_GB);
}

/** The displayed size, e.g. "35.7" (no unit): one decimal, rounded down, thousands separated. */
export function formatStoredGb(storedBytes: number): string {
  if (!isStoredBytes(storedBytes)) throw new Error('formatStoredGb: not a stored size in bytes');
  const tenths = tenthsOfGb(storedBytes);
  const whole = Math.floor(tenths / 10);
  return `${whole.toLocaleString('en-US')}.${tenths % 10}`;
}

/** The floor as customers see it: "35.7" (shown as "about 35.7 GB or more"). */
export const CLOUDWATCH_LOGS_UNUSED_FLOOR_GB = formatStoredGb(CLOUDWATCH_LOGS_UNUSED_FLOOR_BYTES);
