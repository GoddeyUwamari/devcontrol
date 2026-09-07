/**
 * Real DynamoDB autoscaling classification via Application Auto Scaling's
 * DescribeScalableTargets -- a different AWS service from DynamoDB itself,
 * deliberately kept in its own module (mirrors dynamodb-table.util.ts vs
 * dynamodb-usage.util.ts's per-API-surface separation).
 *
 * IAM evidence (Phase 3E, Checkpoint C): AWS-managed `ReadOnlyAccess`, as
 * granted to the connected "Test Account" role
 * (arn:aws:iam::815931739526:role/DevControlRole-Test, org
 * c4c6d2b0-3a4d-4507-8577-fc232c5e99fb -- the same account
 * cloudwatch.service.ts's CAPABILITY_VALIDATION_STATUS already uses for
 * exactly this kind of IAM-permission-boundary check), was live-tested
 * against real AssumeRole credentials in this session:
 *   - DescribeScalableTargets(ServiceNamespace: 'dynamodb') -- succeeded (0 targets)
 *   - DescribeScalingPolicies(ServiceNamespace: 'dynamodb') -- succeeded (0 policies)
 *   - DescribeScalableTargets scoped to a specific, nonexistent table
 *     ResourceId + dynamodb:table:ReadCapacityUnits dimension -- succeeded
 *     (empty array, not an error)
 * Same caveat as the EKS/ECS entries in cloudwatch.service.ts: this test
 * role uses a broad managed policy, not necessarily representative of a
 * real customer's least-privilege onboarding grant -- no IAM policy
 * document for real customer onboarding exists in this repository to
 * verify against. Bump this module's confidence once a real or disposable
 * autoscaled table has been evaluated end-to-end under a real customer's
 * actual (not test-account) role.
 *
 * API-semantics evidence, also live-verified (not assumed): DynamoDB's
 * ResourceId format for DescribeScalableTargets is `table/<TableName>` --
 * exactly the same table name discovery already has as resource_id, no
 * translation needed. Omitting ScalableDimension while providing
 * ResourceIds returns every registered scalable target for that resource
 * (both read and write dimensions, if either/both are registered) in a
 * single call -- confirmed against the SDK's own request-shape
 * documentation ("If you specify a scalable dimension, you must also
 * specify a resource ID" -- implying the reverse, ResourceIds alone
 * without ScalableDimension, is valid and unfiltered by dimension). A
 * table with no autoscaling configured returns an empty ScalableTargets
 * array, not an error -- verified live against a genuinely nonexistent
 * table name, which returned the same empty-array shape a real,
 * unconfigured table would. This is what makes "no scalable target
 * returned" a reliable DISABLED signal rather than an ambiguous one: AWS's
 * List/Describe semantics for this API don't distinguish "resource doesn't
 * exist" from "resource exists but isn't registered" -- both come back as
 * an empty collection, never an exception.
 *
 * Classification (conservative, per explicit product decision): ENABLED if
 * EITHER the read or write dimension has a registered scalable target --
 * a detector must not reduce capacity on any axis if autoscaling governs
 * either one. DISABLED only when the call succeeds and returns targets for
 * NEITHER dimension. UNKNOWN on any API error -- never collapsed into
 * DISABLED.
 */
import { ApplicationAutoScalingClient, DescribeScalableTargetsCommand } from '@aws-sdk/client-application-auto-scaling';
import { DynamoDBAutoscalingState } from './dynamodb-table.util';

const DYNAMODB_TABLE_READ_DIMENSION = 'dynamodb:table:ReadCapacityUnits';
const DYNAMODB_TABLE_WRITE_DIMENSION = 'dynamodb:table:WriteCapacityUnits';

export interface DynamoDBAutoscalingConfig {
  autoscaling_state: DynamoDBAutoscalingState;
  /** Whether a scalable target is registered for the base table's read capacity, specifically. */
  read_capacity_autoscaled: boolean;
  /** Whether a scalable target is registered for the base table's write capacity, specifically. */
  write_capacity_autoscaled: boolean;
}

export type DynamoDBAutoscalingResult =
  | { status: 'described'; config: DynamoDBAutoscalingConfig }
  | { status: 'unavailable'; reason: string };

export async function describeDynamoDBAutoscaling(
  client: ApplicationAutoScalingClient,
  tableName: string
): Promise<DynamoDBAutoscalingResult> {
  try {
    const response = await client.send(
      new DescribeScalableTargetsCommand({
        ServiceNamespace: 'dynamodb',
        ResourceIds: [`table/${tableName}`],
      })
    );

    const targets = response.ScalableTargets || [];
    const read_capacity_autoscaled = targets.some((t) => t.ScalableDimension === DYNAMODB_TABLE_READ_DIMENSION);
    const write_capacity_autoscaled = targets.some((t) => t.ScalableDimension === DYNAMODB_TABLE_WRITE_DIMENSION);

    const autoscaling_state: DynamoDBAutoscalingState =
      read_capacity_autoscaled || write_capacity_autoscaled ? 'AUTOSCALING_ENABLED' : 'AUTOSCALING_DISABLED';

    return {
      status: 'described',
      config: { autoscaling_state, read_capacity_autoscaled, write_capacity_autoscaled },
    };
  } catch (error: any) {
    return { status: 'unavailable', reason: error?.message || error?.name || 'Unknown error' };
  }
}
