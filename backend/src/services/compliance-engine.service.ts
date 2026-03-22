import { Pool } from 'pg';
import {
  ComplianceControl,
  ControlStatus,
  ControlEvidence,
  ControlFramework,
  ALL_CONTROLS,
  getControlsByFramework,
} from '../data/compliance-controls';

export interface ControlResult {
  controlId: string;
  id: string;
  framework: ControlFramework;
  category: string;
  name: string;
  description: string;
  severity: string;
  status: ControlStatus;
  score: number; // 0-100 for this control
  evidence: ControlEvidence;
  remediationGuidance: string;
}

export interface FrameworkScanResult {
  framework: ControlFramework;
  overallScore: number;
  controlsPassed: number;
  controlsFailed: number;
  controlsTotal: number;
  controlResults: ControlResult[];
  scannedAt: string;
}

export interface InfraSnapshot {
  totalResources: number;
  encryptedCount: number;
  unencryptedCount: number;
  publicCount: number;
  nonPublicCount: number;
  backupCount: number;
  noBackupCount: number;
  taggedCount: number;
  untaggedCount: number;
  activeAnomalyCount: number;
  criticalAnomalyCount: number;
  unresolvedComplianceIssues: number;
  totalComplianceIssues: number;
}

export class ComplianceEngineService {
  constructor(private pool: Pool) {}

  /**
   * Run a full compliance scan for a specific framework
   */
  async runScan(organizationId: string, framework: ControlFramework): Promise<FrameworkScanResult> {
    const snapshot = await this.getInfraSnapshot(organizationId);
    const controls = getControlsByFramework(framework);

    const controlResults: ControlResult[] = controls.map((control) =>
      this.evaluateControl(control, snapshot)
    );

    const passed = controlResults.filter((r) => r.status === 'pass').length;
    const failed = controlResults.filter((r) => r.status === 'fail').length;
    const total = controlResults.length;

    // Weighted score: critical controls count double
    const weightedTotal = controlResults.reduce((sum, r) => {
      const weight = r.severity === 'critical' ? 2 : 1;
      return sum + weight;
    }, 0);
    const weightedPassed = controlResults.reduce((sum, r) => {
      const weight = r.severity === 'critical' ? 2 : 1;
      return r.status === 'pass' ? sum + weight : sum;
    }, 0);

    const overallScore = weightedTotal > 0 ? Math.round((weightedPassed / weightedTotal) * 100) : 0;

    const result: FrameworkScanResult = {
      framework,
      overallScore,
      controlsPassed: passed,
      controlsFailed: failed,
      controlsTotal: total,
      controlResults,
      scannedAt: new Date().toISOString(),
    };

    // Persist to DB
    await this.persistResult(organizationId, result);

    return result;
  }

  /**
   * Run scans for both frameworks simultaneously
   */
  async runAllScans(organizationId: string): Promise<{ soc2: FrameworkScanResult; hipaa: FrameworkScanResult }> {
    const snapshot = await this.getInfraSnapshot(organizationId);

    const [soc2Result, hipaaResult] = await Promise.all([
      this.runScanWithSnapshot(organizationId, 'soc2', snapshot),
      this.runScanWithSnapshot(organizationId, 'hipaa', snapshot),
    ]);

    return { soc2: soc2Result, hipaa: hipaaResult };
  }

  /**
   * Get the most recent scan results for a framework (no new scan)
   */
  async getLatestResult(organizationId: string, framework: ControlFramework): Promise<FrameworkScanResult | null> {
    const result = await this.pool.query(
      `SELECT * FROM compliance_scan_results
       WHERE organization_id = $1 AND framework = $2
       ORDER BY scanned_at DESC LIMIT 1`,
      [organizationId, framework]
    );

    if (result.rows.length === 0) return null;
    const row = result.rows[0];

    return {
      framework: row.framework as ControlFramework,
      overallScore: parseFloat(row.overall_score),
      controlsPassed: row.controls_passed,
      controlsFailed: row.controls_failed,
      controlsTotal: row.controls_total,
      controlResults: row.control_results as ControlResult[],
      scannedAt: row.scanned_at,
    };
  }

  /**
   * Get latest results for all frameworks
   */
  async getAllLatestResults(
    organizationId: string
  ): Promise<{ soc2: FrameworkScanResult | null; hipaa: FrameworkScanResult | null }> {
    const [soc2, hipaa] = await Promise.all([
      this.getLatestResult(organizationId, 'soc2'),
      this.getLatestResult(organizationId, 'hipaa'),
    ]);
    return { soc2, hipaa };
  }

  /**
   * Get historical scan scores (last 90 days) for trend charts
   */
  async getScanHistory(
    organizationId: string,
    framework: ControlFramework,
    limitDays: number = 90
  ): Promise<Array<{ scannedAt: string; score: number }>> {
    const result = await this.pool.query(
      `SELECT scanned_at, overall_score
       FROM compliance_scan_results
       WHERE organization_id = $1 AND framework = $2
         AND scanned_at >= NOW() - ($3 || ' days')::INTERVAL
       ORDER BY scanned_at ASC`,
      [organizationId, framework, limitDays]
    );

    return result.rows.map((r) => ({
      scannedAt: r.scanned_at,
      score: parseFloat(r.overall_score),
    }));
  }

  // ─── Private Methods ─────────────────────────────────────────────────────

  private async runScanWithSnapshot(
    organizationId: string,
    framework: ControlFramework,
    snapshot: InfraSnapshot
  ): Promise<FrameworkScanResult> {
    const controls = getControlsByFramework(framework);
    const controlResults: ControlResult[] = controls.map((control) =>
      this.evaluateControl(control, snapshot)
    );

    const passed = controlResults.filter((r) => r.status === 'pass').length;
    const failed = controlResults.filter((r) => r.status === 'fail').length;
    const total = controlResults.length;

    const weightedTotal = controlResults.reduce(
      (sum, r) => sum + (r.severity === 'critical' ? 2 : 1),
      0
    );
    const weightedPassed = controlResults.reduce((sum, r) => {
      const weight = r.severity === 'critical' ? 2 : 1;
      return r.status === 'pass' ? sum + weight : sum;
    }, 0);

    const overallScore = weightedTotal > 0 ? Math.round((weightedPassed / weightedTotal) * 100) : 0;

    const result: FrameworkScanResult = {
      framework,
      overallScore,
      controlsPassed: passed,
      controlsFailed: failed,
      controlsTotal: total,
      controlResults,
      scannedAt: new Date().toISOString(),
    };

    await this.persistResult(organizationId, result);
    return result;
  }

  /**
   * Fetch a snapshot of infrastructure health metrics from the DB
   */
  private async getInfraSnapshot(organizationId: string): Promise<InfraSnapshot> {
    const [resourceStats, anomalyStats, complianceStats] = await Promise.all([
      this.pool.query(
        `SELECT
          COUNT(*) as total_resources,
          COUNT(*) FILTER (WHERE is_encrypted = true) as encrypted_count,
          COUNT(*) FILTER (WHERE is_encrypted = false OR is_encrypted IS NULL) as unencrypted_count,
          COUNT(*) FILTER (WHERE is_public = true) as public_count,
          COUNT(*) FILTER (WHERE is_public = false OR is_public IS NULL) as non_public_count,
          COUNT(*) FILTER (WHERE has_backup = true) as backup_count,
          COUNT(*) FILTER (WHERE has_backup = false OR has_backup IS NULL) as no_backup_count,
          COUNT(*) FILTER (WHERE tags IS NOT NULL AND tags != '{}' AND tags != 'null') as tagged_count,
          COUNT(*) FILTER (WHERE tags IS NULL OR tags = '{}' OR tags = 'null') as untagged_count
        FROM aws_resources
        WHERE organization_id = $1`,
        [organizationId]
      ).catch(() => ({ rows: [{}] })),

      this.pool.query(
        `SELECT
          COUNT(*) FILTER (WHERE status IN ('active', 'open')) as active_count,
          COUNT(*) FILTER (WHERE status IN ('active', 'open') AND severity = 'critical') as critical_count
        FROM anomaly_events
        WHERE organization_id = $1`,
        [organizationId]
      ).catch(() => ({ rows: [{}] })),

      this.pool.query(
        `SELECT
          COUNT(*) FILTER (WHERE jsonb_array_length(compliance_issues) > 0) as resources_with_issues,
          COALESCE(SUM(jsonb_array_length(compliance_issues)), 0) as total_issues
        FROM aws_resources
        WHERE organization_id = $1`,
        [organizationId]
      ).catch(() => ({ rows: [{}] })),
    ]);

    const r = resourceStats.rows[0] || {};
    const a = anomalyStats.rows[0] || {};
    const c = complianceStats.rows[0] || {};

    const totalResources = parseInt(r.total_resources || '0');
    const encryptedCount = parseInt(r.encrypted_count || '0');
    const unencryptedCount = parseInt(r.unencrypted_count || '0');
    const publicCount = parseInt(r.public_count || '0');
    const nonPublicCount = parseInt(r.non_public_count || '0');
    const backupCount = parseInt(r.backup_count || '0');
    const noBackupCount = parseInt(r.no_backup_count || '0');
    const taggedCount = parseInt(r.tagged_count || '0');
    const untaggedCount = parseInt(r.untagged_count || '0');
    const activeAnomalyCount = parseInt(a.active_count || '0');
    const criticalAnomalyCount = parseInt(a.critical_count || '0');
    const unresolvedComplianceIssues = parseInt(c.resources_with_issues || '0');
    const totalComplianceIssues = parseInt(c.total_issues || '0');

    return {
      totalResources,
      encryptedCount,
      unencryptedCount,
      publicCount,
      nonPublicCount,
      backupCount,
      noBackupCount,
      taggedCount,
      untaggedCount,
      activeAnomalyCount,
      criticalAnomalyCount,
      unresolvedComplianceIssues,
      totalComplianceIssues,
    };
  }

  /**
   * Evaluate a single control against the infrastructure snapshot
   */
  private evaluateControl(control: ComplianceControl, snap: InfraSnapshot): ControlResult {
    const { id, controlId, framework, category, name, description, severity, remediationGuidance } = control;

    let status: ControlStatus = 'pass';
    let score = 100;
    let evidence: ControlEvidence = {};

    // No resources = not applicable, treat as pass
    if (snap.totalResources === 0) {
      return {
        id,
        controlId,
        framework,
        category,
        name,
        description,
        severity,
        status: 'not_applicable',
        score: 100,
        evidence: { details: 'No AWS resources discovered. Connect an AWS account to evaluate this control.' },
        remediationGuidance,
      };
    }

    switch (controlId) {
      // SOC 2 ─────────────────────────────────────────────────────────────
      case 'CC1.1': {
        // Tagging accountability: ≥90% of resources must be tagged
        const pct = snap.totalResources > 0 ? snap.taggedCount / snap.totalResources : 0;
        status = pct >= 0.9 ? 'pass' : 'fail';
        score = Math.round(pct * 100);
        evidence = {
          totalResources: snap.totalResources,
          passingCount: snap.taggedCount,
          failingCount: snap.untaggedCount,
          details: `${snap.taggedCount} of ${snap.totalResources} resources have ownership tags (${Math.round(pct * 100)}%).`,
        };
        break;
      }

      case 'CC2.1': {
        // Communication: active anomalies should be low
        const hasActiveAnomalies = snap.activeAnomalyCount > 0;
        const highUnacknowledged = snap.activeAnomalyCount > 5;
        status = highUnacknowledged ? 'fail' : 'pass';
        score = highUnacknowledged ? Math.max(0, 100 - snap.activeAnomalyCount * 10) : 100;
        evidence = {
          details: `${snap.activeAnomalyCount} active/unacknowledged anomalies detected.`,
        };
        break;
      }

      case 'CC3.1': {
        // Risk assessment: critical issues must be actively tracked
        status = snap.criticalAnomalyCount > 2 ? 'fail' : 'pass';
        score = snap.criticalAnomalyCount === 0 ? 100 : Math.max(0, 100 - snap.criticalAnomalyCount * 20);
        evidence = {
          details: `${snap.criticalAnomalyCount} critical anomalies currently unresolved.`,
        };
        break;
      }

      case 'CC6.1': {
        // Encryption at rest: ≥95% of resources encrypted
        const pct = snap.totalResources > 0 ? snap.encryptedCount / snap.totalResources : 1;
        status = pct >= 0.95 ? 'pass' : 'fail';
        score = Math.round(pct * 100);
        evidence = {
          totalResources: snap.totalResources,
          passingCount: snap.encryptedCount,
          failingCount: snap.unencryptedCount,
          details: `${snap.encryptedCount} of ${snap.totalResources} resources encrypted at rest (${Math.round(pct * 100)}%).`,
        };
        break;
      }

      case 'CC6.2': {
        // Authentication: check for any public-facing resources with no backup/encryption
        const vulnerable = snap.publicCount > 0 && snap.unencryptedCount > 0;
        status = vulnerable ? 'fail' : 'pass';
        score = vulnerable ? 50 : 100;
        evidence = {
          details: `${snap.publicCount} public resources; ${snap.unencryptedCount} unencrypted resources.`,
        };
        break;
      }

      case 'CC6.3': {
        // Privileged access: no unencrypted resources in public scope
        const exposedUnencrypted = snap.publicCount > 0 && snap.unencryptedCount > 0;
        status = exposedUnencrypted ? 'fail' : 'pass';
        score = exposedUnencrypted ? Math.max(10, 100 - snap.publicCount * 5 - snap.unencryptedCount * 5) : 100;
        evidence = {
          details: `${snap.publicCount} publicly accessible resources detected.`,
        };
        break;
      }

      case 'CC6.6': {
        // Network security: 0 public resources = pass; any public = fail
        status = snap.publicCount === 0 ? 'pass' : 'fail';
        score = snap.totalResources > 0
          ? Math.round(((snap.totalResources - snap.publicCount) / snap.totalResources) * 100)
          : 100;
        evidence = {
          totalResources: snap.totalResources,
          passingCount: snap.totalResources - snap.publicCount,
          failingCount: snap.publicCount,
          details: `${snap.publicCount} resources are publicly accessible.`,
        };
        break;
      }

      case 'CC6.7': {
        // Transmission security: proxy check via encryption at rest (best available signal)
        const pct = snap.totalResources > 0 ? snap.encryptedCount / snap.totalResources : 1;
        status = pct >= 0.9 ? 'pass' : 'fail';
        score = Math.round(pct * 100);
        evidence = {
          details: `Transmission security evaluated via encryption posture: ${Math.round(pct * 100)}% of resources encrypted.`,
        };
        break;
      }

      case 'CC7.1': {
        // Security monitoring: pass if no critical anomalies unresolved for extended period
        status = snap.criticalAnomalyCount === 0 ? 'pass' : 'fail';
        score = snap.criticalAnomalyCount === 0 ? 100 : Math.max(0, 100 - snap.criticalAnomalyCount * 25);
        evidence = {
          details: `${snap.activeAnomalyCount} active anomalies; ${snap.criticalAnomalyCount} critical.`,
        };
        break;
      }

      case 'CC7.2': {
        // Anomaly detection: pass if anomaly detection is active (active anomaly count ≥ 0 = system running)
        // Fail if there are many unresolved issues suggesting the system isn't acting on detections
        status = snap.activeAnomalyCount <= 10 ? 'pass' : 'fail';
        score = snap.activeAnomalyCount === 0 ? 100 : Math.max(0, 100 - snap.activeAnomalyCount * 8);
        evidence = {
          details: `Anomaly detection active. ${snap.activeAnomalyCount} anomalies currently under review.`,
        };
        break;
      }

      case 'CC9.1': {
        // Business continuity: ≥90% of resources have backups
        const pct = snap.totalResources > 0 ? snap.backupCount / snap.totalResources : 1;
        status = pct >= 0.9 ? 'pass' : 'fail';
        score = Math.round(pct * 100);
        evidence = {
          totalResources: snap.totalResources,
          passingCount: snap.backupCount,
          failingCount: snap.noBackupCount,
          details: `${snap.backupCount} of ${snap.totalResources} resources have backups enabled (${Math.round(pct * 100)}%).`,
        };
        break;
      }

      case 'A1.1': {
        // Availability: check for any compliance issues
        const hasIssues = snap.totalComplianceIssues > snap.totalResources * 0.2;
        status = hasIssues ? 'fail' : 'pass';
        score = hasIssues ? Math.max(0, 100 - snap.totalComplianceIssues) : 100;
        evidence = {
          details: `${snap.totalComplianceIssues} total compliance issues across ${snap.totalResources} resources.`,
        };
        break;
      }

      // HIPAA ─────────────────────────────────────────────────────────────
      case '§164.308(a)(1)': {
        // Risk analysis: any critical issues = fail
        status = snap.criticalAnomalyCount === 0 && snap.unresolvedComplianceIssues < snap.totalResources * 0.1 ? 'pass' : 'fail';
        score = snap.criticalAnomalyCount === 0
          ? Math.max(0, 100 - snap.unresolvedComplianceIssues * 2)
          : Math.max(0, 50 - snap.criticalAnomalyCount * 15);
        evidence = {
          details: `${snap.criticalAnomalyCount} critical anomalies; ${snap.unresolvedComplianceIssues} resources with compliance issues.`,
        };
        break;
      }

      case '§164.308(a)(3)': {
        // Workforce access: public resources = fail
        status = snap.publicCount === 0 ? 'pass' : 'fail';
        score = snap.totalResources > 0
          ? Math.round(((snap.totalResources - snap.publicCount) / snap.totalResources) * 100)
          : 100;
        evidence = {
          totalResources: snap.totalResources,
          passingCount: snap.totalResources - snap.publicCount,
          failingCount: snap.publicCount,
          details: `${snap.publicCount} publicly accessible resources violate minimum necessary access.`,
        };
        break;
      }

      case '§164.308(a)(5)': {
        // Security awareness: anomalies are being tracked
        status = snap.activeAnomalyCount <= 5 ? 'pass' : 'fail';
        score = Math.max(0, 100 - snap.activeAnomalyCount * 10);
        evidence = {
          details: `${snap.activeAnomalyCount} security events currently active/unacknowledged.`,
        };
        break;
      }

      case '§164.308(a)(8)': {
        // Evaluation: recent scan results exist + low issue rate
        const issueRate = snap.totalResources > 0 ? snap.unresolvedComplianceIssues / snap.totalResources : 0;
        status = issueRate < 0.15 ? 'pass' : 'fail';
        score = Math.round(Math.max(0, (1 - issueRate) * 100));
        evidence = {
          details: `Issue rate: ${(issueRate * 100).toFixed(1)}% of resources have unresolved compliance issues.`,
        };
        break;
      }

      case '§164.312(a)(1)': {
        // Access control: no public data stores
        status = snap.publicCount === 0 ? 'pass' : 'fail';
        score = snap.totalResources > 0
          ? Math.round(((snap.totalResources - snap.publicCount) / snap.totalResources) * 100)
          : 100;
        evidence = {
          totalResources: snap.totalResources,
          passingCount: snap.totalResources - snap.publicCount,
          failingCount: snap.publicCount,
          details: `${snap.publicCount} resources are publicly accessible.`,
        };
        break;
      }

      case '§164.312(a)(2)(iv)': {
        // Encryption and decryption: ≥95% encrypted
        const pct = snap.totalResources > 0 ? snap.encryptedCount / snap.totalResources : 1;
        status = pct >= 0.95 ? 'pass' : 'fail';
        score = Math.round(pct * 100);
        evidence = {
          totalResources: snap.totalResources,
          passingCount: snap.encryptedCount,
          failingCount: snap.unencryptedCount,
          details: `${snap.encryptedCount} of ${snap.totalResources} resources encrypted at rest (${Math.round(pct * 100)}%).`,
        };
        break;
      }

      case '§164.312(b)': {
        // Audit controls: check compliance issue tracking
        const hasAuditSignals = snap.totalResources > 0;
        status = hasAuditSignals && snap.criticalAnomalyCount === 0 ? 'pass' : 'fail';
        score = snap.criticalAnomalyCount === 0 ? 100 : Math.max(0, 100 - snap.criticalAnomalyCount * 20);
        evidence = {
          details: `Audit trail: ${snap.activeAnomalyCount} active anomaly events tracked. ${snap.criticalAnomalyCount} critical unresolved.`,
        };
        break;
      }

      case '§164.312(c)(1)': {
        // Integrity: backups protect against improper destruction
        const pct = snap.totalResources > 0 ? snap.backupCount / snap.totalResources : 1;
        status = pct >= 0.9 ? 'pass' : 'fail';
        score = Math.round(pct * 100);
        evidence = {
          totalResources: snap.totalResources,
          passingCount: snap.backupCount,
          failingCount: snap.noBackupCount,
          details: `${snap.backupCount} of ${snap.totalResources} resources have integrity-preserving backups (${Math.round(pct * 100)}%).`,
        };
        break;
      }

      case '§164.312(c)(2)': {
        // Transmission integrity: encryption posture
        const pct = snap.totalResources > 0 ? snap.encryptedCount / snap.totalResources : 1;
        status = pct >= 0.9 ? 'pass' : 'fail';
        score = Math.round(pct * 100);
        evidence = {
          details: `${Math.round(pct * 100)}% of resources have encryption enabled.`,
        };
        break;
      }

      case '§164.312(d)': {
        // Person/entity authentication: public + unencrypted = major failure
        const exposed = snap.publicCount > 0 || snap.unencryptedCount > snap.totalResources * 0.1;
        status = exposed ? 'fail' : 'pass';
        score = exposed
          ? Math.max(0, 100 - snap.publicCount * 10 - snap.unencryptedCount * 5)
          : 100;
        evidence = {
          details: `${snap.publicCount} publicly accessible; ${snap.unencryptedCount} unencrypted resources.`,
        };
        break;
      }

      case '§164.312(e)(1)': {
        // Transmission security: no public resources
        status = snap.publicCount === 0 ? 'pass' : 'fail';
        score = snap.totalResources > 0
          ? Math.round(((snap.totalResources - snap.publicCount) / snap.totalResources) * 100)
          : 100;
        evidence = {
          totalResources: snap.totalResources,
          passingCount: snap.totalResources - snap.publicCount,
          failingCount: snap.publicCount,
          details: `${snap.publicCount} resources expose data over public networks without confirmed TLS enforcement.`,
        };
        break;
      }

      case '§164.312(e)(2)(ii)': {
        // Transmission encryption: ≥95% encrypted
        const pct = snap.totalResources > 0 ? snap.encryptedCount / snap.totalResources : 1;
        status = pct >= 0.95 ? 'pass' : 'fail';
        score = Math.round(pct * 100);
        evidence = {
          totalResources: snap.totalResources,
          passingCount: snap.encryptedCount,
          failingCount: snap.unencryptedCount,
          details: `${snap.encryptedCount} of ${snap.totalResources} resources comply with transmission encryption requirements.`,
        };
        break;
      }

      default: {
        status = 'not_applicable';
        score = 100;
        evidence = { details: 'Control evaluation not implemented.' };
      }
    }

    return {
      id,
      controlId,
      framework,
      category,
      name,
      description,
      severity,
      status,
      score: Math.max(0, Math.min(100, score)),
      evidence,
      remediationGuidance,
    };
  }

  /**
   * Persist a scan result to the DB
   */
  private async persistResult(organizationId: string, result: FrameworkScanResult): Promise<void> {
    await this.pool.query(
      `INSERT INTO compliance_scan_results
        (organization_id, framework, overall_score, controls_passed, controls_failed, controls_total, control_results, scanned_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        organizationId,
        result.framework,
        result.overallScore,
        result.controlsPassed,
        result.controlsFailed,
        result.controlsTotal,
        JSON.stringify(result.controlResults),
        result.scannedAt,
      ]
    );
  }
}
