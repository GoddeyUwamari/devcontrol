/**
 * Per-repository deploy rules (D8a-2, d8a2-build.md §A.2): which GitHub App
 * events of a repository are deployments. Stored in
 * pipeline_repositories.deploy_rule (JSONB; the database only checks it is an
 * object), so the schema here is the only validation. One mode per repository:
 *
 *   none                nothing is recorded (also: no rule stored)
 *   job                 a completed workflow_job whose workflow name AND job
 *                       name match exactly (the job payload carries no
 *                       workflow path), on the chosen branch
 *   github_deployments  a terminal deployment_status (GitHub Environments)
 *
 * Nothing is guessed: an unknown environment name records nothing.
 */
import { z } from 'zod';
import { DEPLOYMENT_ENVIRONMENTS, DeploymentEnvironment } from '../deployment-status';

export const DEPLOY_RULE_VERSION = 1;
const MAX_ENVIRONMENT_MAP_ENTRIES = 50;

/** Printable, trimmed, 1-200 characters: the normalizer's bound for workflow and job names. */
const name = z.string().trim().min(1).max(200).regex(/^[^\u0000-\u001f\u007f]+$/);
const branchName = z.string().trim().min(1).max(255).regex(/^[^\u0000-\u001f\u007f\s]+$/);
const environment = z.enum(DEPLOYMENT_ENVIRONMENTS);
/** A GitHub environment name: 1-255 characters once trimmed (the transform trims it). */
const environmentKey = z.string().refine((k) => k.trim().length >= 1 && k.trim().length <= 255);
/** Same shape POST /api/deployments accepts (deployments.routes.ts). */
const awsRegion = z.string().regex(/^[a-z]{2}(-[a-z]+)+-\d$/).nullable().default(null);

const noneRule = z.object({ mode: z.literal('none') }).strict();

const jobRule = z.object({
  mode: z.literal('job'),
  workflow_name: name,
  job_name: name,
  environment: environment.default('production'),
  /** default = the repository's default branch; any = every branch; named = branch_name only. */
  branch: z.enum(['default', 'any', 'named']).default('default'),
  branch_name: branchName.nullable().default(null),
  aws_region: awsRegion,
}).strict().superRefine((rule, ctx) => {
  if ((rule.branch === 'named') !== (rule.branch_name !== null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['branch_name'], message: 'branch_name is required for, and only for, branch "named"' });
  }
});

/**
 * The environment_map keys that are the same name once trimmed and
 * lower-cased (review N-4), e.g. ["Prod", "prod"]; empty when there are none.
 * Names are matched without case, so two such keys would silently replace
 * each other.
 */
export function caseDuplicateEnvironmentNames(map: unknown): string[] {
  if (map === null || typeof map !== 'object' || Array.isArray(map)) return [];
  const byName = new Map<string, string[]>();
  for (const key of Object.keys(map)) {
    const name = key.trim().toLowerCase();
    byName.set(name, [...(byName.get(name) ?? []), key]);
  }
  return [...byName.values()].filter((keys) => keys.length > 1).flat();
}

/** The 400 message for a deploy-rule body whose environment_map has case-duplicate names, or null. */
export function environmentMapProblem(body: unknown): string | null {
  if (body === null || typeof body !== 'object') return null;
  const duplicates = caseDuplicateEnvironmentNames((body as { environment_map?: unknown }).environment_map);
  if (duplicates.length === 0) return null;
  return `environment_map names GitHub environments that differ only in letter case (${duplicates.map((k) => JSON.stringify(k)).join(', ')}). `
    + 'Names are matched without case, so keep one of each.';
}

const environmentsRule = z.object({
  mode: z.literal('github_deployments'),
  /** GitHub environment name (any case) -> DevControl environment. Wins over the default names. */
  // Keys are checked as sent and trimmed in the transform, so " prod" and "prod" are seen as the duplicates they are.
  environment_map: z.record(environmentKey, environment).default({})
    .refine((m) => Object.keys(m).length <= MAX_ENVIRONMENT_MAP_ENTRIES, { message: 'at most 50 environment names' })
    .refine((m) => caseDuplicateEnvironmentNames(m).length === 0, { message: 'environment names that differ only in letter case' })
    .transform((m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k.trim().toLowerCase(), v]))),
  aws_region: awsRegion,
}).strict();

/** The request body of PUT /api/integrations/github/repositories/:id/deploy-rule. */
export const deployRuleBody = z.union([noneRule, jobRule, environmentsRule]);

export type DeployRule = z.infer<typeof deployRuleBody>;
export type JobRule = Extract<DeployRule, { mode: 'job' }>;
export type EnvironmentsRule = Extract<DeployRule, { mode: 'github_deployments' }>;

/** The stored form: the parsed rule plus its version. */
export function storedDeployRule(rule: DeployRule): Record<string, unknown> {
  return { v: DEPLOY_RULE_VERSION, ...rule };
}

/**
 * A stored rule as the detector reads it. NULL (never set) is `none`; anything
 * that does not parse as a version-1 rule is `invalid` and records nothing.
 */
export function readStoredDeployRule(stored: unknown): DeployRule | 'invalid' {
  if (stored === null || stored === undefined) return { mode: 'none' };
  if (typeof stored !== 'object' || Array.isArray(stored)) return 'invalid';
  const { v, ...rest } = stored as Record<string, unknown>;
  if (v !== DEPLOY_RULE_VERSION) return 'invalid';
  const parsed = deployRuleBody.safeParse(rest);
  return parsed.success ? parsed.data : 'invalid';
}

/** Default GitHub environment names (D8-D7), matched case-insensitively. */
const DEFAULT_ENVIRONMENT_NAMES: Readonly<Record<string, DeploymentEnvironment>> = {
  prod: 'production',
  production: 'production',
  live: 'production',
  stage: 'staging',
  staging: 'staging',
  preprod: 'staging',
  dev: 'development',
  development: 'development',
  preview: 'development',
  qa: 'development',
};

/** The DevControl environment for a GitHub environment name, or null when unknown. */
export function environmentFor(githubName: string | null, map: Readonly<Record<string, DeploymentEnvironment>>): DeploymentEnvironment | null {
  if (!githubName) return null;
  const key = githubName.trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(map, key)) return map[key];
  return Object.prototype.hasOwnProperty.call(DEFAULT_ENVIRONMENT_NAMES, key) ? DEFAULT_ENVIRONMENT_NAMES[key] : null;
}
