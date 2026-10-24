/**
 * utils/safe-outbound.ts: which destinations are refused, and how a request
 * to an allowed one is made (pinned lookup, no redirects, no body read, a
 * total deadline). dns.lookup and https.request are stubbed; the network
 * guard proves nothing left the machine.
 */
import https from 'node:https';
import net from 'node:net';
import { inspect } from 'util';
import {
  OutboundRefused,
  assertDestination,
  checkSmtpSyntax,
  checkUrlSyntax,
  isBlockedAddress,
  isForbiddenWebhookHeader,
  resolvePublic,
  safeHttpsPost,
  safeLookup,
} from '../safe-outbound';
import { PUBLIC_V4, PUBLIC_V6, fakeHttpsRequest, guardNetwork, stubDns, NetworkGuard } from '../../__tests__/helpers/fake-outbound';

let guard: NetworkGuard;

beforeEach(() => {
  guard = guardNetwork();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  guard.restore();
  expect(guard.attempts).toEqual([]);
});

async function refusal(promise: Promise<unknown>): Promise<OutboundRefused> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(OutboundRefused);
    return error as OutboundRefused;
  }
  throw new Error('expected a refusal');
}

function expectNotAllowed(error: OutboundRefused): void {
  expect(error.code).toBe('not_allowed');
  expect(error.message).toBe('destination not allowed');
}

describe('the network guard', () => {
  it('fails a connect to a public address before it is made, and records it', async () => {
    const socket = net.connect({ host: PUBLIC_V4, port: 443 });
    const error = await new Promise<Error>((resolve) => socket.once('error', resolve));
    expect(error.message).toBe('blocked by the test network guard');
    expect(guard.attempts).toEqual([`${PUBLIC_V4}:443`]);
    guard.attempts.length = 0;
  });

  it.each([
    ['an options object with a string port', () => net.connect({ host: PUBLIC_V4, port: '443' as unknown as number })],
    ['a string port and host', () => net.connect('443' as unknown as number, PUBLIC_V4)],
    ['a numeric port and host', () => net.connect(443, PUBLIC_V4)],
    // net.connect normalises its arguments first; a socket's own connect gets them as given.
    ['a socket connect with a string port and host', () => new net.Socket().connect('443' as unknown as number, PUBLIC_V4)],
  ])('fails a connect given %s', async (_label, connect) => {
    const socket = connect();
    const error = await new Promise<Error>((resolve) => socket.once('error', resolve));
    expect(error.message).toBe('blocked by the test network guard');
    expect(guard.attempts).toEqual([`${PUBLIC_V4}:443`]);
    guard.attempts.length = 0;
  });

  it('fails a connect by name given a string port', async () => {
    stubDns({ 'a.example': [PUBLIC_V4] });
    const socket = net.connect('443' as unknown as number, 'a.example');
    const error = await new Promise<Error>((resolve) => socket.once('error', resolve));
    expect(error.message).toBe('blocked by the test network guard');
    expect(guard.attempts).toEqual([`a.example=${PUBLIC_V4}:443`]);
    guard.attempts.length = 0;
  });

  it('also fails an HTTPS request by name through an agent (which passes path: null to net)', async () => {
    stubDns({ 'a.example': [PUBLIC_V4] });
    const req = https.request({ hostname: 'a.example', port: 443, path: '/x', method: 'POST', agent: new https.Agent({ keepAlive: false }) });
    const error = await new Promise<Error>((resolve) => {
      req.once('error', resolve);
      req.end();
    });
    expect(error.message).toBe('blocked by the test network guard');
    expect(guard.attempts).toEqual([`a.example=${PUBLIC_V4}:443`]);
    guard.attempts.length = 0;
  });
});

describe('U1: URL forms that are refused', () => {
  const refused: unknown[] = [
    'http://a.example',
    'https://127.0.0.1',
    'https://2130706433',
    'https://0x7f000001',
    'https://0x7f.1',
    'https://0177.0.0.1',
    'https://127.1',
    'https://0.0.0.0',
    'https://[::]',
    'https://[::1]',
    'https://[::ffff:127.0.0.1]',
    'https://[::ffff:7f00:1]',
    'https://[::ffff:a9fe:a9fe]',
    'https://[0:0:0:0:0:ffff:169.254.169.254]',
    'https://[::127.0.0.1]',
    'https://169.254.169.254',
    'https://[fd00:ec2::254]',
    'https://[fe80::1]',
    'https://[fec0::1]',
    'https://[ff02::1]',
    'https://[64:ff9b::a9fe:a9fe]',
    'https://[2002:a9fe:a9fe::1]',
    'https://[2001::1]',
    'https://10.0.0.1',
    'https://172.16.0.1',
    'https://172.31.255.255',
    'https://192.168.1.1',
    'https://100.64.0.1',
    'https://100.127.255.255',
    'https://198.18.0.1',
    'https://224.0.0.1',
    'https://255.255.255.255',
    'https://localhost',
    'https://a.localhost',
    'https://localhost.',
    'https://unsafe.example.',
    'https://intranet',
    'https://user:pw@a.example',
    'https://a.example%2f@b',
    ' https://a.example/\n',
    42,
  ];

  it.each(refused.map((value) => [inspect(value), value]))('%s', async (_label, value) => {
    stubDns({});
    let syntaxError: unknown;
    try {
      checkUrlSyntax(value, 'public-https');
    } catch (error) {
      syntaxError = error;
    }
    expect(syntaxError).toBeInstanceOf(OutboundRefused);
    expectNotAllowed(syntaxError as OutboundRefused);
    expectNotAllowed(await refusal(assertDestination(value, 'public-https')));
  });

  it.each([
    ['0.0.0.0/8', '0.1.2.3'],
    ['10.0.0.0/8', '10.255.255.255'],
    ['100.64.0.0/10', '100.100.100.100'],
    ['127.0.0.0/8', '127.255.0.1'],
    ['169.254.0.0/16', '169.254.1.1'],
    ['172.16.0.0/12', '172.20.0.1'],
    ['192.0.0.0/24', '192.0.0.8'],
    ['192.0.2.0/24', '192.0.2.10'],
    ['192.88.99.0/24', '192.88.99.1'],
    ['192.168.0.0/16', '192.168.200.1'],
    ['198.18.0.0/15', '198.19.255.255'],
    ['198.51.100.0/24', '198.51.100.7'],
    ['203.0.113.0/24', '203.0.113.9'],
    ['224.0.0.0/4', '239.1.1.1'],
    ['240.0.0.0/4', '250.0.0.1'],
  ])('IPv4 %s is blocked (%s)', (_range, ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  it.each([
    '::',
    '::1',
    '::ffff:8.8.8.8',
    '::8.8.8.8',
    '64:ff9b::808:808',
    '64:ff9b:1::1',
    '100::1',
    'fc00::1',
    'fd00:ec2::253',
    'fe80::1',
    'fec0::1',
    'ff00::1',
    '2001:db8::1',
    '2001:10::1',
    '2001:20::1',
    '3fff::1',
    'not-an-ip',
  ])('IPv6 or non-IP %s is blocked', (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });
});

describe('U1b: addresses just outside each range are accepted', () => {
  it.each([
    '9.255.255.255',
    '11.0.0.1',
    '100.63.255.255',
    '100.128.0.1',
    '169.253.255.255',
    '172.15.255.255',
    '172.32.0.1',
    '192.167.255.255',
    '192.169.0.1',
    '198.20.0.1',
    '[2606:4700::1111]',
  ])('%s', async (host) => {
    stubDns({});
    expect(checkUrlSyntax(`https://${host}/x`, 'public-https').protocol).toBe('https:');
    await expect(assertDestination(`https://${host}/x`, 'public-https')).resolves.toBeUndefined();
  });
});

describe('U2: the Slack policy accepts only the two Slack webhook hosts, exactly', () => {
  it.each([
    'https://hooks.slack.com/services/T/B/x',
    'https://hooks.slack-gov.com/services/T/B/x',
    'https://HOOKS.SLACK.COM/x',
  ])('accepts %s', async (value) => {
    stubDns({ 'hooks.slack.com': [PUBLIC_V4], 'hooks.slack-gov.com': [PUBLIC_V4] });
    expect(() => checkUrlSyntax(value, 'slack-webhook')).not.toThrow();
    await expect(assertDestination(value, 'slack-webhook')).resolves.toBeUndefined();
  });

  it.each([
    'https://slack-gov.com/x',
    'https://hooks.slack-gov.com.unsafe.example/x',
    'https://otherhooks.slack-gov.com/x',
    'https://hooks.slack-gov.com./x',
    'https://hooks.slack.com.unsafe.example/x',
    'https://otherhooks.slack.com/x',
    'https://hooks.slack.com:8443/x',
    'https://hooks.slack.com@unsafe.example/x',
    'https://hooks.slack.com./x',
    'https://hooks.slаck.com/x',
    'http://hooks.slack.com/x',
    'https://hooks.example/x',
  ])('refuses %s', async (value) => {
    stubDns({});
    expect(() => checkUrlSyntax(value, 'slack-webhook')).toThrow(OutboundRefused);
    expectNotAllowed(await refusal(assertDestination(value, 'slack-webhook')));
  });
});

describe('U3: resolvePublic checks every answer', () => {
  it('accepts a name whose answers are all public', async () => {
    stubDns({ 'a.example': [PUBLIC_V4, PUBLIC_V6] });
    await expect(resolvePublic('a.example')).resolves.toEqual([
      { address: PUBLIC_V4, family: 4 },
      { address: PUBLIC_V6, family: 6 },
    ]);
  });

  it.each([
    ['one private answer among public ones', [PUBLIC_V4, '10.0.0.5']],
    ['an IPv4-mapped private answer', ['::ffff:10.0.0.1']],
    ['no answer', []],
  ])('refuses %s', async (_label, answer) => {
    stubDns({ 'a.example': answer as string[] });
    expectNotAllowed(await refusal(resolvePublic('a.example')));
  });

  it('refuses a name that does not resolve', async () => {
    stubDns({});
    expectNotAllowed(await refusal(resolvePublic('missing.example')));
  });

  it('refuses a lookup that never answers, after 5 seconds', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    stubDns({ 'slow.example': 'hang' });
    let settled: OutboundRefused | undefined;
    resolvePublic('slow.example').catch((error) => {
      settled = error;
    });
    await jest.advanceTimersByTimeAsync(4_999);
    expect(settled).toBeUndefined();
    await jest.advanceTimersByTimeAsync(1);
    expect(settled).toBeInstanceOf(OutboundRefused);
    expectNotAllowed(settled!);
  });
});

describe('U4: a DNS failure and a private address are indistinguishable', () => {
  it('gives an identical error', async () => {
    stubDns({ 'private.example': ['10.0.0.5'] });
    const missing = await refusal(assertDestination('https://missing.example/x', 'public-https'));
    const internal = await refusal(assertDestination('https://private.example/x', 'public-https'));
    expect(missing.code).toBe(internal.code);
    expect(missing.message).toBe(internal.message);
    expect(JSON.stringify(missing)).toBe(JSON.stringify(internal));
    expect(String(missing)).toBe(String(internal));
    expect(inspect(missing)).not.toContain('missing.example');
    expect(inspect(internal)).not.toContain('10.0.0.5');
  });
});

describe('U5: SMTP host and port', () => {
  it.each([
    ['2130706433', 587],
    ['0x7f.1', 587],
    ['127.1', 587],
    ['::1', 587],
    ['::ffff:127.0.0.1', 587],
    ['fe80::1%en0', 587],
    ['mail.example.', 587],
    ['mail', 587],
    ['a/b', 587],
    ['a@b', 587],
    ['localhost', 587],
    [42, 587],
    ['smtp.example.com', 6379],
    ['smtp.example.com', 0],
    ['smtp.example.com', 65536],
    ['smtp.example.com', NaN],
    ['smtp.example.com', '587'],
  ])('refuses %p on port %p', (host, port) => {
    expect(() => checkSmtpSyntax(host, port)).toThrow(OutboundRefused);
  });

  it.each([25, 465, 587, 2525])('accepts smtp.example.com on port %p', (port) => {
    expect(checkSmtpSyntax('smtp.example.com', port)).toEqual({ host: 'smtp.example.com', port });
  });

  it('canonicalises the host the way a URL host is', () => {
    expect(checkSmtpSyntax('  SMTP.Example.COM ', 587)).toEqual({ host: 'smtp.example.com', port: 587 });
  });
});

describe('U6: safeLookup answers only with checked addresses', () => {
  const lookup = (name: string, options: object) =>
    new Promise<unknown[]>((resolve) => (safeLookup as any)(name, options, (...args: unknown[]) => resolve(args)));

  it('all: true gets exactly the checked list', async () => {
    stubDns({ 'a.example': [PUBLIC_V4, PUBLIC_V6] });
    expect(await lookup('a.example', { all: true })).toEqual([
      null,
      [
        { address: PUBLIC_V4, family: 4 },
        { address: PUBLIC_V6, family: 6 },
      ],
    ]);
  });

  it('all: false gets the first address and its family', async () => {
    stubDns({ 'a.example': [PUBLIC_V4] });
    expect(await lookup('a.example', {})).toEqual([null, PUBLIC_V4, 4]);
  });

  it('a name with a loopback answer gets an error and no address', async () => {
    stubDns({ 'a.example': [PUBLIC_V4, '127.0.0.1'] });
    const args = await lookup('a.example', { all: true });
    expect(args).toHaveLength(1);
    expect(args[0]).toBeInstanceOf(OutboundRefused);
    expectNotAllowed(args[0] as OutboundRefused);
  });
});

describe('webhook header names', () => {
  it.each(['Host', 'content-length', 'Transfer-Encoding', 'Connection', 'Keep-Alive', 'Upgrade', 'TE', 'Trailer', 'proxy-authorization', 'Proxy-Connection'])(
    'refuses %s',
    (name) => {
      expect(isForbiddenWebhookHeader(name)).toBe(true);
    }
  );

  it.each(['X-Auth', 'Authorization', 'Content-Type', 'X-Proxy-Id'])('allows %s', (name) => {
    expect(isForbiddenWebhookHeader(name)).toBe(false);
  });
});

describe('safeHttpsPost', () => {
  const SLACK = 'https://hooks.slack.com/services/T/B/x';
  const post = (url = SLACK, policy: 'slack-webhook' | 'public-https' = 'slack-webhook') =>
    safeHttpsPost(url, { policy, headers: { 'Content-Type': 'application/json' }, body: '{"text":"hi"}' });

  it('H1: connects through safeLookup, on a fresh socket, checking the certificate against the host', async () => {
    const fake = fakeHttpsRequest({ status: 200 });

    await expect(post()).resolves.toEqual({ status: 200 });

    expect(fake.calls).toHaveLength(1);
    const options = fake.calls[0].options;
    expect(options.lookup).toBe(safeLookup);
    expect(options.agent).toBe(false);
    expect(options.servername).toBe('hooks.slack.com');
    expect(options.hostname).toBe('hooks.slack.com');
    expect(options.method).toBe('POST');
    expect(options.path).toBe('/services/T/B/x');
    expect(options.maxHeaderSize).toBe(16384);
    expect(options.insecureHTTPParser).toBe(false);
    expect(options).not.toHaveProperty('rejectUnauthorized');
    expect(options.headers['Content-Length']).toBe(String(Buffer.byteLength('{"text":"hi"}')));
    expect(fake.calls[0].body()).toBe('{"text":"hi"}');
  });

  it('H2: a redirect is only its status; Location is not followed', async () => {
    const fake = fakeHttpsRequest({ status: 302, headers: { location: 'http://127.0.0.1/' } });

    await expect(post()).resolves.toEqual({ status: 302 });

    expect(fake.calls).toHaveLength(1);
  });

  it('H3: the response body is discarded unread', async () => {
    const sentinel = `BODY-SENT-${Date.now()}`;
    const logs = [jest.spyOn(console, 'log'), jest.spyOn(console, 'warn'), jest.spyOn(console, 'error')];
    const fake = fakeHttpsRequest({ status: 500, body: sentinel });

    const result = await post();

    expect(result).toEqual({ status: 500 });
    const res = fake.calls[0].res!;
    expect(res.destroyed).toBe(true);
    expect(res.pulled).toBe(false);
    expect(res.dataListened).toBe(false);
    expect(JSON.stringify(result)).not.toContain(sentinel);
    for (const spy of logs) expect(inspect(spy.mock.calls)).not.toContain(sentinel);
  });

  it('H4: a request that never answers is destroyed after the total deadline', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    const fake = fakeHttpsRequest({ hang: true });
    let settled: unknown;
    post().catch((error) => {
      settled = error;
    });
    await jest.advanceTimersByTimeAsync(9_999);
    expect(settled).toBeUndefined();
    await jest.advanceTimersByTimeAsync(1);
    await new Promise((resolve) => setImmediate(resolve));

    expect(fake.calls[0].req.destroyed).toBe(true);
    expect(settled).toBeInstanceOf(OutboundRefused);
    expect((settled as OutboundRefused).code).toBe('failed');
    expect((settled as OutboundRefused).message).toBe('request failed');
  });

  it('H5: an IP-literal destination is refused without any request', async () => {
    const fake = fakeHttpsRequest({ status: 200 });

    expectNotAllowed(await refusal(post('https://10.0.0.1/x', 'public-https')));

    expect(fake.spy).not.toHaveBeenCalled();
  });

  it('H6: a failure after connecting is "failed", with a fixed message', async () => {
    fakeHttpsRequest({ error: new Error(`connect ECONNREFUSED ${PUBLIC_V4}:443`) });

    const error = await refusal(post());

    expect(error.code).toBe('failed');
    expect(error.message).toBe('request failed');
    expect(inspect(error)).not.toContain(PUBLIC_V4);
  });

  it('a destination the policy refuses makes no request', async () => {
    const fake = fakeHttpsRequest({ status: 200 });

    expectNotAllowed(await refusal(post('https://hooks.example/x', 'slack-webhook')));

    expect(fake.spy).not.toHaveBeenCalled();
    expect(https.request).toBe(fake.spy);
  });
});
