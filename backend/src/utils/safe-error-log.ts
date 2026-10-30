/**
 * The fields of a caught error that are safe to log: name, code and a
 * shortened, redacted message. Never the error object itself, its stack, a
 * database error's detail (which can quote the row) or anything from the
 * request.
 *
 * Messages can carry AWS identifiers (an SDK error quotes the ARN it was
 * refused on), emails or ids, so those are replaced before the message is
 * logged. The redaction is best effort; it is not a reason to put sensitive
 * values in error messages.
 */

const MAX_MESSAGE_LENGTH = 300;
const SAFE_TOKEN = /^[A-Za-z0-9_.:-]{1,64}$/;

const REDACTIONS: Array<[RegExp, string]> = [
  [/arn:aws[\w-]*:[^\s'"]*/gi, '[arn]'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]'],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[id]'],
  [/\b(?:i|vol|snap|eipalloc|eni|sg|subnet|vpc|ami)-[0-9a-f]{8,17}\b/gi, '[resource-id]'],
  [/\b\d{12}\b/g, '[account-id]'],
];

export interface SafeErrorFields {
  name?: string;
  code?: string;
  message?: string;
}

function safeToken(value: unknown): string | undefined {
  return typeof value === 'string' && SAFE_TOKEN.test(value) ? value : undefined;
}

export function redactErrorMessage(message: string): string {
  let text = message.slice(0, MAX_MESSAGE_LENGTH);
  for (const [pattern, replacement] of REDACTIONS) text = text.replace(pattern, replacement);
  return text;
}

export function safeErrorFields(error: unknown): SafeErrorFields {
  const err = (typeof error === 'object' && error !== null ? error : {}) as Record<string, unknown>;
  const message =
    typeof err.message === 'string' ? err.message : typeof error === 'string' ? error : undefined;
  return {
    name: safeToken(err.name),
    code: safeToken(err.code),
    message: message === undefined ? undefined : redactErrorMessage(message),
  };
}
