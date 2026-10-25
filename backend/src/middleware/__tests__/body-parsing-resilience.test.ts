/**
 * The real body-parsing chain (applyBodyParsing + notFoundHandler + errorHandler)
 * answers unusual compressed request bodies with a complete response below 500,
 * and the process keeps serving afterwards. The statuses are the ones the
 * installed parser gives today; gzip rejects bytes after its stream (400),
 * deflate ignores them (200).
 *
 * The app runs in a child process, so a failure that ends the process shows up
 * as an assertion here instead of taking the Jest worker down with it.
 */
import { ChildProcess, spawn } from 'child_process';
import http from 'http';
import path from 'path';
import zlib from 'zlib';

const BACKEND_ROOT = path.join(__dirname, '..', '..', '..');

// Transpiles the backend's .ts sources on require, so the child runs the real
// modules without a build or a ts-node dependency.
const CHILD = `
const fs = require('fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, file) => {
  const { outputText } = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: file,
  });
  module._compile(outputText, file);
};
const [srcDir] = process.argv.slice(1);
const express = require('express');
const { applyBodyParsing } = require(srcDir + '/middleware/body-parsing');
const { errorHandler, notFoundHandler } = require(srcDir + '/middleware/error-handler');
const app = express();
applyBodyParsing(app);
app.post('/api/probe', (req, res) => res.json({ body: typeof req.body, keys: Object.keys(req.body ?? {}) }));
app.post('/api/stripe/webhook', (req, res) =>
  res.json({ raw: Buffer.isBuffer(req.body), base64: Buffer.isBuffer(req.body) ? req.body.toString('base64') : null })
);
app.use(notFoundHandler);
app.use(errorHandler);
const server = app.listen(0, '127.0.0.1', () => console.log('PORT=' + server.address().port));
`;

let child: ChildProcess;
let port: number;
let stderr = '';

beforeAll(async () => {
  child = spawn(process.execPath, ['-e', CHILD, path.join(BACKEND_ROOT, 'src')], {
    cwd: BACKEND_ROOT,
    env: { PATH: process.env.PATH ?? '', NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr!.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8');
  });
  port = await new Promise<number>((resolve, reject) => {
    let stdout = '';
    child.stdout!.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      const match = stdout.match(/PORT=(\d+)/);
      if (match) resolve(Number(match[1]));
    });
    child.once('exit', (code) => reject(new Error(`child exited before listening (code ${code}): ${stderr}`)));
  });
}, 60_000);

afterAll(() => {
  if (child.exitCode === null) child.kill();
});

/** A POST with exact headers and bytes, so no client rewrites the body. */
function rawPost(urlPath: string, headers: http.OutgoingHttpHeaders, body: Buffer): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: urlPath, method: 'POST', headers: { ...headers, 'Content-Length': body.length } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    req.end(body);
  });
}

const JSON_BODY = Buffer.from(JSON.stringify({ name: 'probe', count: 1 }));
const FORM_BODY = Buffer.from('name=probe&count=1');
const EXTRA_BYTES = Buffer.from('extra bytes that are not part of the compressed stream');
const JSON_TYPE = { 'Content-Type': 'application/json' };
const FORM_TYPE = { 'Content-Type': 'application/x-www-form-urlencoded' };

/** A valid compressed body followed by bytes that are not part of it. */
const withExtraBytes = (compressed: Buffer) => Buffer.concat([compressed, EXTRA_BYTES]);

describe('compressed request bodies through the real parser chain', () => {
  it.each([
    ['gzip JSON with extra bytes', '/api/probe', { ...JSON_TYPE, 'Content-Encoding': 'gzip' }, withExtraBytes(zlib.gzipSync(JSON_BODY)), 400],
    ['deflate JSON with extra bytes', '/api/probe', { ...JSON_TYPE, 'Content-Encoding': 'deflate' }, withExtraBytes(zlib.deflateSync(JSON_BODY)), 200],
    ['gzip urlencoded with extra bytes', '/api/probe', { ...FORM_TYPE, 'Content-Encoding': 'gzip' }, withExtraBytes(zlib.gzipSync(FORM_BODY)), 400],
    ['gzip JSON with extra bytes on a raw-body webhook path', '/api/stripe/webhook', { ...JSON_TYPE, 'Content-Encoding': 'gzip' }, withExtraBytes(zlib.gzipSync(JSON_BODY)), 400],
    ['gzip JSON with extra bytes on an unknown path', '/api/no-such-route', { ...JSON_TYPE, 'Content-Encoding': 'gzip' }, withExtraBytes(zlib.gzipSync(JSON_BODY)), 400],
    ['deflate JSON with extra bytes on an unknown path', '/api/no-such-route', { ...JSON_TYPE, 'Content-Encoding': 'deflate' }, withExtraBytes(zlib.deflateSync(JSON_BODY)), 404],
    ['corrupt compressed body', '/api/probe', { ...JSON_TYPE, 'Content-Encoding': 'gzip' }, Buffer.concat([zlib.gzipSync(JSON_BODY).subarray(0, 10), EXTRA_BYTES]), 400],
    ['unsupported content encoding', '/api/probe', { ...JSON_TYPE, 'Content-Encoding': 'unsupported-coding' }, JSON_BODY, 415],
  ])('%s: complete response, status %s', async (_label, urlPath, headers, body, status) => {
    const res = await rawPost(urlPath, headers, body);

    expect(res.status).toBe(status);
    expect(res.status).toBeLessThan(500);
  });

  it('the Stripe webhook route receives the body as a raw Buffer, byte for byte as sent', async () => {
    // Spacing and a number format (1.50) that a JSON parse and re-serialise
    // would not keep, so only the untouched bytes match.
    const sent = Buffer.from('{ "id" : "evt_probe",\n  "type":"invoice.paid" , "n": 1.50 }');

    const res = await rawPost('/api/stripe/webhook', JSON_TYPE, sent);

    expect(res.status).toBe(200);
    const received = JSON.parse(res.body);
    expect(received.raw).toBe(true);
    expect(Buffer.from(received.base64, 'base64').equals(sent)).toBe(true);
  });

  it('the process is still serving afterwards, with nothing uncaught on stderr', async () => {
    await new Promise((resolve) => setTimeout(resolve, 500));

    const control = await rawPost('/api/probe', JSON_TYPE, JSON_BODY);

    expect(control.status).toBe(200);
    expect(JSON.parse(control.body)).toEqual({ body: 'object', keys: ['name', 'count'] });
    expect(child.exitCode).toBeNull();
    expect(stderr).not.toMatch(/uncaught|unhandled/i);
  });
});
