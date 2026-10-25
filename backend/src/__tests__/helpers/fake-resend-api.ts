/**
 * A local stand-in for the Resend HTTP API, for tests that run the real
 * resend SDK rather than a mock of it.
 *
 *   - startFakeResendApi: listens on 127.0.0.1, records every request (method,
 *     path, headers, JSON body) and answers with the status and body the test
 *     sets.
 *   - loadAgainst: runs `load` with RESEND_BASE_URL pointing at the fake, in a
 *     fresh module registry. resend 6.9.x reads RESEND_BASE_URL once when the
 *     module loads, later versions when a client is constructed, so both the
 *     require and the `new Resend(...)` must happen inside `load`.
 *
 *   - guardFetch: replaces the global fetch (which the SDK sends with) so a
 *     request to anything but 127.0.0.1 fails before it is made, and is
 *     recorded. guardNetwork() in fake-outbound does not see these requests:
 *     Node's built-in fetch does not connect through the patched net.Socket.
 *
 * Clients are given FAKE_RESEND_KEY, which the real API refuses, so no email
 * can be sent even if the base URL were ignored.
 */
import http from 'http';
import { AddressInfo } from 'net';

export const FAKE_RESEND_KEY = 're_test_not_a_real_key';

export interface RecordedResendRequest {
  method: string;
  path: string;
  headers: http.IncomingHttpHeaders;
  body: any;
}

export interface FakeResendApi {
  baseUrl: string;
  requests: RecordedResendRequest[];
  /** The answer to every following request. Not JSON is sent as-is. */
  reply(status: number, body: unknown): void;
  loadAgainst<T>(load: () => T): T;
  close(): Promise<void>;
}

export interface FetchGuard {
  /** URLs of the requests that were refused. */
  refused: string[];
  restore(): void;
}

export function guardFetch(): FetchGuard {
  const realFetch = globalThis.fetch;
  const refused: string[] = [];
  globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname !== '127.0.0.1') {
      refused.push(url.href);
      return Promise.reject(new TypeError(`fetch to ${url.host} blocked by the test fetch guard`));
    }
    return realFetch(input, init);
  }) as typeof fetch;
  return {
    refused,
    restore() {
      globalThis.fetch = realFetch;
    },
  };
}

export async function startFakeResendApi(): Promise<FakeResendApi> {
  const requests: RecordedResendRequest[] = [];
  let answer = { status: 200, body: '{"id":"fake-email-id"}' };

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      requests.push({ method: req.method ?? '', path: req.url ?? '', headers: req.headers, body: raw ? JSON.parse(raw) : undefined });
      res.writeHead(answer.status, { 'Content-Type': 'application/json' }).end(answer.body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    baseUrl,
    requests,
    reply(status, body) {
      answer = { status, body: typeof body === 'string' ? body : JSON.stringify(body) };
    },
    loadAgainst<T>(load: () => T): T {
      const previous = process.env.RESEND_BASE_URL;
      process.env.RESEND_BASE_URL = baseUrl;
      try {
        let loaded: T | undefined;
        jest.isolateModules(() => {
          loaded = load();
        });
        return loaded as T;
      } finally {
        if (previous === undefined) delete process.env.RESEND_BASE_URL;
        else process.env.RESEND_BASE_URL = previous;
      }
    },
    close() {
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
