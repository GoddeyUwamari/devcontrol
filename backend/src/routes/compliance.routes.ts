import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { authenticateToken } from '../middleware/auth.middleware';
import { requireEnterprise } from '../middleware/subscription.middleware';
import { ControlFramework } from '../data/compliance-controls';

function isValidFramework(f: string): f is ControlFramework {
  return f === 'soc2' || f === 'hipaa';
}

/**
 * Legacy compliance engine API surface — retired.
 *
 * This router previously exposed ComplianceEngineService's SOC2/HIPAA
 * control-scan results (GET /results, GET /results/:framework,
 * GET /history/:framework, POST /scan, POST /scan/:framework). That
 * engine had zero frontend consumers and zero job consumers (see the
 * PR #94 dependency audit), so those five routes -- and the
 * ComplianceEngineService instantiation they existed to serve -- have
 * been removed from the application runtime entirely.
 *
 * This is unrelated to, and does not affect:
 *   - ComplianceScannerService.checkSOC2Compliance()/checkHIPAACompliance()
 *     (the live, tag-inferred infrastructure signals written into
 *     aws_resources.compliance_issues during AWS resource discovery)
 *   - RiskTrackingService / Risk Score / risk history
 *   - the customer-facing Compliance Frameworks product (/compliance/frameworks)
 *   - the Security Hub CIS/PCI/NIST architecture
 * None of those were touched by this change.
 *
 * compliance_scan_results (the table this engine wrote to) is left
 * exactly as it was -- historical rows are preserved, and the table is
 * simply no longer written to or read by any application code.
 *
 * Only GET /report/:framework remains, unchanged: it was already
 * retired to HTTP 410 (see its own comment below) before this PR, and
 * never depended on ComplianceEngineService in the first place -- it
 * validates the framework param and refuses unconditionally.
 */
export function createComplianceRoutes(pool: Pool): Router {
  const router = Router();

  // All routes require authentication
  router.use(authenticateToken);

  /**
   * GET /api/compliance/report/:framework
   * Retired: this previously generated a downloadable PDF branded "CONFIDENTIAL — FOR
   * AUDIT USE ONLY" / "SOC 2 Type II Compliance Audit Report" from ComplianceEngineService's
   * heuristic scan results — an artifact a customer could reasonably mistake for an
   * independent SOC 2 audit report, which DevControl does not perform. Retired as part of
   * the product-truthfulness remediation (see app/(app)/compliance/page.tsx, now a redirect
   * to /compliance/frameworks). Never re-add PDF generation to this endpoint without first
   * resolving that underlying truthfulness gap.
   */
  router.get('/report/:framework', requireEnterprise, async (req: Request, res: Response): Promise<void> => {
    const { framework } = req.params;
    if (!isValidFramework(framework)) {
      res.status(400).json({ success: false, error: 'Invalid framework.' });
      return;
    }
    res.status(410).json({
      success: false,
      error: 'This report has been retired. DevControl does not generate SOC 2 or HIPAA audit reports. See /compliance/frameworks for current, Security Hub-backed compliance readiness.',
    });
  });

  return router;
}
