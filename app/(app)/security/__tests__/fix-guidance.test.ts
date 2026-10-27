import { describe, it, expect } from 'vitest'
import type { AccountSecurityFinding } from '@/lib/services/account-security-findings.service'
import {
  GUIDANCE_KEYS,
  WEB_SERVER_HINT,
  buildHttpsOnlyStatement,
  guidanceFor,
  guidanceKeyForAccountFinding,
  guidanceKeyForResourceIssue,
  isOneStatement,
  sgPortClass,
} from '../overview/fixGuidance'

/**
 * The founder-approved wording (Oct 26, 2026), copied from the approval record, not
 * from fixGuidance.ts, so any change to the shipped text fails here.
 */
const APPROVED: [string, Record<string, string>][] = [
  ["sg_open_admin", {
    "title": "Remote-admin port open to the internet",
    "whyItMatters": "Remote-admin ports open to the whole internet are scanned constantly; a weak or leaked credential becomes a way in.",
    "nextStep": "Limit the source to specific IP ranges, or remove the rule once you have another way in. Session Manager or a VPN can give admin access without an open port, once you've confirmed it works for this instance.",
    "fixRisk": "Anyone connecting from outside the allowed range loses access. Keep the current rule until the alternative is tested."
  }],
  ["sg_open_web", {
    "title": "Web port open to the internet",
    "whyItMatters": "Anyone on the internet can reach this port. That's expected for a public web server or load balancer, and unnecessary exposure for anything else.",
    "nextStep": "If this resource serves public web traffic, accept the risk and record why. If not, limit the source to known ranges or to a load balancer's security group.",
    "fixRisk": "Narrowing the source blocks visitors and services outside the allowed ranges. Check what depends on this port first."
  }],
  ["sg_open_other", {
    "title": "Port open to the internet",
    "whyItMatters": "An open port exposes whatever service listens on it, and many services aren't built to face the internet directly.",
    "nextStep": "Check which service uses this port. Remove the rule if nothing needs it; otherwise limit the source to the addresses or security groups that do.",
    "fixRisk": "Clients outside the new range lose access. Review the affected resource before changing the rule."
  }],
  ["iam_no_mfa_console", {
    "title": "Console user without MFA",
    "whyItMatters": "This user can sign in to the AWS console with a password alone; a leaked or guessed password is enough to get in.",
    "nextStep": "If the user still needs the console, assign an MFA device. If not, remove its console password; that doesn't affect the user's access keys, which are a separate risk to review.",
    "fixRisk": "Adding MFA is usually a small change. Removing console access can break workflows that rely on it, so check who uses this sign-in first."
  }],
  ["iam_no_mfa_unknown", {
    "title": "User without MFA (console access unknown)",
    "whyItMatters": "This user has no MFA device, and we couldn't confirm whether it can sign in to the console.",
    "nextStep": "Check the user's console access in IAM. If it has a password, assign MFA or remove console access.",
    "fixRisk": "Review the user first; removing console access can break workflows that rely on it."
  }],
  ["iam_key_stale", {
    "title": "Access key older than 90 days",
    "whyItMatters": "Long-lived keys are a common source of leaks. Age alone doesn't mean this key is compromised or unused, but the longer a key lives, the more places it may have been copied to.",
    "nextStep": "List what uses the key (IAM shows when and where it was last used). Move those workloads to roles where practical; otherwise issue a new key, switch each workload over and test it. Then deactivate the old key, check that nothing breaks, and delete it.",
    "fixRisk": "Anything still using the old key fails once it's deactivated; deactivating first lets you turn it back on."
  }],
  ["s3_https_only", {
    "title": "S3 bucket accepts HTTP",
    "whyItMatters": "The bucket accepts requests over plain HTTP, so data can travel unencrypted.",
    "nextStep": "Review the bucket's existing policy, then add a statement that denies requests where aws:SecureTransport is false.",
    "fixRisk": "Clients still using HTTP will start failing. This is one statement to merge into the existing policy, not a complete policy; replacing the policy with it would remove your existing permissions.",
    "policyStatementTemplate": "{\"Sid\":\"DenyInsecureTransport\",\"Effect\":\"Deny\",\"Principal\":\"*\",\"Action\":\"s3:*\",\"Resource\":[\"arn:aws:s3:::{bucket}\",\"arn:aws:s3:::{bucket}/*\"],\"Condition\":{\"Bool\":{\"aws:SecureTransport\":\"false\"}}}"
  }],
  ["s3_public_policy", {
    "title": "Bucket policy allows public access",
    "whyItMatters": "The bucket policy has a statement that grants access to everyone. Depending on the actions it allows and the account's Block Public Access settings, that may make objects publicly accessible.",
    "nextStep": "Review the public statement, the bucket's purpose and its effective Block Public Access settings. If public access isn't intended, remove or narrow the statement, then consider turning on Block Public Access.",
    "fixRisk": "Public access is sometimes intentional (static websites, public downloads); removing it, or turning on Block Public Access, stops those from working."
  }],
  ["s3_public_acl", {
    "title": "Bucket ACL grants access to everyone",
    "whyItMatters": "An access list on this bucket grants access to everyone or to all AWS users. Whether that exposes data depends on the grant and on the Block Public Access settings.",
    "nextStep": "Review the grant and the bucket's purpose. If public access isn't intended, remove the grant. Switching the bucket to \"bucket owner enforced\" (ACLs disabled) is an option once you've confirmed nothing relies on ACLs.",
    "fixRisk": "Anything relying on the grant stops working; disabling ACLs affects every ACL on the bucket and its objects."
  }],
]

describe('the approved guidance', () => {
  it('has exactly the nine approved keys, in the approved order', () => {
    expect([...GUIDANCE_KEYS]).toEqual(APPROVED.map(([key]) => key))
  })

  it.each(APPROVED)('%s matches the approved text word for word', (key, approved) => {
    expect({ ...guidanceFor(key) }).toEqual(approved)
  })

  it("entry 4's risk carries the approved edit", () => {
    expect(guidanceFor('iam_no_mfa_console')?.fixRisk).toBe(
      'Adding MFA is usually a small change. Removing console access can break workflows that rely on it, so check who uses this sign-in first.',
    )
    expect(guidanceFor('iam_no_mfa_console')?.fixRisk).not.toContain('next sign-in')
  })

  it('only s3_https_only has a policy statement', () => {
    for (const key of GUIDANCE_KEYS) {
      expect(guidanceFor(key)?.policyStatementTemplate !== undefined, key).toBe(key === 's3_https_only')
    }
  })

  it('says "public" only for the two public-access checks, and never "readable" or "writable"', () => {
    for (const key of GUIDANCE_KEYS) {
      const g = guidanceFor(key)!
      const text = [g.title, g.whyItMatters, g.nextStep, g.fixRisk].join(' ').toLowerCase()
      if (key !== 's3_public_policy' && key !== 's3_public_acl') expect(text, key).not.toMatch(/\bpublic\b(?! web)/)
      expect(text, key).not.toMatch(/readable|writable/)
    }
  })

  it('never calls an open web port unsafe in itself', () => {
    const g = guidanceFor('sg_open_web')!
    expect([g.title, g.whyItMatters, g.nextStep, g.fixRisk].join(' ')).not.toMatch(/unsafe|insecure|dangerous/i)
    expect(WEB_SERVER_HINT).toBe('Expected for a web server? Accept the risk with a reason.')
  })
})

describe('a missing or unknown guidance ID has no guidance', () => {
  it.each([undefined, null, '', 'sg_open_ssh', 'S3_HTTPS_ONLY', 'sg_open_admin ', 's3.https_only', 'constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf', 42, {}])(
    '%j → undefined',
    (key) => {
      expect(guidanceFor(key)).toBeUndefined()
    },
  )
})

// ── Which issue a finding is ──

const sg = (protocol: unknown, from: unknown, to: unknown) => ({ protocol, from_port: from, to_port: to })

describe('security-group port class (M3, decision 11)', () => {
  it.each([
    ['all protocols "-1"', sg('-1', 0, 65535), 'sg_open_admin'],
    ['all protocols -1 (number)', sg(-1, -1, -1), 'sg_open_admin'],
    ['TCP 22', sg('tcp', 22, 22), 'sg_open_admin'],
    ['TCP 3389', sg('tcp', 3389, 3389), 'sg_open_admin'],
    ['TCP 0-65535 (covers 22)', sg('tcp', 0, 65535), 'sg_open_admin'],
    ['TCP 20-25 (covers 22)', sg('tcp', 20, 25), 'sg_open_admin'],
    ['TCP 80', sg('tcp', 80, 80), 'sg_open_web'],
    ['TCP 443', sg('tcp', 443, 443), 'sg_open_web'],
    ['TCP 80-443', sg('tcp', 80, 443), 'sg_open_other'],
    ['TCP 8080', sg('tcp', 8080, 8080), 'sg_open_other'],
    ['UDP 443', sg('udp', 443, 443), 'sg_open_other'],
    ['UDP 22', sg('udp', 22, 22), 'sg_open_other'],
    ['ICMP type 8 code 0', sg('icmp', 8, 0), 'sg_open_other'],
    ['protocol number "50"', sg('50', 0, 0), 'sg_open_other'],
  ])('%s → %s', (_name, evidence, expected) => {
    expect(sgPortClass(evidence)).toBe(expected)
  })

  it.each([
    ['protocol missing', sg(undefined, 22, 22)],
    ['protocol empty', sg('', 22, 22)],
    ['protocol "all"', sg('all', 0, 65535)],
    ['protocol "ALL"', sg('ALL', 0, 65535)],
    ['protocol "TCP"', sg('TCP', 80, 80)],
    ['protocol "-2"', sg('-2', 0, 65535)],
    ['protocol "256"', sg('256', 0, 0)],
    ['protocol null', sg(null, 22, 22)],
    ['ports missing', { protocol: 'tcp' }],
    ['from_port missing', sg('tcp', undefined, 22)],
    ['ports as strings', sg('tcp', '22', '22')],
    ['port NaN', sg('tcp', Number.NaN, 22)],
    ['port fractional', sg('tcp', 79.5, 80)],
    ['TCP reversed', sg('tcp', 443, 80)],
    ['TCP above 65535', sg('tcp', 443, 70000)],
    ['TCP negative', sg('tcp', -1, 22)],
    ['"-1" with ports missing', { protocol: '-1' }],
    ['no evidence', null],
  ])('%s → no key', (_name, evidence) => {
    expect(sgPortClass(evidence)).toBeNull()
  })
})

const finding = (over: Partial<AccountSecurityFinding>): AccountSecurityFinding => ({
  id: 'f-1', organization_id: 'org-1', finding_key: 'k', category: 'iam', severity: 'high', title: 't',
  recommendation: 'r', resource_identifier: 'arn:aws:iam::000000000000:user/example-user', region: null, status: 'active',
  detected_at: '2026-10-01T00:00:00Z', last_seen_at: '2026-10-23T00:00:00Z', resolved_at: null,
  disposition: null, disposition_actor_id: null, disposition_at: null, disposition_note: null, evidence: null,
  created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-23T00:00:00Z', derived_status: 'active', framework_mapping: null,
  ...over,
})
const mfa = (has_login_profile: unknown) => finding({
  evidence: {
    schema_version: 1, resource_type: 'iam_user', resource_identifier: 'x', resource_name: 'example-user',
    finding_type: 'mfa_not_enabled', relevant_aws_attributes: { has_login_profile, mfa_device_count: 0 }, detected_at: '2026-10-01T00:00:00Z',
  } as unknown as AccountSecurityFinding['evidence'],
})
const sgFinding = (evidence: unknown) => finding({ category: 'networking', evidence: evidence as AccountSecurityFinding['evidence'] })

describe('account finding → key (the approved mapping)', () => {
  it('security groups by port class', () => {
    expect(guidanceKeyForAccountFinding(sgFinding(sg('tcp', 22, 22)))).toBe('sg_open_admin')
    expect(guidanceKeyForAccountFinding(sgFinding(sg('tcp', 443, 443)))).toBe('sg_open_web')
    expect(guidanceKeyForAccountFinding(sgFinding(sg('udp', 53, 53)))).toBe('sg_open_other')
    expect(guidanceKeyForAccountFinding(sgFinding(sg('all', 0, 65535)))).toBeNull()
    expect(guidanceKeyForAccountFinding(sgFinding(null))).toBeNull()
  })
  it('MFA: console only when the login profile is proven, unknown only when it is "unknown"', () => {
    expect(guidanceKeyForAccountFinding(mfa(true))).toBe('iam_no_mfa_console')
    expect(guidanceKeyForAccountFinding(mfa('unknown'))).toBe('iam_no_mfa_unknown')
    for (const other of [false, undefined, null, 'true', 'Unknown', 1]) expect(guidanceKeyForAccountFinding(mfa(other)), String(other)).toBeNull()
  })
  it('a stale access key', () => {
    expect(guidanceKeyForAccountFinding(finding({
      evidence: {
        schema_version: 1, resource_type: 'iam_access_key', resource_identifier: 'x', resource_name: 'example-user', finding_type: 'access_key_stale',
        relevant_aws_attributes: { access_key_id: 'AKIAEXAMPLE000000001', age_in_days: 120, key_status: 'Active' }, detected_at: '2026-10-01T00:00:00Z',
      },
    }))).toBe('iam_key_stale')
  })
  it('an unknown finding type, a category mismatch or no evidence → no key', () => {
    expect(guidanceKeyForAccountFinding(finding({ evidence: { finding_type: 'root_account_used' } as unknown as AccountSecurityFinding['evidence'] }))).toBeNull()
    expect(guidanceKeyForAccountFinding({ ...mfa(true), category: 'networking' })).toBeNull()
    expect(guidanceKeyForAccountFinding(finding({ evidence: null }))).toBeNull()
  })
})

describe('resource issue → key (finding key only)', () => {
  it.each([
    ['s3.https_only', 's3_https_only'],
    ['s3.public_access.policy', 's3_public_policy'],
    ['s3.public_access.acl', 's3_public_acl'],
  ])('%s → %s', (findingKey, key) => {
    expect(guidanceKeyForResourceIssue({ findingKey })).toBe(key)
  })
  it.each([undefined, null, '', 's3.https', 'S3.HTTPS_ONLY', 'constructor', '__proto__', 'toString'])('%j → no key', (findingKey) => {
    expect(guidanceKeyForResourceIssue({ findingKey })).toBeNull()
  })
})

describe('the HTTPS-only policy statement', () => {
  const template = APPROVED.find(([key]) => key === 's3_https_only')![1].policyStatementTemplate

  it('is the approved statement with the bucket name filled in', () => {
    expect(buildHttpsOnlyStatement('example-bucket')).toBe(template.replaceAll('{bucket}', 'example-bucket'))
  })

  it.each(['example-bucket', 'a"b', 'a\\b', 'line\nbreak', 'star*', '{bucket}', '</script>'])('is valid JSON for %j, with the name intact', (bucket) => {
    const text = buildHttpsOnlyStatement(bucket)
    const parsed = JSON.parse(text)
    expect(parsed.Resource).toEqual([`arn:aws:s3:::${bucket}`, `arn:aws:s3:::${bucket}/*`])
    expect(text).toBe(template.replaceAll('{bucket}', JSON.stringify(bucket).slice(1, -1)))
  })

  it('is one statement, not a whole policy', () => {
    const parsed = JSON.parse(buildHttpsOnlyStatement('example-bucket'))
    expect(parsed).not.toHaveProperty('Version')
    expect(parsed).not.toHaveProperty('Statement')
    expect(parsed.Effect).toBe('Deny')
    expect(parsed.Condition).toEqual({ Bool: { 'aws:SecureTransport': 'false' } })
  })
})

describe('isOneStatement (the Copy button is enabled only for this)', () => {
  it('accepts the built statement', () => {
    expect(isOneStatement(buildHttpsOnlyStatement('example-bucket'))).toBe(true)
  })
  it.each([
    ['two statements', JSON.stringify([JSON.parse(buildHttpsOnlyStatement('a')), JSON.parse(buildHttpsOnlyStatement('b'))])],
    ['a whole policy', JSON.stringify({ Version: '2012-10-17', Statement: [JSON.parse(buildHttpsOnlyStatement('a'))] })],
    ['invalid JSON', `${buildHttpsOnlyStatement('a')},`],
    ['no Sid', '{"Effect":"Deny"}'],
    ['null', 'null'],
    ['not a string', 42],
  ])('rejects %s', (_, text) => {
    expect(isOneStatement(text)).toBe(false)
  })
})
