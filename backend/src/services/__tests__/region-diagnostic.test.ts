/**
 * Region-access PR 1 (c): the diagnostic a region's failure carries into
 * aws_account_regions.last_error_message and its log line: `<source>:<operation>:<AWS
 * error name>`, never AWS message text, an ARN, an account ID or a request ID.
 */
import { SOURCE_DIAGNOSTIC_PATTERN, safeDiagnostic, sanitisedErrorName, sourceDiagnostic } from '../region-log-context';
import { regionScanResult } from '../region-run';

const awsError = (name: string) =>
  Object.assign(new Error('User: arn:aws:sts::123456789012:assumed-role/x/s is not authorized to perform: resource-explorer-2:Search on resource: *'), {
    name,
    $metadata: { httpStatusCode: 403, requestId: '00000000-0000-4000-8000-0000000000aa' },
  });

describe('sourceDiagnostic', () => {
  it('is the source, the operation and the AWS error name, nothing else', () => {
    expect(sourceDiagnostic('resource-explorer', 'Search', awsError('AccessDeniedException'))).toBe('resource-explorer:Search:AccessDeniedException');
    expect(sourceDiagnostic('resource-explorer', 'GetDefaultView', awsError('ThrottlingException'))).toBe('resource-explorer:GetDefaultView:ThrottlingException');
    expect(sourceDiagnostic('resource-explorer', 'GetIndex', awsError('AccessDeniedException'))).toBe('resource-explorer:GetIndex:AccessDeniedException');
  });

  it.each([
    ['a name with a 12-digit run', 'Error123456789012'],
    ['a name with an ARN', 'arn:aws:iam::123456789012:role/x'],
    ['a name with spaces', 'Access Denied'],
    ['a name with a colon', 'Access:Denied'],
    ['an empty name', ''],
    ['a very long name', 'A'.repeat(65)],
  ])('%s becomes Error', (_label, name) => {
    expect(sanitisedErrorName(awsError(name))).toBe('Error');
  });

  it('a non-error value is Error', () => {
    expect(sanitisedErrorName(undefined)).toBe('Error');
    expect(sanitisedErrorName('AccessDeniedException')).toBe('Error');
  });

  it('never carries the message, the account ID or the request ID', () => {
    const value = sourceDiagnostic('resource-explorer', 'Search', awsError('AccessDeniedException'));
    expect(value).not.toMatch(/not authorized|arn:|[0-9]{12}|0000000000aa/);
    expect(value).toMatch(SOURCE_DIAGNOSTIC_PATTERN);
  });
});

describe('safeDiagnostic (what may be written to last_error_message)', () => {
  it('keeps a value of the diagnostic shape', () => {
    expect(safeDiagnostic('resource-explorer:Search:AccessDeniedException')).toBe('resource-explorer:Search:AccessDeniedException');
  });
  it.each([
    'User: arn:aws:sts::123456789012:assumed-role/x is not authorized',
    'resource-explorer:Search:Error123456789012',
    'resource-explorer:Search',
    'resource-explorer:Search:AccessDenied:extra',
    'Resource Explorer: placeholder',
    '',
  ])('refuses %j', (value) => {
    expect(safeDiagnostic(value)).toBeNull();
  });
  it('refuses a non-string', () => {
    expect(safeDiagnostic(undefined)).toBeNull();
    expect(safeDiagnostic({ toString: () => 'resource-explorer:Search:AccessDeniedException' })).toBeNull();
  });
});

describe('regionScanResult: the diagnostic of the failure that set the code', () => {
  const ok = (source: string) => ({ source, status: 'complete' as const });
  const reDenied = { source: 'resource-explorer', status: 'denied' as const, reason: 'access_denied', diagnostic: 'resource-explorer:Search:AccessDeniedException' };

  it('a Resource Explorer refusal: denied, access_denied, its diagnostic', () => {
    expect(regionScanResult([ok('ec2'), reDenied], false)).toEqual({ status: 'denied', errorCode: 'access_denied', diagnostic: 'resource-explorer:Search:AccessDeniedException' });
  });

  it('a listing refusal with no known call: no diagnostic (never another source\'s with another code)', () => {
    expect(regionScanResult([{ source: 'ec2', status: 'denied', reason: 'access_denied_scp' }, reDenied], false)).toEqual({ status: 'denied', errorCode: 'access_denied_scp' });
    expect(regionScanResult([{ source: 'ec2', status: 'denied', reason: 'access_denied' }], false)).toEqual({ status: 'denied', errorCode: 'access_denied' });
  });

  it('a worse status elsewhere wins, without the Resource Explorer diagnostic', () => {
    expect(regionScanResult([{ source: 'rds', status: 'denied', reason: 'access_denied' }, { ...reDenied, status: 'failed', reason: 'error' }], false))
      .toEqual({ status: 'denied', errorCode: 'access_denied' });
  });

  it('ok, partial and a passed deadline carry none', () => {
    expect(regionScanResult([ok('ec2'), ok('resource-explorer')], false)).toEqual({ status: 'ok', errorCode: null });
    expect(regionScanResult([reDenied], true)).toEqual({ status: 'timed_out', errorCode: 'region_deadline' });
  });
});
