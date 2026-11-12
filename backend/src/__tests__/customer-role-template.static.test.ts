/**
 * The DevControl CloudFormation template (AWS connect PR D2, D2-D1): the
 * current version creates exactly the role the manual setup describes, and a
 * published version never changes.
 *
 * Compared against the sources the Connect page and the policy compare use:
 * the trust-policy builder, lib/aws/customer-role-inline-policy.json, the
 * managed-policy constants and the permission contract. Placeholders only; no
 * AWS. The template's intrinsic functions are resolved symbolically.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { buildTrustPolicy } from '../services/customer-role-trust-policy';
import {
  CUSTOMER_ROLE_CONTRACT_VERSION,
  READ_EXTRAS_POLICY_NAME,
  SECURITY_AUDIT_ARN,
  VIEW_ONLY_ACCESS_ARN,
  readExtrasVerdict,
} from '../services/connect-policy-compare';
import { CURRENT_TEMPLATE_VERSION, CUSTOMER_ROLE_TEMPLATES } from '../services/customer-role-template';
import { WELL_FORMED_EXTERNAL_ID, generateExternalId, isWellFormedExternalId } from '../repositories/aws-external-id.repository';
import { checkNewConnectionRoleArn } from '../utils/devcontrolRoleArn';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const TEMPLATE_DIR = path.join(REPO_ROOT, 'lib', 'aws', 'cloudformation');
const INLINE_POLICY_FILE = path.join(REPO_ROOT, 'lib', 'aws', 'customer-role-inline-policy.json');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(TEMPLATE_DIR, 'published-templates.json'), 'utf8')) as Record<string, { file: string; sourceSha256: string; contractVersion: number }>;

const ACCOUNT = '123456789012';
const EXTERNAL = 'X-EXTERNAL';
const PLACEHOLDER = '{{PLATFORM_ACCOUNT_ID}}';

const readTemplate = (version: string) => fs.readFileSync(path.join(TEMPLATE_DIR, MANIFEST[version].file), 'utf8');
const current = () => JSON.parse(readTemplate(CURRENT_TEMPLATE_VERSION));
const role = () => current().Resources.DevControlRole;

/** Resolves Ref ExternalId, the platform placeholder and Fn::Sub ${AWS::AccountId}; any other intrinsic fails. */
function resolve(value: unknown): unknown {
  if (typeof value === 'string') return value.split(PLACEHOLDER).join(ACCOUNT);
  if (Array.isArray(value)) return value.map(resolve);
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 1 && keys[0] === 'Ref') {
      if ((value as { Ref: string }).Ref !== 'ExternalId') throw new Error(`unexpected Ref ${(value as { Ref: string }).Ref}`);
      return EXTERNAL;
    }
    if (keys.length === 1 && keys[0] === 'Fn::Sub') {
      const text = (value as Record<string, unknown>)['Fn::Sub'];
      if (typeof text !== 'string') throw new Error('Fn::Sub with variables');
      const resolved = text.split('${AWS::AccountId}').join(ACCOUNT);
      if (resolved.includes('${')) throw new Error(`unresolved Fn::Sub variable in ${text}`);
      return resolved;
    }
    if (keys.some((k) => k.startsWith('Fn::'))) throw new Error(`unexpected intrinsic ${keys.join(',')}`);
    return Object.fromEntries(keys.map((k) => [k, resolve((value as Record<string, unknown>)[k])]));
  }
  return value;
}

const inlineContract = () => JSON.parse(fs.readFileSync(INLINE_POLICY_FILE, 'utf8').split('<ACCOUNT_ID>').join(ACCOUNT));
const sha256 = (text: string) => crypto.createHash('sha256').update(text).digest('hex');

describe('TT1 one IAM role, nothing else', () => {
  it('has exactly one resource, an AWS::IAM::Role with exactly the expected properties', () => {
    const template = current();
    expect(Object.keys(template).sort()).toEqual(['AWSTemplateFormatVersion', 'Description', 'Outputs', 'Parameters', 'Resources']);
    expect(Object.keys(template.Resources)).toEqual(['DevControlRole']);
    const resource = role();
    expect(Object.keys(resource).sort()).toEqual(['Properties', 'Type']);
    expect(resource.Type).toBe('AWS::IAM::Role');
    expect(Object.keys(resource.Properties).sort()).toEqual(
      ['AssumeRolePolicyDocument', 'Description', 'ManagedPolicyArns', 'MaxSessionDuration', 'Path', 'Policies', 'RoleName'].sort()
    );
    expect(resource.Properties.Path).toBe('/');
    expect(resource.Properties.MaxSessionDuration).toBe(3600);
    expect(resource.Properties.RoleName).toEqual({ Ref: 'RoleName' });
  });
});

describe('TT2 trust policy parity', () => {
  it('equals the trust policy the Connect page shows, for the same External ID and platform account', () => {
    expect(resolve(role().Properties.AssumeRolePolicyDocument)).toStrictEqual(buildTrustPolicy(EXTERNAL, ACCOUNT));
  });
});

describe('TT3 inline policy parity', () => {
  it('has one inline policy, DevControlReadExtras, equal statement for statement to the JSON the page shows', () => {
    const policies = role().Properties.Policies;
    expect(policies).toHaveLength(1);
    expect(Object.keys(policies[0]).sort()).toEqual(['PolicyDocument', 'PolicyName']);
    expect(policies[0].PolicyName).toBe(READ_EXTRAS_POLICY_NAME);
    expect(resolve(policies[0].PolicyDocument)).toStrictEqual(inlineContract());
  });

  it("is what the policy compare calls 'matches' for a stack-made role", () => {
    const document = resolve(role().Properties.Policies[0].PolicyDocument);
    expect(readExtrasVerdict(encodeURIComponent(JSON.stringify(document)), ACCOUNT)).toBe('matches');
  });
});

describe('TT4 managed policies', () => {
  it('are exactly SecurityAudit and job-function/ViewOnlyAccess', () => {
    expect(role().Properties.ManagedPolicyArns).toStrictEqual([SECURITY_AUDIT_ARN, VIEW_ONLY_ACCESS_ARN]);
  });
});

describe('TT5 the platform account is a placeholder', () => {
  it('appears exactly once, only in the trust principal, and no 12-digit literal is present', () => {
    const text = readTemplate(CURRENT_TEMPLATE_VERSION);
    expect(text.split(PLACEHOLDER)).toHaveLength(2);
    expect(role().Properties.AssumeRolePolicyDocument.Statement[0].Principal.AWS).toBe(`arn:aws:iam::${PLACEHOLDER}:root`);
    expect(text).not.toMatch(/\d{12}/);
  });
});

const EXTERNAL_ID_CORPUS = [
  ...Array.from({ length: 20 }, () => generateExternalId()),
  'ab', 'a'.repeat(64), 'legacy+value', 'legacy=value', 'a,b', 'a.b', 'name@example', 'urn:x', 'a/b', 'a_b', 'a-b',
  'a', 'a'.repeat(65), 'has space', 'café-id', '', 'line\nbreak', 'tab\there', 'quote"id', 'semi;colon',
];

describe('TT6 ExternalId parameter', () => {
  it('uses the repository alphabet, 2 to 64 characters, with no default and no NoEcho', () => {
    const parameter = current().Parameters.ExternalId;
    expect(parameter.Type).toBe('String');
    expect(parameter.AllowedPattern).toBe(WELL_FORMED_EXTERNAL_ID.source);
    expect(parameter.MinLength).toBe(2);
    expect(parameter.MaxLength).toBe(64);
    expect(parameter).not.toHaveProperty('Default');
    expect(parameter).not.toHaveProperty('NoEcho');
  });

  it.each(EXTERNAL_ID_CORPUS.map((value) => [JSON.stringify(value), value]))('accepts %s exactly when the repository does', (_label, value) => {
    const parameter = current().Parameters.ExternalId;
    const templateAccepts = new RegExp(parameter.AllowedPattern).test(value) && value.length >= parameter.MinLength && value.length <= parameter.MaxLength;
    expect(templateAccepts).toBe(isWellFormedExternalId(value));
  });
});

const ROLE_NAME_CORPUS = [
  'DevControlRole', 'DevControlRole-prod', 'DevControlRole_2', 'DevControlRole+x=y,z.w@v', `DevControlRole${'a'.repeat(50)}`,
  'devcontrolrole', 'DevControl', 'XDevControlRole', 'path/DevControlRole', 'DevControlRole/x', 'DevControlRole x',
  `DevControlRole${'a'.repeat(51)}`, 'DevControlRoleé', '',
];

describe('TT7 RoleName parameter', () => {
  it('defaults to DevControlRole, at most 64 characters, prefix pattern anchored at both ends', () => {
    const parameter = current().Parameters.RoleName;
    expect(parameter.Type).toBe('String');
    expect(parameter.Default).toBe('DevControlRole');
    expect(parameter.MaxLength).toBe(64);
    expect(parameter.AllowedPattern).toBe('^DevControlRole[\\w+=,.@-]*$');
  });

  it.each(ROLE_NAME_CORPUS.map((value) => [JSON.stringify(value), value]))('accepts %s exactly when the connect rule accepts its ARN', (_label, name) => {
    const parameter = current().Parameters.RoleName;
    const templateAccepts = new RegExp(parameter.AllowedPattern).test(name) && name.length <= parameter.MaxLength;
    const connectAccepts = checkNewConnectionRoleArn(`arn:aws:iam::${ACCOUNT}:role/${name}`).ok && name.length <= 64;
    expect(templateAccepts).toBe(connectAccepts);
  });
});

describe('TT8 outputs', () => {
  it('are the role ARN and the template version', () => {
    const outputs = current().Outputs;
    expect(Object.keys(outputs).sort()).toEqual(['RoleArn', 'TemplateVersion']);
    expect(outputs.RoleArn.Value).toStrictEqual({ 'Fn::GetAtt': ['DevControlRole', 'Arn'] });
    expect(outputs.TemplateVersion.Value).toBe(CURRENT_TEMPLATE_VERSION);
  });
});

describe('TT9 published versions are frozen and linked to the contract', () => {
  it('every published file matches its pinned SHA-256', () => {
    expect(Object.keys(MANIFEST).length).toBeGreaterThan(0);
    for (const [version, entry] of Object.entries(MANIFEST)) {
      expect({ version, sha256: sha256(readTemplate(version)) }).toEqual({ version, sha256: entry.sourceSha256 });
    }
  });

  it('v1 is this exact file', () => {
    expect(MANIFEST['1']).toEqual({ file: 'devcontrol-role.v1.template.json', sourceSha256: 'be50a2ead56e1052db83832692b388c0f42d0fafe8b3308e015b5888a974b0fe', contractVersion: 1 });
  });

  it("the backend's version map equals the manifest, and the current version implements the running contract", () => {
    expect(Object.fromEntries(Object.entries(MANIFEST).map(([v, e]) => [v, { contractVersion: e.contractVersion }]))).toStrictEqual(CUSTOMER_ROLE_TEMPLATES);
    expect(CUSTOMER_ROLE_TEMPLATES[CURRENT_TEMPLATE_VERSION].contractVersion).toBe(CUSTOMER_ROLE_CONTRACT_VERSION);
  });

  it('the file name, the role description and the template description name the version', () => {
    expect(MANIFEST[CURRENT_TEMPLATE_VERSION].file).toBe(`devcontrol-role.v${CURRENT_TEMPLATE_VERSION}.template.json`);
    expect(role().Properties.Description).toContain(`template v${CURRENT_TEMPLATE_VERSION}`);
    expect(current().Description).toContain(`template v${CURRENT_TEMPLATE_VERSION}`);
  });
});

describe('TT10 patterns use only syntax JavaScript and CloudFormation share', () => {
  it('anchors, character classes, \\w and {m,n} only: no lookaround, backreference, named group or flag', () => {
    for (const parameter of Object.values(current().Parameters) as Array<{ AllowedPattern?: string }>) {
      const pattern = parameter.AllowedPattern as string;
      expect(pattern.startsWith('^') && pattern.endsWith('$')).toBe(true);
      expect(pattern).not.toMatch(/\(\?|\\[1-9]|\\k<|\\p\{/);
    }
  });
});
