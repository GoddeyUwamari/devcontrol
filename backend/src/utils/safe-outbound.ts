/**
 * Outbound requests to destinations an organization configures: Slack and
 * generic webhooks, Jira, SMTP, and any future webhook_endpoints sender.
 *
 * A destination must be https (SMTP: a host on an allowed port), must not
 * carry credentials or name an internal host, and every address it resolves
 * to must be public. The check runs when a destination is saved (for an early,
 * fixed error) and again when it is used: the connection goes to exactly the
 * addresses that were just checked, so a name cannot resolve to something else
 * between the check and the connect. Redirects are never followed and response
 * bodies are never read.
 *
 * Errors carry one of two fixed messages and never the URL, host, address,
 * port or the underlying library text. A DNS failure and a refused address
 * give the same error.
 *
 * dns.lookup and https.request are always called through their module objects
 * so tests can stub them.
 */
import dns from 'node:dns';
import https from 'node:https';
import net from 'node:net';

export type DestinationPolicy = 'slack-webhook' | 'public-https';

export class OutboundRefused extends Error {
  readonly code: 'not_allowed' | 'failed';

  constructor(code: 'not_allowed' | 'failed') {
    super(code === 'not_allowed' ? 'destination not allowed' : 'request failed');
    this.name = 'OutboundRefused';
    this.code = code;
  }
}

export const SLACK_WEBHOOK_HOSTS = ['hooks.slack.com', 'hooks.slack-gov.com'] as const;
export const SMTP_PORTS = [25, 465, 587, 2525] as const;
/** The EHLO/HELO name sent to an organization's mail server, instead of this host's own name. */
export const SMTP_CLIENT_NAME = 'getdevcontrol.com';

const MAX_URL_LENGTH = 2048;
const MAX_HOST_LENGTH = 253;
const DNS_TIMEOUT_MS = 5_000;

const notAllowed = () => new OutboundRefused('not_allowed');

const BLOCKED_V4 = new net.BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], // unspecified, "this network"
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, including instance metadata
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation
  ['192.88.99.0', 24], // 6to4 relay
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, including broadcast
] as const) {
  BLOCKED_V4.addSubnet(network, prefix, 'ipv4');
}

// IPv6 is allowed only inside global unicast, so every special form (mapped,
// compatible, NAT64, unique-local, link-local, site-local, multicast) is
// refused without being listed.
const GLOBAL_V6 = new net.BlockList();
GLOBAL_V6.addSubnet('2000::', 3, 'ipv6');
const BLOCKED_GLOBAL_V6 = new net.BlockList();
for (const [network, prefix] of [
  ['2001::', 32], // Teredo
  ['2001:db8::', 32], // documentation
  ['2001:10::', 28], // ORCHID
  ['2001:20::', 28], // ORCHIDv2
  ['2002::', 16], // 6to4
  ['3fff::', 20], // documentation
] as const) {
  BLOCKED_GLOBAL_V6.addSubnet(network, prefix, 'ipv6');
}

/** Whether `ip` is an address no organization destination may use. Anything not an IP is blocked. */
export function isBlockedAddress(ip: string): boolean {
  switch (net.isIP(ip)) {
    case 4:
      return BLOCKED_V4.check(ip, 'ipv4');
    case 6:
      return ip.includes('%') || !GLOBAL_V6.check(ip, 'ipv6') || BLOCKED_GLOBAL_V6.check(ip, 'ipv6');
    default:
      return true;
  }
}

/**
 * The host to connect to, from a WHATWG-parsed hostname (already lowercased,
 * punycoded and with numeric IPv4 forms normalised), without IPv6 brackets.
 * An IP literal must be public: nothing resolves it later.
 */
function checkHost(hostname: string): string {
  const host = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
  if (!host || host.length > MAX_HOST_LENGTH || host.endsWith('.') || host.includes('%')) throw notAllowed();
  if (net.isIP(host)) {
    if (isBlockedAddress(host)) throw notAllowed();
    return host;
  }
  // A single-label name would resolve through the instance's search domain.
  if (!host.includes('.')) throw notAllowed();
  if (host === 'localhost' || host.endsWith('.localhost')) throw notAllowed();
  return host;
}

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/** The parsed URL, if `raw` is allowed for `policy` before any DNS is consulted. */
export function checkUrlSyntax(raw: unknown, policy: DestinationPolicy): URL {
  if (typeof raw !== 'string' || CONTROL_CHARACTERS.test(raw)) throw notAllowed();
  const value = raw.trim();
  if (!value || value.length > MAX_URL_LENGTH || /\s/.test(value)) throw notAllowed();

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw notAllowed();
  }
  if (url.protocol !== 'https:') throw notAllowed();
  if (url.username !== '' || url.password !== '') throw notAllowed();
  const host = checkHost(url.hostname);

  if (policy === 'slack-webhook') {
    if (url.port !== '') throw notAllowed();
    if (!(SLACK_WEBHOOK_HOSTS as readonly string[]).includes(host)) throw notAllowed();
  }
  return url;
}

/** A mail server host and port, the host canonicalised the same way as a URL's. */
export function checkSmtpSyntax(host: unknown, port: unknown): { host: string; port: number } {
  if (typeof host !== 'string' || CONTROL_CHARACTERS.test(host)) throw notAllowed();
  const value = host.trim();
  if (!value || value.length > MAX_HOST_LENGTH || /\s/.test(value)) throw notAllowed();
  const isIPv6 = net.isIP(value) === 6;
  if (isIPv6 ? value.includes('%') : /[/\\?#@%:]/.test(value)) throw notAllowed();

  let canonical: string;
  try {
    canonical = new URL(`https://${isIPv6 ? `[${value}]` : value}`).hostname;
  } catch {
    throw notAllowed();
  }
  const checkedHost = checkHost(canonical);

  if (typeof port !== 'number' || !Number.isInteger(port) || !(SMTP_PORTS as readonly number[]).includes(port)) {
    throw notAllowed();
  }
  return { host: checkedHost, port };
}

export interface ResolvedAddress {
  address: string;
  family: number;
}

function lookupAll(hostname: string): Promise<ResolvedAddress[]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(notAllowed()), DNS_TIMEOUT_MS);
    dns.lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(addresses);
    });
  });
}

/**
 * Every address `hostname` resolves to, if all of them are public. One private
 * address refuses the whole name; so do no answer, a DNS error or a timeout.
 */
export async function resolvePublic(hostname: string): Promise<ResolvedAddress[]> {
  if (net.isIP(hostname)) {
    if (isBlockedAddress(hostname)) throw notAllowed();
    return [{ address: hostname, family: net.isIP(hostname) }];
  }
  let addresses: ResolvedAddress[];
  try {
    addresses = await lookupAll(hostname);
  } catch {
    throw notAllowed();
  }
  if (!Array.isArray(addresses) || addresses.length === 0) throw notAllowed();
  if (addresses.some((entry) => isBlockedAddress(entry.address))) throw notAllowed();
  return addresses.map(({ address, family }) => ({ address, family }));
}

const hostOf = (url: URL) => checkHost(url.hostname);

/** Save-time check: the URL is allowed for `policy` and its host resolves only to public addresses. */
export async function assertDestination(raw: unknown, policy: DestinationPolicy): Promise<void> {
  const url = checkUrlSyntax(raw, policy);
  await resolvePublic(hostOf(url));
}

/**
 * A connect-time lookup that answers only with addresses it has just checked.
 * Handles both answer shapes, since Node 20's family autoselection asks for all.
 */
export const safeLookup = ((hostname: string, options: any, callback: (...args: any[]) => void) => {
  const done = typeof options === 'function' ? options : callback;
  const all = typeof options === 'object' && options !== null && options.all === true;
  resolvePublic(hostname).then(
    (addresses) => (all ? done(null, addresses) : done(null, addresses[0].address, addresses[0].family)),
    () => done(notAllowed())
  );
}) as net.LookupFunction;

/** An agent whose every connection goes through safeLookup, for clients that take one (axios). */
export function createSafeHttpsAgent(): https.Agent {
  return new https.Agent({ keepAlive: false, lookup: safeLookup });
}

const FORBIDDEN_WEBHOOK_HEADERS = new Set([
  'host',
  'content-length',
  'transfer-encoding',
  'connection',
  'keep-alive',
  'upgrade',
  'te',
  'trailer',
]);

export function isForbiddenWebhookHeader(name: string): boolean {
  const lower = name.trim().toLowerCase();
  return FORBIDDEN_WEBHOOK_HEADERS.has(lower) || lower.startsWith('proxy-');
}

/**
 * POSTs `body` and answers with the status only. The response body is
 * discarded unread, a redirect is just its status, and the whole request has a
 * total deadline. Failures before a connection is made are 'not_allowed';
 * failures after it (refused, reset, TLS, timeout) are 'failed'.
 */
export async function safeHttpsPost(
  rawUrl: string,
  options: { policy: DestinationPolicy; headers?: Record<string, string>; body: string; timeoutMs?: number }
): Promise<{ status: number }> {
  const url = checkUrlSyntax(rawUrl, options.policy);
  const host = hostOf(url);
  const timeoutMs = options.timeoutMs ?? 10_000;

  return new Promise<{ status: number }>((resolve, reject) => {
    const req = https.request({
      protocol: 'https:',
      hostname: host,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: 'POST',
      headers: { ...options.headers, 'Content-Length': String(Buffer.byteLength(options.body)) },
      agent: false,
      lookup: safeLookup,
      ...(net.isIP(host) ? {} : { servername: host }),
      maxHeaderSize: 16384,
      insecureHTTPParser: false,
      timeout: timeoutMs,
    });
    const deadline = setTimeout(() => req.destroy(new OutboundRefused('failed')), timeoutMs);
    req.on('timeout', () => req.destroy(new OutboundRefused('failed')));
    req.on('response', (res) => {
      clearTimeout(deadline);
      const status = res.statusCode ?? 0;
      res.on('error', () => {});
      res.destroy();
      resolve({ status });
    });
    req.on('error', (error) => {
      clearTimeout(deadline);
      reject(error instanceof OutboundRefused ? error : new OutboundRefused('failed'));
    });
    req.end(options.body);
  });
}

/** The address to connect a mail transport to, and the name its TLS certificate must match. */
export async function pinnedSmtpTarget(
  host: unknown,
  port: unknown
): Promise<{ address: string; servername?: string; port: number; secure: boolean }> {
  const checked = checkSmtpSyntax(host, port);
  const [first] = await resolvePublic(checked.host);
  return {
    address: first.address,
    ...(net.isIP(checked.host) ? {} : { servername: checked.host }),
    port: checked.port,
    secure: checked.port === 465,
  };
}
