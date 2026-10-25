/**
 * errorHandler logs name, code, message, stack, type and status only -- never the
 * error object -- answers a body that is not valid JSON with 400, and answers a
 * body the parser rejects with its 4xx status and a fixed message.
 */
import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';
import { inspect } from 'util';
import zlib from 'zlib';
import { errorHandler } from '../error-handler';
import { BadRequestError } from '../../utils/errors';

const SENTINEL = 'Sentinel-Passw0rd-d41f';
const ENCODING_SENTINEL = 'sentinel-encoding-7c2e';

let server: http.Server;
let baseUrl: string;
let thrown: unknown;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.post('/api/auth/login', () => {
    throw new Error('login handler must not run for an unparseable body');
  });
  app.get('/throws', () => {
    throw thrown;
  });
  app.use(errorHandler);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

let spies: jest.SpyInstance[];

beforeEach(() => {
  spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
    jest.spyOn(console, m).mockImplementation(() => {})
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

function loggedText(): string {
  return spies
    .flatMap((s) => s.mock.calls)
    .flat()
    .map((arg) => `${String(arg)}\n${inspect(arg, { depth: 8, showHidden: true })}`)
    .join('\n');
}

describe('malformed JSON body', () => {
  it.each([
    ['truncated JSON', `{"email":"user@example.test","password":"${SENTINEL}"`],
    ['trailing garbage', `{"email":"user@example.test","password":"${SENTINEL}"} x`],
    // V8 quotes the start of this input in its SyntaxError message
    ['not JSON at all', `password=${SENTINEL}`],
  ])('%s: 400 INVALID_JSON and the body never reaches the logger', async (_label, body) => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, error: 'Invalid JSON body', code: 'INVALID_JSON' });
    const errorSpy = console.error as unknown as jest.SpyInstance;
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][1]).toEqual({
      name: 'SyntaxError',
      type: 'entity.parse.failed',
      status: 400,
      message: 'Invalid JSON body',
    });
    expect(loggedText()).not.toContain(SENTINEL);
  });
});

describe('other errors', () => {
  it('unexpected error: only the listed fields, not properties hanging off the error', async () => {
    thrown = Object.assign(new Error('upstream call failed'), {
      config: { data: JSON.stringify({ password: SENTINEL }) },
      response: { data: SENTINEL },
    });

    const res = await fetch(`${baseUrl}/throws`);

    expect(res.status).toBe(500);
    const errorSpy = console.error as unknown as jest.SpyInstance;
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logged = errorSpy.mock.calls[0][1];
    expect(Object.keys(logged).sort()).toEqual(['message', 'name', 'stack', 'status', 'type']);
    expect(logged).toMatchObject({ name: 'Error', message: 'upstream call failed' });
    expect(loggedText()).not.toContain(SENTINEL);
  });

  it('AppError: status from statusCode, response unchanged', async () => {
    thrown = new BadRequestError('Missing field');

    const res = await fetch(`${baseUrl}/throws`);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, error: 'Missing field', code: 'BAD_REQUEST' });
    const logged = (console.error as unknown as jest.SpyInstance).mock.calls[0][1];
    expect(logged).toMatchObject({ name: 'Error', code: 'BAD_REQUEST', message: 'Missing field', status: 400 });
  });
});

/** A POST with exact headers and bytes, so no client rewrites the body. */
function rawPost(urlPath: string, headers: http.OutgoingHttpHeaders, body: Buffer): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(`${baseUrl}${urlPath}`, { method: 'POST', headers: { ...headers, 'Content-Length': body.length } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

describe('request body the parser rejects', () => {
  const credentials = Buffer.from(JSON.stringify({ email: 'user@example.test', password: SENTINEL }));

  it.each([
    [
      'undecodable compressed body',
      { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' },
      Buffer.concat([zlib.gzipSync(credentials).subarray(0, 10), Buffer.from(`not compressed ${SENTINEL}`)]),
      400,
      { success: false, error: 'Invalid request body', code: 'BAD_REQUEST' },
    ],
    [
      'body over the size limit',
      { 'Content-Type': 'application/json' },
      Buffer.from(JSON.stringify({ password: SENTINEL, pad: 'x'.repeat(200 * 1024) })),
      413,
      { success: false, error: 'Request body too large', code: 'PAYLOAD_TOO_LARGE' },
    ],
    [
      'unsupported content encoding',
      { 'Content-Type': 'application/json', 'Content-Encoding': ENCODING_SENTINEL },
      credentials,
      415,
      { success: false, error: 'Unsupported request body encoding', code: 'UNSUPPORTED_MEDIA_TYPE' },
    ],
  ])('%s: its 4xx status, a fixed message, and the handler never runs', async (_label, headers, body, status, expected) => {
    const res = await rawPost('/api/auth/login', headers, body);

    expect(res.status).toBe(status);
    expect(JSON.parse(res.body)).toEqual(expected);
    expect(res.body).not.toContain(ENCODING_SENTINEL);
    const errorSpy = console.error as unknown as jest.SpyInstance;
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][1]).toMatchObject({ status });
    expect(loggedText()).not.toContain(SENTINEL);
  });

  it('an error that only looks like a rejected body (expose not set) still answers 500', async () => {
    thrown = Object.assign(new Error('upstream call failed'), { type: 'some.type', status: 413 });

    const res = await fetch(`${baseUrl}/throws`);

    expect(res.status).toBe(500);
  });
});
