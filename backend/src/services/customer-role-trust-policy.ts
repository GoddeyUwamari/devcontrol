/**
 * The trust policy every organization's DevControl role carries: DevControl's
 * AWS account may assume the role only with the organization's External ID.
 *
 * Shown by connect-init (routes/aws.routes.ts) for the manual setup. The
 * CloudFormation template (lib/aws/cloudformation/) must build exactly the
 * same document; customer-role-template.static.test.ts compares the two.
 */
export function buildTrustPolicy(externalId: string, platformAccountId: string): object {
  return {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Principal: { AWS: `arn:aws:iam::${platformAccountId}:root` },
        Action: 'sts:AssumeRole',
        Condition: {
          StringEquals: { 'sts:ExternalId': externalId },
        },
      },
    ],
  }
}
