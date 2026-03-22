import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { authenticateToken } from '../middleware/auth.middleware';
import { requireEnterprise } from '../middleware/subscription.middleware';
import { standardRateLimiter } from '../middleware/rateLimiter';
import { ComplianceEngineService } from '../services/compliance-engine.service';
import { ControlFramework } from '../data/compliance-controls';

function isValidFramework(f: string): f is ControlFramework {
  return f === 'soc2' || f === 'hipaa';
}

export function createComplianceRoutes(pool: Pool): Router {
  const router = Router();
  const engine = new ComplianceEngineService(pool);

  // All routes require authentication
  router.use(authenticateToken);

  /**
   * GET /api/compliance/results
   * Get latest scan results for all frameworks (no new scan)
   */
  router.get('/results', async (req: Request, res: Response): Promise<void> => {
    try {
      const organizationId = req.organizationId;
      if (!organizationId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const results = await engine.getAllLatestResults(organizationId);
      res.json({ success: true, results });
    } catch (error: any) {
      console.error('[Compliance] Error fetching results:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * GET /api/compliance/results/:framework
   * Get latest scan results for a specific framework
   */
  router.get('/results/:framework', async (req: Request, res: Response): Promise<void> => {
    try {
      const { framework } = req.params;
      const organizationId = req.organizationId;
      if (!organizationId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      if (!isValidFramework(framework)) {
        res.status(400).json({ success: false, error: 'Invalid framework. Use "soc2" or "hipaa".' });
        return;
      }

      const result = await engine.getLatestResult(organizationId, framework);
      res.json({ success: true, result });
    } catch (error: any) {
      console.error('[Compliance] Error fetching result:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * GET /api/compliance/history/:framework
   * Get historical scan scores for trend chart
   */
  router.get('/history/:framework', async (req: Request, res: Response): Promise<void> => {
    try {
      const { framework } = req.params;
      const organizationId = req.organizationId;
      if (!organizationId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      if (!isValidFramework(framework)) {
        res.status(400).json({ success: false, error: 'Invalid framework.' });
        return;
      }

      const days = Math.min(parseInt(req.query.days as string) || 90, 365);
      const history = await engine.getScanHistory(organizationId, framework, days);
      res.json({ success: true, history });
    } catch (error: any) {
      console.error('[Compliance] Error fetching history:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * POST /api/compliance/scan
   * Run a compliance scan for all frameworks — Enterprise only
   */
  router.post('/scan', requireEnterprise, standardRateLimiter, async (req: Request, res: Response): Promise<void> => {
    try {
      const organizationId = req.organizationId;
      if (!organizationId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      console.log(`[Compliance] Running full scan for org ${organizationId}`);
      const results = await engine.runAllScans(organizationId);

      res.json({
        success: true,
        message: 'Compliance scan completed',
        results,
      });
    } catch (error: any) {
      console.error('[Compliance] Error running scan:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * POST /api/compliance/scan/:framework
   * Run a compliance scan for a specific framework — Enterprise only
   */
  router.post('/scan/:framework', requireEnterprise, standardRateLimiter, async (req: Request, res: Response): Promise<void> => {
    try {
      const { framework } = req.params;
      const organizationId = req.organizationId;
      if (!organizationId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      if (!isValidFramework(framework)) {
        res.status(400).json({ success: false, error: 'Invalid framework. Use "soc2" or "hipaa".' });
        return;
      }

      console.log(`[Compliance] Running ${framework} scan for org ${organizationId}`);
      const result = await engine.runScan(organizationId, framework);

      res.json({
        success: true,
        message: `${framework.toUpperCase()} compliance scan completed`,
        result,
      });
    } catch (error: any) {
      console.error('[Compliance] Error running scan:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * GET /api/compliance/report/:framework
   * Download a PDF audit report — Enterprise only
   */
  router.get('/report/:framework', requireEnterprise, async (req: Request, res: Response): Promise<void> => {
    try {
      const { framework } = req.params;
      const organizationId = req.organizationId;
      if (!organizationId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      if (!isValidFramework(framework)) {
        res.status(400).json({ success: false, error: 'Invalid framework.' });
        return;
      }

      // Get latest results (or run a fresh scan if none exist)
      let result = await engine.getLatestResult(organizationId, framework);
      if (!result) {
        result = await engine.runScan(organizationId, framework);
      }

      const pdfBuffer = generateCompliancePDF(framework, result);

      const frameworkLabel = framework === 'soc2' ? 'SOC2' : 'HIPAA';
      const dateStr = new Date().toISOString().split('T')[0];

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${frameworkLabel}-compliance-report-${dateStr}.pdf"`);
      res.send(pdfBuffer);
    } catch (error: any) {
      console.error('[Compliance] Error generating report:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  return router;
}

/**
 * Generate a compliance PDF audit report using jsPDF
 */
function generateCompliancePDF(framework: ControlFramework, result: any): Buffer {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'in', format: 'letter' });
  const pageWidth = 11;
  const pageHeight = 8.5;
  const margin = 0.75;

  const frameworkLabel = framework === 'soc2' ? 'SOC 2 Type II' : 'HIPAA Security Rule';
  const primaryColor = '#7c3aed';
  const darkGray = '#1f2937';
  const reportDate = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  // ── Cover Page ──────────────────────────────────────────────────────────
  doc.setFillColor('#7c3aed');
  doc.rect(0, 0, pageWidth, pageHeight, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('CONFIDENTIAL — FOR AUDIT USE ONLY', pageWidth / 2, 1.2, { align: 'center' });

  doc.setFontSize(32);
  doc.setFont('helvetica', 'bold');
  doc.text(`${frameworkLabel}`, pageWidth / 2, 2.4, { align: 'center' });

  doc.setFontSize(18);
  doc.setFont('helvetica', 'normal');
  doc.text('Compliance Audit Report', pageWidth / 2, 3.0, { align: 'center' });

  doc.setFontSize(12);
  doc.text(`Generated: ${reportDate}`, pageWidth / 2, 3.6, { align: 'center' });

  // Score box
  const scoreBoxX = pageWidth / 2 - 1.2;
  const scoreBoxY = 4.4;
  const scoreBoxW = 2.4;
  const scoreBoxH = 1.4;
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(scoreBoxX, scoreBoxY, scoreBoxW, scoreBoxH, 0.15, 0.15, 'F');

  const scoreColor = result.overallScore >= 80 ? '#059669' : result.overallScore >= 60 ? '#d97706' : '#dc2626';
  doc.setTextColor(scoreColor);
  doc.setFontSize(36);
  doc.setFont('helvetica', 'bold');
  doc.text(`${result.overallScore}%`, pageWidth / 2, 5.2, { align: 'center' });
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 100, 100);
  doc.text('Overall Compliance Score', pageWidth / 2, 5.55, { align: 'center' });

  // Summary stats
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(11);
  doc.text(
    `Controls Passed: ${result.controlsPassed}   Controls Failed: ${result.controlsFailed}   Total Controls: ${result.controlsTotal}`,
    pageWidth / 2,
    6.5,
    { align: 'center' }
  );

  doc.setFontSize(9);
  doc.text('Platform Portal — DevControl Compliance Engine', pageWidth / 2, 7.8, { align: 'center' });

  // ── Control Results Page ─────────────────────────────────────────────────
  doc.addPage();
  doc.setTextColor(darkGray);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('Control Evaluation Results', margin, margin + 0.3);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 100, 100);
  doc.text(`Scan completed: ${new Date(result.scannedAt).toLocaleString()}`, margin, margin + 0.55);

  // Group by category
  const byCategory: Record<string, any[]> = {};
  for (const ctrl of result.controlResults) {
    if (!byCategory[ctrl.category]) byCategory[ctrl.category] = [];
    byCategory[ctrl.category].push(ctrl);
  }

  const tableBody = result.controlResults.map((ctrl: any) => [
    ctrl.controlId,
    ctrl.category,
    ctrl.name,
    ctrl.severity.toUpperCase(),
    ctrl.status === 'pass' ? 'PASS' : ctrl.status === 'not_applicable' ? 'N/A' : 'FAIL',
    `${ctrl.score}%`,
    ctrl.evidence?.details || '',
  ]);

  autoTable(doc, {
    head: [['Control ID', 'Category', 'Control Name', 'Severity', 'Status', 'Score', 'Evidence']],
    body: tableBody,
    startY: margin + 0.75,
    margin: { left: margin, right: margin },
    theme: 'grid',
    headStyles: {
      fillColor: '#7c3aed',
      textColor: '#ffffff',
      fontSize: 8,
      fontStyle: 'bold',
    },
    bodyStyles: { fontSize: 7.5 },
    columnStyles: {
      0: { cellWidth: 1.0 },
      1: { cellWidth: 1.4 },
      2: { cellWidth: 1.8 },
      3: { cellWidth: 0.7 },
      4: { cellWidth: 0.6 },
      5: { cellWidth: 0.5 },
      6: { cellWidth: 3.5 },
    },
    didParseCell: (data) => {
      if (data.column.index === 4 && data.section === 'body') {
        const val = data.cell.text[0];
        if (val === 'PASS') {
          data.cell.styles.textColor = '#059669';
          data.cell.styles.fontStyle = 'bold';
        } else if (val === 'FAIL') {
          data.cell.styles.textColor = '#dc2626';
          data.cell.styles.fontStyle = 'bold';
        }
      }
      if (data.column.index === 3 && data.section === 'body') {
        const val = data.cell.text[0];
        if (val === 'CRITICAL') data.cell.styles.textColor = '#dc2626';
        else if (val === 'HIGH') data.cell.styles.textColor = '#d97706';
      }
    },
  });

  // ── Remediation Guidance Page ────────────────────────────────────────────
  const failedControls = result.controlResults.filter((c: any) => c.status === 'fail');
  if (failedControls.length > 0) {
    doc.addPage();
    doc.setTextColor(darkGray);
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('Remediation Guidance', margin, margin + 0.3);

    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 100, 100);
    doc.text(`${failedControls.length} controls require remediation`, margin, margin + 0.55);

    autoTable(doc, {
      head: [['Control ID', 'Control Name', 'Severity', 'Score', 'Remediation Steps']],
      body: failedControls.map((ctrl: any) => [
        ctrl.controlId,
        ctrl.name,
        ctrl.severity.toUpperCase(),
        `${ctrl.score}%`,
        ctrl.remediationGuidance,
      ]),
      startY: margin + 0.75,
      margin: { left: margin, right: margin },
      theme: 'grid',
      headStyles: {
        fillColor: '#dc2626',
        textColor: '#ffffff',
        fontSize: 8,
        fontStyle: 'bold',
      },
      bodyStyles: { fontSize: 7.5 },
      columnStyles: {
        0: { cellWidth: 1.0 },
        1: { cellWidth: 2.0 },
        2: { cellWidth: 0.8 },
        3: { cellWidth: 0.6 },
        4: { cellWidth: 6.0 },
      },
    });
  }

  // ── Page Numbers ─────────────────────────────────────────────────────────
  const totalPages = (doc as any).internal.getNumberOfPages();
  for (let i = 2; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text(`Page ${i} of ${totalPages}  |  ${frameworkLabel} Compliance Report  |  ${reportDate}`, pageWidth / 2, pageHeight - 0.3, { align: 'center' });
  }

  return Buffer.from(doc.output('arraybuffer'));
}
