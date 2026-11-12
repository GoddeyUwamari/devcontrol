/**
 * Connect AWS page wording the weekly summary email repeats. No runtime
 * imports, so the frontend test
 * app/(app)/connect-aws/__tests__/weekly-email-health-copy.test.ts can import
 * it and keep it equal to app/(app)/connect-aws/connectAwsCopy.ts.
 */

/** HEALTH_FAILING_HELP on the Connect AWS page: shown with a failing or lost connection. */
export const CONNECTION_FAILING_HELP =
  "DevControl couldn't assume your role during its scans. If the role, its trust policy or its External ID changed in AWS, fix it there, then use Check again. DevControl keeps this connection until you ask us to remove it.";
