/**
 * The one definition of a well-formed AWS account ID: exactly 12 digits.
 * Shared by startup validation (config/validateEnv.ts) and the connect flow
 * (routes/aws.routes.ts) so the two can never disagree about AWS_ACCOUNT_ID.
 *
 * Also the one rule for which AWS account a role ARN names
 * (parseAccountIdFromArn): the scan context, the scan lease and the coverage
 * route all key on it. No imports, so a module that must not load the AWS SDK
 * or the client factory can use it.
 */
const AWS_ACCOUNT_ID = /^\d{12}$/;

/** The trimmed value when it is a 12-digit AWS account ID; otherwise null. */
export function parseAwsAccountId(value: string | undefined | null): string | null {
  const trimmed = value?.trim();
  return trimmed && AWS_ACCOUNT_ID.test(trimmed) ? trimmed : null;
}

/** Extracts the 12-digit account ID from an IAM role/user ARN, e.g. arn:aws:iam::123456789012:role/x */
export function parseAccountIdFromArn(arn: string): string | undefined {
  return arn.match(/^arn:aws:iam::(\d{12}):/)?.[1];
}
