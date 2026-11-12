/**
 * The DevControl CloudFormation template versions (AWS connect PR D2) and the
 * permission contract each one implements.
 *
 * The template files live in lib/aws/cloudformation/ with their pinned SHA-256
 * in published-templates.json; the backend builds from src/ only, so it keeps
 * just the version → contract map it needs to decide whether a configured
 * template may be offered. customer-role-template.static.test.ts fails unless
 * this map equals the manifest, and unless the current version's file matches
 * the manual setup exactly.
 */
import { CUSTOMER_ROLE_CONTRACT_VERSION } from './connect-policy-compare';

export const CUSTOMER_ROLE_TEMPLATES: Readonly<Record<string, { contractVersion: number }>> = {
  '1': { contractVersion: 1 },
};

/** The version new connections are offered; it must implement the running contract. */
export const CURRENT_TEMPLATE_VERSION = '1';

/**
 * Whether template `version` may be offered by this build: published, and
 * implementing the permission contract the policy compare checks against, so
 * a stack-made role never reads "differs" the moment it is connected.
 */
export function isOfferableTemplateVersion(version: string): boolean {
  if (!Object.prototype.hasOwnProperty.call(CUSTOMER_ROLE_TEMPLATES, version)) return false;
  return CUSTOMER_ROLE_TEMPLATES[version].contractVersion === CUSTOMER_ROLE_CONTRACT_VERSION;
}
