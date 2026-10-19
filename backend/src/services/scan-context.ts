/**
 * The account context one discovery scan runs in (multi-region plan M2).
 *
 * One scan, one AssumeRole: discovery and the cost detectors share the
 * clients of one context instead of each assuming the role. The account is
 * the organization's one eligible account (AWSClientFactory.createClients(),
 * aws-accounts.repository.ts), so with more than one the scan never starts.
 *
 * A scan can run past the assumed role's one-hour session. Every client the
 * context hands out first checks the credentials and, when less than
 * CREDENTIAL_REFRESH_WINDOW_MS remain, assumes the same role once more and
 * replaces the values of the one credentials object all of them sign with. A
 * failed refresh is classified exactly as createClients() classifies the
 * first AssumeRole, and is not retried for the rest of the scan.
 *
 * Only the home region is scanned until multi-region scanning (M7):
 * clientsFor() refuses any other region.
 */
import { AWSClientFactory, AWSClients, AssumedRoleSource, assumedRoleSourceOf } from './aws-client-factory.service';

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

export class ScanContext {
  private readonly home: AWSClients;
  private refreshing: Promise<void> | undefined;
  private refreshFailure: unknown;

  private constructor(
    readonly organizationId: string,
    clients: AWSClients,
    private readonly source: AssumedRoleSource | undefined
  ) {
    this.home = source ? this.withRefresh(clients) : clients;
  }

  /** The context of the organization's one eligible account. */
  static async forOrg(organizationId: string): Promise<ScanContext> {
    const clients = await AWSClientFactory.createClients(organizationId);
    return new ScanContext(organizationId, clients, assumedRoleSourceOf(clients));
  }

  /** The account's home region: aws_accounts.region, or us-east-1. */
  get region(): string {
    return this.home.region;
  }

  /** The 12-digit AWS account ID, parsed from the role ARN, when it has one. */
  get accountId(): string | undefined {
    return this.home.accountId;
  }

  /** The clients for `region`. Only the home region is scanned before M7. */
  clientsFor(region: string): AWSClients {
    if (region !== this.home.region) {
      throw new Error(`SCAN_REGION_UNSUPPORTED: org ${this.organizationId} scans only its home region ${this.home.region}, not ${region}`);
    }
    return this.home;
  }

  /** Assumes the role again when the credentials are within the refresh window of expiring. */
  async ensureFreshCredentials(): Promise<void> {
    const source = this.source;
    if (this.refreshFailure !== undefined) throw this.refreshFailure;
    if (!source?.expiration) return;
    if (source.expiration.getTime() - Date.now() > CREDENTIAL_REFRESH_WINDOW_MS) return;

    if (!this.refreshing) {
      this.refreshing = (async () => {
        try {
          const fresh = await AWSClientFactory.assumeAccountRole(source.organizationId, source.account, source.region);
          Object.assign(source.credentials, fresh.credentials);
          source.expiration = fresh.expiration;
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
