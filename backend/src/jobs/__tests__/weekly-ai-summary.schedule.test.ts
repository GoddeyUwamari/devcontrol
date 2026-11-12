/**
 * WeeklyAISummaryJob.start(): the cron registration (WE-D8) and the run-level
 * ERROR marker. node-cron is mocked, so nothing is scheduled for real; the
 * repository is stubbed and no email leaves the process.
 */
const mockSchedule = jest.fn<{ stop: jest.Mock }, [string, () => Promise<void>, { timezone?: string }?]>(() => ({ stop: jest.fn() }));
jest.mock('node-cron', () => ({ __esModule: true, default: { schedule: mockSchedule } }));

import { Pool } from 'pg';
import { WeeklyAISummaryJob, WEEKLY_SUMMARY_CRON, WEEKLY_SUMMARY_TIMEZONE } from '../weekly-ai-summary.job';
import type { WeeklySummaryRepository } from '../../repositories/weekly-summary.repository';

const actualCron = jest.requireActual('node-cron');
const realCron = actualCron.default ?? actualCron;

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

beforeEach(() => mockSchedule.mockClear());

function newJob() {
  const pool = { connect: jest.fn(async () => ({ query: jest.fn(async () => ({ rows: [] })), release: jest.fn() })) };
  const job = new WeeklyAISummaryJob(pool as unknown as Pool);
  (job as unknown as { resend: unknown }).resend = { emails: { send: jest.fn(async () => ({ data: { id: 'email-id' } })) } };
  return job;
}

describe('WeeklyAISummaryJob schedule (WE-D8)', () => {
  it("registers Mondays at 09:00 with the time zone pinned to 'Etc/UTC'", () => {
    newJob().start();

    expect(mockSchedule).toHaveBeenCalledTimes(1);
    const [expression, , options] = mockSchedule.mock.calls[0];
    expect(expression).toBe('0 9 * * 1');
    expect(WEEKLY_SUMMARY_CRON).toBe('0 9 * * 1');
    expect(options).toEqual({ timezone: 'Etc/UTC' });
    expect(WEEKLY_SUMMARY_TIMEZONE).toBe('Etc/UTC');
    expect(realCron.validate(expression)).toBe(true);
  });

  it("'Etc/UTC' is a zone the runtime resolves, at UTC's offset", () => {
    const monday = new Date('2026-11-16T09:00:00.000Z');
    const local = new Intl.DateTimeFormat('en-US', {
      timeZone: WEEKLY_SUMMARY_TIMEZONE, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).format(monday);
    expect(local).toBe('Mon 09:00');
  });

  it('a page read that fails ends the run with one ERROR marker -- no organization id or address in it', async () => {
    const job = newJob();
    const repository = (job as unknown as { repository: WeeklySummaryRepository }).repository;
    jest.spyOn(repository, 'getActiveOrganizationsPage').mockRejectedValue(
      new Error('connection terminated while reading c0000000-0000-4000-8000-00000000000a for owner@example.test')
    );
    const errorLog = console.error as jest.Mock;
    errorLog.mockClear();

    job.start();
    const run = mockSchedule.mock.calls[0][1];
    await run();

    const markers = errorLog.mock.calls.map(c => String(c[0])).filter(l => l.includes('[Weekly AI Summary] ERROR'));
    expect(markers).toHaveLength(1);
    expect(markers[0]).toContain('connection terminated');
    expect(markers[0]).not.toContain('@');
    expect(markers[0]).not.toContain('c0000000-0000-4000-8000-00000000000a');
  });
});
