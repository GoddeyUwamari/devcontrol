/**
 * Aurora Service Health: a single, fleet-level (never per-resource) RDS
 * DescribeDBClusters call, shared by two independent callers at two
 * different points in the pipeline:
 *
 * - awsResourceDiscovery.ts's enrichAuroraClusters() (discovery-time,
 *   runs every 6h per the resource discovery job's schedule): corrects
 *   the generic Resource Explorer classification, which cannot distinguish
 *   a real Aurora cluster from a non-Aurora RDS Multi-AZ DB cluster --
 *   both surface as AWS::RDS::DBCluster (see resourceExplorer.service.ts).
 * - cloudwatch.service.ts's evaluateAuroraClusters() (evaluation-time,
 *   runs on the existing 45s cache cadence): a discovery-time snapshot up
 *   to 6h old would make Aurora's health signal silently far staler than
 *   every other CloudWatch-evaluated type's -- this caller needs its own
 *   fresh call, not a reuse of discovery's last result.
 *
 * Sharing this module (not a runtime call result, which can't cross
 * process/schedule boundaries) is what satisfies "do not introduce
 * duplicate identity/classification parsing" -- both callers apply the
 * exact same Engine-based Aurora-vs-not classification and the exact same
 * reader-detection logic.
 *
 * `Engine` is the only AWS-documented, authoritative way to distinguish a
 * real Aurora cluster (`aurora`, `aurora-mysql`, `aurora-postgresql`) from
 * a non-Aurora RDS Multi-AZ DB cluster (`mysql`, `postgres`) -- both are
 * valid values of the same DescribeDBClusters `Engine` field on the same
 * `AWS::RDS::DBCluster` resource type. `DBCluster.Status` itself has no
 * AWS-documented closed enum (confirmed against both the API reference
 * prose and the installed SDK's own `Status?: string` typing) -- callers
 * must treat any unrecognized value defensively, never assume completeness.
 */
import { RDSClient, paginateDescribeDBClusters } from '@aws-sdk/client-rds';

// 'aurora' (the legacy bare engine name, pre-dating the aurora-mysql/
// aurora-postgresql split) is included defensively even though current AWS
// documentation only lists aurora-mysql/aurora-postgresql as creatable
// values -- never treated as a non-Aurora engine on the strength of an
// AWS docs page not mentioning a legacy value explicitly.
const AURORA_ENGINES: ReadonlySet<string> = new Set(['aurora', 'aurora-mysql', 'aurora-postgresql']);

export interface AuroraClusterInfo {
  dbClusterIdentifier: string;
  engine: string;
  engineMode?: string;
  status?: string;
  // Derived from DBClusterMembers -- true when at least one member is not
  // the writer. Determines whether AuroraReplicaLagMaximum is an applicable
  // signal at all for this cluster (see evaluateAuroraClusters()).
  hasReader: boolean;
  isAuroraEngine: boolean;
}

export type DescribeAuroraClustersResult =
  | { status: 'described'; clustersById: Map<string, AuroraClusterInfo> }
  | { status: 'unavailable'; reason: string };

/**
 * One unfiltered, paginated DescribeDBClusters call for the whole region --
 * never one call per cluster. Returns every DB cluster AWS reports back
 * (Aurora and non-Aurora alike; `isAuroraEngine` lets a caller filter),
 * keyed by DBClusterIdentifier for O(1) lookup against already-discovered
 * inventory rows.
 */
export async function describeAuroraClusters(client: RDSClient): Promise<DescribeAuroraClustersResult> {
  try {
    const clustersById = new Map<string, AuroraClusterInfo>();
    for await (const page of paginateDescribeDBClusters({ client }, {})) {
      for (const cluster of page.DBClusters ?? []) {
        if (!cluster.DBClusterIdentifier) continue;
        const engine = cluster.Engine ?? '';
        clustersById.set(cluster.DBClusterIdentifier, {
          dbClusterIdentifier: cluster.DBClusterIdentifier,
          engine,
          engineMode: cluster.EngineMode,
          status: cluster.Status,
          hasReader: (cluster.DBClusterMembers ?? []).some((m) => m.IsClusterWriter === false),
          isAuroraEngine: AURORA_ENGINES.has(engine),
        });
      }
    }
    return { status: 'described', clustersById };
  } catch (error: any) {
    return { status: 'unavailable', reason: error?.message || error?.name || 'Unknown error' };
  }
}
