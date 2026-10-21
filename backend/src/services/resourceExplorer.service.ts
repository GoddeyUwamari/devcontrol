/**
 * AWS Resource Explorer — generic inventory/discovery layer (Phase 2B).
 *
 * Replaces the old Describe*-based discovery for resource types that aren't
 * deep-monitored (see DEEP_MONITORED_CFN_TYPES below). Resource Explorer's
 * Search only returns {arn, type, region, service, tags} — no per-resource
 * config (encryption, public access, capacity, etc.) — so generically
 * discovered resources carry thinner metadata than the old Describe*-based
 * rows did. That's an accepted tradeoff of this architecture, not a bug.
 *
 * This service never throws: `search()` returns a discriminated union so
 * callers can tell "confirmed nothing found" apart from "the query itself
 * failed" — that distinction is what the conservative reconciliation state
 * machine (resourceReconciliation.service.ts) depends on.
 */
import { ResourceExplorer2Client, SearchCommand, Resource as REResource } from '@aws-sdk/client-resource-explorer-2';
import { ResourceType, TagsState } from '../types/aws-resources.types';
import { listAllPages } from '../utils/awsCallPolicy';

/**
 * Resource types whose deep CloudWatch monitoring (see cloudwatch.service.ts's
 * resourceTypeRegistry) depends on rich fields — status, instance/engine
 * metadata — that only the original Describe*-based discovery populates.
 * Resource Explorer results for these types are used for presence/reconciliation
 * only; they are never upserted as inventory rows by this service.
 */
export const DEEP_MONITORED_CFN_TYPES: Partial<Record<string, ResourceType>> = {
  'AWS::EC2::Instance': 'ec2',
  'AWS::RDS::DBInstance': 'rds',
  'AWS::ElasticLoadBalancingV2::LoadBalancer': 'load-balancer',
  'AWS::Lambda::Function': 'lambda',
};

/**
 * Resource types with their OWN dedicated Describe*-/List*-based discovery method
 * (like DEEP_MONITORED_CFN_TYPES, but for coverage/fidelity reasons rather than
 * CloudWatch monitoring needs) — Resource Explorer results for these types are
 * used for presence/reconciliation only, never upserted generically:
 *
 * - S3: `ListBuckets` is account-wide and region-independent; Resource Explorer's
 *   Search is scoped to a single region's LOCAL index (no aggregator index exists
 *   — see aws_resource_explorer_phase0_findings memory), so a generic search from
 *   the org's configured region would miss buckets physically located elsewhere.
 *   `discoverS3Buckets` also fetches real encryption/public-access state via the
 *   S3 API directly, which Resource Explorer's {arn, type, region, tags} shape
 *   can't provide.
 * - CloudFront: live-verified (via a truly-global IAM resource appearing only in
 *   the us-east-1 index and nowhere else) that Resource Explorer indexes
 *   global-service resources exclusively through the us-east-1 index, regardless
 *   of which region's index is searched. `discoverCloudFrontDistributions`
 *   force-pins its client to us-east-1 for exactly this reason; a generic search
 *   scoped to the org's configured region would silently return zero CloudFront
 *   distributions for any org whose region isn't us-east-1.
 */
export const OWN_DISCOVERY_CFN_TYPES: Partial<Record<string, ResourceType>> = {
  'AWS::S3::Bucket': 's3',
  'AWS::CloudFront::Distribution': 'cloudfront',
};

/**
 * Resource types this service treats as "generic inventory" — populated
 * directly from Resource Explorer Search results. Keyed by CfnResourceType,
 * the most stable identifier Resource Explorer returns (live-verified against
 * test account 123456789012: AWS::EC2::VPC and AWS::SNS::Topic matched exactly
 * this format; other entries here follow the same documented AWS::Service::Type
 * convention but weren't all present in that account to verify live).
 *
 * S3 and CloudFront are deliberately NOT here — see OWN_DISCOVERY_CFN_TYPES.
 *
 * AWS::RDS::DBCluster maps to 'aurora' as a best-effort approximation —
 * Resource Explorer doesn't surface engine family, so a non-Aurora Multi-AZ
 * RDS cluster (rare) would also land here. The old discoverAuroraClusters
 * Describe*-based method could filter on Engine; this can't.
 */
export const GENERIC_CFN_TYPE_MAP: Record<string, ResourceType> = {
  'AWS::ECS::Service': 'ecs',
  'AWS::EC2::VPC': 'vpc',
  'AWS::EKS::Cluster': 'eks',
  'AWS::DynamoDB::Table': 'dynamodb',
  'AWS::ApiGateway::RestApi': 'api-gateway',
  'AWS::ElastiCache::CacheCluster': 'elasticache',
  'AWS::RDS::DBCluster': 'aurora',
  'AWS::SQS::Queue': 'sqs',
  'AWS::SNS::Topic': 'sns',
};

export const GENERIC_RESOURCE_TYPES: ResourceType[] = Array.from(new Set(Object.values(GENERIC_CFN_TYPE_MAP)));

/**
 * Every resource type the single-region Resource Explorer Search pass is a valid
 * presence signal for: the deep-monitored types (their own discovery supplies content,
 * RE only supplies presence) plus the generic types (RE supplies both). Deliberately
 * excludes S3 and CloudFront, which get their own independent reconcile() calls in
 * awsResourceDiscovery.ts using their own dedicated discovery's ARN list instead —
 * see OWN_DISCOVERY_CFN_TYPES.
 */
export const RE_RECONCILED_TYPES: ResourceType[] = [
  ...Object.values(DEEP_MONITORED_CFN_TYPES) as ResourceType[],
  ...GENERIC_RESOURCE_TYPES,
];

export interface NormalizedResourceEntry {
  arn: string;
  resourceType: ResourceType;
  region: string;
  service: string | undefined;
  tags: Record<string, string>;
  /** 'unavailable' when the result carried no tags property: the tags are then unknown, not empty. */
  tagsState: TagsState;
}

/**
 * The most results one Search returns, however many pages it spans ("The operation can
 * return only the first 1,000 results", SearchInput.QueryString in the SDK's model docs).
 * A result that reaches it may have been cut off.
 */
export const SEARCH_RESULT_LIMIT = 1000;

/**
 * `complete: false` means the search succeeded but may not hold every matching resource:
 * AWS reported its count as not exhaustive (Count.Complete false), or the result reached
 * SEARCH_RESULT_LIMIT, or the search stopped at listAllPages' page limit. Its resources are real, but a resource missing from it is not
 * evidence of absence, so it must never drive reconciliation.
 */
export type SearchResult =
  | { success: true; resources: REResource[]; complete: boolean }
  | { success: false; error: string };

export interface NormalizedSearchResult {
  /** Every ARN Resource Explorer returned, deep-monitored and generic alike — the presence
   * signal reconciliation needs to decide what's still there vs. missing. */
  allArns: Set<string>;
  /** Only the types this service treats as generic inventory, normalized for upserting. */
  genericEntries: NormalizedResourceEntry[];
}

export class ResourceExplorerService {
  /**
   * Searches the connected account's Resource Explorer index for the given region.
   * Never throws — a failed/errored call (no index/view provisioned, throttling,
   * permission error, network failure, a failure partway through pagination, etc.)
   * comes back as `{ success: false }` so callers never mistake "the query broke"
   * for "the query succeeded and found nothing." A successful search that may have
   * been cut off comes back with `complete: false` (see SearchResult).
   */
  async search(client: ResourceExplorer2Client, region: string): Promise<SearchResult> {
    try {
      let countIncomplete = false;
      const listing = await listAllPages('Resource Explorer: Search', async (token) => {
        const page = await client.send(new SearchCommand({ QueryString: '', NextToken: token }));
        if (page.Count?.Complete === false) countIncomplete = true;
        return { items: page.Resources || [], nextToken: page.NextToken };
      });
      const resources: REResource[] = listing.items;
      const complete = listing.complete && !countIncomplete && resources.length < SEARCH_RESULT_LIMIT;
      if (!complete) {
        console.error(
          `[ResourceExplorer] Search in region ${region} may be truncated ` +
            `(${resources.length} results, count ${countIncomplete ? 'not exhaustive' : 'at the result limit'})`
        );
      }
      return { success: true, resources, complete };
    } catch (error: any) {
      console.error(`[ResourceExplorer] Search failed for region ${region}:`, error.message);
      return { success: false, error: error.message || 'Unknown Resource Explorer error' };
    }
  }

  /**
   * Normalizes raw Search results into the full ARN presence set (for reconciliation)
   * and the subset of generic-inventory entries (for upserting into aws_resources).
   */
  normalize(resources: REResource[], fallbackRegion: string): NormalizedSearchResult {
    const allArns = new Set<string>();
    const genericEntries: NormalizedResourceEntry[] = [];

    for (const resource of resources) {
      if (!resource.Arn) continue;
      allArns.add(resource.Arn);

      const cfnType = resource.CfnResourceType;
      if (!cfnType || DEEP_MONITORED_CFN_TYPES[cfnType] || OWN_DISCOVERY_CFN_TYPES[cfnType]) continue;

      const resourceType = GENERIC_CFN_TYPE_MAP[cfnType];
      if (!resourceType) continue;

      const tags = this.extractTags(resource);
      genericEntries.push({
        arn: resource.Arn,
        resourceType,
        region: resource.Region || fallbackRegion,
        service: resource.Service,
        tags: tags ?? {},
        tagsState: tags ? 'observed' : 'unavailable',
      });
    }

    return { allArns, genericEntries };
  }

  /**
   * Resource Explorer inlines tags as a Properties entry named "tags" (lowercase,
   * live-verified) whose Data is an array of {Key, Value} pairs — the same shape
   * DescribeTags-family calls return elsewhere in this codebase.
   *
   * Returns null when the result carries no such property (or one that is not a
   * list): the tags were not reported, which is not the same as there being none.
   * An empty list is a resource with no tags.
   */
  private extractTags(resource: REResource): Record<string, string> | null {
    const tagsProperty = (resource.Properties || []).find((p) => p.Name === 'tags');
    const data = tagsProperty?.Data;
    if (!Array.isArray(data)) return null;

    return data.reduce((acc: Record<string, string>, tag: any) => {
      if (tag?.Key && tag?.Value) acc[tag.Key] = tag.Value;
      return acc;
    }, {});
  }

  /**
   * Derives a stable resource_id from an ARN: everything after the last '/' or
   * ':', whichever is further right. Matches the id every existing per-type
   * discovery method already extracted (bucket name, cluster id, function name,
   * etc.) without needing a per-type parser.
   */
  extractResourceId(arn: string): string {
    const lastSlash = arn.lastIndexOf('/');
    const lastColon = arn.lastIndexOf(':');
    const idx = Math.max(lastSlash, lastColon);
    return idx >= 0 ? arn.slice(idx + 1) : arn;
  }
}
