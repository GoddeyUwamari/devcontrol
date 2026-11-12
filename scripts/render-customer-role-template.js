#!/usr/bin/env node
/**
 * Renders a published DevControl CloudFormation template for hosting
 * (AWS connect PR D2). Run by the founder, locally, from the merge commit.
 *
 *   node scripts/render-customer-role-template.js --version 1 \
 *     --platform-account-id <PLATFORM_ACCOUNT_ID> --out devcontrol-role.v1.json
 *
 * The committed template (lib/aws/cloudformation/) holds the placeholder
 * {{PLATFORM_ACCOUNT_ID}} in its trust principal, because the repository is
 * public and holds no real account ID. This script:
 *   - refuses a version that isn't in published-templates.json;
 *   - refuses a source file whose SHA-256 differs from the pinned one;
 *   - refuses an account ID that isn't exactly 12 digits;
 *   - replaces the one placeholder and nothing else (the output is the source
 *     bytes with that substring changed, so a render is reproducible);
 *   - refuses to overwrite an existing file;
 *   - prints the output's SHA-256 (never the account ID).
 * No network, no AWS, no dependencies.
 */
'use strict';

// A plain CommonJS Node script with no build step, like scripts/run-migrations.js.
/* eslint-disable @typescript-eslint/no-require-imports */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
/* eslint-enable @typescript-eslint/no-require-imports */

const TEMPLATE_DIR = path.join(__dirname, '..', 'lib', 'aws', 'cloudformation');
const PLACEHOLDER = '{{PLATFORM_ACCOUNT_ID}}';

function fail(message) {
  process.stderr.write(`render-customer-role-template: ${message}\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!['--version', '--platform-account-id', '--out'].includes(key) || value === undefined) {
      fail('usage: --version <n> --platform-account-id <12 digits> --out <file>');
    }
    if (args[key] !== undefined) fail(`${key} given twice`);
    args[key] = value;
  }
  for (const key of ['--version', '--platform-account-id', '--out']) {
    if (args[key] === undefined) fail(`${key} is required`);
  }
  return args;
}

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifest = JSON.parse(fs.readFileSync(path.join(TEMPLATE_DIR, 'published-templates.json'), 'utf8'));
  const entry = Object.prototype.hasOwnProperty.call(manifest, args['--version']) ? manifest[args['--version']] : null;
  if (!entry) fail(`template version ${JSON.stringify(args['--version'])} is not published`);

  if (!/^\d{12}$/.test(args['--platform-account-id'])) fail('the platform account ID must be exactly 12 digits');

  const source = fs.readFileSync(path.join(TEMPLATE_DIR, entry.file), 'utf8');
  if (sha256(source) !== entry.sourceSha256) fail(`${entry.file} does not match its pinned SHA-256; render only from the commit that published it`);

  const parts = source.split(PLACEHOLDER);
  if (parts.length !== 2) fail(`${entry.file} must contain the placeholder exactly once`);
  const rendered = parts.join(args['--platform-account-id']);
  if (rendered.includes('{{')) fail('the rendered template still contains a placeholder');
  JSON.parse(rendered);

  if (fs.existsSync(args['--out'])) fail(`${args['--out']} already exists; choose a new file`);
  fs.writeFileSync(args['--out'], rendered, { flag: 'wx' });
  process.stdout.write(`SHA-256 ${sha256(rendered)}  ${path.basename(args['--out'])}\n`);
}

main();
