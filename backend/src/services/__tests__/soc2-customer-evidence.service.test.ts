/**
 * Unit coverage for Soc2CustomerEvidenceService -- the repository is mocked so these
 * tests exercise validation, provenance/status enforcement, lifecycle-transition rules,
 * and audit-log invocation in isolation from real Postgres/RLS (covered separately by
 * the live-DB schema/RLS test).
 */
import {
  Soc2CustomerEvidenceConflictError,
  Soc2CustomerEvidenceService,
  Soc2CustomerEvidenceValidationError,
} from '../soc2-customer-evidence.service';
import { Soc2CustomerEvidence } from '../../types/soc2-evidence.types';

const mockRecord = jest.fn().mockResolvedValue(undefined);
jest.mock('../soc2CustomerEvidenceAudit.service', () => ({
  soc2CustomerEvidenceAuditService: { record: (...args: unknown[]) => mockRecord(...args) },
}));

function makeEvidence(overrides: Partial<Soc2CustomerEvidence> = {}): Soc2CustomerEvidence {
  return {
    id: 'evidence-1',
    organization_id: 'org-a',
    criterion_id: 'CC6.1',
    evidence_type: 'policy',
    title: 'Encryption policy',
    description: null,
    external_reference: null,
    provenance: 'SELF_ATTESTED',
    status: 'SUBMITTED',
    submitted_by: 'user-1',
    submitted_at: new Date('2026-09-18T00:00:00.000Z'),
    review_date: null,
    created_at: new Date('2026-09-18T00:00:00.000Z'),
    updated_at: new Date('2026-09-18T00:00:00.000Z'),
    ...overrides,
  };
}

function makeRepository() {
  return {
    createCustomerEvidence: jest.fn(),
    getCustomerEvidence: jest.fn(),
    getCustomerEvidenceById: jest.fn(),
    updateCustomerEvidenceMetadata: jest.fn(),
    reviewCustomerEvidence: jest.fn(),
    expireCustomerEvidence: jest.fn(),
    supersedeCustomerEvidence: jest.fn(),
  };
}

describe('Soc2CustomerEvidenceService', () => {
  beforeEach(() => {
    mockRecord.mockClear();
  });

  describe('createCustomerEvidence', () => {
    it('rejects an unknown criterion', async () => {
      const repo = makeRepository();
      const service = new Soc2CustomerEvidenceService(repo as any);
      await expect(
        service.createCustomerEvidence('org-a', 'user-1', {
          criterionId: 'NOT-REAL',
          evidenceType: 'policy',
          title: 'x',
        })
      ).rejects.toBeInstanceOf(Soc2CustomerEvidenceValidationError);
      expect(repo.createCustomerEvidence).not.toHaveBeenCalled();
    });

    it('rejects an unknown evidence type', async () => {
      const repo = makeRepository();
      const service = new Soc2CustomerEvidenceService(repo as any);
      await expect(
        service.createCustomerEvidence('org-a', 'user-1', {
          criterionId: 'CC6.1',
          evidenceType: 'not-a-real-type',
          title: 'x',
        })
      ).rejects.toBeInstanceOf(Soc2CustomerEvidenceValidationError);
    });

    it('rejects an empty title', async () => {
      const repo = makeRepository();
      const service = new Soc2CustomerEvidenceService(repo as any);
      await expect(
        service.createCustomerEvidence('org-a', 'user-1', { criterionId: 'CC6.1', evidenceType: 'policy', title: '   ' })
      ).rejects.toBeInstanceOf(Soc2CustomerEvidenceValidationError);
    });

    it('rejects an oversized description', async () => {
      const repo = makeRepository();
      const service = new Soc2CustomerEvidenceService(repo as any);
      await expect(
        service.createCustomerEvidence('org-a', 'user-1', {
          criterionId: 'CC6.1',
          evidenceType: 'policy',
          title: 'x',
          description: 'a'.repeat(2001),
        })
      ).rejects.toBeInstanceOf(Soc2CustomerEvidenceValidationError);
    });

    it('passes provenance SELF_ATTESTED and the authenticated submitted_by to the repository, ignoring any client-shaped provenance field', async () => {
      const repo = makeRepository();
      repo.createCustomerEvidence.mockResolvedValue(makeEvidence());
      const service = new Soc2CustomerEvidenceService(repo as any);

      // The request type has no `provenance` field at all -- this is a structural
      // guarantee, not just a runtime check, but we also confirm the repository call.
      await service.createCustomerEvidence('org-a', 'user-1', {
        criterionId: 'CC6.1',
        evidenceType: 'policy',
        title: 'Encryption policy',
      });

      expect(repo.createCustomerEvidence).toHaveBeenCalledWith(
        'org-a',
        expect.objectContaining({ submitted_by: 'user-1', criterion_id: 'CC6.1' })
      );
      // provenance/status are never part of CreateCustomerEvidenceInput at all --
      // confirmed by the type; the repository/DB defaults SELF_ATTESTED/SUBMITTED.
      const passedInput = repo.createCustomerEvidence.mock.calls[0][1];
      expect(passedInput).not.toHaveProperty('provenance');
      expect(passedInput).not.toHaveProperty('status');
    });

    it('records a created audit event', async () => {
      const repo = makeRepository();
      repo.createCustomerEvidence.mockResolvedValue(makeEvidence());
      const service = new Soc2CustomerEvidenceService(repo as any);

      await service.createCustomerEvidence('org-a', 'user-1', { criterionId: 'CC6.1', evidenceType: 'policy', title: 'x' });

      expect(mockRecord).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: 'org-a', action: 'soc2_customer_evidence.created', actorId: 'user-1' })
      );
    });
  });

  describe('updateCustomerEvidenceMetadata', () => {
    it('throws NOT_FOUND when the evidence does not exist', async () => {
      const repo = makeRepository();
      repo.getCustomerEvidenceById.mockResolvedValue(undefined);
      const service = new Soc2CustomerEvidenceService(repo as any);
      await expect(service.updateCustomerEvidenceMetadata('org-a', 'missing', 'user-1', { title: 'x' })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    it('rejects editing metadata when status is not SUBMITTED', async () => {
      const repo = makeRepository();
      repo.getCustomerEvidenceById.mockResolvedValue(makeEvidence({ status: 'REVIEWED' }));
      const service = new Soc2CustomerEvidenceService(repo as any);
      await expect(service.updateCustomerEvidenceMetadata('org-a', 'evidence-1', 'user-1', { title: 'x' })).rejects.toMatchObject(
        { code: 'INVALID_STATUS_FOR_EDIT' }
      );
      expect(repo.updateCustomerEvidenceMetadata).not.toHaveBeenCalled();
    });

    it('allows metadata edits while SUBMITTED and records an audit event', async () => {
      const repo = makeRepository();
      repo.getCustomerEvidenceById.mockResolvedValue(makeEvidence({ status: 'SUBMITTED' }));
      repo.updateCustomerEvidenceMetadata.mockResolvedValue(makeEvidence({ title: 'Updated title' }));
      const service = new Soc2CustomerEvidenceService(repo as any);

      const result = await service.updateCustomerEvidenceMetadata('org-a', 'evidence-1', 'user-1', { title: 'Updated title' });

      expect(result.title).toBe('Updated title');
      expect(mockRecord).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'soc2_customer_evidence.metadata_updated' })
      );
    });
  });

  describe('reviewCustomerEvidence', () => {
    it('rejects reviewing evidence that is not SUBMITTED', async () => {
      const repo = makeRepository();
      repo.getCustomerEvidenceById.mockResolvedValue(makeEvidence({ status: 'EXPIRED' }));
      const service = new Soc2CustomerEvidenceService(repo as any);
      await expect(service.reviewCustomerEvidence('org-a', 'evidence-1', 'staff-1')).rejects.toMatchObject({
        code: 'INVALID_STATUS_TRANSITION',
      });
      expect(repo.reviewCustomerEvidence).not.toHaveBeenCalled();
    });

    it('reviews SUBMITTED evidence and records an audit event with the reviewer as actor', async () => {
      const repo = makeRepository();
      repo.getCustomerEvidenceById.mockResolvedValue(makeEvidence({ status: 'SUBMITTED' }));
      repo.reviewCustomerEvidence.mockResolvedValue(makeEvidence({ status: 'REVIEWED' }));
      const service = new Soc2CustomerEvidenceService(repo as any);

      const result = await service.reviewCustomerEvidence('org-a', 'evidence-1', 'staff-1');

      expect(result.status).toBe('REVIEWED');
      expect(mockRecord).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'soc2_customer_evidence.reviewed', actorId: 'staff-1' })
      );
    });
  });

  describe('expireCustomerEvidence', () => {
    it.each(['EXPIRED', 'SUPERSEDED'])('rejects expiring evidence already in terminal status %s', async (status) => {
      const repo = makeRepository();
      repo.getCustomerEvidenceById.mockResolvedValue(makeEvidence({ status: status as any }));
      const service = new Soc2CustomerEvidenceService(repo as any);
      await expect(service.expireCustomerEvidence('org-a', 'evidence-1', 'staff-1')).rejects.toMatchObject({
        code: 'INVALID_STATUS_TRANSITION',
      });
    });

    it.each(['SUBMITTED', 'REVIEWED'])('allows expiring evidence from %s', async (status) => {
      const repo = makeRepository();
      repo.getCustomerEvidenceById.mockResolvedValue(makeEvidence({ status: status as any }));
      repo.expireCustomerEvidence.mockResolvedValue(makeEvidence({ status: 'EXPIRED' }));
      const service = new Soc2CustomerEvidenceService(repo as any);
      const result = await service.expireCustomerEvidence('org-a', 'evidence-1', 'staff-1');
      expect(result.status).toBe('EXPIRED');
    });
  });

  describe('supersedeCustomerEvidence', () => {
    it('rejects a replacement criterionId that does not match the superseded record', async () => {
      const repo = makeRepository();
      repo.getCustomerEvidenceById.mockResolvedValue(makeEvidence({ criterion_id: 'CC6.1', status: 'SUBMITTED' }));
      const service = new Soc2CustomerEvidenceService(repo as any);
      await expect(
        service.supersedeCustomerEvidence('org-a', 'evidence-1', 'staff-1', {
          criterionId: 'CC6.6',
          evidenceType: 'policy',
          title: 'replacement',
        })
      ).rejects.toMatchObject({ code: 'CRITERION_MISMATCH' });
      expect(repo.supersedeCustomerEvidence).not.toHaveBeenCalled();
    });

    it('rejects superseding evidence already in a terminal status', async () => {
      const repo = makeRepository();
      repo.getCustomerEvidenceById.mockResolvedValue(makeEvidence({ status: 'SUPERSEDED' }));
      const service = new Soc2CustomerEvidenceService(repo as any);
      await expect(
        service.supersedeCustomerEvidence('org-a', 'evidence-1', 'staff-1', {
          criterionId: 'CC6.1',
          evidenceType: 'policy',
          title: 'replacement',
        })
      ).rejects.toMatchObject({ code: 'INVALID_STATUS_TRANSITION' });
    });

    it('orchestrates a valid supersede and records both a superseded and a created audit event', async () => {
      const repo = makeRepository();
      const oldRow = makeEvidence({ id: 'old-1', criterion_id: 'CC6.1', status: 'REVIEWED' });
      const newRow = makeEvidence({ id: 'new-1', criterion_id: 'CC6.1', status: 'SUBMITTED', title: 'replacement' });
      repo.getCustomerEvidenceById.mockResolvedValue(oldRow);
      repo.supersedeCustomerEvidence.mockResolvedValue({
        superseded: { ...oldRow, status: 'SUPERSEDED' },
        replacement: newRow,
      });
      const service = new Soc2CustomerEvidenceService(repo as any);

      const result = await service.supersedeCustomerEvidence('org-a', 'old-1', 'staff-1', {
        criterionId: 'CC6.1',
        evidenceType: 'policy',
        title: 'replacement',
      });

      expect(result.superseded.status).toBe('SUPERSEDED');
      expect(result.replacement.status).toBe('SUBMITTED');
      expect(mockRecord).toHaveBeenCalledWith(expect.objectContaining({ action: 'soc2_customer_evidence.superseded' }));
      expect(mockRecord).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'soc2_customer_evidence.created', metadata: expect.objectContaining({ supersedesId: 'old-1' }) })
      );
    });
  });
});
