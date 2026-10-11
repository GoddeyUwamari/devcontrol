/**
 * The role a NEW AWS connection may name.
 *
 * The platform's own identity is only allowed sts:AssumeRole on roles named
 * DevControlRole* (arn:aws:iam::*:role/DevControlRole*), so a connection to
 * any other role could be saved but never assumed. IAM paths are rejected for
 * the same reason: role/<path>/DevControlRole does not match that resource.
 *
 * Accounts already stored are not re-validated against this.
 */

export const DEVCONTROL_ROLE_NAME_PREFIX = 'DevControlRole';

/** Any IAM role ARN in a 12-digit account: the general shape, path and name not yet checked. */
const ROLE_ARN_SHAPE = /^arn:aws:iam::(\d{12}):role\/.+$/;

/** A role with no path whose name starts with DevControlRole (IAM role-name characters only). */
const DEVCONTROL_ROLE_ARN = /^arn:aws:iam::\d{12}:role\/DevControlRole[\w+=,.@-]*$/;

export type RoleArnCheck =
  | { ok: true; accountId: string }
  | { ok: false; reason: 'malformed' | 'role_name' };

export function checkNewConnectionRoleArn(roleArn: string): RoleArnCheck {
  const shape = roleArn.match(ROLE_ARN_SHAPE);
  if (!shape) return { ok: false, reason: 'malformed' };
  if (!DEVCONTROL_ROLE_ARN.test(roleArn)) return { ok: false, reason: 'role_name' };
  return { ok: true, accountId: shape[1] };
}
