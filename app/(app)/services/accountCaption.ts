/**
 * The AWS resources card caption, from /api/services/stats'
 * aws_accounts_connected (the organization's connected accounts, as the
 * connect flow counts them). null when the count is unknown -- stats not
 * loaded, failed, or from a backend that does not report it -- so nothing is
 * claimed either way.
 */
export function connectedAccountsCaption(connected: number | null | undefined): string | null {
  if (typeof connected !== 'number' || !Number.isInteger(connected) || connected < 0) return null
  if (connected === 0) return 'No AWS account connected'
  const accounts = connected === 1 ? '1 AWS account connected' : `${connected} AWS accounts connected`
  return `${accounts}; not every region is scanned`
}
