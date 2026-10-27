/**
 * The customer role's policy set and the AWS calls the backend makes with it
 * agree.
 *
 * The recommended customer role is the AWS managed policies SecurityAudit and
 * ViewOnlyAccess plus the inline policy in lib/aws/customer-role-inline-policy.json
 * (the file the connect page shows). The managed policies are checked against
 * fixed snapshots of the approved versions in fixtures/iam/; checking for newer
 * AWS versions is a manual step, outside this test.
 *
 * Every AWS SDK command constructed in non-test source must have an entry in
 * COMMAND_TO_IAM. Then:
 *   - every read action must be allowed by the policy set;
 *   - no action used must match the inline Deny list;
 *   - no remediation write may be allowed: remediation never runs on this role.
 *
 * The evaluator models Effect, Action and Resource only. A statement with
 * anything else (NotAction, NotResource, Condition, Principal...) fails the
 * test instead of being skipped.
 *
 * This proves the policy documents and the code agree. It does not prove what
 * a real role in a real account allows; the founder's live check covers that.
 */
import fs from 'fs';
import path from 'path';
import { scanBackend, scanSource } from './helpers/aws-sdk-scan';

const INLINE_POLICY_FILE = path.join(__dirname, '..', '..', '..', 'lib', 'aws', 'customer-role-inline-policy.json');
const SNAPSHOTS = [
  { name: 'SecurityAudit', version: 'v94', file: path.join(__dirname, 'fixtures', 'iam', 'SecurityAudit-v94.json') },
  { name: 'ViewOnlyAccess', version: 'v47', file: path.join(__dirname, 'fixtures', 'iam', 'ViewOnlyAccess-v47.json') },
];

const ACCOUNT_PLACEHOLDER = '<ACCOUNT_ID>';
const EXAMPLE_ACCOUNT = '123456789012';

// ---------------------------------------------------------------------------
// SDK command → IAM action
// ---------------------------------------------------------------------------

type CommandKind = 'read' | 'remediation-write' | 'platform';
interface CommandEntry {
  actions: string[];
  kind: CommandKind;
}

const read = (...actions: string[]): CommandEntry => ({ actions, kind: 'read' });
const write = (...actions: string[]): CommandEntry => ({ actions, kind: 'remediation-write' });

/** Keyed `<package>:<exported name>`. A paginator maps to the action of the command it sends. */
const COMMAND_TO_IAM: Record<string, CommandEntry> = {
  'client-ec2:DescribeInstancesCommand': read('ec2:DescribeInstances'),
  'client-ec2:DescribeVolumesCommand': read('ec2:DescribeVolumes'),
  'client-ec2:paginateDescribeVolumeStatus': read('ec2:DescribeVolumeStatus'),
  'client-ec2:DescribeSecurityGroupsCommand': read('ec2:DescribeSecurityGroups'),
  'client-ec2:DescribeAddressesCommand': read('ec2:DescribeAddresses'),
  'client-ec2:DescribeReservedInstancesCommand': read('ec2:DescribeReservedInstances'),
  'client-ec2:DescribeRegionsCommand': read('ec2:DescribeRegions'),
  'client-rds:DescribeDBInstancesCommand': read('rds:DescribeDBInstances'),
  'client-rds:DescribeDBClustersCommand': read('rds:DescribeDBClusters'),
  'client-s3:ListBucketsCommand': read('s3:ListAllMyBuckets'),
  'client-s3:GetBucketLocationCommand': read('s3:GetBucketLocation'),
  'client-s3:GetBucketEncryptionCommand': read('s3:GetEncryptionConfiguration'),
  'client-s3:GetBucketAclCommand': read('s3:GetBucketAcl'),
  'client-s3:GetBucketPolicyCommand': read('s3:GetBucketPolicy'),
  'client-s3:GetBucketPolicyStatusCommand': read('s3:GetBucketPolicyStatus'),
  'client-s3:GetPublicAccessBlockCommand': read('s3:GetBucketPublicAccessBlock'),
  'client-s3:GetBucketOwnershipControlsCommand': read('s3:GetBucketOwnershipControls'),
  'client-s3:GetBucketLifecycleConfigurationCommand': read('s3:GetLifecycleConfiguration'),
  'client-s3:GetBucketTaggingCommand': read('s3:GetBucketTagging'),
  'client-s3-control:GetPublicAccessBlockCommand': read('s3:GetAccountPublicAccessBlock'),
  'client-lambda:ListFunctionsCommand': read('lambda:ListFunctions'),
  'client-lambda:ListTagsCommand': read('lambda:ListTags'),
  'client-elastic-load-balancing-v2:DescribeLoadBalancersCommand': read('elasticloadbalancing:DescribeLoadBalancers'),
  'client-elastic-load-balancing-v2:DescribeTagsCommand': read('elasticloadbalancing:DescribeTags'),
  'client-cloudfront:ListDistributionsCommand': read('cloudfront:ListDistributions'),
  'client-cloudwatch:GetMetricDataCommand': read('cloudwatch:GetMetricData'),
  'client-cloudwatch:GetMetricStatisticsCommand': read('cloudwatch:GetMetricStatistics'),
  'client-cloudwatch:DescribeAlarmsCommand': read('cloudwatch:DescribeAlarms'),
  'client-ecs:DescribeServicesCommand': read('ecs:DescribeServices'),
  'client-eks:DescribeClusterCommand': read('eks:DescribeCluster'),
  'client-dynamodb:DescribeTableCommand': read('dynamodb:DescribeTable'),
  'client-application-auto-scaling:DescribeScalableTargetsCommand': read('application-autoscaling:DescribeScalableTargets'),
  'client-backup:ListRecoveryPointsByResourceCommand': read('backup:ListRecoveryPointsByResource'),
  'client-iam:ListUsersCommand': read('iam:ListUsers'),
  'client-iam:ListMFADevicesCommand': read('iam:ListMFADevices'),
  'client-iam:GetLoginProfileCommand': read('iam:GetLoginProfile'),
  'client-iam:ListAccessKeysCommand': read('iam:ListAccessKeys'),
  'client-cost-explorer:GetCostAndUsageCommand': read('ce:GetCostAndUsage'),
  'client-resource-explorer-2:SearchCommand': read('resource-explorer-2:Search'),
  'client-securityhub:GetEnabledStandardsCommand': read('securityhub:GetEnabledStandards'),
  'client-securityhub:DescribeStandardsCommand': read('securityhub:DescribeStandards'),
  'client-securityhub:GetFindingsCommand': read('securityhub:GetFindings'),

  // Remediation (services/remediation.service.ts). It is disabled, and none of
  // these may ever be allowed by the onboarding role.
  'client-ec2:StartInstancesCommand': write('ec2:StartInstances'),
  'client-ec2:StopInstancesCommand': write('ec2:StopInstances'),
  'client-ec2:ModifyInstanceAttributeCommand': write('ec2:ModifyInstanceAttribute'),
  // TagSpecifications on the snapshot also needs ec2:CreateTags.
  'client-ec2:CreateSnapshotCommand': write('ec2:CreateSnapshot', 'ec2:CreateTags'),
  'client-ec2:DeleteSnapshotCommand': write('ec2:DeleteSnapshot'),
  'client-ec2:DeleteVolumeCommand': write('ec2:DeleteVolume'),
  'client-ec2:ReleaseAddressCommand': write('ec2:ReleaseAddress'),
  'client-s3:PutBucketLifecycleConfigurationCommand': write('s3:PutLifecycleConfiguration'),
  'client-rds:ModifyDBInstanceCommand': write('rds:ModifyDBInstance'),

  // Sent with DevControl's own identity, never with the customer role.
  'client-sts:AssumeRoleCommand': { actions: ['sts:AssumeRole'], kind: 'platform' },
};

/** The only file allowed to construct a 'platform' command. */
const PLATFORM_FILES = new Set([path.join('services', 'platform-sts.ts')]);

/** The request resource for actions that are scoped by resource in the inline policy. */
const REQUEST_RESOURCE: Record<string, (account: string) => string> = {
  // No ViewArn is sent, so AWS authorizes against the region's default view.
  'resource-explorer-2:Search': (account) =>
    `arn:aws:resource-explorer-2:us-east-1:${account}:view/default-view/00000000-0000-4000-8000-00000000000a`,
};

/** The 23 approved Deny actions (founder decision, Oct 26). */
const APPROVED_DENY = [
  's3:ListBucket',
  's3:GetObjectAcl',
  's3:GetObjectVersionAcl',
  's3:GetObjectTagging',
  's3-object-lambda:GetObjectAcl',
  's3-object-lambda:GetObjectVersionAcl',
  'ec2:DescribeInstanceAttribute',
  'ec2:DescribeLaunchTemplateVersions',
  'ec2:DescribeSpotFleetRequests',
  'ec2:DescribeSpotInstanceRequests',
  'autoscaling:DescribeLaunchConfigurations',
  'lambda:GetFunctionConfiguration',
  'lambda:ListVersionsByFunction',
  'ecs:DescribeTaskDefinition',
  'ecs:DescribeTasks',
  'rds:DownloadDBLogFilePortion',
  'cloudtrail:LookupEvents',
  'cloudformation:GetTemplate',
  'codepipeline:GetJobDetails',
  'elasticbeanstalk:DescribeConfigurationSettings',
  'batch:DescribeJobDefinitions',
  'security-ir:GetCaseAttachmentDownloadUrl',
  'cleanrooms:GetProtectedQuery',
];

const APPROVED_SEARCH_RESOURCE = `arn:aws:resource-explorer-2:*:${ACCOUNT_PLACEHOLDER}:view/*`;

// ---------------------------------------------------------------------------
// Policy evaluation
// ---------------------------------------------------------------------------

interface Statement {
  Sid?: string;
  Effect: 'Allow' | 'Deny';
  Action: string[];
  Resource: string[];
  source: string;
}

const MODELED_STATEMENT_KEYS = new Set(['Sid', 'Effect', 'Action', 'Resource']);
const MODELED_DOCUMENT_KEYS = new Set(['Version', 'Id', 'Statement']);

function stringList(value: unknown, where: string): string[] {
  const list = typeof value === 'string' ? [value] : value;
  if (!Array.isArray(list) || list.length === 0 || !list.every((v) => typeof v === 'string' && v !== '')) {
    throw new Error(`${where}: expected a non-empty string or string array`);
  }
  return list as string[];
}

/** The document's statements, or an error naming whatever the evaluator does not model. */
export function modeledStatements(name: string, document: unknown): Statement[] {
  if (typeof document !== 'object' || document === null || Array.isArray(document)) {
    throw new Error(`${name}: not a policy document`);
  }
  const doc = document as Record<string, unknown>;
  for (const key of Object.keys(doc)) {
    if (!MODELED_DOCUMENT_KEYS.has(key)) throw new Error(`${name}: unmodeled policy key "${key}"; the evaluator cannot check this document`);
  }
  if (doc.Version !== '2012-10-17') throw new Error(`${name}: unmodeled Version ${String(doc.Version)}`);
  const raw = Array.isArray(doc.Statement) ? doc.Statement : [doc.Statement];
  return raw.map((stmt, i) => {
    const where = `${name} statement ${i}`;
    if (typeof stmt !== 'object' || stmt === null) throw new Error(`${where}: not an object`);
    const s = stmt as Record<string, unknown>;
    for (const key of Object.keys(s)) {
      if (!MODELED_STATEMENT_KEYS.has(key)) {
        throw new Error(`${where}${s.Sid ? ` (${String(s.Sid)})` : ''}: unmodeled key "${key}"; the evaluator does not model it and will not skip it`);
      }
    }
    if (s.Effect !== 'Allow' && s.Effect !== 'Deny') throw new Error(`${where}: unmodeled Effect ${String(s.Effect)}`);
    return {
      Sid: s.Sid as string | undefined,
      Effect: s.Effect,
      Action: stringList(s.Action, `${where} Action`),
      Resource: stringList(s.Resource, `${where} Resource`),
      source: name,
    };
  });
}

/** IAM wildcard match: `*` is any run of characters, `?` is one character. */
export function wildcardMatch(pattern: string, value: string, caseInsensitive: boolean): boolean {
  const body = pattern
    .split('')
    .map((c) => (c === '*' ? '.*' : c === '?' ? '.' : c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('');
  return new RegExp(`^${body}$`, caseInsensitive ? 'is' : 's').test(value);
}

const matchesAction = (stmt: Statement, action: string) => stmt.Action.some((p) => wildcardMatch(p, action, true));
const matchesResource = (stmt: Statement, resource: string) => stmt.Resource.some((p) => wildcardMatch(p, resource, false));

export type Decision = 'allowed' | 'explicitDeny' | 'implicitDeny';

export function evaluate(statements: Statement[], action: string, resource: string): Decision {
  const applies = statements.filter((s) => matchesAction(s, action) && matchesResource(s, resource));
  if (applies.some((s) => s.Effect === 'Deny')) return 'explicitDeny';
  return applies.some((s) => s.Effect === 'Allow') ? 'allowed' : 'implicitDeny';
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

function readJson(file: string): unknown {
  if (!fs.existsSync(file)) throw new Error(`missing policy file: ${file}`);
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

const inlineRaw = fs.readFileSync(INLINE_POLICY_FILE, 'utf-8');
const inlineDocument = readJson(INLINE_POLICY_FILE);
const snapshotRaw = SNAPSHOTS.map((s) => fs.readFileSync(s.file, 'utf-8'));

/** The full policy set, with the placeholder filled in with the example account. */
function policySet(): Statement[] {
  const inline = JSON.parse(inlineRaw.split(ACCOUNT_PLACEHOLDER).join(EXAMPLE_ACCOUNT));
  return [
    ...SNAPSHOTS.flatMap((s) => modeledStatements(`${s.name} ${s.version}`, readJson(s.file))),
    ...modeledStatements('inline policy', inline),
  ];
}

const inlineStatements = () => modeledStatements('inline policy', inlineDocument);
const resourceFor = (action: string, account = EXAMPLE_ACCOUNT) => REQUEST_RESOURCE[action]?.(account) ?? '*';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('customer role: SDK calls against the policy set', () => {
  const scan = scanBackend();
  const usedKeys = new Set(scan.uses.map((u) => u.key));
  const entriesOfKind = (kind: CommandKind) =>
    [...usedKeys].filter((k) => COMMAND_TO_IAM[k]?.kind === kind).flatMap((k) => COMMAND_TO_IAM[k].actions.map((action) => ({ key: k, action })));

  it('reaches the SDK only in ways the scan models', () => {
    expect(scan.unmodeled).toEqual([]);
  });

  it('every constructed SDK command has an IAM mapping', () => {
    const unmapped = scan.uses.filter((u) => !COMMAND_TO_IAM[u.key]).map((u) => `${u.site}: ${u.key} has no IAM action in COMMAND_TO_IAM; add it and confirm the policy covers it`);
    expect(unmapped).toEqual([]);
  });

  it('every mapping is still used (the map is exactly the audited set)', () => {
    expect(Object.keys(COMMAND_TO_IAM).filter((k) => !usedKeys.has(k))).toEqual([]);
  });

  it('platform commands are only sent from the platform STS module', () => {
    const misplaced = scan.uses
      .filter((u) => COMMAND_TO_IAM[u.key]?.kind === 'platform')
      .filter((u) => !PLATFORM_FILES.has(u.site.slice(0, u.site.lastIndexOf(':'))));
    expect(misplaced).toEqual([]);
  });

  it('every read action is allowed by SecurityAudit + ViewOnlyAccess + the inline policy', () => {
    const statements = policySet();
    const notAllowed = entriesOfKind('read')
      .map(({ key, action }) => ({ key, action, decision: evaluate(statements, action, resourceFor(action)) }))
      .filter((r) => r.decision !== 'allowed')
      .map((r) => `${r.action} (${r.key}): ${r.decision}`);
    expect(notAllowed).toEqual([]);
  });

  it('no action used with the customer role matches the inline Deny list', () => {
    const denyPatterns = inlineStatements().filter((s) => s.Effect === 'Deny').flatMap((s) => s.Action);
    const hits = [...entriesOfKind('read'), ...entriesOfKind('remediation-write')]
      .flatMap(({ key, action }) => denyPatterns.filter((p) => wildcardMatch(p, action, true)).map((p) => `${action} (${key}) matches Deny ${p}`));
    // A hit means the feature needs a customer-role policy change: get approval,
    // update the docs and connect page, and plan the migration for existing roles.
    expect(hits).toEqual([]);
  });

  it('no remediation write action is allowed', () => {
    const statements = policySet();
    const allowed = entriesOfKind('remediation-write')
      .filter(({ action }) => evaluate(statements, action, '*') === 'allowed' || evaluate(statements, action, `arn:aws:ec2:us-east-1:${EXAMPLE_ACCOUNT}:instance/i-0`) === 'allowed')
      .map(({ key, action }) => `${action} (${key})`);
    expect(allowed).toEqual([]);
    expect(entriesOfKind('remediation-write').length).toBe(10);
  });

  it('no Allow statement names a remediation write action, at any resource scope', () => {
    const hits = policySet()
      .filter((s) => s.Effect === 'Allow')
      .flatMap((s) => entriesOfKind('remediation-write')
        .flatMap(({ key, action }) => s.Action.filter((p) => wildcardMatch(p, action, true))
          .map((p) => `${action} (${key}) matches Allow ${p} in ${s.source}${s.Sid ? ` ${s.Sid}` : ''} on ${s.Resource.join(', ')}`)));
    expect(hits).toEqual([]);
  });

  it('Resource Explorer Search is allowed only on the customer account\'s views', () => {
    const statements = policySet();
    const otherAccount = '9'.repeat(12);
    expect(evaluate(statements, 'resource-explorer-2:Search', resourceFor('resource-explorer-2:Search'))).toBe('allowed');
    expect(evaluate(statements, 'resource-explorer-2:Search', `arn:aws:resource-explorer-2:eu-west-1:${EXAMPLE_ACCOUNT}:view/v/0`)).toBe('allowed');
    expect(evaluate(statements, 'resource-explorer-2:Search', resourceFor('resource-explorer-2:Search', otherAccount))).toBe('implicitDeny');
    expect(evaluate(statements, 'resource-explorer-2:Search', `arn:aws:resource-explorer-2:us-east-1:${EXAMPLE_ACCOUNT}:managed-view/m/0`)).toBe('implicitDeny');
  });

  it('every approved Deny action is explicitly denied by the policy set', () => {
    const statements = policySet();
    expect(APPROVED_DENY.filter((a) => evaluate(statements, a, '*') !== 'explicitDeny')).toEqual([]);
  });
});

describe('customer role: inline policy', () => {
  const statements = () => inlineStatements();
  const allows = () => statements().filter((s) => s.Effect === 'Allow');
  const denies = () => statements().filter((s) => s.Effect === 'Deny');

  it('the Deny is exactly the approved 23 actions, on every resource', () => {
    expect(APPROVED_DENY).toHaveLength(23);
    expect(denies()).toHaveLength(1);
    expect([...denies()[0].Action].sort()).toEqual([...APPROVED_DENY].sort());
    expect(denies()[0].Resource).toEqual(['*']);
  });

  it('the Allow grants only ce:GetCostAndUsage and resource-explorer-2:Search', () => {
    expect(allows().flatMap((s) => s.Action).sort()).toEqual(['ce:GetCostAndUsage', 'resource-explorer-2:Search']);
    expect(allows().flatMap((s) => s.Action).filter((a) => /[*?]/.test(a))).toEqual([]);
  });

  it('Cost Explorer is on "*" and Search uses exactly the approved placeholder ARN', () => {
    const byAction = (action: string) => allows().find((s) => s.Action.includes(action))!;
    expect(byAction('ce:GetCostAndUsage').Resource).toEqual(['*']);
    expect(byAction('resource-explorer-2:Search').Resource).toEqual([APPROVED_SEARCH_RESOURCE]);
    expect(inlineRaw.split(ACCOUNT_PLACEHOLDER)).toHaveLength(2);
  });

  it('has no account IDs, keys or customer values', () => {
    for (const [label, raw] of [['inline policy', inlineRaw], ...SNAPSHOTS.map((s, i) => [s.file, snapshotRaw[i]])]) {
      expect({ label, accountIds: raw.match(/(?<!\d)\d{12}(?!\d)/g) ?? [] }).toEqual({ label, accountIds: [] });
      expect({ label, keys: raw.match(/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g) ?? [] }).toEqual({ label, keys: [] });
      expect({ label, roleArns: raw.match(/arn:aws:iam::/g) ?? [] }).toEqual({ label, roleArns: [] });
    }
  });
});

describe('customer role: scanner and evaluator self-checks', () => {
  it('finds aliased commands and paginators, ignores comments and type uses', () => {
    const { uses, unmodeled } = scanSource('x.ts', [
      "import { DescribeTagsCommand as ELBTags, DescribeLoadBalancersCommand } from '@aws-sdk/client-elastic-load-balancing-v2';",
      "import { paginateDescribeVolumeStatus } from '@aws-sdk/client-ec2';",
      '// new DescribeLoadBalancersCommand({})',
      'type T = DescribeLoadBalancersCommand;',
      'const a = new ELBTags({});',
      'for await (const p of paginateDescribeVolumeStatus({ client }, {})) {}',
      "await s3.send(new (await import('@aws-sdk/client-s3')).ListBucketsCommand({}));",
    ].join('\n'));
    expect(unmodeled).toEqual([]);
    expect(uses).toEqual([
      { key: 'client-elastic-load-balancing-v2:DescribeTagsCommand', site: 'x.ts:5' },
      { key: 'client-ec2:paginateDescribeVolumeStatus', site: 'x.ts:6' },
      { key: 'client-s3:ListBucketsCommand', site: 'x.ts:7' },
    ]);
  });

  it('reports SDK access it does not model', () => {
    const { unmodeled } = scanSource('y.ts', [
      "import * as ec2 from '@aws-sdk/client-ec2';",
      "import { Upload } from '@aws-sdk/lib-storage';",
      "import { GetObjectCommand } from '@aws-sdk/client-s3';",
      'const C = GetObjectCommand;',
      "const s3 = require('@aws-sdk/client-s3');",
      "export { ListBucketsCommand } from '@aws-sdk/client-s3';",
      "const mod = await import('@aws-sdk/client-s3');",
    ].join('\n'));
    expect(unmodeled).toHaveLength(6);
  });

  it('reports an aggregated service class and the calls made on it', () => {
    const { uses, unmodeled } = scanSource('z.ts', [
      "import { Lambda, LambdaClient, NoSuchEntityException } from '@aws-sdk/client-lambda';",
      "import { Instance } from '@aws-sdk/client-ec2';",
      "const config = await new Lambda({}).getFunction({ FunctionName: 'f' });",
      'const lambda = new Lambda({});',
      "await lambda.getFunction({ FunctionName: 'g' });",
      'const client = new LambdaClient({});',
      'const shape: Instance = {};',
      'if (err instanceof NoSuchEntityException) {}',
    ].join('\n'));
    expect(uses).toEqual([]);
    expect(unmodeled).toEqual([
      'z.ts:3: new Lambda() constructs client-lambda:Lambda, which is neither a *Client nor a *Command',
      'z.ts:3: getFunction() called on a constructed Lambda',
      'z.ts:4: new Lambda() constructs client-lambda:Lambda, which is neither a *Client nor a *Command',
      'z.ts:5: getFunction() called on lambda, a constructed SDK object that is neither a client nor a command',
    ]);
  });

  it('matches IAM wildcards case-insensitively for actions and gives Deny precedence', () => {
    expect(wildcardMatch('ec2:Describe*', 'EC2:describeinstances', true)).toBe(true);
    expect(wildcardMatch('s3:GetBucket?cl', 's3:GetBucketAcl', true)).toBe(true);
    expect(wildcardMatch('s3:GetBucket?cl', 's3:GetBucketXXcl', true)).toBe(false);
    expect(wildcardMatch('arn:aws:x:*:1:view/*', 'arn:aws:x:r:1:VIEW/a', false)).toBe(false);
    const stmts = modeledStatements('t', {
      Version: '2012-10-17',
      Statement: [
        { Effect: 'Allow', Action: '*', Resource: '*' },
        { Effect: 'Deny', Action: 's3:List*', Resource: '*' },
      ],
    });
    expect(evaluate(stmts, 's3:ListBucket', '*')).toBe('explicitDeny');
    expect(evaluate(stmts, 's3:GetBucketAcl', '*')).toBe('allowed');
    expect(evaluate([], 's3:GetBucketAcl', '*')).toBe('implicitDeny');
  });

  it.each(['NotAction', 'NotResource', 'Condition', 'Principal', 'NotPrincipal'])('fails closed on %s', (key) => {
    const doc = { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: 'ec2:Describe*', Resource: '*', [key]: {} }] };
    expect(() => modeledStatements('t', doc)).toThrow(/unmodeled key/);
  });
});
