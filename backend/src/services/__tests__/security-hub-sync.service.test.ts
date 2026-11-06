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
// The connection the sync belongs to (AWS connect PR B): one current identity, and
// clients built from it, unless a test says otherwise.
const connection = { current: 'conn-A' as string | null, clients: 'conn-A' as string | null };
jest.mock('../aws-connection-fence', () => ({
  ...jest.requireActual('../aws-connection-fence'),
  currentConnectionIdentity: jest.fn(async () => connection.current),
  connectionIdentityOfClients: jest.fn(() => connection.clients),
}));
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
    connection.current = 'conn-A';
    connection.clients = 'conn-A';
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
    expect(recordSyncResult).toHaveBeenCalledWith('org-1', 'conn-A', expect.objectContaining({ syncStatus: 'PARTIAL' }));
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

  describe('AWS connect PR B: every write belongs to the connection the sync started with', () => {
    const enabled = () => {
      (SecurityHubClientService.checkCapability as jest.Mock).mockResolvedValue({ status: 'ENABLED', checkedAt: new Date().toISOString(), error: null });
      (SecurityHubClientService.getEnabledStandards as jest.Mock).mockResolvedValue([]);
    };

    it('every state write and page upsert is fenced on the identity read at the start', async () => {
      enabled();
      (SecurityHubClientService.getActiveFindingsPaged as jest.Mock).mockReturnValue(pagesFrom([{ pageIndex: 0, findings: [{ id: 'f1' }] }]));
      await new SecurityHubSyncService().sync('org-1');
      expect(markSyncStarted).toHaveBeenCalledWith('org-1', 'conn-A');
      expect(upsertFindings).toHaveBeenCalledWith('org-1', [{ id: 'f1' }], 'conn-A');
      expect(recordSyncResult).toHaveBeenCalledWith('org-1', 'conn-A', expect.objectContaining({ syncStatus: 'COMPLETED' }));
    });

    it('clients built from another connection: nothing is fetched into storage, the result is not recorded', async () => {
      enabled();
      connection.clients = 'conn-B';
      (SecurityHubClientService.getActiveFindingsPaged as jest.Mock).mockReturnValue(pagesFrom([{ pageIndex: 0, findings: [{ id: 'f1' }] }]));
      const outcome = await new SecurityHubSyncService().sync('org-1');
      expect(outcome).toMatchObject({ connectionChanged: true, syncStatus: 'FAILED', error: 'CONNECTION_CHANGED' });
      expect(SecurityHubClientService.checkCapability).not.toHaveBeenCalled();
      expect(upsertFindings).not.toHaveBeenCalled();
      expect(recordSyncResult).not.toHaveBeenCalled();
    });

    it('the connection changes mid-ingestion: the next page is refused, and the result never overwrites the new connection\'s state', async () => {
      enabled();
      const { ConnectionChangedError } = jest.requireActual('../aws-connection-fence');
      upsertFindings.mockResolvedValueOnce(1).mockRejectedValueOnce(new ConnectionChangedError('org-1'));
      (SecurityHubClientService.getActiveFindingsPaged as jest.Mock).mockReturnValue(
        pagesFrom([{ pageIndex: 0, findings: [{ id: 'f1' }] }, { pageIndex: 1, findings: [{ id: 'f2' }] }, { pageIndex: 2, findings: [{ id: 'f3' }] }])
      );
      const outcome = await new SecurityHubSyncService().sync('org-1');
      expect(outcome).toMatchObject({ connectionChanged: true, pagesProcessed: 1, findingsCount: 1 });
      expect(upsertFindings).toHaveBeenCalledTimes(2); // page 3 never attempted
      expect(recordSyncResult).not.toHaveBeenCalled();
    });

    it('the start write itself finds the connection changed: the sync stops before any AWS call', async () => {
      const { ConnectionChangedError } = jest.requireActual('../aws-connection-fence');
      markSyncStarted.mockRejectedValueOnce(new ConnectionChangedError('org-1'));
      const outcome = await new SecurityHubSyncService().sync('org-1');
      expect(outcome.connectionChanged).toBe(true);
      expect(AWSClientFactory.createClients).not.toHaveBeenCalled();
      expect(recordSyncResult).not.toHaveBeenCalled();
    });

    it('in-flight dedup is keyed by organization AND connection: a request after a change never joins the old sync', async () => {
      enabled();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      let runs = 0;
      (SecurityHubClientService.getActiveFindingsPaged as jest.Mock).mockImplementation(async function* () {
        runs += 1;
        await gate;
        yield { pageIndex: 0, findings: [] };
      });
      const service = new SecurityHubSyncService();
      const first = service.sync('org-1');
      await new Promise((resolve) => setImmediate(resolve));
      connection.current = 'conn-B';
      connection.clients = 'conn-B';
      const second = service.sync('org-1');
      await new Promise((resolve) => setImmediate(resolve));
      release();
      const [a, b] = await Promise.all([first, second]);
      expect(a).not.toBe(b);
      expect(runs).toBe(2);
    });

    it('the connection cannot be read: nothing is written, the sync is answered FAILED', async () => {
      const fence = jest.requireMock('../aws-connection-fence');
      fence.currentConnectionIdentity.mockRejectedValueOnce(new Error('AWS_ACCOUNT_AMBIGUOUS: two eligible'));
      const outcome = await new SecurityHubSyncService().sync('org-1');
      expect(outcome.syncStatus).toBe('FAILED');
      expect(markSyncStarted).not.toHaveBeenCalled();
      expect(recordSyncResult).not.toHaveBeenCalled();
    });
  });

  describe('AWS connect PR C: no connection is never a pass', () => {
    it('an organization with no eligible connection: no AWS call, nothing written, answered notConnected', async () => {
      connection.current = null;
      const outcome = await new SecurityHubSyncService().sync('org-1');
      expect(outcome).toMatchObject({ notConnected: true, syncStatus: 'FAILED', error: 'NOT_CONNECTED', pagesProcessed: 0, findingsCount: 0 });
      expect(markSyncStarted).not.toHaveBeenCalled();
      expect(recordSyncResult).not.toHaveBeenCalled();
      expect(upsertFindings).not.toHaveBeenCalled();
      expect(AWSClientFactory.createClients).not.toHaveBeenCalled();
    });
  });
});
