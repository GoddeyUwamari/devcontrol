/**
 * The live-update server's transport layer, before any authentication: the
 * polling handshake and its CORS headers, malformed polling and upgrade
 * requests, and malformed packets. Every request gets a complete answer (or
 * the connection is closed), and the process keeps serving afterwards.
 *
 * The real WebSocketServer runs in a child process, so a failure that ends
 * the process shows up as an assertion here instead of taking the Jest worker
 * down with it. Requests are written by hand (raw HTTP and WebSocket frames),
 * so no client library rewrites them.
 */
import { ChildProcess, spawn } from 'child_process';
import crypto from 'crypto';
import http from 'http';
import net from 'net';
import path from 'path';

const BACKEND_ROOT = path.join(__dirname, '..', '..', '..');
const FRONTEND_URL = 'https://app.example.com';

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
const http = require('http');
const { WebSocketServer } = require(srcDir + '/websocket/server');
const server = http.createServer((req, res) => res.writeHead(404).end());
new WebSocketServer(server);
server.listen(0, '127.0.0.1', () => console.log('PORT=' + server.address().port));
`;

let child: ChildProcess;
let port: number;
let stderr = '';

beforeAll(async () => {
  child = spawn(process.execPath, ['-e', CHILD, path.join(BACKEND_ROOT, 'src')], {
    cwd: BACKEND_ROOT,
    env: {
      PATH: process.env.PATH ?? '',
      NODE_ENV: 'test',
      FRONTEND_URL,
      JWT_SECRET: process.env.JWT_SECRET ?? 'transport-resilience-test-secret-32chars',
      ENCRYPTION_KEY: process.env.ENCRYPTION_KEY ?? 'transport-resilience-test-key-32chars',
    },
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

interface RawResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

/** One HTTP request with exact headers and bytes; rejects if no complete answer arrives in time. */
function rawRequest(method: string, urlPath: string, headers: http.OutgoingHttpHeaders = {}, body?: Buffer): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: urlPath,
        method,
        agent: false,
        headers: body === undefined ? headers : { ...headers, 'Content-Length': body.length },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
        res.on('error', reject);
      }
    );
    req.setTimeout(2000, () => req.destroy(new Error(`no complete response to ${method} ${urlPath} within 2000 ms`)));
    req.on('error', reject);
    req.end(body);
  });
}

/** Opens an Engine.IO polling session and returns its id. */
async function pollingSession(): Promise<string> {
  const res = await rawRequest('GET', '/socket.io/?EIO=4&transport=polling');
  expect(res.status).toBe(200);
  return JSON.parse(res.body.slice(1)).sid;
}

/** A WebSocket upgrade request; resolves with the open socket on 101, or the HTTP status it was refused with. */
function upgrade(urlPath: string): Promise<{ status: number; socket?: net.Socket; received: Buffer[] }> {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: urlPath,
      agent: false,
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': crypto.randomBytes(16).toString('base64'),
      },
    });
    req.on('upgrade', (res, socket, head) => {
      const received: Buffer[] = head.length > 0 ? [head] : [];
      socket.on('data', (c: Buffer) => received.push(c));
      socket.on('error', () => {});
      resolve({ status: res.statusCode ?? 0, socket, received });
    });
    req.on('response', (res) => {
      res.resume();
      resolve({ status: res.statusCode ?? 0, received: [] });
    });
    req.setTimeout(2000, () => req.destroy(new Error(`no answer to the upgrade of ${urlPath} within 2000 ms`)));
    req.on('error', reject);
    req.end();
  });
}

/** Sends one masked text frame, as a WebSocket client must. */
function sendText(socket: net.Socket, text: string): void {
  const payload = Buffer.from(text, 'utf8');
  const mask = crypto.randomBytes(4);
  const header =
    payload.length < 126
      ? Buffer.from([0x81, 0x80 | payload.length])
      : Buffer.from([0x81, 0x80 | 126, payload.length >> 8, payload.length & 0xff]);
  const masked = Buffer.from(payload.map((byte, i) => byte ^ mask[i % 4]));
  socket.write(Buffer.concat([header, mask, masked]));
}

/** Opcodes of the (unmasked, server-sent) frames received so far. */
function frameOpcodes(received: Buffer[]): number[] {
  const data = Buffer.concat(received);
  const opcodes: number[] = [];
  let offset = 0;
  while (offset + 2 <= data.length) {
    let length = data[offset + 1] & 0x7f;
    let headerLength = 2;
    if (length === 126) {
      length = data.readUInt16BE(offset + 2);
      headerLength = 4;
    } else if (length === 127) {
      length = Number(data.readBigUInt64BE(offset + 2));
      headerLength = 10;
    }
    opcodes.push(data[offset] & 0x0f);
    offset += headerLength + length;
  }
  return opcodes;
}

/** Resolves true once the server has sent a close frame or ended the connection, false if neither happens in time. */
function closedByServer(socket: net.Socket, received: Buffer[], withinMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const closed = () => socket.destroyed || frameOpcodes(received).includes(0x8);
    if (closed()) return resolve(true);
    const timer = setTimeout(() => {
      clearInterval(poll);
      resolve(closed());
    }, withinMs);
    const poll = setInterval(() => {
      if (!closed()) return;
      clearTimeout(timer);
      clearInterval(poll);
      resolve(true);
    }, 20);
    socket.once('close', () => {
      clearTimeout(timer);
      clearInterval(poll);
      resolve(true);
    });
  });
}

describe('polling handshake', () => {
  it('answers the frontend origin with credentialed CORS headers', async () => {
    const res = await rawRequest('GET', '/socket.io/?EIO=4&transport=polling', { Origin: FRONTEND_URL });

    expect(res.status).toBe(200);
    expect(res.body).toMatch(/^0\{"sid":"/);
    expect(res.headers['access-control-allow-origin']).toBe(FRONTEND_URL);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('never allows another origin or any origin', async () => {
    const res = await rawRequest('GET', '/socket.io/?EIO=4&transport=polling', { Origin: 'https://other.example.net' });

    expect(res.headers['access-control-allow-origin']).toBe(FRONTEND_URL);
    expect(res.headers['access-control-allow-origin']).not.toBe('*');
  });
});

describe('malformed transport requests', () => {
  it('a binary polling POST gets a complete 400 response', async () => {
    const sid = await pollingSession();

    const res = await rawRequest(
      'POST',
      `/socket.io/?EIO=4&transport=polling&sid=${sid}`,
      { 'Content-Type': 'application/octet-stream' },
      Buffer.from([0x04, 0xff, 0x00, 0x13])
    );

    expect(res.status).toBe(400);
  });

  it('a WebSocket upgrade of a session without its protocol revision is refused', async () => {
    const sid = await pollingSession();

    const res = await upgrade(`/socket.io/?transport=websocket&sid=${sid}`);
    if (res.socket) {
      // Upgraded anyway: drive the transport the way a client would.
      sendText(res.socket, '2probe');
      sendText(res.socket, '5');
      sendText(res.socket, '4{"probe":true}');
      await new Promise((resolve) => setTimeout(resolve, 300));
      res.socket.destroy();
    }

    expect(res.status).toBe(400);
  });

  it.each([
    ['more binary attachments than allowed', '4511-["x"]'],
    ['a binary packet with zero attachments', '450-["x"]'],
  ])('a packet announcing %s closes the connection', async (_label, frame) => {
    const res = await upgrade('/socket.io/?EIO=4&transport=websocket');
    expect(res.status).toBe(101);
    const socket = res.socket!;

    sendText(socket, frame);
    const closed = await closedByServer(socket, res.received, 1000);
    socket.destroy();

    expect(closed).toBe(true);
  });
});

describe('afterwards', () => {
  it('the process is still serving, with nothing uncaught on stderr', async () => {
    await new Promise((resolve) => setTimeout(resolve, 500));

    const control = await rawRequest('GET', '/socket.io/?EIO=4&transport=polling', { Origin: FRONTEND_URL });

    expect(control.status).toBe(200);
    expect(child.exitCode).toBeNull();
    expect(stderr).not.toMatch(/uncaught|unhandled/i);
  });
});
