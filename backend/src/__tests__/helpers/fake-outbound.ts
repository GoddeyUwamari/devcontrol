/**
 * Stubs for tests of outbound destinations (utils/safe-outbound.ts).
 *
 *   - stubDns: answers dns.lookup from a map. Unmapped names fail as
 *     ENOTFOUND, except 'localhost' (the test database), so no test resolves a
 *     real name. The map can be changed between calls to simulate rebinding.
 *   - fakeHttpsRequest: replaces https.request, records the options and body
 *     of each call and answers with a fake response that records whether
 *     anything read it.
 *   - guardNetwork: fails any socket connect to a non-loopback address, before
 *     it is made, and records it, so a test can assert that nothing reached
 *     the network.
 *
 * Stub addresses are in public ranges (documentation ranges are refused by
 * the code under test). Nothing ever connects to them.
 */
import dns from 'node:dns';
import https from 'node:https';
import net from 'node:net';
import { EventEmitter } from 'events';
import { Readable } from 'stream';

export const PUBLIC_V4 = '93.184.215.14';
export const PUBLIC_V6 = '2606:4700::1111';

export type DnsAnswer = string[] | Error | 'hang';

/** Stubs dns.lookup with `map` (hostname to addresses, an error, or 'hang'). */
export function stubDns(map: Record<string, DnsAnswer>): jest.SpyInstance {
  const realLookup = dns.lookup;
  return jest.spyOn(dns, 'lookup').mockImplementation(((hostname: string, options: any, callback?: any) => {
    const done = typeof options === 'function' ? options : callback;
    const opts = typeof options === 'object' && options !== null ? options : {};
    if (hostname === 'localhost' && !(hostname in map)) {
      return (realLookup as any).call(dns, hostname, opts, done);
    }
    // An IP literal (for example a local server's listen address) answers as itself.
    const answer = net.isIP(hostname) && !(hostname in map) ? [hostname] : map[hostname];
    if (answer === 'hang') return;
    process.nextTick(() => {
      if (answer === undefined) {
        done(Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' }));
      } else if (answer instanceof Error) {
        done(answer);
      } else {
        const entries = answer.map((address) => ({ address, family: net.isIP(address) }));
        if (opts.all) done(null, entries);
        else if (entries.length === 0) done(Object.assign(new Error('no addresses'), { code: 'ENODATA' }));
        else done(null, entries[0].address, entries[0].family);
      }
    });
  }) as any);
}

/** A response whose body records whether it was ever pulled, listened to for data, or destroyed. */
export class FakeResponse extends Readable {
  statusCode: number;
  statusMessage = '';
  headers: Record<string, string>;
  pulled = false;
  dataListened = false;
  chunksPulled = 0;
  private chunks: Buffer[];

  constructor(status: number, body: string | Buffer[] = '', headers: Record<string, string> = {}) {
    super({ highWaterMark: 0 });
    this.statusCode = status;
    this.headers = headers;
    this.chunks = typeof body === 'string' ? (body ? [Buffer.from(body)] : []) : [...body];
    this.on('newListener', (event) => {
      if (event === 'data') this.dataListened = true;
    });
  }

  _read(): void {
    this.pulled = true;
    const next = this.chunks.shift();
    if (next) this.chunksPulled += 1;
    this.push(next ?? null);
  }
}

export class FakeRequest extends EventEmitter {
  destroyed = false;
  destroyError?: Error;
  written: Buffer[] = [];

  write(chunk: any): boolean {
    if (chunk) this.written.push(Buffer.from(chunk));
    return true;
  }

  end(chunk?: any): this {
    if (chunk && typeof chunk !== 'function') this.write(chunk);
    this.emit('ended');
    return this;
  }

  setTimeout(_ms: number, callback?: () => void): this {
    if (callback) this.on('timeout', callback);
    return this;
  }

  destroy(error?: Error): this {
    if (this.destroyed) return this;
    this.destroyed = true;
    this.destroyError = error;
    process.nextTick(() => {
      if (error) this.emit('error', error);
      this.emit('close');
    });
    return this;
  }

  abort(): void {
    this.destroy();
  }

  setHeader(): void {}
  getHeader(): undefined {
    return undefined;
  }
  removeHeader(): void {}
  setNoDelay(): void {}
  setSocketKeepAlive(): void {}
}

export interface FakeAnswer {
  status?: number;
  body?: string | Buffer[];
  headers?: Record<string, string>;
  /** Never answer. */
  hang?: boolean;
  /** Fail the request with this error. */
  error?: Error;
}

export interface FakeCall {
  options: any;
  req: FakeRequest;
  res?: FakeResponse;
  body(): string;
  url(): string;
}

/** Replaces https.request; each call is answered by `answer` (changeable through the returned setter). */
export function fakeHttpsRequest(initial: FakeAnswer | ((options: any) => FakeAnswer) = { status: 200 }) {
  let answer = initial;
  const calls: FakeCall[] = [];
  const spy = jest.spyOn(https, 'request').mockImplementation(((...args: any[]) => {
    const options = typeof args[0] === 'object' && !(args[0] instanceof URL) ? args[0] : args[1];
    const callback = args.find((arg) => typeof arg === 'function');
    const req = new FakeRequest();
    const call: FakeCall = {
      options,
      req,
      body: () => Buffer.concat(req.written).toString('utf8'),
      url: () => {
        const port = options.port && Number(options.port) !== 443 ? `:${options.port}` : '';
        const host = net.isIP(options.hostname) === 6 ? `[${options.hostname}]` : options.hostname ?? options.host;
        return `https://${host}${port}${options.path ?? '/'}`;
      },
    };
    calls.push(call);
    if (callback) req.once('response', callback);
    req.once('ended', () => {
      const current = typeof answer === 'function' ? answer(options) : answer;
      if (current.hang) return;
      setImmediate(() => {
        if (req.destroyed) return;
        if (current.error) {
          req.emit('error', current.error);
          return;
        }
        const res = new FakeResponse(current.status ?? 200, current.body, current.headers);
        call.res = res;
        req.emit('response', res);
      });
    });
    return req;
  }) as any);
  return {
    spy,
    calls,
    answer(next: FakeAnswer | ((options: any) => FakeAnswer)) {
      answer = next;
    },
  };
}

/** Records a connect attempt that would have left the machine; it is failed before any packet is sent. */
export interface NetworkGuard {
  attempts: string[];
  restore(): void;
}

const isLoopback = (address: string) =>
  address === '::1' || address === '::ffff:127.0.0.1' || (net.isIP(address) === 4 && address.startsWith('127.'));

/** Fails, and records, any TCP connect to an address that is not loopback. */
export function guardNetwork(): NetworkGuard {
  const attempts: string[] = [];
  const realConnect = net.Socket.prototype.connect;
  const blocked = () => Object.assign(new Error('blocked by the test network guard'), { code: 'ENETUNREACH' });

  net.Socket.prototype.connect = function guardedConnect(this: net.Socket, ...args: any[]) {
    const normalized = Array.isArray(args[0]);
    const first = normalized ? args[0][0] : args[0];
    let options: any =
      typeof first === 'object' && first !== null ? { ...first } : typeof first === 'number' ? { port: first, host: args[1] } : { path: first };
    // As in net: a truthy path is a local pipe; anything else is TCP (agents pass path: null).
    if (!options.path) {
      const host: string = options.host ?? 'localhost';
      if (net.isIP(host)) {
        if (!isLoopback(host)) {
          attempts.push(`${host}:${options.port}`);
          process.nextTick(() => this.destroy(blocked()));
          return this;
        }
      } else if (host !== 'localhost') {
        const lookup = options.lookup ?? dns.lookup;
        options = {
          ...options,
          lookup: (name: string, lookupOptions: any, callback: (...rest: any[]) => void) =>
            lookup(name, lookupOptions, (error: Error | null, address: any, family?: number) => {
              if (error) return callback(error);
              const list: string[] = Array.isArray(address) ? address.map((entry) => entry.address) : [address];
              const outside = list.filter((entry) => !isLoopback(entry));
              if (outside.length > 0) {
                attempts.push(...outside.map((entry) => `${name}=${entry}:${options.port}`));
                return callback(blocked());
              }
              return callback(null, address, family);
            }),
        };
      }
    }
    const rebuilt = normalized ? [[options, ...args[0].slice(1)], ...args.slice(1)] : typeof first === 'object' ? [options, ...args.slice(1)] : args;
    if (normalized) (rebuilt[0] as any)[NORMALIZED] = (args[0] as any)[NORMALIZED];
    return (realConnect as any).apply(this, rebuilt);
  } as any;

  return {
    attempts,
    restore() {
      net.Socket.prototype.connect = realConnect;
    },
  };
}

// Node marks pre-normalised connect arguments with an internal symbol; it is copied across when they are rebuilt.
const NORMALIZED: unique symbol = (() => {
  const probe = (net as any)._normalizeArgs ? (net as any)._normalizeArgs([{ port: 1 }]) : [];
  const symbol = Object.getOwnPropertySymbols(probe)[0];
  return (symbol ?? Symbol('unused')) as any;
})();
