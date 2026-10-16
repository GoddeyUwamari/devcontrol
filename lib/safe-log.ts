/**
 * Error logging for the browser console.
 *
 * Logs one plain string: the caller's context, the error message, and -- for
 * HTTP errors -- the response status and the API's error code. Nothing else
 * from the error is read, so request config, bodies, headers and response
 * payloads never reach the console.
 */

const MAX_MESSAGE_LENGTH = 200;
const ERROR_CODE_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;

function readStatus(error: object): number | undefined {
  const response = (error as { response?: unknown }).response;
  if (typeof response !== 'object' || response === null) return undefined;
  const status = (response as { status?: unknown }).status;
  return typeof status === 'number' ? status : undefined;
}

function readCode(error: object): string | undefined {
  const response = (error as { response?: unknown }).response;
  if (typeof response !== 'object' || response === null) return undefined;
  const data = (response as { data?: unknown }).data;
  if (typeof data !== 'object' || data === null) return undefined;
  const code = (data as { code?: unknown }).code;
  return typeof code === 'string' && ERROR_CODE_PATTERN.test(code) ? code : undefined;
}

/** The single line logError writes for this error. */
export function describeError(context: string, error: unknown): string {
  if (!(error instanceof Error)) {
    return `${context}: non-Error value (${error === null ? 'null' : typeof error})`;
  }

  const message = error.message.length > MAX_MESSAGE_LENGTH
    ? `${error.message.slice(0, MAX_MESSAGE_LENGTH)}…`
    : error.message;
  const details: string[] = [];
  const status = readStatus(error);
  if (status !== undefined) details.push(`status ${status}`);
  const code = readCode(error);
  if (code !== undefined) details.push(`code ${code}`);

  return details.length > 0
    ? `${context}: ${message} (${details.join(', ')})`
    : `${context}: ${message}`;
}

export function logError(context: string, error: unknown): void {
  console.error(describeError(context, error));
}
