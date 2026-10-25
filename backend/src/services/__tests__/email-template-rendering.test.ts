/**
 * Every email template, compiled from disk the way EmailService and
 * WeeklyAISummaryJob compile it, renders to exactly the same bytes as when the
 * hashes below were recorded (handlebars 4.7.9). A change of the template
 * engine or of a template shows up here as a changed hash.
 *
 * Each template renders twice: every variable set to a value with HTML
 * special characters (so every {{#if}} branch is taken and escaping is
 * pinned), and every variable empty (so every {{#if}} branch is skipped).
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import Handlebars from 'handlebars';

const TEMPLATES_DIR = path.join(__dirname, '..', '..', 'templates');

const PINNED_SHA256: Record<string, { filled: string; empty: string }> = {
  'invitation-email.html': {
    filled: '72ba6bec7fdc0db07529fd58ee465b335960f5b76e2a295eaf2834de0851e0ca',
    empty: '16d7062bbb4a4acd721f808fa873daecaca56857a1ce6ebbceaa0779cf31d3bc',
  },
  'password-reset-email.html': {
    filled: 'd1d56322ea96f77be847c6cf8327f00769fd95c740da194e8c1cf902e6d3f621',
    empty: '01bc92a77381952008c8860c43021c500813ad2176485d618c7c0bd80fc5cea2',
  },
  'payment-failed-email.html': {
    filled: '9b5c3db86369de96f8e105a5a61f9014cb0392fd86dddc4923934fdc6a0a19b6',
    empty: '36334c304520e1db40865ecf38b87fe418a5a527ccf74d6825beb338af7beef2',
  },
  'verification-email.html': {
    filled: '01f8718ca1a4694c93ef4cff28233f6583ba2985e4de3e312c0e8a247e422603',
    empty: '9ed8470341e602ea82507dbf362b322bd1f1518a2bc52b7ce418fc2710cf77a0',
  },
  'weekly-summary-email.html': {
    filled: '59ee65d107150a4589d901d4db9f7674ede671b169ed198bc9d40a7bc5152cdc',
    empty: 'c692e0df20e3dda5bd41da27ed1086df40e0aa31c70e909f23949f67d82e7dbb',
  },
};

/** The names a template reads: {{name}} and {{#if name}}. */
function variablesOf(source: string): string[] {
  const names = new Set<string>();
  for (const match of source.matchAll(/{{\s*(?:#if\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*}}/g)) names.add(match[1]);
  return [...names].sort();
}

function render(filename: string, valueFor: (name: string) => string): string {
  const source = fs.readFileSync(path.join(TEMPLATES_DIR, filename), 'utf-8');
  const data = Object.fromEntries(variablesOf(source).map((name) => [name, valueFor(name)]));
  return Handlebars.compile(source)(data);
}

const sha256 = (text: string) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

describe('rendered email templates', () => {
  it('covers every template on disk', () => {
    expect(fs.readdirSync(TEMPLATES_DIR).filter((f) => f.endsWith('.html')).sort()).toEqual(Object.keys(PINNED_SHA256));
  });

  it.each(Object.keys(PINNED_SHA256))('%s renders byte for byte as recorded', (filename) => {
    const filled = render(filename, (name) => `<b>&"'\`= ${name}`);
    const empty = render(filename, () => '');

    expect(filled).not.toContain('{{');
    expect(filled).toContain('&lt;b&gt;&amp;&quot;&#x27;&#x60;&#x3D; ');
    expect({ filename, filled: sha256(filled), empty: sha256(empty) }).toEqual({ filename, ...PINNED_SHA256[filename] });
  });
});
