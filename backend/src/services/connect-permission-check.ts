/**
 * The post-connect permission check: one cheap read-only call per capability
 * DevControl relies on, made with the temporary credentials of the connect
 * flow's own AssumeRole. It warns, it never blocks a connection.
 *
 * Each tested operation ends in exactly one of three states:
 *   verified      the call succeeded.
 *   denied        the call failed with an authorization error AWS attributes to
 *                 permissions (AccessDenied, AccessDeniedException,
 *                 UnauthorizedOperation). It may come from the role's policies,
 *                 a permission boundary, a service control policy or an explicit
 *                 deny: the error does not say which.
 *   not_verified  anything else: a timeout, throttling, a service not set up
 *                 (for example no Resource Explorer view), a missing credential,
 *                 or any error that is not an authorization error.
 *
 * It tests the operations listed in PERMISSION_CHECKS and nothing else. It is
 * not an inventory of the role's permissions: service control policies,
 * permission boundaries, resource policies and explicit denies cannot be
 * enumerated, and every other call DevControl makes is untested here. A
 * successful AssumeRole on its own is never reported as verified permissions.
 *
 * ce:GetCostAndUsage is billed by AWS at USD 0.01 per request to the customer's
 * account; this check makes one such request per connect.
 *
 * No result carries an AWS message, ARN, account metadata or credential: only
 * the action name and its state. Errors are logged by name only.
 */
import { EC2Client } from '@aws-sdk/client-ec2';
import { S3Client, ListBucketsCommand } from '@aws-sdk/client-s3';
import { LambdaClient, ListFunctionsCommand, type ListFunctionsCommandOutput } from '@aws-sdk/client-lambda';
import { CloudWatchClient, GetMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { CostExplorerClient, GetCostAndUsageCommand } from '@aws-sdk/client-cost-explorer';
import { ResourceExplorer2Client, SearchCommand } from '@aws-sdk/client-resource-explorer-2';
import type { TemporaryRoleCredentials } from './connect-role-check';
import { describeAccountRegions } from './region-list';
import { projectLambdaFunction } from './aws-response-projections';

export type PermissionStatus = 'verified' | 'denied' | 'not_verified';

/** The IAM actions this check tests, in display order. */
export type CheckedAction =
  | 'ec2:DescribeRegions'
  | 's3:ListAllMyBuckets'
  | 'lambda:ListFunctions'
  | 'cloudwatch:GetMetricData'
  | 'ce:GetCostAndUsage'
  | 'resource-explorer-2:Search';

export interface PermissionCheckEntry {
  action: CheckedAction;
  status: PermissionStatus;
}

export interface PermissionCheckReport {
  /** One entry per action in PERMISSION_CHECKS, in that order. */
  checks: PermissionCheckEntry[];
}

/** A client that can send one command; what each probe needs. */
type Sender = { send: (command: any, options?: { abortSignal?: AbortSignal }) => Promise<unknown> };

/** ListFunctions is typed so its response can go through projectLambdaFunction. */
type LambdaSender = { send: (command: ListFunctionsCommand, options?: { abortSignal?: AbortSignal }) => Promise<ListFunctionsCommandOutput> };

export interface ProbeClients {
  ec2: Sender;
  s3: Sender;
  lambda: LambdaSender;
  cloudWatch: Sender;
  costExplorer: Sender;
  resourceExplorer: Sender;
}

/** A UTC calendar date, YYYY-MM-DD. */
function utcDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

interface Probe {
  action: CheckedAction;
  run: (clients: ProbeClients, signal: AbortSignal, now: number) => Promise<unknown>;
}

/** Thrown by the ec2:DescribeRegions probe so that its outcome takes the same path as every other probe's. */
class RegionListOutcomeError extends Error {
  constructor(denied: boolean) {
    super('DescribeRegions did not succeed');
    this.name = denied ? 'AccessDenied' : 'RegionListFailed';
  }
}

export const PERMISSION_CHECKS: readonly Probe[] = [
  {
    // Through region-list.ts, the one module allowed to call DescribeRegions. Its
    // "denied" is that module's classification (source-outcome.ts isAccessDeniedError).
    action: 'ec2:DescribeRegions',
    run: async (c) => {
      const result = await describeAccountRegions(c.ec2, 'us-east-1');
      if (!result.ok) throw new RegionListOutcomeError(result.reason === 'denied');
    },
  },
  { action: 's3:ListAllMyBuckets', run: (c, signal) => c.s3.send(new ListBucketsCommand({}), { abortSignal: signal }) },
  {
    // ListFunctions is a sanitised response (function configurations): it is
    // read only through its projection, and the result is discarded.
    action: 'lambda:ListFunctions',
    run: async (c, signal) => {
      const page = await c.lambda.send(new ListFunctionsCommand({ MaxItems: 1 }), { abortSignal: signal });
      (page.Functions ?? []).map(projectLambdaFunction);
    },
  },
  {
    // One metric over the last 10 minutes: whatever it returns, only success matters.
    action: 'cloudwatch:GetMetricData',
    run: (c, signal, now) => c.cloudWatch.send(new GetMetricDataCommand({
      StartTime: new Date(now - 10 * 60 * 1000),
      EndTime: new Date(now),
      MetricDataQueries: [{
        Id: 'devcontrolprobe',
        MetricStat: { Metric: { Namespace: 'AWS/EC2', MetricName: 'CPUUtilization' }, Period: 300, Stat: 'Average' },
        ReturnData: true,
      }],
      MaxDatapoints: 1,
    }), { abortSignal: signal }),
  },
  {
    action: 'ce:GetCostAndUsage',
    run: (c, signal, now) => c.costExplorer.send(new GetCostAndUsageCommand({
      TimePeriod: { Start: utcDate(now - 24 * 60 * 60 * 1000), End: utcDate(now) },
      Granularity: 'DAILY',
      Metrics: ['UnblendedCost'],
    }), { abortSignal: signal }),
  },
  { action: 'resource-explorer-2:Search', run: (c, signal) => c.resourceExplorer.send(new SearchCommand({ QueryString: '', MaxResults: 1 }), { abortSignal: signal }) },
];

/** Error names AWS uses for "your permissions do not allow this". Deliberately not every 403. */
const PERMISSION_DENIED_NAMES = new Set(['AccessDenied', 'AccessDeniedException', 'UnauthorizedOperation']);

export function permissionStatusOf(error: unknown): PermissionStatus {
  const e = (error ?? {}) as { name?: unknown; Code?: unknown; code?: unknown };
  return [e.name, e.Code, e.code].some((n) => typeof n === 'string' && PERMISSION_DENIED_NAMES.has(n)) ? 'denied' : 'not_verified';
}

/** Real SDK clients on the connect flow's temporary credentials. Cost Explorer is global (us-east-1). */
export function probeClientsFor(credentials: TemporaryRoleCredentials, region: string): ProbeClients {
  const config = { region, credentials, maxAttempts: 1 };
  return {
    ec2: new EC2Client(config),
    s3: new S3Client(config),
    lambda: new LambdaClient(config),
    cloudWatch: new CloudWatchClient(config),
    costExplorer: new CostExplorerClient({ ...config, region: 'us-east-1' }),
    resourceExplorer: new ResourceExplorer2Client(config),
  };
}

function allNotVerified(): PermissionCheckReport {
  return { checks: PERMISSION_CHECKS.map(({ action }) => ({ action, status: 'not_verified' as const })) };
}

/**
 * Runs every probe at once, each cancelled after `timeoutMs`. Never throws.
 * Without credentials no call is made and every action is not_verified.
 */
export async function runPermissionCheck(params: {
  credentials: TemporaryRoleCredentials | null;
  region: string;
  context: string;
  timeoutMs?: number;
  clients?: ProbeClients;
  now?: () => number;
}): Promise<PermissionCheckReport> {
  if (!params.credentials && !params.clients) return allNotVerified();
  let clients: ProbeClients;
  try {
    clients = params.clients ?? probeClientsFor(params.credentials!, params.region);
  } catch {
    return allNotVerified();
  }
  const timeoutMs = params.timeoutMs ?? 5_000;
  const now = (params.now ?? Date.now)();

  const checks = await Promise.all(PERMISSION_CHECKS.map(async ({ action, run }): Promise<PermissionCheckEntry> => {
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        run(clients, controller.signal, now),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            const timeout = new Error(`permission check exceeded ${timeoutMs} ms`);
            timeout.name = 'TimeoutError';
            reject(timeout);
          }, timeoutMs);
        }),
      ]);
      return { action, status: 'verified' };
    } catch (error: unknown) {
      const status = permissionStatusOf(error);
      const name = (error as { name?: unknown } | null)?.name;
      console.warn(`[Connect AWS] Permission check ${action}: ${status} (${typeof name === 'string' ? name.slice(0, 64) : 'unknown error'}) for ${params.context}`);
      return { action, status };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }));
  return { checks };
}
