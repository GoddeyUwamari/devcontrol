/**
 * The AWS account's region list (multi-region plan M5a, m5-plan.md §2): which
 * regions exist for the account and which of them are enabled.
 *
 * One EC2 DescribeRegions call per discovery scan, with AllRegions so regions
 * that are not enabled (opt-in regions not opted into) are listed too. It is
 * sent through the home region's EC2 client the scan already uses (under the
 * call policy), never through a client for another region: the list is the
 * same from any enabled region's endpoint, and the home endpoint is the one the
 * scan has just reached. The customer role's ReadOnlyAccess grants it through
 * ec2:Describe*.
 *
 * The list is only recorded (aws_account_regions); nothing is scanned because
 * of it. A list that cannot be read or does not make sense is reported as not
 * available, never as a shorter list: the caller keeps the last stored one.
 */
import { DescribeRegionsCommand } from '@aws-sdk/client-ec2';
import { failedSourceStatus } from './source-outcome';

/** Far above every partition's region count; a longer list is not trusted. */
export const MAX_LISTED_REGIONS = 64;

/** aws_account_regions.region's CHECK (202610191200_create_multi_region_scan_foundation.sql). */
export const REGION_NAME_PATTERN = /^[a-z]{2}(-[a-z]+)+-[0-9]{1,2}$/;

/** aws_account_regions.region is VARCHAR(32): a longer name would fail the whole write. */
export const MAX_REGION_NAME_LENGTH = 32;

/** aws_account_regions.opt_in_status's CHECK. */
const OPT_IN_STATUS_PATTERN = /^[a-z][a-z-]{0,31}$/;

/**
 * The OptInStatus values of a region the account can use. Any other value,
 * including one this code does not know, is not enabled.
 */
const ENABLED_OPT_IN_STATUSES: ReadonlySet<string> = new Set(['opt-in-not-required', 'opted-in']);

export interface ListedRegion {
  region: string;
  /** As reported; null when absent or not a status the column accepts. */
  optInStatus: string | null;
  enabled: boolean;
}

/** Why the list is not available this scan. */
export type RegionListFailure = 'denied' | 'timed_out' | 'failed' | 'invalid';

export type RegionListResult =
  | { ok: true; regions: ListedRegion[]; dropped: number }
  | { ok: false; reason: RegionListFailure; detail: string };

interface Ec2Sender {
  send(command: DescribeRegionsCommand): Promise<unknown>;
}

/**
 * The region list from a DescribeRegions response. Accepted only when it is a
 * non-empty list of at most MAX_LISTED_REGIONS entries in which the home region
 * is enabled. A name the table would refuse (its pattern, or longer than
 * MAX_REGION_NAME_LENGTH) is dropped rather than failing the whole list, and
 * only counted in `dropped`: names AWS supplied are never returned for logging.
 * A repeated name keeps its first entry.
 */
export function parseRegionList(response: unknown, homeRegion: string): RegionListResult {
  const entries = (response as { Regions?: unknown } | null | undefined)?.Regions;
  if (!Array.isArray(entries) || entries.length === 0) return invalid('no regions in the response');
  if (entries.length > MAX_LISTED_REGIONS) return invalid(`${entries.length} regions listed, more than ${MAX_LISTED_REGIONS}`);

  const regions: ListedRegion[] = [];
  let dropped = 0;
  const seen = new Set<string>();
  for (const entry of entries) {
    const name = (entry as { RegionName?: unknown } | null)?.RegionName;
    if (typeof name !== 'string' || name.length > MAX_REGION_NAME_LENGTH || !REGION_NAME_PATTERN.test(name)) {
      dropped++;
      continue;
    }
    if (seen.has(name)) continue;
    seen.add(name);
    const status = (entry as { OptInStatus?: unknown }).OptInStatus;
    const optInStatus = typeof status === 'string' && OPT_IN_STATUS_PATTERN.test(status) ? status : null;
    regions.push({ region: name, optInStatus, enabled: optInStatus !== null && ENABLED_OPT_IN_STATUSES.has(optInStatus) });
  }

  if (!regions.some((r) => r.region === homeRegion && r.enabled)) {
    return invalid('the home region is not listed as enabled');
  }
  return { ok: true, regions, dropped };
}

/**
 * Lists the account's regions with `ec2` (the scan's home-region client). Never
 * throws: a denied, timed-out or failed call, or a response parseRegionList
 * refuses, is a failure result. `detail` names the error type only, never its
 * message (which can carry ARNs).
 */
export async function describeAccountRegions(ec2: Ec2Sender, homeRegion: string): Promise<RegionListResult> {
  let response: unknown;
  try {
    response = await ec2.send(new DescribeRegionsCommand({ AllRegions: true }));
  } catch (error: unknown) {
    const status = failedSourceStatus(error);
    const reason: RegionListFailure = status === 'denied' || status === 'timed_out' ? status : 'failed';
    const name = (error as { name?: unknown } | null)?.name;
    return { ok: false, reason, detail: typeof name === 'string' ? name.slice(0, 64) : 'unknown error' };
  }
  return parseRegionList(response, homeRegion);
}

function invalid(detail: string): RegionListResult {
  return { ok: false, reason: 'invalid', detail };
}
