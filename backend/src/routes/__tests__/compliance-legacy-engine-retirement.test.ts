/**
 * Coverage for PR #94: retirement of the orphaned legacy ComplianceEngineService
 * API surface. Five routes (GET /results, GET /results/:framework,
 * GET /history/:framework, POST /scan, POST /scan/:framework) are removed from
 * the application runtime entirely -- confirmed via the PR's dependency audit to
 * have zero frontend consumers and zero job consumers. GET /report/:framework is
 * unchanged (already retired to HTTP 410 before this PR, and never depended on
 * ComplianceEngineService in the first place).
 *
 * This is a route-surface test only. It does not touch, and makes no claim about,
 * ComplianceScannerService.checkSOC2Compliance()/checkHIPAACompliance(),
 * aws_resources.compliance_issues, RiskTrackingService/Risk Score, or the
 * Security Hub architecture -- those are covered by their own existing test
 * suites, unmodified and re-run as part of this PR's validation.
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

import { createComplianceRoutes } from '../compliance.routes';

describe('legacy ComplianceEngineService route retirement (PR #94)', () => {
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

  it.each([
    ['GET', '/results'],
    ['GET', '/results/soc2'],
    ['GET', '/history/soc2'],
    ['POST', '/scan'],
    ['POST', '/scan/soc2'],
  ])('%s /api/compliance%s is no longer routed (404, not served by any handler)', async (method, path) => {
    const res = await fetch(`${baseUrl}/api/compliance${path}`, { method });
    expect(res.status).toBe(404);
  });

  it('a removed route does not accidentally fall through to the retained /report/:framework handler', async () => {
    // If Express route matching were somehow ambiguous, a GET to a removed path
    // could theoretically match a different registered pattern. Assert the 404
    // response is a plain Express "no route" response, never the 410 report-retired
    // JSON body (which would indicate an accidental match to /report/:framework).
    const res = await fetch(`${baseUrl}/api/compliance/results`);
    expect(res.status).toBe(404);
    const text = await res.text();
    expect(text).not.toMatch(/This report has been retired/);
  });

  it('GET /api/compliance/report/:framework still returns 410 Gone, unaffected by the route removal', async () => {
    const res = await fetch(`${baseUrl}/api/compliance/report/soc2`);
    expect(res.status).toBe(410);
    const body = (await res.json()) as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/retired/i);
  });

  it('the compliance.routes.ts source no longer imports or instantiates ComplianceEngineService', () => {
    const source = require('fs').readFileSync(
      require('path').join(__dirname, '..', 'compliance.routes.ts'),
      'utf-8'
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/ComplianceEngineService/);
    expect(code).not.toMatch(/from '\.\.\/services\/compliance-engine\.service'/);
  });

  it('server.ts no longer imports or references compliance-engine.service.ts', () => {
    const source = require('fs').readFileSync(
      require('path').join(__dirname, '..', '..', 'server.ts'),
      'utf-8'
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/compliance-engine\.service/);
    expect(code).not.toMatch(/ComplianceEngineService/);
  });

  it('the compliance-engine.service.ts file itself no longer exists in the repository', () => {
    const fs = require('fs');
    const path = require('path');
    const filePath = path.join(__dirname, '..', '..', 'services', 'compliance-engine.service.ts');
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it('routes/index.ts still mounts security-hub.routes.ts unchanged (collateral-damage guard)', () => {
    const source = require('fs').readFileSync(
      require('path').join(__dirname, '..', 'index.ts'),
      'utf-8'
    );
    expect(source).toMatch(/security-hub\.routes/);
    expect(source).toMatch(/'\/security-hub'/);
  });
});
