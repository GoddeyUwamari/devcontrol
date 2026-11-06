/**
 * A stand-in database client for unit tests that run a custom compliance scan
 * body directly: every statement answers with no rows, except the read of the
 * organization's AWS connection, which answers with one placeholder active row.
 * Since AWS connect PR C a scan with no connection is refused (no connection is
 * never a pass), so a scan under test needs one. Placeholders only.
 */
const CONNECTED_ROW = {
  id: '00000000-0000-4000-8000-0000000000c1',
  org_id: 'org-1',
  account_id: '123456789012',
  role_arn: 'arn:aws:iam::123456789012:role/DevControlRole',
  external_id: 'placeholder-external-id',
  region: 'us-east-1',
  nickname: null,
  status: 'active',
  connected_at: null,
};

function connectedScanClient(wrap = (fn) => fn) {
  return { query: wrap(async (sql) => (/FROM aws_accounts/.test(String(sql)) ? { rows: [CONNECTED_ROW] } : { rows: [] })) };
}

module.exports = { connectedScanClient, CONNECTED_ROW };
