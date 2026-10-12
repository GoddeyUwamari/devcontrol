/**
 * The one definition of a well-formed AWS account ID: exactly 12 digits.
 * Shared by startup validation (config/validateEnv.ts) and the connect flow
 * (routes/aws.routes.ts) so the two can never disagree about AWS_ACCOUNT_ID.
 */
const AWS_ACCOUNT_ID = /^\d{12}$/;

/** The trimmed value when it is a 12-digit AWS account ID; otherwise null. */
export function parseAwsAccountId(value: string | undefined | null): string | null {
  const trimmed = value?.trim();
  return trimmed && AWS_ACCOUNT_ID.test(trimmed) ? trimmed : null;
}
