/**
 * The AI's region scope for DevControl's resource inventory (multi-region PR 2;
 * Step 1 §9.2 A1, MR-D15: data-driven, R-D3). AI context only: never rendered on a
 * page, so no product copy is added here.
 *
 * Without the multi-region flag nothing here is used: the inventory scope has no
 * regionScan and every AI text keeps its home-region wording, byte for byte. With the
 * flag on, the scope says what the coverage API says (GET /api/services/coverage,
 * multi_region): which enabled regions were checked completely, in part, not
 * completely, or not yet; that opt-in regions the account has not enabled are not
 * scanned; that S3 and CloudFront are account-wide/global; and that savings (cost
 * recommendations) are checked in the home region only (FD-1).
 */
import type { ServicesCoverage } from '../routes/services-coverage.routes';

/** One region whose last scan did not check it completely. Codes only, never AWS text. */
export interface RegionNotChecked {
  region: string;
  status: string;
  code: string | null;
}

/** InventoryScope.regionScan: present only for an organization with multi_region_discovery on. */
export type InventoryRegionScan =
  | {
      state: 'known';
      homeRegion: string | null;
      /** Enabled regions in the latest list; null while no list is stored (the scan then covers the home region only). */
      enabledRegions: number | null;
      /** Last result ok. */
      checked: string[];
      /** Last result partial (a listing cut off). */
      partial: string[];
      /** Last result denied, failed or timed_out. */
      notChecked: RegionNotChecked[];
      /** Enabled, never scanned. */
      notScannedYet: string[];
      /** Opt-in regions the account has not enabled: never scanned. */
      notEnabled: number;
      scanInProgress: boolean;
      /** Where savings are checked: the home region only. */
      savingsRegions: string[];
    }
  | {
      /** The flag is on but the region coverage could not be read: the scope is unknown, never the home region alone. */
      state: 'unavailable';
    };

const NOT_CHECKED: readonly string[] = ['denied', 'failed', 'timed_out'];

/** The region scan from a coverage response; undefined when it has no multi_region key (the flag is off). */
export function regionScanFromCoverage(coverage: ServicesCoverage): InventoryRegionScan | undefined {
  const mr = coverage.multi_region;
  if (!mr) return undefined;
  const named = (status: string) => mr.regions.filter((r) => r.status === status).map((r) => r.region);
  return {
    state: 'known',
    homeRegion: mr.home_region,
    enabledRegions: mr.regions_checked.enabled,
    checked: named('ok'),
    partial: named('partial'),
    notChecked: mr.regions.filter((r) => NOT_CHECKED.includes(r.status)).map((r) => ({ region: r.region, status: r.status, code: r.error_code })),
    notScannedYet: named('never_scanned'),
    notEnabled: mr.not_enabled_regions.length,
    scanInProgress: mr.progress !== null,
    savingsRegions: mr.savings_regions,
  };
}

const GLOBAL_LISTINGS = 'S3 buckets are listed account-wide and CloudFront is global';

/**
 * The inventory's region scope in one sentence (no leading "Regions:"), from the
 * last recorded result of each region.
 */
export function regionScopeText(scan: InventoryRegionScan): string {
  if (scan.state === 'unavailable') {
    return `unknown (DevControl could not read which regions were scanned); ${GLOBAL_LISTINGS}`;
  }
  const home = scan.homeRegion ?? 'unknown';
  const savings = `savings (cost recommendations) are checked in ${scan.savingsRegions.length > 0 ? scan.savingsRegions.join(', ') : 'no region'} only`;
  if (scan.enabledRegions === null) {
    return `${home} only so far (the account's region list has not been recorded yet; it is read during each scan); ${GLOBAL_LISTINGS}; ${savings}`;
  }
  const parts = [`${scan.checked.length} of ${scan.enabledRegions} enabled regions checked completely on their last scan (home ${home})`];
  if (scan.partial.length > 0) parts.push(`checked in part (a listing was cut off): ${scan.partial.join(', ')}`);
  if (scan.notChecked.length > 0) {
    parts.push(`not checked completely on their last scan: ${scan.notChecked.map((r) => `${r.region} (${r.status}${r.code ? `, ${r.code}` : ''})`).join(', ')}`);
  }
  if (scan.notScannedYet.length > 0) parts.push(`not scanned yet: ${scan.notScannedYet.join(', ')}`);
  if (scan.notEnabled > 0) parts.push(`${scan.notEnabled} opt-in region(s) not enabled in this account (never scanned)`);
  if (scan.scanInProgress) parts.push('a scan is running now, so these results may change');
  parts.push(GLOBAL_LISTINGS, savings);
  return parts.join('; ');
}
