/**
 * What a caller is told when work that needs the organization's AWS connection
 * finds none (AWS connect PR C, approved copy). Work that started with no
 * eligible connection has nothing AWS-derived to write, so it is refused before
 * it records anything (aws-connection-fence.ts: no connection is never a pass).
 */

/** The stable code for "this organization has no eligible AWS connection". */
export const AWS_NOT_CONNECTED_CODE = 'NOT_CONNECTED';

/** The general answer (cost sync, Security Hub sync). */
export const AWS_NOT_CONNECTED_MESSAGE = 'No AWS account is connected.';

/** A compliance scan asked for with no AWS connection. */
export const COMPLIANCE_SCAN_NOT_CONNECTED_MESSAGE = 'Connect an AWS account to run a compliance scan.';
