/**
 * Coverage for retiring the misleading legacy SOC 2/HIPAA "audit report" PDF
 * (product-truthfulness remediation). GET /api/compliance/report/:framework
 * previously generated a downloadable PDF whose cover page read literally
 * "CONFIDENTIAL — FOR AUDIT USE ONLY" / "SOC 2 Type II Compliance Audit
 * Report", backed by ComplianceEngineService's heuristic scan — an artifact a
 * customer could reasonably mistake for an independent SOC 2 audit report,
 * which DevControl does not perform. This endpoint must now refuse to
 * generate that document under any circumstances.
 *
 * Auth/subscription middleware are stubbed (pass-through) since the property
 * under test is this route's own retirement behavior, not the auth stack —
 * covered elsewhere.
 *
 * As of PR #94, ComplianceEngineService itself has been removed from this
 * router entirely (it had zero frontend/job consumers) -- this route never
 * depended on it in the first place (it validates the framework param and
 * refuses unconditionally), so no mock for that module is needed here anymore.
 */
import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';
import { Pool } from 'pg';

jest.mock('../../middleware/auth.middleware', () => ({
  authenticateToken: (req: any, _res: any, next: any) => {
    req.organizationId = 'org-test-1';
    next();
  },
}));

jest.mock('../../middleware/subscription.middleware', () => ({
  requireEnterprise: (_req: any, _res: any, next: any) => next(),
}));

jest.mock('../../middleware/rateLimiter', () => ({
  standardRateLimiter: (_req: any, _res: any, next: any) => next(),
}));

import { createComplianceRoutes } from '../compliance.routes';

describe('GET /api/compliance/report/:framework — retirement', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll((done) => {
    const app = express();
    app.use(express.json());
    app.use('/api/compliance', createComplianceRoutes({} as unknown as Pool));
    server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      baseUrl = `http://localhost:${port}`;
      done();
    });
  });

  afterAll((done) => {
    server.close(done);
  });

  it('returns 410 Gone instead of a PDF for the soc2 report', async () => {
    const res = await fetch(`${baseUrl}/api/compliance/report/soc2`);
    expect(res.status).toBe(410);
    expect(res.headers.get('content-type')).not.toMatch(/application\/pdf/);
  });

  it('the response body contains no audit-report branding and explicitly says the report is retired', async () => {
    const res = await fetch(`${baseUrl}/api/compliance/report/soc2`);
    const body = (await res.json()) as { success: boolean };
    expect(body.success).toBe(false);
    const text = JSON.stringify(body);
    expect(text).not.toMatch(/CONFIDENTIAL/);
    expect(text).not.toMatch(/FOR AUDIT USE ONLY/);
    expect(text).not.toMatch(/SOC 2 Type II Compliance Audit Report/);
    expect(text.toLowerCase()).toMatch(/retired/);
  });

  it('same retirement behavior for the hipaa report', async () => {
    const res = await fetch(`${baseUrl}/api/compliance/report/hipaa`);
    expect(res.status).toBe(410);
    const body: unknown = await res.json();
    expect(JSON.stringify(body)).not.toMatch(/CONFIDENTIAL/);
  });

  it('still rejects an invalid framework with 400, not by attempting report generation', async () => {
    const res = await fetch(`${baseUrl}/api/compliance/report/nist`);
    expect(res.status).toBe(400);
  });

  it('no PDF-generation dependency (jsPDF/jspdf-autotable) is imported by the route module', () => {
    // Guards against silently re-adding PDF generation to this file without
    // also updating this retirement test.
    const source = require('fs').readFileSync(
      require('path').join(__dirname, '..', 'compliance.routes.ts'),
      'utf-8'
    );
    expect(source).not.toMatch(/from 'jspdf'/);
    expect(source).not.toMatch(/from 'jspdf-autotable'/);
    expect(source).not.toMatch(/generateCompliancePDF/);
  });
});
