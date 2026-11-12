/**
 * WeeklyAISummaryJob send path with a fake pool, a stubbed repository, and a
 * stubbed Resend client (or, in W, the real SDK against a local fake API) --
 * no database, no Cost Explorer, no model call, and no email leaves the process.
 */
import { Pool } from 'pg';
import { WeeklyAISummaryJob, WEEKLY_SUMMARY_REPLY_TO, WEEKLY_SUMMARY_SUBJECT_PREFIX } from '../weekly-ai-summary.job';
import type { WeeklySummaryRepository } from '../../repositories/weekly-summary.repository';

/** WE-D12: "Your DevControl weekly summary · Nov 9 – 15, 2026" for the 7 UTC days before the send. */
const SUBJECT = new RegExp(`^${WEEKLY_SUMMARY_SUBJECT_PREFIX} · [A-Z][a-z]{2} \\d{1,2}(, \\d{4})? – ([A-Z][a-z]{2} )?\\d{1,2}, \\d{4}$`);
import { setModelClientForTests } from '../../services/ai/model-client';
import { verifyUnsubscribeToken } from '../../services/unsubscribe-token';
import { FAKE_RESEND_KEY, guardFetch, startFakeResendApi } from '../../__tests__/helpers/fake-resend-api';

const ORG_A = 'c0000000-0000-4000-8000-00000000000a';
const ORG_B = 'c0000000-0000-4000-8000-00000000000b';
/** Each org's owner: a UUID (unsubscribe tokens are only issued for UUID user ids). */
const userOf = (org: string) => org.replace(/^c/, 'd');

function fakePool() {
  const clients: Array<{ query: jest.Mock; release: jest.Mock }> = [];
  const pool = {
    connect: jest.fn(async () => {
      const c = { query: jest.fn(async () => ({ rows: [] })), release: jest.fn() };
      clients.push(c);
      return c;
    }),
  };
  return { pool: pool as unknown as Pool, clients };
}

const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;

beforeAll(() => {
  delete process.env.ANTHROPIC_API_KEY;
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterAll(() => {
  if (originalAnthropicKey) process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
});

/** What the job hands to resend.emails.send (the fields these tests read). */
interface SentMessage { to: string; subject: string; html: string; text: string; replyTo: string; headers: Record<string, string> }
type SendResult = { data: { id: string } | null; error?: { name: string; message?: string } };

/** `recipientFor` returns one recipient, null (none eligible), or an array (several owners). */
function setup(recipientFor: (org: string) => unknown) {
  const { pool, clients } = fakePool();
  const job = new WeeklyAISummaryJob(pool);
  const send = jest.fn<Promise<SendResult>, [SentMessage]>(async () => ({ data: { id: 'email-id' } }));
  (job as any).resend = { emails: { send } };
  const repository = (job as any).repository;
  const getRecipients = jest.spyOn(repository, 'getRecipients').mockImplementation(async (org: unknown) => {
    const r = recipientFor(String(org));
    return r == null ? [] : Array.isArray(r) ? r : [r];
  });
  const gatherWeeklyEvidence = jest.spyOn(repository, 'gatherWeeklyEvidence').mockImplementation(async () => {
    throw new Error('evidence should not be gathered in this test');
  });
  return { job, send, clients, getRecipients, gatherWeeklyEvidence, repository };
}

/** Serves `orgs` (sorted) the way getActiveOrganizationsPage pages them: id order after the cursor. */
function pageOver(repository: WeeklySummaryRepository, orgs: string[]) {
  const sorted = [...orgs].sort();
  return jest.spyOn(repository, 'getActiveOrganizationsPage').mockImplementation(async (afterId: string | null, pageSize = 100) =>
    sorted.filter(id => afterId === null || id > afterId).slice(0, pageSize));
}

/** The scheduled run (private on the job). */
const runAll = (job: WeeklyAISummaryJob) =>
  (job as unknown as { sendWeeklySummaries(): Promise<unknown> }).sendWeeklySummaries();
/** Every logged line, each argument as a string (objects as JSON). */
const loggedText = (mocks: jest.Mock[]) =>
  mocks.flatMap(l => l.mock.calls).map(call => call.map((c: unknown) => (typeof c === 'string' ? c : JSON.stringify(c))).join(' ')).join('\n');

describe('WeeklyAISummaryJob recipient eligibility', () => {
  it('R: the manual trigger never sends or gathers data when no owner is eligible', async () => {
    const { job, send, gatherWeeklyEvidence, getRecipients, clients } = setup(() => null);

    const result = await job.triggerManual(ORG_A);

    expect(result).toEqual({ sent: 0, skipped: 1, errors: 0 });
    expect(getRecipients).toHaveBeenCalledWith(ORG_A, clients[0]);
    expect(gatherWeeklyEvidence).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    // The eligibility query ran on this org's tenant-tagged connection.
    expect(clients[0].query).toHaveBeenCalledWith("SELECT set_config('app.current_organization_id', $1, false)", [ORG_A]);
    expect(clients[0].release).toHaveBeenCalled();
  });

  it('R: the scheduled run counts an ineligible org as skipped, not sent', async () => {
    const { job, send, repository } = setup(() => null);
    pageOver(repository, [ORG_A, ORG_B]);

    const result = await runAll(job);

    expect(result).toEqual({ sent: 0, skipped: 2, errors: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  it('15: the manual trigger requires an organization -- it never falls through to every org', async () => {
    const { job, repository } = setup(() => null);
    const all = jest.spyOn(repository, 'getActiveOrganizationsPage');
    await expect(job.triggerManual('' as any)).rejects.toThrow(/organizationId is required/);
    await expect(job.triggerManual(undefined as any)).rejects.toThrow(/organizationId is required/);
    expect(all).not.toHaveBeenCalled();
  });

  /** Evidence with every source missing, except open recommendations and active findings (what used to trigger a model call). */
  function stubEvidence(repository: any) {
    const { weeklySummaryPeriod } = jest.requireActual('../../repositories/weekly-summary.repository');
    const { notSupported, collectSection } = jest.requireActual('../../services/ai-context-contract');
    const missing = (source: string) => notSupported({ source }, 'not evaluated in this test');
    return jest.spyOn(repository, 'gatherWeeklyEvidence').mockImplementation(async (...args: any[]) => ({
      period: weeklySummaryPeriod(args[1]),
      awsConnection: 'connected',
      connectionHealth: missing('DevControl AWS connection health'),
      scan: missing('DevControl discovery scans'),
      costAnalysis: missing('DevControl cost analysis runs'),
      deploymentHistory: missing('DevControl deployment records (all time)'),
      currentWeekSpend: missing('AWS Cost Explorer daily trend'),
      previousWeekSpend: missing('AWS Cost Explorer daily trend'),
      weekOverWeek: missing('DevControl week-over-week comparison'),
      inventoryEstimate: null,
      alerts: missing('DevControl alert history'),
      delivery: missing('DevControl deployment records'),
      security: await collectSection({ source: 'DevControl security posture score and configuration checks' }, async () => ({
        state: 'available', data: { score: 70, accountLevelFindings: 2, resourceComplianceIssues: 3 },
      })),
      recommendations: await collectSection({ source: 'DevControl cost recommendations' }, async () => ({
        state: 'available', data: { active: 3, estimatedMonthlySavings: 845, estimatedFindings: 3, ceilingByResourceType: {}, unestimatedFindings: 0 },
      })),
    }));
  }

  it('P/16/B1: an eligible org is sent only to its own recipient, with no model call, no AI section, and a subject with no AI claim', async () => {
    const { job, send, repository } = setup(org => ({ userId: userOf(org), email: `owner@${org}.test`, fullName: 'Pat Owner' }));
    const gather = stubEvidence(repository);
    // Every model call goes through the shared model client; a stub that records calls proves none is made.
    const modelCall = jest.fn();
    setModelClientForTests({ messages: { create: modelCall, stream: modelCall } } as never);

    const result = await job.triggerManual(ORG_B);

    expect(result).toEqual({ sent: 1, skipped: 0, errors: 0 });
    expect(gather).toHaveBeenCalledWith(ORG_B, expect.any(Date), expect.anything());
    expect(send).toHaveBeenCalledTimes(1);
    const payload = (send.mock.calls[0] as any[])[0];
    expect(payload.to).toBe(`owner@${ORG_B}.test`);
    // Signed weekly-summary token for this org's owner, never the forgeable base64(userId).
    const header = payload.headers['List-Unsubscribe'] as string;
    const token = /[?&]token=([^&>]+)>$/.exec(header)?.[1];
    expect(token).toMatch(/^v1\./);
    expect(verifyUnsubscribeToken(token, 'weekly-summary')).toEqual({ kind: 'signed', userId: userOf(ORG_B) });
    expect(header).not.toContain(`token=${Buffer.from(userOf(ORG_B)).toString('base64')}>`);
    expect(payload.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    for (const body of [payload.html, payload.text]) {
      expect(body).toContain(token);
    }
    expect(payload.text).toContain('Cloud spend data was unavailable for this period');
    // WE-D11: replies go to the support mailbox, never to the no-reply sender.
    expect(payload.replyTo).toBe(WEEKLY_SUMMARY_REPLY_TO);
    expect(WEEKLY_SUMMARY_REPLY_TO).toBe('support@getdevcontrol.com');
    expect(payload.text).not.toMatch(/No cloud spend recorded|No alerts|DORA|lead time/i);

    // B1: no model call; nothing model-written or "AI"-claimed reaches the email.
    expect(modelCall).not.toHaveBeenCalled();
    expect(payload.subject).toMatch(SUBJECT);
    expect(payload.subject).not.toMatch(/\bAI\b/);
    for (const body of [payload.html, payload.text]) {
      expect(body).not.toMatch(/AI recommendation|AI-Powered/i);
    }
    expect(payload.html).toContain('Estimated savings: <strong>$845/month</strong>');
    expect(payload.text).toContain('Estimated savings: $845/month across 3 open findings.');
    setModelClientForTests(undefined);
  });

  it('P1: the logs never carry the recipient address or the provider message id, on success or failure', async () => {
    const { job, send, repository } = setup(org => ({ userId: userOf(org), email: `owner@${org}.test`, fullName: 'Pat Owner' }));
    stubEvidence(repository);
    send.mockResolvedValueOnce({ data: { id: 'provider-message-id-synthetic' } });
    send.mockRejectedValueOnce(new Error('socket hang up'));
    const lines = [console.log, console.error, console.warn] as jest.Mock[];
    lines.forEach(l => l.mockClear());

    expect(await job.triggerManual(ORG_A)).toEqual({ sent: 1, skipped: 0, errors: 0 });
    expect(await job.triggerManual(ORG_B)).toEqual({ sent: 0, skipped: 0, errors: 1 });

    const logged = loggedText(lines);
    expect(logged).toContain('A send failed');
    expect(logged).toContain('socket hang up');
    expect(logged).not.toContain('@');
    expect(logged).not.toContain('provider-message-id-synthetic');
    // WE-3a: counts-only -- no organization or user id either.
    for (const id of [ORG_A, ORG_B, userOf(ORG_A), userOf(ORG_B)]) expect(logged).not.toContain(id);
  });

  it('H1: a Resend { error } result is a failed send -- counted as an error, never as sent, with a sanitized log', async () => {
    const { job, send, repository } = setup(org => ({ userId: userOf(org), email: `owner@${org}.test`, fullName: 'Pat Owner' }));
    stubEvidence(repository);
    send.mockResolvedValue({
      data: null,
      error: { name: 'validation_error', message: `Invalid \`to\` field: owner@${ORG_A}.test is not allowed` },
    });
    pageOver(repository, [ORG_A, ORG_B]);
    const errorLog = console.error as jest.Mock;
    const logLine = console.log as jest.Mock;
    errorLog.mockClear();
    logLine.mockClear();

    const scheduled = await runAll(job);
    expect(scheduled).toEqual({ sent: 0, skipped: 0, errors: 2 });

    const manual = await job.triggerManual(ORG_A);
    expect(manual).toEqual({ sent: 0, skipped: 0, errors: 1 });

    // Never logged as a success, and Resend's raw message never reaches the logs.
    const logged = loggedText([errorLog, logLine]);
    expect(logged).not.toContain('✅ Sent');
    expect(logged).toContain('Resend rejected the send (validation_error)');
    expect(logged).not.toContain('is not allowed');
    const complete = logLine.mock.calls.map(c => String(c[0])).find(l => l.includes('[Weekly AI Summary] COMPLETE'));
    expect(complete).toContain('"sent":0');
    expect(complete).toContain('"errors":2');
  });

  it('W: through the real resend SDK, the email carries the html, the text version and exactly the unsubscribe headers', async () => {
    const api = await startFakeResendApi();
    const guard = guardFetch();
    try {
      const { job, repository } = setup(org => ({ userId: userOf(org), email: `owner@${org}.test`, fullName: 'Pat Owner' }));
      stubEvidence(repository);
      (job as any).resend = api.loadAgainst(() => new (require('resend').Resend)(FAKE_RESEND_KEY));

      api.reply(200, { id: 'wire-weekly-1' });
      expect(await job.triggerManual(ORG_B)).toEqual({ sent: 1, skipped: 0, errors: 0 });

      expect(api.requests).toHaveLength(1);
      const { method, path, headers, body } = api.requests[0];
      expect(method).toBe('POST');
      expect(path).toBe('/emails');
      expect(headers.authorization).toBe(`Bearer ${FAKE_RESEND_KEY}`);
      expect(Object.keys(body).sort()).toEqual(['from', 'headers', 'html', 'reply_to', 'subject', 'text', 'to']);
      expect(body.reply_to).toBe('support@getdevcontrol.com');
      expect(body.to).toBe(`owner@${ORG_B}.test`);
      expect(body.subject).toMatch(SUBJECT);
      expect(body.text).toContain('Cloud spend data was unavailable for this period');
      expect(Object.keys(body.headers).sort()).toEqual(['List-Unsubscribe', 'List-Unsubscribe-Post', 'X-Entity-Ref-ID']);
      expect(body.headers['List-Unsubscribe']).toMatch(/^<.+\/api\/user\/preferences\/unsubscribe\?token=v1\.[^>]+>$/);
      expect(body.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
      expect(body.headers['X-Entity-Ref-ID']).toMatch(/^weekly-summary-\d+$/);

      // An API error response is counted as an error, never as sent.
      api.reply(422, { name: 'validation_error', message: 'The to field is invalid.', statusCode: 422 });
      expect(await job.triggerManual(ORG_B)).toEqual({ sent: 0, skipped: 0, errors: 1 });
      expect(api.requests).toHaveLength(2);
    } finally {
      guard.restore();
      await api.close();
    }
    expect(guard.refused).toEqual([]);
  });
  // ─── WE-3a: every eligible owner, paging, one failure never stops the run ───

  const ownerOf = (org: string, n: number) => ({
    userId: `${userOf(org).slice(0, -1)}${n}`,
    email: `owner${n}@${org}.test`,
    fullName: `Owner${n} Person`,
  });
  const tokenOf = (payload: SentMessage) => /[?&]token=([^&>]+)>$/.exec(payload.headers['List-Unsubscribe'])?.[1] ?? '';

  it('WE-D7: two opted-in owners of one org both receive it, each with an unsubscribe token for that owner only', async () => {
    const owners = [ownerOf(ORG_A, 1), ownerOf(ORG_A, 2)];
    const { job, send, repository } = setup(() => owners);
    const gather = stubEvidence(repository);

    expect(await job.triggerManual(ORG_A)).toEqual({ sent: 2, skipped: 0, errors: 0 });

    // The evidence is gathered once for the org; one email per owner.
    expect(gather).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(2);
    const payloads = send.mock.calls.map(c => c[0]);
    expect(payloads.map(p => p.to)).toEqual(owners.map(o => o.email));
    payloads.forEach((payload, i) => {
      const token = tokenOf(payload);
      expect(verifyUnsubscribeToken(token, 'weekly-summary')).toEqual({ kind: 'signed', userId: owners[i].userId });
      for (const body of [payload.html, payload.text]) {
        expect(body).toContain(token);
        // The other owner's link is never in this owner's email.
        expect(body).not.toContain(tokenOf(payloads[1 - i]));
      }
      expect(payload.text).toContain(`Hi ${owners[i].fullName.split(' ')[0]},`);
      expect(payload.subject).toBe(payloads[0].subject);
    });
    expect(tokenOf(payloads[0])).not.toBe(tokenOf(payloads[1]));
  });

  it('WE-3a: a failed send to one owner is counted, and the other owners are still sent', async () => {
    const owners = [ownerOf(ORG_A, 1), ownerOf(ORG_A, 2), ownerOf(ORG_A, 3)];
    const { job, send, repository } = setup(() => owners);
    stubEvidence(repository);
    send.mockImplementation(async (message: SentMessage) => {
      if (message.to === owners[0].email) throw new Error('socket hang up');
      if (message.to === owners[1].email) return { data: null, error: { name: 'rate_limit_exceeded' } };
      return { data: { id: 'email-id' } };
    });

    expect(await job.triggerManual(ORG_A)).toEqual({ sent: 1, skipped: 0, errors: 2 });
    expect(send.mock.calls.map(c => c[0].to)).toEqual(owners.map(o => o.email));
  });

  it('WE-3a: one organization failing never stops the run -- the others are still sent, and the counts say so', async () => {
    const orgs = [ORG_A, ORG_B, 'c0000000-0000-4000-8000-00000000000c'];
    const { job, send, repository } = setup(org => [ownerOf(org, 1), ownerOf(org, 2)]);
    const gather = stubEvidence(repository);
    const real = gather.getMockImplementation()!;
    gather.mockImplementation(async (...args: unknown[]) => {
      if (args[0] === ORG_A) throw new Error(`relation lookup failed for owner1@${ORG_A}.test`);
      return real(...(args as never[]));
    });
    send.mockImplementation(async (message: SentMessage) => {
      if (message.to === `owner2@${ORG_B}.test`) throw new Error('socket hang up');
      return { data: { id: 'provider-message-id-synthetic' } };
    });
    pageOver(repository, orgs);
    const logLine = console.log as jest.Mock;
    const errorLog = console.error as jest.Mock;
    logLine.mockClear();
    errorLog.mockClear();

    expect(await runAll(job)).toEqual({ sent: 3, skipped: 0, errors: 2 });
    expect(send.mock.calls.map(c => c[0].to)).toEqual([
      `owner1@${ORG_B}.test`, `owner2@${ORG_B}.test`, `owner1@${orgs[2]}.test`, `owner2@${orgs[2]}.test`,
    ]);

    const complete = JSON.parse(/COMPLETE (\{.*\})$/.exec(
      logLine.mock.calls.map(c => String(c[0])).find(l => l.includes('[Weekly AI Summary] COMPLETE'))!
    )![1]);
    expect(complete).toMatchObject({
      organizations: 3, pages: 1, recipients: 4, sent: 3, skipped: 0, errors: 2, failedOrganizations: 1, failedSends: 1,
    });
  });

  it('WE-3a: more than one page of eligible orgs (101+) -- every org is visited exactly once, in pages of 100', async () => {
    const orgs = Array.from({ length: 250 }, (_, i) => `c0000000-0000-4000-8000-${(i + 1).toString(16).padStart(12, '0')}`);
    const { job, send, repository } = setup(org => ownerOf(org, 1));
    stubEvidence(repository);
    const pages = pageOver(repository, orgs);

    expect(await runAll(job)).toEqual({ sent: 250, skipped: 0, errors: 0 });

    const visited = send.mock.calls.map(c => /@(.+)\.test$/.exec(c[0].to)![1]);
    expect(visited).toEqual([...orgs].sort());
    expect(new Set(visited).size).toBe(250);
    // Three reads: two full pages and a short last one; each read continues after the previous page's last id.
    expect(pages.mock.calls).toEqual([[null, 100], [[...orgs].sort()[99], 100], [[...orgs].sort()[199], 100]]);
  });

  it('WE-3a: an exact multiple of the page size ends on an empty page, not a missed org', async () => {
    const orgs = Array.from({ length: 200 }, (_, i) => `c0000000-0000-4000-8000-${(i + 1).toString(16).padStart(12, '0')}`);
    const { job, send, repository } = setup(org => ownerOf(org, 1));
    stubEvidence(repository);
    const pages = pageOver(repository, orgs);

    expect(await runAll(job)).toEqual({ sent: 200, skipped: 0, errors: 0 });
    expect(send).toHaveBeenCalledTimes(200);
    expect(pages).toHaveBeenCalledTimes(3);
  });

  it('WE-3a: the run logs carry counts only -- no address, provider id, organization id or user id', async () => {
    const orgs = [ORG_A, ORG_B];
    const { job, send, repository } = setup(org => [ownerOf(org, 1), ownerOf(org, 2)]);
    const gather = stubEvidence(repository);
    const real = gather.getMockImplementation()!;
    gather.mockImplementation(async (...args: unknown[]) => {
      if (args[0] === ORG_B) throw new Error(`read failed for org ${ORG_B} (owner1@${ORG_B}.test)`);
      return real(...(args as never[]));
    });
    send.mockImplementationOnce(async () => ({ data: { id: 'provider-message-id-synthetic' } }));
    send.mockImplementationOnce(async () => { throw new Error(`Invalid to: owner2@${ORG_A}.test`); });
    pageOver(repository, orgs);
    const lines = [console.log, console.error, console.warn] as jest.Mock[];
    lines.forEach(l => l.mockClear());

    expect(await runAll(job)).toEqual({ sent: 1, skipped: 0, errors: 2 });

    const logged = loggedText(lines);
    expect(logged).toContain('[Weekly AI Summary] COMPLETE');
    expect(logged).not.toContain('@');
    expect(logged).not.toContain('provider-message-id-synthetic');
    for (const id of [...orgs, ...orgs.flatMap(o => [ownerOf(o, 1).userId, ownerOf(o, 2).userId])]) {
      expect(logged).not.toContain(id);
    }
  });
  it('WE-3a: a page that does not move past the previous one stops the run -- no organization is sent twice', async () => {
    const orgs = Array.from({ length: 100 }, (_, i) => `c0000000-0000-4000-8000-${(i + 1).toString(16).padStart(12, '0')}`);
    const { job, send, repository } = setup(org => ownerOf(org, 1));
    stubEvidence(repository);
    // A broken page read: the same full page twice, then nothing.
    jest.spyOn(repository, 'getActiveOrganizationsPage')
      .mockResolvedValueOnce(orgs)
      .mockResolvedValueOnce(orgs)
      .mockResolvedValue([]);

    await expect(runAll(job)).rejects.toThrow('Organization paging did not advance');
    expect(send).toHaveBeenCalledTimes(100);
    expect(new Set(send.mock.calls.map(c => c[0].to)).size).toBe(100);
  });
});
