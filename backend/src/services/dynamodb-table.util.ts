/**
 * Real, per-table DynamoDB configuration via DescribeTable -- billing mode,
 * provisioned capacity, table class, GSIs, and Global Table replicas.
 *
 * Foundation only (Phase 3E, Checkpoint A): this module establishes what a
 * table *is* -- it does not evaluate utilization, does not fetch CloudWatch
 * telemetry, and does not make any recommendation. That is deliberately out
 * of scope here; see cost-optimization.service.ts's eventual dynamodb_*
 * detectors (not yet built) for that layer.
 *
 * Billing mode is never inferred from indirect signals. AWS's own
 * `BillingModeSummary.BillingMode` is the only source of truth this module
 * trusts -- the mere presence or absence of `ProvisionedThroughput` is NOT
 * treated as proof of PROVISIONED or PAY_PER_REQUEST (some AWS API/SDK
 * versions and older tables can omit BillingModeSummary even though a real
 * billing mode exists; guessing from ProvisionedThroughput's presence would
 * risk misclassifying exactly the tables future capacity-safety rules most
 * need to get right). When BillingModeSummary is absent or its BillingMode
 * value doesn't match one of AWS's two documented modes, billing_mode is
 * recorded as 'UNKNOWN' -- explicitly, not silently defaulted either way.
 *
 * A DescribeTable failure (permissions, throttling, network, a deleted
 * table) returns `{ status: 'unavailable', reason }` -- callers must treat
 * that as "we don't know anything more about this table this cycle," never
 * as "assume no configuration" or "assume PAY_PER_REQUEST."
 *
 * Autoscaling is deliberately NOT this module's concern: DynamoDB's own
 * DescribeTable response cannot tell you whether Application Auto Scaling
 * is managing a table's capacity -- that lives in a genuinely separate AWS
 * service. See dynamodb-autoscaling.util.ts (Phase 3E, Checkpoint C) for
 * that evidence source; the caller (awsResourceDiscovery.ts's
 * enrichDynamoDBTables()) merges both this module's config and that one's
 * into a single persisted metadata object.
 *
 * `last_increase_date_time`/`last_decrease_date_time` (Checkpoint C): real
 * AWS values from ProvisionedThroughputDescription, present only when AWS
 * actually returns them -- never fabricated, never defaulted to an epoch/
 * zero timestamp when absent. A future capacity-safety rule uses these to
 * avoid recommending a change immediately after the customer's own recent,
 * manual capacity change -- the exact recency threshold is not decided here.
 */
import { DynamoDBClient, DescribeTableCommand } from '@aws-sdk/client-dynamodb';

export type DynamoDBBillingMode = 'PROVISIONED' | 'PAY_PER_REQUEST' | 'UNKNOWN';

export type DynamoDBAutoscalingState = 'AUTOSCALING_ENABLED' | 'AUTOSCALING_DISABLED' | 'AUTOSCALING_UNKNOWN';

export interface DynamoDBGlobalSecondaryIndexConfig {
  index_name: string;
  provisioned_read_capacity?: number;
  provisioned_write_capacity?: number;
}

export interface DynamoDBTableConfig {
  billing_mode: DynamoDBBillingMode;
  /** Raw AWS TableStatus (e.g. ACTIVE, CREATING, UPDATING) -- not force-mapped
   * into the existing coarse aws_resources.status enum, which wasn't built to
   * represent DynamoDB-specific states; the caller leaves that column alone. */
  table_status?: string;
  creation_date_time?: string;
  /**
   * Present whenever AWS's response includes ProvisionedThroughput,
   * regardless of the resolved billing_mode above -- recording a real number
   * DynamoDB actually returned is not the same as using it to infer billing
   * mode, which this module never does.
   */
  provisioned_read_capacity?: number;
  provisioned_write_capacity?: number;
  table_class?: string;
  global_secondary_indexes?: DynamoDBGlobalSecondaryIndexConfig[];
  /** Global Table replica region names, when this table has any. */
  replica_regions?: string[];
  /**
   * Real AWS values, present only when AWS returns them (older tables, or
   * ones whose capacity has never been changed, may have neither) -- never
   * fabricated, never defaulted to an epoch/zero timestamp.
   */
  last_increase_date_time?: string;
  last_decrease_date_time?: string;
}

export type DynamoDBTableDescribeResult =
  | { status: 'described'; config: DynamoDBTableConfig }
  | { status: 'unavailable'; reason: string };

const KNOWN_BILLING_MODES: ReadonlySet<string> = new Set(['PROVISIONED', 'PAY_PER_REQUEST']);

export async function describeDynamoDBTable(
  client: DynamoDBClient,
  tableName: string
): Promise<DynamoDBTableDescribeResult> {
  try {
    const response = await client.send(new DescribeTableCommand({ TableName: tableName }));
    const table = response.Table;

    if (!table) {
      return { status: 'unavailable', reason: 'DescribeTable returned no Table in its response' };
    }

    const reportedBillingMode = table.BillingModeSummary?.BillingMode;
    const billing_mode: DynamoDBBillingMode =
      reportedBillingMode && KNOWN_BILLING_MODES.has(reportedBillingMode)
        ? (reportedBillingMode as DynamoDBBillingMode)
        : 'UNKNOWN';

    const config: DynamoDBTableConfig = {
      billing_mode,
      table_status: table.TableStatus,
      creation_date_time: table.CreationDateTime?.toISOString(),
      table_class: table.TableClassSummary?.TableClass,
    };

    if (table.ProvisionedThroughput) {
      config.provisioned_read_capacity = table.ProvisionedThroughput.ReadCapacityUnits;
      config.provisioned_write_capacity = table.ProvisionedThroughput.WriteCapacityUnits;
      config.last_increase_date_time = table.ProvisionedThroughput.LastIncreaseDateTime?.toISOString();
      config.last_decrease_date_time = table.ProvisionedThroughput.LastDecreaseDateTime?.toISOString();
    }

    if (table.GlobalSecondaryIndexes && table.GlobalSecondaryIndexes.length > 0) {
      config.global_secondary_indexes = table.GlobalSecondaryIndexes.map((gsi) => ({
        index_name: gsi.IndexName || 'unknown',
        provisioned_read_capacity: gsi.ProvisionedThroughput?.ReadCapacityUnits,
        provisioned_write_capacity: gsi.ProvisionedThroughput?.WriteCapacityUnits,
      }));
    }

    if (table.Replicas && table.Replicas.length > 0) {
      const replicaRegions = table.Replicas.map((r) => r.RegionName).filter((r): r is string => !!r);
      if (replicaRegions.length > 0) {
        config.replica_regions = replicaRegions;
      }
    }

    return { status: 'described', config };
  } catch (error: any) {
    return { status: 'unavailable', reason: error?.message || error?.name || 'Unknown error' };
  }
}
