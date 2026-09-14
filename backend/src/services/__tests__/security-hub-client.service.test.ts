/**
 * Same mocking convention as cloudwatch.service.*.test.ts: build a real SDK client
 * instance, then replace `.send` with a jest.fn() -- no aws-sdk-client-mock dependency
 * needed (this repo doesn't use one).
 */
import { SecurityHubClient } from '@aws-sdk/client-securityhub';
import { SecurityHubClientService } from '../security-hub-client.service';

function withMockedSend(send: jest.Mock): SecurityHubClient {
  const client = new SecurityHubClient({ region: 'us-east-1', credentials: { accessKeyId: 'x', secretAccessKey: 'y' } });
  (client as any).send = send;
  return client;
}

describe('SecurityHubClientService.checkCapability', () => {
  it('returns ENABLED when GetEnabledStandards succeeds', async () => {
    const client = withMockedSend(jest.fn().mockResolvedValue({ StandardsSubscriptions: [] }));
    const result = await SecurityHubClientService.checkCapability(client);
    expect(result.status).toBe('ENABLED');
    expect(result.error).toBeNull();
  });

  it('returns NOT_GRANTED on AccessDeniedException', async () => {
    const err = Object.assign(new Error('User is not authorized to perform: securityhub:GetEnabledStandards'), {
      name: 'AccessDeniedException',
    });
    const client = withMockedSend(jest.fn().mockRejectedValue(err));
    const result = await SecurityHubClientService.checkCapability(client);
    expect(result.status).toBe('NOT_GRANTED');
  });

  it('returns NOT_AVAILABLE when Security Hub is not enabled for the account', async () => {
    const err = Object.assign(new Error('Security Hub is not enabled for this account'), {
      name: 'InvalidAccessException',
    });
    const client = withMockedSend(jest.fn().mockRejectedValue(err));
    const result = await SecurityHubClientService.checkCapability(client);
    expect(result.status).toBe('NOT_AVAILABLE');
  });

  it('returns ERROR — never FAIL, never ENABLED — on an unrecognized/throttling failure', async () => {
    const err = Object.assign(new Error('Rate exceeded'), { name: 'ThrottlingException' });
    const client = withMockedSend(jest.fn().mockRejectedValue(err));
    const result = await SecurityHubClientService.checkCapability(client);
    expect(result.status).toBe('ERROR');
    expect(result.error).toContain('Rate exceeded');
  });
});

describe('SecurityHubClientService.getEnabledStandards', () => {
  it('joins StandardsSubscriptions with DescribeStandards names across pages', async () => {
    const send = jest.fn()
      .mockResolvedValueOnce({
        StandardsSubscriptions: [
          { StandardsArn: 'arn:aws:securityhub:us-east-1::standards/cis-aws-foundations-benchmark/v/5.0.0', StandardsSubscriptionArn: 'sub-arn-1' },
        ],
        NextToken: undefined,
      })
      .mockResolvedValueOnce({
        Standards: [{ StandardsArn: 'arn:aws:securityhub:us-east-1::standards/cis-aws-foundations-benchmark/v/5.0.0', Name: 'CIS AWS Foundations Benchmark v5.0.0' }],
        NextToken: undefined,
      });
    const client = withMockedSend(send);

    const standards = await SecurityHubClientService.getEnabledStandards(client);
    expect(standards).toEqual([
      {
        standardsArn: 'arn:aws:securityhub:us-east-1::standards/cis-aws-foundations-benchmark/v/5.0.0',
        standardsSubscriptionArn: 'sub-arn-1',
        name: 'CIS AWS Foundations Benchmark v5.0.0',
        enabled: true,
      },
    ]);
  });

  it('paginates GetEnabledStandards across multiple pages', async () => {
    const send = jest.fn()
      .mockResolvedValueOnce({ StandardsSubscriptions: [{ StandardsArn: 'arn:a', StandardsSubscriptionArn: 'sub-a' }], NextToken: 'page2' })
      .mockResolvedValueOnce({ StandardsSubscriptions: [{ StandardsArn: 'arn:b', StandardsSubscriptionArn: 'sub-b' }], NextToken: undefined })
      .mockResolvedValueOnce({ Standards: [], NextToken: undefined });
    const client = withMockedSend(send);

    const standards = await SecurityHubClientService.getEnabledStandards(client);
    expect(standards.map((s) => s.standardsArn)).toEqual(['arn:a', 'arn:b']);
    expect(send).toHaveBeenCalledTimes(3);
  });
});

describe('SecurityHubClientService.getActiveFindingsPaged', () => {
  function findingFixture(overrides: Record<string, unknown> = {}) {
    return {
      Id: 'finding-1',
      ProductArn: 'arn:aws:securityhub:us-east-1::product/aws/securityhub',
      CreatedAt: '2026-01-01T00:00:00.000Z',
      UpdatedAt: '2026-01-01T00:00:00.000Z',
      Title: 'Test finding',
      Severity: { Label: 'HIGH' },
      Compliance: { Status: 'FAILED', SecurityControlId: 'IAM.5', AssociatedStandards: [{ StandardsId: 'cis-aws-foundations-benchmark/v/5.0.0' }] },
      RecordState: 'ACTIVE',
      Workflow: { Status: 'NEW' },
      Region: 'us-east-1',
      Resources: [{ Type: 'AwsIamUser', Id: 'AIDAEXAMPLE' }],
      ...overrides,
    };
  }

  it('yields a single page and normalizes finding fields', async () => {
    const send = jest.fn().mockResolvedValue({ Findings: [findingFixture()], NextToken: undefined });
    const client = withMockedSend(send);

    const pages = [];
    for await (const page of SecurityHubClientService.getActiveFindingsPaged(client)) {
      pages.push(page);
    }

    expect(pages).toHaveLength(1);
    expect(pages[0].findings[0]).toMatchObject({
      findingId: 'finding-1',
      severity: 'high',
      complianceStatus: 'FAILED',
      recordState: 'ACTIVE',
      securityControlId: 'IAM.5',
      resourceType: 'AwsIamUser',
      resourceId: 'AIDAEXAMPLE',
    });
    // Filters server-side by RecordState=ACTIVE.
    expect(send.mock.calls[0][0].input.Filters.RecordState).toEqual([{ Value: 'ACTIVE', Comparison: 'EQUALS' }]);
  });

  it('follows NextToken across multiple pages', async () => {
    const send = jest.fn()
      .mockResolvedValueOnce({ Findings: [findingFixture({ Id: 'f1' })], NextToken: 'page2' })
      .mockResolvedValueOnce({ Findings: [findingFixture({ Id: 'f2' })], NextToken: undefined });
    const client = withMockedSend(send);

    const pages = [];
    for await (const page of SecurityHubClientService.getActiveFindingsPaged(client)) {
      pages.push(page);
    }

    expect(pages).toHaveLength(2);
    expect(pages[0].findings[0].findingId).toBe('f1');
    expect(pages[1].findings[0].findingId).toBe('f2');
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('yields an empty page rather than throwing when Findings is empty', async () => {
    const send = jest.fn().mockResolvedValue({ Findings: [], NextToken: undefined });
    const client = withMockedSend(send);

    const pages = [];
    for await (const page of SecurityHubClientService.getActiveFindingsPaged(client)) {
      pages.push(page);
    }

    expect(pages).toHaveLength(1);
    expect(pages[0].findings).toEqual([]);
  });

  it('propagates a mid-pagination failure to the caller rather than silently stopping', async () => {
    const send = jest.fn()
      .mockResolvedValueOnce({ Findings: [findingFixture({ Id: 'f1' })], NextToken: 'page2' })
      .mockRejectedValueOnce(Object.assign(new Error('Rate exceeded'), { name: 'ThrottlingException' }));
    const client = withMockedSend(send);

    const pages: unknown[] = [];
    await expect(async () => {
      for await (const page of SecurityHubClientService.getActiveFindingsPaged(client)) {
        pages.push(page);
      }
    }).rejects.toThrow('Rate exceeded');
    // Page 1 was already yielded before the failure on page 2.
    expect(pages).toHaveLength(1);
  });

  it('skips a malformed finding missing required identity fields instead of storing a partial row', async () => {
    const send = jest.fn().mockResolvedValue({
      Findings: [findingFixture({ Id: undefined }), findingFixture({ Id: 'valid-1' })],
      NextToken: undefined,
    });
    const client = withMockedSend(send);

    const pages = [];
    for await (const page of SecurityHubClientService.getActiveFindingsPaged(client)) {
      pages.push(page);
    }

    expect(pages[0].findings).toHaveLength(1);
    expect(pages[0].findings[0].findingId).toBe('valid-1');
  });
});
