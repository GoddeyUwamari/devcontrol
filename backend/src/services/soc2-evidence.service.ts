/**
 * SOC 2 Readiness Evidence Layer -- Phase 1 evidence-computation service.
 *
 * READ-ONLY with respect to every existing system. This service:
 *   - reads aws_resources (is_encrypted/is_public/has_backup/compliance_issues) and
 *     account_security_findings (active rows only) as source material
 *   - NEVER writes to aws_resources, compliance_issues, account_security_findings, or
 *     security_hub_findings
 *   - NEVER calls calculateRiskScore or any Risk Score code path
 *   - performs ZERO new AWS API calls and instantiates NO AWS SDK client -- the
 *     discovery layer (awsResourceDiscovery.ts) remains the sole AWS collection layer;
 *     this service only reads what discovery already persisted
 *   - writes only to soc2_evidence_observations / soc2_control_evaluations, via
 *     Soc2EvidenceRepository
 *
 * PROVENANCE: every observation this service produces is 'OBSERVED'. It never inherits
 * ComplianceIssue.provenance (dropped on the account_security_findings conversion --
 * see the migration's docblock) or fabricates DERIVED/SELF_ATTESTED evidence.
 *
 * PHASE 5 (production computation trigger, called only from
 * jobs/resourceDiscovery.job.ts's scheduled sweep, after each organization's discovery
 * attempt for that cycle -- never from a synchronous or fire-and-forget on-demand
 * discovery path): computeAndPersistEvidence() is now also responsible for
 * reconciliation (deleting a per-resource observation whose resource/finding is no
 * longer present in the current, trustworthy source data -- see
 * buildReconciliationScopes()) and for committing its entire write -- reconciliation +
 * observation upserts + all six evaluation upserts -- as one atomic transaction guarded
 * by a per-organization Postgres advisory lock (see
 * Soc2EvidenceRepository.persistComputation()). Neither of these is a semantics change
 * to any of the six criteria themselves.
 *
 * FOUR MATERIAL DISCREPANCIES FOUND DURING IMPLEMENTATION AUDIT, resolved here (see the
 * accompanying implementation report for full reasoning):
 *
 * 1. checkS3PublicAccessEnhanced() (complianceScanner.ts) has NO completeness signal --
 *    unlike checkSecurityGroups()/checkIAMSecurity(), it returns a bare
 *    ComplianceIssue[] and silently console.error()s on failure, both at its own call
 *    site and in awsResourceDiscovery.ts's caller. Absence of its finding text in a
 *    bucket's compliance_issues therefore cannot, by itself, prove the check ran
 *    successfully. Resolved via (4) below.
 *
 * 2. account_security_findings has NO persisted per-category completeness column.
 *    reconcileScan()'s `completeCategories` is a call-time parameter; the only trace
 *    left afterward is a best-effort audit_logs entry (security.scan.completed /
 *    security.scan.partial), which is not guaranteed to exist and is not a reliable
 *    correctness signal to depend on. Resolved via (4) below.
 *
 * 3. DevControl persists NO full roster of evaluated IAM users or security groups --
 *    account_security_findings stores only ACTIVE PROBLEMS, never a list of resources
 *    that were checked and found clean. This means a per-resource SUPPORTS claim for
 *    CC6.2/CC6.3/CC7.1 (e.g. "this specific IAM user has MFA enabled") is NOT honestly
 *    derivable in Phase 1 -- there is no way to know that user was even evaluated.
 *    Resolved by producing per-resource observations ONLY for CONTRADICTS (an active
 *    finding is always real evidence, unconditional on completeness -- "real evidence
 *    is real evidence, even from a partial scan", already the codebase's own stated
 *    philosophy), plus exactly one ORG-LEVEL aggregate observation per criterion
 *    (resource_arn: null, resource_type: 'organization') that can honestly say
 *    "zero active findings, and the most recent scan was complete" -> SUPPORTS.
 *
 * 4. resource_discovery_jobs.compliance_scan_completed (the latest job row per org) is
 *    the only structurally-persisted (not best-effort) completeness signal available
 *    anywhere in the schema. It is coarser than per-category or per-check (one flag
 *    covers the whole discovery+compliance+account-security pipeline of a single job
 *    run), but it is real and always present once a job has run. Both (1) and (2) above
 *    are gated on it via Soc2EvidenceRepository.isLatestDiscoveryComplete().
 *
 * A FIFTH discrepancy, found while implementing CC6.1/CC6.6/CC9.1 specifically:
 * resource_type = 'aurora' rows are discovered via the generic/thin Resource-Explorer
 * path (upsertGenericResource() in awsResourceDiscovery.ts), whose INSERT hardcodes
 * is_encrypted/is_public/has_backup to a literal `false` and never updates them on
 * conflict. enrichAuroraClusters() only ever touches `metadata`. This means these three
 * fields are NOT real observed evidence for 'aurora' rows -- they are permanently
 * false, structurally, for every Aurora cluster in every organization. Trusting them
 * would reproduce exactly the Signal-4-style guaranteed-false-positive bug this whole
 * engagement exists to eliminate. Resolved by ALWAYS emitting UNKNOWN for
 * resource_type === 'aurora' in CC6.1/CC6.6/CC9.1, regardless of the stored value.
 * 'rds' (true RDS instances, deep-discovered with real DescribeDBInstances evidence) is
 * unaffected and uses its real fields normally.
 *
 * A SIXTH discrepancy, found in post-implementation review: CC7.1's original filter
 * was `f.category === 'networking'` alone. That is currently correct in effect (see
 * isUnrestrictedIngressEvidence()'s docblock: checkSecurityGroups() is verified to be
 * the only current producer of that category in account_security_findings), but it is
 * not a discriminator the DATA itself enforces -- it silently assumed no second
 * networking-category detector will ever exist. Fixed to require the evidence content
 * itself (direction === 'ingress' AND cidr is exactly '0.0.0.0/0' or '::/0') to match
 * unrestricted-ingress semantics precisely, the same evidence-content discipline
 * CC6.2/CC6.3 already correctly used via evidence.finding_type. CC6.2/CC6.3 themselves
 * were re-audited during this same pass and require no change -- see
 * isUnrestrictedIngressEvidence()'s docblock and the accompanying review report for
 * the full finding_type enumeration proving this.
 */
import { Pool, PoolClient } from 'pg';
import { Soc2EvidenceRepository } from '../repositories/soc2-evidence.repository';
import { SOC2_V1_CRITERIA, Soc2CriterionConfig } from '../config/soc2CriteriaConfig';
import {
  Soc2ControlEvaluation,
  Soc2EvidenceObservation,
  Soc2EvidenceResult,
  Soc2EvidenceSource,
  Soc2EvidenceSummary,
  Soc2ObservationReconciliationScope,
} from '../types/soc2-evidence.types';

/** The exact issue text checkS3PublicAccessEnhanced() emits -- read here, never
 * reproduced/recomputed. See complianceScanner.ts. */
const S3_ENHANCED_FINDING_TEXTS = [
  'S3 bucket ACL allows public read access',
  'S3 bucket policy allows public access (wildcard principal)',
];

/** Resource types whose is_encrypted/is_public/has_backup are real, deep-discovered
 * AWS evidence (see this file's docblock, discrepancy #5). 'aurora' is deliberately
 * excluded. */
const TRUSTWORTHY_BOOLEAN_FIELD_RESOURCE_TYPES = new Set(['ec2', 'ebs', 'rds', 's3']);

interface SourceResourceRow {
  resource_arn: string;
  resource_type: string;
  is_encrypted: boolean | null;
  is_public: boolean | null;
  has_backup: boolean | null;
  compliance_issues: Array<{ issue?: string }> | null;
}

interface SourceFindingRow {
  finding_key: string;
  category: 'networking' | 'iam';
  resource_identifier: string;
  status: 'active' | 'resolved';
  evidence: any | null;
}

export class Soc2EvidenceService {
  private repository: Soc2EvidenceRepository;

  constructor(private pool: Pool) {
    this.repository = new Soc2EvidenceRepository(pool);
  }

  private async withOrgClient<T>(
    organizationId: string,
    fn: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query(
        "SELECT set_config('app.current_organization_id', $1, false)",
        [organizationId]
      );
      return await fn(client);
    } finally {
      client.release();
    }
  }

  private async readResources(organizationId: string): Promise<SourceResourceRow[]> {
    return this.withOrgClient(organizationId, async (client) => {
      const { rows } = await client.query(
        `SELECT resource_arn, resource_type, is_encrypted, is_public, has_backup, compliance_issues
         FROM aws_resources
         WHERE organization_id = $1 AND status != 'terminated'`,
        [organizationId]
      );
      return rows as SourceResourceRow[];
    });
  }

  private async readActiveFindings(organizationId: string): Promise<SourceFindingRow[]> {
    return this.withOrgClient(organizationId, async (client) => {
      const { rows } = await client.query(
        `SELECT finding_key, category, resource_identifier, status, evidence
         FROM account_security_findings
         WHERE organization_id = $1 AND status = 'active'`,
        [organizationId]
      );
      return rows as SourceFindingRow[];
    });
  }

  /**
   * Computes fresh observations from currently-persisted source data and persists
   * them -- reconciling away any stale per-resource observation whose resource/finding
   * is no longer part of the current, trustworthy source data -- then recomputes and
   * persists the control-evaluation rollup for all six criteria. Zero AWS calls --
   * reads only. The entire persist step (reconciliation + observation upserts + all
   * six evaluation upserts) is one atomic transaction guarded by a per-organization
   * advisory lock -- see Soc2EvidenceRepository.persistComputation().
   */
  async computeAndPersistEvidence(organizationId: string): Promise<void> {
    const collectedAt = new Date();

    const [resources, activeFindings, discoveryComplete] = await Promise.all([
      this.readResources(organizationId),
      this.readActiveFindings(organizationId),
      this.repository.isLatestDiscoveryComplete(organizationId),
    ]);

    const observations: Soc2EvidenceObservation[] = [
      ...this.computeEncryptionObservations(organizationId, resources, collectedAt),
      ...this.computePublicExposureObservations(organizationId, resources, collectedAt, discoveryComplete),
      ...this.computeBackupObservations(organizationId, resources, collectedAt),
      ...this.computeIamMfaObservations(organizationId, activeFindings, collectedAt, discoveryComplete),
      ...this.computeStaleKeyObservations(organizationId, activeFindings, collectedAt, discoveryComplete),
      ...this.computeSecurityGroupObservations(organizationId, activeFindings, collectedAt, discoveryComplete),
    ];

    const evaluations = SOC2_V1_CRITERIA.map((criterion) =>
      this.computeControlEvaluation(organizationId, criterion, observations, collectedAt)
    );

    const reconciliationScopes = this.buildReconciliationScopes(observations);

    await this.repository.persistComputation(organizationId, observations, reconciliationScopes, evaluations);
  }

  /**
   * One reconciliation scope per (criterion, resource_type) pairing this service is
   * capable of producing, reusing soc2CriteriaConfig.ts's own `scope` field directly
   * rather than a second hardcoded list -- scope can never silently drift between what
   * computeAndPersistEvidence() actually computes and what reconciliation reconciles
   * against.
   *
   * currentResourceArns is exactly the set of non-null resource_arn values THIS RUN
   * produced for that pairing -- which is itself already scoped to aws_resources rows
   * with status != 'terminated' / account_security_findings rows with status =
   * 'active' (see readResources() / readActiveFindings()), i.e. discovery's OWN
   * currency signal for "this resource still exists" / "this finding is still open".
   *
   * CRITICAL: a resource_type whose AWS discovery step fails entirely on a given run is
   * NOT reflected here as "gone". Discovery never marks a resource terminated, or a
   * finding resolved, without that specific check/category having itself completed
   * (see awsResourceDiscovery.ts's own reconcile()/reconcileScan() calls) -- a failed
   * scan simply leaves aws_resources/account_security_findings untouched, so this run's
   * read (and therefore this set) is identical to the last successful run's. Only a
   * resource/finding genuinely absent from the current, already-reconciled source data
   * is ever eligible for deletion here. Partial or failed discovery is never itself
   * interpreted as resource disappearance.
   */
  private buildReconciliationScopes(
    observations: Soc2EvidenceObservation[]
  ): Soc2ObservationReconciliationScope[] {
    const scopes: Soc2ObservationReconciliationScope[] = [];
    for (const criterion of SOC2_V1_CRITERIA) {
      for (const resourceType of criterion.scope) {
        const currentResourceArns = observations
          .filter(
            (o) =>
              o.criterion_id === criterion.criterionId &&
              o.resource_type === resourceType &&
              o.resource_arn !== null
          )
          .map((o) => o.resource_arn as string);
        scopes.push({ criterionId: criterion.criterionId, resourceType, currentResourceArns });
      }
    }
    return scopes;
  }

  // ── CC6.1 — Encryption at rest ──────────────────────────────────────────

  private computeEncryptionObservations(
    organizationId: string,
    resources: SourceResourceRow[],
    collectedAt: Date
  ): Soc2EvidenceObservation[] {
    const scope = new Set(['ec2', 'ebs', 'rds', 'aurora', 's3']);
    return resources
      .filter((r) => scope.has(r.resource_type))
      .map((r) => {
        const trustworthy = TRUSTWORTHY_BOOLEAN_FIELD_RESOURCE_TYPES.has(r.resource_type);
        const result: Soc2EvidenceResult = !trustworthy
          ? 'UNKNOWN'
          : r.is_encrypted === true
            ? 'SUPPORTS'
            : r.is_encrypted === false
              ? 'CONTRADICTS'
              : 'UNKNOWN';

        const source: Soc2EvidenceSource = {
          source_type: 'aws_resource_field',
          field: 'is_encrypted',
          resource_type: r.resource_type,
        };

        const explanation = !trustworthy
          ? `${r.resource_type} resources are discovered via the generic inventory path, which does not populate real encryption evidence for this field.`
          : `AWS discovery reported is_encrypted=${r.is_encrypted === null ? 'null (unknown)' : r.is_encrypted} for this ${r.resource_type} resource.`;

        return this.observation(organizationId, 'CC6.1', r.resource_arn, r.resource_type, result, collectedAt, source, explanation);
      });
  }

  // ── CC6.6 — Public network exposure ─────────────────────────────────────

  private computePublicExposureObservations(
    organizationId: string,
    resources: SourceResourceRow[],
    collectedAt: Date,
    discoveryComplete: boolean
  ): Soc2EvidenceObservation[] {
    const observations: Soc2EvidenceObservation[] = [];

    for (const r of resources.filter((r) => ['ec2', 'rds', 'aurora'].includes(r.resource_type))) {
      const trustworthy = TRUSTWORTHY_BOOLEAN_FIELD_RESOURCE_TYPES.has(r.resource_type);
      const result: Soc2EvidenceResult = !trustworthy
        ? 'UNKNOWN'
        : r.is_public === false
          ? 'SUPPORTS'
          : r.is_public === true
            ? 'CONTRADICTS'
            : 'UNKNOWN';

      const source: Soc2EvidenceSource = { source_type: 'aws_resource_field', field: 'is_public', resource_type: r.resource_type };
      const explanation = !trustworthy
        ? `${r.resource_type} resources are discovered via the generic inventory path, which does not populate real public-exposure evidence for this field.`
        : `AWS discovery reported is_public=${r.is_public === null ? 'null (unknown)' : r.is_public} for this ${r.resource_type} resource.`;

      observations.push(this.observation(organizationId, 'CC6.6', r.resource_arn, r.resource_type, result, collectedAt, source, explanation));
    }

    // S3: deliberately NOT is_public. Uses checkS3PublicAccessEnhanced()'s
    // already-produced result (ACL + bucket-policy, positive-finding-only), read from
    // compliance_issues -- never recomputed, never a new AWS call. See this file's
    // docblock, discrepancy #1.
    for (const r of resources.filter((r) => r.resource_type === 's3')) {
      const issues = r.compliance_issues ?? [];
      const matchedFinding = issues.find((i) => S3_ENHANCED_FINDING_TEXTS.includes(i.issue ?? ''));

      let result: Soc2EvidenceResult;
      let source: Soc2EvidenceSource;
      let explanation: string;

      if (matchedFinding) {
        result = 'CONTRADICTS';
        source = { source_type: 'compliance_issue', issue_text: matchedFinding.issue!, resource_type: 's3' };
        explanation = `checkS3PublicAccessEnhanced() recorded: "${matchedFinding.issue}".`;
      } else if (discoveryComplete) {
        result = 'SUPPORTS';
        source = { source_type: 'compliance_issue_absent', issue_text: S3_ENHANCED_FINDING_TEXTS.join(' | '), resource_type: 's3' };
        explanation = 'checkS3PublicAccessEnhanced() recorded no ACL or bucket-policy public-exposure finding for this bucket, and the organization’s most recent discovery job completed successfully.';
      } else {
        result = 'UNKNOWN';
        source = { source_type: 'compliance_issue_absent', issue_text: S3_ENHANCED_FINDING_TEXTS.join(' | '), resource_type: 's3' };
        explanation = 'checkS3PublicAccessEnhanced() recorded no finding for this bucket, but the organization’s most recent discovery job did not complete successfully, so absence cannot be trusted as confirmed-clean.';
      }

      observations.push(this.observation(organizationId, 'CC6.6', r.resource_arn, 's3', result, collectedAt, source, explanation));
    }

    return observations;
  }

  // ── CC9.1 — AWS Backup recovery-point presence ──────────────────────────

  private computeBackupObservations(
    organizationId: string,
    resources: SourceResourceRow[],
    collectedAt: Date
  ): Soc2EvidenceObservation[] {
    const scope = new Set(['ec2', 'rds', 'aurora']);
    return resources
      .filter((r) => scope.has(r.resource_type))
      .map((r) => {
        const trustworthy = TRUSTWORTHY_BOOLEAN_FIELD_RESOURCE_TYPES.has(r.resource_type);
        const result: Soc2EvidenceResult = !trustworthy
          ? 'UNKNOWN'
          : r.has_backup === true
            ? 'SUPPORTS'
            : r.has_backup === false
              ? 'CONTRADICTS'
              : 'UNKNOWN';

        const source: Soc2EvidenceSource = { source_type: 'aws_resource_field', field: 'has_backup', resource_type: r.resource_type };
        const explanation = !trustworthy
          ? `${r.resource_type} resources are discovered via the generic inventory path, which does not populate real AWS Backup evidence for this field.`
          : `AWS Backup recovery-point evidence reported has_backup=${r.has_backup === null ? 'null (unknown)' : r.has_backup} for this ${r.resource_type} resource.`;

        return this.observation(organizationId, 'CC9.1', r.resource_arn, r.resource_type, result, collectedAt, source, explanation);
      });
  }

  // ── CC6.2 — IAM console-user MFA ────────────────────────────────────────

  private computeIamMfaObservations(
    organizationId: string,
    activeFindings: SourceFindingRow[],
    collectedAt: Date,
    discoveryComplete: boolean
  ): Soc2EvidenceObservation[] {
    const mfaFindings = activeFindings.filter(
      (f) => f.category === 'iam' && f.evidence?.finding_type === 'mfa_not_enabled'
    );
    return this.perResourceAndAggregate(
      organizationId,
      'CC6.2',
      'iam_user',
      mfaFindings,
      (f) => f.resource_identifier,
      collectedAt,
      discoveryComplete,
      'iam',
      'mfa_not_enabled'
    );
  }

  // ── CC6.3 — IAM access-key age ───────────────────────────────────────────

  private computeStaleKeyObservations(
    organizationId: string,
    activeFindings: SourceFindingRow[],
    collectedAt: Date,
    discoveryComplete: boolean
  ): Soc2EvidenceObservation[] {
    const staleKeyFindings = activeFindings.filter(
      (f) => f.category === 'iam' && f.evidence?.finding_type === 'access_key_stale'
    );
    return this.perResourceAndAggregate(
      organizationId,
      'CC6.3',
      'iam_access_key',
      staleKeyFindings,
      // Synthetic identity: AWS access keys have no ARN of their own. Stable and unique
      // per key, so multiple stale keys on the same user never collide.
      (f) => `${f.resource_identifier}#access-key#${f.evidence?.relevant_aws_attributes?.access_key_id ?? f.finding_key}`,
      collectedAt,
      discoveryComplete,
      'iam',
      'access_key_stale'
    );
  }

  // ── CC7.1 (narrow) — Unrestricted security-group ingress ───────────────

  /**
   * True only for evidence that structurally IS an unrestricted-ingress
   * SecurityGroupEvidence object -- direction 'ingress' and a CIDR that is exactly
   * '0.0.0.0/0' or '::/0', matching buildUnrestrictedIngressIssue()'s own construction
   * exactly (verified against complianceScanner.ts: `direction: 'ingress'` is
   * hardcoded there, and `cidr` is always the literal '0.0.0.0/0'/'::/0' string passed
   * at its one call site, never a copy of the raw AWS CIDR value).
   *
   * category === 'networking' alone is NOT used as the discriminator. It is currently
   * true that checkSecurityGroups() is the only producer of that category (confirmed:
   * fromComplianceIssues()'s one call site, awsResourceDiscovery.ts:583, passes only
   * [...networkingObservation.issues, ...iamObservation.issues] -- never the general
   * compliance_issues array, so checkSOC2Compliance()'s/checkHIPAACompliance()'s own
   * unrelated 'networking'-category ComplianceIssues, which exist but stay in
   * aws_resources.compliance_issues, can never reach this table). But that is an
   * incidental, single-producer fact about the system TODAY, not a discriminator
   * enforced by the data itself -- a future second networking-category detector (e.g.
   * unrestricted egress, missing VPC flow logs) would silently be swept into CC7.1
   * without this check. Matching evidence content, not just category, is the same
   * discipline already correctly used for CC6.2/CC6.3 (evidence.finding_type), applied
   * here via the fields SecurityGroupEvidence actually has (it predates the
   * finding_type discriminant the IAM evidence variants use -- see FindingEvidence's
   * own docblock).
   */
  private isUnrestrictedIngressEvidence(evidence: any): evidence is import('../types/aws-resources.types').SecurityGroupEvidence {
    return (
      evidence != null &&
      evidence.direction === 'ingress' &&
      (evidence.cidr === '0.0.0.0/0' || evidence.cidr === '::/0')
    );
  }

  private computeSecurityGroupObservations(
    organizationId: string,
    activeFindings: SourceFindingRow[],
    collectedAt: Date,
    discoveryComplete: boolean
  ): Soc2EvidenceObservation[] {
    const sgFindings = activeFindings.filter(
      (f) => f.category === 'networking' && this.isUnrestrictedIngressEvidence(f.evidence)
    );
    return this.perResourceAndAggregate(
      organizationId,
      'CC7.1',
      'security_group',
      sgFindings,
      (f) => f.resource_identifier,
      collectedAt,
      discoveryComplete,
      'networking',
      'unrestricted_ingress'
    );
  }

  /**
   * Shared shape for CC6.2/CC6.3/CC7.1: a CONTRADICTS row per active finding
   * (unconditional on completeness -- real evidence is real evidence), plus exactly
   * one org-level aggregate row (resource_arn: null) that is the ONLY place SUPPORTS
   * can legitimately appear for these three criteria, and only when discoveryComplete
   * is true. See this file's docblock, discrepancy #3.
   */
  private perResourceAndAggregate(
    organizationId: string,
    criterionId: string,
    resourceType: string,
    findings: SourceFindingRow[],
    resourceArnOf: (f: SourceFindingRow) => string,
    collectedAt: Date,
    discoveryComplete: boolean,
    category: 'networking' | 'iam',
    findingType: string
  ): Soc2EvidenceObservation[] {
    const observations: Soc2EvidenceObservation[] = [];

    for (const f of findings) {
      const source: Soc2EvidenceSource = {
        source_type: 'account_security_finding',
        finding_key: f.finding_key,
        resource_identifier: f.resource_identifier,
        category,
      };
      observations.push(
        this.observation(
          organizationId,
          criterionId,
          resourceArnOf(f),
          resourceType,
          'CONTRADICTS',
          collectedAt,
          source,
          `An active account-level finding exists (finding_key=${f.finding_key}).`
        )
      );
    }

    const aggregateSource: Soc2EvidenceSource = {
      source_type: 'account_security_finding_aggregate',
      category,
      finding_type: findingType,
      active_count: findings.length,
    };

    let aggregateResult: Soc2EvidenceResult;
    let aggregateExplanation: string;
    if (findings.length > 0) {
      aggregateResult = 'CONTRADICTS';
      aggregateExplanation = `${findings.length} active finding(s) of this type exist for the organization.`;
    } else if (discoveryComplete) {
      aggregateResult = 'SUPPORTS';
      aggregateExplanation = 'Zero active findings of this type, and the organization’s most recent discovery job completed successfully.';
    } else {
      aggregateResult = 'UNKNOWN';
      aggregateExplanation = 'Zero active findings of this type, but the organization’s most recent discovery job did not complete successfully, so absence cannot be trusted as confirmed-clean. DevControl does not persist a full roster of evaluated resources, so a per-resource SUPPORTS claim is not possible for this criterion in any case -- only this org-level aggregate.';
    }

    observations.push(
      this.observation(organizationId, criterionId, null, 'organization', aggregateResult, collectedAt, aggregateSource, aggregateExplanation)
    );

    return observations;
  }

  private observation(
    organizationId: string,
    criterionId: string,
    resourceArn: string | null,
    resourceType: string,
    result: Soc2EvidenceResult,
    collectedAt: Date,
    source: Soc2EvidenceSource,
    explanation: string
  ): Soc2EvidenceObservation {
    return {
      organization_id: organizationId,
      criterion_id: criterionId,
      resource_arn: resourceArn,
      resource_type: resourceType,
      provenance: 'OBSERVED',
      result,
      observed_at: collectedAt,
      collected_at: collectedAt,
      source,
      explanation,
      schema_version: 1,
    };
  }

  private computeControlEvaluation(
    organizationId: string,
    criterion: Soc2CriterionConfig,
    observations: Soc2EvidenceObservation[],
    computedAt: Date
  ): Soc2ControlEvaluation {
    const forCriterion = observations.filter((o) => o.criterion_id === criterion.criterionId);
    const summary: Soc2EvidenceSummary = {
      supports: forCriterion.filter((o) => o.result === 'SUPPORTS').length,
      contradicts: forCriterion.filter((o) => o.result === 'CONTRADICTS').length,
      unknown: forCriterion.filter((o) => o.result === 'UNKNOWN').length,
    };

    return {
      organization_id: organizationId,
      criterion_id: criterion.criterionId,
      disposition_class: criterion.dispositionClass,
      evidence_summary: summary,
      customer_evidence_ids: [],
      computed_at: computedAt,
    };
  }
}
