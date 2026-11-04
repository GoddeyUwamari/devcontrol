/**
 * Copy and error mapping for the Connect AWS page, kept out of page.tsx (a
 * Next.js page may export only its component and route config).
 */

/** What each operation the post-connect permission check tests lets DevControl do. */
export const PERMISSION_CHECK_LABELS: Record<string, string> = {
  'ec2:DescribeRegions': 'List your AWS regions',
  's3:ListAllMyBuckets': 'List S3 buckets',
  'lambda:ListFunctions': 'List Lambda functions',
  'cloudwatch:GetMetricData': 'Read CloudWatch metrics',
  'ce:GetCostAndUsage': 'Read Cost Explorer spend',
  'resource-explorer-2:Search': 'Search Resource Explorer',
}

/** The connect error shown to the owner: the server's fixed message, or a safe fallback. */
export function connectErrorMessage(err: unknown): string {
  const e = err as { response?: { data?: { message?: unknown } } } | null
  const message = e?.response?.data?.message
  if (typeof message === 'string' && message) return message
  if (!e?.response) return "We couldn't reach DevControl. Check your connection and try again."
  return 'Something went wrong while connecting your account. Please try again.'
}
