/**
 * SOC 2 Readiness Evidence Layer -- Phase 2 read-only API.
 *
 * Exposes exactly what Phase 1 (soc2-evidence.repository.ts / soc2-evidence.service.ts)
 * already stores. Calls only the repository's read methods (getControlEvaluations /
 * getObservations) -- never computeAndPersistEvidence, upsertObservations, or
 * upsertControlEvaluation. This route file performs zero writes, zero AWS calls, and
 * triggers no evidence computation; see soc2-evidence.service.ts's own docblock for why
 * that matters (Phase 1 is deliberately isolated from Risk Score, compliance_issues,
 * account_security_findings, and security_hub_findings -- this layer must stay that way).
 *
 * TIER GATING: no documented product decision exists for SOC2 Readiness (see the Phase 2
 * audit). Routes below are authenticated only, matching security-hub.routes.ts's
 * /capability and /frameworks/:framework precedent -- not an Enterprise/Pro decision made
 * here. Revisit once a product decision is made.
 *
 * Response fields are deliberately the narrow, truthful SOC 2 evidence vocabulary
 * (provenance / result / dispositionClass) -- never PASS/FAIL/COMPLIANT, a score, or a
 * certification claim. See soc2-evidence.types.ts and soc2CriteriaConfig.ts.
 */
import { Router, Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth.middleware';
import { pool } from '../config/database';
import { Soc2EvidenceRepository } from '../repositories/soc2-evidence.repository';
import { Soc2ControlEvaluation, Soc2EvidenceObservation } from '../types/soc2-evidence.types';
import { SOC2_V1_CRITERIA, Soc2CriterionConfig, getSoc2CriterionConfig } from '../config/soc2CriteriaConfig';

const router = Router();
const repository = new Soc2EvidenceRepository(pool);

router.use(authenticateToken);

function toPublicReadinessCriterion(
  config: Soc2CriterionConfig,
  evaluation: Soc2ControlEvaluation | undefined
) {
  return {
    criterionId: config.criterionId,
    name: config.name,
    evidenceClaim: config.evidenceClaim,
    limitation: config.limitation,
    dispositionClass: config.dispositionClass,
    evaluated: evaluation !== undefined,
    evidenceSummary: evaluation ? evaluation.evidence_summary : null,
    computedAt: evaluation ? evaluation.computed_at : null,
  };
}

function toPublicObservation(observation: Soc2EvidenceObservation) {
  return {
    criterionId: observation.criterion_id,
    resourceArn: observation.resource_arn,
    resourceType: observation.resource_type,
    provenance: observation.provenance,
    result: observation.result,
    observedAt: observation.observed_at,
    collectedAt: observation.collected_at,
    source: observation.source,
    explanation: observation.explanation,
    schemaVersion: observation.schema_version,
  };
}

/**
 * GET /api/soc2/readiness -- all six approved Phase 1 criteria, each paired with its
 * current evaluation if one has been computed. An organization with no evaluations yet
 * (the current production state -- Phase 1 tables are empty until something calls
 * computeAndPersistEvidence, which this route never does) gets evaluated: false for
 * every criterion, not a synthesized pass/fail default.
 */
router.get('/readiness', async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = req.organizationId;
    if (!organizationId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const evaluations = await repository.getControlEvaluations(organizationId);
    const evaluationByCriterion = new Map(evaluations.map((e) => [e.criterion_id, e]));

    const criteria = SOC2_V1_CRITERIA.map((config) =>
      toPublicReadinessCriterion(config, evaluationByCriterion.get(config.criterionId))
    );

    res.json({ success: true, criteria });
  } catch (error: unknown) {
    console.error('[Soc2] Error fetching readiness:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

/**
 * GET /api/soc2/readiness/:criterionId -- one criterion's evaluation plus its current
 * supporting evidence. criterionId is validated against the fixed Phase 1 allowlist
 * before ever reaching a query; an unrecognized value is a 400 (client input error),
 * matching security-hub.routes.ts's GET /frameworks/:framework convention exactly.
 */
router.get('/readiness/:criterionId', async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = req.organizationId;
    if (!organizationId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const config = getSoc2CriterionConfig(req.params.criterionId);
    if (!config) {
      res.status(400).json({
        success: false,
        error: `Unknown criterion "${req.params.criterionId}". Supported: ${SOC2_V1_CRITERIA.map((c) => c.criterionId).join(', ')}.`,
      });
      return;
    }

    const [evaluations, observations] = await Promise.all([
      repository.getControlEvaluations(organizationId),
      repository.getObservations(organizationId, config.criterionId),
    ]);

    const evaluation = evaluations.find((e) => e.criterion_id === config.criterionId);

    res.json({
      success: true,
      criterion: toPublicReadinessCriterion(config, evaluation),
      evidence: observations.map(toPublicObservation),
    });
  } catch (error: unknown) {
    console.error(`[Soc2] Error fetching readiness for criterion "${req.params.criterionId}":`, error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

/**
 * GET /api/soc2/evidence -- current observations for the organization, optionally
 * filtered to one criterion via ?criterionId=. No pagination: bounded by resource count
 * per organization, the same order of magnitude as aws_resources/account_security_findings,
 * neither of which are paginated today (see Phase 2 audit section 12).
 */
router.get('/evidence', async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = req.organizationId;
    if (!organizationId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const criterionIdParam = req.query.criterionId;
    let criterionId: string | undefined;
    if (criterionIdParam !== undefined) {
      if (typeof criterionIdParam !== 'string' || !getSoc2CriterionConfig(criterionIdParam)) {
        res.status(400).json({
          success: false,
          error: `Unknown criterion "${String(criterionIdParam)}". Supported: ${SOC2_V1_CRITERIA.map((c) => c.criterionId).join(', ')}.`,
        });
        return;
      }
      criterionId = criterionIdParam;
    }

    const observations = await repository.getObservations(organizationId, criterionId);
    res.json({ success: true, evidence: observations.map(toPublicObservation) });
  } catch (error: unknown) {
    console.error('[Soc2] Error fetching evidence:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

export default router;
