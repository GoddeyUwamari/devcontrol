/**
 * AWS Client Factory
 * Creates AWS SDK clients via STS AssumeRole using the org's stored role ARN.
 */

import { CostExplorerClient } from '@aws-sdk/client-cost-explorer';
import { EC2Client } from '@aws-sdk/client-ec2';
import { RDSClient } from '@aws-sdk/client-rds';
import { S3Client } from '@aws-sdk/client-s3';
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
import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';
import { pool } from '../config/database';

interface AWSClients {
  costExplorer: CostExplorerClient;
  ec2: EC2Client;
  rds: RDSClient;
  s3: S3Client;
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
  region: string;
  enabled: boolean;
}

export class AWSClientFactory {
  static async createClients(organizationId: string): Promise<AWSClients> {
    // Look up the org's connected account
    const result = await pool.query(
      `SELECT role_arn, external_id, region FROM aws_accounts WHERE org_id = $1 LIMIT 1`,
      [organizationId]
    );

    if (result.rows.length === 0) {
      if (process.env.NODE_ENV !== 'production') {
        return this.createClientsFromEnv();
      }
      throw new Error(`AWS_NOT_CONNECTED: org ${organizationId} has not connected an AWS account`);
    }

    const { role_arn, external_id, region } = result.rows[0];

    if (!external_id) {
      throw new Error(`AWS_NOT_CONNECTED: org ${organizationId} aws_accounts row is missing external_id`);
    }

    const awsRegion = region ?? 'us-east-1';

    // Assume the customer's role using the platform's own credentials
    const sts = new STSClient({
      region: awsRegion,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    });

    let tempCredentials: { accessKeyId: string; secretAccessKey: string; sessionToken: string };
    try {
      const assumed = await sts.send(new AssumeRoleCommand({
        RoleArn: role_arn,
        RoleSessionName: `devcontrol-${organizationId.slice(0, 8)}`,
        ExternalId: external_id,
        DurationSeconds: 3600,
      }));

      const creds = assumed.Credentials!;
      tempCredentials = {
        accessKeyId: creds.AccessKeyId!,
        secretAccessKey: creds.SecretAccessKey!,
        sessionToken: creds.SessionToken!,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[AWSClientFactory] AssumeRole failed for org ${organizationId}:`, msg);
      throw new Error(`AWS_NOT_CONNECTED: org ${organizationId} has not connected an AWS account`);
    }

    const config = {
      region: awsRegion,
      credentials: tempCredentials,
    };

    console.log(`✅ Using STS AssumeRole credentials for org ${organizationId} (region: ${awsRegion})`);

    return {
      costExplorer: new CostExplorerClient(config),
      ec2: new EC2Client(config),
      rds: new RDSClient(config),
      s3: new S3Client(config),
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
      region: awsRegion,
      enabled: true,
    };
  }

  /** Falls back to .env credentials in non-production environments. */
  static createClientsFromEnv(): AWSClients {
    const hasCredentials = !!(
      process.env.AWS_ACCESS_KEY_ID &&
      process.env.AWS_SECRET_ACCESS_KEY &&
      process.env.AWS_REGION
    );

    if (!hasCredentials) {
      console.log('No global AWS credentials configured, using mock clients');
      return this.createMockClients();
    }

    const config = {
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    };

    console.log(`🔄 Using .env AWS credentials (region: ${config.region})`);

    return {
      costExplorer: new CostExplorerClient(config),
      ec2: new EC2Client(config),
      rds: new RDSClient(config),
      s3: new S3Client(config),
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
      region: config.region,
      enabled: true,
    };
  }

  private static createMockClients(): AWSClients {
    return {
      costExplorer: {} as CostExplorerClient,
      ec2: {} as EC2Client,
      rds: {} as RDSClient,
      s3: {} as S3Client,
      cloudWatch: {} as CloudWatchClient,
      lambda: {} as LambdaClient,
      ecs: {} as ECSClient,
      elb: {} as ElasticLoadBalancingV2Client,
      eks: {} as EKSClient,
      dynamodb: {} as DynamoDBClient,
      cloudFront: {} as CloudFrontClient,
      apiGateway: {} as APIGatewayClient,
      elastiCache: {} as ElastiCacheClient,
      sqs: {} as SQSClient,
      sns: {} as SNSClient,
      region: 'us-east-1',
      enabled: false,
    };
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
