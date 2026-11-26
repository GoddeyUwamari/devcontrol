/**
 * D8a-3 GitHubAppEventsJob: the schedules (ruling 9), and static tripwires
 * on the rules the DB suite (github-app-retry.db.test.ts) proves behaviourally:
 * one window definition in hours (ruling 7), the retry built on
 * replayEligibleSql (ruling 5), and nothing deleted (ruling 1). node-cron is
 * mocked, so nothing is scheduled for real.
 */
const mockSchedule = jest.fn<{ stop: jest.Mock }, [string, () => Promise<void>, { timezone?: string }?]>(() => ({ stop: jest.fn() }));
jest.mock('node-cron', () => ({ __esModule: true, default: { schedule: mockSchedule } }));

import fs from 'fs';
import path from 'path';
import { CLEANUP_CRON, EVENTS_JOB_TIMEZONE, GitHubAppEventsJob, RETRY_CRON, rotateAfter } from '../github-app-events.job';

const actualCron = jest.requireActual('node-cron');
const realCron = actualCron.default ?? actualCron;
const SRC = path.join(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');
/** Source without comments, so a rule named in a comment never satisfies or trips a check. */
const code = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

beforeEach(() => mockSchedule.mockClear());

describe('GitHubAppEventsJob schedule (ruling 9)', () => {
  it("retry hourly and cleanup daily at 03:30, both pinned to 'Etc/UTC'", () => {
    const job = new GitHubAppEventsJob({ log: () => undefined });
    job.start();
    expect(mockSchedule.mock.calls.map(([expr, , options]) => [expr, options])).toEqual([
      ['0 * * * *', { timezone: 'Etc/UTC' }],
      ['30 3 * * *', { timezone: 'Etc/UTC' }],
    ]);
    expect([RETRY_CRON, CLEANUP_CRON, EVENTS_JOB_TIMEZONE]).toEqual(['0 * * * *', '30 3 * * *', 'Etc/UTC']);
    for (const expr of [RETRY_CRON, CLEANUP_CRON]) expect(realCron.validate(expr)).toBe(true);
    job.start();
    expect(mockSchedule).toHaveBeenCalledTimes(2);
    job.stop();
  });

  it('server.ts starts it with the other background jobs only', () => {
    const server = code('server.ts');
    const block = server.slice(server.indexOf('if (!startsBackgroundJobs())'), server.indexOf('Failed to start server'));
    expect(block).toMatch(/const gitHubAppEventsJob = new GitHubAppEventsJob\(\);\s*gitHubAppEventsJob\.start\(\);/);
    expect(server.match(/new GitHubAppEventsJob\(/g)).toHaveLength(1);
  });

  it('rotateAfter starts after the cursor and wraps', () => {
    expect(rotateAfter(['a', 'b', 'c'], null)).toEqual(['a', 'b', 'c']);
    expect(rotateAfter(['a', 'b', 'c'], 'a')).toEqual(['b', 'c', 'a']);
    expect(rotateAfter(['a', 'b', 'c'], 'c')).toEqual(['a', 'b', 'c']);
    expect(rotateAfter(['a', 'c'], 'b')).toEqual(['c', 'a']);
  });
});

describe('static tripwires', () => {
  const repo = code('repositories/pipeline-events.repository.ts');

  it('ruling 7: one held-window expression, in hours, on received_at', () => {
    expect(repo.match(/make_interval\(\s*(days|hours)\s*=>/g)?.filter((m) => /days/.test(m)) ?? []).toEqual([]);
    expect(repo.match(/received_at\s*>=\s*NOW\(\)\s*-\s*make_interval/g)).toHaveLength(1);
    expect(repo).toMatch(/function heldWindowSql\(hours: string\): string \{\s*return `received_at >= NOW\(\) - make_interval\(hours => \$\{hours\}\)`;/);
    expect(repo).toMatch(/export const HELD_EVENT_HOURS = HELD_EVENT_DAYS \* 24;/);
    for (const rel of ['repositories/pipeline-repositories.repository.ts', 'routes/github-app-connection.routes.ts', 'services/github-app/retry.ts',
      'services/github-app/replay.ts', 'services/github-app/claim.ts', 'jobs/github-app-events.job.ts']) {
      expect(code(rel)).not.toMatch(/HELD_EVENT_DAYS\s*\]|days:\s*'\$/);
    }
  });

  it('ruling 5: the retry selection is replayEligibleSql narrowed, and the row re-check uses the same selection', () => {
    const fn = repo.slice(repo.indexOf('function retryEligibleSql('), repo.indexOf('function retryEligibleArgs('));
    expect(fn).toMatch(/return `\$\{replayEligibleSql\(\{ statuses: p\.statuses, reasons: p\.reasons, hours: p\.hours \}\)\}\s*AND \(/);
    expect(fn).not.toMatch(/received_at\s*>=|event IN \(/);
    const find = repo.slice(repo.indexOf('export async function findRetryableEvents('), repo.indexOf('export async function lockRetryCandidate('));
    const lock = repo.slice(repo.indexOf('export async function lockRetryCandidate('), repo.indexOf('/** Most recent receipt time'));
    for (const body of [find, lock]) expect(body).toMatch(/organization_id = \$1 AND \$\{RETRY_ELIGIBLE\}/);
    expect(lock).toMatch(/FOR UPDATE/);
  });

  it('ruling 1: nothing in the job, the retry or the events repository deletes, and the held-delivery purge is never called', () => {
    for (const rel of ['jobs/github-app-events.job.ts', 'services/github-app/retry.ts', 'repositories/pipeline-events.repository.ts']) {
      const text = code(rel);
      expect(text).not.toMatch(/\bDELETE\b|\bTRUNCATE\b|github_purge_held_deliveries/i);
    }
    const everywhere = fs.readdirSync(SRC, { recursive: true, encoding: 'utf8' })
      .filter((f) => f.endsWith('.ts') && !f.includes('__tests__'))
      .filter((f) => /github_purge_held_deliveries/.test(code(f)));
    expect(everywhere).toEqual([]);
  });
});
