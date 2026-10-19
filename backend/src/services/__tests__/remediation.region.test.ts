/**
 * Remediation acts in its resource's region (multi-region plan, PR M1):
 *
 *   - creation binds action_params.region from the inventory row for the
 *     resource, or from its recommendation when the inventory does not hold
 *     it, refuses a supplied region that contradicts the inventory, never
 *     stores a supplied region nothing confirms, and refuses a recommendation
 *     for another resource;
 *   - execute and rollback bind a missing region from the inventory when it
 *     holds the resource in exactly one region, and otherwise refuse, before
 *     credentials or any AWS call, a workflow whose region is missing, not a
 *     region, ambiguous, or contradicted by the inventory;
 *   - every action client is built for the workflow's region, and the
 *     platform's AWS_DEFAULT_REGION is never used (STS is pinned to us-east-1).
 *
 * Mock-only: a fake Pool and spied SDK clients, no network.
 */
import { EC2Client } from '@aws-sdk/client-ec2';
import { S3Client } from '@aws-sdk/client-s3';
import * as platformSts from '../platform-sts';
import {
  RemediationService,
  REGION_MISMATCH_PREFIX,
  TARGET_MISMATCH_PREFIX,
  REGION_UNKNOWN_MESSAGE,
  REGION_AMBIGUOUS_MESSAGE,
} from '../remediation.service';

const WORKFLOW = {
  id: 'wf-region',
  organization_id: 'org-region',
  recommendation_id: null,
  resource_id: 'i-1234567890abcdef0',
  resource_type: 'EC2',
  action_type: 'stop_instance',
  action_params: { resource_id: 'i-1234567890abcdef0', region: 'eu-west-1' } as Record<string, unknown>,
  estimated_savings: 5,
  risk_level: 'low',
  status: 'approved',
  rollback_available: true,
  execution_log: null,
};

/**
 * A Pool whose aws_resources lookups return `inventory` regions, whose
 * cost_recommendations lookups return a recommendation for
 * `recommendedResourceId` in `recommendedRegion`, whose aws_accounts lookup
 * returns one connected account, and which answers every other query with the
 * workflow row.
 */
function fakePool(
  workflow: Record<string, unknown>,
  inventory: string[] = [],
  recommendedRegion?: string,
  recommendedResourceId: string = WORKFLOW.resource_id
) {
  const query = jest.fn(async (sql: string) => {
    if (/FROM aws_resources/.test(sql)) return { rows: inventory.map((region) => ({ region })) };
    if (/FROM cost_recommendations/.test(sql)) {
      return { rows: [{ resource_id: recommendedResourceId, aws_region: recommendedRegion ?? null }] };
    }
    if (/FROM aws_accounts/.test(sql)) {
      return { rows: [{ role_arn: 'arn:aws:iam::111122223333:role/devcontrol-remediation', account_id: '111122223333', external_id: 'external-id-1' }] };
    }
    return { rows: [workflow] };
  });
  return { query } as any;
}

function insertedActionParams(pool: { query: jest.Mock }): Record<string, unknown> {
  const insert = pool.query.mock.calls.find(([sql]: [string]) => /INSERT INTO remediation_workflows/.test(sql));
  return JSON.parse(insert[1][5]);
}

const ENV_BEFORE = { ...process.env };

beforeEach(() => {
  process.env.ENABLE_AUTOMATED_REMEDIATION = 'true';
  process.env.AWS_DEFAULT_REGION = 'ap-south-1';
  process.env.AWS_REGION = 'ap-south-1';
  delete process.env.DEVCONTROL_PROD_INSTANCE_ID;
  delete process.env.DEVCONTROL_OPERATIONAL_ORG_ID;
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  process.env = { ...ENV_BEFORE };
  jest.restoreAllMocks();
});

describe('creation binds the resource region', () => {
  const draft = (actionParams: Record<string, unknown> = {}, recommendationId?: string) => ({
    recommendationId,
    resourceId: WORKFLOW.resource_id,
    resourceType: 'EC2',
    actionType: 'stop_instance' as const,
    actionParams,
    estimatedSavings: 5,
    riskLevel: 'low' as const,
  });

  it("takes the inventory row's region when none is supplied", async () => {
    const pool = fakePool(WORKFLOW, ['eu-west-1']);

    await new RemediationService(pool).createWorkflow('org-region', draft());

    expect(insertedActionParams(pool)).toEqual({ resource_id: WORKFLOW.resource_id, region: 'eu-west-1' });
  });

  it("takes the recommendation's region when the inventory does not hold the resource", async () => {
    const pool = fakePool(WORKFLOW, [], 'us-west-2');

    await new RemediationService(pool).createWorkflow('org-region', draft({}, 'rec-1'));

    expect(insertedActionParams(pool)).toEqual({ resource_id: WORKFLOW.resource_id, region: 'us-west-2' });
  });

  it('refuses a supplied region that contradicts the inventory, writing nothing', async () => {
    const pool = fakePool(WORKFLOW, ['eu-west-1']);

    await expect(
      new RemediationService(pool).createWorkflow('org-region', draft({ region: 'us-east-1' }))
    ).rejects.toThrow(new RegExp(`^${REGION_MISMATCH_PREFIX}`));
    expect(pool.query.mock.calls.some(([sql]: [string]) => /INSERT/.test(sql))).toBe(false);
  });

  it('refuses a resource id the inventory holds in more than one region, writing nothing', async () => {
    const pool = fakePool(WORKFLOW, ['eu-west-1', 'us-east-1']);

    await expect(new RemediationService(pool).createWorkflow('org-region', draft())).rejects.toThrow(
      new RegExp(`^${REGION_MISMATCH_PREFIX}.*more than one region`)
    );
    expect(pool.query.mock.calls.some(([sql]: [string]) => /INSERT/.test(sql))).toBe(false);
  });

  it('does not store a supplied region that neither the inventory nor a recommendation confirms', async () => {
    const pool = fakePool(WORKFLOW);

    await new RemediationService(pool).createWorkflow('org-region', draft({ region: 'eu-west-1' }));

    expect(insertedActionParams(pool)).toEqual({ resource_id: WORKFLOW.resource_id });
  });

  it("keeps a supplied region that matches the recommendation's region", async () => {
    const pool = fakePool(WORKFLOW, [], 'us-west-2');

    await new RemediationService(pool).createWorkflow('org-region', draft({ region: 'us-west-2' }, 'rec-1'));

    expect(insertedActionParams(pool)).toEqual({ resource_id: WORKFLOW.resource_id, region: 'us-west-2' });
  });

  it('refuses a recommendation for another resource, writing nothing', async () => {
    const pool = fakePool(WORKFLOW, ['eu-west-1'], 'eu-west-1', 'i-0aaaaaaaaaaaaaaaa');

    await expect(
      new RemediationService(pool).createWorkflow('org-region', draft({}, 'rec-other'))
    ).rejects.toThrow(new RegExp(`^${TARGET_MISMATCH_PREFIX}`));
    expect(pool.query.mock.calls.some(([sql]: [string]) => /INSERT/.test(sql))).toBe(false);
  });

  it('refuses a recommendation the organization does not have, writing nothing', async () => {
    // Neither the inventory nor cost_recommendations holds anything for this organization.
    const pool = { query: jest.fn(async () => ({ rows: [] })) } as any;

    await expect(
      new RemediationService(pool).createWorkflow('org-region', draft({}, 'rec-missing'))
    ).rejects.toThrow(new RegExp(`^${TARGET_MISMATCH_PREFIX}`));
    expect(pool.query.mock.calls.some(([sql]: [string]) => /INSERT/.test(sql))).toBe(false);
  });

  it('refuses a supplied region that is not an AWS region', async () => {
    const pool = fakePool(WORKFLOW);

    await expect(
      new RemediationService(pool).createWorkflow('org-region', draft({ region: 'us-west-2-lax-1' }))
    ).rejects.toThrow(new RegExp(`^${REGION_MISMATCH_PREFIX}`));
  });
});

describe('execute and rollback refuse an unknown region before any AWS call', () => {
  it.each([
    ['missing', { resource_id: WORKFLOW.resource_id }],
    ['not a region', { resource_id: WORKFLOW.resource_id, region: 'us-west-2-lax-1' }],
  ])('execute: region %s -> REMEDIATION_BLOCKED, no credentials, no EC2 call, status unchanged', async (_label, actionParams) => {
    const pool = fakePool({ ...WORKFLOW, action_params: actionParams });
    const service = new RemediationService(pool);
    const getCreds = jest.spyOn(service as any, 'getAWSCredentials');
    const ec2Send = jest.spyOn(EC2Client.prototype, 'send');

    await expect(service.execute(WORKFLOW.id, 'org-region', 'user-1')).rejects.toThrow(
      /^REMEDIATION_BLOCKED: The workflow's resource region is unknown/
    );

    expect(getCreds).not.toHaveBeenCalled();
    expect(ec2Send).not.toHaveBeenCalled();
    expect(pool.query.mock.calls.some(([sql]: [string]) => /UPDATE/.test(sql))).toBe(false);
  });

  it('rollback: a missing region -> REMEDIATION_BLOCKED, no credentials, no EC2 call', async () => {
    const pool = fakePool({ ...WORKFLOW, status: 'completed', action_params: { resource_id: WORKFLOW.resource_id } });
    const service = new RemediationService(pool);
    const getCreds = jest.spyOn(service as any, 'getAWSCredentials');
    const ec2Send = jest.spyOn(EC2Client.prototype, 'send');

    await expect(service.rollback(WORKFLOW.id, 'org-region', 'user-1')).rejects.toThrow(/^REMEDIATION_BLOCKED:.*region is unknown/);

    expect(getCreds).not.toHaveBeenCalled();
    expect(ec2Send).not.toHaveBeenCalled();
  });

  it.each(['execute', 'rollback'] as const)('%s: a region the inventory contradicts -> REMEDIATION_BLOCKED, no credentials', async (operation) => {
    const workflow = { ...WORKFLOW, status: operation === 'execute' ? 'approved' : 'completed', action_params: { resource_id: WORKFLOW.resource_id, region: 'us-east-1' } };
    const pool = fakePool(workflow, ['eu-west-1']);
    const service = new RemediationService(pool);
    const getCreds = jest.spyOn(service as any, 'getAWSCredentials');

    await expect(service[operation](WORKFLOW.id, 'org-region', 'user-1')).rejects.toThrow(
      /^REMEDIATION_BLOCKED: The workflow's region does not match the resource's region/
    );
    expect(getCreds).not.toHaveBeenCalled();
  });
});

describe('execute and rollback bind a missing region from the inventory', () => {
  const noRegion = { resource_id: WORKFLOW.resource_id };
  const statusFor = (operation: 'execute' | 'rollback') => (operation === 'execute' ? 'approved' : 'completed');

  function regionUpdates(pool: { query: jest.Mock }) {
    return pool.query.mock.calls.filter(([sql]: [string]) => /SET action_params = jsonb_set\(action_params, '\{region\}'/.test(sql));
  }

  it.each(['execute', 'rollback'] as const)(
    '%s: one inventory region -> stored on the workflow, then every EC2 call goes to that region',
    async (operation) => {
      jest.spyOn(platformSts, 'assumeRoleAsPlatform').mockResolvedValue({
        Credentials: { AccessKeyId: 'ASIATEMP', SecretAccessKey: 'temp-secret', SessionToken: 'temp-token' },
      } as any);
      const regions: string[] = [];
      jest.spyOn(EC2Client.prototype as any, 'send').mockImplementation(async function (this: any) {
        regions.push(await this.config.region());
        return {};
      });
      const pool = fakePool({ ...WORKFLOW, status: statusFor(operation), action_params: noRegion }, ['eu-west-1']);

      await new RemediationService(pool)[operation](WORKFLOW.id, 'org-region', 'user-1');

      const updates = regionUpdates(pool);
      expect(updates).toHaveLength(1);
      expect(updates[0][1]).toEqual(['eu-west-1', WORKFLOW.id, 'org-region']);
      // Bound before credentials were fetched or any AWS call was made.
      const updateIndex = pool.query.mock.calls.indexOf(updates[0]);
      const accountIndex = pool.query.mock.calls.findIndex(([sql]: [string]) => /FROM aws_accounts/.test(sql));
      expect(updateIndex).toBeLessThan(accountIndex);
      expect(regions.length).toBeGreaterThan(0);
      expect(new Set(regions)).toEqual(new Set(['eu-west-1']));
    }
  );

  it.each([
    ['execute', [], REGION_UNKNOWN_MESSAGE],
    ['rollback', [], REGION_UNKNOWN_MESSAGE],
    ['execute', ['eu-west-1', 'us-east-1'], REGION_AMBIGUOUS_MESSAGE],
    ['rollback', ['eu-west-1', 'us-east-1'], REGION_AMBIGUOUS_MESSAGE],
  ] as const)('%s: inventory regions %p -> refused, nothing stored, no credentials, no AWS call', async (operation, inventory, message) => {
    const pool = fakePool({ ...WORKFLOW, status: statusFor(operation), action_params: noRegion }, [...inventory]);
    const service = new RemediationService(pool);
    const getCreds = jest.spyOn(service as any, 'getAWSCredentials');
    const ec2Send = jest.spyOn(EC2Client.prototype, 'send');

    await expect(service[operation](WORKFLOW.id, 'org-region', 'user-1')).rejects.toThrow(message);

    expect(getCreds).not.toHaveBeenCalled();
    expect(ec2Send).not.toHaveBeenCalled();
    expect(pool.query.mock.calls.some(([sql]: [string]) => /UPDATE/.test(sql))).toBe(false);
  });
});

describe("action clients use the workflow's region, never AWS_DEFAULT_REGION", () => {
  function stubAssumeRole() {
    return jest.spyOn(platformSts, 'assumeRoleAsPlatform').mockResolvedValue({
      Credentials: { AccessKeyId: 'ASIATEMP', SecretAccessKey: 'temp-secret', SessionToken: 'temp-token' },
    } as any);
  }

  /** Records the region of every client that sends, answering each command with `{}`. */
  function recordRegions<T extends { send: unknown }>(Client: { prototype: T }) {
    const regions: string[] = [];
    jest.spyOn(Client.prototype as any, 'send').mockImplementation(async function (this: any) {
      regions.push(await this.config.region());
      return {};
    });
    return regions;
  }

  it('execute (stop_instance): credentials come from STS in us-east-1 and every EC2 call goes to eu-west-1', async () => {
    const assumeRole = stubAssumeRole();
    const regions = recordRegions(EC2Client);
    const pool = fakePool(WORKFLOW, ['eu-west-1']);

    await new RemediationService(pool).execute(WORKFLOW.id, 'org-region', 'user-1').catch(() => undefined);

    expect(assumeRole).toHaveBeenCalledTimes(1);
    expect(assumeRole.mock.calls[0][0]).toBe('us-east-1');
    expect(regions.length).toBeGreaterThan(0);
    expect(new Set(regions)).toEqual(new Set(['eu-west-1']));
  });

  it('execute (enable_s3_lifecycle): the S3 call goes to the bucket region, not AWS_DEFAULT_REGION', async () => {
    stubAssumeRole();
    recordRegions(EC2Client);
    const s3Regions = recordRegions(S3Client);
    const bucketWorkflow = {
      ...WORKFLOW,
      resource_id: 'eu-logs-bucket',
      resource_type: 'S3',
      action_type: 'enable_s3_lifecycle',
      action_params: { resource_id: 'eu-logs-bucket', region: 'eu-west-1' },
    };
    const pool = fakePool(bucketWorkflow, ['eu-west-1']);

    await new RemediationService(pool).execute(bucketWorkflow.id, 'org-region', 'user-1');

    expect(s3Regions).toEqual(['eu-west-1']);
  });
});
