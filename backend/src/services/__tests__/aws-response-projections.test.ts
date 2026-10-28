/**
 * The projections applied to ListFunctions, ListDistributions, GetFindings and
 * DescribeAlarms
 * keep exactly the fields DevControl uses, and nothing else from the response
 * reaches what discovery, the cost detector or the Security Hub client return
 * or log. Each fixture fills fields DevControl does not use with marker values
 * and checks that no marker comes out.
 *
 * The call-site rules are in __tests__/aws-response-classification.static.test.ts.
 */
import { LambdaClient, type FunctionConfiguration } from '@aws-sdk/client-lambda';
import { CloudFrontClient, type DistributionSummary } from '@aws-sdk/client-cloudfront';
import { CloudWatchClient, type CompositeAlarm, type MetricAlarm } from '@aws-sdk/client-cloudwatch';
import { SecurityHubClient, type AwsSecurityFinding } from '@aws-sdk/client-securityhub';
import {
  projectCloudFrontDistribution,
  projectCompositeAlarm,
  projectLambdaFunction,
  projectMetricAlarm,
} from '../aws-response-projections';
import { normalizeFinding, SecurityHubClientService } from '../security-hub-client.service';
import { AWSResourceDiscoveryService } from '../awsResourceDiscovery';
import costOptimizationService from '../cost-optimization.service';

const ORG = '00000000-0000-0000-0000-000000000001';
const MARKER = 'marker-not-kept';

const withMockedSend = <T>(client: T, send: jest.Mock): T => {
  (client as any).send = send;
  return client;
};

let consoleCalls: jest.SpyInstance[] = [];
beforeEach(() => {
  consoleCalls = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) => jest.spyOn(console, level).mockImplementation(() => {}));
});
afterEach(() => jest.restoreAllMocks());

/** Everything a test produced or logged, as one string to search for markers. */
const everything = (value: unknown) =>
  JSON.stringify(value) + JSON.stringify(consoleCalls.flatMap((spy) => spy.mock.calls.map((args) => args.map(String))));

// ---------------------------------------------------------------------------
// Lambda
// ---------------------------------------------------------------------------

const lambdaFunction = (overrides: Partial<FunctionConfiguration> = {}): FunctionConfiguration => ({
  FunctionName: 'orders-api',
  FunctionArn: 'arn:aws:lambda:us-east-1:111122223333:function:orders-api',
  Runtime: 'nodejs20.x',
  Role: 'arn:aws:iam::111122223333:role/orders-api',
  Handler: 'index.handler',
  CodeSize: 2048,
  Description: MARKER,
  Timeout: 30,
  MemorySize: 512,
  LastModified: '2026-10-01T12:00:00.000+0000',
  CodeSha256: MARKER,
  Version: '$LATEST',
  VpcConfig: { SubnetIds: ['subnet-1'], SecurityGroupIds: ['sg-1'], VpcId: 'vpc-1' },
  Environment: { Variables: { DATABASE_URL: MARKER, API_TOKEN: MARKER } },
  KMSKeyArn: 'arn:aws:kms:us-east-1:111122223333:key/k',
  Layers: [{ Arn: 'arn:aws:lambda:us-east-1:111122223333:layer:shared:1', CodeSize: 10 }],
  State: 'Active',
  Architectures: ['arm64'],
  ImageConfigResponse: { ImageConfig: { Command: [MARKER], EntryPoint: [MARKER], WorkingDirectory: MARKER } },
  ...overrides,
});

describe('projectLambdaFunction', () => {
  it('keeps exactly the fields discovery and the cost detector use', () => {
    expect(projectLambdaFunction(lambdaFunction())).toEqual({
      FunctionArn: 'arn:aws:lambda:us-east-1:111122223333:function:orders-api',
      FunctionName: 'orders-api',
      Runtime: 'nodejs20.x',
      MemorySize: 512,
      Timeout: 30,
      LastModified: '2026-10-01T12:00:00.000+0000',
      CodeSize: 2048,
      Handler: 'index.handler',
      Architectures: ['arm64'],
      State: 'Active',
    });
  });

  it('has no other key, and no marker value', () => {
    const projected = projectLambdaFunction(lambdaFunction());
    expect(Object.keys(projected).sort()).toEqual([
      'Architectures', 'CodeSize', 'FunctionArn', 'FunctionName', 'Handler', 'LastModified', 'MemorySize', 'Runtime', 'State', 'Timeout',
    ]);
    expect(JSON.stringify(projected)).not.toContain(MARKER);
  });

  it('leaves a field AWS did not return undefined', () => {
    expect(projectLambdaFunction({ FunctionName: 'bare' })).toEqual({ FunctionName: 'bare' });
  });

  it('discovery stores the same fields as before, and nothing else from the response', async () => {
    const lambda = withMockedSend(new LambdaClient({ region: 'us-east-1' }), jest.fn(async (command: any) => {
      if (command.constructor.name === 'ListFunctionsCommand') return { Functions: [lambdaFunction()] };
      if (command.constructor.name === 'ListTagsCommand') return { Tags: { team: 'orders' } };
      throw new Error(`Unexpected command: ${command.constructor.name}`);
    }));
    const noUsage = withMockedSend(new CloudWatchClient({ region: 'us-east-1' }), jest.fn(async () => {
      throw Object.assign(new Error('AccessDenied'), { name: 'AccessDenied' });
    }));

    const resources = await (new AWSResourceDiscoveryService({} as any) as any)
      .discoverLambdaFunctions(ORG, lambda, noUsage, 'us-east-1');

    expect(resources).toHaveLength(1);
    expect(resources[0]).toMatchObject({
      resource_arn: 'arn:aws:lambda:us-east-1:111122223333:function:orders-api',
      resource_id: 'orders-api',
      resource_name: 'orders-api',
      status: 'Active',
      tags: { team: 'orders' },
      metadata: {
        tags_state: 'observed',
        runtime: 'nodejs20.x',
        memory: 512,
        timeout: 30,
        last_modified: '2026-10-01T12:00:00.000+0000',
        code_size: 2048,
        handler: 'index.handler',
        architecture: 'arm64',
        usage_state: 'unavailable',
      },
    });
    expect(everything(resources)).not.toContain(MARKER);
  });

  it('the low-usage detector keeps the same result, and nothing else from the response', async () => {
    const lambda = withMockedSend(new LambdaClient({ region: 'us-east-1' }), jest.fn().mockResolvedValueOnce({
      Functions: [lambdaFunction({ FunctionName: 'never-called', MemorySize: 128 })],
    }));
    const cloudWatch = withMockedSend(new CloudWatchClient({ region: 'us-east-1' }), jest.fn().mockResolvedValueOnce({ Datapoints: [] }));

    const result = await (costOptimizationService as any).detectLowUsageLambdaFunctions('test-org', lambda, cloudWatch, {
      ruleId: 'lambda_low_usage', parameterId: 'max_invocations', value: 10, source: 'default',
    }, 'us-east-1');

    expect(result.success).toBe(true);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({
      resourceId: 'never-called',
      resourceName: 'never-called',
      metadata: { invocations_30d: 0, memory_mb: 128, usage_state: 'zero_usage' },
    });
    expect(everything(result)).not.toContain(MARKER);
  });
});

// ---------------------------------------------------------------------------
// CloudFront
// ---------------------------------------------------------------------------

const distribution = (): DistributionSummary => ({
  Id: 'E0ABC',
  ARN: 'arn:aws:cloudfront::111122223333:distribution/E0ABC',
  ETag: MARKER,
  Status: 'Deployed',
  LastModifiedTime: new Date('2026-10-01T12:00:00.000Z'),
  DomainName: 'd0abc.cloudfront.net',
  Aliases: { Quantity: 0 },
  Origins: {
    Quantity: 2,
    Items: [
      {
        Id: 'app',
        DomainName: 'app.example.com',
        OriginPath: MARKER,
        CustomHeaders: { Quantity: 1, Items: [{ HeaderName: 'X-Origin-Check', HeaderValue: MARKER }] },
        CustomOriginConfig: { HTTPPort: 80, HTTPSPort: 443, OriginProtocolPolicy: 'https-only' },
      },
      { Id: 'assets', DomainName: 'assets.example.com', S3OriginConfig: { OriginAccessIdentity: '' } },
    ],
  },
  DefaultCacheBehavior: { TargetOriginId: 'app', ViewerProtocolPolicy: 'redirect-to-https' },
  CacheBehaviors: { Quantity: 0 },
  CustomErrorResponses: { Quantity: 0 },
  Comment: MARKER,
  PriceClass: 'PriceClass_100',
  Enabled: true,
  ViewerCertificate: {},
  Restrictions: { GeoRestriction: { RestrictionType: 'none', Quantity: 0 } },
  WebACLId: '',
  HttpVersion: 'http2',
  IsIPV6Enabled: true,
  Staging: false,
});

describe('projectCloudFrontDistribution', () => {
  it('keeps exactly the fields discovery uses, with each origin as its domain name', () => {
    expect(projectCloudFrontDistribution(distribution())).toEqual({
      ARN: 'arn:aws:cloudfront::111122223333:distribution/E0ABC',
      Id: 'E0ABC',
      DomainName: 'd0abc.cloudfront.net',
      Status: 'Deployed',
      PriceClass: 'PriceClass_100',
      Enabled: true,
      HttpVersion: 'http2',
      LastModifiedTime: new Date('2026-10-01T12:00:00.000Z'),
      OriginDomainNames: ['app.example.com', 'assets.example.com'],
    });
  });

  it('has no other key, and no marker value', () => {
    const projected = projectCloudFrontDistribution(distribution());
    expect(Object.keys(projected).sort()).toEqual([
      'ARN', 'DomainName', 'Enabled', 'HttpVersion', 'Id', 'LastModifiedTime', 'OriginDomainNames', 'PriceClass', 'Status',
    ]);
    expect(JSON.stringify(projected)).not.toContain(MARKER);
  });

  it('a distribution with no origins has an empty origin list', () => {
    expect(projectCloudFrontDistribution({ ...distribution(), Origins: undefined }).OriginDomainNames).toEqual([]);
  });

  it('discovery stores the same fields as before, and nothing else from the response', async () => {
    const cloudFront = withMockedSend(new CloudFrontClient({ region: 'us-east-1' }), jest.fn(async () => ({
      DistributionList: { Items: [distribution()], IsTruncated: false },
    })));

    const resources = await (new AWSResourceDiscoveryService({} as any) as any).discoverCloudFrontDistributions(ORG, cloudFront);

    expect(resources).toHaveLength(1);
    expect(resources[0]).toMatchObject({
      resource_arn: 'arn:aws:cloudfront::111122223333:distribution/E0ABC',
      resource_id: 'E0ABC',
      resource_name: 'd0abc.cloudfront.net',
      region: 'global',
      status: 'active',
      metadata: {
        tags_state: 'unavailable',
        domain_name: 'd0abc.cloudfront.net',
        status: 'Deployed',
        price_class: 'PriceClass_100',
        origins: ['app.example.com', 'assets.example.com'],
        is_enabled: true,
        http_version: 'http2',
        last_modified: '2026-10-01T12:00:00.000Z',
      },
    });
    expect(everything(resources)).not.toContain(MARKER);
  });
});

// ---------------------------------------------------------------------------
// Security Hub
// ---------------------------------------------------------------------------

const finding = (): AwsSecurityFinding => ({
  SchemaVersion: '2018-10-08',
  Id: 'arn:aws:securityhub:us-east-1:111122223333:security-control/Lambda.1/finding/0001',
  ProductArn: 'arn:aws:securityhub:us-east-1::product/aws/securityhub',
  GeneratorId: 'security-control/Lambda.1',
  AwsAccountId: '111122223333',
  Region: 'us-east-1',
  Types: ['Software and Configuration Checks'],
  CreatedAt: '2026-10-01T12:00:00.000Z',
  UpdatedAt: '2026-10-02T12:00:00.000Z',
  Severity: { Label: 'HIGH' },
  Title: 'Lambda function policies should prohibit public access',
  Description: MARKER,
  ProductFields: { note: MARKER },
  Remediation: { Recommendation: { Text: MARKER } },
  Compliance: {
    Status: 'FAILED',
    SecurityControlId: 'Lambda.1',
    AssociatedStandards: [{ StandardsId: 'standards/aws-foundational-security-best-practices/v/1.0.0' }],
    RelatedRequirements: ['NIST.800-53.r5 AC-21'],
  },
  RecordState: 'ACTIVE',
  Workflow: { Status: 'NEW' },
  Resources: [
    {
      Type: 'AwsLambdaFunction',
      Id: 'arn:aws:lambda:us-east-1:111122223333:function:orders-api',
      Details: {
        AwsLambdaFunction: { FunctionName: 'orders-api', Environment: { Variables: { API_TOKEN: MARKER } } },
        AwsEcsTaskDefinition: { ContainerDefinitions: [{ Name: 'app', Environment: [{ Name: 'API_TOKEN', Value: MARKER }] }] },
        AwsCodeBuildProject: { Environment: { EnvironmentVariables: [{ Name: 'API_TOKEN', Type: 'PLAINTEXT', Value: MARKER }] } },
        AwsEc2LaunchTemplate: { LaunchTemplateData: { UserData: MARKER } },
        AwsElasticBeanstalkEnvironment: { OptionSettings: [{ Namespace: 'aws:elasticbeanstalk:application:environment', OptionName: 'API_TOKEN', Value: MARKER }] },
        AwsCloudFormationStack: { Outputs: [{ OutputKey: 'Token', OutputValue: MARKER }] },
        Other: { note: MARKER },
      },
    },
  ],
});

describe('normalizeFinding', () => {
  it('keeps exactly the fields Security Hub evaluation uses', () => {
    expect(normalizeFinding(finding())).toEqual({
      findingId: 'arn:aws:securityhub:us-east-1:111122223333:security-control/Lambda.1/finding/0001',
      productArn: 'arn:aws:securityhub:us-east-1::product/aws/securityhub',
      region: 'us-east-1',
      title: 'Lambda function policies should prohibit public access',
      severity: 'high',
      complianceStatus: 'FAILED',
      recordState: 'ACTIVE',
      workflowStatus: 'NEW',
      securityControlId: 'Lambda.1',
      associatedStandardIds: ['standards/aws-foundational-security-best-practices/v/1.0.0'],
      relatedRequirements: ['NIST.800-53.r5 AC-21'],
      resourceType: 'AwsLambdaFunction',
      resourceId: 'arn:aws:lambda:us-east-1:111122223333:function:orders-api',
      securityHubCreatedAt: '2026-10-01T12:00:00.000Z',
      securityHubUpdatedAt: '2026-10-02T12:00:00.000Z',
      lastSeenAt: expect.any(String),
    });
  });

  it('has no resource details, product fields, description or remediation text', () => {
    expect(JSON.stringify(normalizeFinding(finding()))).not.toContain(MARKER);
  });

  it('the paged findings reader yields only normalized findings', async () => {
    const securityHub = withMockedSend(
      new SecurityHubClient({ region: 'us-east-1', credentials: { accessKeyId: 'x', secretAccessKey: 'y' } }),
      jest.fn().mockResolvedValueOnce({ Findings: [finding()], NextToken: undefined })
    );
    const pages = [];
    for await (const page of SecurityHubClientService.getActiveFindingsPaged(securityHub)) pages.push(page);

    expect(pages).toHaveLength(1);
    expect(pages[0].findings).toEqual([normalizeFinding(finding())].map((f) => ({ ...f, lastSeenAt: expect.any(String) })));
    expect(everything(pages)).not.toContain(MARKER);
  });
});

// ---------------------------------------------------------------------------
// CloudWatch alarms (DescribeAlarms)
// ---------------------------------------------------------------------------

const ACTION_ARN = 'arn:aws:sns:us-east-1:111122223333:marker-not-kept-topic';
const TRANSITIONED = new Date('2026-10-27T08:00:00.000Z');
const UPDATED = new Date('2026-10-28T09:30:00.000Z');

const metricAlarm = (overrides: Partial<MetricAlarm> = {}): MetricAlarm => ({
  AlarmName: 'orders-cpu-high',
  AlarmArn: 'arn:aws:cloudwatch:us-east-1:111122223333:alarm:orders-cpu-high',
  AlarmDescription: MARKER,
  AlarmConfigurationUpdatedTimestamp: new Date('2026-01-01T00:00:00.000Z'),
  ActionsEnabled: true,
  OKActions: [ACTION_ARN],
  AlarmActions: [ACTION_ARN],
  InsufficientDataActions: [ACTION_ARN],
  StateValue: 'ALARM',
  StateReason: MARKER,
  StateReasonData: `{"note":"${MARKER}"}`,
  StateUpdatedTimestamp: UPDATED,
  StateTransitionedTimestamp: TRANSITIONED,
  MetricName: 'CPUUtilization',
  Namespace: 'AWS/EC2',
  Statistic: 'Average',
  Dimensions: [{ Name: 'InstanceId', Value: 'i-0123456789abcdef0' }],
  Period: 300,
  EvaluationPeriods: 3,
  DatapointsToAlarm: 2,
  Threshold: 80,
  ComparisonOperator: 'GreaterThanThreshold',
  TreatMissingData: 'missing',
  EvaluateLowSampleCountPercentile: MARKER,
  ThresholdMetricId: MARKER,
  ...overrides,
});

const compositeAlarm = (overrides: Partial<CompositeAlarm> = {}): CompositeAlarm => ({
  AlarmName: 'orders-degraded',
  AlarmArn: 'arn:aws:cloudwatch:us-east-1:111122223333:alarm:marker-not-kept-composite',
  AlarmDescription: MARKER,
  AlarmRule: `ALARM("${MARKER}")`,
  ActionsEnabled: true,
  OKActions: [ACTION_ARN],
  AlarmActions: [ACTION_ARN],
  InsufficientDataActions: [ACTION_ARN],
  StateValue: 'ALARM',
  StateReason: MARKER,
  StateReasonData: MARKER,
  StateUpdatedTimestamp: UPDATED,
  StateTransitionedTimestamp: TRANSITIONED,
  ActionsSuppressor: 'arn:aws:cloudwatch:us-east-1:111122223333:alarm:marker-not-kept-suppressor',
  ActionsSuppressedBy: 'Alarm',
  ActionsSuppressedReason: MARKER,
  ...overrides,
});

describe('projectMetricAlarm', () => {
  it('keeps exactly the fields readiness and the alarms endpoint use', () => {
    expect(projectMetricAlarm(metricAlarm())).toEqual({
      AlarmName: 'orders-cpu-high',
      AlarmArn: 'arn:aws:cloudwatch:us-east-1:111122223333:alarm:orders-cpu-high',
      StateValue: 'ALARM',
      StateTransitionedTimestamp: TRANSITIONED,
      Namespace: 'AWS/EC2',
      MetricName: 'CPUUtilization',
      ComparisonOperator: 'GreaterThanThreshold',
      Threshold: 80,
      TreatMissingData: 'missing',
      ActionsEnabled: true,
      Dimensions: [{ Name: 'InstanceId', Value: 'i-0123456789abcdef0' }],
      HasAlarmActions: true,
      UsesMetricMath: false,
    });
  });

  it('has no other key, no marker, and no action ARN', () => {
    const projected = projectMetricAlarm(metricAlarm({ Metrics: [{ Id: 'm1', Expression: MARKER, Label: MARKER }] }));
    expect(Object.keys(projected).sort()).toEqual([
      'ActionsEnabled', 'AlarmArn', 'AlarmName', 'ComparisonOperator', 'Dimensions', 'HasAlarmActions', 'MetricName',
      'Namespace', 'StateTransitionedTimestamp', 'StateValue', 'Threshold', 'TreatMissingData', 'UsesMetricMath',
    ]);
    expect(projected.UsesMetricMath).toBe(true);
    expect(JSON.stringify(projected)).not.toContain(MARKER);
    expect(JSON.stringify(projected)).not.toContain(ACTION_ARN);
  });

  it('keeps only whether alarm actions exist', () => {
    expect(projectMetricAlarm(metricAlarm({ AlarmActions: [] })).HasAlarmActions).toBe(false);
    expect(projectMetricAlarm(metricAlarm({ AlarmActions: undefined })).HasAlarmActions).toBe(false);
    expect(projectMetricAlarm({ AlarmName: 'bare' })).toMatchObject({ AlarmName: 'bare', Dimensions: [], HasAlarmActions: false, UsesMetricMath: false });
  });
});

describe('projectCompositeAlarm', () => {
  it('keeps only the name, state and when the state last changed', () => {
    const projected = projectCompositeAlarm(compositeAlarm());
    expect(projected).toEqual({ AlarmName: 'orders-degraded', StateValue: 'ALARM', StateTransitionedTimestamp: TRANSITIONED });
    expect(JSON.stringify(projected)).not.toContain('marker-not-kept');
  });
});
