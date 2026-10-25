/**
 * Transitive packages are pinned only by the lockfile, so a re-lock could
 * resolve an older copy without any manifest change. This reads the version
 * each package actually installed, as the package that loads it resolves it,
 * and fails if any is below its floor.
 */
import fs from 'fs';
import path from 'path';

const BACKEND_ROOT = path.join(__dirname, '..', '..');

/**
 * The directory of `pkg` as `from` (a package directory) resolves it. Walks up
 * from the entry point, since some packages' `exports` hide package.json. A
 * nested build marker (e.g. engine.io-client's build/cjs/package.json) can
 * carry the name but no version, so only a manifest with both counts.
 */
function packageDir(pkg: string, from: string): string {
  let dir = path.dirname(require.resolve(pkg, { paths: [from] }));
  while (dir !== path.dirname(dir)) {
    const manifest = path.join(dir, 'package.json');
    const parsed = fs.existsSync(manifest) ? JSON.parse(fs.readFileSync(manifest, 'utf8')) : null;
    if (parsed?.name === pkg && typeof parsed.version === 'string') return dir;
    dir = path.dirname(dir);
  }
  throw new Error(`no package.json for ${pkg} above its entry point`);
}

/** The installed version of `pkg` as `from` resolves it. */
function installedVersion(pkg: string, from: string): string {
  return JSON.parse(fs.readFileSync(path.join(packageDir(pkg, from), 'package.json'), 'utf8')).version;
}

/** Compares plain x.y.z versions; a pre-release tag counts as below its release. */
function isAtLeast(version: string, floor: string): boolean {
  const [core, pre] = version.split('-', 2);
  const a = core.split('.').map(Number);
  const b = floor.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return pre === undefined;
}

const express = packageDir('express', BACKEND_ROOT);
const bodyParser = packageDir('body-parser', express);
const stripe = packageDir('stripe', BACKEND_ROOT);

describe('installed HTTP stack versions', () => {
  it.each([
    ['body-parser', 'express', express, '1.20.9'],
    ['qs', 'express', express, '6.16.0'],
    ['qs', 'body-parser', bodyParser, '6.16.0'],
    ['qs', 'stripe', stripe, '6.16.0'],
    ['proxy-addr', 'express', express, '2.0.8'],
    ['path-to-regexp', 'express', express, '0.1.13'],
  ])('%s as %s loads it is at least the floor', (pkg, _loader, from, floor) => {
    const version = installedVersion(pkg, from);

    expect({ pkg, version, atLeastFloor: isAtLeast(version, floor) }).toEqual({ pkg, version, atLeastFloor: true });
  });

});

const socketIo = packageDir('socket.io', BACKEND_ROOT);
const socketIoClient = packageDir('socket.io-client', BACKEND_ROOT);
const engineIo = packageDir('engine.io', socketIo);
const engineIoClient = packageDir('engine.io-client', socketIoClient);
const socketIoAdapter = packageDir('socket.io-adapter', socketIo);
const axios = packageDir('axios', BACKEND_ROOT);
const slackWebApi = packageDir('@slack/web-api', BACKEND_ROOT);
const resend = packageDir('resend', BACKEND_ROOT);

describe('installed live-update, template, email and HTTP client stack versions', () => {
  it.each([
    ['engine.io', 'socket.io', socketIo, '6.6.11'],
    ['socket.io-parser', 'socket.io', socketIo, '4.2.7'],
    ['socket.io-parser', 'socket.io-client', socketIoClient, '4.2.7'],
    ['socket.io-adapter', 'socket.io', socketIo, '2.5.8'],
    ['engine.io-client', 'socket.io-client', socketIoClient, '6.6.7'],
    ['ws', 'engine.io', engineIo, '8.21.0'],
    ['ws', 'socket.io-adapter', socketIoAdapter, '8.21.0'],
    ['ws', 'engine.io-client', engineIoClient, '8.21.0'],
    ['handlebars', 'the backend', BACKEND_ROOT, '4.7.10'],
    ['resend', 'the backend', BACKEND_ROOT, '6.34.1'],
    ['form-data', 'axios', axios, '4.0.6'],
    ['form-data', '@slack/web-api', slackWebApi, '4.0.6'],
    ['follow-redirects', 'axios', axios, '1.16.0'],
  ])('%s as %s loads it is at least the floor', (pkg, _loader, from, floor) => {
    const version = installedVersion(pkg, from);

    expect({ pkg, version, atLeastFloor: isAtLeast(version, floor) }).toEqual({ pkg, version, atLeastFloor: true });
  });

  it.each(['mailparser', 'svix'])('resend does not depend on %s', (pkg) => {
    const { dependencies = {}, optionalDependencies = {} } = JSON.parse(fs.readFileSync(path.join(resend, 'package.json'), 'utf8'));

    expect(Object.keys({ ...dependencies, ...optionalDependencies })).not.toContain(pkg);
  });
});

describe('version comparison', () => {
  it('the comparison itself', () => {
    expect(isAtLeast('2.0.8', '2.0.8')).toBe(true);
    expect(isAtLeast('2.0.10', '2.0.8')).toBe(true);
    expect(isAtLeast('2.1.0', '2.0.8')).toBe(true);
    expect(isAtLeast('2.0.7', '2.0.8')).toBe(false);
    expect(isAtLeast('1.20.10', '1.20.9')).toBe(true);
    expect(isAtLeast('0.1.12', '0.1.13')).toBe(false);
    expect(isAtLeast('2.0.8-beta.1', '2.0.8')).toBe(false);
  });
});
