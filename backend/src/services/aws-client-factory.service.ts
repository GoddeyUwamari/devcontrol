/**
 * AWS Client Factory
 * Creates AWS SDK clients via STS AssumeRole using the role ARN of the org's
 * one eligible account (repositories/aws-accounts.repository.ts).
 *
 * The platform's own identity -- whatever the SDK's default credential chain
 * resolves -- is used for exactly one thing here: as the caller identity for
 * sts:AssumeRole. Every client this factory returns
 * carries the temporary credentials of the organization's connected role. An
 * organization with no connected account gets AWS_NOT_CONNECTED and no
 * client, whatever the environment. When the platform's own identity is
 * unavailable, the caller gets PlatformAwsCredentialsUnavailableError
 * instead (see platform-sts.ts): the organization's connection is not at fault.
 */

import { CostExplorerClient } from '@aws-sdk/client-cost-explorer';
import { EC2Client } from '@aws-sdk/client-ec2';
import { RDSClient } from '@aws-sdk/client-rds';
import { S3Client } from '@aws-sdk/client-s3';
import { S3ControlClient } from '@aws-sdk/client-s3-control';
import { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { ECSClient } from '@aws-sdk/client-ecs';
import { ElasticLoadBalancingV2Client } from '@aws-sdk/client-elastic-load-balancing-v2';
import { EKSClient } from '@aws-sdk/client-eks';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { CloudFrontClient } from '@aws-sdk/client-cloudfront';
import { APIGatewayClient } from '@aws-sdk/client-api-gateway';
import { ElastiCacheClient } from '@aws-sdk/client-elasticache';
import { SQSClient } from '@aws-sdk/client-sqs';
import { SNSClient } from '@aws-sdk/client-sns';
import { IAMClient } from '@aws-sdk/client-iam';
import { ResourceExplorer2Client } from '@aws-sdk/client-resource-explorer-2';
import { ApplicationAutoScalingClient } from '@aws-sdk/client-application-auto-scaling';
import { BackupClient } from '@aws-sdk/client-backup';
import { SecurityHubClient } from '@aws-sdk/client-securityhub';
import { pool } from '../config/database';
import { assumeRoleAsPlatform, isPlatformAwsCredentialsUnavailable } from './platform-sts';
import { homeRegionOf, requireEligibleAwsAccount, type AwsAccountRow } from '../repositories/aws-accounts.repository';

export interface AWSClients {
  costExplorer: CostExplorerClient;
  ec2: EC2Client;
  rds: RDSClient;
  s3: S3Client;
  // Account-level S3 settings (Block Public Access). Optional so callers and mocks that
  // never read account-level settings need not provide it.
  s3Control?: S3ControlClient;
  cloudWatch: CloudWatchClient;
  lambda: LambdaClient;
  ecs: ECSClient;
  elb: ElasticLoadBalancingV2Client;
  eks: EKSClient;
  dynamodb: DynamoDBClient;
  cloudFront: CloudFrontClient;
  apiGateway: APIGatewayClient;
  elastiCache: ElastiCacheClient;
  sqs: SQSClient;
  sns: SNSClient;
  iam: IAMClient;
  resourceExplorer: ResourceExplorer2Client;
  backup: BackupClient;
  securityHub: SecurityHubClient;
  region: string;
  enabled: boolean;
  // 12-digit account ID parsed from role_arn, when available — lets account-level
  // checks (e.g. security group findings) build a real resource ARN instead of '*'.
  accountId?: string;
  /**
   * Additive, regional escape hatch: builds a DynamoDBClient for a specific
   * region using the SAME credentials already resolved for this call (the
   * `dynamodb` client above is scoped only to `region`, the org's single
   * configured/primary region). Needed because a DynamoDB table's real
   * region (from Resource Explorer's per-resource Region field -- see
   * resourceExplorer.service.ts) is not guaranteed to match the org's
   * primary region, and every other client on this object intentionally
   * keeps that single-region assumption unchanged. Costs zero additional
   * AssumeRole calls -- it's a plain client construction, not a new
   * credentials fetch.
   */
  getDynamoDBClientForRegion: (region: string) => DynamoDBClient;
  /**
   * Same additive, regional escape hatch as getDynamoDBClientForRegion above,
   * for Application Auto Scaling (Phase 3E, Checkpoint C) -- a table's
   * autoscaling configuration must be queried in the table's own region, not
   * necessarily the org's primary region. Same reused credentials, zero
   * additional AssumeRole calls.
   */
  getApplicationAutoScalingClientForRegion: (region: string) => ApplicationAutoScalingClient;
  /**
   * Same additive, regional escape hatch as getDynamoDBClientForRegion above,
   * for CloudWatch (Phase 3E, Checkpoint C) -- a table's telemetry must be
   * queried in the table's own region. Does NOT change the existing
   * `cloudWatch` client's behavior (still scoped to the org's primary
   * region) and is not wired into any consumer by this change -- callers
   * opt in explicitly. Same reused credentials, zero additional AssumeRole
   * calls.
   */
  getCloudWatchClientForRegion: (region: string) => CloudWatchClient;
  /**
   * Same regional escape hatch, for S3: a bucket's tags are answered by the bucket's
   * own region, which can differ from the org's primary region. Optional so mocks
   * that never read a bucket outside the primary region need not provide it.
   */
  getS3ClientForRegion?: (region: string) => S3Client;
}

/** Extracts the 12-digit account ID from an IAM role/user ARN, e.g. arn:aws:iam::123456789012:role/x */
export function parseAccountIdFromArn(arn: string): string | undefined {
  return arn.match(/^arn:aws:iam::(\d{12}):/)?.[1];
}

/** The assumed role's temporary credentials, as every client is built with them. */
export interface TemporaryCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
}

/**
 * How a set of clients from createClients() was obtained, so a scan context
 * (scan-context.ts) can assume the same role again before the credentials
 * expire. `credentials` is the one object every client was built with: the
 * SDK signs each request with that object's current values, so replacing its
 * values refreshes every client at once.
 */
export interface AssumedRoleSource {
  organizationId: string;
  account: AwsAccountRow;
  region: string;
  credentials: TemporaryCredentials;
  expiration: Date | undefined;
}

const assumedRoleSources = new WeakMap<AWSClients, AssumedRoleSource>();

/** The source of clients built by createClients(); undefined for any other object. */
export function assumedRoleSourceOf(clients: AWSClients): AssumedRoleSource | undefined {
  return assumedRoleSources.get(clients);
}

export class AWSClientFactory {
  static async createClients(organizationId: string): Promise<AWSClients> {
    // The org's one eligible account (aws-accounts.repository.ts). None means no
    // clients, in every environment: nothing organization-scoped ever runs on
    // the platform's own credentials. More than one is refused, never guessed.
    const account = await requireEligibleAwsAccount(pool, organizationId);
    const { role_arn, external_id } = account;

    if (!external_id) {
      throw new Error(`AWS_NOT_CONNECTED: org ${organizationId} aws_accounts row is missing external_id`);
    }

    const awsRegion = homeRegionOf(account);
    const { credentials: tempCredentials, expiration } = await this.assumeAccountRole(organizationId, account, awsRegion);

    const config = {
      region: awsRegion,
      credentials: tempCredentials,
    };

    console.log(`✅ Using STS AssumeRole credentials for org ${organizationId} (region: ${awsRegion})`);

    const clients: AWSClients = {
      costExplorer: new CostExplorerClient({ ...config, region: 'us-east-1' }), // Cost Explorer is global
      ec2: new EC2Client(config),
      rds: new RDSClient(config),
      s3: new S3Client(config),
      s3Control: new S3ControlClient(config),
      cloudWatch: new CloudWatchClient(config),
      lambda: new LambdaClient(config),
      ecs: new ECSClient(config),
      elb: new ElasticLoadBalancingV2Client(config),
      eks: new EKSClient(config),
      dynamodb: new DynamoDBClient(config),
      cloudFront: new CloudFrontClient({ ...config, region: 'us-east-1' }),
      apiGateway: new APIGatewayClient(config),
      elastiCache: new ElastiCacheClient(config),
      sqs: new SQSClient(config),
      sns: new SNSClient(config),
      iam: new IAMClient({ ...config, region: 'us-east-1' }), // IAM is global
      resourceExplorer: new ResourceExplorer2Client(config),
      backup: new BackupClient(config),
      securityHub: new SecurityHubClient(config),
      region: awsRegion,
      enabled: true,
      accountId: parseAccountIdFromArn(role_arn),
      getDynamoDBClientForRegion: (region: string) => new DynamoDBClient({ region, credentials: tempCredentials }),
      getApplicationAutoScalingClientForRegion: (region: string) =>
        new ApplicationAutoScalingClient({ region, credentials: tempCredentials }),
      getCloudWatchClientForRegion: (region: string) => new CloudWatchClient({ region, credentials: tempCredentials }),
      getS3ClientForRegion: (region: string) => new S3Client({ region, credentials: tempCredentials }),
    };
    assumedRoleSources.set(clients, { organizationId, account, region: awsRegion, credentials: tempCredentials, expiration });
    return clients;
  }

  /**
   * Assumes the account's role as the platform's own identity, resolved by
   * the SDK's default credential chain (the instance role in production).
   * The platform identity being unavailable is rethrown as is; any other
   * failure is the organization's connection, AWS_NOT_CONNECTED.
   */
  static async assumeAccountRole(
    organizationId: string,
    account: Pick<AwsAccountRow, 'role_arn' | 'external_id'>,
    region: string
  ): Promise<{ credentials: TemporaryCredentials; expiration: Date | undefined }> {
    try {
      const assumed = await assumeRoleAsPlatform(region, {
        RoleArn: account.role_arn,
        RoleSessionName: `devcontrol-${organizationId.slice(0, 8)}`,
        ExternalId: account.external_id ?? undefined,
        DurationSeconds: 3600,
      }, `AWSClientFactory org ${organizationId}`);

      const creds = assumed.Credentials!;
      return {
        credentials: {
          accessKeyId: creds.AccessKeyId!,
          secretAccessKey: creds.SecretAccessKey!,
          sessionToken: creds.SessionToken!,
        },
        expiration: creds.Expiration,
      };
    } catch (err: unknown) {
      // The platform's own identity is unavailable: not the organization's
      // connection, so never reported as AWS_NOT_CONNECTED.
      if (isPlatformAwsCredentialsUnavailable(err)) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[AWSClientFactory] AssumeRole failed for org ${organizationId}:`, msg);
      throw new Error(`AWS_NOT_CONNECTED: org ${organizationId} has not connected an AWS account`);
    }
  }

  static async validateCredentials(organizationId: string): Promise<boolean> {
    try {
      const clients = await this.createClients(organizationId);
      if (!clients.enabled) return false;
      await clients.s3.send(new (await import('@aws-sdk/client-s3')).ListBucketsCommand({}));
      return true;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`AWS credential validation failed for org ${organizationId}:`, msg);
      return false;
    }
  }
}
