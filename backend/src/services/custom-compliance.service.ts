import { Pool, PoolClient } from 'pg';
import {
  ComplianceFrameworksRepository,
  ComplianceFrameworkRule,
  ComplianceScan,
} from '../repositories/compliance-frameworks.repository';
import { AWSResource } from '../types/aws-resources.types';
import { tagsObserved } from './complianceScanner';

interface RuleEvaluationResult {
  pass: boolean;
  issue?: string;
  recommendation?: string;
  error?: string;
  /**
   * Set when the rule could not be evaluated because what it tests is unknown for
   * this resource (a property discovery did not read, or tags that were not read).
   * Not a pass and not a failure: the finding is recorded as 'skip' with this text,
   * and the rule does not count toward the resource's compliance either way.
   */
  notEvaluated?: string;
}

const notEvaluated = (reason: string): RuleEvaluationResult => ({ pass: false, notEvaluated: `Not evaluated: ${reason}` });

/**
 * Distinct from cost-recommendations.repository.ts's RECONCILIATION_LOCK_SALT
 * (1) and soc2-evidence.repository.ts's SOC2_COMPUTATION_LOCK_SALT (2) --
 * same hashtextextended(key, salt) convention, new salt so this lock's key
 * space can never collide with either of those.
 */
const SCAN_CONCURRENCY_LOCK_SALT = 3;

/** The longest one scan may run before it is stopped and marked failed (founder decision, Oct 29). */
export const SCAN_TIMEOUT_MS = 10 * 60 * 1000;

/** The longest any one statement of a scan's results transaction may run. */
export const SCAN_STATEMENT_TIMEOUT_MS = 60 * 1000;

/**
 * The longest a scan's results transaction may sit idle between statements.
 * Past it the server ends the session, which rolls the transaction back and
 * frees the scan lock even when this process can no longer act.
 */
export const SCAN_IDLE_IN_TRANSACTION_TIMEOUT_MS = 10 * 1000;

/** How long the timeout waits for the scan row's lock before ending the scan's session first. */
const TIMEOUT_MARK_LOCK_TIMEOUT_MS = 5 * 1000;

/** How long the timeout waits for the scan's session to exit after asking the server to end it. */
const TERMINATE_WAIT_MS = 5 * 1000;

/**
 * How long a timed-out scan waits for its own connection to finish closing
 * (to read the server's "terminating connection" notice) before it is handed
 * back to the pool to be removed. Past it the socket is destroyed here first.
 */
const CLIENT_END_WAIT_MS = 2 * 1000;

export const SCAN_TIMED_OUT_MESSAGE = 'Timed out after 10 minutes';
export const SCAN_INTERRUPTED_MESSAGE = 'Interrupted: the server restarted during the scan';

const LOCK_NOT_AVAILABLE = '55P03';

const SET_TENANT_SQL = "SELECT set_config('app.current_organization_id', $1, false)";

/**
 * Thrown by executeScan() when another scan is already active (pending or
 * running) for this framework. No scan row is created when this is thrown.
 */
export class ScanInProgressError extends Error {
  constructor() {
    super('A scan is already in progress for this framework.');
    this.name = 'ScanInProgressError';
  }
}

/** Thrown by executeScan() when the scan ran past its timeout and was marked failed. */
export class ScanTimedOutError extends Error {
  constructor() {
    super(SCAN_TIMED_OUT_MESSAGE);
    this.name = 'ScanTimedOutError';
  }
}

/**
 * The scan's row is no longer pending/running (its timeout marked it
 * failed), so this worker's results transaction was rolled back and nothing
 * of it was written.
 */
class ScanNoLongerActiveError extends Error {
  constructor(scanId: string) {
    super(`Scan ${scanId} is no longer running; its results were discarded`);
    this.name = 'ScanNoLongerActiveError';
  }
}

export type ScanStartResult =
  | { status: 'started'; scanId: string }
  | { status: 'already_in_progress' };

/** The Postgres session a scan runs on. pid plus backend_start never names a different session, even after pid reuse. */
type ScanSession = { pid: number; backendStart: string };

type ScanClaim = {
  client: PoolClient;
  scan: ComplianceScan;
  lockKey: string;
  session: ScanSession;
  onClientError: (error: Error) => void;
};

export interface CustomComplianceServiceOptions {
  /** Overrides SCAN_TIMEOUT_MS (tests). */
  scanTimeoutMs?: number;
}

export class CustomComplianceService {
  private repository: ComplianceFrameworksRepository;
  private scanTimeoutMs: number;

  constructor(private pool: Pool, options: CustomComplianceServiceOptions = {}) {
    this.repository = new ComplianceFrameworksRepository(pool);
    this.scanTimeoutMs = options.scanTimeoutMs ?? SCAN_TIMEOUT_MS;
  }

  /**
   * Execute a compliance scan and resolve/reject once it reaches a terminal
   * state. Preserves the original blocking contract relied on by existing
   * callers/tests. Rejects with ScanInProgressError (no scan row created) if
   * a scan is already active for this framework -- see startScan() for the
   * non-blocking variant the HTTP controller uses instead.
   */
  async executeScan(
    frameworkId: string,
    organizationId: string,
    userId?: string,
    resourceFilters?: Record<string, any>
  ): Promise<ComplianceScan> {
    console.log(`[CustomCompliance] Starting scan for framework ${frameworkId}`);

    const claim = await this.acquireLockAndCreateScan(frameworkId, organizationId, userId, resourceFilters);
    if (!claim) {
      throw new ScanInProgressError();
    }

    return this.handOffToLongRunningScan(claim, frameworkId, organizationId, resourceFilters);
  }

  /**
   * Non-blocking start used by the HTTP controller. Resolves as soon as the
   * concurrency claim (advisory lock + pending scan row) is settled --
   * bounded by one lock attempt plus one INSERT, not by the scan's total
   * duration. The actual scan work continues in the background on the same
   * dedicated client; this service owns that client end-to-end from here, so
   * callers never receive it and never need to remember to release/unlock
   * anything themselves.
   */
  async startScan(
    frameworkId: string,
    organizationId: string,
    userId?: string,
    resourceFilters?: Record<string, any>
  ): Promise<ScanStartResult> {
    console.log(`[CustomCompliance] Starting scan for framework ${frameworkId}`);

    const claim = await this.acquireLockAndCreateScan(frameworkId, organizationId, userId, resourceFilters);
    if (!claim) {
      return { status: 'already_in_progress' };
    }

    // Intentionally not awaited -- handOffToLongRunningScan takes exclusive
    // ownership of unlocking and releasing `claim.client` for every
    // remaining path (scan success, scan failure, or a synchronous throw
    // during the handoff itself) from this point on.
    this.handOffToLongRunningScan(claim, frameworkId, organizationId, resourceFilters).catch((error) => {
      console.error(`[CustomCompliance] Scan ${claim.scan.id} failed after start:`, error);
    });

    return { status: 'started', scanId: claim.scan.id };
  }

  /**
   * Acquire the framework-scoped session advisory lock and, only if
   * acquired, create the pending scan row -- both on one dedicated client.
   * Every exit path leaves the client in exactly one of two states: released
   * here (lock not acquired, or acquired but createScan failed), or handed
   * back to the caller for immediate, synchronous handoff into
   * handOffToLongRunningScan (lock acquired, scan row created). There is no
   * path that both keeps and releases the client, and no path that does
   * neither.
   *
   * Lock key is `${organizationId}:${frameworkId}` -- deterministic per
   * framework and inherently org-scoped (framework_id is unique per org via
   * compliance_frameworks_id_org_unique), so this never serializes unrelated
   * frameworks or unrelated organizations against each other.
   *
   * Holding the lock also proves that no live scan of this framework exists
   * in any process: a scan writes only through the session that holds its
   * lock, so if the lock was free, that session is gone. Any run row still
   * pending or running is a dead scan's, and is marked failed (interrupted)
   * here, under the same lock, before the new row is created.
   */
  private async acquireLockAndCreateScan(
    frameworkId: string,
    organizationId: string,
    userId?: string,
    resourceFilters?: Record<string, any>
  ): Promise<ScanClaim | null> {
    const client = await this.pool.connect();
    const lockKey = `${organizationId}:${frameworkId}`;
    const onClientError = this.watchScanClient(client, lockKey);
    let lockAcquired = false;

    try {
      await client.query(SET_TENANT_SQL, [organizationId]);

      if (!(await this.tryLock(client, lockKey))) {
        this.releaseScanClient(client, onClientError);
        return null;
      }
      lockAcquired = true;

      await this.failInterruptedScans(client, organizationId, frameworkId);

      const session = await this.readSession(client);

      const scan = await this.repository.createScan({
        organization_id: organizationId,
        framework_id: frameworkId,
        scan_type: 'manual',
        resource_filters: resourceFilters,
        triggered_by: userId,
      }, client);

      return { client, scan, lockKey, session, onClientError };
    } catch (error) {
      const unlocked = lockAcquired ? await this.unlockQuietly(client, lockKey) : true;
      this.releaseScanClient(client, onClientError, unlocked ? undefined : new Error('Scan lock release failed'));
      throw error;
    }
  }

  /**
   * The boundary between the fast "claim this framework" phase and the
   * long-running scan body. Kept as its own method -- rather than inlined at
   * each call site -- specifically so the handoff itself (not just
   * runScanBody's own try/catch) is covered by one place that guarantees
   * `claim.client` is unlocked and released on every path, including a
   * synchronous throw at this call boundary before runScanBody's own try
   * block ever starts.
   *
   * It also arms the scan's timeout (stopTimedOutScan). When the timeout
   * ended the scan's session, the connection is destroyed, never returned to
   * the pool, and only after it has finished closing (closeEndedClient).
   */
  private async handOffToLongRunningScan(
    claim: ScanClaim,
    frameworkId: string,
    organizationId: string,
    resourceFilters?: Record<string, any>
  ): Promise<ComplianceScan> {
    const startedAt = Date.now();
    // Resolves to whether the timeout ended the scan's session.
    const run: { timeout: Promise<boolean> | null } = { timeout: null };
    const timer = setTimeout(() => {
      run.timeout = this.stopTimedOutScan(claim, frameworkId, organizationId, startedAt);
    }, this.scanTimeoutMs);

    try {
      return await this.runScanBody(claim.client, claim.scan, frameworkId, organizationId, resourceFilters);
    } catch (error) {
      if (run.timeout && (await run.timeout)) throw new ScanTimedOutError();
      throw error;
    } finally {
      clearTimeout(timer);
      const sessionEnded = run.timeout ? await run.timeout : false;
      let destroyWith: Error | undefined;
      if (sessionEnded) {
        await this.closeEndedClient(claim.client);
        destroyWith = new Error('Scan timed out');
      } else if (!(await this.unlockQuietly(claim.client, claim.lockKey))) {
        destroyWith = new Error('Scan lock release failed');
      }
      this.releaseScanClient(claim.client, claim.onClientError, destroyWith);
    }
  }

  /**
   * Waits, with the scan's 'error' listener still attached, until a
   * connection whose session the timeout ended has finished closing. Released
   * any earlier, the client could read the server's "terminating connection"
   * notice only after pg-pool had put its own idle listener back, and the
   * pool would emit 'error' (config/database.ts exits the process on that).
   * If it hasn't closed within CLIENT_END_WAIT_MS, its socket is destroyed
   * here, still under the scan's listener, before the pool sees it.
   */
  private async closeEndedClient(client: PoolClient): Promise<void> {
    if (await this.waitForClientEnd(client, CLIENT_END_WAIT_MS)) return;
    console.error('[CustomCompliance] Timed-out scan connection did not close in time; destroying it');
    (client as unknown as { connection?: { stream?: { destroy: () => void } } }).connection?.stream?.destroy();
    await this.waitForClientEnd(client, CLIENT_END_WAIT_MS);
  }

  private waitForClientEnd(client: PoolClient, timeoutMs: number): Promise<boolean> {
    if ((client as unknown as { _ended?: boolean })._ended) return Promise.resolve(true);
    return new Promise((resolve) => {
      const onEnd = () => {
        clearTimeout(timer);
        resolve(true);
      };
      const timer = setTimeout(() => {
        client.removeListener('end', onEnd);
        resolve(false);
      }, timeoutMs);
      client.once('end', onEnd);
    });
  }

  /**
   * Stops a scan that ran past its timeout: marks its row failed (only if it
   * is still pending or running), then ends its Postgres session. Ending the
   * session releases the scan lock and rolls back the scan's open results
   * transaction, and every later query on that connection fails, so the
   * scan can write nothing more. If the row is locked by the scan's own
   * final update, the session is ended first and the row marked after.
   * A run that had already finished (the mark matched no row) is left alone:
   * its session is not ended, and the scan unlocks and pools its connection
   * as usual. If the mark itself failed, the session is still ended, so the
   * lock is freed; the run is then recovered as interrupted.
   * Resolves to whether it ended the session. Never rejects.
   */
  private async stopTimedOutScan(
    claim: ScanClaim,
    frameworkId: string,
    organizationId: string,
    startedAt: number
  ): Promise<boolean> {
    const durationSeconds = Math.round((Date.now() - startedAt) / 1000);
    console.warn(`[CustomCompliance] Scan timed out: framework ${frameworkId} after ${durationSeconds}s`);

    let marked: 'marked' | 'already_finished' | 'row_busy' | 'error' = 'error';
    try {
      marked = await this.markTimedOut(claim.scan.id, organizationId);
    } catch (error: any) {
      console.error(`[CustomCompliance] Could not mark timed-out scan failed (framework ${frameworkId}):`, error?.message);
    }

    if (marked === 'already_finished') return false;

    try {
      await this.endScanSession(claim.session);
    } catch (error: any) {
      console.error(`[CustomCompliance] Could not end timed-out scan session (framework ${frameworkId}):`, error?.message);
    }

    if (marked === 'row_busy') {
      try {
        await this.markTimedOut(claim.scan.id, organizationId);
      } catch (error: any) {
        console.error(`[CustomCompliance] Could not mark timed-out scan failed (framework ${frameworkId}):`, error?.message);
      }
    }
    return true;
  }

  /** One status-guarded update, on its own connection, so a scan blocked on its own connection can't hold it up. */
  private async markTimedOut(
    scanId: string,
    organizationId: string
  ): Promise<'marked' | 'already_finished' | 'row_busy'> {
    const client = await this.pool.connect();
    let destroyWith: Error | undefined;
    try {
      await client.query(SET_TENANT_SQL, [organizationId]);
      await client.query('BEGIN');
      await client.query(`SET LOCAL lock_timeout = ${TIMEOUT_MARK_LOCK_TIMEOUT_MS}`);
      const updated = await this.repository.updateScan(scanId, {
        status: 'failed',
        error_message: SCAN_TIMED_OUT_MESSAGE,
        completed_at: new Date(),
      }, client, ['pending', 'running']);
      await client.query('COMMIT');
      return updated ? 'marked' : 'already_finished';
    } catch (error: any) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError: any) {
        destroyWith = rollbackError;
      }
      if (error?.code === LOCK_NOT_AVAILABLE) return 'row_busy';
      throw error;
    } finally {
      client.release(destroyWith);
    }
  }

  private async endScanSession(session: ScanSession): Promise<void> {
    const client = await this.pool.connect();
    try {
      // The two-argument pg_terminate_backend (wait up to TERMINATE_WAIT_MS
      // for the session to exit) needs PostgreSQL 14 or later. Production
      // runs 16; CI runs 14.
      await client.query(
        `SELECT pg_terminate_backend(pid, ${TERMINATE_WAIT_MS})
         FROM pg_stat_activity WHERE pid = $1 AND backend_start = $2::timestamptz`,
        [session.pid, session.backendStart]
      );
    } finally {
      client.release();
    }
  }

  /**
   * Startup recovery: marks failed (interrupted) every pending or running
   * scan whose session is gone -- a server restart or crash mid-scan. Same
   * rule as the pre-start recovery in acquireLockAndCreateScan: a
   * framework's rows are touched only while this connection holds that
   * framework's scan lock, so a scan still live in this or any other process
   * is left alone. Each organization is read with its own tenant tag, since
   * row-level security hides every scan row from an untagged session.
   * Returns how many runs it marked.
   */
  async recoverInterruptedScans(): Promise<number> {
    const client = await this.pool.connect();
    const onClientError = this.watchScanClient(client, 'startup recovery');
    let destroyWith: Error | undefined;
    let marked = 0;

    try {
      const { rows: organizations } = await client.query('SELECT id FROM organizations ORDER BY id');
      for (const { id: organizationId } of organizations) {
        await client.query(SET_TENANT_SQL, [organizationId]);
        const { rows: frameworks } = await client.query(
          `SELECT DISTINCT framework_id FROM compliance_scans
           WHERE organization_id = $1 AND status IN ('pending', 'running')`,
          [organizationId]
        );

        for (const { framework_id: frameworkId } of frameworks) {
          const lockKey = `${organizationId}:${frameworkId}`;
          if (!(await this.tryLock(client, lockKey))) continue;
          try {
            marked += await this.failInterruptedScans(client, organizationId, frameworkId);
          } finally {
            if (!(await this.unlockQuietly(client, lockKey))) {
              destroyWith = new Error('Scan lock release failed');
            }
          }
          if (destroyWith) throw destroyWith;
        }
      }
      return marked;
    } catch (error) {
      destroyWith ??= error instanceof Error ? error : new Error(String(error));
      throw error;
    } finally {
      this.releaseScanClient(client, onClientError, destroyWith);
    }
  }

  /** Only while holding this framework's scan lock -- see acquireLockAndCreateScan. */
  private async failInterruptedScans(client: PoolClient, organizationId: string, frameworkId: string): Promise<number> {
    const count = await this.repository.failActiveScans(organizationId, frameworkId, SCAN_INTERRUPTED_MESSAGE, new Date(), client);
    if (count > 0) {
      console.warn(`[CustomCompliance] Marked ${count} interrupted scan(s) failed: framework ${frameworkId}`);
    }
    return count;
  }

  private async tryLock(client: PoolClient, lockKey: string): Promise<boolean> {
    const { rows } = await client.query(
      `SELECT pg_try_advisory_lock(hashtextextended($1, ${SCAN_CONCURRENCY_LOCK_SALT})) AS locked`,
      [lockKey]
    );
    return rows[0].locked === true;
  }

  /** Returns false when the unlock failed: the caller must then destroy the connection, never pool it with the lock held. */
  private async unlockQuietly(client: PoolClient, lockKey: string): Promise<boolean> {
    try {
      await client.query(
        `SELECT pg_advisory_unlock(hashtextextended($1, ${SCAN_CONCURRENCY_LOCK_SALT}))`,
        [lockKey]
      );
      return true;
    } catch (error) {
      console.error(`[CustomCompliance] Failed to release advisory lock for ${lockKey}:`, error);
      return false;
    }
  }

  private async readSession(client: PoolClient): Promise<ScanSession> {
    const { rows } = await client.query(
      'SELECT pid, backend_start::text AS backend_start FROM pg_stat_activity WHERE pid = pg_backend_pid()'
    );
    return { pid: rows[0].pid, backendStart: rows[0].backend_start };
  }

  /**
   * pg-pool removes its own 'error' listener while a client is checked out,
   * so a session the server ends (the timeout, idle_in_transaction_session_timeout,
   * a database restart) would emit an unhandled 'error' and crash the
   * process. The scan's own queries already fail on that connection; this
   * only logs. Removed again before the client goes back to the pool.
   */
  private watchScanClient(client: PoolClient, label: string): (error: Error) => void {
    const onClientError = (error: Error) => {
      console.error(`[CustomCompliance] Scan connection ended (${label}):`, error.message);
    };
    client.on('error', onClientError);
    return onClientError;
  }

  /** A `destroyWith` error destroys the connection instead of returning it to the pool. */
  private releaseScanClient(client: PoolClient, onClientError: (error: Error) => void, destroyWith?: Error): void {
    client.removeListener('error', onClientError);
    client.release(destroyWith);
  }

  /**
   * The scan body, run entirely on the caller's dedicated client -- every
   * repository/query call below is passed `client` explicitly so none of
   * them fall back to the AsyncLocalStorage-routed this.pool. The scan row
   * already exists (created by acquireLockAndCreateScan) by the time this
   * runs.
   *
   * Every status change is guarded on the status it leaves, and the
   * findings and the final status are one transaction that commits only
   * while the scan is still running: a scan its timeout already marked
   * failed writes nothing, and a failed status is never overwritten.
   */
  private async runScanBody(
    client: PoolClient,
    scan: ComplianceScan,
    frameworkId: string,
    organizationId: string,
    resourceFilters?: Record<string, any>
  ): Promise<ComplianceScan> {
    let inTransaction = false;
    try {
      // Update scan to running (committed on its own, so the run shows as running while it works)
      const running = await this.repository.updateScan(scan.id, {
        status: 'running',
        started_at: new Date(),
      }, client, ['pending']);
      if (!running) {
        throw new ScanNoLongerActiveError(scan.id);
      }

      const startTime = Date.now();

      await client.query('BEGIN');
      inTransaction = true;
      await client.query(`SET LOCAL statement_timeout = ${SCAN_STATEMENT_TIMEOUT_MS}`);
      await client.query(`SET LOCAL idle_in_transaction_session_timeout = ${SCAN_IDLE_IN_TRANSACTION_TIMEOUT_MS}`);

      // Get framework and rules
      const frameworkData = await this.repository.findFrameworkWithRules(frameworkId, organizationId, client);
      if (!frameworkData) {
        throw new Error('Framework not found');
      }

      const { rules } = frameworkData;
      const enabledRules = rules.filter((r) => r.enabled);

      if (enabledRules.length === 0) {
        throw new Error('No enabled rules in framework');
      }

      // Fetch resources to scan
      const resources = await this.fetchResources(client, organizationId, resourceFilters);

      let totalResources = resources.length;
      let compliantResources = 0;
      let nonCompliantResources = 0;
      let resourcesScanned = 0;

      const issueCounts = {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
      };

      // Scan each resource against all applicable rules
      for (const resource of resources) {
        const resourceResults: { ruleId: string; passed: boolean }[] = [];

        for (const rule of enabledRules) {
          // Check if rule applies to this resource type
          if (!this.ruleAppliesTo(rule, resource)) {
            // Skip - rule doesn't apply to this resource type
            await this.repository.createFinding({
              scan_id: scan.id,
              organization_id: organizationId,
              rule_id: rule.id,
              resource_id: resource.id,
              resource_arn: resource.resource_arn,
              resource_type: resource.resource_type,
              resource_name: resource.resource_name,
              status: 'skip',
              severity: rule.severity,
              category: rule.category,
              issue: null,
              recommendation: null,
            }, client);
            continue;
          }

          // Execute rule
          const result = await this.evaluateRule(rule, resource);

          // Record finding
          await this.repository.createFinding({
            scan_id: scan.id,
            organization_id: organizationId,
            rule_id: rule.id,
            resource_id: resource.id,
            resource_arn: resource.resource_arn,
            resource_type: resource.resource_type,
            resource_name: resource.resource_name,
            status: result.error ? 'error' : result.notEvaluated ? 'skip' : result.pass ? 'pass' : 'fail',
            severity: rule.severity,
            category: rule.category,
            issue: result.notEvaluated || result.issue || null,
            recommendation: result.notEvaluated ? null : result.recommendation || null,
          }, client);

          if (!result.error && !result.notEvaluated) {
            resourceResults.push({ ruleId: rule.id, passed: result.pass });

            if (!result.pass) {
              // Count issues by severity
              if (rule.severity in issueCounts) {
                issueCounts[rule.severity as keyof typeof issueCounts]++;
              }
            }
          }
        }

        resourcesScanned++;

        // Resource is compliant if it passed all applicable rules
        const applicableRules = resourceResults.length;
        const passedRules = resourceResults.filter((r) => r.passed).length;

        if (applicableRules > 0 && passedRules === applicableRules) {
          compliantResources++;
        } else if (applicableRules > 0) {
          nonCompliantResources++;
        }
      }

      // Calculate compliance score
      const complianceScore =
        resourcesScanned > 0 ? (compliantResources / resourcesScanned) * 100 : 100;

      const durationSeconds = Math.floor((Date.now() - startTime) / 1000);

      // Update scan with results -- only while it is still running; otherwise
      // the whole transaction, findings included, is rolled back below
      const completed = await this.repository.updateScan(scan.id, {
        status: 'completed',
        total_resources: totalResources,
        compliant_resources: compliantResources,
        non_compliant_resources: nonCompliantResources,
        resources_scanned: resourcesScanned,
        critical_issues: issueCounts.critical,
        high_issues: issueCounts.high,
        medium_issues: issueCounts.medium,
        low_issues: issueCounts.low,
        compliance_score: complianceScore,
        completed_at: new Date(),
        duration_seconds: durationSeconds,
      }, client, ['running']);
      if (!completed) {
        throw new ScanNoLongerActiveError(scan.id);
      }

      await client.query('COMMIT');
      inTransaction = false;

      console.log(
        `[CustomCompliance] Scan ${scan.id} completed: ${compliantResources}/${resourcesScanned} compliant (${complianceScore.toFixed(1)}%)`
      );

      // The committed row itself (RETURNING *): no further query, so a
      // timeout ending the session right after the commit can't turn a
      // completed scan into an error.
      return completed;
    } catch (error: any) {
      if (inTransaction) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackError: any) {
          console.error(`[CustomCompliance] Scan ${scan.id} rollback failed:`, rollbackError?.message);
        }
      }

      if (error instanceof ScanNoLongerActiveError) {
        console.warn(`[CustomCompliance] ${error.message}`);
        throw error;
      }

      console.error(`[CustomCompliance] Scan ${scan.id} failed:`, error);

      await this.repository.updateScan(scan.id, {
        status: 'failed',
        error_message: error.message,
        completed_at: new Date(),
      }, client, ['pending', 'running']);

      throw error;
    }
  }

  /**
   * Check if a rule applies to a resource
   */
  private ruleAppliesTo(rule: ComplianceFrameworkRule, resource: AWSResource): boolean {
    // If resource_types is empty, rule applies to all resources
    if (!rule.resource_types || rule.resource_types.length === 0) {
      return true;
    }

    // Check if resource type is in the list
    return rule.resource_types.includes(resource.resource_type);
  }

  /**
   * Evaluate a rule against a resource
   */
  private async evaluateRule(
    rule: ComplianceFrameworkRule,
    resource: AWSResource
  ): Promise<RuleEvaluationResult> {
    try {
      switch (rule.rule_type) {
        case 'property_check':
          return this.evaluatePropertyCheck(rule, resource);

        case 'tag_required':
          return this.evaluateTagRequired(rule, resource);

        case 'tag_pattern':
          return this.evaluateTagPattern(rule, resource);

        case 'metadata_check':
          return this.evaluateMetadataCheck(rule, resource);

        default:
          return {
            pass: false,
            error: `Unknown rule type: ${rule.rule_type}`,
          };
      }
    } catch (error: any) {
      console.error(`[CustomCompliance] Error evaluating rule ${rule.rule_code}:`, error);
      return {
        pass: false,
        error: error.message,
      };
    }
  }

  /**
   * Evaluate property_check rule
   * Conditions: { property: string, operator: string, value: any }
   */
  private evaluatePropertyCheck(
    rule: ComplianceFrameworkRule,
    resource: AWSResource
  ): RuleEvaluationResult {
    const { property, operator, value } = rule.conditions;

    if (!property || !operator) {
      return { pass: false, error: 'Invalid property_check conditions' };
    }

    const resourceValue = (resource as any)[property];

    // NULL is "discovery did not read this" (an unknown encryption, public-access or
    // backup state, for instance), not a value. No operator can pass or fail on it:
    // `equals false` must not fail, and `not_equals true` or `not_exists` must not
    // pass, on something nobody observed.
    // `exists` / `not_exists` are the two operators that ask exactly that question
    // ("is this known?"), so they still answer it.
    const asksWhetherKnown = operator === 'exists' || operator === 'not_exists';
    if ((resourceValue === null || resourceValue === undefined) && !asksWhetherKnown) {
      return notEvaluated(`"${property}" is unknown for this resource`);
    }

    let pass = false;

    switch (operator) {
      case 'equals':
      case '==':
        pass = resourceValue === value;
        break;
      case 'not_equals':
      case '!=':
        pass = resourceValue !== value;
        break;
      case 'greater_than':
      case '>':
        pass = resourceValue > value;
        break;
      case 'less_than':
      case '<':
        pass = resourceValue < value;
        break;
      case 'contains':
        pass = String(resourceValue).includes(String(value));
        break;
      case 'not_contains':
        pass = !String(resourceValue).includes(String(value));
        break;
      case 'exists':
        pass = resourceValue !== null && resourceValue !== undefined;
        break;
      case 'not_exists':
        pass = resourceValue === null || resourceValue === undefined;
        break;
      default:
        return { pass: false, error: `Unknown operator: ${operator}` };
    }

    return {
      pass,
      issue: pass ? undefined : `Property "${property}" check failed: ${operator} ${value}`,
      recommendation: rule.recommendation,
    };
  }

  /**
   * Evaluate tag_required rule
   * Conditions: { tag_key: string }
   */
  private evaluateTagRequired(
    rule: ComplianceFrameworkRule,
    resource: AWSResource
  ): RuleEvaluationResult {
    const { tag_key } = rule.conditions;

    if (!tag_key) {
      return { pass: false, error: 'Invalid tag_required conditions - tag_key missing' };
    }

    // Tags that were not read are unknown, not empty: a missing tag cannot be claimed.
    if (!tagsObserved(resource)) return notEvaluated('the tags of this resource could not be read');

    const tagExists = resource.tags && tag_key in resource.tags;

    return {
      pass: tagExists,
      issue: tagExists ? undefined : `Required tag "${tag_key}" is missing`,
      recommendation: rule.recommendation,
    };
  }

  /**
   * Evaluate tag_pattern rule
   * Conditions: { tag_key: string, pattern: string (regex) }
   */
  private evaluateTagPattern(
    rule: ComplianceFrameworkRule,
    resource: AWSResource
  ): RuleEvaluationResult {
    const { tag_key, pattern } = rule.conditions;

    if (!tag_key || !pattern) {
      return { pass: false, error: 'Invalid tag_pattern conditions' };
    }

    if (!tagsObserved(resource)) return notEvaluated('the tags of this resource could not be read');

    const tagValue = resource.tags?.[tag_key];

    if (!tagValue) {
      return {
        pass: false,
        issue: `Tag "${tag_key}" is missing`,
        recommendation: rule.recommendation,
      };
    }

    const regex = new RegExp(pattern);
    const pass = regex.test(String(tagValue));

    return {
      pass,
      issue: pass ? undefined : `Tag "${tag_key}" value "${tagValue}" does not match pattern ${pattern}`,
      recommendation: rule.recommendation,
    };
  }

  /**
   * Evaluate metadata_check rule
   * Conditions: { path: string (JSON path), operator: string, value: any }
   */
  private evaluateMetadataCheck(
    rule: ComplianceFrameworkRule,
    resource: AWSResource
  ): RuleEvaluationResult {
    const { path, operator, value } = rule.conditions;

    if (!path || !operator) {
      return { pass: false, error: 'Invalid metadata_check conditions' };
    }

    // Extract value from metadata using simple path (e.g., "nested.field")
    const pathParts = path.split('.');
    let metadataValue: any = resource.metadata;

    for (const part of pathParts) {
      if (metadataValue && typeof metadataValue === 'object' && part in metadataValue) {
        metadataValue = metadataValue[part];
      } else {
        metadataValue = undefined;
        break;
      }
    }

    // Use same operators as property_check
    let pass = false;

    switch (operator) {
      case 'equals':
        pass = metadataValue === value;
        break;
      case 'not_equals':
        pass = metadataValue !== value;
        break;
      case 'exists':
        pass = metadataValue !== undefined;
        break;
      case 'not_exists':
        pass = metadataValue === undefined;
        break;
      default:
        return { pass: false, error: `Unknown operator: ${operator}` };
    }

    return {
      pass,
      issue: pass ? undefined : `Metadata check failed at path "${path}"`,
      recommendation: rule.recommendation,
    };
  }

  // evaluateCustomScript (rule_type 'custom_script') was removed as part of
  // the Phase 1 security foundation (2026-09): it executed customer-authored
  // JavaScript via an unsandboxed `new Function('resource', script)`, a
  // server-side arbitrary-code-execution risk with no sandbox implemented
  // anywhere in this codebase. 'custom_script' is no longer in the V1 rule
  // vocabulary (see ComplianceRuleType) and is rejected at the API boundary
  // by compliance-frameworks.controller.ts before a rule can ever be created
  // with it. If evaluateRule's switch above is ever reached with a legacy or
  // otherwise-unsupported rule_type value, the `default` branch already
  // fails safely and explicitly (`error: 'Unknown rule type: ...'`) rather
  // than executing anything.

  /**
   * Fetch resources for scanning
   */
  private async fetchResources(
    client: PoolClient,
    organizationId: string,
    filters?: Record<string, any>
  ): Promise<AWSResource[]> {
    // Compliance scan target list — a terminated resource no longer exists to
    // evaluate against the framework's rules.
    const conditions: string[] = ['organization_id = $1', "status != 'terminated'"];
    const values: any[] = [organizationId];
    let paramIndex = 2;

    // Apply filters
    if (filters?.resource_type) {
      conditions.push(`resource_type = $${paramIndex++}`);
      values.push(filters.resource_type);
    }

    if (filters?.region) {
      conditions.push(`region = $${paramIndex++}`);
      values.push(filters.region);
    }

    if (filters?.environment) {
      conditions.push(`environment = $${paramIndex++}`);
      values.push(filters.environment);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const query = `
      SELECT * FROM aws_resources
      ${whereClause}
      ORDER BY created_at DESC
    `;

    const result = await client.query(query, values);
    return result.rows;
  }

  /**
   * Get scan results with findings
   */
  async getScanResults(scanId: string, organizationId: string) {
    const scan = await this.repository.findScanById(scanId);
    if (!scan || scan.organization_id !== organizationId) {
      return null;
    }

    const findings = await this.repository.findFindingsByScan(scanId);

    return {
      scan,
      findings,
    };
  }

  /**
   * Get all scans for an organization
   */
  async getScans(organizationId: string, limit?: number) {
    return this.repository.findScansByOrganization(organizationId, limit);
  }
}
