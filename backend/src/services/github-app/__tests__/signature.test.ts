import crypto from 'crypto';
import { verifyGitHubSignature } from '../signature';

const SECRET = 'test-webhook-secret-0123456789';
const PREVIOUS = 'previous-webhook-secret-0123456789';
const body = Buffer.from('{"action":"completed","zen":"Keep it logically awesome."}');
const sign = (b: Buffer, s = SECRET) => 'sha256=' + crypto.createHmac('sha256', s).update(b).digest('hex');

describe('verifyGitHubSignature (X-Hub-Signature-256 over the raw bytes, constant time)', () => {
  it('accepts a valid signature', () => {
    expect(verifyGitHubSignature(body, sign(body), [SECRET])).toBe(true);
  });

  it('rejects a signature made with another secret', () => {
    expect(verifyGitHubSignature(body, sign(body, 'some-other-secret-0123456789'), [SECRET])).toBe(false);
  });

  it('rejects a missing header', () => {
    expect(verifyGitHubSignature(body, undefined, [SECRET])).toBe(false);
    expect(verifyGitHubSignature(body, '', [SECRET])).toBe(false);
  });

  it('rejects a modified body (one byte) under the original signature', () => {
    const modified = Buffer.from(body);
    modified[modified.length - 3] = modified[modified.length - 3] ^ 1;
    expect(verifyGitHubSignature(modified, sign(body), [SECRET])).toBe(false);
  });

  it('rejects the same JSON re-serialized differently (the raw bytes are what is signed)', () => {
    const reserialized = Buffer.from(JSON.stringify(JSON.parse(body.toString()), null, 2));
    expect(verifyGitHubSignature(reserialized, sign(body), [SECRET])).toBe(false);
  });

  it.each([
    ['no prefix', () => sign(body).slice('sha256='.length)],
    ['sha1 prefix', () => 'sha1=' + sign(body).slice('sha256='.length)],
    ['uppercase hex', () => 'sha256=' + sign(body).slice('sha256='.length).toUpperCase()],
    ['too short', () => sign(body).slice(0, -2)],
    ['too long', () => sign(body) + '00'],
    ['non-hex', () => 'sha256=' + 'z'.repeat(64)],
    ['array header', () => [sign(body)] as unknown as string],
  ])('rejects a malformed header: %s', (_label, header) => {
    expect(verifyGitHubSignature(body, header(), [SECRET])).toBe(false);
  });

  it('rejects a body that is not a Buffer (already parsed JSON)', () => {
    expect(verifyGitHubSignature(JSON.parse(body.toString()) as unknown as Buffer, sign(body), [SECRET])).toBe(false);
  });

  it('accepts the previous secret while rotating, and nothing when no secret is configured', () => {
    expect(verifyGitHubSignature(body, sign(body, PREVIOUS), [SECRET, PREVIOUS])).toBe(true);
    expect(verifyGitHubSignature(body, sign(body, PREVIOUS), [SECRET])).toBe(false);
    expect(verifyGitHubSignature(body, sign(body, ''), [])).toBe(false);
    expect(verifyGitHubSignature(body, sign(body, ''), [''])).toBe(false);
  });
});
