import { z } from 'zod';

// Service validation schemas
export const createServiceSchema = z.object({
  name: z.string().min(1, 'Service name is required').max(255, 'Service name too long'),
  template: z.enum(['api', 'frontend', 'worker', 'database'], {
    errorMap: () => ({ message: 'Template must be one of: api, frontend, worker, database' }),
  }),
  owner: z.string().email('Owner must be a valid email'),
  team_id: z.string().uuid('Team ID must be a valid UUID'),
  github_url: z.string().url('GitHub URL must be a valid URL').optional(),
  description: z.string().max(500, 'Description too long').optional(),
});

export const updateServiceSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  status: z.enum(['active', 'inactive', 'archived']).optional(),
  description: z.string().max(500).optional(),
  github_url: z.string().url().optional(),
});

// Deployment validation schemas
export const createDeploymentSchema = z.object({
  service_id: z.string().uuid('Service ID must be a valid UUID'),
  environment: z.enum(['development', 'staging', 'production'], {
    errorMap: () => ({ message: 'Environment must be one of: development, staging, production' }),
  }),
  aws_region: z.string().min(1, 'AWS region is required').regex(/^[a-z]{2}-[a-z]+-\d$/, 'Invalid AWS region format'),
  status: z.enum(['running', 'stopped', 'deploying', 'failed'], {
    errorMap: () => ({ message: 'Status must be one of: running, stopped, deploying, failed' }),
  }),
  cost_estimate: z.number().min(0, 'Cost estimate must be non-negative').optional(),
  deployed_by: z.string().email('Deployed by must be a valid email'),
  resources: z.record(z.any()).optional(),
});

// Infrastructure validation schemas
export const createInfrastructureSchema = z.object({
  service_id: z.string().uuid('Service ID must be a valid UUID'),
  resource_type: z.enum(['ec2', 'rds', 'vpc', 's3', 'lambda', 'elasticache', 'other'], {
    errorMap: () => ({ message: 'Invalid resource type' }),
  }),
  aws_id: z.string().min(1, 'AWS ID is required'),
  aws_region: z.string().min(1, 'AWS region is required').regex(/^[a-z]{2}-[a-z]+-\d$/, 'Invalid AWS region format'),
  status: z.enum(['running', 'stopped', 'terminated'], {
    errorMap: () => ({ message: 'Status must be one of: running, stopped, terminated' }),
  }),
  cost_per_month: z.number().min(0, 'Cost per month must be non-negative'),
  metadata: z.record(z.any()).optional(),
});

// Team validation schemas
export const createTeamSchema = z.object({
  name: z.string().min(1, 'Team name is required').max(255, 'Team name too long'),
  owner: z.string().email('Owner must be a valid email'),
  description: z.string().max(500, 'Description too long').optional(),
});

// Query parameter schemas
export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const uuidParamSchema = z.object({
  id: z.string().uuid('Invalid ID format'),
});
