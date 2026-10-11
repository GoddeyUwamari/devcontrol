import { checkNewConnectionRoleArn } from '../devcontrolRoleArn';

// Placeholder account ID throughout; no real account is named.
const ACCOUNT = '123456789012';

describe('checkNewConnectionRoleArn', () => {
  it.each([
    'DevControlRole',
    'DevControlRole-Prod',
    'DevControlRole_staging',
    'DevControlRole+=,.@-1',
  ])('accepts a role named %s and returns its account ID', (name) => {
    expect(checkNewConnectionRoleArn(`arn:aws:iam::${ACCOUNT}:role/${name}`)).toEqual({ ok: true, accountId: ACCOUNT });
  });

  it.each([
    ['another name', 'devcontrol-readonly'],
    ['a lowercase prefix', 'devcontrolrole'],
    ['the prefix not at the start', 'MyDevControlRole'],
    ['an IAM path', 'service-roles/DevControlRole'],
    ['a nested IAM path', 'a/b/DevControlRole-Prod'],
    ['a wildcard', 'DevControlRole*'],
    ['whitespace', 'DevControlRole Prod'],
  ])('rejects %s as a role-name problem', (_label, resource) => {
    expect(checkNewConnectionRoleArn(`arn:aws:iam::${ACCOUNT}:role/${resource}`)).toEqual({ ok: false, reason: 'role_name' });
  });

  it.each([
    ['empty', ''],
    ['an 11-digit account', 'arn:aws:iam::12345678901:role/DevControlRole'],
    ['a 13-digit account', 'arn:aws:iam::1234567890123:role/DevControlRole'],
    ['a user ARN', `arn:aws:iam::${ACCOUNT}:user/DevControlRole`],
    ['another service', `arn:aws:sts::${ACCOUNT}:assumed-role/DevControlRole/s`],
    ['leading text', `prefix arn:aws:iam::${ACCOUNT}:role/DevControlRole`],
    ['no role name', `arn:aws:iam::${ACCOUNT}:role/`],
    ['just a name', 'DevControlRole'],
  ])('rejects %s as malformed', (_label, arn) => {
    expect(checkNewConnectionRoleArn(arn)).toEqual({ ok: false, reason: 'malformed' });
  });
});
