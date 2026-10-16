/**
 * errorHandler logs name, message, stack, type and status only -- never the
 * error object -- and answers a body that is not valid JSON with 400.
 */
import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';
import { inspect } from 'util';
import { errorHandler } from '../error-handler';
import { BadRequestError } from '../../utils/errors';

const SENTINEL = 'Sentinel-Passw0rd-d41f';

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
    expect(logged).toMatchObject({ name: 'Error', message: 'Missing field', status: 400 });
  });
});
