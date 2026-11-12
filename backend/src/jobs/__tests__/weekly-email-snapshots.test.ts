/**
 * The weekly summary email as rendered for the synthetic fixtures C1-C5
 * (weekly-email-fixtures.ts), HTML and plain text, pinned byte for byte in
 * __fixtures__/weekly-email/. A wording change shows up as a diff of these
 * files. To regenerate after an approved change:
 *   WEEKLY_EMAIL_FIXTURES=write npx jest weekly-email-snapshots
 * Nothing is sent: Resend is never configured here.
 */
jest.mock('../../services/aws-cost.service', () => ({
  ...jest.requireActual('../../services/aws-cost.service'),
  __esModule: true,
  default: {
    fetchCostTrend: jest.fn(),
    getCostTrendFetchedAt: jest.fn(async () => '2026-11-16T09:00:00.000Z'),
  },
}));

import * as fs from 'fs';
import * as path from 'path';
import { Pool } from 'pg';
import { composeWeeklySummary } from '../../services/weekly-summary-content';
import { WeeklyAISummaryJob } from '../weekly-ai-summary.job';
import { FIXTURE_IDS, FIXTURE_URLS, fixtureEvidence, type FixtureId } from './weekly-email-fixtures';

const DIR = path.join(__dirname, '__fixtures__', 'weekly-email');
const WRITE = process.env.WEEKLY_EMAIL_FIXTURES === 'write';
const originalResendKey = process.env.RESEND_API_KEY;
let job: WeeklyAISummaryJob;

beforeAll(() => {
  delete process.env.RESEND_API_KEY;
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  job = new WeeklyAISummaryJob({} as Pool);
  if (WRITE) fs.mkdirSync(DIR, { recursive: true });
});

afterAll(() => {
  if (originalResendKey) process.env.RESEND_API_KEY = originalResendKey;
});

async function renderFixture(id: FixtureId): Promise<{ html: string; text: string }> {
  const e = await fixtureEvidence(id);
  const data = job.buildTemplateData({
    userName: 'Alex',
    content: composeWeeklySummary(e),
    recommendation: null,
    ...FIXTURE_URLS,
  });
  data.year = 2026;
  return job.renderEmail(data);
}

describe('weekly summary email fixtures C1-C5', () => {
  it.each(FIXTURE_IDS)('%s renders exactly as pinned', async (id) => {
    const { html, text } = await renderFixture(id);
    for (const [ext, body] of [['html', html], ['txt', text]] as const) {
      const file = path.join(DIR, `${id}.${ext}`);
      if (WRITE) fs.writeFileSync(file, body);
      expect(body).toBe(fs.readFileSync(file, 'utf8'));
    }
  });
});
