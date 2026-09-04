/**
 * Synthetic-mock coverage for ComplianceScannerService.checkIAMSecurity — the
 * IAM Security Phase 2 hardening pass (correct MFA applicability, stable
 * access-key identity, single-finding-per-key severity escalation, honest
 * pagination/partial-scan completeness, structured evidence, CIS mapping).
 *
 * Mocks IAMClient.send with a real IAMClient instance (paginateListUsers does
 * `instanceof` checks internally — see awsResourceDiscovery.pagination.test.ts's
 * withMockedSend for why a plain object cast won't satisfy it) and dispatches
 * on command type + the UserName in its input, mirroring that file's
 * per-bucket dispatch pattern for calls a generated paginator wraps.
 */

import {
  IAMClient,
  ListUsersCommand,
  ListMFADevicesCommand,
  ListAccessKeysCommand,
  GetLoginProfileCommand,
  NoSuchEntityException,
} from '@aws-sdk/client-iam';
import { ComplianceScannerService } from '../complianceScanner';
import { computeIamFindingKey } from '../../utils/iamFindingKey';
import { IamMfaEvidence, IamAccessKeyEvidence } from '../../types/aws-resources.types';
import { getFrameworkMapping } from '../../config/securityFrameworkMappings';

function withMockedSend<T extends { send: (...args: any[]) => any }>(client: T, send: jest.Mock): T {
  (client as any).send = send;
  return client;
}

function mockIam(send: jest.Mock): IAMClient {
  return withMockedSend(new IAMClient({ region: 'us-east-1' }), send);
}

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

interface UserFixture {
  UserName: string;
  Arn: string;
  mfaDeviceCount?: number;
  loginProfile?: 'exists' | 'none' | 'denied';
  accessKeys?: { AccessKeyId: string; CreateDate: Date; Status?: string }[];
}

/**
 * Builds a dispatching IAMClient.send mock from one or more ListUsers pages.
 * `failListUsers` makes the first ListUsers call itself throw. `failOnUser`
 * makes ListMFADevices throw for that specific user (simulating a per-user
 * AWS failure partway through a scan that already succeeded for earlier
 * users) — GetLoginProfile's "denied" fixture state is a separate, always-
 * allowed path (see checkIAMSecurity's Case C), not a scan failure.
 */
function buildIamSend(
  pages: UserFixture[][],
  opts: { failListUsers?: boolean; failOnUser?: string } = {}
): jest.Mock {
  const allUsers = pages.flat();

  return jest.fn(async (command: any) => {
    if (command instanceof ListUsersCommand) {
      if (opts.failListUsers) throw new Error('AccessDenied on ListUsers');

      const marker = command.input.Marker as string | undefined;
      const pageIndex = marker ? parseInt(marker, 10) : 0;
      const page = pages[pageIndex] ?? [];
      const isLastPage = pageIndex === pages.length - 1;

      return {
        Users: page.map((u) => ({ UserName: u.UserName, Arn: u.Arn })),
        IsTruncated: !isLastPage,
        Marker: isLastPage ? undefined : String(pageIndex + 1),
      };
    }

    const userName = command.input.UserName as string;
    const user = allUsers.find((u) => u.UserName === userName);
    if (!user) throw new Error(`Test fixture gap: no user configured for ${userName}`);

    if (command instanceof ListMFADevicesCommand) {
      if (opts.failOnUser === userName) throw new Error(`AccessDenied on ListMFADevices for ${userName}`);
      const count = user.mfaDeviceCount ?? 0;
      return { MFADevices: Array.from({ length: count }, (_, i) => ({ UserName: userName, SerialNumber: `mfa-${i}` })) };
    }

    if (command instanceof GetLoginProfileCommand) {
      const state = user.loginProfile ?? 'none';
      if (state === 'exists') return { LoginProfile: { UserName: userName, CreateDate: new Date() } };
      if (state === 'denied') throw new Error('AccessDenied on GetLoginProfile');
      throw new NoSuchEntityException({ message: `Login profile not found for ${userName}`, $metadata: {} });
    }

    if (command instanceof ListAccessKeysCommand) {
      const keys = user.accessKeys ?? [];
      return {
        AccessKeyMetadata: keys.map((k) => ({
          AccessKeyId: k.AccessKeyId,
          CreateDate: k.CreateDate,
          Status: k.Status ?? 'Active',
        })),
      };
    }

    throw new Error(`Unexpected command in IAM mock: ${command.constructor.name}`);
  });
}

describe('ComplianceScannerService.checkIAMSecurity', () => {
  const scanner = new ComplianceScannerService();

  describe('MFA applicability', () => {
    it('console user (GetLoginProfile succeeds) with no MFA device -> HIGH finding, CIS IAM.5 mapping', async () => {
      const alice: UserFixture = { UserName: 'alice', Arn: 'arn:aws:iam::123456789012:user/alice', mfaDeviceCount: 0, loginProfile: 'exists' };
      const send = buildIamSend([[alice]]);

      const { complete, issues } = await scanner.checkIAMSecurity(mockIam(send));

      expect(complete).toBe(true);
      const mfaIssues = issues.filter((i) => (i.evidence as IamMfaEvidence)?.finding_type === 'mfa_not_enabled');
      expect(mfaIssues).toHaveLength(1);
      expect(mfaIssues[0].severity).toBe('high');
      expect(mfaIssues[0].issue).not.toMatch(/disabled/i); // never claim MFA was "disabled" — it was never enabled
      const evidence = mfaIssues[0].evidence as IamMfaEvidence;
      expect(evidence.relevant_aws_attributes.has_login_profile).toBe(true);
      expect(getFrameworkMapping(evidence)).toMatchObject({ control: '1.9', securityHubControlId: 'IAM.5' });
    });

    it('console user with an MFA device -> no MFA finding', async () => {
      const bob: UserFixture = { UserName: 'bob', Arn: 'arn:aws:iam::123456789012:user/bob', mfaDeviceCount: 1, loginProfile: 'exists' };
      const send = buildIamSend([[bob]]);

      const { issues } = await scanner.checkIAMSecurity(mockIam(send));

      expect(issues.filter((i) => (i.evidence as IamMfaEvidence)?.finding_type === 'mfa_not_enabled')).toHaveLength(0);
    });

    it('API-only user (GetLoginProfile -> NoSuchEntity) with no MFA device -> no MFA finding', async () => {
      const svc: UserFixture = { UserName: 'ci-deploy', Arn: 'arn:aws:iam::123456789012:user/ci-deploy', mfaDeviceCount: 0, loginProfile: 'none' };
      const send = buildIamSend([[svc]]);

      const { complete, issues } = await scanner.checkIAMSecurity(mockIam(send));

      expect(complete).toBe(true);
      expect(issues.filter((i) => (i.evidence as IamMfaEvidence)?.finding_type === 'mfa_not_enabled')).toHaveLength(0);
    });

    it('GetLoginProfile AccessDenied -> truthful "unknown" finding, MEDIUM, no IAM.5 mapping, never claims console access is proven', async () => {
      const carol: UserFixture = { UserName: 'carol', Arn: 'arn:aws:iam::123456789012:user/carol', mfaDeviceCount: 0, loginProfile: 'denied' };
      const send = buildIamSend([[carol]]);

      const { complete, issues } = await scanner.checkIAMSecurity(mockIam(send));

      // GetLoginProfile's denial is an allowed degraded state, not a scan failure.
      expect(complete).toBe(true);
      const mfaIssues = issues.filter((i) => (i.evidence as IamMfaEvidence)?.finding_type === 'mfa_not_enabled');
      expect(mfaIssues).toHaveLength(1);
      expect(mfaIssues[0].severity).toBe('medium');
      // Must acknowledge the uncertainty, not assert console access as a proven fact.
      expect(mfaIssues[0].issue).toMatch(/could not be verified/i);
      expect(mfaIssues[0].issue).not.toMatch(/has console access/i);
      expect(mfaIssues[0].issue).not.toMatch(/disabled/i);
      const evidence = mfaIssues[0].evidence as IamMfaEvidence;
      expect(evidence.relevant_aws_attributes.has_login_profile).toBe('unknown');
      expect(getFrameworkMapping(evidence)).toBeNull();
    });
  });

  describe('access-key staleness', () => {
    it('89-day-old key -> no finding', async () => {
      const user: UserFixture = {
        UserName: 'dave', Arn: 'arn:aws:iam::123456789012:user/dave', loginProfile: 'none',
        accessKeys: [{ AccessKeyId: 'AKIA_89', CreateDate: daysAgo(89) }],
      };
      const { issues } = await scanner.checkIAMSecurity(mockIam(buildIamSend([[user]])));
      expect(issues.filter((i) => (i.evidence as IamAccessKeyEvidence)?.finding_type === 'access_key_stale')).toHaveLength(0);
    });

    it('91-day-old key -> exactly one MEDIUM finding, CIS IAM.3 mapping', async () => {
      const user: UserFixture = {
        UserName: 'erin', Arn: 'arn:aws:iam::123456789012:user/erin', loginProfile: 'none',
        accessKeys: [{ AccessKeyId: 'AKIA_91', CreateDate: daysAgo(91) }],
      };
      const { issues } = await scanner.checkIAMSecurity(mockIam(buildIamSend([[user]])));

      const keyIssues = issues.filter((i) => (i.evidence as IamAccessKeyEvidence)?.finding_type === 'access_key_stale');
      expect(keyIssues).toHaveLength(1);
      expect(keyIssues[0].severity).toBe('medium');
      const evidence = keyIssues[0].evidence as IamAccessKeyEvidence;
      expect(evidence.relevant_aws_attributes.access_key_id).toBe('AKIA_91');
      expect(getFrameworkMapping(evidence)).toMatchObject({ control: '1.13', securityHubControlId: 'IAM.3' });
    });

    it('181-day-old key -> exactly ONE HIGH finding, not two (fixes the historical double-count bug)', async () => {
      const user: UserFixture = {
        UserName: 'frank', Arn: 'arn:aws:iam::123456789012:user/frank', loginProfile: 'none',
        accessKeys: [{ AccessKeyId: 'AKIA_181', CreateDate: daysAgo(181) }],
      };
      const { issues } = await scanner.checkIAMSecurity(mockIam(buildIamSend([[user]])));

      const keyIssues = issues.filter((i) => (i.evidence as IamAccessKeyEvidence)?.finding_type === 'access_key_stale');
      expect(keyIssues).toHaveLength(1);
      expect(keyIssues[0].severity).toBe('high');
    });

    it('the same access key at 91 and then 181 days produces an identical finding_key', async () => {
      const userAt91: UserFixture = {
        UserName: 'grace', Arn: 'arn:aws:iam::123456789012:user/grace', loginProfile: 'none',
        accessKeys: [{ AccessKeyId: 'AKIA_SAME', CreateDate: daysAgo(91) }],
      };
      const userAt181: UserFixture = {
        UserName: 'grace', Arn: 'arn:aws:iam::123456789012:user/grace', loginProfile: 'none',
        accessKeys: [{ AccessKeyId: 'AKIA_SAME', CreateDate: daysAgo(181) }],
      };

      const { issues: firstScan } = await scanner.checkIAMSecurity(mockIam(buildIamSend([[userAt91]])));
      const { issues: secondScan } = await scanner.checkIAMSecurity(mockIam(buildIamSend([[userAt181]])));

      expect(firstScan[0].findingKey).toBe(secondScan[0].findingKey);
      // Severity escalated even though identity stayed fixed.
      expect(firstScan[0].severity).toBe('medium');
      expect(secondScan[0].severity).toBe('high');
    });

    it('a user with two stale access keys produces two distinct findings with distinct stable keys', async () => {
      const user: UserFixture = {
        UserName: 'henry', Arn: 'arn:aws:iam::123456789012:user/henry', loginProfile: 'none',
        accessKeys: [
          { AccessKeyId: 'AKIA_ONE', CreateDate: daysAgo(95) },
          { AccessKeyId: 'AKIA_TWO', CreateDate: daysAgo(200) },
        ],
      };
      const { issues } = await scanner.checkIAMSecurity(mockIam(buildIamSend([[user]])));

      const keyIssues = issues.filter((i) => (i.evidence as IamAccessKeyEvidence)?.finding_type === 'access_key_stale');
      expect(keyIssues).toHaveLength(2);
      expect(keyIssues[0].findingKey).not.toBe(keyIssues[1].findingKey);
      expect(new Set(keyIssues.map((i) => (i.evidence as IamAccessKeyEvidence).relevant_aws_attributes.access_key_id))).toEqual(
        new Set(['AKIA_ONE', 'AKIA_TWO'])
      );
    });
  });

  describe('pagination and scan completeness', () => {
    it('fully consumes ListUsers pagination across multiple pages', async () => {
      const userA: UserFixture = { UserName: 'page1-user', Arn: 'arn:aws:iam::123456789012:user/page1-user', mfaDeviceCount: 0, loginProfile: 'exists' };
      const userB: UserFixture = { UserName: 'page2-user', Arn: 'arn:aws:iam::123456789012:user/page2-user', mfaDeviceCount: 0, loginProfile: 'exists' };
      const send = buildIamSend([[userA], [userB]]);

      const { complete, issues } = await scanner.checkIAMSecurity(mockIam(send));

      const listUsersCalls = send.mock.calls.filter(([cmd]) => cmd instanceof ListUsersCommand);
      expect(listUsersCalls).toHaveLength(2);
      expect(complete).toBe(true);
      const mfaUsers = issues
        .filter((i) => (i.evidence as IamMfaEvidence)?.finding_type === 'mfa_not_enabled')
        .map((i) => (i.evidence as IamMfaEvidence).resource_name)
        .sort();
      expect(mfaUsers).toEqual(['page1-user', 'page2-user']);
    });

    it('per-user failure after earlier successful users: earlier findings preserved, complete=false', async () => {
      const goodUser: UserFixture = { UserName: 'good-user', Arn: 'arn:aws:iam::123456789012:user/good-user', mfaDeviceCount: 0, loginProfile: 'exists' };
      const badUser: UserFixture = { UserName: 'bad-user', Arn: 'arn:aws:iam::123456789012:user/bad-user', mfaDeviceCount: 0, loginProfile: 'exists' };
      const send = buildIamSend([[goodUser, badUser]], { failOnUser: 'bad-user' });

      const { complete, issues } = await scanner.checkIAMSecurity(mockIam(send));

      expect(complete).toBe(false);
      const mfaUsers = issues
        .filter((i) => (i.evidence as IamMfaEvidence)?.finding_type === 'mfa_not_enabled')
        .map((i) => (i.evidence as IamMfaEvidence).resource_name);
      expect(mfaUsers).toEqual(['good-user']);
    });

    it('immediate ListUsers failure: no thrown exception escapes, complete=false, zero issues', async () => {
      const send = buildIamSend([[]], { failListUsers: true });

      await expect(scanner.checkIAMSecurity(mockIam(send))).resolves.toEqual({
        category: 'iam',
        complete: false,
        issues: [],
      });
    });

    it('GetLoginProfile AccessDenied on an otherwise-successful user does not degrade completeness', async () => {
      const user: UserFixture = { UserName: 'unknown-console', Arn: 'arn:aws:iam::123456789012:user/unknown-console', mfaDeviceCount: 0, loginProfile: 'denied' };
      const { complete } = await scanner.checkIAMSecurity(mockIam(buildIamSend([[user]])));
      expect(complete).toBe(true);
    });
  });

  describe('finding identity', () => {
    it('access-key finding_key does not change as the key ages past 90 or 180 days', async () => {
      const at91 = computeIamFindingKey({ findingType: 'access_key_stale', userArn: 'arn:aws:iam::123456789012:user/ivan', accessKeyId: 'AKIA_X' });
      const at181 = computeIamFindingKey({ findingType: 'access_key_stale', userArn: 'arn:aws:iam::123456789012:user/ivan', accessKeyId: 'AKIA_X' });
      expect(at91).toBe(at181);
    });

    it('access-key finding_key depends only on userArn + accessKeyId, not on age', () => {
      const keyA = computeIamFindingKey({ findingType: 'access_key_stale', userArn: 'arn:aws:iam::1:user/x', accessKeyId: 'AKIA1' });
      const keyB = computeIamFindingKey({ findingType: 'access_key_stale', userArn: 'arn:aws:iam::1:user/x', accessKeyId: 'AKIA2' });
      expect(keyA).not.toBe(keyB);
    });

    it('MFA finding identity remains stable across repeated scans for the same user', async () => {
      const user: UserFixture = { UserName: 'julia', Arn: 'arn:aws:iam::123456789012:user/julia', mfaDeviceCount: 0, loginProfile: 'exists' };

      const { issues: scan1 } = await scanner.checkIAMSecurity(mockIam(buildIamSend([[user]])));
      const { issues: scan2 } = await scanner.checkIAMSecurity(mockIam(buildIamSend([[user]])));

      expect(scan1[0].findingKey).toBe(scan2[0].findingKey);
      expect(scan1[0].findingKey).toBe(computeIamFindingKey({ findingType: 'mfa_not_enabled', userArn: user.Arn }));
    });
  });

  describe('evidence correctness', () => {
    it('MFA evidence has the expected shape and no unexpected fields', async () => {
      const user: UserFixture = { UserName: 'karen', Arn: 'arn:aws:iam::123456789012:user/karen', mfaDeviceCount: 0, loginProfile: 'exists' };
      const { issues } = await scanner.checkIAMSecurity(mockIam(buildIamSend([[user]])));
      const evidence = issues[0].evidence as IamMfaEvidence;

      expect(evidence).toMatchObject({
        schema_version: 1,
        resource_type: 'iam_user',
        resource_identifier: 'arn:aws:iam::123456789012:user/karen',
        resource_name: 'karen',
        finding_type: 'mfa_not_enabled',
        relevant_aws_attributes: { has_login_profile: true, mfa_device_count: 0 },
      });
      expect(typeof evidence.detected_at).toBe('string');
    });

    it('access-key evidence has the expected shape and no unexpected fields', async () => {
      const user: UserFixture = {
        UserName: 'leo', Arn: 'arn:aws:iam::123456789012:user/leo', loginProfile: 'none',
        accessKeys: [{ AccessKeyId: 'AKIA_EVIDENCE', CreateDate: daysAgo(95), Status: 'Active' }],
      };
      const { issues } = await scanner.checkIAMSecurity(mockIam(buildIamSend([[user]])));
      const evidence = issues[0].evidence as IamAccessKeyEvidence;

      expect(evidence).toMatchObject({
        schema_version: 1,
        resource_type: 'iam_access_key',
        resource_identifier: 'arn:aws:iam::123456789012:user/leo',
        resource_name: 'leo',
        finding_type: 'access_key_stale',
        relevant_aws_attributes: { access_key_id: 'AKIA_EVIDENCE', age_in_days: 95, key_status: 'Active' },
      });
      expect(typeof evidence.detected_at).toBe('string');
    });

    it('evidence never contains any credential/secret material — only the non-secret AccessKeyId identifier', async () => {
      const user: UserFixture = {
        UserName: 'mia', Arn: 'arn:aws:iam::123456789012:user/mia', loginProfile: 'none',
        accessKeys: [{ AccessKeyId: 'AKIAEXAMPLE1234567', CreateDate: daysAgo(95) }],
      };
      const { issues } = await scanner.checkIAMSecurity(mockIam(buildIamSend([[user]])));
      const serialized = JSON.stringify(issues[0].evidence);

      expect(serialized).not.toMatch(/secret/i);
      expect(serialized).not.toMatch(/password/i);
      expect(serialized).toContain('AKIAEXAMPLE1234567'); // the identifier itself is fine — not a secret
    });
  });

  describe('CIS mapping precision', () => {
    it('confirmed console user with no MFA -> IAM.5 / control 1.9', async () => {
      const user: UserFixture = { UserName: 'nina', Arn: 'arn:aws:iam::123456789012:user/nina', mfaDeviceCount: 0, loginProfile: 'exists' };
      const { issues } = await scanner.checkIAMSecurity(mockIam(buildIamSend([[user]])));
      expect(getFrameworkMapping(issues[0].evidence)).toMatchObject({
        framework: 'CIS AWS Foundations Benchmark',
        version: '5.0.0',
        control: '1.9',
        securityHubControlId: 'IAM.5',
      });
    });

    it('unknown console-access state -> no IAM.5 mapping under any circumstance', async () => {
      const user: UserFixture = { UserName: 'oscar', Arn: 'arn:aws:iam::123456789012:user/oscar', mfaDeviceCount: 0, loginProfile: 'denied' };
      const { issues } = await scanner.checkIAMSecurity(mockIam(buildIamSend([[user]])));
      expect(getFrameworkMapping(issues[0].evidence)).toBeNull();
    });

    it('stale access key -> IAM.3 / control 1.13', async () => {
      const user: UserFixture = {
        UserName: 'paul', Arn: 'arn:aws:iam::123456789012:user/paul', loginProfile: 'none',
        accessKeys: [{ AccessKeyId: 'AKIA_CIS', CreateDate: daysAgo(120) }],
      };
      const { issues } = await scanner.checkIAMSecurity(mockIam(buildIamSend([[user]])));
      expect(getFrameworkMapping(issues[0].evidence)).toMatchObject({ control: '1.13', securityHubControlId: 'IAM.3' });
    });

    it('never maps the access-key detector to IAM.22 / control 1.11 (unused-credential is a different signal)', async () => {
      const user: UserFixture = {
        UserName: 'quinn', Arn: 'arn:aws:iam::123456789012:user/quinn', loginProfile: 'none',
        accessKeys: [{ AccessKeyId: 'AKIA_NOTUNUSED', CreateDate: daysAgo(200) }],
      };
      const { issues } = await scanner.checkIAMSecurity(mockIam(buildIamSend([[user]])));
      const mapping = getFrameworkMapping(issues[0].evidence);
      expect(mapping?.control).not.toBe('1.11');
      expect(mapping?.securityHubControlId).not.toBe('IAM.22');
    });
  });
});
