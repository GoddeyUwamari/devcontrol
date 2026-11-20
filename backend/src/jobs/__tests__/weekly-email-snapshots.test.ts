/**
 * The weekly summary email (executive brief) as rendered for the synthetic
 * fixtures A-G (weekly-email-fixtures.ts), HTML and plain text, pinned byte
 * for byte in __fixtures__/weekly-email/. A wording or layout change shows up
 * as a diff of these files. To regenerate after an approved change:
 *   WEEKLY_EMAIL_FIXTURES=write npx jest weekly-email-snapshots
 * The preview script (backend/scripts/weekly-email-preview.js) sets
 * WEEKLY_EMAIL_PREVIEW_DIR to also write each fixture's HTML there.
 * Nothing is sent: Resend is never configured here.
 */
import * as fs from 'fs';
import * as path from 'path';
import { Pool } from 'pg';
import { composeWeeklyBrief } from '../../services/weekly-brief/rules';
import { WeeklyAISummaryJob } from '../weekly-ai-summary.job';
import { FIXTURE_IDS, FIXTURE_ORG_NAME, FIXTURE_URLS, FIXTURES, fixtureFacts, type FixtureId } from './weekly-email-fixtures';

const DIR = path.join(__dirname, '__fixtures__', 'weekly-email');
const WRITE = process.env.WEEKLY_EMAIL_FIXTURES === 'write';
const PREVIEW_DIR = process.env.WEEKLY_EMAIL_PREVIEW_DIR;
const originalResendKey = process.env.RESEND_API_KEY;
let job: WeeklyAISummaryJob;

beforeAll(() => {
  delete process.env.RESEND_API_KEY;
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  job = new WeeklyAISummaryJob({} as Pool);
  if (WRITE) fs.mkdirSync(DIR, { recursive: true });
  if (PREVIEW_DIR) fs.mkdirSync(PREVIEW_DIR, { recursive: true });
});

afterAll(() => {
  if (originalResendKey) process.env.RESEND_API_KEY = originalResendKey;
});

export function templateDataFor(id: FixtureId) {
  const data = job.buildTemplateData({
    userName: 'Alex',
    brief: composeWeeklyBrief(fixtureFacts(id), { organizationName: FIXTURE_ORG_NAME, planName: FIXTURES[id].plan }),
    organizationName: FIXTURE_ORG_NAME,
    ...FIXTURE_URLS,
  });
  data.year = 2026;
  return data;
}

describe('weekly summary email fixtures A-G', () => {
  it.each(FIXTURE_IDS)('%s: the subject carries the cost window (WE-D12)', (id) => {
    expect(templateDataFor(id).subject).toBe('Your DevControl weekly summary · Nov 9 – 15, 2026');
  });

  it.each(FIXTURE_IDS)('%s renders exactly as pinned', (id) => {
    const { html, text } = job.renderEmail(templateDataFor(id));
    if (PREVIEW_DIR) fs.writeFileSync(path.join(PREVIEW_DIR, `${id}.html`), html);
    for (const [ext, body] of [['html', html], ['txt', text]] as const) {
      const file = path.join(DIR, `${id}.${ext}`);
      if (WRITE) fs.writeFileSync(file, body);
      expect(body).toBe(fs.readFileSync(file, 'utf8'));
    }
  });
});
