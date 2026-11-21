import crypto from 'crypto';

const SIGNATURE_HEADER = /^sha256=[0-9a-f]{64}$/;

/**
 * GitHub's X-Hub-Signature-256: "sha256=" + hex HMAC-SHA256 of the raw
 * request bytes, keyed with the App's webhook secret (docs: "Validating
 * webhook deliveries"). Checked before the body is parsed. Each configured
 * secret (current, then previous while rotating) is compared in constant
 * time; a malformed header never reaches a comparison.
 *
 * Never log the header, the body or a secret.
 */
export function verifyGitHubSignature(rawBody: Buffer, header: unknown, secrets: readonly string[]): boolean {
  if (!Buffer.isBuffer(rawBody) || typeof header !== 'string' || !SIGNATURE_HEADER.test(header)) return false;
  const received = Buffer.from(header.slice('sha256='.length), 'hex');
  let matched = false;
  for (const secret of secrets) {
    if (typeof secret !== 'string' || secret.length === 0) continue;
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest();
    // Both are 32 bytes (the header pattern fixes the length); evaluate every
    // secret so timing does not reveal which one matched.
    if (crypto.timingSafeEqual(expected, received)) matched = true;
  }
  return matched;
}
