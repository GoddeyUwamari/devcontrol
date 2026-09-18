/**
 * Coverage for the Phase 3 customer-evidence API
 * (POST/GET/PATCH /api/soc2/customer-evidence[/:evidenceId],
 * POST /:evidenceId/{review,expire,supersede}). Auth/tier/role middleware and
 * Soc2CustomerEvidenceRepository are mocked; the audit writer is mocked to a no-op so
 * these tests exercise routing, authorization wiring, the real (unmocked) service's
 * validation/lifecycle logic, response shape, and truthfulness -- not real Postgres/RLS
 * (covered separately by the live-DB schema/RLS test) or the audit_logs write itself
 * (covered by the audit service being a thin, already-reviewed pass-through).
 */
import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';
import fs from 'fs';
import path from 'path';

interface AuthedRequest {
  headers: Record<string, string | undefined>;
}

const mockCreate = jest.fn();
const mockGetAll = jest.fn();
const mockGetById = jest.fn();
const mockUpdateMetadata = jest.fn();
const mockReview = jest.fn();
const mockExpire = jest.fn();
const mockSupersede = jest.fn();

jest.mock('../../repositories/soc2-customer-evidence.repository', () => ({
  Soc2CustomerEvidenceRepository: jest.fn().mockImplementation(() => ({
    createCustomerEvidence: mockCreate,
    getCustomerEvidence: mockGetAll,
    getCustomerEvidenceById: mockGetById,
    updateCustomerEvidenceMetadata: mockUpdateMetadata,
    reviewCustomerEvidence: mockReview,
    expireCustomerEvidence: mockExpire,
    supersedeCustomerEvidence: mockSupersede,
  })),
}));

jest.mock('../../services/soc2CustomerEvidenceAudit.service', () => ({
  soc2CustomerEvidenceAuditService: { record: jest.fn().mockResolvedValue(undefined) },
}));

jest.mock('../../config/database', () => ({ pool: {} }));

// Simulated request state, set per-test via headers so different requests in the same
// test can represent different orgs/roles/tiers.
jest.mock('../../middleware/auth.middleware', () => ({
  authenticateToken: (req: any, res: any, next: any) => {
    if (req.headers['x-test-unauthenticated']) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }
    req.organizationId = req.headers['x-test-org'] || 'org-a';
    req.user = { userId: req.headers['x-test-user'] || 'user-a', role: req.headers['x-test-role'] || 'member' };
    next();
  },
}));

jest.mock('../../middleware/subscription.middleware', () => ({
  requireEnterprise: (req: any, res: any, next: any) => {
    if (req.headers['x-test-tier'] === 'pro') {
      res.status(402).json({ success: false, error: 'Subscription tier insufficient', code: 'TIER_REQUIRED' });
      return;
    }
    next();
  },
}));

jest.mock('../../middleware/rbac.middleware', () => ({
  requireMember: (req: any, res: any, next: any) => {
    const role = req.user?.role;
    if (!['owner', 'admin', 'member'].includes(role)) {
      res.status(403).json({ success: false, error: 'Insufficient permissions' });
      return;
    }
    next();
  },
}));

jest.mock('../../middleware/platformAuth.middleware', () => ({
  requirePlatformStaff: (req: any, res: any, next: any) => {
    if (!req.headers['x-test-platform-staff']) {
      res.status(403).json({ success: false, error: 'Platform staff authorization required' });
      return;
    }
    next();
  },
}));

import soc2CustomerEvidenceRoutes from '../soc2-customer-evidence.routes';

function evidenceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'evidence-1',
    organization_id: 'org-a',
    criterion_id: 'CC6.1',
    evidence_type: 'policy',
    title: 'Encryption policy',
    description: 'Our encryption-at-rest policy.',
    external_reference: 'https://example.com/policy.pdf',
    provenance: 'SELF_ATTESTED',
    status: 'SUBMITTED',
    submitted_by: 'user-a',
    submitted_at: new Date('2026-09-18T00:00:00.000Z'),
    review_date: null,
    created_at: new Date('2026-09-18T00:00:00.000Z'),
    updated_at: new Date('2026-09-18T00:00:00.000Z'),
    ...overrides,
  };
}

describe('SOC2 Customer Evidence API (Phase 3)', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll((done) => {
    const app = express();
    app.use(express.json());
    app.use('/api/soc2/customer-evidence', soc2CustomerEvidenceRoutes);
    server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      baseUrl = `http://localhost:${port}`;
      done();
    });
  });

  afterAll((done) => {
    server.close(done);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('auth / entitlement', () => {
    it('rejects an unauthenticated request', async () => {
      const res = await fetch(`${baseUrl}/api/soc2/customer-evidence`, { headers: { 'x-test-unauthenticated': '1' } });
      expect(res.status).toBe(401);
      expect(mockGetAll).not.toHaveBeenCalled();
    });

    it('rejects a non-Enterprise organization', async () => {
      const res = await fetch(`${baseUrl}/api/soc2/customer-evidence`, { headers: { 'x-test-tier': 'pro' } });
      expect(res.status).toBe(402);
      expect(mockGetAll).not.toHaveBeenCalled();
    });

    it('allows an Enterprise member to list evidence', async () => {
      mockGetAll.mockResolvedValue([]);
      const res = await fetch(`${baseUrl}/api/soc2/customer-evidence`, { headers: { 'x-test-role': 'member' } });
      expect(res.status).toBe(200);
    });

    it('rejects a viewer-role user from self-service routes', async () => {
      const res = await fetch(`${baseUrl}/api/soc2/customer-evidence`, { headers: { 'x-test-role': 'viewer' } });
      expect(res.status).toBe(403);
    });
  });

  describe('tenant isolation', () => {
    it('org A cannot read org B evidence by id (repository call is scoped to the authenticated org, not a client value)', async () => {
      mockGetById.mockImplementation(async (orgId: string) => (orgId === 'org-a' ? evidenceRow() : undefined));
      const res = await fetch(`${baseUrl}/api/soc2/customer-evidence/evidence-1`, { headers: { 'x-test-org': 'org-a' } });
      expect(res.status).toBe(200);
      expect(mockGetById).toHaveBeenCalledWith('org-a', 'evidence-1');

      const resB = await fetch(`${baseUrl}/api/soc2/customer-evidence/evidence-1`, { headers: { 'x-test-org': 'org-b' } });
      expect(resB.status).toBe(404);
      expect(mockGetById).toHaveBeenCalledWith('org-b', 'evidence-1');
    });

    it('org A cannot review org B evidence', async () => {
      mockGetById.mockImplementation(async (orgId: string) =>
        orgId === 'org-a' ? evidenceRow({ status: 'SUBMITTED' }) : undefined
      );
      const res = await fetch(`${baseUrl}/api/soc2/customer-evidence/evidence-1/review`, {
        method: 'POST',
        headers: { 'x-test-org': 'org-b', 'x-test-platform-staff': '1' },
      });
      expect(res.status).toBe(404);
      expect(mockReview).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('creates evidence and returns the mapped public shape', async () => {
      mockCreate.mockResolvedValue(evidenceRow());
      const res = await fetch(`${baseUrl}/api/soc2/customer-evidence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ criterionId: 'CC6.1', evidenceType: 'policy', title: 'Encryption policy' }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { customerEvidence: Record<string, unknown> };
      expect(body.customerEvidence.evidenceId).toBe('evidence-1');
      expect(body.customerEvidence.provenance).toBe('SELF_ATTESTED');
      expect(body.customerEvidence.status).toBe('SUBMITTED');
      expect(body.customerEvidence).not.toHaveProperty('organization_id');
      expect(body.customerEvidence).not.toHaveProperty('id');
    });

    it('rejects an invalid criterion with 400 and calls no repository method', async () => {
      const res = await fetch(`${baseUrl}/api/soc2/customer-evidence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ criterionId: 'NOT-REAL', evidenceType: 'policy', title: 'x' }),
      });
      expect(res.status).toBe(400);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('ignores a client-supplied provenance/status/organizationId in the body', async () => {
      mockCreate.mockResolvedValue(evidenceRow());
      await fetch(`${baseUrl}/api/soc2/customer-evidence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          criterionId: 'CC6.1',
          evidenceType: 'policy',
          title: 'x',
          provenance: 'OBSERVED',
          status: 'REVIEWED',
          organizationId: 'org-b',
        }),
      });
      const passedInput = mockCreate.mock.calls[0][1];
      expect(passedInput).not.toHaveProperty('provenance');
      expect(passedInput).not.toHaveProperty('status');
      expect(mockCreate).toHaveBeenCalledWith('org-a', expect.anything());
    });
  });

  describe('PATCH (metadata only)', () => {
    it('allows an editable-metadata update while SUBMITTED', async () => {
      mockGetById.mockResolvedValue(evidenceRow({ status: 'SUBMITTED' }));
      mockUpdateMetadata.mockResolvedValue(evidenceRow({ title: 'Updated' }));
      const res = await fetch(`${baseUrl}/api/soc2/customer-evidence/evidence-1`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Updated' }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { customerEvidence: { title: string } };
      expect(body.customerEvidence.title).toBe('Updated');
    });

    it('rejects PATCH on REVIEWED evidence with a conflict, not a silent edit', async () => {
      mockGetById.mockResolvedValue(evidenceRow({ status: 'REVIEWED' }));
      const res = await fetch(`${baseUrl}/api/soc2/customer-evidence/evidence-1`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Updated' }),
      });
      expect(res.status).toBe(409);
      expect(mockUpdateMetadata).not.toHaveBeenCalled();
    });

    it('a PATCH body containing status/provenance/organizationId never reaches the repository patch object', async () => {
      mockGetById.mockResolvedValue(evidenceRow({ status: 'SUBMITTED' }));
      mockUpdateMetadata.mockResolvedValue(evidenceRow());
      await fetch(`${baseUrl}/api/soc2/customer-evidence/evidence-1`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'x', status: 'REVIEWED', provenance: 'OBSERVED', organizationId: 'org-b' }),
      });
      const patch = mockUpdateMetadata.mock.calls[0][2];
      expect(patch).not.toHaveProperty('status');
      expect(patch).not.toHaveProperty('provenance');
      expect(patch).not.toHaveProperty('organization_id');
    });
  });

  describe('lifecycle: review / expire / supersede', () => {
    it('a member (non-platform-staff) cannot review evidence', async () => {
      const res = await fetch(`${baseUrl}/api/soc2/customer-evidence/evidence-1/review`, {
        method: 'POST',
        headers: { 'x-test-role': 'member' }, // no x-test-platform-staff header
      });
      expect(res.status).toBe(403);
      expect(mockReview).not.toHaveBeenCalled();
    });

    it('a member (non-platform-staff) cannot expire evidence', async () => {
      const res = await fetch(`${baseUrl}/api/soc2/customer-evidence/evidence-1/expire`, {
        method: 'POST',
        headers: { 'x-test-role': 'member' },
      });
      expect(res.status).toBe(403);
      expect(mockExpire).not.toHaveBeenCalled();
    });

    it('a member (non-platform-staff) cannot supersede evidence', async () => {
      const res = await fetch(`${baseUrl}/api/soc2/customer-evidence/evidence-1/supersede`, {
        method: 'POST',
        headers: { 'x-test-role': 'member' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(403);
      expect(mockSupersede).not.toHaveBeenCalled();
    });

    it('platform staff can review SUBMITTED evidence', async () => {
      mockGetById.mockResolvedValue(evidenceRow({ status: 'SUBMITTED' }));
      mockReview.mockResolvedValue(evidenceRow({ status: 'REVIEWED' }));
      const res = await fetch(`${baseUrl}/api/soc2/customer-evidence/evidence-1/review`, {
        method: 'POST',
        headers: { 'x-test-platform-staff': '1' },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { customerEvidence: { status: string } };
      expect(body.customerEvidence.status).toBe('REVIEWED');
    });

    it('platform staff can expire SUBMITTED or REVIEWED evidence', async () => {
      mockGetById.mockResolvedValue(evidenceRow({ status: 'REVIEWED' }));
      mockExpire.mockResolvedValue(evidenceRow({ status: 'EXPIRED' }));
      const res = await fetch(`${baseUrl}/api/soc2/customer-evidence/evidence-1/expire`, {
        method: 'POST',
        headers: { 'x-test-platform-staff': '1' },
      });
      expect(res.status).toBe(200);
    });

    it('platform staff can supersede, and both records come back distinctly', async () => {
      mockGetById.mockResolvedValue(evidenceRow({ id: 'evidence-1', criterion_id: 'CC6.1', status: 'REVIEWED' }));
      mockSupersede.mockResolvedValue({
        superseded: evidenceRow({ id: 'evidence-1', status: 'SUPERSEDED' }),
        replacement: evidenceRow({ id: 'evidence-2', status: 'SUBMITTED', title: 'Updated policy' }),
      });
      const res = await fetch(`${baseUrl}/api/soc2/customer-evidence/evidence-1/supersede`, {
        method: 'POST',
        headers: { 'x-test-platform-staff': '1', 'Content-Type': 'application/json' },
        body: JSON.stringify({ criterionId: 'CC6.1', evidenceType: 'policy', title: 'Updated policy' }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { superseded: { status: string }; replacement: { status: string; title: string } };
      expect(body.superseded.status).toBe('SUPERSEDED');
      expect(body.replacement.status).toBe('SUBMITTED');
      expect(body.replacement.title).toBe('Updated policy');
    });
  });

  describe('no DELETE route exists', () => {
    it('DELETE on the collection is not handled by this router (falls through, not a 200)', async () => {
      const res = await fetch(`${baseUrl}/api/soc2/customer-evidence/evidence-1`, { method: 'DELETE' });
      expect(res.status).not.toBe(200);
    });
  });

  describe('truthfulness', () => {
    const FORBIDDEN_PATTERNS = [
      /\bPASS\b/,
      /\bFAIL\b/,
      /\bACCEPTED\b/,
      /COMPLIANT/i,
      /CERTIF/i,
      /TYPE\s*II/i,
      /AUDIT[- ]?APPROV/i,
      /OPERATING EFFECTIVENESS/i,
    ];

    it('the create response never contains certification/PASS-FAIL/ACCEPTED wording', async () => {
      mockCreate.mockResolvedValue(evidenceRow());
      const res = await fetch(`${baseUrl}/api/soc2/customer-evidence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ criterionId: 'CC6.1', evidenceType: 'policy', title: 'x' }),
      });
      const raw = await res.text();
      for (const pattern of FORBIDDEN_PATTERNS) expect(raw).not.toMatch(pattern);
    });

    it('the review response never contains certification/PASS-FAIL/ACCEPTED wording', async () => {
      mockGetById.mockResolvedValue(evidenceRow({ status: 'SUBMITTED' }));
      mockReview.mockResolvedValue(evidenceRow({ status: 'REVIEWED' }));
      const res = await fetch(`${baseUrl}/api/soc2/customer-evidence/evidence-1/review`, {
        method: 'POST',
        headers: { 'x-test-platform-staff': '1' },
      });
      const raw = await res.text();
      for (const pattern of FORBIDDEN_PATTERNS) expect(raw).not.toMatch(pattern);
    });
  });

  describe('static isolation / read-only-equivalent regression', () => {
    function readCode(filePath: string): string {
      const full = fs.readFileSync(filePath, 'utf-8');
      return full.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    }

    it('the route file never imports AWS SDK, Soc2EvidenceService, Risk Score, or legacy compliance code', () => {
      const source = readCode(path.join(__dirname, '..', 'soc2-customer-evidence.routes.ts'));
      expect(source).not.toMatch(/aws-sdk|@aws-sdk/);
      expect(source).not.toMatch(/Soc2EvidenceService|computeAndPersistEvidence/);
      expect(source).not.toMatch(/calculateRiskScore|RiskTrackingService/);
      expect(source).not.toMatch(/ComplianceEngineService|complianceScanner/);
      expect(source).not.toMatch(/DELETE\s+FROM/i);
    });

    it('the service file never writes to soc2_evidence_observations, soc2_control_evaluations, compliance_issues, account_security_findings, or security_hub_findings', () => {
      const source = readCode(path.join(__dirname, '..', '..', 'services', 'soc2-customer-evidence.service.ts'));
      expect(source).not.toMatch(/soc2_evidence_observations|soc2_control_evaluations/);
      expect(source).not.toMatch(/compliance_issues|account_security_findings|security_hub_findings/);
      expect(source).not.toMatch(/aws-sdk|@aws-sdk/);
    });

    it('the repository file only ever targets customer_evidence, never any Phase 1/2 or compliance table', () => {
      const source = readCode(
        path.join(__dirname, '..', '..', 'repositories', 'soc2-customer-evidence.repository.ts')
      );
      const targets = [...source.matchAll(/(?:INSERT INTO|UPDATE|DELETE FROM)\s+(\w+)/gi)].map((m) => m[1]);
      expect(new Set(targets)).toEqual(new Set(['customer_evidence']));
    });
  });
});
