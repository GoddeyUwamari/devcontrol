/**
 * S3 bucket security evaluation: public access (policy, ACL) and HTTPS-only
 * enforcement, each pass/fail/unknown. Local fixtures only; every AWS call is mocked.
 *
 * The protected-bucket fixture mirrors a configuration the bucket owner confirmed:
 * all four bucket-level Block Public Access settings on, Object Ownership
 * BucketOwnerEnforced (ACLs disabled), and a bucket policy made only of Deny
 * statements, one of them denying requests where aws:SecureTransport is false.
 * The previous scanner reported that bucket as publicly accessible (a raw-text match
 * on "Principal":"*") and as lacking encryption in transit (a tag lookup).
 */
import { Grant, S3Client } from '@aws-sdk/client-s3';
import { S3ControlClient } from '@aws-sdk/client-s3-control';
import {
  S3SecurityEvidence,
  S3_FINDING_KEYS,
  S3_FINDING_TEXTS,
  evaluatePublicPolicy,
  evaluatePublicAcl,
  evaluateHttpsOnly,
  evaluateS3Security,
  s3FindingsFromEvaluation,
  carryForwardUnverifiedS3Findings,
  collectS3SecurityEvidence,
  fetchAccountPublicAccessBlock,
  wildcardMatch,
  unknownS3Evaluation,
  newS3EvaluationTally,
  addToS3EvaluationTally,
  formatS3EvaluationTally,
} from '../s3-security-evaluation';
import { ComplianceScannerService } from '../complianceScanner';
import { AWSResource, ComplianceIssue } from '../../types/aws-resources.types';

const BUCKET = 'example-prod-backups';
const BUCKET_ARN = `arn:aws:s3:::${BUCKET}`;
const ALL_USERS = 'http://acs.amazonaws.com/groups/global/AllUsers';
const AUTHENTICATED_USERS = 'http://acs.amazonaws.com/groups/global/AuthenticatedUsers';

const ALL_BLOCKED = {
  BlockPublicAcls: true,
  IgnorePublicAcls: true,
  BlockPublicPolicy: true,
  RestrictPublicBuckets: true,
};
const NONE_BLOCKED = {
  BlockPublicAcls: false,
  IgnorePublicAcls: false,
  BlockPublicPolicy: false,
  RestrictPublicBuckets: false,
};

const OWNER_CONFIRMED_POLICY = {
  Version: '2012-10-17',
  Statement: [
    {
      Sid: 'DenyInsecureTransport',
      Effect: 'Deny',
      Principal: '*',
      Action: 's3:*',
      Resource: [BUCKET_ARN, `${BUCKET_ARN}/*`],
      Condition: { Bool: { 'aws:SecureTransport': 'false' } },
    },
    {
      Sid: 'DenyNonKMSPutObject',
      Effect: 'Deny',
      Principal: '*',
      Action: 's3:PutObject',
      Resource: `${BUCKET_ARN}/*`,
      Condition: { StringNotEquals: { 's3:x-amz-server-side-encryption': 'aws:kms' } },
    },
  ],
};

const OWNER_ONLY_ACL: Grant[] = [
  { Grantee: { Type: 'CanonicalUser', ID: 'owner-canonical-id' }, Permission: 'FULL_CONTROL' },
];

function evidence(overrides: Partial<S3SecurityEvidence> = {}): S3SecurityEvidence {
  return {
    bucketName: BUCKET,
    policy: { state: 'present', value: JSON.stringify(OWNER_CONFIRMED_POLICY) },
    policyIsPublic: { state: 'present', value: false },
    bucketPublicAccessBlock: { state: 'present', value: ALL_BLOCKED },
    accountPublicAccessBlock: { state: 'absent' },
    objectOwnership: { state: 'present', value: 'BucketOwnerEnforced' },
    aclGrants: { state: 'present', value: OWNER_ONLY_ACL },
    ...overrides,
  };
}

/** A bucket with no protections at all, so only the control under test decides. */
function unprotected(overrides: Partial<S3SecurityEvidence> = {}): S3SecurityEvidence {
  return evidence({
    bucketPublicAccessBlock: { state: 'absent' },
    accountPublicAccessBlock: { state: 'absent' },
    objectOwnership: { state: 'present', value: 'ObjectWriter' },
    ...overrides,
  });
}

function policyWith(statements: object[]): S3SecurityEvidence['policy'] {
  return { state: 'present', value: JSON.stringify({ Version: '2012-10-17', Statement: statements }) };
}

const denied = { state: 'unavailable', reason: 'AccessDenied' } as const;

describe('owner-confirmed protected bucket', () => {
  it('passes public access (policy and ACL) and HTTPS-only, and produces no finding', () => {
    const evaluation = evaluateS3Security(evidence());
    expect(evaluation.publicPolicy.status).toBe('pass');
    expect(evaluation.publicAcl.status).toBe('pass');
    expect(evaluation.httpsOnly.status).toBe('pass');
    expect(s3FindingsFromEvaluation(BUCKET_ARN, evaluation)).toEqual([]);
  });

  it('gives the same result for minified and pretty-printed policy JSON', () => {
    const pretty = evidence({ policy: { state: 'present', value: JSON.stringify(OWNER_CONFIRMED_POLICY, null, 2) } });
    expect(evaluateS3Security(pretty)).toEqual(evaluateS3Security(evidence()));
  });

  it('a Deny-only policy with a wildcard principal is not public exposure, even if policy status cannot be read', () => {
    const result = evaluatePublicPolicy(evidence({ policyIsPublic: denied, bucketPublicAccessBlock: { state: 'absent' } }));
    expect(result.status).toBe('unknown');
    expect(s3FindingsFromEvaluation(BUCKET_ARN, evaluateS3Security(
      evidence({ policyIsPublic: denied, bucketPublicAccessBlock: { state: 'absent' } })
    )).filter((i) => i.findingKey === S3_FINDING_KEYS.publicPolicy)).toEqual([]);
  });
});

describe('public access via bucket policy', () => {
  it('fails when AWS evaluates the policy as public and RestrictPublicBuckets is off at both levels', () => {
    const result = evaluatePublicPolicy(unprotected({ policyIsPublic: { state: 'present', value: true } }));
    expect(result.status).toBe('fail');
    const issues = s3FindingsFromEvaluation(BUCKET_ARN, evaluateS3Security(unprotected({ policyIsPublic: { state: 'present', value: true } })));
    const policyIssues = issues.filter((i) => i.findingKey === S3_FINDING_KEYS.publicPolicy);
    expect(policyIssues).toHaveLength(1);
    expect(policyIssues[0]).toMatchObject({ severity: 'critical', category: 'public_access', provenance: 'OBSERVED', issue: S3_FINDING_TEXTS.publicPolicy });
  });

  it('passes when bucket-level RestrictPublicBuckets is on', () => {
    expect(evaluatePublicPolicy(evidence({ policyIsPublic: { state: 'present', value: true } })).status).toBe('pass');
  });

  it('passes when only account-level RestrictPublicBuckets is on and the bucket setting is unreadable', () => {
    const result = evaluatePublicPolicy(unprotected({
      policyIsPublic: { state: 'present', value: true },
      bucketPublicAccessBlock: denied,
      accountPublicAccessBlock: { state: 'present', value: ALL_BLOCKED },
    }));
    expect(result.status).toBe('pass');
  });

  it('is unknown when the policy is public but Block Public Access cannot be read', () => {
    const result = evaluatePublicPolicy(unprotected({
      policyIsPublic: { state: 'present', value: true },
      accountPublicAccessBlock: denied,
    }));
    expect(result.status).toBe('unknown');
  });

  it('passes when the bucket has no policy', () => {
    expect(evaluatePublicPolicy(unprotected({ policy: { state: 'absent' }, policyIsPublic: { state: 'absent' } })).status).toBe('pass');
  });
});

describe('public access via ACL', () => {
  const publicRead = { state: 'present' as const, value: [{ Grantee: { Type: 'Group' as const, URI: ALL_USERS }, Permission: 'READ' as const }] };

  it('fails for an AllUsers READ grant when ACLs are enabled and not ignored', () => {
    const result = evaluatePublicAcl(unprotected({ aclGrants: publicRead }));
    expect(result.status).toBe('fail');
    const aclIssues = s3FindingsFromEvaluation(BUCKET_ARN, evaluateS3Security(unprotected({ aclGrants: publicRead })))
      .filter((i) => i.category === 'public_access');
    expect(aclIssues).toHaveLength(1);
    expect(aclIssues[0]).toMatchObject({ findingKey: S3_FINDING_KEYS.publicAcl, issue: S3_FINDING_TEXTS.publicAclRead, severity: 'critical' });
  });

  it('fails for an AuthenticatedUsers grant, with the non-read text for a write-only grant', () => {
    const grants = { state: 'present' as const, value: [{ Grantee: { Type: 'Group' as const, URI: AUTHENTICATED_USERS }, Permission: 'WRITE' as const }] };
    const evaluation = evaluateS3Security(unprotected({ aclGrants: grants }));
    expect(evaluation.publicAcl.status).toBe('fail');
    expect(s3FindingsFromEvaluation(BUCKET_ARN, evaluation).find((i) => i.findingKey === S3_FINDING_KEYS.publicAcl)?.issue)
      .toBe(S3_FINDING_TEXTS.publicAclOther);
  });

  it('treats a missing Object Ownership configuration as ACLs enabled', () => {
    expect(evaluatePublicAcl(unprotected({ aclGrants: publicRead, objectOwnership: { state: 'absent' } })).status).toBe('fail');
  });

  it('passes when ACLs are disabled (BucketOwnerEnforced), whatever the grants say', () => {
    expect(evaluatePublicAcl(unprotected({ aclGrants: publicRead, objectOwnership: { state: 'present', value: 'BucketOwnerEnforced' } })).status).toBe('pass');
  });

  it('passes when IgnorePublicAcls is on at bucket or account level', () => {
    expect(evaluatePublicAcl(unprotected({ aclGrants: publicRead, bucketPublicAccessBlock: { state: 'present', value: { ...NONE_BLOCKED, IgnorePublicAcls: true } } })).status).toBe('pass');
    expect(evaluatePublicAcl(unprotected({ aclGrants: publicRead, accountPublicAccessBlock: { state: 'present', value: { ...NONE_BLOCKED, IgnorePublicAcls: true } } })).status).toBe('pass');
  });

  it('passes when the ACL grants nothing to AllUsers or AuthenticatedUsers', () => {
    expect(evaluatePublicAcl(unprotected({ aclGrants: { state: 'present', value: OWNER_ONLY_ACL } })).status).toBe('pass');
  });

  it('is unknown when the ACL, ownership and Block Public Access are all unreadable', () => {
    const result = evaluatePublicAcl(unprotected({
      aclGrants: denied, objectOwnership: denied, bucketPublicAccessBlock: denied, accountPublicAccessBlock: denied,
    }));
    expect(result.status).toBe('unknown');
  });

  it('is unknown when a public grant exists but ownership cannot be read', () => {
    expect(evaluatePublicAcl(unprotected({ aclGrants: publicRead, objectOwnership: denied })).status).toBe('unknown');
  });
});

describe('HTTPS-only enforcement', () => {
  const secureTransportDeny = (extra: object = {}) => ({
    Effect: 'Deny',
    Principal: '*',
    Action: 's3:*',
    Resource: [BUCKET_ARN, `${BUCKET_ARN}/*`],
    Condition: { Bool: { 'aws:SecureTransport': 'false' } },
    ...extra,
  });

  it('fails when the bucket has no policy (verified absent)', () => {
    const result = evaluateHttpsOnly(unprotected({ policy: { state: 'absent' } }));
    expect(result.status).toBe('fail');
    const issue = s3FindingsFromEvaluation(BUCKET_ARN, evaluateS3Security(unprotected({ policy: { state: 'absent' }, policyIsPublic: { state: 'absent' } })))
      .find((i) => i.findingKey === S3_FINDING_KEYS.httpsOnly);
    expect(issue).toMatchObject({ severity: 'high', category: 'encryption', provenance: 'OBSERVED', issue: 'S3 bucket does not enforce HTTPS-only access' });
  });

  it('fails when a readable policy has no SecureTransport deny', () => {
    const policy = policyWith([{ Effect: 'Allow', Principal: { AWS: 'arn:aws:iam::111122223333:root' }, Action: 's3:GetObject', Resource: `${BUCKET_ARN}/*` }]);
    expect(evaluateHttpsOnly(unprotected({ policy })).status).toBe('fail');
  });

  it('fails on partial coverage: a SecureTransport deny on s3:PutObject only', () => {
    const policy = policyWith([secureTransportDeny({ Action: 's3:PutObject', Resource: `${BUCKET_ARN}/*` })]);
    const result = evaluateHttpsOnly(unprotected({ policy }));
    expect(result.status).toBe('fail');
    expect(result.reason).toContain('s3:GetObject');
    expect(result.reason).toContain('s3:ListBucket');
  });

  it('fails on partial coverage: objects covered, bucket (ListBucket) not', () => {
    const policy = policyWith([secureTransportDeny({ Resource: `${BUCKET_ARN}/*` })]);
    const result = evaluateHttpsOnly(unprotected({ policy }));
    expect(result.status).toBe('fail');
    expect(result.reason).toBe('HTTPS-only deny does not cover: s3:ListBucket');
  });

  it('recognises "Principal": "*" (pretty-printed, so no raw-text matching is involved)', () => {
    const value = JSON.stringify({ Version: '2012-10-17', Statement: [secureTransportDeny({ Principal: '*' })] }, null, 2);
    expect(value).toContain('"Principal": "*"');
    expect(evaluateHttpsOnly(unprotected({ policy: { state: 'present', value } })).status).toBe('pass');
  });

  it('recognises "Principal": {"AWS": "*"} and {"AWS": ["*"]}', () => {
    expect(evaluateHttpsOnly(unprotected({ policy: policyWith([secureTransportDeny({ Principal: { AWS: '*' } })]) })).status).toBe('pass');
    expect(evaluateHttpsOnly(unprotected({ policy: policyWith([secureTransportDeny({ Principal: { AWS: ['*'] } })]) })).status).toBe('pass');
  });

  it('recognises Action "s3:*" as covering every required action (GetObject, PutObject, DeleteObject, ListBucket)', () => {
    const result = evaluateHttpsOnly(unprotected({ policy: policyWith([secureTransportDeny({ Action: 's3:*' })]) }));
    expect(result).toEqual({ key: S3_FINDING_KEYS.httpsOnly, status: 'pass', reason: 'Bucket policy denies requests where aws:SecureTransport is false' });
  });

  it('requires both the bucket ARN and bucket/*: bucket ARN alone fails on the object actions', () => {
    const result = evaluateHttpsOnly(unprotected({ policy: policyWith([secureTransportDeny({ Resource: BUCKET_ARN })]) }));
    expect(result.status).toBe('fail');
    expect(result.reason).toBe('HTTPS-only deny does not cover: s3:GetObject, s3:PutObject, s3:DeleteObject');
  });

  it('passes for BoolIfExists and for Resource/Action "*"', () => {
    expect(evaluateHttpsOnly(unprotected({ policy: policyWith([secureTransportDeny({ Condition: { BoolIfExists: { 'aws:SecureTransport': 'false' } } })]) })).status).toBe('pass');
    expect(evaluateHttpsOnly(unprotected({ policy: policyWith([secureTransportDeny({ Resource: '*', Action: '*' })]) })).status).toBe('pass');
  });

  it('is unknown for a SecureTransport deny in an unrecognised form (operator other than Bool/BoolIfExists)', () => {
    const policy = policyWith([secureTransportDeny({ Condition: { StringEquals: { 'aws:SecureTransport': 'false' } } })]);
    expect(evaluateHttpsOnly(unprotected({ policy })).status).toBe('unknown');
  });

  it('is unknown for a NotAction SecureTransport deny: it could cover any gap', () => {
    const policy = policyWith([{ ...secureTransportDeny(), Action: undefined, NotAction: 's3:GetBucketLocation' }]);
    expect(evaluateHttpsOnly(unprotected({ policy })).status).toBe('unknown');
  });

  it('is unknown when the only gap could be covered by an unevaluable statement', () => {
    const policy = policyWith([
      secureTransportDeny({ Resource: `${BUCKET_ARN}/*` }),
      secureTransportDeny({ Resource: BUCKET_ARN, Condition: { Bool: { 'aws:SecureTransport': 'false' }, IpAddress: { 'aws:SourceIp': '10.0.0.0/8' } } }),
    ]);
    expect(evaluateHttpsOnly(unprotected({ policy })).status).toBe('unknown');
  });

  it('fails when incompleteness is conclusive despite an unevaluable statement: nothing could cover ListBucket', () => {
    const policy = policyWith([
      secureTransportDeny({ Resource: `${BUCKET_ARN}/*`, Condition: { Bool: { 'aws:SecureTransport': 'false' }, IpAddress: { 'aws:SourceIp': '10.0.0.0/8' } } }),
    ]);
    const result = evaluateHttpsOnly(unprotected({ policy }));
    expect(result.status).toBe('fail');
    expect(result.reason).toBe('HTTPS-only deny does not cover: s3:ListBucket');
  });

  it('passes when the coverage is split across two qualifying statements', () => {
    const policy = policyWith([
      secureTransportDeny({ Action: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'], Resource: `${BUCKET_ARN}/*` }),
      secureTransportDeny({ Action: 's3:ListBucket', Resource: BUCKET_ARN }),
    ]);
    expect(evaluateHttpsOnly(unprotected({ policy })).status).toBe('pass');
  });

  it('a deny for one named principal does not enforce HTTPS-only for everyone', () => {
    const policy = policyWith([secureTransportDeny({ Principal: { AWS: 'arn:aws:iam::111122223333:root' } })]);
    expect(evaluateHttpsOnly(unprotected({ policy })).status).toBe('fail');
  });

  it('does not count an Allow on aws:SecureTransport=true as enforcement', () => {
    const policy = policyWith([{ Effect: 'Allow', Principal: '*', Action: 's3:GetObject', Resource: `${BUCKET_ARN}/*`, Condition: { Bool: { 'aws:SecureTransport': 'true' } } }]);
    expect(evaluateHttpsOnly(unprotected({ policy })).status).toBe('fail');
  });

  it('is unknown for a SecureTransport deny it cannot evaluate (extra condition, NotPrincipal)', () => {
    const extraCondition = policyWith([secureTransportDeny({ Condition: { Bool: { 'aws:SecureTransport': 'false' }, StringNotEquals: { 'aws:SourceVpce': 'vpce-1' } } })]);
    expect(evaluateHttpsOnly(unprotected({ policy: extraCondition })).status).toBe('unknown');
    const notPrincipal = policyWith([{ ...secureTransportDeny(), Principal: undefined, NotPrincipal: { AWS: 'arn:aws:iam::111122223333:root' } }]);
    expect(evaluateHttpsOnly(unprotected({ policy: notPrincipal })).status).toBe('unknown');
  });

  it('is unknown, never fail, when the policy is denied, unavailable or malformed', () => {
    for (const policy of [denied, { state: 'unavailable', reason: 'SlowDown' } as const, { state: 'present', value: '{not json' } as const]) {
      const evaluation = evaluateS3Security(evidence({ policy }));
      expect(evaluation.httpsOnly.status).toBe('unknown');
      expect(s3FindingsFromEvaluation(BUCKET_ARN, evaluation).filter((i) => i.findingKey === S3_FINDING_KEYS.httpsOnly)).toEqual([]);
    }
  });
});

describe('evidence collection (mocked AWS)', () => {
  const awsError = (name: string) => Object.assign(new Error(name), { name });

  function s3Mock(responses: Record<string, () => unknown>): S3Client {
    return {
      send: jest.fn(async (command: { constructor: { name: string } }) => {
        const respond = responses[command.constructor.name];
        if (!respond) throw awsError('AccessDenied');
        return respond();
      }),
    } as unknown as S3Client;
  }

  it('maps the protected bucket\'s AWS responses to pass on every control', async () => {
    const s3 = s3Mock({
      GetBucketPolicyCommand: () => ({ Policy: JSON.stringify(OWNER_CONFIRMED_POLICY) }),
      GetBucketPolicyStatusCommand: () => ({ PolicyStatus: { IsPublic: false } }),
      GetPublicAccessBlockCommand: () => ({ PublicAccessBlockConfiguration: ALL_BLOCKED }),
      GetBucketOwnershipControlsCommand: () => ({ OwnershipControls: { Rules: [{ ObjectOwnership: 'BucketOwnerEnforced' }] } }),
      GetBucketAclCommand: () => ({ Grants: OWNER_ONLY_ACL }),
    });
    const s3Control = { send: jest.fn().mockRejectedValue(awsError('NoSuchPublicAccessBlockConfiguration')) } as unknown as S3ControlClient;

    const account = await fetchAccountPublicAccessBlock(s3Control, '111122223333');
    const collected = await collectS3SecurityEvidence(BUCKET, s3, account);
    expect(collected.accountPublicAccessBlock).toEqual({ state: 'absent' });
    const evaluation = evaluateS3Security(collected);
    expect([evaluation.publicPolicy.status, evaluation.publicAcl.status, evaluation.httpsOnly.status]).toEqual(['pass', 'pass', 'pass']);
  });

  it('turns AccessDenied on every call into unknown on every control, never a finding', async () => {
    const s3 = s3Mock({});
    const s3Control = { send: jest.fn().mockRejectedValue(awsError('AccessDenied')) } as unknown as S3ControlClient;
    const account = await fetchAccountPublicAccessBlock(s3Control, '111122223333');
    const evaluation = evaluateS3Security(await collectS3SecurityEvidence(BUCKET, s3, account));
    expect([evaluation.publicPolicy.status, evaluation.publicAcl.status, evaluation.httpsOnly.status]).toEqual(['unknown', 'unknown', 'unknown']);
    expect(s3FindingsFromEvaluation(BUCKET_ARN, evaluation)).toEqual([]);
  });

  it('records the account-level lookup as unavailable when no S3 Control client or account id is given', async () => {
    expect((await fetchAccountPublicAccessBlock()).state).toBe('unavailable');
    expect((await fetchAccountPublicAccessBlock({ send: jest.fn() } as unknown as S3ControlClient)).state).toBe('unavailable');
  });

  it('maps the AWS "not configured" errors to absent', async () => {
    const s3 = s3Mock({
      GetBucketPolicyCommand: () => { throw awsError('NoSuchBucketPolicy'); },
      GetBucketPolicyStatusCommand: () => { throw awsError('NoSuchBucketPolicy'); },
      GetPublicAccessBlockCommand: () => { throw awsError('NoSuchPublicAccessBlockConfiguration'); },
      GetBucketOwnershipControlsCommand: () => { throw awsError('OwnershipControlsNotFoundError'); },
      GetBucketAclCommand: () => ({ Grants: OWNER_ONLY_ACL }),
    });
    const collected = await collectS3SecurityEvidence(BUCKET, s3, { state: 'absent' });
    expect(collected.policy).toEqual({ state: 'absent' });
    expect(collected.policyIsPublic).toEqual({ state: 'absent' });
    expect(collected.bucketPublicAccessBlock).toEqual({ state: 'absent' });
    expect(collected.objectOwnership).toEqual({ state: 'absent' });
  });
});

describe('wildcard matching (no RegExp from policy text)', () => {
  const bucketArn = 'arn:aws:s3:::' + 'a'.repeat(27); // 40 characters

  it('follows IAM semantics for * and ?', () => {
    expect(wildcardMatch('arn:aws:s3:::my-*', 'arn:aws:s3:::my-bucket', false)).toBe(true);
    expect(wildcardMatch('arn:aws:s3:::my-?ucket', 'arn:aws:s3:::my-bucket', false)).toBe(true);
    expect(wildcardMatch('arn:aws:s3:::my-?', 'arn:aws:s3:::my-', false)).toBe(false);
    expect(wildcardMatch('*', '', false)).toBe(true);
    expect(wildcardMatch('S3:GET*', 's3:GetObject', true)).toBe(true);
    expect(wildcardMatch('S3:GET*', 's3:GetObject', false)).toBe(false);
    expect(wildcardMatch('arn:aws:s3:::b.c', 'arn:aws:s3:::bxc', false)).toBe(false); // '.' is literal
  });

  it('long wildcard patterns complete in < 250 ms, both matching and mismatching', () => {
    expect(bucketArn).toHaveLength(40);
    // 'a*' x 50 needs at least 50 'a's, more than the 27-character bucket name has, so a
    // backtracking RegExp rejects these quickly too. These cases check correctness and a
    // loose time bound; the backtracking regression is pinned by the test below.
    const pathological = 'arn:aws:s3:::' + 'a*'.repeat(50) + '/*';
    const mismatching = 'arn:aws:s3:::' + 'a*'.repeat(50) + 'zz';
    const matching = 'arn:aws:s3:::' + 'a*'.repeat(20) + '/*';

    const started = Date.now();
    expect(wildcardMatch(pathological, `${bucketArn}/`, false)).toBe(false);
    expect(wildcardMatch(pathological, bucketArn, false)).toBe(false); // bucket-ARN mismatch case
    expect(wildcardMatch(mismatching, bucketArn, false)).toBe(false);
    expect(wildcardMatch(matching, `${bucketArn}/`, false)).toBe(true);
    expect(wildcardMatch(matching, bucketArn, false)).toBe(false); // bucket-ARN mismatch case
    expect(Date.now() - started).toBeLessThan(250);
  });

  it('a bucket policy built from such patterns evaluates in < 250 ms', () => {
    const policy = policyWith([{
      Effect: 'Deny', Principal: '*', Action: 's3:*',
      Resource: ['arn:aws:s3:::' + 'a*'.repeat(20) + '/*', 'arn:aws:s3:::' + 'a*'.repeat(50) + 'zz', 'arn:aws:s3:::' + 'a*'.repeat(50) + '/*'],
      Condition: { Bool: { 'aws:SecureTransport': 'false' } },
    }]);
    const started = Date.now();
    const result = evaluateHttpsOnly({ ...unprotected({ policy }), bucketName: 'a'.repeat(27) });
    expect(Date.now() - started).toBeLessThan(250);
    expect(result).toMatchObject({ status: 'fail', reason: 'HTTPS-only deny does not cover: s3:ListBucket' });
  });

  it('a backtracking-prone bucket policy evaluates in < 250 ms (ReDoS regression)', () => {
    // The bucket name has more 'a's than each pattern requires, so a backtracking
    // RegExp explores every way to split the name between the wildcards before the
    // trailing 'zz' fails. Against the former RegExp matcher: 'a*' x 9 took ~2.6 s and
    // 'a*' x 12 did not finish within 30 s. The x9 case runs first so a regression
    // fails in seconds: Jest's timeout cannot interrupt a synchronous loop, so the
    // x12 case alone would hang rather than fail.
    const bucketName = 'a'.repeat(40);
    for (const stars of [9, 12]) {
      const policy = policyWith([{
        Effect: 'Deny', Principal: '*', Action: 's3:*',
        Resource: ['arn:aws:s3:::' + 'a*'.repeat(stars) + 'zz'],
        Condition: { Bool: { 'aws:SecureTransport': 'false' } },
      }]);
      const started = Date.now();
      const result = evaluateHttpsOnly({ ...unprotected({ policy }), bucketName });
      expect(Date.now() - started).toBeLessThan(250);
      expect(result.status).toBe('fail');
    }
  }, 5000);
});

describe('carry-forward of previous findings when a control is unknown', () => {
  const keyedPolicyFinding: ComplianceIssue = {
    severity: 'critical', category: 'public_access', issue: S3_FINDING_TEXTS.publicPolicy, recommendation: 'r',
    resource_arn: BUCKET_ARN, provenance: 'OBSERVED', findingKey: S3_FINDING_KEYS.publicPolicy,
  };
  const keyedHttpsFinding: ComplianceIssue = {
    severity: 'high', category: 'encryption', issue: S3_FINDING_TEXTS.httpsOnly, recommendation: 'r',
    resource_arn: BUCKET_ARN, provenance: 'OBSERVED', findingKey: S3_FINDING_KEYS.httpsOnly,
  };
  const legacyWildcard: ComplianceIssue = {
    severity: 'critical', category: 'public_access', issue: 'S3 bucket policy allows public access (wildcard principal)', recommendation: 'r',
  };
  const legacyTransit: ComplianceIssue = {
    severity: 'critical', category: 'encryption', issue: 'HIPAA: S3 must have encryption in transit for PHI data', recommendation: 'r',
  };
  const legacyAcl: ComplianceIssue = {
    severity: 'critical', category: 'public_access', issue: 'S3 bucket ACL allows public read access', recommendation: 'r', provenance: 'OBSERVED',
  };

  it('keeps a keyed finding, marked unverified, when its control is unknown', () => {
    const carried = carryForwardUnverifiedS3Findings([keyedPolicyFinding, keyedHttpsFinding], unknownS3Evaluation('AccessDenied'));
    expect(carried).toHaveLength(2);
    for (const issue of carried) expect(issue.verification).toBe('unverified');
    expect(carried.map((i) => i.findingKey).sort()).toEqual([S3_FINDING_KEYS.publicPolicy, S3_FINDING_KEYS.httpsOnly].sort());
  });

  it('carries nothing for a control that passed: the finding leaves the next snapshot', () => {
    const passing = evaluateS3Security(evidence());
    expect(carryForwardUnverifiedS3Findings([keyedPolicyFinding, keyedHttpsFinding], passing)).toEqual([]);
  });

  it('carries the legacy wildcard-policy finding under the policy key, unverified, when the policy control is unknown', () => {
    expect(carryForwardUnverifiedS3Findings([legacyWildcard], unknownS3Evaluation('AccessDenied'))).toEqual([
      { ...legacyWildcard, findingKey: S3_FINDING_KEYS.publicPolicy, verification: 'unverified' },
    ]);
  });

  it('a verified pass clears the legacy wildcard-policy finding', () => {
    expect(carryForwardUnverifiedS3Findings([legacyWildcard], evaluateS3Security(evidence()))).toEqual([]);
  });

  it('drops the legacy tag-only HIPAA transit text even when HTTPS-only is unknown (approved decision)', () => {
    expect(carryForwardUnverifiedS3Findings([legacyTransit], unknownS3Evaluation('AccessDenied'))).toEqual([]);
  });

  it('skips null and non-object entries instead of throwing', () => {
    const previous = [null, undefined, 'text', 42, [keyedPolicyFinding], keyedPolicyFinding];
    expect(() => carryForwardUnverifiedS3Findings(previous, unknownS3Evaluation('x'))).not.toThrow();
    expect(carryForwardUnverifiedS3Findings(previous, unknownS3Evaluation('x'))).toEqual([{ ...keyedPolicyFinding, verification: 'unverified' }]);
    expect(carryForwardUnverifiedS3Findings({ not: 'an array' }, unknownS3Evaluation('x'))).toEqual([]);
  });

  it('carries a legacy ACL finding under the ACL key when the ACL control is unknown', () => {
    const carried = carryForwardUnverifiedS3Findings([legacyAcl], unknownS3Evaluation('AccessDenied'));
    expect(carried).toEqual([{ ...legacyAcl, findingKey: S3_FINDING_KEYS.publicAcl, verification: 'unverified' }]);
  });

  it('a carried finding stays unverified across repeated unknown scans, without duplicates', () => {
    const once = carryForwardUnverifiedS3Findings([keyedPolicyFinding], unknownS3Evaluation('x'));
    const twice = carryForwardUnverifiedS3Findings([...once, ...once], unknownS3Evaluation('x'));
    expect(twice).toHaveLength(1);
    expect(twice[0].verification).toBe('unverified');
  });
});

describe('scanner integration: ComplianceScannerService.evaluateS3Security', () => {
  const service = new ComplianceScannerService();

  function bucketResource(previous: ComplianceIssue[]): AWSResource {
    return {
      id: 'id-1', organization_id: 'org-1', resource_arn: BUCKET_ARN, resource_id: BUCKET, resource_name: BUCKET,
      resource_type: 's3', region: 'us-east-1', tags: {}, metadata: {}, status: 'active',
      estimated_monthly_cost: 0, actual_monthly_cost: 0, is_encrypted: true, is_public: false, has_backup: null,
      compliance_issues: previous, is_orphaned: false, orphaned_monthly_savings: 0,
      last_synced_at: new Date(), first_discovered_at: new Date(), created_at: new Date(), updated_at: new Date(),
    } as AWSResource;
  }

  const protectedS3 = {
    send: jest.fn(async (command: { constructor: { name: string } }) => {
      switch (command.constructor.name) {
        case 'GetBucketPolicyCommand': return { Policy: JSON.stringify(OWNER_CONFIRMED_POLICY) };
        case 'GetBucketPolicyStatusCommand': return { PolicyStatus: { IsPublic: false } };
        case 'GetPublicAccessBlockCommand': return { PublicAccessBlockConfiguration: ALL_BLOCKED };
        case 'GetBucketOwnershipControlsCommand': return { OwnershipControls: { Rules: [{ ObjectOwnership: 'BucketOwnerEnforced' }] } };
        default: return { Grants: OWNER_ONLY_ACL };
      }
    }),
  } as unknown as S3Client;

  it('a verified re-scan of the protected bucket clears both legacy false positives', async () => {
    const legacy: ComplianceIssue[] = [
      { severity: 'critical', category: 'public_access', issue: 'S3 bucket policy allows public access (wildcard principal)', recommendation: 'r', provenance: 'OBSERVED' },
      { severity: 'critical', category: 'encryption', issue: 'HIPAA: S3 must have encryption in transit for PHI data', recommendation: 'r' },
    ];
    const result = await service.evaluateS3Security(bucketResource(legacy), protectedS3);
    expect(result!.issues).toEqual([]);
  });

  it('a scan that cannot read anything keeps the previous keyed finding as unverified', async () => {
    const previous: ComplianceIssue[] = [{
      severity: 'critical', category: 'public_access', issue: S3_FINDING_TEXTS.publicPolicy, recommendation: 'r',
      resource_arn: BUCKET_ARN, provenance: 'OBSERVED', findingKey: S3_FINDING_KEYS.publicPolicy,
    }];
    const deniedS3 = { send: jest.fn().mockRejectedValue(Object.assign(new Error('AccessDenied'), { name: 'AccessDenied' })) } as unknown as S3Client;
    const result = await service.evaluateS3Security(bucketResource(previous), deniedS3);
    expect(result!.issues).toEqual([{ ...previous[0], verification: 'unverified' }]);
  });

  describe('end to end through mocked AWS collection', () => {
    const awsError = (name: string) => Object.assign(new Error(name), { name });
    const deniedAccount = { send: jest.fn().mockRejectedValue(awsError('AccessDenied')) };
    const routed = (responses: Record<string, () => unknown>) => ({
      send: jest.fn(async (command: { constructor: { name: string } }) => {
        const respond = responses[command.constructor.name];
        if (!respond) throw awsError('AccessDenied');
        return respond();
      }),
    }) as unknown as S3Client;

    it('bucket-level Block Public Access fully on + account-level lookup denied -> pass, no finding', async () => {
      const publicAllow = JSON.stringify({ Statement: [{ Effect: 'Allow', Principal: '*', Action: 's3:GetObject', Resource: `${BUCKET_ARN}/*` }] });
      const s3 = routed({
        GetBucketPolicyCommand: () => ({ Policy: publicAllow }),
        GetBucketPolicyStatusCommand: () => ({ PolicyStatus: { IsPublic: true } }),
        GetPublicAccessBlockCommand: () => ({ PublicAccessBlockConfiguration: ALL_BLOCKED }),
        GetBucketOwnershipControlsCommand: () => ({ OwnershipControls: { Rules: [{ ObjectOwnership: 'ObjectWriter' }] } }),
        GetBucketAclCommand: () => ({ Grants: [{ Grantee: { Type: 'Group', URI: ALL_USERS }, Permission: 'READ' }] }),
      });
      const result = await new ComplianceScannerService().evaluateS3Security(bucketResource([]), s3, {
        s3Control: deniedAccount as any, accountId: '111122223333',
      });
      expect(result!.evaluation.publicPolicy.status).toBe('pass');
      expect(result!.evaluation.publicAcl.status).toBe('pass');
      expect(result!.issues.filter((i) => i.category === 'public_access')).toEqual([]);
    });

    it('a genuinely public bucket (public policy and public ACL, no Block Public Access anywhere) -> critical findings', async () => {
      const publicAllow = JSON.stringify({ Statement: [{ Effect: 'Allow', Principal: '*', Action: 's3:GetObject', Resource: `${BUCKET_ARN}/*` }] });
      const s3 = routed({
        GetBucketPolicyCommand: () => ({ Policy: publicAllow }),
        GetBucketPolicyStatusCommand: () => ({ PolicyStatus: { IsPublic: true } }),
        GetPublicAccessBlockCommand: () => { throw awsError('NoSuchPublicAccessBlockConfiguration'); },
        GetBucketOwnershipControlsCommand: () => { throw awsError('OwnershipControlsNotFoundError'); },
        GetBucketAclCommand: () => ({ Grants: [{ Grantee: { Type: 'Group', URI: ALL_USERS }, Permission: 'READ' }] }),
      });
      const s3Control = { send: jest.fn().mockRejectedValue(awsError('NoSuchPublicAccessBlockConfiguration')) };
      const result = await new ComplianceScannerService().evaluateS3Security(bucketResource([]), s3, {
        s3Control: s3Control as any, accountId: '111122223333',
      });

      const publicFindings = result!.issues.filter((i) => i.category === 'public_access');
      expect(publicFindings.map((i) => i.findingKey).sort()).toEqual([S3_FINDING_KEYS.publicAcl, S3_FINDING_KEYS.publicPolicy]);
      for (const finding of publicFindings) {
        expect(finding).toMatchObject({ severity: 'critical', provenance: 'OBSERVED', resource_arn: BUCKET_ARN });
        expect(finding.verification).toBeUndefined();
      }
      expect(result!.issues.find((i) => i.findingKey === S3_FINDING_KEYS.httpsOnly)).toMatchObject({ severity: 'high' });
    });
  });

  describe('account-level Block Public Access is fetched once per scan', () => {
    const awsError = (name: string) => Object.assign(new Error(name), { name });
    const bucket = (n: number) => ({ ...bucketResource([]), id: `id-${n}`, resource_id: `bucket-${n}`, resource_arn: `arn:aws:s3:::bucket-${n}` });

    it('one S3 Control call for five buckets in the same scan', async () => {
      const scanner = new ComplianceScannerService();
      const s3Control = { send: jest.fn().mockResolvedValue({ PublicAccessBlockConfiguration: ALL_BLOCKED }) };
      const results = await Promise.all(
        [1, 2, 3, 4, 5].map((n) => scanner.evaluateS3Security(bucket(n), protectedS3, { s3Control: s3Control as any, accountId: '111122223333' }))
      );
      expect(s3Control.send).toHaveBeenCalledTimes(1);
      for (const r of results) expect(r!.evaluation.publicPolicy.status).toBe('pass');
    });

    it('a failed lookup is fetched once and leaves every bucket unknown, never failed', async () => {
      const scanner = new ComplianceScannerService();
      const s3Control = { send: jest.fn().mockRejectedValue(awsError('AccessDenied')) };
      // Policy evaluated as public, bucket-level Block Public Access unreadable: only the
      // account-level setting could decide, and it is unavailable.
      const publicPolicyS3 = {
        send: jest.fn(async (command: { constructor: { name: string } }) => {
          switch (command.constructor.name) {
            case 'GetBucketPolicyCommand': return { Policy: JSON.stringify(OWNER_CONFIRMED_POLICY) };
            case 'GetBucketPolicyStatusCommand': return { PolicyStatus: { IsPublic: true } };
            case 'GetBucketOwnershipControlsCommand': return { OwnershipControls: { Rules: [{ ObjectOwnership: 'BucketOwnerEnforced' }] } };
            case 'GetBucketAclCommand': return { Grants: OWNER_ONLY_ACL };
            default: throw awsError('AccessDenied');
          }
        }),
      } as unknown as S3Client;

      const results = [];
      for (const n of [1, 2, 3]) {
        results.push(await scanner.evaluateS3Security(bucket(n), publicPolicyS3, { s3Control: s3Control as any, accountId: '111122223333' }));
      }
      expect(s3Control.send).toHaveBeenCalledTimes(1);
      for (const r of results) {
        expect(r!.evaluation.publicPolicy.status).toBe('unknown');
        expect(r!.issues.filter((i) => i.findingKey === S3_FINDING_KEYS.publicPolicy)).toEqual([]);
      }
    });

    it('a new scan (a new scanner) fetches again', async () => {
      const s3Control = { send: jest.fn().mockResolvedValue({ PublicAccessBlockConfiguration: ALL_BLOCKED }) };
      const options = { s3Control: s3Control as any, accountId: '111122223333' };
      await new ComplianceScannerService().evaluateS3Security(bucket(1), protectedS3, options);
      await new ComplianceScannerService().evaluateS3Security(bucket(2), protectedS3, options);
      expect(s3Control.send).toHaveBeenCalledTimes(2);
    });
  });

  it('scanResource no longer emits the tag-based HIPAA S3 transit finding or a generic S3 public finding', async () => {
    const issues = await service.scanResource({ ...bucketResource([]), is_public: true });
    expect(issues.find((i) => i.issue.includes('encryption in transit'))).toBeUndefined();
    expect(issues.find((i) => i.category === 'public_access')).toBeUndefined();
  });

  it('scanResource still emits the tag-based HIPAA transit finding for RDS (out of scope, unchanged)', async () => {
    const issues = await service.scanResource({ ...bucketResource([]), resource_type: 'rds' });
    expect(issues.find((i) => i.issue === 'HIPAA: RDS must have encryption in transit for PHI data')).toBeDefined();
  });
});

describe('per-scan counts', () => {
  it('counts pass/fail/unknown per control across buckets', () => {
    const tally = newS3EvaluationTally();
    addToS3EvaluationTally(tally, evaluateS3Security(evidence()));
    addToS3EvaluationTally(tally, unknownS3Evaluation('AccessDenied'));
    addToS3EvaluationTally(tally, evaluateS3Security(unprotected({ policy: { state: 'absent' }, policyIsPublic: { state: 'absent' } })));

    expect(tally.buckets).toBe(3);
    expect(tally[S3_FINDING_KEYS.httpsOnly]).toEqual({ pass: 1, fail: 1, unknown: 1 });
    expect(tally[S3_FINDING_KEYS.publicPolicy]).toEqual({ pass: 2, fail: 0, unknown: 1 });
    expect(formatS3EvaluationTally(tally)).toBe(
      '3 bucket(s); s3.public_access.policy pass=2 fail=0 unknown=1; s3.public_access.acl pass=2 fail=0 unknown=1; s3.https_only pass=1 fail=1 unknown=1; account_bpa_unavailable_public_policy=0'
    );
  });

  it('counts "policy public, account-level Block Public Access unreadable" separately', () => {
    const lostDetection = unprotected({ policyIsPublic: { state: 'present', value: true }, accountPublicAccessBlock: denied });
    const result = evaluatePublicPolicy(lostDetection);
    expect(result).toMatchObject({ status: 'unknown', reasonCode: 'account_bpa_unavailable_public_policy' });

    const tally = newS3EvaluationTally();
    addToS3EvaluationTally(tally, evaluateS3Security(lostDetection));
    addToS3EvaluationTally(tally, unknownS3Evaluation('AccessDenied'));
    expect(tally.reasons.account_bpa_unavailable_public_policy).toBe(1);
    expect(formatS3EvaluationTally(tally)).toContain('account_bpa_unavailable_public_policy=1');
  });

  it('a bucket-level read failure on a public policy is unknown without that reason code', () => {
    const result = evaluatePublicPolicy(unprotected({
      policyIsPublic: { state: 'present', value: true },
      bucketPublicAccessBlock: denied,
    }));
    expect(result.status).toBe('unknown');
    expect(result.reasonCode).toBeUndefined();
  });
});
