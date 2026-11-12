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

function run(args: string[], script = SCRIPT) {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}
const sha256 = (text: string) => crypto.createHash('sha256').update(text).digest('hex');

describe('render-customer-role-template', () => {
  it('replaces the one placeholder and nothing else, and prints the SHA-256 of the output only', () => {
    const out = path.join(work, 'devcontrol-role.v1.json');
    const result = run(['--version', '1', '--platform-account-id', ACCOUNT, '--out', out]);
    expect(result.status).toBe(0);
    const rendered = fs.readFileSync(out, 'utf8');
    expect(rendered).toBe(SOURCE.replace('{{PLATFORM_ACCOUNT_ID}}', ACCOUNT));
    expect(rendered).not.toContain('{{');
    expect(JSON.parse(rendered).Resources.DevControlRole.Properties.AssumeRolePolicyDocument.Statement[0].Principal.AWS).toBe(`arn:aws:iam::${ACCOUNT}:root`);
    expect(result.stdout).toBe(`SHA-256 ${sha256(rendered)}  devcontrol-role.v1.json\n`);
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
    fs.mkdirSync(path.join(work, 'scripts'));
    fs.mkdirSync(path.join(work, 'lib', 'aws', 'cloudformation'), { recursive: true });
    fs.copyFileSync(SCRIPT, path.join(work, 'scripts', 'render.js'));
    fs.copyFileSync(path.join(TEMPLATE_DIR, 'published-templates.json'), path.join(work, 'lib', 'aws', 'cloudformation', 'published-templates.json'));
    fs.writeFileSync(path.join(work, 'lib', 'aws', 'cloudformation', 'devcontrol-role.v1.template.json'), SOURCE.replace('DevControlCostExplorerRead', 'Tampered'));
    const out = path.join(work, 'out.json');
    const result = run(['--version', '1', '--platform-account-id', ACCOUNT, '--out', out], path.join(work, 'scripts', 'render.js'));
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('pinned SHA-256');
    expect(fs.existsSync(out)).toBe(false);
  });
});
