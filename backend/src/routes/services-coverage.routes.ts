import { Router, Request, Response } from 'express';
import { pool } from '../config/database';
import { authenticate } from '../middleware/auth.middleware';
import {
  AWS_ACCOUNT_AMBIGUOUS_MESSAGE,
  AwsAccountsQueryable,
  findEligibleAwsAccount,
  homeRegionOf,
  isAwsAccountAmbiguous,
} from '../repositories/aws-accounts.repository';
import { splitDiscoveryMessage } from '../services/discovery-warnings';
import { INVENTORY_FROM, inventoryWhere } from './services.routes';
import { requireCurrentMembership } from './services-intelligence.routes';

const router = Router();

/**
 * What the Services page may say about scan coverage (Phase 1, PR S1-B), read
 * from the database only: no AWS call is made to answer it.
 *
 * The scope is the scanner's as it runs today (multi-region stage M6):
 *   - the home region is the one region discovery scans every inventoried type in;
 *   - S3 buckets are listed account-wide and stored at each bucket's own region;
 *   - CloudFront distributions are global (stored with region 'global').
 * IAM is not inventoried, so nothing here claims it. Which regions the account
 * has enabled is not known until multi-region M5 records it, so the response
 * says it is unknown rather than giving a number.
 *
 * Counts are over the same rows as the Services list and /stats
 * (INVENTORY_FROM + inventoryWhere: this organization, not terminated), and
 * tags_unknown_by_type is /stats' unknown_by_type, from the same ownership rule.
 */
export interface ServicesCoverage {
  account: { connected: boolean; status: string | null; home_region: string | null };
  scope: {
    home_region: { region: string; count: number } | null;
    s3: { in_last_scan: boolean; regions: RegionCount[] };
    cloudfront: { in_last_scan: boolean; count: number };
    enabled_regions: { known: false; count: null };
  };
  last_successful_scan_at: Date | null;
  last_scan: {
    status: string;
    started_at: Date | null;
    completed_at: Date | null;
    warnings: string[];
  } | null;
  resource_types: string[] | null;
  tags_unknown_by_type: Record<string, number>;
  regions: RegionCount[];
  total: number;
}

interface RegionCount {
  region: string | null;
  count: number;
}

// A stored warning is a fixed code (discovery-warnings.ts). Anything else in the
// column is not passed on: the response never carries free text from a job row.
const WARNING_CODE = /^[a-z][a-z0-9_]*$/;

/**
 * The last job's warnings: the codes in resource_discovery_jobs.warnings (the
 * JSONB column multi-region M3 adds and M4c writes) together with those encoded
 * in error_message (where discovery writes them before M4c, and during M4c's
 * dual-write), each once, in that order. The error text itself is never returned.
 */
export function lastScanWarnings(column: unknown, errorMessage: string | null): string[] {
  const fromColumn = Array.isArray(column)
    ? column.filter((code): code is string => typeof code === 'string' && WARNING_CODE.test(code))
    : [];
  return [...new Set([...fromColumn, ...splitDiscoveryMessage(errorMessage).warnings])];
}

/**
 * One statement for everything but the account. The jobs are read with an
 * explicit organization predicate, the inventory through inventoryWhere's; RLS
 * on both tables is a second layer, not the scope.
 *
 * warnings is read as to_jsonb(last_job) -> 'warnings' rather than by name, so the
 * statement is the same whether or not the M3 admin migration that adds the
 * column has been applied: without it, the value is NULL.
 *
 * The last job is the newest by created_at (then id), whatever its status, as
 * services intelligence reads it. The last successful scan is the newest
 * completed_at of a 'completed' job: a 'failed' job may have refreshed some of
 * the inventory, but not which part.
 */
function coverageStatement(orgId: string, homeRegion: string | null) {
  const { where, values } = inventoryWhere(orgId, {});
  const home = values.length + 1;
  const text = `WITH last_job AS (
       SELECT j.*
         FROM resource_discovery_jobs j
        WHERE j.organization_id = $1
        ORDER BY j.created_at DESC, j.id DESC
        LIMIT 1
     ),
     inv AS (
       SELECT r.resource_type AS type, r.region, os.ownership
         FROM ${INVENTORY_FROM}
        WHERE ${where}
     )
     SELECT last_job.status, last_job.started_at, last_job.completed_at, last_job.resource_types,
            last_job.error_message, to_jsonb(last_job) -> 'warnings' AS warnings,
            (SELECT MAX(j.completed_at) FROM resource_discovery_jobs j
              WHERE j.organization_id = $1 AND j.status = 'completed') AS last_successful_scan_at,
            (SELECT COUNT(*) FROM inv)::int AS total,
            (SELECT COUNT(*) FROM inv WHERE inv.region = $${home}::text)::int AS home_count,
            (SELECT COUNT(*) FROM inv WHERE inv.type = 'cloudfront')::int AS cloudfront_count,
            COALESCE(
              (SELECT json_agg(json_build_object('region', region, 'count', n) ORDER BY n DESC, region COLLATE "C")
                 FROM (SELECT region, COUNT(*)::int AS n FROM inv WHERE type = 's3' GROUP BY region) s),
              '[]'::json) AS s3_regions,
            COALESCE(
              (SELECT json_agg(json_build_object('region', region, 'count', n) ORDER BY n DESC, region COLLATE "C")
                 FROM (SELECT region, COUNT(*)::int AS n FROM inv GROUP BY region) g),
              '[]'::json) AS regions,
            COALESCE(
              (SELECT json_object_agg(type, n ORDER BY type)
                 FROM (SELECT type, COUNT(*)::int AS n FROM inv WHERE ownership = 'unknown' GROUP BY type) u),
              '{}'::json) AS tags_unknown_by_type
       FROM (SELECT 1) one
       LEFT JOIN last_job ON true`;
  return { text, values: [...values, homeRegion] };
}

/**
 * The organization's scan coverage. Throws AwsAccountAmbiguousError when it
 * has more than one eligible AWS account.
 */
export async function readServicesCoverage(db: AwsAccountsQueryable, orgId: string): Promise<ServicesCoverage> {
  // aws_accounts has no RLS: findEligibleAwsAccount filters by organization itself.
  const account = await findEligibleAwsAccount(db, orgId);
  const homeRegion = account ? homeRegionOf(account) : null;

  const { text, values } = coverageStatement(orgId, homeRegion);
  const { rows } = await db.query(text, values);
  const row = rows[0];

  const resourceTypes: string[] | null = row.status === null ? null : row.resource_types ?? [];
  const inLastScan = (type: string) => resourceTypes?.includes(type) ?? false;

  return {
    account: account
      ? { connected: true, status: account.status, home_region: homeRegion }
      : { connected: false, status: null, home_region: null },
    scope: {
      home_region: homeRegion === null ? null : { region: homeRegion, count: row.home_count },
      s3: { in_last_scan: inLastScan('s3'), regions: row.s3_regions },
      cloudfront: { in_last_scan: inLastScan('cloudfront'), count: row.cloudfront_count },
      enabled_regions: { known: false, count: null },
    },
    last_successful_scan_at: row.last_successful_scan_at,
    last_scan: row.status === null
      ? null
      : {
          status: row.status,
          started_at: row.started_at,
          completed_at: row.completed_at,
          warnings: lastScanWarnings(row.warnings, row.error_message),
        },
    resource_types: resourceTypes,
    tags_unknown_by_type: row.tags_unknown_by_type,
    regions: row.regions,
    total: row.total,
  };
}

// ─── GET /api/services/coverage ──────────────────────────────────────────────
// The organization is the authenticated caller's. Nothing in the query string
// selects a tenant, and the request takes no parameters.

router.get('/', authenticate, requireCurrentMembership, async (req: Request, res: Response): Promise<void> => {
  try {
    const coverage = await readServicesCoverage(pool, req.user!.organizationId);
    res.json({ success: true, coverage });
  } catch (err: unknown) {
    if (isAwsAccountAmbiguous(err)) {
      res.status(409).json({ success: false, error: AWS_ACCOUNT_AMBIGUOUS_MESSAGE });
      return;
    }
    console.error('[Services/coverage]', err);
    res.status(500).json({ success: false, error: 'Failed to load scan coverage' });
  }
});

export default router;
