/**
 * Sync orchestration coverage: pagination, partial-failure safety (a failed page must
 * not discard already-ingested pages, and must not mark the sync COMPLETED), and
 * in-flight deduplication of concurrent sync requests for the same org.
 */
import { SecurityHubSyncService } from '../security-hub-sync.service';
import { AWSClientFactory } from '../aws-client-factory.service';
import { SecurityHubClientService } from '../security-hub-client.service';

jest.mock('../aws-client-factory.service');
jest.mock('../security-hub-client.service');
jest.mock('../../repositories/security-hub-state.repository');
jest.mock('../../repositories/security-hub-findings.repository');

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { SecurityHubStateRepository } = require('../../repositories/security-hub-state.repository');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { SecurityHubFindingsRepository } = require('../../repositories/security-hub-findings.repository');

function mockClients() {
  (AWSClientFactory.createClients as jest.Mock).mockResolvedValue({ securityHub: {}, region: 'us-east-1', enabled: true });
}

async function* pagesFrom(pages: { pageIndex: number; findings: any[] }[]) {
  for (const p of pages) yield p;
}

describe('SecurityHubSyncService.sync', () => {
  let recordSyncResult: jest.Mock;
  let markSyncStarted: jest.Mock;
  let upsertFindings: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    recordSyncResult = jest.fn().mockResolvedValue(undefined);
    markSyncStarted = jest.fn().mockResolvedValue(undefined);
    upsertFindings = jest.fn().mockResolvedValue(0);
    (SecurityHubStateRepository as jest.Mock).mockImplementation(() => ({
      markSyncStarted,
      recordSyncResult,
    }));
    (SecurityHubFindingsRepository as jest.Mock).mockImplementation(() => ({ upsertFindings }));
    mockClients();
  });

  it('capability NOT_GRANTED skips findings ingestion entirely and records a completed (not failed) sync', async () => {
    (SecurityHubClientService.checkCapability as jest.Mock).mockResolvedValue({
      status: 'NOT_GRANTED',
      checkedAt: new Date().toISOString(),
      error: 'AccessDenied',
    });

    const outcome = await new SecurityHubSyncService().sync('org-1');

    expect(outcome.capability.status).toBe('NOT_GRANTED');
    expect(outcome.syncStatus).toBe('COMPLETED');
    expect(upsertFindings).not.toHaveBeenCalled();
  });

  it('ingests multiple pages, upserting each as it arrives', async () => {
    (SecurityHubClientService.checkCapability as jest.Mock).mockResolvedValue({ status: 'ENABLED', checkedAt: new Date().toISOString(), error: null });
    (SecurityHubClientService.getEnabledStandards as jest.Mock).mockResolvedValue([]);
    (SecurityHubClientService.getActiveFindingsPaged as jest.Mock).mockReturnValue(
      pagesFrom([
        { pageIndex: 0, findings: [{ findingId: 'f1' }] },
        { pageIndex: 1, findings: [{ findingId: 'f2' }] },
      ])
    );

    const outcome = await new SecurityHubSyncService().sync('org-1');

    expect(outcome.syncStatus).toBe('COMPLETED');
    expect(outcome.pagesProcessed).toBe(2);
    expect(outcome.findingsCount).toBe(2);
    expect(upsertFindings).toHaveBeenCalledTimes(2);
  });

  it('a mid-pagination failure marks the sync PARTIAL and keeps already-ingested pages (does not discard or rethrow)', async () => {
    (SecurityHubClientService.checkCapability as jest.Mock).mockResolvedValue({ status: 'ENABLED', checkedAt: new Date().toISOString(), error: null });
    (SecurityHubClientService.getEnabledStandards as jest.Mock).mockResolvedValue([]);

    async function* failingPages() {
      yield { pageIndex: 0, findings: [{ findingId: 'f1' }] };
      throw new Error('Rate exceeded');
    }
    (SecurityHubClientService.getActiveFindingsPaged as jest.Mock).mockReturnValue(failingPages());

    const outcome = await new SecurityHubSyncService().sync('org-1');

    expect(outcome.syncStatus).toBe('PARTIAL');
    expect(outcome.pagesProcessed).toBe(1);
    expect(upsertFindings).toHaveBeenCalledTimes(1); // page 1's findings were persisted before the failure
    expect(outcome.error).toContain('Rate exceeded');
    // A partial sync must never be silently reported as COMPLETED.
    expect(recordSyncResult).toHaveBeenCalledWith('org-1', expect.objectContaining({ syncStatus: 'PARTIAL' }));
  });

  it('deduplicates concurrent sync calls for the same org into a single run', async () => {
    (SecurityHubClientService.checkCapability as jest.Mock).mockResolvedValue({ status: 'ENABLED', checkedAt: new Date().toISOString(), error: null });
    (SecurityHubClientService.getEnabledStandards as jest.Mock).mockResolvedValue([]);
    let callCount = 0;
    (SecurityHubClientService.getActiveFindingsPaged as jest.Mock).mockImplementation(() => {
      callCount += 1;
      return pagesFrom([{ pageIndex: 0, findings: [] }]);
    });

    const service = new SecurityHubSyncService();
    const [a, b] = await Promise.all([service.sync('org-dedup'), service.sync('org-dedup')]);

    expect(a).toBe(b); // same resolved outcome object -- one run shared, not two
    expect(callCount).toBe(1);
  });

  it('two different orgs sync independently, not deduplicated against each other', async () => {
    (SecurityHubClientService.checkCapability as jest.Mock).mockResolvedValue({ status: 'ENABLED', checkedAt: new Date().toISOString(), error: null });
    (SecurityHubClientService.getEnabledStandards as jest.Mock).mockResolvedValue([]);
    (SecurityHubClientService.getActiveFindingsPaged as jest.Mock).mockImplementation(() => pagesFrom([{ pageIndex: 0, findings: [] }]));

    const service = new SecurityHubSyncService();
    await Promise.all([service.sync('org-x'), service.sync('org-y')]);

    expect(SecurityHubClientService.getActiveFindingsPaged).toHaveBeenCalledTimes(2);
  });
});
