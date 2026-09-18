/**
 * Coverage for the Phase 2 read-only SOC 2 Readiness API (GET /api/soc2/readiness,
 * /readiness/:criterionId, /evidence). Auth middleware and Soc2EvidenceRepository are
 * mocked -- the property under test is this route layer's own behavior (dispatch,
 * organization scoping, criterion validation, response shape, truthfulness, read-only
 * guarantee), not the repository/RLS internals (covered elsewhere: soc2-evidence-rls.test.ts,
 * soc2-evidence.service.test.ts, soc2-evidence.risk-score-isolation.test.ts).
 */
import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';
import fs from 'fs';
import path from 'path';
import { SOC2_V1_CRITERIA } from '../../config/soc2CriteriaConfig';

// Per-organization canned data, so tests can prove org A's request never sees org B's
// rows even if the route were (incorrectly) passed a client-supplied org id.
const EVALUATIONS_BY_ORG: Record<string, any[]> = {
  'org-a': [
    {
      id: 'eval-a-1',
      organization_id: 'org-a',
      criterion_id: 'CC6.1',
      disposition_class: 'A_OBSERVABLE',
      evidence_summary: { supports: 3, contradicts: 0, unknown: 1 },
      customer_evidence_ids: [],
      computed_at: new Date('2026-09-18T06:30:00.000Z'),
    },
  ],
  'org-b': [
    {
      id: 'eval-b-1',
      organization_id: 'org-b',
      criterion_id: 'CC6.1',
      disposition_class: 'A_OBSERVABLE',
      evidence_summary: { supports: 0, contradicts: 1, unknown: 0 },
      customer_evidence_ids: [],
      computed_at: new Date('2026-09-18T06:31:00.000Z'),
    },
  ],
  'org-empty': [],
};

const OBSERVATIONS_BY_ORG: Record<string, any[]> = {
  'org-a': [
    {
      id: 'obs-a-1',
      organization_id: 'org-a',
      criterion_id: 'CC6.1',
      resource_arn: 'arn:aws:ec2:us-east-1:111111111111:volume/vol-aaa',
      resource_type: 'ebs',
      provenance: 'OBSERVED',
      result: 'SUPPORTS',
      observed_at: new Date('2026-09-18T06:00:00.000Z'),
      collected_at: new Date('2026-09-18T06:00:00.000Z'),
      source: { source_type: 'aws_resource_field', field: 'is_encrypted', resource_type: 'ebs' },
      explanation: 'EBS volume is encrypted.',
      schema_version: 1,
      created_at: new Date('2026-09-18T06:00:01.000Z'),
    },
  ],
  'org-b': [
    {
      id: 'obs-b-1',
      organization_id: 'org-b',
      criterion_id: 'CC6.1',
      resource_arn: 'arn:aws:ec2:us-east-1:222222222222:volume/vol-bbb',
      resource_type: 'ebs',
      provenance: 'OBSERVED',
      result: 'CONTRADICTS',
      observed_at: new Date('2026-09-18T06:00:00.000Z'),
      collected_at: new Date('2026-09-18T06:00:00.000Z'),
      source: { source_type: 'aws_resource_field', field: 'is_encrypted', resource_type: 'ebs' },
      explanation: 'EBS volume is not encrypted.',
      schema_version: 1,
      created_at: new Date('2026-09-18T06:00:01.000Z'),
    },
  ],
  'org-empty': [],
};

const mockGetControlEvaluations = jest.fn(async (orgId: string) => EVALUATIONS_BY_ORG[orgId] ?? []);
const mockGetObservations = jest.fn(async (orgId: string, criterionId?: string) => {
  const rows = OBSERVATIONS_BY_ORG[orgId] ?? [];
  return criterionId ? rows.filter((r) => r.criterion_id === criterionId) : rows;
});
const mockIsLatestDiscoveryComplete = jest.fn(async () => true);
const mockUpsertObservations = jest.fn(async () => {
  throw new Error('upsertObservations must never be called by a GET route');
});
const mockUpsertControlEvaluation = jest.fn(async () => {
  throw new Error('upsertControlEvaluation must never be called by a GET route');
});

jest.mock('../../repositories/soc2-evidence.repository', () => ({
  Soc2EvidenceRepository: jest.fn().mockImplementation(() => ({
    getControlEvaluations: mockGetControlEvaluations,
    getObservations: mockGetObservations,
    isLatestDiscoveryComplete: mockIsLatestDiscoveryComplete,
    upsertObservations: mockUpsertObservations,
    upsertControlEvaluation: mockUpsertControlEvaluation,
  })),
}));

jest.mock('../../config/database', () => ({ pool: {} }));

jest.mock('../../middleware/auth.middleware', () => ({
  authenticateToken: (req: any, res: any, next: any) => {
    if (req.headers['x-test-unauthenticated']) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }
    // Organization comes only from the (mocked) token -- never from the request itself.
    req.organizationId = req.headers['x-test-org'] || 'org-a';
    next();
  },
}));

import soc2Routes from '../soc2.routes';

describe('SOC2 Readiness API (Phase 2)', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll((done) => {
    const app = express();
    app.use(express.json());
    app.use('/api/soc2', soc2Routes);
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

  // ---------------------------------------------------------------------------
  // AUTH
  // ---------------------------------------------------------------------------
  describe('auth', () => {
    it('rejects an unauthenticated request', async () => {
      const res = await fetch(`${baseUrl}/api/soc2/readiness`, {
        headers: { 'x-test-unauthenticated': '1' },
      });
      expect(res.status).toBe(401);
      const body = (await res.json()) as { success: boolean };
      expect(body.success).toBe(false);
      expect(mockGetControlEvaluations).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // ORGANIZATION ISOLATION
  // ---------------------------------------------------------------------------
  describe('organization isolation', () => {
    it('org A cannot read org B evaluations via /readiness', async () => {
      const res = await fetch(`${baseUrl}/api/soc2/readiness`, {
        headers: { 'x-test-org': 'org-a' },
      });
      const body = (await res.json()) as { criteria: Array<{ criterionId: string; evidenceSummary: any }> };
      const cc61 = body.criteria.find((c) => c.criterionId === 'CC6.1')!;
      expect(cc61.evidenceSummary).toEqual({ supports: 3, contradicts: 0, unknown: 1 }); // org-a's data
      expect(mockGetControlEvaluations).toHaveBeenCalledWith('org-a');
    });

    it('org B cannot read org A evaluations via /readiness', async () => {
      const res = await fetch(`${baseUrl}/api/soc2/readiness`, {
        headers: { 'x-test-org': 'org-b' },
      });
      const body = (await res.json()) as { criteria: Array<{ criterionId: string; evidenceSummary: any }> };
      const cc61 = body.criteria.find((c) => c.criterionId === 'CC6.1')!;
      expect(cc61.evidenceSummary).toEqual({ supports: 0, contradicts: 1, unknown: 0 }); // org-b's data
      expect(mockGetControlEvaluations).toHaveBeenCalledWith('org-b');
    });

    it('org A cannot read org B observations via /evidence', async () => {
      const res = await fetch(`${baseUrl}/api/soc2/evidence`, {
        headers: { 'x-test-org': 'org-a' },
      });
      const body = (await res.json()) as { evidence: Array<{ resourceArn: string }> };
      expect(body.evidence).toHaveLength(1);
      expect(body.evidence[0].resourceArn).toBe('arn:aws:ec2:us-east-1:111111111111:volume/vol-aaa');
      expect(mockGetObservations).toHaveBeenCalledWith('org-a', undefined);
    });

    it('ignores a client-supplied organizationId query param and uses only the authenticated org', async () => {
      // Even if a client tries to smuggle a different org via a query string, the route
      // must never read it -- organizationId always comes from req.organizationId.
      const res = await fetch(`${baseUrl}/api/soc2/evidence?organizationId=org-b`, {
        headers: { 'x-test-org': 'org-a' },
      });
      const body = (await res.json()) as { evidence: Array<{ resourceArn: string }> };
      expect(body.evidence[0].resourceArn).toBe('arn:aws:ec2:us-east-1:111111111111:volume/vol-aaa');
      expect(mockGetObservations).toHaveBeenCalledWith('org-a', undefined);
    });
  });

  // ---------------------------------------------------------------------------
  // READINESS
  // ---------------------------------------------------------------------------
  describe('GET /readiness', () => {
    it('represents exactly the six approved Phase 1 criteria', async () => {
      const res = await fetch(`${baseUrl}/api/soc2/readiness`, { headers: { 'x-test-org': 'org-empty' } });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { criteria: Array<{ criterionId: string }> };
      expect(body.criteria.map((c) => c.criterionId).sort()).toEqual(
        SOC2_V1_CRITERIA.map((c) => c.criterionId).sort()
      );
      expect(body.criteria).toHaveLength(6);
    });

    it('returns a truthful not-evaluated state for an organization with no evaluations yet (current production state)', async () => {
      const res = await fetch(`${baseUrl}/api/soc2/readiness`, { headers: { 'x-test-org': 'org-empty' } });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        criteria: Array<{ evaluated: boolean; evidenceSummary: unknown; computedAt: unknown }>;
      };
      for (const criterion of body.criteria) {
        expect(criterion.evaluated).toBe(false);
        expect(criterion.evidenceSummary).toBeNull();
        expect(criterion.computedAt).toBeNull();
      }
    });

    it('passes through evaluation fields and preserves computedAt when an evaluation exists', async () => {
      const res = await fetch(`${baseUrl}/api/soc2/readiness`, { headers: { 'x-test-org': 'org-a' } });
      const body = (await res.json()) as {
        criteria: Array<{
          criterionId: string;
          evaluated: boolean;
          dispositionClass: string;
          evidenceSummary: any;
          computedAt: string;
        }>;
      };
      const cc61 = body.criteria.find((c) => c.criterionId === 'CC6.1')!;
      expect(cc61.evaluated).toBe(true);
      expect(cc61.dispositionClass).toBe('A_OBSERVABLE');
      expect(cc61.evidenceSummary).toEqual({ supports: 3, contradicts: 0, unknown: 1 });
      expect(cc61.computedAt).toBe('2026-09-18T06:30:00.000Z');

      const cc66 = body.criteria.find((c) => c.criterionId === 'CC6.6')!;
      expect(cc66.evaluated).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // CRITERION DETAIL
  // ---------------------------------------------------------------------------
  describe('GET /readiness/:criterionId', () => {
    it('returns the evaluation and evidence for a valid criterion', async () => {
      const res = await fetch(`${baseUrl}/api/soc2/readiness/CC6.1`, { headers: { 'x-test-org': 'org-a' } });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        criterion: { criterionId: string; computedAt: string };
        evidence: Array<{ collectedAt: string }>;
      };
      expect(body.criterion.criterionId).toBe('CC6.1');
      expect(body.criterion.computedAt).toBe('2026-09-18T06:30:00.000Z');
      expect(body.evidence).toHaveLength(1);
      // evaluation-level computedAt and observation-level collectedAt must not collapse
      expect(body.evidence[0].collectedAt).toBe('2026-09-18T06:00:00.000Z');
      expect(mockGetObservations).toHaveBeenCalledWith('org-a', 'CC6.1');
    });

    it('rejects an invalid criterionId with 400 and calls no repository method', async () => {
      const res = await fetch(`${baseUrl}/api/soc2/readiness/DROP-TABLE`, { headers: { 'x-test-org': 'org-a' } });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { success: boolean; error: string };
      expect(body.success).toBe(false);
      expect(body.error).toMatch(/Unknown criterion/);
      expect(mockGetControlEvaluations).not.toHaveBeenCalled();
      expect(mockGetObservations).not.toHaveBeenCalled();
    });

    it('rejects an unsupported (well-formed but not configured) criterionId with 400', async () => {
      const res = await fetch(`${baseUrl}/api/soc2/readiness/CC1.1`, { headers: { 'x-test-org': 'org-a' } });
      expect(res.status).toBe(400);
    });

    it('never accepts an organization_id from the client for the criterion-detail route', async () => {
      const res = await fetch(`${baseUrl}/api/soc2/readiness/CC6.1?organizationId=org-b`, {
        headers: { 'x-test-org': 'org-a' },
      });
      const body = (await res.json()) as { evidence: Array<{ resourceArn: string }> };
      expect(body.evidence[0].resourceArn).toBe('arn:aws:ec2:us-east-1:111111111111:volume/vol-aaa');
      expect(mockGetObservations).toHaveBeenCalledWith('org-a', 'CC6.1');
    });
  });

  // ---------------------------------------------------------------------------
  // EVIDENCE
  // ---------------------------------------------------------------------------
  describe('GET /evidence', () => {
    it('returns all current observations for the organization with no filter', async () => {
      const res = await fetch(`${baseUrl}/api/soc2/evidence`, { headers: { 'x-test-org': 'org-a' } });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { evidence: any[] };
      expect(body.evidence).toHaveLength(1);
      expect(mockGetObservations).toHaveBeenCalledWith('org-a', undefined);
    });

    it('supports the optional criterionId filter', async () => {
      const res = await fetch(`${baseUrl}/api/soc2/evidence?criterionId=CC6.1`, { headers: { 'x-test-org': 'org-a' } });
      expect(res.status).toBe(200);
      expect(mockGetObservations).toHaveBeenCalledWith('org-a', 'CC6.1');
    });

    it('rejects an invalid criterionId filter with 400 and calls no repository method', async () => {
      const res = await fetch(`${baseUrl}/api/soc2/evidence?criterionId=not-a-real-criterion`, {
        headers: { 'x-test-org': 'org-a' },
      });
      expect(res.status).toBe(400);
      expect(mockGetObservations).not.toHaveBeenCalled();
    });

    it('preserves provenance, result, collectedAt, observedAt, and source; omits the internal db id', async () => {
      const res = await fetch(`${baseUrl}/api/soc2/evidence`, { headers: { 'x-test-org': 'org-a' } });
      const body = (await res.json()) as { evidence: Array<Record<string, unknown>> };
      const [obs] = body.evidence;
      expect(obs.provenance).toBe('OBSERVED');
      expect(obs.result).toBe('SUPPORTS');
      expect(obs.collectedAt).toBe('2026-09-18T06:00:00.000Z');
      expect(obs.observedAt).toBe('2026-09-18T06:00:00.000Z');
      expect(obs.source).toEqual({ source_type: 'aws_resource_field', field: 'is_encrypted', resource_type: 'ebs' });
      expect(obs.schemaVersion).toBe(1);
      expect(obs).not.toHaveProperty('id');
      expect(obs).not.toHaveProperty('organization_id');
      expect(obs).not.toHaveProperty('created_at');
    });
  });

  // ---------------------------------------------------------------------------
  // TRUTHFULNESS
  // ---------------------------------------------------------------------------
  describe('truthfulness', () => {
    const FORBIDDEN_PATTERNS = [
      /\bPASS\b/,
      /\bFAIL\b/,
      /COMPLIANT/i,
      /CERTIF/i,
      /TYPE\s*II/i,
      /AUDIT[- ]?APPROV/i,
      /OPERATING EFFECTIVENESS/i,
      /SOC\s*2\s*SCORE/i,
      /COMPLIANCE PERCENTAGE/i,
    ];

    it('the /readiness response never contains pass/fail/certification/score wording', async () => {
      const res = await fetch(`${baseUrl}/api/soc2/readiness`, { headers: { 'x-test-org': 'org-a' } });
      const raw = await res.text();
      for (const pattern of FORBIDDEN_PATTERNS) {
        expect(raw).not.toMatch(pattern);
      }
    });

    it('the /evidence response never contains pass/fail/certification/score wording', async () => {
      const res = await fetch(`${baseUrl}/api/soc2/evidence`, { headers: { 'x-test-org': 'org-a' } });
      const raw = await res.text();
      for (const pattern of FORBIDDEN_PATTERNS) {
        expect(raw).not.toMatch(pattern);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // READ-ONLY GUARANTEE
  // ---------------------------------------------------------------------------
  describe('read-only guarantee', () => {
    it('no route call ever invokes upsertObservations or upsertControlEvaluation', async () => {
      await fetch(`${baseUrl}/api/soc2/readiness`, { headers: { 'x-test-org': 'org-a' } });
      await fetch(`${baseUrl}/api/soc2/readiness/CC6.1`, { headers: { 'x-test-org': 'org-a' } });
      await fetch(`${baseUrl}/api/soc2/evidence`, { headers: { 'x-test-org': 'org-a' } });
      expect(mockUpsertObservations).not.toHaveBeenCalled();
      expect(mockUpsertControlEvaluation).not.toHaveBeenCalled();
    });

    it('static: the route file never references computeAndPersistEvidence, upsertObservations, upsertControlEvaluation, or any AWS SDK/write SQL', () => {
      const source = fs
        .readFileSync(path.join(__dirname, '..', 'soc2.routes.ts'), 'utf-8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      expect(source).not.toMatch(/computeAndPersistEvidence/);
      expect(source).not.toMatch(/upsertObservations/);
      expect(source).not.toMatch(/upsertControlEvaluation/);
      expect(source).not.toMatch(/INSERT INTO|UPDATE\s+\w+|DELETE FROM/i);
      expect(source).not.toMatch(/aws-sdk|@aws-sdk/);
      expect(source).not.toMatch(/calculateRiskScore|RiskTrackingService/);
      expect(source).not.toMatch(/compliance_issues|account_security_findings|security_hub_findings/);
    });
  });

  // ---------------------------------------------------------------------------
  // ERRORS
  // ---------------------------------------------------------------------------
  describe('errors', () => {
    it('a repository failure on /readiness returns 500, not a synthesized control failure', async () => {
      mockGetControlEvaluations.mockRejectedValueOnce(new Error('connection to database failed'));
      const res = await fetch(`${baseUrl}/api/soc2/readiness`, { headers: { 'x-test-org': 'org-a' } });
      expect(res.status).toBe(500);
      const body = (await res.json()) as { success: boolean };
      expect(body.success).toBe(false);
    });

    it('a repository failure on /evidence returns 500, not an empty success response', async () => {
      mockGetObservations.mockRejectedValueOnce(new Error('connection to database failed'));
      const res = await fetch(`${baseUrl}/api/soc2/evidence`, { headers: { 'x-test-org': 'org-a' } });
      expect(res.status).toBe(500);
      const body = (await res.json()) as { success: boolean };
      expect(body.success).toBe(false);
    });
  });
});
