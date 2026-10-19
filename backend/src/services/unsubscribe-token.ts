/**
 * Signed, purpose-bound unsubscribe tokens for email links.
 *
 * Format: v1.<base64url(userId)>.<iat unix seconds>.<base64url(HMAC-SHA256)>
 * MAC input: "<purpose>\n<userId>\n<iat>", keyed with a key derived (HKDF)
 * from JWT_SECRET, so the key is never the JWT signing key itself and a
 * token for one email type never verifies for another. Every character is
 * [A-Za-z0-9._-], which survives query strings and sanitizerMiddleware.
 *
 * Never log a token, the derived key, or the secret.
 */
import crypto from 'crypto';

/** One purpose per email type; a new email type gets its own string. */
export type UnsubscribePurpose = 'weekly-summary';

export type VerifiedUnsubscribeToken =
  | { kind: 'signed'; userId: string }
  | { kind: 'legacy'; userId: string }
  | { kind: 'invalid' };

const TOKEN_VERSION = 'v1';
const KEY_INFO = 'devcontrol/email-unsubscribe/v1';
const MAX_TOKEN_LENGTH = 256;
const CLOCK_SKEW_SECONDS = 5 * 60;

/** Signed links stay valid for 90 days after the email is sent. */
export const UNSUBSCRIBE_TOKEN_TTL_SECONDS = 90 * 24 * 60 * 60;

/**
 * Weekly summary emails sent before signed tokens carried
 * ?token=base64(userId). Those links keep working (confirm-page POST only,
 * never one-click) until this instant, then are rejected.
 *
 * Rule: this must be at least 30 days after the last email that carried a
 * legacy link. 2026-12-07 holds if signed tokens deploy by 2026-11-08 (last
 * legacy send Monday 2026-11-02 at the latest); if the deploy slips past
 * that, move this date to (last legacy send + 30 days) or later. Delete the
 * legacy path after this date.
 */
export const LEGACY_UNSUBSCRIBE_CUTOFF = new Date('2026-12-07T00:00:00Z');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
const LEGACY_RE = /^[A-Za-z0-9+/]+={0,2}$/;

function signingKey(): Buffer {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not set; cannot sign or verify unsubscribe tokens');
  }
  return Buffer.from(crypto.hkdfSync('sha256', secret, Buffer.alloc(0), KEY_INFO, 32));
}

function mac(purpose: UnsubscribePurpose, userId: string, iat: number): Buffer {
  return crypto.createHmac('sha256', signingKey()).update(`${purpose}\n${userId}\n${iat}`).digest();
}

export function signUnsubscribeToken(rawUserId: string, purpose: UnsubscribePurpose, now: Date = new Date()): string {
  if (!UUID_RE.test(rawUserId)) {
    throw new Error('Unsubscribe tokens are only issued for UUID user ids');
  }
  const userId = rawUserId.toLowerCase();
  const iat = Math.floor(now.getTime() / 1000);
  return [
    TOKEN_VERSION,
    Buffer.from(userId, 'utf-8').toString('base64url'),
    String(iat),
    mac(purpose, userId, iat).toString('base64url'),
  ].join('.');
}

function verifySigned(token: string, purpose: UnsubscribePurpose, now: Date): VerifiedUnsubscribeToken {
  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== TOKEN_VERSION) return { kind: 'invalid' };
  const [, encodedUserId, iatText, encodedMac] = parts;

  // Canonical form only -- lowercase user id, iat with no leading zero, and
  // base64url that re-encodes to itself (no stray tail bits) -- so for a
  // given (userId, iat) exactly one string verifies: the one sign() returns.
  if (!BASE64URL_RE.test(encodedUserId) || !BASE64URL_RE.test(encodedMac) || !/^[1-9]\d{0,11}$/.test(iatText)) {
    return { kind: 'invalid' };
  }
  const userId = Buffer.from(encodedUserId, 'base64url').toString('utf-8').toLowerCase();
  if (!UUID_RE.test(userId) || Buffer.from(userId, 'utf-8').toString('base64url') !== encodedUserId) {
    return { kind: 'invalid' };
  }

  const iat = Number(iatText);
  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (iat > nowSeconds + CLOCK_SKEW_SECONDS || nowSeconds - iat > UNSUBSCRIBE_TOKEN_TTL_SECONDS) {
    return { kind: 'invalid' };
  }

  const provided = Buffer.from(encodedMac, 'base64url');
  if (provided.toString('base64url') !== encodedMac) return { kind: 'invalid' };
  const expected = mac(purpose, userId, iat);
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    return { kind: 'invalid' };
  }
  return { kind: 'signed', userId };
}

/** Legacy base64(userId) tokens -- weekly summary only, and only before the cutoff. */
function verifyLegacy(token: string, purpose: UnsubscribePurpose, now: Date): VerifiedUnsubscribeToken {
  if (purpose !== 'weekly-summary' || now.getTime() >= LEGACY_UNSUBSCRIBE_CUTOFF.getTime()) {
    return { kind: 'invalid' };
  }
  if (!LEGACY_RE.test(token)) return { kind: 'invalid' };
  const userId = Buffer.from(token, 'base64').toString('utf-8');
  return UUID_RE.test(userId) ? { kind: 'legacy', userId: userId.toLowerCase() } : { kind: 'invalid' };
}

/**
 * The token an unsubscribe request presents. GET: the link's query string.
 * POST with a query token: RFC 8058 one-click (its body need not parse --
 * receivers may send multipart/form-data). Other POSTs: the confirm form body.
 */
export function presentedUnsubscribeToken(req: {
  method: string;
  query: Record<string, unknown>;
  body?: Record<string, unknown>;
}): { token: unknown; oneClick: boolean } {
  if (req.method !== 'POST') return { token: req.query.token, oneClick: false };
  const oneClick = req.query.token !== undefined;
  return { token: oneClick ? req.query.token : req.body?.token, oneClick };
}

/**
 * Classifies a presented token. A 'legacy' result is only acceptable on the
 * human confirm-page POST; callers must reject it everywhere else.
 */
export function verifyUnsubscribeToken(
  token: unknown,
  purpose: UnsubscribePurpose,
  now: Date = new Date()
): VerifiedUnsubscribeToken {
  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    return { kind: 'invalid' };
  }
  return token.startsWith(`${TOKEN_VERSION}.`) ? verifySigned(token, purpose, now) : verifyLegacy(token, purpose, now);
}
