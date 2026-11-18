/**
 * Cost Optimization page wording the weekly summary email repeats. No runtime
 * imports, so the frontend test
 * app/(app)/connect-aws/__tests__/weekly-email-health-copy.test.ts can import
 * it and keep it equal to app/(app)/cost-optimization/costScanBanner.ts.
 * (The Connect AWS failing-connection help was dropped from the email with
 * the executive brief, founder F3.)
 */

/**
 * PARTIAL_MESSAGE on the Cost Optimization page ("Analysis partly complete"):
 * added after the savings date line when the figures come from a cost analysis
 * that completed with some cost checks failed (WE-2 review H-1). The frontend
 * test keeps it equal to app/(app)/cost-optimization/costScanBanner.ts.
 */
export const ANALYSIS_PARTIAL_NOTE = "Some cost checks didn't complete, so these results may be incomplete.";
