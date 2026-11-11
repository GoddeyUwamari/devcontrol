/**
 * The policy-set compare (AWS connect PR D1, CP-D4, CP-D8, D1-D8): canonical
 * comparison of DevControlReadExtras, the verdicts for every role shape, the
 * pagination cap, and that the policy document never leaves the module.
 * A fake IAM client; no AWS. Placeholders only.
 */
import * as fs from 'fs';
import * as path from 'path';
import { GetRolePolicyCommand, ListAttachedRolePoliciesCommand, ListRolePoliciesCommand } from '@aws-sdk/client-iam';
import {
  CUSTOMER_ROLE_CONTRACT_VERSION,
  MAX_PAGES,
  READ_ONLY_ACCESS_ARN,
  SECURITY_AUDIT_ARN,
  VIEW_ONLY_ACCESS_ARN,
  canonicalPolicy,
  compareRolePolicies,
  contractFingerprint,
  readExtrasVerdict,
  roleNameOf,
  type IamSender,
} from '../connect-policy-compare';

const ACCOUNT = '123456789012';
const ROLE_ARN = `arn:aws:iam::${ACCOUNT}:role/DevControlRole`;
const ROOT_POLICY = path.join(__dirname, '../../../../lib/aws/customer-role-inline-policy.json');
const BACKEND_COPY = path.join(__dirname, '../../config/customer-role-inline-policy.json');

const contract = () => JSON.parse(fs.readFileSync(ROOT_POLICY, 'utf8').split('<ACCOUNT_ID>').join(ACCOUNT));
const encode = (doc: unknown) => encodeURIComponent(JSON.stringify(doc));

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('the contract', () => {
  it('the backend copy is byte-identical to lib/aws/customer-role-inline-policy.json', () => {
    expect(fs.readFileSync(BACKEND_COPY, 'utf8')).toBe(fs.readFileSync(ROOT_POLICY, 'utf8'));
  });

  it('version 1 is this exact policy (a change to the JSON must bump CUSTOMER_ROLE_CONTRACT_VERSION and this pin)', () => {
    expect(CUSTOMER_ROLE_CONTRACT_VERSION).toBe(1);
    expect(contractFingerprint()).toBe('691e9547453579c05af11cfcbd975eb08035990755007ae46754df09ca1dd6cf');
  });
});

describe('readExtrasVerdict', () => {
  it('the policy as shown on the Connect page matches', () => {
    expect(readExtrasVerdict(encode(contract()), ACCOUNT)).toBe('matches');
  });

  it('equivalent forms match: statement and action order, string vs one-element list, Sid, action case', () => {
    const doc = contract();
    doc.Statement.reverse();
    for (const s of doc.Statement) {
      delete s.Sid;
      s.Action = Array.isArray(s.Action) ? [...s.Action].reverse().map((a: string, i: number) => (i % 2 ? a.toUpperCase() : a)) : s.Action;
      if (Array.isArray(s.Action) && s.Action.length === 1) s.Action = s.Action[0];
    }
    expect(readExtrasVerdict(encode(doc), ACCOUNT)).toBe('matches');
    // not URL-encoded is accepted too
    expect(readExtrasVerdict(JSON.stringify(contract()), ACCOUNT)).toBe('matches');
  });

  it.each([
    ['a Deny action removed', (d: any) => { d.Statement[2].Action.pop(); }],
    ['an Allow action added', (d: any) => { d.Statement[0].Action = [d.Statement[0].Action].flat().concat('s3:GetObject'); }],
    ['a Resource changed', (d: any) => { d.Statement[1].Resource = '*'; }],
    ['an extra statement', (d: any) => { d.Statement.push({ Effect: 'Allow', Action: 'ec2:StopInstances', Resource: '*' }); }],
    ['a Condition added', (d: any) => { d.Statement[0].Condition = { Bool: { 'aws:SecureTransport': 'true' } }; }],
    ['Effect changed', (d: any) => { d.Statement[2].Effect = 'Allow'; }],
  ])('%s differs', (_label, mutate) => {
    const doc = contract();
    mutate(doc);
    expect(readExtrasVerdict(encode(doc), ACCOUNT)).toBe('differs');
  });

  it('another account in the Resource differs; garbage differs', () => {
    expect(readExtrasVerdict(encode(contract()), '111122223333')).toBe('differs');
    expect(readExtrasVerdict('%7Bnot json', ACCOUNT)).toBe('differs');
    expect(readExtrasVerdict(undefined, ACCOUNT)).toBe('differs');
    expect(canonicalPolicy({ Version: '2012-10-17' })).toBeNull();
  });
});

describe('roleNameOf', () => {
  it('the last segment of the ARN, path or not', () => {
    expect(roleNameOf(ROLE_ARN)).toBe('DevControlRole');
    expect(roleNameOf(`arn:aws:iam::${ACCOUNT}:role/legacy/path/DevControlRole-Old`)).toBe('DevControlRole-Old');
    expect(roleNameOf('not an arn')).toBeNull();
  });
});

/** A fake IAM client answering by command type. */
function fakeIam(answer: {
  attached?: string[] | Error;
  inline?: string[] | Error;
  document?: unknown | Error;
  truncateForever?: boolean;
}): IamSender & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    send: jest.fn(async (command: unknown) => {
      if (command instanceof ListAttachedRolePoliciesCommand) {
        calls.push('ListAttachedRolePolicies');
        if (answer.attached instanceof Error) throw answer.attached;
        return { AttachedPolicies: (answer.attached ?? []).map((PolicyArn) => ({ PolicyArn, PolicyName: PolicyArn.split('/').pop() })), IsTruncated: !!answer.truncateForever, Marker: answer.truncateForever ? 'next' : undefined };
      }
      if (command instanceof ListRolePoliciesCommand) {
        calls.push('ListRolePolicies');
        if (answer.inline instanceof Error) throw answer.inline;
        return { PolicyNames: answer.inline ?? [], IsTruncated: false };
      }
      if (command instanceof GetRolePolicyCommand) {
        calls.push('GetRolePolicy');
        if (answer.document instanceof Error) throw answer.document;
        return { RoleName: 'DevControlRole', PolicyName: 'DevControlReadExtras', PolicyDocument: answer.document };
      }
      throw new Error('unexpected command');
    }),
  };
}

const denied = () => Object.assign(new Error('User is not authorized'), { name: 'AccessDenied' });
const compare = (iam: IamSender) => compareRolePolicies({ iam, roleArn: ROLE_ARN, accountId: ACCOUNT, context: 'test' });

describe('compareRolePolicies', () => {
  it('the recommended set: all attached, DevControlReadExtras matches', async () => {
    const iam = fakeIam({ attached: [SECURITY_AUDIT_ARN, VIEW_ONLY_ACCESS_ARN], inline: ['DevControlReadExtras'], document: encode(contract()) });
    expect(await compare(iam)).toEqual({
      unreadable: false, securityAudit: 'attached', viewOnlyAccess: 'attached', readExtras: 'matches',
      readOnlyAccess: false, otherAwsManaged: [], otherCount: 0, contractVersion: 1,
    });
    expect(iam.calls).toEqual(['ListAttachedRolePolicies', 'ListRolePolicies', 'GetRolePolicy']);
  });

  it('missing managed policies and a missing inline policy', async () => {
    expect(await compare(fakeIam({ attached: [], inline: [] }))).toMatchObject({ securityAudit: 'missing', viewOnlyAccess: 'missing', readExtras: 'missing' });
  });

  it('a legacy ReadOnlyAccess role, other AWS-managed policies named, customer-managed and other inline counted', async () => {
    const result = await compare(fakeIam({
      attached: [READ_ONLY_ACCESS_ARN, 'arn:aws:iam::aws:policy/AdministratorAccess', `arn:aws:iam::${ACCOUNT}:policy/customer-secret-name`],
      inline: ['customer-inline-name', 'DevControlReadExtras'],
      document: encode(contract()),
    }));
    expect(result).toMatchObject({ readOnlyAccess: true, otherAwsManaged: ['AdministratorAccess'], otherCount: 2, securityAudit: 'missing' });
    expect(JSON.stringify(result)).not.toMatch(/customer-secret-name|customer-inline-name/);
  });

  it('GetRolePolicy refused: DevControlReadExtras unreadable, the rest still reported', async () => {
    const result = await compare(fakeIam({ attached: [VIEW_ONLY_ACCESS_ARN], inline: ['DevControlReadExtras'], document: denied() }));
    expect(result).toMatchObject({ unreadable: false, securityAudit: 'missing', viewOnlyAccess: 'attached', readExtras: 'unreadable' });
  });

  it('listing refused: unreadable as a whole', async () => {
    expect(await compare(fakeIam({ attached: denied() }))).toEqual({ unreadable: true, contractVersion: 1 });
    expect(await compare(fakeIam({ attached: [], inline: denied() }))).toEqual({ unreadable: true, contractVersion: 1 });
  });

  it(`a listing past ${MAX_PAGES} pages is unreadable`, async () => {
    const iam = fakeIam({ attached: [SECURITY_AUDIT_ARN], truncateForever: true });
    expect(await compare(iam)).toEqual({ unreadable: true, contractVersion: 1 });
    expect(iam.calls.filter((c) => c === 'ListAttachedRolePolicies')).toHaveLength(MAX_PAGES);
  });

  it('a call that never answers times out as unreadable', async () => {
    const iam: IamSender = { send: () => new Promise(() => {}) };
    expect(await compareRolePolicies({ iam, roleArn: ROLE_ARN, accountId: ACCOUNT, context: 'test', timeoutMs: 10 })).toEqual({ unreadable: true, contractVersion: 1 });
  });

  it('no call without a role name or a 12-digit account', async () => {
    const iam = fakeIam({});
    expect(await compareRolePolicies({ iam, roleArn: 'garbage', accountId: ACCOUNT, context: 't' })).toEqual({ unreadable: true, contractVersion: 1 });
    expect(await compareRolePolicies({ iam, roleArn: ROLE_ARN, accountId: '', context: 't' })).toEqual({ unreadable: true, contractVersion: 1 });
    expect(iam.calls).toEqual([]);
  });

  it('the policy document is never in the result or the logs', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const doc = contract();
    doc.Statement.push({ Sid: 'MarkerStatementXyz', Effect: 'Allow', Action: 'sts:GetCallerIdentity', Resource: '*' });
    const result = await compare(fakeIam({ attached: [SECURITY_AUDIT_ARN], inline: ['DevControlReadExtras'], document: encode(doc) }));
    expect(result).toMatchObject({ readExtras: 'differs' });
    expect(JSON.stringify(result)).not.toMatch(/MarkerStatementXyz|Statement|ce:GetCostAndUsage/);
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/MarkerStatementXyz/);
  });
});

describe('the IAM commands of the compare are constructed in connect-policy-compare.ts only', () => {
  it('no other non-test backend file constructs them', () => {
    const root = path.join(__dirname, '../..');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { if (entry.name !== '__tests__' && entry.name !== 'node_modules') walk(full); continue; }
        if (!entry.name.endsWith('.ts') || full.endsWith(path.join('services', 'connect-policy-compare.ts'))) continue;
        if (/new\s+(ListAttachedRolePoliciesCommand|ListRolePoliciesCommand|GetRolePolicyCommand)\s*\(/.test(fs.readFileSync(full, 'utf8'))) offenders.push(full);
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
