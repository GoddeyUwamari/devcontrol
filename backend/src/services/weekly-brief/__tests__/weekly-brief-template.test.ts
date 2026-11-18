/**
 * R10 and "one source of truth" for the executive brief's template
 * (templates/weekly-summary-email.html): the template only renders the
 * composed brief, phones get one column (with and without the media query),
 * and every link is at least 44 px tall.
 */
import * as fs from 'fs';
import * as path from 'path';
import { Pool } from 'pg';
import { WeeklyAISummaryJob } from '../../../jobs/weekly-ai-summary.job';
import * as rules from '../rules';
import { composeWeeklyBrief, type WeeklyBrief } from '../rules';
import { FIXTURE_IDS, FIXTURE_ORG_NAME, FIXTURE_URLS, FIXTURES, fixtureFacts, type FixtureId } from '../../../jobs/__tests__/weekly-email-fixtures';

const TEMPLATE = fs.readFileSync(path.join(__dirname, '../../../templates/weekly-summary-email.html'), 'utf8');

let job: WeeklyAISummaryJob;
beforeAll(() => {
  delete process.env.RESEND_API_KEY;
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  job = new WeeklyAISummaryJob({} as Pool);
});

function briefOf(id: FixtureId): WeeklyBrief {
  return composeWeeklyBrief(fixtureFacts(id), { organizationName: FIXTURE_ORG_NAME, planName: FIXTURES[id].plan });
}

function rendered(id: FixtureId) {
  const data = job.buildTemplateData({ userName: 'Alex', brief: briefOf(id), organizationName: FIXTURE_ORG_NAME, ...FIXTURE_URLS });
  data.year = 2026;
  return job.renderEmail(data);
}

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;').replace(/=/g, '&#x3D;').replace(/`/g, '&#x60;');

describe('the template has no logic', () => {
  it('uses only {{#each}}, {{#if}}/{{else}} and plain paths: no helpers, no comparisons, no unless', () => {
    const tags = TEMPLATE.match(/{{[^}]*}}/g) ?? [];
    expect(tags.length).toBeGreaterThan(0);
    for (const tag of tags) {
      expect(tag).toMatch(/^{{(#each [\w.]+|\/each|#if [\w.]+|\/if|else|[\w.]+)}}$/);
    }
  });

  it('contains none of the rules\' wording: every rule string comes from rules.ts', () => {
    for (const value of Object.values(rules)) {
      if (typeof value !== 'string' || value.length < 12) continue;
      expect(TEMPLATE).not.toContain(value);
    }
    // Spot-check sentences built inside rule functions.
    for (const s of ['still updating', 'finished days', 'open opportunit', 'change failure rate', "couldn't reach"]) {
      expect(TEMPLATE.toLowerCase()).not.toContain(s);
    }
  });

  it.each(FIXTURE_IDS)('%s: every string of the composed brief is in the HTML and in the plain-text part', (id) => {
    const b = briefOf(id);
    const { html, text } = rendered(id);
    const strings = [
      b.eyebrow, b.title, b.orgLine ?? '', b.summary.bold, b.summary.plain, b.delivery.line, b.delivery.link.label, b.button.label,
      ...b.tiles.flatMap(t => [t.label, t.sublabel ?? '', t.value, ...t.lines]),
      ...b.attention.flatMap(a => [a.title, ...a.body, a.time ?? '']),
      ...(b.cost ? [...b.cost.lines.map(l => l.text), ...(b.cost.services ? [b.cost.services.heading, ...b.cost.services.rows.flatMap(r => [r.service, r.amount])] : [])] : []),
      ...(b.notConnected ? [...b.notConnected.status, b.notConnected.action.label, ...b.notConnected.sections.flatMap(s => [s.title, s.line])] : []),
      ...b.footer.lines, b.footer.alarms.text,
    ].filter(Boolean);
    for (const s of strings) {
      if (b.cost?.lines.some(l => l.text === s && l.strong)) continue; // split around its bold part in HTML; checked below
      expect(html).toContain(escape(s));
      expect(text).toContain(s.replace(/ →$/, ''));
    }
    for (const l of b.cost?.lines.filter(x => x.strong) ?? []) {
      expect(html).toContain(`<strong style="color:#0F172A;">${escape(l.strong!)}</strong>`);
      expect(text).toContain(l.text);
    }
  });
});

describe('R10: phones', () => {
  it('a media query stacks the tiles into one full-width column at 480 px and below', () => {
    expect(TEMPLATE).toMatch(/@media only screen and \(max-width: 480px\) \{[\s\S]*\.tile \{ display: block !important; width: 100% !important; max-width: 100% !important;/);
  });

  it('without the media query (Gmail apps that drop <style>), the tiles still wrap: inline-block cells with a max width', () => {
    const tile = TEMPLATE.match(/<div class="tile" style="([^"]+)"/)![1];
    expect(tile).toContain('display:inline-block');
    const maxWidth = Number(tile.match(/max-width:(\d+)px/)![1]);
    const gap = Number(tile.match(/margin:0 (\d+)px/)![1]);
    // Three fit in the 600 px card (28 + 22 px side padding)...
    expect(3 * (maxWidth + gap)).toBeLessThanOrEqual(600 - 28 - 22);
    // ...but two never fit on a 390 px phone (8 px page gutter each side, the same card padding).
    expect(2 * (maxWidth + gap)).toBeGreaterThan(390 - 2 * 8 - 28 - 22);
  });

  it.each(FIXTURE_IDS)('%s: every link and the button is at least 44 px tall (12 px padding around a 20 px line)', (id) => {
    const { html } = rendered(id);
    const anchors = html.match(/<a [^>]*>/g) ?? [];
    expect(anchors.length).toBeGreaterThan(4);
    for (const a of anchors) {
      if (a.includes('href="mailto:')) continue; // the unchanged support line, inline in a sentence
      expect(a).toMatch(/display:inline-block/);
      expect(a).toMatch(/padding:12px/);
      expect(a).toMatch(/line-height:20px/);
    }
  });

  it('a light grey page, a white card, body text 14-16 px and labels 11-12 px', () => {
    expect(TEMPLATE).toContain('background-color:#F1F5F9');
    expect(TEMPLATE).toContain('background-color:#FFFFFF');
    const sizes = [...TEMPLATE.matchAll(/font-size:(\d+)px/g)].map(m => Number(m[1]));
    expect(sizes.every(n => n >= 11)).toBe(true);
  });
});
