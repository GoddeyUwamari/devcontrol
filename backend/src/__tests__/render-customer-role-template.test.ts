/**
 * scripts/render-customer-role-template.js (AWS connect PR D2, §2.2): the
 * founder's render step. Run as a child process with the documentation
 * placeholder account only; tampering is tested on a copy in a temp directory.
 */
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'render-customer-role-template.js');
const TEMPLATE_DIR = path.join(REPO_ROOT, 'lib', 'aws', 'cloudformation');
const SOURCE = fs.readFileSync(path.join(TEMPLATE_DIR, 'devcontrol-role.v1.template.json'), 'utf8');
const ACCOUNT = '123456789012';

let work: string;
beforeEach(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'render-template-'));
});
afterEach(() => fs.rmSync(work, { recursive: true, force: true }));

function run(args: string[], script = SCRIPT, cwd?: string) {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', cwd });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}
const PINNED_SOURCE_SHA = JSON.parse(fs.readFileSync(path.join(TEMPLATE_DIR, 'published-templates.json'), 'utf8'))['1'].sourceSha256 as string;

/** A copy of the script and the template directory under `root`, so `root` plays the repository. */
function copyRepoLayout(root: string, template = SOURCE): string {
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(root, 'lib', 'aws', 'cloudformation'), { recursive: true });
  fs.copyFileSync(SCRIPT, path.join(root, 'scripts', 'render.js'));
  fs.copyFileSync(path.join(TEMPLATE_DIR, 'published-templates.json'), path.join(root, 'lib', 'aws', 'cloudformation', 'published-templates.json'));
  fs.writeFileSync(path.join(root, 'lib', 'aws', 'cloudformation', 'devcontrol-role.v1.template.json'), template);
  return path.join(root, 'scripts', 'render.js');
}
const sha256 = (text: string) => crypto.createHash('sha256').update(text).digest('hex');

describe('render-customer-role-template', () => {
  it('replaces the one placeholder and nothing else, and prints the source and output SHA-256 only', () => {
    const out = path.join(work, 'devcontrol-role.v1.json');
    const result = run(['--version', '1', '--platform-account-id', ACCOUNT, '--out', out]);
    expect(result.status).toBe(0);
    const rendered = fs.readFileSync(out, 'utf8');
    expect(rendered).toBe(SOURCE.replace('{{PLATFORM_ACCOUNT_ID}}', ACCOUNT));
    expect(rendered).not.toContain('{{');
    expect(JSON.parse(rendered).Resources.DevControlRole.Properties.AssumeRolePolicyDocument.Statement[0].Principal.AWS).toBe(`arn:aws:iam::${ACCOUNT}:root`);
    expect(result.stdout).toBe(
      `Source SHA-256 ${PINNED_SOURCE_SHA}  devcontrol-role.v1.template.json\n`
      + `SHA-256 ${sha256(rendered)}  devcontrol-role.v1.json\n`
    );
    // The printed source hash is the file's own, and the one pinned in published-templates.json (review L-7).
    expect(sha256(SOURCE)).toBe(PINNED_SOURCE_SHA);
    expect(result.stdout + result.stderr).not.toContain(ACCOUNT);
  });

  it('is reproducible: two renders are byte-identical', () => {
    const a = path.join(work, 'a.json');
    const b = path.join(work, 'b.json');
    expect(run(['--version', '1', '--platform-account-id', ACCOUNT, '--out', a]).status).toBe(0);
    expect(run(['--version', '1', '--platform-account-id', ACCOUNT, '--out', b]).status).toBe(0);
    expect(fs.readFileSync(a)).toEqual(fs.readFileSync(b));
  });

  it.each([
    ['a short account ID', ['--version', '1', '--platform-account-id', '12345']],
    ['a non-numeric account ID', ['--version', '1', '--platform-account-id', 'abcdefghijkl']],
    ['a 13-digit account ID', ['--version', '1', '--platform-account-id', '1234567890123']],
    ['a missing account ID', ['--version', '1']],
    ['an unpublished version', ['--version', '2', '--platform-account-id', ACCOUNT]],
    ['an inherited property as a version', ['--version', 'constructor', '--platform-account-id', ACCOUNT]],
    ['an unknown flag', ['--version', '1', '--platform-account-id', ACCOUNT, '--force', 'yes']],
    ['two account IDs', ['--version', '1', '--platform-account-id', ACCOUNT, '--platform-account-id', '111122223333']],
    ['the same account ID twice', ['--version', '1', '--platform-account-id', ACCOUNT, '--platform-account-id', ACCOUNT]],
    ['two versions', ['--version', '1', '--version', '1', '--platform-account-id', ACCOUNT]],
  ])('refuses %s and writes nothing', (_label, args) => {
    const out = path.join(work, 'out.json');
    const result = run([...args, '--out', out]);
    expect(result.status).toBe(2);
    expect(fs.existsSync(out)).toBe(false);
  });

  it('refuses to overwrite an existing file', () => {
    const out = path.join(work, 'exists.json');
    fs.writeFileSync(out, 'keep');
    expect(run(['--version', '1', '--platform-account-id', ACCOUNT, '--out', out]).status).toBe(2);
    expect(fs.readFileSync(out, 'utf8')).toBe('keep');
  });

  it('refuses a source file that differs from its pinned SHA-256', () => {
    const script = copyRepoLayout(work, SOURCE.replace('DevControlCostExplorerRead', 'Tampered'));
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'render-out-'));
    try {
      const out = path.join(elsewhere, 'out.json');
      const result = run(['--version', '1', '--platform-account-id', ACCOUNT, '--out', out], script);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain('pinned SHA-256');
      expect(fs.existsSync(out)).toBe(false);
    } finally {
      fs.rmSync(elsewhere, { recursive: true, force: true });
    }
  });
});

describe('render-customer-role-template: the output stays outside the repository (review L-1)', () => {
  const probe = 'render-l1-probe.json';

  afterEach(() => {
    // Never leave a file in the checkout, even if an assertion failed.
    for (const leftover of [path.join(REPO_ROOT, probe), path.join(TEMPLATE_DIR, probe)]) fs.rmSync(leftover, { force: true });
  });

  it.each([
    ['the repository root', () => path.join(REPO_ROOT, probe)],
    ['a directory inside the repository', () => path.join(TEMPLATE_DIR, probe)],
    ['a not-yet-existing directory inside the repository', () => path.join(REPO_ROOT, 'no-such-dir', probe)],
    ['the repository root itself', () => REPO_ROOT],
    ['a path that climbs back in', () => path.join(TEMPLATE_DIR, '..', '..', '..', probe)],
  ])('refuses %s and writes nothing', (_label, target) => {
    const out = target();
    const result = run(['--version', '1', '--platform-account-id', ACCOUNT, '--out', out]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('--out must be outside this repository');
    expect(fs.existsSync(path.join(REPO_ROOT, probe))).toBe(false);
    expect(fs.existsSync(path.join(TEMPLATE_DIR, probe))).toBe(false);
    expect(fs.existsSync(path.join(REPO_ROOT, 'no-such-dir'))).toBe(false);
  });

  it('refuses a relative path from the repository root (the old README form)', () => {
    const result = run(['--version', '1', '--platform-account-id', ACCOUNT, '--out', probe], SCRIPT, REPO_ROOT);
    expect(result.status).toBe(2);
    expect(fs.existsSync(path.join(REPO_ROOT, probe))).toBe(false);
  });

  it('refuses a path that reaches the repository through a symlink', () => {
    const link = path.join(work, 'repo-link');
    fs.symlinkSync(REPO_ROOT, link);
    const result = run(['--version', '1', '--platform-account-id', ACCOUNT, '--out', path.join(link, probe)]);
    expect(result.status).toBe(2);
    expect(fs.existsSync(path.join(REPO_ROOT, probe))).toBe(false);
  });

  it('accepts a sibling directory whose name only starts with the repository name', () => {
    const root = path.join(work, 'repo');
    const script = copyRepoLayout(root);
    const sibling = `${root}-sibling`;
    fs.mkdirSync(sibling);
    const out = path.join(sibling, 'devcontrol-role.v1.json');
    const result = run(['--version', '1', '--platform-account-id', ACCOUNT, '--out', out], script);
    expect(result.status).toBe(0);
    expect(fs.readFileSync(out, 'utf8')).toBe(SOURCE.replace('{{PLATFORM_ACCOUNT_ID}}', ACCOUNT));
  });
});
