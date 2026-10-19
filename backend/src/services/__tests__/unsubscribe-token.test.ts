/**
 * Signed unsubscribe tokens (unsubscribe-token.ts): signature, purpose and
 * key binding, expiry, and the legacy base64(userId) cutoff. Pure crypto --
 * no database.
 */
import crypto from 'crypto';
import {
  LEGACY_UNSUBSCRIBE_CUTOFF,
  UNSUBSCRIBE_TOKEN_TTL_SECONDS,
  presentedUnsubscribeToken,
  signUnsubscribeToken,
  verifyUnsubscribeToken,
} from '../unsubscribe-token';

const USER_ID = '11111111-2222-4333-8444-555555555555';
/** Has letters, so its upper- and lowercase forms differ. */
const OTHER_USER_ID = '66666666-7777-4888-8999-aaaaaaaaaaaa';
const NOW = new Date('2026-11-01T12:00:00Z');
const TEST_SECRET = 'unit-test-jwt-secret-placeholder-32chars';

const originalSecret = process.env.JWT_SECRET;
beforeEach(() => {
  process.env.JWT_SECRET = TEST_SECRET;
});
afterAll(() => {
  process.env.JWT_SECRET = originalSecret;
});

function parts(token: string) {
  const [version, encodedUserId, iat, encodedMac] = token.split('.');
  return { version, encodedUserId, iat, encodedMac };
}

function secondsAfter(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}

describe('signed unsubscribe tokens', () => {
  it('a token from sign() verifies for the same user and purpose', () => {
    const token = signUnsubscribeToken(USER_ID, 'weekly-summary', NOW);
    expect(token).toMatch(/^v1\.[A-Za-z0-9_-]+\.\d+\.[A-Za-z0-9_-]+$/);
    expect(verifyUnsubscribeToken(token, 'weekly-summary', NOW)).toEqual({ kind: 'signed', userId: USER_ID });
  });

  it('never contains the raw user id or the secret', () => {
    const token = signUnsubscribeToken(USER_ID, 'weekly-summary', NOW);
    expect(token).not.toContain(USER_ID);
    expect(token).not.toContain(TEST_SECRET);
  });

  it('refuses to sign a non-UUID user id', () => {
    expect(() => signUnsubscribeToken('user-1', 'weekly-summary', NOW)).toThrow(/UUID/);
  });

  it('rejects a changed user id', () => {
    const p = parts(signUnsubscribeToken(USER_ID, 'weekly-summary', NOW));
    const forged = ['v1', Buffer.from(OTHER_USER_ID).toString('base64url'), p.iat, p.encodedMac].join('.');
    expect(verifyUnsubscribeToken(forged, 'weekly-summary', NOW)).toEqual({ kind: 'invalid' });
  });

  it('rejects a changed iat', () => {
    const p = parts(signUnsubscribeToken(USER_ID, 'weekly-summary', NOW));
    const forged = ['v1', p.encodedUserId, String(Number(p.iat) + 1), p.encodedMac].join('.');
    expect(verifyUnsubscribeToken(forged, 'weekly-summary', NOW)).toEqual({ kind: 'invalid' });
  });

  it('rejects a changed MAC', () => {
    const p = parts(signUnsubscribeToken(USER_ID, 'weekly-summary', NOW));
    const mac = Buffer.from(p.encodedMac, 'base64url');
    mac[0] ^= 0x01;
    const forged = ['v1', p.encodedUserId, p.iat, mac.toString('base64url')].join('.');
    expect(verifyUnsubscribeToken(forged, 'weekly-summary', NOW)).toEqual({ kind: 'invalid' });
  });

  it('rejects a truncated MAC', () => {
    const p = parts(signUnsubscribeToken(USER_ID, 'weekly-summary', NOW));
    const forged = ['v1', p.encodedUserId, p.iat, p.encodedMac.slice(0, 20)].join('.');
    expect(verifyUnsubscribeToken(forged, 'weekly-summary', NOW)).toEqual({ kind: 'invalid' });
  });

  it('rejects a token signed with a different secret', () => {
    process.env.JWT_SECRET = 'a-different-unit-test-secret-32-chars-x';
    const token = signUnsubscribeToken(USER_ID, 'weekly-summary', NOW);
    process.env.JWT_SECRET = TEST_SECRET;
    expect(verifyUnsubscribeToken(token, 'weekly-summary', NOW)).toEqual({ kind: 'invalid' });
  });

  it('rejects a MAC keyed with the raw JWT secret instead of the derived key', () => {
    const p = parts(signUnsubscribeToken(USER_ID, 'weekly-summary', NOW));
    const rawKeyed = crypto
      .createHmac('sha256', TEST_SECRET)
      .update(`weekly-summary\n${USER_ID}\n${p.iat}`)
      .digest('base64url');
    const forged = ['v1', p.encodedUserId, p.iat, rawKeyed].join('.');
    expect(verifyUnsubscribeToken(forged, 'weekly-summary', NOW)).toEqual({ kind: 'invalid' });
  });

  it('rejects a token for another purpose', () => {
    const p = parts(signUnsubscribeToken(USER_ID, 'weekly-summary', NOW));
    const key = Buffer.from(crypto.hkdfSync('sha256', TEST_SECRET, Buffer.alloc(0), 'devcontrol/email-unsubscribe/v1', 32));
    const otherPurpose = crypto
      .createHmac('sha256', key)
      .update(`cost-alerts\n${USER_ID}\n${p.iat}`)
      .digest('base64url');
    const forged = ['v1', p.encodedUserId, p.iat, otherPurpose].join('.');
    expect(verifyUnsubscribeToken(forged, 'weekly-summary', NOW)).toEqual({ kind: 'invalid' });
  });

  it('rejects a token whose key was derived with a different HKDF info string', () => {
    const p = parts(signUnsubscribeToken(USER_ID, 'weekly-summary', NOW));
    const otherKey = Buffer.from(crypto.hkdfSync('sha256', TEST_SECRET, Buffer.alloc(0), 'devcontrol/other-link/v1', 32));
    const otherMac = crypto
      .createHmac('sha256', otherKey)
      .update(`weekly-summary\n${USER_ID}\n${p.iat}`)
      .digest('base64url');
    const forged = ['v1', p.encodedUserId, p.iat, otherMac].join('.');
    expect(verifyUnsubscribeToken(forged, 'weekly-summary', NOW)).toEqual({ kind: 'invalid' });
  });

  it('rejects an unknown version prefix', () => {
    const token = signUnsubscribeToken(USER_ID, 'weekly-summary', NOW);
    expect(verifyUnsubscribeToken(token.replace(/^v1\./, 'v2.'), 'weekly-summary', NOW)).toEqual({ kind: 'invalid' });
  });

  it('rejects a non-UUID user id even with a matching MAC', () => {
    const key = Buffer.from(crypto.hkdfSync('sha256', TEST_SECRET, Buffer.alloc(0), 'devcontrol/email-unsubscribe/v1', 32));
    const iat = String(Math.floor(NOW.getTime() / 1000));
    const userId = 'not-a-uuid';
    const tokenMac = crypto.createHmac('sha256', key).update(`weekly-summary\n${userId}\n${iat}`).digest('base64url');
    const token = ['v1', Buffer.from(userId).toString('base64url'), iat, tokenMac].join('.');
    expect(verifyUnsubscribeToken(token, 'weekly-summary', NOW)).toEqual({ kind: 'invalid' });
  });

  it('rejects malformed input', () => {
    for (const bad of [undefined, null, 42, '', 'v1.', 'v1.a.b', 'v1.a.b.c.d', 'x'.repeat(300), ['v1']]) {
      expect(verifyUnsubscribeToken(bad, 'weekly-summary', NOW)).toEqual({ kind: 'invalid' });
    }
  });

  it('accepts up to 5 minutes of clock skew and rejects an iat further in the future', () => {
    const token = signUnsubscribeToken(USER_ID, 'weekly-summary', secondsAfter(NOW, 5 * 60));
    expect(verifyUnsubscribeToken(token, 'weekly-summary', NOW).kind).toBe('signed');
    const future = signUnsubscribeToken(USER_ID, 'weekly-summary', secondsAfter(NOW, 5 * 60 + 1));
    expect(verifyUnsubscribeToken(future, 'weekly-summary', NOW)).toEqual({ kind: 'invalid' });
  });

  it('expires exactly 90 days after issue', () => {
    expect(UNSUBSCRIBE_TOKEN_TTL_SECONDS).toBe(90 * 24 * 60 * 60);
    const token = signUnsubscribeToken(USER_ID, 'weekly-summary', NOW);
    expect(verifyUnsubscribeToken(token, 'weekly-summary', secondsAfter(NOW, UNSUBSCRIBE_TOKEN_TTL_SECONDS)).kind).toBe('signed');
    expect(verifyUnsubscribeToken(token, 'weekly-summary', secondsAfter(NOW, UNSUBSCRIBE_TOKEN_TTL_SECONDS + 1))).toEqual({
      kind: 'invalid',
    });
  });

  it('fails closed when JWT_SECRET is missing', () => {
    delete process.env.JWT_SECRET;
    expect(() => signUnsubscribeToken(USER_ID, 'weekly-summary', NOW)).toThrow(/JWT_SECRET is not set/);
  });
});

describe('canonical tokens: exactly one string verifies for a given (userId, iat)', () => {
  const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

  function derivedKey(): Buffer {
    return Buffer.from(crypto.hkdfSync('sha256', TEST_SECRET, Buffer.alloc(0), 'devcontrol/email-unsubscribe/v1', 32));
  }

  it('rejects a leading-zero iat even though the MAC matches its numeric value', () => {
    const p = parts(signUnsubscribeToken(USER_ID, 'weekly-summary', NOW));
    const padded = ['v1', p.encodedUserId, `0${p.iat}`, p.encodedMac].join('.');
    expect(Number(`0${p.iat}`)).toBe(Number(p.iat));
    expect(verifyUnsubscribeToken(padded, 'weekly-summary', NOW)).toEqual({ kind: 'invalid' });
  });

  it('rejects a MAC with changed tail bits that decodes to the same bytes', () => {
    const p = parts(signUnsubscribeToken(USER_ID, 'weekly-summary', NOW));
    const last = p.encodedMac.slice(-1);
    const variantMac = p.encodedMac.slice(0, -1) + BASE64URL_ALPHABET[BASE64URL_ALPHABET.indexOf(last) ^ 1];
    expect(variantMac).not.toBe(p.encodedMac);
    expect(Buffer.from(variantMac, 'base64url').equals(Buffer.from(p.encodedMac, 'base64url'))).toBe(true);
    const variant = ['v1', p.encodedUserId, p.iat, variantMac].join('.');
    expect(verifyUnsubscribeToken(variant, 'weekly-summary', NOW)).toEqual({ kind: 'invalid' });
  });

  it('normalizes the user id to lowercase on sign', () => {
    const upper = signUnsubscribeToken(OTHER_USER_ID.toUpperCase(), 'weekly-summary', NOW);
    expect(upper).toBe(signUnsubscribeToken(OTHER_USER_ID, 'weekly-summary', NOW));
    expect(verifyUnsubscribeToken(upper, 'weekly-summary', NOW)).toEqual({ kind: 'signed', userId: OTHER_USER_ID });
  });

  it('rejects an uppercase-encoded user id, whichever case the MAC was computed over', () => {
    const iat = String(Math.floor(NOW.getTime() / 1000));
    const upperId = OTHER_USER_ID.toUpperCase();
    for (const macOver of [upperId, OTHER_USER_ID]) {
      const tokenMac = crypto.createHmac('sha256', derivedKey()).update(`weekly-summary\n${macOver}\n${iat}`).digest('base64url');
      const token = ['v1', Buffer.from(upperId).toString('base64url'), iat, tokenMac].join('.');
      expect(verifyUnsubscribeToken(token, 'weekly-summary', NOW)).toEqual({ kind: 'invalid' });
    }
  });

  it('normalizes a legacy token user id to lowercase on verify', () => {
    const legacy = Buffer.from(OTHER_USER_ID.toUpperCase()).toString('base64');
    expect(verifyUnsubscribeToken(legacy, 'weekly-summary', NOW)).toEqual({ kind: 'legacy', userId: OTHER_USER_ID });
  });
});

describe('presentedUnsubscribeToken', () => {
  it('GET reads the query; POST with a query token is one-click; other POSTs read the form body', () => {
    expect(presentedUnsubscribeToken({ method: 'GET', query: { token: 'q' }, body: { token: 'b' } })).toEqual({ token: 'q', oneClick: false });
    expect(presentedUnsubscribeToken({ method: 'POST', query: { token: 'q' }, body: { token: 'b' } })).toEqual({ token: 'q', oneClick: true });
    expect(presentedUnsubscribeToken({ method: 'POST', query: {}, body: { token: 'b' } })).toEqual({ token: 'b', oneClick: false });
    expect(presentedUnsubscribeToken({ method: 'POST', query: {} })).toEqual({ token: undefined, oneClick: false });
  });
});

describe('legacy base64(userId) tokens', () => {
  const legacy = Buffer.from(USER_ID).toString('base64');

  it('the cutoff is 2026-12-07T00:00:00Z', () => {
    expect(LEGACY_UNSUBSCRIBE_CUTOFF.toISOString()).toBe('2026-12-07T00:00:00.000Z');
  });

  it('are recognised as legacy before the cutoff', () => {
    expect(verifyUnsubscribeToken(legacy, 'weekly-summary', new Date(LEGACY_UNSUBSCRIBE_CUTOFF.getTime() - 1))).toEqual({
      kind: 'legacy',
      userId: USER_ID,
    });
  });

  it('are rejected at and after the cutoff', () => {
    expect(verifyUnsubscribeToken(legacy, 'weekly-summary', LEGACY_UNSUBSCRIBE_CUTOFF)).toEqual({ kind: 'invalid' });
    expect(verifyUnsubscribeToken(legacy, 'weekly-summary', new Date('2027-01-01T00:00:00Z'))).toEqual({ kind: 'invalid' });
  });

  it('must decode to a UUID', () => {
    expect(verifyUnsubscribeToken(Buffer.from('user-1').toString('base64'), 'weekly-summary', NOW)).toEqual({ kind: 'invalid' });
    expect(verifyUnsubscribeToken('not base64!', 'weekly-summary', NOW)).toEqual({ kind: 'invalid' });
  });
});
