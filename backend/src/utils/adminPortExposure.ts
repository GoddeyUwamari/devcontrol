/**
 * Whether a security group opens an administrative or database port to the internet.
 *
 * Used to grade an EC2 instance's public IP address. A public IP alone says the
 * instance is reachable in principle; it is High only when an attached security
 * group has an ingress rule from 0.0.0.0/0 or ::/0 that covers one of
 * ADMIN_DB_PORTS. What is reported is the rule (group, protocol, ports, source),
 * never a claim that anything was accessed.
 *
 * Pure: no AWS call is made here.
 */

/** Remote administration and database ports. A rule open to the internet that covers any of them is High. */
export const ADMIN_DB_PORTS: readonly number[] = [
  22, // SSH
  3389, // RDP
  3306, // MySQL / MariaDB
  5432, // PostgreSQL
  1433, // SQL Server
  1521, // Oracle
  27017, // MongoDB
  6379, // Redis
  9200, // Elasticsearch / OpenSearch
  5601, // Kibana / OpenSearch Dashboards
  11211, // Memcached
];

export const INTERNET_CIDRS: readonly string[] = ['0.0.0.0/0', '::/0'];

/** The fields of an EC2 IpPermission this module reads. */
export interface IngressRule {
  IpProtocol?: string;
  FromPort?: number;
  ToPort?: number;
  IpRanges?: Array<{ CidrIp?: string }>;
  Ipv6Ranges?: Array<{ CidrIpv6?: string }>;
  /** Sources given as managed prefix lists. Their CIDRs are not read here. */
  PrefixListIds?: Array<{ PrefixListId?: string }>;
}

export interface SecurityGroupRules {
  GroupId?: string;
  IpPermissions?: IngressRule[];
}

/** One internet-open rule that covers at least one port of ADMIN_DB_PORTS. */
export interface OpenAdminRule {
  security_group_id: string;
  /** As AWS reports it: 'tcp', 'udp' or '-1' (all protocols). */
  protocol: string;
  /** null for an all-protocols rule, which has no port range. */
  from_port: number | null;
  to_port: number | null;
  cidr: string;
  /** The ports of ADMIN_DB_PORTS the rule covers. */
  admin_ports: number[];
}

/**
 * What is known about an instance's exposure through its security groups.
 *
 *   open_admin_port   an attached group has a rule in `rules`.
 *   not_established   every attached group was read, and no rule allows such a port
 *                     from 0.0.0.0/0 or ::/0. That is all it says: the CIDRs checked
 *                     are exactly those two.
 *   unknown           nothing is claimed either way, because
 *                       security_groups_unreadable  the groups could not be read
 *                         (denied, an error, or a group that was not returned), or
 *                       prefix_list_source  a rule on such a port takes its sources
 *                         from a prefix list, whose CIDRs are not read here and
 *                         could include the internet.
 */
export type NetworkExposure =
  | { state: 'open_admin_port'; rules: OpenAdminRule[] }
  | { state: 'not_established' }
  | { state: 'unknown'; reason: 'security_groups_unreadable' | 'prefix_list_source' };

const ALL_PROTOCOLS = '-1';
// AWS accepts and can return protocol numbers as well as names.
const PORT_PROTOCOLS: Record<string, string> = { tcp: 'tcp', udp: 'udp', '6': 'tcp', '17': 'udp' };

/**
 * The ports of ADMIN_DB_PORTS a rule covers, whatever its source.
 *
 * An all-protocols rule covers every port. A tcp or udp rule covers its
 * FromPort-ToPort range, inclusive. For any other protocol (icmp, icmpv6, a
 * protocol number) FromPort and ToPort are not ports -- for ICMP they are the type
 * and code -- so the rule covers none, whatever the numbers are.
 */
export function adminPortsCovered(rule: IngressRule): number[] {
  const protocol = (rule.IpProtocol ?? '').toLowerCase();
  if (protocol === ALL_PROTOCOLS) return [...ADMIN_DB_PORTS];
  if (!PORT_PROTOCOLS[protocol]) return [];
  const { FromPort: from, ToPort: to } = rule;
  // A tcp/udp rule always carries its range; without one nothing can be established.
  if (typeof from !== 'number' || typeof to !== 'number') return [];
  return ADMIN_DB_PORTS.filter((port) => from <= port && port <= to);
}

/** The internet sources (0.0.0.0/0, ::/0) a rule allows. */
export function internetSources(rule: IngressRule): string[] {
  return [
    ...(rule.IpRanges ?? []).map((range) => range.CidrIp),
    ...(rule.Ipv6Ranges ?? []).map((range) => range.CidrIpv6),
  ].filter((cidr): cidr is string => !!cidr && INTERNET_CIDRS.includes(cidr));
}

/** Whether a rule takes any of its sources from a managed prefix list. */
export function usesPrefixList(rule: IngressRule): boolean {
  return (rule.PrefixListIds ?? []).some((entry) => !!entry.PrefixListId);
}

/** Every internet-open rule of a group that covers an administrative or database port. */
export function openAdminRules(group: SecurityGroupRules): OpenAdminRule[] {
  if (!group.GroupId) return [];
  const found: OpenAdminRule[] = [];
  for (const rule of group.IpPermissions ?? []) {
    const adminPorts = adminPortsCovered(rule);
    if (adminPorts.length === 0) continue;
    const protocol = (rule.IpProtocol ?? '').toLowerCase();
    const allProtocols = protocol === ALL_PROTOCOLS;
    for (const cidr of internetSources(rule)) {
      found.push({
        security_group_id: group.GroupId,
        protocol: allProtocols ? ALL_PROTOCOLS : PORT_PROTOCOLS[protocol],
        from_port: allProtocols ? null : (rule.FromPort as number),
        to_port: allProtocols ? null : (rule.ToPort as number),
        cidr,
        admin_ports: adminPorts,
      });
    }
  }
  return found;
}

/**
 * An instance's exposure, from the groups attached to it.
 *
 * `groups` is every group that was read, by id, or null when they could not be
 * read at all. A verified open rule is reported even when another attached group
 * could not be read: it is evidence on its own. The absence of one is reported
 * only when every attached group was read.
 */
export function evaluateNetworkExposure(
  attachedGroupIds: readonly string[],
  groups: ReadonlyMap<string, SecurityGroupRules> | null
): NetworkExposure {
  if (!groups) return { state: 'unknown', reason: 'security_groups_unreadable' };
  const rules = attachedGroupIds.flatMap((id) => {
    const group = groups.get(id);
    return group ? openAdminRules(group) : [];
  });
  if (rules.length > 0) return { state: 'open_admin_port', rules };
  if (attachedGroupIds.some((id) => !groups.has(id))) return { state: 'unknown', reason: 'security_groups_unreadable' };
  const viaPrefixList = attachedGroupIds.some((id) =>
    (groups.get(id)?.IpPermissions ?? []).some((rule) => adminPortsCovered(rule).length > 0 && usesPrefixList(rule))
  );
  if (viaPrefixList) return { state: 'unknown', reason: 'prefix_list_source' };
  return { state: 'not_established' };
}

/** "tcp 0-65535", "udp 11211", "all protocols". */
export function describeRulePorts(rule: Pick<OpenAdminRule, 'protocol' | 'from_port' | 'to_port'>): string {
  if (rule.protocol === ALL_PROTOCOLS || rule.from_port === null || rule.to_port === null) return 'all protocols and ports';
  return rule.from_port === rule.to_port ? `${rule.protocol} ${rule.from_port}` : `${rule.protocol} ${rule.from_port}-${rule.to_port}`;
}
