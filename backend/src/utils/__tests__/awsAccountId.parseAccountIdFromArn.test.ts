/**
 * parseAccountIdFromArn: the one rule for which AWS account a role ARN names
 * (scan context, scan lease, coverage route). Defined in utils/awsAccountId.ts,
 * which imports nothing, and re-exported unchanged by the client factory.
 */
import fs from 'fs';
import path from 'path';
import { parseAccountIdFromArn } from '../awsAccountId';
import { parseAccountIdFromArn as fromFactory } from '../../services/aws-client-factory.service';

describe('parseAccountIdFromArn', () => {
  it('reads the account of an IAM role or user ARN', () => {
    expect(parseAccountIdFromArn('arn:aws:iam::123456789012:role/DevControlRole')).toBe('123456789012');
    expect(parseAccountIdFromArn('arn:aws:iam::111122223333:user/someone')).toBe('111122223333');
  });

  it('names no account for anything else', () => {
    for (const arn of ['', 'not-an-arn', 'arn:aws:iam::12345678901:role/x', 'arn:aws:s3:::bucket', 'arn:aws:iam:::role/x', ' arn:aws:iam::123456789012:role/x']) {
      expect(parseAccountIdFromArn(arn)).toBeUndefined();
    }
  });

  it('the client factory re-exports the same function', () => {
    expect(fromFactory).toBe(parseAccountIdFromArn);
  });

  it('the module imports nothing, so a route that must not load the AWS SDK can use it', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'awsAccountId.ts'), 'utf8');
    expect(source).not.toMatch(/^\s*import\b|\brequire\(/m);
  });
});
