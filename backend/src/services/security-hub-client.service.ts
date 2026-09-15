/**
 * Narrow Security Hub API wrapper. Read-only: GetEnabledStandards, DescribeStandards,
 * GetFindings, DescribeStandardsControls. No write operations (no BatchUpdateFindings,
 * no UpdateFindingAggregator) -- none are needed by this feature and none are requested.
 *
 * Deliberately does NOT call BatchGetStandardsControlAssociations or
 * ListFindingAggregators/GetFindingAggregator: the former isn't needed once
 * Compliance.SecurityControlId is read directly off each finding (see
 * SecurityHubFindingEvidence), and aggregation-region discovery is explicitly out of
 * scope for v1 (approved decision) -- this client always operates against the org's
 * single configured `aws_accounts.region`, exactly like every other AWSClientFactory
 * consumer.
 *
 * Credentials: reuses AWSClientFactory.createClients() as-is -- same STS AssumeRole
 * flow, same role_arn/external_id/region lookup, no second credential path, no new
 * caching introduced here.
 */
import {
  SecurityHubClient,
  GetEnabledStandardsCommand,
  DescribeStandardsCommand,
  GetFindingsCommand,
  type Standard,
  type StandardsSubscription,
  type AwsSecurityFinding,
} from '@aws-sdk/client-securityhub';
import { AWSClientFactory } from './aws-client-factory.service';
import {
  SecurityHubCapabilityResult,
  SecurityHubCapabilityStatus,
  SecurityHubFindingEvidence,
  SecurityHubStandardSummary,
} from '../types/security-hub-foundation.types';

const SEVERITY_MAP: Record<string, SecurityHubFindingEvidence['severity']> = {
  CRITICAL: 'critical',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
  INFORMATIONAL: 'informational',
};

/** Classifies a thrown AWS SDK error into the capability taxonomy, never fabricating ENABLED. */
function classifyError(err: unknown): { status: SecurityHubCapabilityStatus; message: string } {
  const name = (err as { name?: string })?.name ?? '';
  const message = err instanceof Error ? err.message : String(err);

  if (name === 'AccessDeniedException' || /AccessDenied|not authorized|UnauthorizedException/i.test(message)) {
    return { status: 'NOT_GRANTED', message };
  }
  // Security Hub returns InvalidAccessException when Security Hub itself isn't enabled
  // for the account/region.
  if (name === 'InvalidAccessException' || /Security Hub.*not (enabled|subscribed)/i.test(message)) {
    return { status: 'NOT_AVAILABLE', message };
  }
  return { status: 'ERROR', message };
}

function normalizeFinding(finding: AwsSecurityFinding): SecurityHubFindingEvidence | null {
  if (!finding.Id || !finding.ProductArn || !finding.CreatedAt || !finding.UpdatedAt) {
    // Malformed response from AWS -- skip rather than store a partially-identified row.
    return null;
  }
  const resource = finding.Resources?.[0];
  return {
    findingId: finding.Id,
    productArn: finding.ProductArn,
    region: finding.Region ?? null,
    title: finding.Title ?? '',
    severity: SEVERITY_MAP[finding.Severity?.Label ?? ''] ?? 'informational',
    complianceStatus: finding.Compliance?.Status ?? null,
    recordState: finding.RecordState === 'ARCHIVED' ? 'ARCHIVED' : 'ACTIVE',
    workflowStatus: finding.Workflow?.Status ?? null,
    securityControlId: finding.Compliance?.SecurityControlId ?? null,
    associatedStandardIds: (finding.Compliance?.AssociatedStandards ?? [])
      .map((s) => s.StandardsId)
      .filter((id): id is string => !!id),
    relatedRequirements: finding.Compliance?.RelatedRequirements ?? [],
    resourceType: resource?.Type ?? null,
    resourceId: resource?.Id ?? null,
    securityHubCreatedAt: finding.CreatedAt,
    securityHubUpdatedAt: finding.UpdatedAt,
    lastSeenAt: new Date().toISOString(),
  };
}

export class SecurityHubClientService {
  /**
   * Cheap capability probe -- one GetEnabledStandards call. Run this before any
   * findings pagination so NOT_GRANTED/NOT_AVAILABLE/ERROR short-circuit early.
   */
  static async checkCapability(client: SecurityHubClient): Promise<SecurityHubCapabilityResult> {
    try {
      await client.send(new GetEnabledStandardsCommand({ MaxResults: 1 }));
      return { status: 'ENABLED', checkedAt: new Date().toISOString(), error: null };
    } catch (err: unknown) {
      const { status, message } = classifyError(err);
      return { status, checkedAt: new Date().toISOString(), error: message };
    }
  }

  /**
   * Enabled standards for this account/region, joined with DescribeStandards for
   * human-readable names. Both calls are cheap/unpaginated in practice (an account has
   * at most a handful of standards enabled) but pagination is still honored rather than
   * assuming a single page.
   */
  static async getEnabledStandards(client: SecurityHubClient): Promise<SecurityHubStandardSummary[]> {
    const subscriptions: StandardsSubscription[] = [];
    let nextToken: string | undefined;
    do {
      const resp = await client.send(new GetEnabledStandardsCommand({ NextToken: nextToken, MaxResults: 100 }));
      subscriptions.push(...(resp.StandardsSubscriptions ?? []));
      nextToken = resp.NextToken;
    } while (nextToken);

    const allStandards: Standard[] = [];
    let standardsNextToken: string | undefined;
    do {
      const resp = await client.send(new DescribeStandardsCommand({ NextToken: standardsNextToken, MaxResults: 100 }));
      allStandards.push(...(resp.Standards ?? []));
      standardsNextToken = resp.NextToken;
    } while (standardsNextToken);

    const nameByArn = new Map(allStandards.map((s) => [s.StandardsArn, s.Name ?? s.StandardsArn ?? '']));

    return subscriptions
      .filter((s): s is StandardsSubscription & { StandardsArn: string; StandardsSubscriptionArn: string } =>
        !!s.StandardsArn && !!s.StandardsSubscriptionArn
      )
      .map((s) => ({
        standardsArn: s.StandardsArn,
        standardsSubscriptionArn: s.StandardsSubscriptionArn,
        name: nameByArn.get(s.StandardsArn) ?? s.StandardsArn,
        enabled: true, // GetEnabledStandards only ever returns subscriptions that exist/are enabled
      }));
  }

  /**
   * Paginated ACTIVE-finding retrieval. Yields one normalized page at a time so the
   * caller (SecurityHubSyncService) can persist incrementally and stop safely on a
   * mid-pagination failure without losing already-fetched pages. Filters server-side to
   * RecordState=ACTIVE only -- archived findings are already resolved by Security Hub
   * itself and are of no evaluation value in v1; see security-hub-sync.service.ts for
   * why this avoids ever needing to auto-resolve findings locally.
   *
   * Bounded by MAX_PAGES as an internal runaway-loop safety valve only (not a product
   * limit on finding volume) -- 100 pages * 100 results/page = 10,000 findings.
   */
  static async *getActiveFindingsPaged(
    client: SecurityHubClient
  ): AsyncGenerator<{ pageIndex: number; findings: SecurityHubFindingEvidence[] }> {
    const MAX_PAGES = 100;
    let nextToken: string | undefined;
    let pageIndex = 0;

    do {
      const resp = await client.send(
        new GetFindingsCommand({
          Filters: {
            RecordState: [{ Value: 'ACTIVE', Comparison: 'EQUALS' }],
          },
          MaxResults: 100,
          NextToken: nextToken,
        })
      );

      const findings = (resp.Findings ?? [])
        .map(normalizeFinding)
        .filter((f): f is SecurityHubFindingEvidence => f !== null);

      yield { pageIndex, findings };

      nextToken = resp.NextToken;
      pageIndex += 1;
    } while (nextToken && pageIndex < MAX_PAGES);
  }
}

export { classifyError as classifySecurityHubError };
