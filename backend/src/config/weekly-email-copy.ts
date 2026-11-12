/**
 * Connect AWS and Cost Optimization page wording the weekly summary email
 * repeats. No runtime imports, so the frontend test
 * app/(app)/connect-aws/__tests__/weekly-email-health-copy.test.ts can import
 * it and keep it equal to app/(app)/connect-aws/connectAwsCopy.ts and
 * app/(app)/cost-optimization/costScanBanner.ts.
 */

/** HEALTH_FAILING_HELP on the Connect AWS page: shown with a failing or lost connection. */
export const CONNECTION_FAILING_HELP =
  "DevControl couldn't assume your role during its scans. If the role, its trust policy or its External ID changed in AWS, fix it there, then use Check again. DevControl keeps this connection until you ask us to remove it.";

/**
 * PARTIAL_MESSAGE on the Cost Optimization page ("Analysis partly complete"):
 * added after the savings date line when the figures come from a cost analysis
 * that completed with some cost checks failed (WE-2 review H-1). The frontend
 * test keeps it equal to app/(app)/cost-optimization/costScanBanner.ts.
 */
export const ANALYSIS_PARTIAL_NOTE = "Some cost checks didn't complete, so these results may be incomplete.";
