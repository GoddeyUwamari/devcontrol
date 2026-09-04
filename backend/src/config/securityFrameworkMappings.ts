import { FindingEvidence } from '../types/aws-resources.types';

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

/**
 * Verified against the same authoritative AWS Security Hub CIS crosswalk as
 * the mapping above (docs.aws.amazon.com/securityhub/latest/userguide/
 * cis-aws-foundations-benchmark.html), fetched at the time this was written.
 * CIS AWS Foundations Benchmark v5.0.0, control 1.9 — "MFA should be enabled
 * for all IAM users that have a console password" — is explicitly scoped to
 * users *with a console password*; see getFrameworkMapping's has_login_profile
 * check below, which is what keeps this mapping from being attached to a
 * user whose console-access status isn't confirmed true.
 */
export const CIS_AWS_FOUNDATIONS_V5_IAM_MFA = {
  framework: 'CIS AWS Foundations Benchmark',
  version: '5.0.0',
  control: '1.9',
  title: 'MFA should be enabled for all IAM users that have a console password',
  securityHubControlId: 'IAM.5',
} as const;

/**
 * CIS AWS Foundations Benchmark v5.0.0, control 1.13 — "IAM users' access
 * keys should be rotated every 90 days or less." This measures key age
 * since creation, which is exactly what this detector evaluates. Deliberately
 * NOT mapped to IAM.22 / control 1.11 ("IAM user credentials unused for 45
 * days should be removed") — that control concerns last-used time, a
 * different AWS signal this detector does not evaluate; conflating "old"
 * with "unused" would be an unsupported compliance claim.
 */
export const CIS_AWS_FOUNDATIONS_V5_IAM_ACCESS_KEY_ROTATION = {
  framework: 'CIS AWS Foundations Benchmark',
  version: '5.0.0',
  control: '1.13',
  title: "IAM users' access keys should be rotated every 90 days or less",
  securityHubControlId: 'IAM.3',
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
 * the finding's evidence doesn't match a condition a mapping is verified for.
 *
 * Re-derives the qualifying condition from the evidence itself rather than
 * trusting the finding's title/type alone — same principle as the security-
 * group branch below (which re-checks port/protocol, not just "this was a
 * security-group finding"). For IAM.5 specifically this means: even if a
 * finding's finding_type is 'mfa_not_enabled', no mapping is returned unless
 * evidence.relevant_aws_attributes.has_login_profile is exactly `true` —
 * `false` and `'unknown'` must never be attached to a control whose title is
 * scoped to console-password users.
 *
 * evidence.resource_type distinguishes the IAM variants from
 * SecurityGroupEvidence, which predates this field and has no such
 * discriminant — its branch is unchanged from before this function
 * supported IAM evidence.
 */
export function getFrameworkMapping(evidence: FindingEvidence | null | undefined): FrameworkMapping | null {
  if (!evidence) return null;

  if ('resource_type' in evidence) {
    if (evidence.finding_type === 'mfa_not_enabled') {
      if (evidence.relevant_aws_attributes.has_login_profile !== true) return null;
      if (evidence.relevant_aws_attributes.mfa_device_count > 0) return null;

      const mapping = CIS_AWS_FOUNDATIONS_V5_IAM_MFA;
      return {
        framework: mapping.framework,
        version: mapping.version,
        control: mapping.control,
        title: mapping.title,
        securityHubControlId: mapping.securityHubControlId,
      };
    }

    if (evidence.finding_type === 'access_key_stale') {
      if (evidence.relevant_aws_attributes.age_in_days <= 90) return null;

      const mapping = CIS_AWS_FOUNDATIONS_V5_IAM_ACCESS_KEY_ROTATION;
      return {
        framework: mapping.framework,
        version: mapping.version,
        control: mapping.control,
        title: mapping.title,
        securityHubControlId: mapping.securityHubControlId,
      };
    }

    return null;
  }

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
