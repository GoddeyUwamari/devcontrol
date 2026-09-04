import { SecurityGroupEvidence } from '../types/aws-resources.types';

/**
 * Deliberately a single, narrow, static mapping — not a compliance engine.
 *
 * Verified against AWS's own current CIS↔Security-Hub-control crosswalk
 * (docs.aws.amazon.com/securityhub/latest/userguide/cis-aws-foundations-benchmark.html)
 * at the time this was written. CIS AWS Foundations Benchmark v5.0.0 is the
 * version AWS currently recommends. Controls 5.3 (IPv4) / 5.4 (IPv6) —
 * "Ensure no security groups allow ingress from 0.0.0.0/0 / ::/0 to remote
 * server administration ports" — superseded the older v1.2.0 controls 4.1
 * (SSH-only) and 4.2 (RDP-only), which no longer exist as separate controls
 * in any currently-supported benchmark version.
 *
 * This mapping is intentionally restricted to SSH (22) and RDP (3389): those
 * are the two ports this control's title and every version of its official
 * description unambiguously names as "remote server administration ports."
 * A finding for some other unrestricted TCP port gets no framework claim —
 * inventing one without an authoritative source would be exactly the kind of
 * unsupported compliance claim this feature must not make.
 */
export const CIS_AWS_FOUNDATIONS_V5_ADMIN_PORT_INGRESS = {
  framework: 'CIS AWS Foundations Benchmark',
  version: '5.0.0',
  title:
    'Ensure no security groups allow ingress from 0.0.0.0/0 or ::/0 to remote server administration ports',
  controls: {
    v4: '5.3',
    v6: '5.4',
  },
  securityHubControlId: {
    v4: 'EC2.53',
    v6: 'EC2.54',
  },
} as const;

export interface FrameworkMapping {
  framework: string;
  version: string;
  control: string;
  title: string;
  securityHubControlId: string;
}

const ADMIN_PORTS = [22, 3389];

// SSH/RDP — and therefore this control — are TCP-only. AWS's protocol "-1" ("all
// protocols") genuinely includes TCP, so it's treated the same as an explicit "tcp"
// match; a rule for "udp" or any other specific non-TCP protocol that happens to
// number-match one of these ports is not actually SSH/RDP exposure and must not
// receive this mapping — see complianceScanner.ts's buildUnrestrictedIngressIssue
// for the matching classification logic this mirrors.
function isTcpCapableProtocol(protocol: string): boolean {
  return protocol === 'tcp' || protocol === '-1';
}

function coversAdminPort(protocol: string, fromPort: number, toPort: number): boolean {
  return isTcpCapableProtocol(protocol) && ADMIN_PORTS.some((port) => fromPort <= port && toPort >= port);
}

/**
 * Returns the one verified framework mapping for this finding, or null if
 * the finding's evidence doesn't match a port/protocol this mapping is verified for.
 */
export function getFrameworkMapping(evidence: SecurityGroupEvidence | null | undefined): FrameworkMapping | null {
  if (!evidence) return null;
  if (evidence.direction !== 'ingress') return null;
  if (!coversAdminPort(evidence.protocol, evidence.from_port, evidence.to_port)) return null;

  const mapping = CIS_AWS_FOUNDATIONS_V5_ADMIN_PORT_INGRESS;
  const ipKey = evidence.ip_version === 'v6' ? 'v6' : 'v4';

  return {
    framework: mapping.framework,
    version: mapping.version,
    control: mapping.controls[ipKey],
    title: mapping.title,
    securityHubControlId: mapping.securityHubControlId[ipKey],
  };
}
