/**
 * The account context one discovery scan runs in (multi-region plan M2).
 *
 * One scan, one AssumeRole: discovery and the cost detectors share the
 * clients of one context instead of each assuming the role. The account is
 * the organization's one eligible account (AWSClientFactory.createClients(),
 * aws-accounts.repository.ts), so with more than one the scan never starts.
 * The context carries that account explicitly: the aws_accounts row id and
 * the 12-digit AWS account ID from its role ARN, read from the row
 * createClients() recorded. Without that record, an ARN that does not
 * parse, or credentials with no expiry, the scan fails closed before any
 * call with the clients.
 *
 * A scan can run past the assumed role's one-hour session. Every client the
 * context hands out first checks the credentials and, when less than
 * CREDENTIAL_REFRESH_WINDOW_MS remain, assumes the same role once more and
 * replaces the values of the one credentials object all of them sign with. A
 * failed refresh is classified exactly as createClients() classifies the
 * first AssumeRole, and is not retried for the rest of the scan.
 *
 * clientsFor() hands out the home region's clients, and those of any region the
 * scan was allowed with allowRegions() (multi-region PR 1: the enabled regions of
 * the account's region list, when the organization's multi_region_discovery flag is
 * on). Any other region is refused. Another region's clients are built from the
 * same credentials object (AWSClientFactory.buildClients), so they need no AssumeRole
 * of their own and every refresh reaches them too.
 *
 * Every AssumeRole made here (the first and each refresh) is recorded as the
 * connection's health (AWS connect PR D1, connection-health-recorder.ts),
 * fail-soft: a failed record never fails or changes the scan.
 */
import { awsConnectionIdentity } from '../repositories/aws-accounts.repository';
import { AWSClientFactory, AWSClients, AssumedRoleSource, assumedRoleSourceOf, parseAccountIdFromArn } from './aws-client-factory.service';
import * as healthRecorder from './connection-health-recorder';

/** Credentials are refreshed when less than this remains before they expire. */
export const CREDENTIAL_REFRESH_WINDOW_MS = 10 * 60 * 1000;

const REFRESH_MIDDLEWARE = 'devcontrolScanCredentialRefresh';

type MiddlewareClient = {
  middlewareStack: {
    add: (middleware: (next: (args: unknown) => Promise<unknown>) => (args: unknown) => Promise<unknown>, options: Record<string, unknown>) => void;
  };
};

function hasMiddlewareStack(value: unknown): value is MiddlewareClient {
  return typeof (value as MiddlewareClient | null)?.middlewareStack?.add === 'function';
}

/** The scan cannot be bound to an account with refreshable credentials. */
export const SCAN_CONTEXT_UNAVAILABLE = 'SCAN_CONTEXT_UNAVAILABLE';

export class ScanContext {
  /** aws_accounts.id of the account this scan runs in. */
  readonly awsAccountRowId: string;
  /** The 12-digit AWS account ID, from the account's role ARN. */
  readonly awsAccountId: string;
  /**
   * The connection this scan belongs to: awsConnectionIdentity of the very row
   * its clients were built from (aws-connection-fence.ts). Its lease carries it,
   * and every cache entry the scan fills is keyed by it.
   */
  readonly connectionIdentity: string;
  /** The role ARN of that row (the policy compare, AWS connect PR D1). */
  readonly roleArn: string;
  private readonly home: AWSClients;
  /** Regions other than the home region this scan may make calls in, and their clients once built. */
  private readonly allowed = new Map<string, AWSClients | undefined>();
  private refreshing: Promise<void> | undefined;
  private refreshFailure: unknown;

  private constructor(
    readonly organizationId: string,
    clients: AWSClients,
    private readonly source: AssumedRoleSource,
    awsAccountId: string
  ) {
    this.awsAccountRowId = source.account.id;
    this.awsAccountId = awsAccountId;
    this.connectionIdentity = awsConnectionIdentity(source.account);
    this.roleArn = source.account.role_arn;
    this.home = this.withRefresh(clients);
  }

  /** The context of the organization's one eligible account. */
  static async forOrg(organizationId: string): Promise<ScanContext> {
    let clients: AWSClients;
    try {
      clients = await AWSClientFactory.createClients(organizationId);
    } catch (error: unknown) {
      await healthRecorder.recordScanAssumeFailure(organizationId, error);
      throw error;
    }
    const source = assumedRoleSourceOf(clients);
    if (source) {
      await healthRecorder.recordScanAssumeSuccess({
        organizationId,
        account: source.account,
        attemptedAt: source.attemptedAt,
        roleUniqueId: source.roleUniqueId ?? null,
        iam: clients.iam,
      });
    }
    const unavailable = (reason: string) =>
      new Error(`${SCAN_CONTEXT_UNAVAILABLE}: org ${organizationId} ${reason}; the scan was not started`);

    if (!source) throw unavailable('has no recorded account for its clients');
    if (!source.account.id) throw unavailable('has an account row without an id');
    const awsAccountId = parseAccountIdFromArn(source.account.role_arn);
    if (!awsAccountId) throw unavailable("has a role ARN that names no 12-digit AWS account");
    if (!source.expiration) throw unavailable('has credentials with no expiry, which could not be refreshed');
    return new ScanContext(organizationId, clients, source, awsAccountId);
  }

  /** The account's home region: aws_accounts.region, or us-east-1. */
  get region(): string {
    return this.home.region;
  }

  /**
   * Lets this scan make calls in `regions` (multi-region PR 1). The caller passes the
   * enabled regions of the account's own region list, never a static list.
   */
  allowRegions(regions: readonly string[]): void {
    for (const region of regions) {
      if (region !== this.home.region && !this.allowed.has(region)) this.allowed.set(region, undefined);
    }
  }

  /** The clients for `region`: the home region, or a region allowRegions() allowed. */
  clientsFor(region: string): AWSClients {
    if (region === this.home.region) return this.home;
    if (!this.allowed.has(region)) {
      throw new Error(`SCAN_REGION_UNSUPPORTED: org ${this.organizationId} is not scanning region ${region}`);
    }
    let clients = this.allowed.get(region);
    if (!clients) {
      clients = this.withRefresh(AWSClientFactory.buildClients(region, this.source.credentials, this.home.accountId));
      this.allowed.set(region, clients);
    }
    return clients;
  }

  /** Assumes the role again when the credentials are within the refresh window of expiring. */
  async ensureFreshCredentials(): Promise<void> {
    const source = this.source;
    if (this.refreshFailure !== undefined) throw this.refreshFailure;
    if (source.expiration && source.expiration.getTime() - Date.now() > CREDENTIAL_REFRESH_WINDOW_MS) return;

    if (!this.refreshing) {
      this.refreshing = (async () => {
        try {
          let fresh: Awaited<ReturnType<typeof AWSClientFactory.assumeAccountRole>>;
          try {
            fresh = await AWSClientFactory.assumeAccountRole(source.organizationId, source.account, source.region);
          } catch (error: unknown) {
            await healthRecorder.recordScanAssumeFailure(source.organizationId, error);
            throw error;
          }
          const recorded = await healthRecorder.recordScanAssumeSuccess({
            organizationId: source.organizationId,
            account: source.account,
            attemptedAt: fresh.attemptedAt,
            roleUniqueId: fresh.roleUniqueId,
          });
          if (!fresh.expiration) {
            throw new Error(`${SCAN_CONTEXT_UNAVAILABLE}: org ${source.organizationId} refreshed credentials have no expiry`);
          }
          Object.assign(source.credentials, fresh.credentials);
          source.expiration = fresh.expiration;
          // A role replaced since the last recorded AssumeRole (D1-D7, review L-2): compared once,
          // like a replacement seen by forOrg. Only now, with the fresh credentials and expiry in
          // place, so the IAM call's own credential check passes instead of re-entering this refresh
          // (skipped, never awaited into a cycle, if AWS granted less than the refresh window).
          if (recorded.roleReplacedNow && fresh.expiration.getTime() - Date.now() > CREDENTIAL_REFRESH_WINDOW_MS) {
            await healthRecorder.compareAfterRoleReplacement({ organizationId: source.organizationId, account: source.account, iam: this.home.iam });
          }
        } catch (err: unknown) {
          this.refreshFailure = err;
          throw err;
        }
      })().finally(() => {
        this.refreshing = undefined;
      });
    }
    await this.refreshing;
  }

  /** The same clients, each checking the credentials before every request. */
  private withRefresh(clients: AWSClients): AWSClients {
    const attach = <T>(client: T): T => {
      if (hasMiddlewareStack(client)) {
        client.middlewareStack.add(
          (next) => async (args) => {
            await this.ensureFreshCredentials();
            return next(args);
          },
          { step: 'initialize', name: REFRESH_MIDDLEWARE, override: true }
        );
      }
      return client;
    };

    for (const value of Object.values(clients)) attach(value);
    const regional = <T>(build?: (region: string) => T) => build && ((region: string) => attach(build(region)));

    return {
      ...clients,
      getDynamoDBClientForRegion: regional(clients.getDynamoDBClientForRegion)!,
      getApplicationAutoScalingClientForRegion: regional(clients.getApplicationAutoScalingClientForRegion)!,
      getCloudWatchClientForRegion: regional(clients.getCloudWatchClientForRegion)!,
      getS3ClientForRegion: regional(clients.getS3ClientForRegion),
    };
  }
}
