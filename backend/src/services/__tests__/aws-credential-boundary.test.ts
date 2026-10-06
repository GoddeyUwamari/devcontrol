/**
 * The AWS credential boundary, checked over the backend's own source.
 *
 * Invariant:
 *   1. Every AWS SDK client other than STS is constructed with explicit
 *      `credentials`, and those credentials are not the platform's own
 *      (nothing read from process.env). A client constructed without
 *      `credentials` would fall back to the SDK's default provider chain --
 *      the server's ambient identity -- for an organization's AWS operations.
 *   2. The platform's credentials (process.env.AWS_ACCESS_KEY_ID / SECRET /
 *      SESSION_TOKEN) reach an AWS client only as the identity of an STS
 *      client, and a module that builds an STS client uses it for AssumeRole
 *      and nothing else.
 *   3. No module opts into an SDK credential provider (fromEnv, fromIni, the
 *      node provider chain, ...).
 *
 * This reads the syntax tree of each source file, so it follows what is
 * passed to each constructor rather than counting occurrences: adding a
 * client is fine, adding one without the organization's credentials is not.
 * The checker itself is exercised against small good and bad samples first,
 * so a refactor cannot leave it passing vacuously.
 */
import fs from 'fs';
import path from 'path';
import ts from 'typescript';

const SOURCE_ROOT = path.join(__dirname, '..', '..');
const PLATFORM_KEY_VARIABLES = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN'];
/**
 * Modules that read the platform keys without building any AWS client: a
 * startup report of what is configured, and a "the platform can call STS at
 * all" precondition. Neither can sign a request.
 */
const PRESENCE_CHECK_ONLY = ['config/validateEnv.ts', 'controllers/infrastructure.controller.ts'];
const STS_PACKAGE = '@aws-sdk/client-sts';
const ALLOWED_STS_IMPORTS = ['STSClient', 'AssumeRoleCommand'];

interface Violation {
  file: string;
  line: number;
  problem: string;
}
interface Analysis {
  violations: Violation[];
  customerClients: number;
  stsClients: number;
}

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' || entry.name === 'node_modules' ? [] : sourceFiles(full);
    return /\.ts$/.test(entry.name) && !/\.(test|d)\.ts$/.test(entry.name) ? [full] : [];
  });
}

function analyze(file: string, text: string): Analysis {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);
  const violations: Violation[] = [];
  const report = (node: ts.Node, problem: string) =>
    violations.push({ file, line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1, problem });

  // name -> package, for everything imported from an AWS SDK client package.
  const awsImports = new Map<string, string>();
  const visitImports = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const from = node.moduleSpecifier.text;
      const named = node.importClause?.namedBindings;
      if (/^@aws-sdk\/credential-provider/.test(from) || from === '@aws-sdk/credential-providers') {
        report(node, `imports an SDK credential provider (${from})`);
      }
      if (/^@aws-sdk\/client-/.test(from) && named && ts.isNamedImports(named)) {
        for (const element of named.elements) {
          awsImports.set(element.name.text, from);
          if (from === STS_PACKAGE && !element.isTypeOnly && !ALLOWED_STS_IMPORTS.includes((element.propertyName ?? element.name).text)) {
            report(element, `uses STS for more than AssumeRole (${(element.propertyName ?? element.name).text})`);
          }
        }
      }
    }
    ts.forEachChild(node, visitImports);
  };
  visitImports(source);

  // Everything a name is initialised with or assigned, anywhere in the file.
  const valuesOf = (name: string): ts.Expression[] => {
    const found: ts.Expression[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer) found.push(node.initializer);
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(node.left) && node.left.text === name) found.push(node.right);
      ts.forEachChild(node, visit);
    };
    visit(source);
    return found;
  };

  /** The `credentials` expressions that reach a constructor argument, following names and spreads. */
  const credentialsOf = (expression: ts.Expression, depth = 0): ts.Expression[] => {
    if (depth > 4) return [];
    if (ts.isIdentifier(expression)) return valuesOf(expression.text).flatMap((value) => credentialsOf(value, depth + 1));
    if (ts.isAsExpression(expression) || ts.isParenthesizedExpression(expression)) return credentialsOf(expression.expression, depth);
    if (!ts.isObjectLiteralExpression(expression)) return [];
    return expression.properties.flatMap((property): ts.Expression[] => {
      if (ts.isPropertyAssignment(property) && property.name.getText(source) === 'credentials') return [property.initializer];
      if (ts.isShorthandPropertyAssignment(property) && property.name.text === 'credentials') return [property.name];
      if (ts.isSpreadAssignment(property)) return credentialsOf(property.expression, depth + 1);
      return [];
    });
  };

  /**
   * Whether a credentials expression draws on process.env, following the
   * names it refers to. The result of a call is a new value and is not
   * followed: credentials returned by `sts.send(new AssumeRoleCommand(...))`
   * are the assumed role's, even though that STS client was itself built on
   * the platform keys -- which is exactly the allowed derivation.
   */
  const readsEnvironment = (expression: ts.Expression, depth = 0): boolean => {
    if (depth > 6) return false;
    let found = false;
    const visit = (node: ts.Node) => {
      if (found) return;
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) return;
      if (ts.isPropertyAccessExpression(node) && /^process\s*\.\s*env$/.test(node.expression.getText(source))) {
        found = true;
        return;
      }
      // A bare name, not the member of another object (creds.AccessKeyId) or a property key.
      const isReference = ts.isIdentifier(node)
        && !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)
        && !(ts.isPropertyAssignment(node.parent) && node.parent.name === node);
      if (isReference) {
        found = valuesOf((node as ts.Identifier).text).some((value) => readsEnvironment(value, depth + 1));
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(expression);
    return found;
  };

  let customerClients = 0;
  let stsClients = 0;
  const visit = (node: ts.Node) => {
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && /Client$/.test(node.expression.text) && awsImports.has(node.expression.text)) {
      const client = node.expression.text;
      if (awsImports.get(client) === STS_PACKAGE) {
        stsClients++;
      } else {
        customerClients++;
        const argument = node.arguments?.[0];
        const credentials = argument ? credentialsOf(argument) : [];
        if (credentials.length === 0) report(node, `${client} is constructed without explicit credentials (ambient default chain)`);
        else if (credentials.some((value) => readsEnvironment(value))) report(node, `${client} is constructed with credentials read from the environment (platform keys)`);
      }
    }
    // process.env.AWS_ACCESS_KEY_ID and friends.
    if (ts.isPropertyAccessExpression(node) && PLATFORM_KEY_VARIABLES.includes(node.name.text) && /^process\s*\.\s*env$/.test(node.expression.getText(source))) {
      let ancestor: ts.Node | undefined = node.parent;
      while (ancestor && !ts.isNewExpression(ancestor)) ancestor = ancestor.parent;
      const insideSts = !!ancestor && ts.isNewExpression(ancestor) && ts.isIdentifier(ancestor.expression) && awsImports.get(ancestor.expression.text) === STS_PACKAGE;
      const presenceCheckOnly = PRESENCE_CHECK_ONLY.some((allowed) => file.split(path.sep).join('/').endsWith(allowed));
      if (!insideSts && !presenceCheckOnly) report(node, `${node.name.text} is read outside an STS client's identity`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  return { violations, customerClients, stsClients };
}

const problems = (text: string, file = 'sample.ts') => analyze(file, text).violations.map((v) => v.problem);

describe('the checker catches each way the boundary can be crossed', () => {
  const IMPORTS = `
    import { EC2Client } from '@aws-sdk/client-ec2';
    import { S3Client } from '@aws-sdk/client-s3';
    import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';
  `;

  it('a client with no credentials (the default chain)', () => {
    expect(problems(`${IMPORTS} const c = new EC2Client({ region: 'us-east-1' });`)).toEqual([
      'EC2Client is constructed without explicit credentials (ambient default chain)',
    ]);
    expect(problems(`${IMPORTS} const c = new S3Client();`)).toEqual([
      'S3Client is constructed without explicit credentials (ambient default chain)',
    ]);
    expect(problems(`${IMPORTS} const config = { region: 'us-east-1' }; const c = new EC2Client(config);`)).toEqual([
      'EC2Client is constructed without explicit credentials (ambient default chain)',
    ]);
  });

  it('a client on the platform keys, written inline, through a config object, a spread, or a named value', () => {
    const inline = `new EC2Client({ region, credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID!, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY! } })`;
    const viaConfig = `const config = { region, credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID!, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY! } }; new EC2Client(config)`;
    const viaSpread = `const config = { region, credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID!, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY! } }; new EC2Client({ ...config, region: 'us-east-1' })`;
    const viaName = `const keys = { accessKeyId: process.env.AWS_ACCESS_KEY_ID!, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY! }; new EC2Client({ region, credentials: keys })`;
    for (const sample of [inline, viaConfig, viaSpread, viaName]) {
      const found = problems(`${IMPORTS} const region = 'us-east-1'; ${sample};`);
      expect(found).toContain('EC2Client is constructed with credentials read from the environment (platform keys)');
      expect(found).toContain('AWS_ACCESS_KEY_ID is read outside an STS client\'s identity');
    }
  });

  it('the platform keys read anywhere but an STS client, STS used for more than AssumeRole, and SDK credential providers', () => {
    expect(problems(`const k = process.env.AWS_SECRET_ACCESS_KEY;`)).toEqual(['AWS_SECRET_ACCESS_KEY is read outside an STS client\'s identity']);
    expect(problems(`import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';`)).toEqual([
      'uses STS for more than AssumeRole (GetCallerIdentityCommand)',
    ]);
    expect(problems(`import { fromNodeProviderChain } from '@aws-sdk/credential-providers';`)).toEqual([
      'imports an SDK credential provider (@aws-sdk/credential-providers)',
    ]);
  });

  it('and accepts the two allowed patterns', () => {
    const allowed = `${IMPORTS}
      async function clientsFor(roleArn: string, externalId: string, region: string) {
        const sts = new STSClient({ region, credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID!, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY! } });
        const assumed = await sts.send(new AssumeRoleCommand({ RoleArn: roleArn, RoleSessionName: 's', ExternalId: externalId }));
        let tempCredentials: { accessKeyId: string; secretAccessKey: string; sessionToken: string };
        tempCredentials = { accessKeyId: assumed.Credentials!.AccessKeyId!, secretAccessKey: assumed.Credentials!.SecretAccessKey!, sessionToken: assumed.Credentials!.SessionToken! };
        const config = { region, credentials: tempCredentials };
        return { ec2: new EC2Client(config), s3: new S3Client({ ...config, region: 'us-east-1' }), regional: (r: string) => new EC2Client({ region: r, credentials: tempCredentials }) };
      }`;
    const result = analyze('sample.ts', allowed);
    expect(result.violations).toEqual([]);
    expect([result.customerClients, result.stsClients]).toEqual([3, 1]);
  });
});

describe('backend source', () => {
  const analyses = sourceFiles(SOURCE_ROOT).map((file) => analyze(path.relative(SOURCE_ROOT, file), fs.readFileSync(file, 'utf8')));

  it('constructs no AWS client outside the boundary', () => {
    expect(analyses.flatMap((a) => a.violations)).toEqual([]);
  });

  it('was actually examined: it does build customer clients and STS clients', () => {
    // Not a count to maintain -- only proof that the walk above found the
    // real constructions rather than nothing.
    expect(analyses.reduce((n, a) => n + a.customerClients, 0)).toBeGreaterThan(0);
    expect(analyses.reduce((n, a) => n + a.stsClients, 0)).toBeGreaterThan(0);
  });

  it('the modules allowed to check that the platform keys are present build no AWS client', () => {
    for (const allowed of PRESENCE_CHECK_ONLY) {
      const analysis = analyze(allowed, fs.readFileSync(path.join(SOURCE_ROOT, allowed), 'utf8'));
      expect([allowed, analysis.customerClients + analysis.stsClients]).toEqual([allowed, 0]);
    }
  });
});
