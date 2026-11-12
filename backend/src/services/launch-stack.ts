/**
 * The CloudFormation "Launch stack" link on the Connect AWS page (AWS connect
 * PR D2, CP-D1, L-6).
 *
 * connect-init returns `launchStack` only when the server switch is on AND the
 * hosted template's URL, version and Region are all valid. Anything else
 * leaves the response exactly as it was before D2, and the page shows the
 * manual setup only. Read on every call (like the trial switch,
 * config/trial.ts), so a configuration change needs no code change.
 *
 * The link is the documented quick-create format:
 * https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/cfn-console-create-stacks-quick-create-links.html
 *
 * Nothing here calls AWS or fetches the template. Log lines name variables,
 * never their values.
 */
import { isWellFormedExternalId } from '../repositories/aws-external-id.repository';
import { isOfferableTemplateVersion } from './customer-role-template';

export const LAUNCH_STACK_ENV = {
  enabled: 'CONNECT_LAUNCH_STACK_ENABLED',
  templateUrl: 'CONNECT_TEMPLATE_URL',
  templateVersion: 'CONNECT_TEMPLATE_VERSION',
  region: 'CONNECT_LAUNCH_STACK_REGION',
} as const;

/**
 * The only Region the link uses, for the console and for the template's S3 host
 * (founder decision D2-D7, review L-3). CONNECT_LAUNCH_STACK_REGION may be unset
 * or exactly this value; anything else turns the link off with a warning.
 */
export const LAUNCH_STACK_REGION = 'us-east-1';
/** The stack name the link fills in (D2-D8); the customer can change it in the console. */
export const LAUNCH_STACK_NAME = 'DevControl';
/** The role name the link fills in: the template's default, and the connect rule's prefix. */
export const LAUNCH_STACK_ROLE_NAME = 'DevControlRole';

const MAX_TEMPLATE_URL_LENGTH = 1024;
/** Path-style S3 host in us-east-1: https://s3.us-east-1.amazonaws.com/<bucket>/<key>. */
const S3_PATH_STYLE_HOST = /^s3\.us-east-1\.amazonaws\.com$/;
/** Virtual-hosted S3 host in us-east-1: https://<bucket>.s3.us-east-1.amazonaws.com/<key>. */
const S3_VIRTUAL_HOST = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]\.s3\.us-east-1\.amazonaws\.com$/;
const S3_BUCKET = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const SAFE_PATH = /^[A-Za-z0-9._\/-]+$/;

export type LaunchStack = { url: string; templateVersion: string; templateUrl: string };

export type LaunchStackConfig =
  | { state: 'off'; templateVersion: string | null }
  | { state: 'ready'; templateUrl: string; templateVersion: string; region: string }
  | { state: 'misconfigured'; problems: string[] };

/**
 * Whether `raw` is the https URL of template version `version` in S3 in
 * us-east-1: the key must end in exactly /v{n}/devcontrol-role.v{n}.json (review
 * L-2), with no empty or dot segments; no credentials, port, query or fragment;
 * the legacy s3-<region> host refused. A presigned URL (it expires) is refused by
 * the no-query rule. The page applies the same rule (connect-aws/launchStackUrl.ts);
 * both are tested against one shared table (__tests__/fixtures/launch-stack-template-urls.json).
 */
export function isTemplateUrlFor(raw: string, version: string): boolean {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_TEMPLATE_URL_LENGTH) return false;
  if (raw.includes('?') || raw.includes('#')) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.href !== raw) return false;
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
  if (!SAFE_PATH.test(url.pathname)) return false;
  let key: string;
  if (S3_PATH_STYLE_HOST.test(url.hostname)) {
    const [, bucket, ...rest] = url.pathname.split('/');
    if (!S3_BUCKET.test(bucket ?? '') || rest.length === 0) return false;
    key = `/${rest.join('/')}`;
  } else if (S3_VIRTUAL_HOST.test(url.hostname)) {
    key = url.pathname;
  } else {
    return false;
  }
  const segments = key.split('/').slice(1);
  if (segments.length === 0 || segments.some((segment) => segment === '' || segment === '.' || segment === '..')) return false;
  return key.endsWith(`/v${version}/devcontrol-role.v${version}.json`);
}

/** The configuration as read now. `off` names the version only when the rest is valid. */
export function readLaunchStackConfig(env: NodeJS.ProcessEnv = process.env): LaunchStackConfig {
  const enabledRaw = env[LAUNCH_STACK_ENV.enabled];
  const templateUrl = env[LAUNCH_STACK_ENV.templateUrl];
  const templateVersion = env[LAUNCH_STACK_ENV.templateVersion];
  const regionRaw = env[LAUNCH_STACK_ENV.region];

  const problems: string[] = [];
  if (enabledRaw !== undefined && enabledRaw !== 'true' && enabledRaw !== 'false') problems.push(LAUNCH_STACK_ENV.enabled);
  const enabled = enabledRaw === 'true';
  const anyTemplateSetting = templateUrl !== undefined || templateVersion !== undefined || regionRaw !== undefined;

  if (!enabled && !anyTemplateSetting) {
    return problems.length > 0 ? { state: 'misconfigured', problems } : { state: 'off', templateVersion: null };
  }

  const versionOk = templateVersion !== undefined && isOfferableTemplateVersion(templateVersion);
  if (!versionOk) problems.push(LAUNCH_STACK_ENV.templateVersion);
  if (templateUrl === undefined || !versionOk || !isTemplateUrlFor(templateUrl, templateVersion as string)) {
    problems.push(LAUNCH_STACK_ENV.templateUrl);
  }
  const region = regionRaw ?? LAUNCH_STACK_REGION;
  if (region !== LAUNCH_STACK_REGION) problems.push(LAUNCH_STACK_ENV.region);

  if (problems.length > 0) return { state: 'misconfigured', problems };
  if (!enabled) return { state: 'off', templateVersion: templateVersion as string };
  return { state: 'ready', templateUrl: templateUrl as string, templateVersion: templateVersion as string, region };
}

/** The quick-create console link (documented format). Values are URL-encoded. */
export function buildLaunchStackUrl(input: { region: string; templateUrl: string; externalId: string }): string {
  const { region, templateUrl, externalId } = input;
  return `https://${region}.console.aws.amazon.com/cloudformation/home?region=${region}#/stacks/create/review`
    + `?templateURL=${encodeURIComponent(templateUrl)}`
    + `&stackName=${LAUNCH_STACK_NAME}`
    + `&param_ExternalId=${encodeURIComponent(externalId)}`
    + `&param_RoleName=${LAUNCH_STACK_ROLE_NAME}`;
}

const warned = new Set<string>();

/** For tests: forget which problems were already logged. */
export function resetLaunchStackWarnings(): void {
  warned.clear();
}

/**
 * The organization's Launch stack link, or null (the page then shows the
 * manual setup only). A misconfiguration is logged once per process per
 * distinct set of variable names.
 */
export function launchStackFor(externalId: string, env: NodeJS.ProcessEnv = process.env): LaunchStack | null {
  const config = readLaunchStackConfig(env);
  if (config.state === 'misconfigured') {
    const key = config.problems.join(',');
    if (!warned.has(key)) {
      warned.add(key);
      console.warn(`[connect] Launch stack is off: invalid or missing ${config.problems.join(', ')}`);
    }
    return null;
  }
  if (config.state !== 'ready' || !isWellFormedExternalId(externalId)) return null;
  return {
    url: buildLaunchStackUrl({ region: config.region, templateUrl: config.templateUrl, externalId }),
    templateVersion: config.templateVersion,
    templateUrl: config.templateUrl,
  };
}

/** The one startup line (D2-D15): variable names only, never values. */
export function launchStackStateLine(env: NodeJS.ProcessEnv = process.env): string {
  const config = readLaunchStackConfig(env);
  if (config.state === 'ready') return `[connect] Launch stack: ready (template v${config.templateVersion})`;
  if (config.state === 'misconfigured') return `[connect] Launch stack: misconfigured (${config.problems.join(', ')})`;
  return config.templateVersion === null
    ? '[connect] Launch stack: off'
    : `[connect] Launch stack: off (template v${config.templateVersion} configured)`;
}
