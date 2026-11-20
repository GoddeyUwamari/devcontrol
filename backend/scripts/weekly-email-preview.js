#!/usr/bin/env node
/**
 * Weekly summary email preview: renders the synthetic fixtures A-G
 * (src/jobs/__tests__/weekly-email-fixtures.ts) through the real facts, rules,
 * template and job, writes <id>.html, and screenshots each at 680 px
 * (desktop) and 390 px (phone) with headless Chrome. It also writes
 * <id>-nostyle.html with the <style> block removed (as a client that drops it
 * would show the email) and screenshots that at 390 px.
 *
 *   node backend/scripts/weekly-email-preview.js [--out <dir>]
 *
 * Synthetic data only; nothing is sent, nothing reads a database or AWS.
 * Chrome: CHROME_PATH, or the macOS default location.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const backend = path.resolve(__dirname, '..');
const outArg = process.argv.indexOf('--out');
const out = path.resolve(outArg > -1 ? process.argv[outArg + 1] : path.join(os.tmpdir(), 'weekly-email-preview'));
const chrome = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const IDS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
const SHOTS = [
  { suffix: '680', width: 680, height: 2600, nostyle: false },
  { suffix: '390', width: 390, height: 3600, nostyle: false },
  { suffix: '390-nostyle', width: 390, height: 3600, nostyle: true },
];

fs.mkdirSync(out, { recursive: true });

// Render through the snapshot test (it also checks the pinned files), writing each fixture's HTML to `out`.
execFileSync('npx', ['jest', 'src/jobs/__tests__/weekly-email-snapshots', '--silent'], {
  cwd: backend,
  stdio: 'inherit',
  env: { ...process.env, WEEKLY_EMAIL_PREVIEW_DIR: out },
});

/**
 * Headless Chrome will not make a window narrower than about 500 px, so a
 * 390 px window would lay the page out wider and crop it. Each shot loads the
 * email in an iframe exactly `width` px wide (its own viewport: the media
 * query sees that width), in a window at least 600 px wide, then crops the
 * PNG to `width` with macOS sips (it crops around the centre, where the frame is).
 */
for (const id of IDS) {
  const html = path.join(out, `${id}.html`);
  const nostyle = path.join(out, `${id}-nostyle.html`);
  fs.writeFileSync(nostyle, fs.readFileSync(html, 'utf8').replace(/<style>[\s\S]*?<\/style>/, ''));
  for (const shot of SHOTS) {
    const png = path.join(out, `${id}-${shot.suffix}.png`);
    const frame = path.join(out, `.frame-${id}-${shot.suffix}.html`);
    const src = path.basename(shot.nostyle ? nostyle : html);
    const window = Math.max(shot.width, 600);
    // sips crops around the centre, so the frame is centred in the window.
    const left = Math.floor((window - shot.width) / 2);
    fs.writeFileSync(frame, `<!DOCTYPE html><html><body style="margin:0;background:#fff"><iframe src="${src}" style="display:block;border:0;margin-left:${left}px;width:${shot.width}px;height:${shot.height}px"></iframe></body></html>`);
    execFileSync(chrome, [
      '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
      `--window-size=${window},${shot.height}`, `--screenshot=${png}`, `file://${frame}`,
    ], { stdio: 'ignore' });
    if (window !== shot.width) execFileSync('sips', ['--cropToHeightWidth', String(shot.height), String(shot.width), png], { stdio: 'ignore' });
    fs.unlinkSync(frame);
    console.log(png);
  }
}
