/**
 * Connection and region scope (S26, S5): which AWS account DevControl reads
 * for this organization, and which of its regions were recorded and scanned.
 * Read from the database only (readServicesCoverage, the Services coverage
 * read): no AWS call. One connected account per organization is all DevControl
 * reads, so nothing here implies multi-account completeness.
 */
import { collectSection, notConnected, type AccountRegionsScope } from '../../../ai-context-contract';
import { isAwsAccountAmbiguous } from '../../../../repositories/aws-accounts.repository';
import { defineProvider, iso, ref, summarizeItems, TWO_SCANS_SECONDS } from './shared';

const MULTIPLE_ACCOUNTS_REASON = 'more than one AWS account is connected; DevControl reads one account per organization';

export interface ConnectionScopeEvidence {
  connected: true;
  connectedAccountId: string | null;
  connectionStatus: string | null;
  homeRegion: string | null;
  /** DevControl reads exactly one AWS account per organization. */
  accountsRead: 1;
}

export const connectionScopeProvider = defineProvider<ConnectionScopeEvidence>({
  id: 'connection.scope',
  version: 1,
  title: 'Connected AWS account',
  source: 'DevControl connected AWS account record',
  dataSourceIds: ['S26'],
  topics: ['regions', 'inventory', 'cost', 'security', 'ops'],
  priority: 1,
  maxTokens: 400,
  // Read from configuration at request time: its asOf is the read itself.
  fingerprint: 'state_and_data',
  async collect({ basis, now }) {
    const meta = { source: 'DevControl connected AWS account record', classification: 'configured' as const };
    let coverage;
    try {
      coverage = await basis.coverage();
    } catch (error: unknown) {
      if (isAwsAccountAmbiguous(error)) {
        return collectSection<ConnectionScopeEvidence>(meta, async () => ({ state: 'unavailable', reason: MULTIPLE_ACCOUNTS_REASON }));
      }
      throw error;
    }
    if (!coverage.account.connected) return notConnected<ConnectionScopeEvidence>(meta, 'no AWS account is connected');
    const account = await basis.account();
    return collectSection<ConnectionScopeEvidence>({ ...meta, scope: { kind: 'account_level', connectedAccountId: account.data?.accountId ?? null } }, async () => ({
      state: 'available',
      asOf: now.toISOString(),
      data: {
        connected: true,
        connectedAccountId: account.data?.accountId ?? null,
        connectionStatus: coverage.account.status,
        homeRegion: coverage.account.home_region,
        accountsRead: 1,
      },
    }));
  },
});

export interface RegionCoverageEvidence {
  homeRegion: string | null;
  /** What discovery scans: every inventoried type in the home region; S3 account-wide; CloudFront global. */
  scanScope: { homeRegionTypes: 'all inventoried types'; s3: 'account-wide'; cloudfront: 'global' };
  enabledRegions: { known: boolean; count: number | null; listedAt: string | null };
  scanInProgress: boolean;
  lastSuccessfulScanAt: string | null;
  items: Array<{
    ref: string;
    region: string;
    home: boolean;
    /** The scanner's recorded status (e.g. never_scanned, succeeded, failed). */
    status: string;
    lastScanFinishedAt: string | null;
    lastSuccessAt: string | null;
    /** A safe error code, never the stored message. */
    lastErrorCode: string | null;
    stale: boolean;
  }>;
}

export const regionCoverageProvider = defineProvider<RegionCoverageEvidence>({
  id: 'coverage.regions',
  version: 1,
  title: 'AWS regions and scan coverage',
  source: 'DevControl region list and scan status',
  dataSourceIds: ['S5'],
  topics: ['regions', 'inventory'],
  priority: 1,
  maxTokens: 1500,
  freshness: { maxAgeSeconds: TWO_SCANS_SECONDS, rule: 'two scheduled scans (13 hours)' },
  async collect({ basis }) {
    const meta = { source: 'DevControl region list and scan status', classification: 'measured' as const };
    let coverage;
    try {
      coverage = await basis.coverage();
    } catch (error: unknown) {
      if (isAwsAccountAmbiguous(error)) {
        return collectSection<RegionCoverageEvidence>(meta, async () => ({ state: 'unavailable', reason: MULTIPLE_ACCOUNTS_REASON }));
      }
      throw error;
    }
    if (!coverage.account.connected) return notConnected<RegionCoverageEvidence>(meta, 'no AWS account is connected');
    const account = await basis.account();

    const items = coverage.region_status.map((r, i) => ({
      ref: ref('r', i),
      region: r.region,
      home: r.home,
      status: r.status,
      lastScanFinishedAt: iso(r.last_scan_finished_at),
      lastSuccessAt: iso(r.last_success_at),
      lastErrorCode: r.last_error_code,
      stale: r.stale,
    }));
    const scope: AccountRegionsScope = {
      kind: 'aws_account_regions',
      connectedAccountId: account.data?.accountId ?? null,
      homeRegion: coverage.account.home_region,
      regions: items.map((r) => ({ region: r.region, status: r.status })),
    };
    const known = coverage.scope.enabled_regions.known;
    const asOf = iso(coverage.scope.enabled_regions.listed_at) ?? iso(coverage.last_successful_scan_at);
    return collectSection<RegionCoverageEvidence>({ ...meta, scope }, async () => ({
      state: known ? 'available' : 'partial',
      asOf,
      reason: known ? null : "the account's region list has not been recorded yet, so its enabled regions are unknown (not zero)",
      coverage: 'discovery scans every inventoried type in the home region only; S3 buckets are listed account-wide and CloudFront is global; other regions are listed but not scanned yet',
      data: {
        homeRegion: coverage.account.home_region,
        scanScope: { homeRegionTypes: 'all inventoried types', s3: 'account-wide', cloudfront: 'global' },
        enabledRegions: { known, count: coverage.scope.enabled_regions.count, listedAt: iso(coverage.scope.enabled_regions.listed_at) },
        scanInProgress: coverage.scan_in_progress !== null,
        lastSuccessfulScanAt: iso(coverage.last_successful_scan_at),
        items,
      },
    }));
  },
  summarize: summarizeItems,
});
