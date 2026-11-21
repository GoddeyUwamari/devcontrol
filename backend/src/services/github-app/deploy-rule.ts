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

const environmentsRule = z.object({
  mode: z.literal('github_deployments'),
  /** GitHub environment name (any case) -> DevControl environment. Wins over the default names. */
  environment_map: z.record(z.string().trim().min(1).max(255), environment).default({})
    .refine((m) => Object.keys(m).length <= MAX_ENVIRONMENT_MAP_ENTRIES, { message: 'at most 50 environment names' })
    .transform((m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k.toLowerCase(), v]))),
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
