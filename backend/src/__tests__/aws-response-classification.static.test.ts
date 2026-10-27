/**
 * Every AWS SDK command the backend constructs is classified by how its
 * response is handled:
 *   - metadata only: the response holds identifiers, settings, figures and
 *     tags, and the entry records why;
 *   - sanitised: the response is read only through the named projection,
 *     which copies a listed set of fields.
 *
 * Commands are found in the code by the scan the IAM coverage test uses
 * (helpers/aws-sdk-scan.ts), not from a list, so a new command fails here
 * until it is classified, and a classification nothing uses fails too.
 *
 * For a sanitised command, at every call site:
 *   - the awaited send() result is bound to one name;
 *   - that name is read only for the listed paging fields, or for its items,
 *     passed one by one through the projection: `(page.Items ?? []).map(project)`.
 * The projection must be exported from its module with a declared return
 * type, read its argument only through property access (no spread, no
 * Object.assign, no passing it on whole), and be named in its test file.
 */
import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import { BACKEND_SRC, CommandUseNode, scanBackendNodes, scanSourceNodes } from './helpers/aws-sdk-scan';

interface MetadataOnly {
  kind: 'metadata-only';
  reason: string;
}

interface Sanitised {
  kind: 'sanitised';
  /** The projection's exported function name. */
  sanitiser: string;
  /** The module that exports it, relative to backend/src. */
  module: string;
  /** Its test file, relative to backend/src. */
  test: string;
  /** The response path of the items each projection call receives. */
  items: string[];
  /** Response paths that may be read directly (paging only). */
  paging: string[][];
}

type Classification = MetadataOnly | Sanitised;

const metadataOnly = (reason: string): MetadataOnly => ({ kind: 'metadata-only', reason });

const PROJECTIONS = path.join('services', 'aws-response-projections.ts');
const PROJECTIONS_TEST = path.join('services', '__tests__', 'aws-response-projections.test.ts');

/** Keyed like COMMAND_TO_IAM in customer-role-iam-coverage.static.test.ts. */
const RESPONSE_CLASSIFICATION: Record<string, Classification> = {
  'client-ec2:DescribeInstancesCommand': metadataOnly('Instance fields: IDs, type, state, network, tags; no launch data'),
  'client-ec2:DescribeVolumesCommand': metadataOnly('volume IDs, size, type, state, attachments, tags'),
  'client-ec2:paginateDescribeVolumeStatus': metadataOnly('volume status checks and events'),
  'client-ec2:DescribeSecurityGroupsCommand': metadataOnly('group IDs, rules (ports, CIDRs, descriptions), tags'),
  'client-ec2:DescribeAddressesCommand': metadataOnly('Elastic IP allocation and association IDs'),
  'client-ec2:DescribeReservedInstancesCommand': metadataOnly('reservation type, count, term and dates'),
  'client-ec2:DescribeRegionsCommand': metadataOnly('region names, endpoints and opt-in status'),
  'client-rds:DescribeDBInstancesCommand': metadataOnly('instance class, engine, status, storage, endpoints; master secret only as an ARN'),
  'client-rds:DescribeDBClustersCommand': metadataOnly('cluster class, engine, members, status; master secret only as an ARN'),
  'client-s3:ListBucketsCommand': metadataOnly('bucket names and creation dates'),
  'client-s3:GetBucketLocationCommand': metadataOnly('the bucket region'),
  'client-s3:GetBucketEncryptionCommand': metadataOnly('default encryption algorithm and key ARN'),
  'client-s3:GetBucketAclCommand': metadataOnly('grantees and permissions'),
  'client-s3:GetBucketPolicyCommand': metadataOnly('policy document, evaluated in memory; only fixed results are kept (s3-security-evaluation.ts)'),
  'client-s3:GetBucketPolicyStatusCommand': metadataOnly('AWS\'s public/not public evaluation'),
  'client-s3:GetPublicAccessBlockCommand': metadataOnly('four Block Public Access flags'),
  'client-s3:GetBucketOwnershipControlsCommand': metadataOnly('object ownership setting'),
  'client-s3:GetBucketLifecycleConfigurationCommand': metadataOnly('lifecycle rule IDs, filters and transitions'),
  'client-s3:GetBucketTaggingCommand': metadataOnly('bucket tags'),
  'client-s3-control:GetPublicAccessBlockCommand': metadataOnly('account-level Block Public Access flags'),
  'client-lambda:ListFunctionsCommand': {
    kind: 'sanitised',
    sanitiser: 'projectLambdaFunction',
    module: PROJECTIONS,
    test: PROJECTIONS_TEST,
    items: ['Functions'],
    paging: [['NextMarker']],
  },
  'client-lambda:ListTagsCommand': metadataOnly('function tags'),
  'client-elastic-load-balancing-v2:DescribeLoadBalancersCommand': metadataOnly('load balancer ARNs, scheme, state, network'),
  'client-elastic-load-balancing-v2:DescribeTagsCommand': metadataOnly('load balancer tags'),
  'client-cloudfront:ListDistributionsCommand': {
    kind: 'sanitised',
    sanitiser: 'projectCloudFrontDistribution',
    module: PROJECTIONS,
    test: PROJECTIONS_TEST,
    items: ['DistributionList', 'Items'],
    paging: [['DistributionList', 'IsTruncated'], ['DistributionList', 'NextMarker']],
  },
  'client-cloudwatch:GetMetricDataCommand': metadataOnly('metric datapoints'),
  'client-cloudwatch:GetMetricStatisticsCommand': metadataOnly('metric datapoints'),
  'client-cloudwatch:DescribeAlarmsCommand': metadataOnly('alarm names, metrics, thresholds, states and actions'),
  'client-ecs:DescribeServicesCommand': metadataOnly('service status, counts, deployments; the task definition only as an ARN'),
  'client-eks:DescribeClusterCommand': metadataOnly('cluster version, endpoint, status, public CA certificate'),
  'client-dynamodb:DescribeTableCommand': metadataOnly('table schema, throughput, size and indexes; no items'),
  'client-application-auto-scaling:DescribeScalableTargetsCommand': metadataOnly('scaling targets and capacity bounds'),
  'client-backup:ListRecoveryPointsByResourceCommand': metadataOnly('recovery point ARNs, status and dates'),
  'client-iam:ListUsersCommand': metadataOnly('user names, IDs, ARNs and dates'),
  'client-iam:ListMFADevicesCommand': metadataOnly('MFA device serial numbers and dates'),
  'client-iam:GetLoginProfileCommand': metadataOnly('whether a console password exists, and its dates'),
  'client-iam:ListAccessKeysCommand': metadataOnly('access key IDs, status and dates; never the secret key'),
  'client-cost-explorer:GetCostAndUsageCommand': metadataOnly('cost and usage figures by dimension'),
  'client-resource-explorer-2:SearchCommand': metadataOnly('resource ARNs, types, regions and tags'),
  'client-securityhub:GetEnabledStandardsCommand': metadataOnly('standards subscription ARNs and status'),
  'client-securityhub:DescribeStandardsCommand': metadataOnly('standard names and descriptions'),
  'client-securityhub:GetFindingsCommand': {
    kind: 'sanitised',
    sanitiser: 'normalizeFinding',
    module: path.join('services', 'security-hub-client.service.ts'),
    test: PROJECTIONS_TEST,
    items: ['Findings'],
    paging: [['NextToken']],
  },
  'client-ec2:StartInstancesCommand': metadataOnly('instance state changes'),
  'client-ec2:StopInstancesCommand': metadataOnly('instance state changes'),
  'client-ec2:ModifyInstanceAttributeCommand': metadataOnly('no response fields'),
  'client-ec2:CreateSnapshotCommand': metadataOnly('snapshot ID, state and tags'),
  'client-ec2:DeleteSnapshotCommand': metadataOnly('no response fields'),
  'client-ec2:DeleteVolumeCommand': metadataOnly('no response fields'),
  'client-ec2:ReleaseAddressCommand': metadataOnly('no response fields'),
  'client-s3:PutBucketLifecycleConfigurationCommand': metadataOnly('transition default only'),
  'client-rds:ModifyDBInstanceCommand': metadataOnly('the modified instance description (as DescribeDBInstances)'),
  'client-sts:AssumeRoleCommand': metadataOnly('the platform\'s own session; credentials stay in the client config (aws-client-factory.service.ts)'),
};

/** Shortest reason accepted: a few words, not a placeholder. */
const MIN_REASON_LENGTH = 10;

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

const declaredFunction = (file: ts.SourceFile, name: string): ts.FunctionDeclaration | undefined =>
  file.statements.find((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === name);

const isExported = (node: ts.FunctionDeclaration) =>
  !!node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

/** What is wrong with the projection `name` in a module's source; empty when it is acceptable. */
export function projectionViolations(moduleLabel: string, source: string, name: string): string[] {
  const file = ts.createSourceFile(moduleLabel, source, ts.ScriptTarget.Latest, true);
  const fn = declaredFunction(file, name);
  if (!fn || !fn.body) return [`${moduleLabel}: no function declaration ${name}`];
  const problems: string[] = [];
  const at = (node: ts.Node) => `${moduleLabel}:${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1}`;
  if (!isExported(fn)) problems.push(`${at(fn)}: ${name} is not exported`);
  if (!fn.type) problems.push(`${at(fn)}: ${name} has no declared return type`);
  else if (/\bany\b|\bunknown\b/.test(fn.type.getText(file))) problems.push(`${at(fn.type)}: ${name} returns ${fn.type.getText(file)}`);

  const [param] = fn.parameters;
  if (!param || !ts.isIdentifier(param.name)) return [...problems, `${at(fn)}: ${name} must take the item as one named parameter`];
  const paramName = param.name.text;
  const visit = (node: ts.Node): void => {
    if (ts.isSpreadAssignment(node) || ts.isSpreadElement(node)) problems.push(`${at(node)}: spread in ${name}`);
    if (ts.isCallExpression(node) && /^Object\.(assign|entries|values|fromEntries)$/.test(node.expression.getText(file))) {
      problems.push(`${at(node)}: ${node.expression.getText(file)} in ${name}`);
    }
    if (ts.isIdentifier(node) && node.text === paramName && node !== param.name) {
      const parent = node.parent;
      const isMemberName = (ts.isPropertyAccessExpression(parent) && parent.name === node) || (ts.isPropertyAssignment(parent) && parent.name === node);
      const isFieldRead = ts.isPropertyAccessExpression(parent) && parent.expression === node;
      if (!isMemberName && !isFieldRead) problems.push(`${at(node)}: ${name} uses ${paramName} other than to read one field`);
    }
    ts.forEachChild(node, visit);
  };
  visit(fn.body);
  return problems;
}

/** Whether `name` in this file is the projection: imported unaliased from `module`, or declared here when this file is `module`. */
function bindsProjection(file: ts.SourceFile, fileLabel: string, name: string, module: string): boolean {
  if (fileLabel === module) return !!declaredFunction(file, name);
  return file.statements.some((s) => {
    if (!ts.isImportDeclaration(s) || !ts.isStringLiteral(s.moduleSpecifier) || !s.moduleSpecifier.text.startsWith('.')) return false;
    const target = path.normalize(path.join(path.dirname(fileLabel), s.moduleSpecifier.text));
    if (target !== module.replace(/\.ts$/, '')) return false;
    const bindings = s.importClause?.namedBindings;
    return !!bindings && ts.isNamedImports(bindings) && bindings.elements.some((e) => !e.propertyName && e.name.text === name);
  });
}

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** What is wrong with how one call site uses a sanitised command's response; empty when it is acceptable. */
export function callSiteViolations(use: CommandUseNode, rule: Sanitised): string[] {
  const file = use.sourceFile;
  const at = (node: ts.Node) => `${use.file}:${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1}`;
  const problems: string[] = [];
  if (!bindsProjection(file, use.file, rule.sanitiser, rule.module)) {
    problems.push(`${use.site}: ${rule.sanitiser} is not imported from ${rule.module}`);
  }

  const construction = use.node.parent;
  const send = construction?.parent;
  const awaited = send?.parent;
  const declaration = awaited?.parent;
  const bound = !!construction && ts.isNewExpression(construction)
    && !!send && ts.isCallExpression(send) && send.arguments[0] === construction
    && ts.isPropertyAccessExpression(send.expression) && send.expression.name.text === 'send'
    && !!awaited && ts.isAwaitExpression(awaited)
    && !!declaration && ts.isVariableDeclaration(declaration) && declaration.initializer === awaited && ts.isIdentifier(declaration.name);
  if (!bound) return [...problems, `${use.site}: the response must be bound to one name: const page = await client.send(new ${use.key.split(':')[1]}(...))`];

  const decl = declaration as ts.VariableDeclaration;
  const responseName = (decl.name as ts.Identifier).text;
  let scope: ts.Node = decl;
  while (scope.parent && !ts.isFunctionLike(scope)) scope = scope.parent;

  const checkReference = (ref: ts.Identifier) => {
    let top: ts.Expression = ref;
    const accessPath: string[] = [];
    while (ts.isPropertyAccessExpression(top.parent) && top.parent.expression === top) {
      top = top.parent;
      accessPath.push((top as ts.PropertyAccessExpression).name.text);
    }
    if (rule.paging.some((p) => sameList(p, accessPath))) return;

    let mapAccess: ts.Node | undefined;
    if (sameList(accessPath, [...rule.items, 'map'])) {
      mapAccess = top;
    } else if (sameList(accessPath, rule.items)) {
      let current: ts.Node = top;
      while (ts.isParenthesizedExpression(current.parent)) current = current.parent;
      const fallback = current.parent;
      if (ts.isBinaryExpression(fallback) && fallback.left === current
        && (fallback.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || fallback.operatorToken.kind === ts.SyntaxKind.BarBarToken)
        && ts.isArrayLiteralExpression(fallback.right) && fallback.right.elements.length === 0) {
        current = fallback;
        while (ts.isParenthesizedExpression(current.parent)) current = current.parent;
      }
      const access = current.parent;
      if (ts.isPropertyAccessExpression(access) && access.expression === current && access.name.text === 'map') mapAccess = access;
    }
    const call = mapAccess?.parent;
    const projected = !!call && ts.isCallExpression(call) && call.expression === mapAccess
      && call.arguments.length === 1 && ts.isIdentifier(call.arguments[0]) && call.arguments[0].text === rule.sanitiser;
    if (!projected) {
      problems.push(`${at(ref)}: ${responseName}${accessPath.map((p) => `.${p}`).join('')} is used other than through ${rule.sanitiser}`);
    }
  };

  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === responseName && node !== decl.name) {
      const parent = node.parent;
      const isMemberName = (ts.isPropertyAccessExpression(parent) && parent.name === node) || (ts.isPropertyAssignment(parent) && parent.name === node);
      if (!isMemberName) checkReference(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(scope);
  return problems;
}

/** Classification problems for a scan; empty when every command is classified and handled as classified. */
export function classificationViolations(
  uses: CommandUseNode[],
  classification: Record<string, Classification>,
  readSource: (label: string) => string | undefined
): string[] {
  const problems: string[] = [];
  for (const use of uses) {
    const entry = classification[use.key];
    if (!entry) {
      problems.push(`${use.site}: ${use.key} is not classified; add it to RESPONSE_CLASSIFICATION as metadata only (with the reason) or sanitised (with its projection)`);
    } else if (entry.kind === 'sanitised') {
      problems.push(...callSiteViolations(use, entry));
    }
  }
  for (const [key, entry] of Object.entries(classification)) {
    if (entry.kind === 'metadata-only') {
      if (entry.reason.trim().length < MIN_REASON_LENGTH) problems.push(`${key}: metadata only needs a reason (what the response holds)`);
      continue;
    }
    const moduleSource = readSource(entry.module);
    if (moduleSource === undefined) problems.push(`${key}: ${entry.module} does not exist`);
    else problems.push(...projectionViolations(entry.module, moduleSource, entry.sanitiser).map((p) => `${key}: ${p}`));
    const testSource = readSource(entry.test);
    if (testSource === undefined) problems.push(`${key}: test file ${entry.test} does not exist`);
    else if (!new RegExp(`\\b${entry.sanitiser}\\b`).test(testSource)) problems.push(`${key}: ${entry.test} does not test ${entry.sanitiser}`);
    if (entry.items.length === 0) problems.push(`${key}: a sanitised command must name its item path`);
  }
  return problems;
}

const readBackendSource = (label: string): string | undefined => {
  const full = path.join(BACKEND_SRC, label);
  return fs.existsSync(full) ? fs.readFileSync(full, 'utf-8') : undefined;
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AWS response classification', () => {
  const scan = scanBackendNodes();

  it('reaches the SDK only in ways the scan models', () => {
    expect(scan.unmodeled).toEqual([]);
  });

  it('every command is classified, and each sanitised response goes only through its projection', () => {
    expect(classificationViolations(scan.uses, RESPONSE_CLASSIFICATION, readBackendSource)).toEqual([]);
  });

  it('every classification is still used', () => {
    const used = new Set(scan.uses.map((u) => u.key));
    expect(Object.keys(RESPONSE_CLASSIFICATION).filter((k) => !used.has(k))).toEqual([]);
  });

  it('the sanitised commands are exactly the reviewed set', () => {
    const sanitised = Object.entries(RESPONSE_CLASSIFICATION).filter(([, c]) => c.kind === 'sanitised').map(([k]) => k).sort();
    expect(sanitised).toEqual([
      'client-cloudfront:ListDistributionsCommand',
      'client-lambda:ListFunctionsCommand',
      'client-securityhub:GetFindingsCommand',
    ]);
  });

  it('finds every call site of each sanitised command', () => {
    const sites = (key: string) => scan.uses.filter((u) => u.key === key).map((u) => u.file).sort();
    expect(sites('client-lambda:ListFunctionsCommand')).toEqual([
      path.join('services', 'awsResourceDiscovery.ts'),
      path.join('services', 'cost-optimization.service.ts'),
    ]);
    expect(sites('client-cloudfront:ListDistributionsCommand')).toEqual([path.join('services', 'awsResourceDiscovery.ts')]);
    expect(sites('client-securityhub:GetFindingsCommand')).toEqual([path.join('services', 'security-hub-client.service.ts')]);
  });
});

describe('AWS response classification: self-checks', () => {
  const rule: Sanitised = {
    kind: 'sanitised',
    sanitiser: 'projectThing',
    module: path.join('services', 'proj.ts'),
    test: path.join('services', '__tests__', 'proj.test.ts'),
    items: ['Things'],
    paging: [['NextToken']],
  };
  const classification: Record<string, Classification> = { 'client-x:ListThingsCommand': rule };
  const header = [
    "import { ListThingsCommand } from '@aws-sdk/client-x';",
    "import { projectThing } from './proj';",
  ];
  const sources: Record<string, string> = {
    [rule.module]: 'export function projectThing(t: Thing): ThingFields {\n  return { Id: t.Id, Name: t.Name };\n}\n',
    [rule.test]: 'projectThing',
  };
  const check = (body: string[]) => {
    const { uses } = scanSourceNodes(path.join('services', 'site.ts'), [...header, ...body].join('\n'));
    return classificationViolations(uses, classification, (label) => sources[label]);
  };

  it('accepts the projected forms', () => {
    expect(check([
      'async function a(token) {',
      '  const page = await client.send(new ListThingsCommand({ NextToken: token }));',
      '  return { items: (page.Things ?? []).map(projectThing), next: page.NextToken };',
      '}',
      'async function b() {',
      '  const resp = await client.send(new ListThingsCommand({}));',
      '  return [resp.Things?.map(projectThing), (resp.Things || []).map(projectThing)];',
      '}',
    ])).toEqual([]);
  });

  it.each([
    ['items returned raw', ['const page = await client.send(new ListThingsCommand({}));', 'return page.Things;']],
    ['items with a fallback, unprojected', ['const page = await client.send(new ListThingsCommand({}));', 'return page.Things ?? [];']],
    ['the response logged', ['const page = await client.send(new ListThingsCommand({}));', 'console.log(page);']],
    ['the response spread', ['const page = await client.send(new ListThingsCommand({}));', 'return { ...page };']],
    ['a field outside the list', ['const page = await client.send(new ListThingsCommand({}));', 'return page.Things[0];']],
    ['items mapped by something else', ['const page = await client.send(new ListThingsCommand({}));', 'return page.Things?.map((t) => t);']],
    ['the response not bound', ['return (await client.send(new ListThingsCommand({}))).Things?.map(projectThing);']],
    ['the response destructured', ['const { Things } = await client.send(new ListThingsCommand({}));', 'return Things;']],
  ])('rejects %s', (_label, lines) => {
    expect(check(['async function f() {', ...lines, '}'])).not.toEqual([]);
  });

  it('rejects a projection that is not imported from its module', () => {
    const { uses } = scanSourceNodes(path.join('services', 'site.ts'), [
      "import { ListThingsCommand } from '@aws-sdk/client-x';",
      "import { projectThing } from './elsewhere';",
      'async function f() { const page = await client.send(new ListThingsCommand({})); return (page.Things ?? []).map(projectThing); }',
    ].join('\n'));
    expect(classificationViolations(uses, classification, (label) => sources[label])).toEqual([
      `${path.join('services', 'site.ts')}:3: projectThing is not imported from ${rule.module}`,
    ]);
  });

  it.each([
    ['an object spread', 'export function projectThing(t: Thing): ThingFields {\n  return { ...t };\n}\n'],
    ['Object.assign', 'export function projectThing(t: Thing): ThingFields {\n  return Object.assign({}, t);\n}\n'],
    ['the item passed on whole', 'export function projectThing(t: Thing): ThingFields {\n  return t;\n}\n'],
    ['no declared return type', 'export function projectThing(t: Thing) {\n  return { Id: t.Id };\n}\n'],
    ['an any return type', 'export function projectThing(t: Thing): any {\n  return { Id: t.Id };\n}\n'],
    ['not exported', 'function projectThing(t: Thing): ThingFields {\n  return { Id: t.Id };\n}\n'],
  ])('rejects a projection with %s', (_label, moduleSource) => {
    expect(projectionViolations(rule.module, moduleSource, 'projectThing')).not.toEqual([]);
  });

  it('rejects an unclassified command, a metadata-only entry without a reason, and a sanitised entry without its test', () => {
    const { uses } = scanSourceNodes('site.ts', "import { GetThingCommand } from '@aws-sdk/client-x';\nconst r = new GetThingCommand({});");
    expect(classificationViolations(uses, {}, () => undefined)).toEqual([
      'site.ts:2: client-x:GetThingCommand is not classified; add it to RESPONSE_CLASSIFICATION as metadata only (with the reason) or sanitised (with its projection)',
    ]);
    expect(classificationViolations([], { 'client-x:GetThingCommand': metadataOnly('') }, () => undefined)).toEqual([
      'client-x:GetThingCommand: metadata only needs a reason (what the response holds)',
    ]);
    expect(classificationViolations([], classification, (label) => (label === rule.test ? 'nothing here' : sources[label]))).toEqual([
      `client-x:ListThingsCommand: ${rule.test} does not test projectThing`,
    ]);
  });
});
