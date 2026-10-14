import { Request, Response } from 'express';
import { DeploymentsRepository } from '../repositories/deployments.repository';
import { CreateDeploymentRequest, DeploymentFilters, ApiResponse } from '../types';
import { DeploymentEvents } from '../services/deploymentEvents';
import { WebSocketServer } from '../websocket/server';
import { emitOnboardingEvent } from '../services/onboardingEvents';
import {
  DEFAULT_PAGE_SIZE,
  DEPLOYMENT_ENVIRONMENTS,
  PAGE_SIZES,
  isStatsWindow,
} from '../services/deployment-status';

const repository = new DeploymentsRepository();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/deployments query -> filters, or the reason it is invalid. Nothing
 * is coerced or silently defaulted: a parameter that is present must be valid.
 */
export function parseDeploymentListQuery(
  query: Record<string, unknown>
): { filters: DeploymentFilters } | { error: string } {
  const filters: DeploymentFilters = { limit: DEFAULT_PAGE_SIZE, offset: 0 };

  for (const key of ['limit', 'offset', 'environment', 'date_range', 'status', 'service_id']) {
    if (query[key] !== undefined && typeof query[key] !== 'string') {
      return { error: `Invalid ${key}` };
    }
  }
  const { limit, offset, environment, date_range, status, service_id } = query as Record<string, string | undefined>;

  if (limit !== undefined) {
    const parsed = /^\d+$/.test(limit) ? Number(limit) : NaN;
    if (!(PAGE_SIZES as readonly number[]).includes(parsed)) {
      return { error: `Invalid limit. Must be one of: ${PAGE_SIZES.join(', ')}` };
    }
    filters.limit = parsed;
  }

  if (offset !== undefined) {
    const parsed = /^\d+$/.test(offset) ? Number(offset) : NaN;
    if (!Number.isSafeInteger(parsed)) {
      return { error: 'Invalid offset. Must be a non-negative integer' };
    }
    filters.offset = parsed;
  }

  if (environment !== undefined && environment !== 'all') {
    if (!(DEPLOYMENT_ENVIRONMENTS as readonly string[]).includes(environment)) {
      return { error: `Invalid environment. Must be one of: ${DEPLOYMENT_ENVIRONMENTS.join(', ')}` };
    }
    filters.environment = environment;
  }

  if (date_range !== undefined) {
    if (!isStatsWindow(date_range)) {
      return { error: 'Invalid date_range. Must be one of: 7d, 30d, 90d' };
    }
    filters.date_range = date_range;
  }

  if (status !== undefined) {
    if (status.length === 0 || status.length > 50) return { error: 'Invalid status' };
    filters.status = status;
  }

  if (service_id !== undefined) {
    if (!UUID_RE.test(service_id)) return { error: 'Invalid service_id. Must be a UUID' };
    filters.service_id = service_id;
  }

  return { filters };
}

export class DeploymentsController {
  async getAll(req: Request, res: Response): Promise<void> {
    try {
      // Never run unscoped: no organization means no query at all.
      const organizationId = (req as any).organizationId || (req as any).user?.organizationId;
      if (!organizationId) {
        res.status(401).json({ success: false, error: 'Unauthorized - organization context required' });
        return;
      }

      const parsed = parseDeploymentListQuery(req.query as Record<string, unknown>);
      if ('error' in parsed) {
        res.status(400).json({ success: false, error: parsed.error });
        return;
      }
      const { filters } = parsed;

      const { deployments, total } = await repository.findAll(filters, organizationId);

      const response: ApiResponse = {
        success: true,
        data: deployments,
        total,
        pagination: { limit: filters.limit!, offset: filters.offset!, total },
      };

      res.json(response);
    } catch (error) {
      console.error('Error fetching deployments:', error);
      const response: ApiResponse = {
        success: false,
        error: 'Failed to fetch deployments',
      };
      res.status(500).json(response);
    }
  }

  async getById(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const organizationId = (req as any).user?.organizationId;
      const deployment = await repository.findById(id, organizationId);

      if (!deployment) {
        const response: ApiResponse = {
          success: false,
          error: 'Deployment not found',
        };
        res.status(404).json(response);
        return;
      }

      const response: ApiResponse = {
        success: true,
        data: deployment,
      };

      res.json(response);
    } catch (error) {
      console.error('Error fetching deployment:', error);
      const response: ApiResponse = {
        success: false,
        error: 'Failed to fetch deployment',
      };
      res.status(500).json(response);
    }
  }

  async create(req: Request, res: Response): Promise<void> {
    try {
      const deploymentData: CreateDeploymentRequest = req.body;

      // Validate required fields
      if (!deploymentData.service_id || !deploymentData.environment ||
          !deploymentData.aws_region || !deploymentData.status || !deploymentData.deployed_by) {
        const response: ApiResponse = {
          success: false,
          error: 'Missing required fields: service_id, environment, aws_region, status, deployed_by',
        };
        res.status(400).json(response);
        return;
      }

      // The organization always comes from the authenticated request, never
      // from the body.
      const user = (req as any).user;
      const organizationId = (req as any).organizationId || user?.organizationId;

      const deployment = await repository.create({ ...deploymentData, organization_id: organizationId });
      if (!deployment) {
        // Same answer whether the service doesn't exist or belongs to
        // another organization.
        const response: ApiResponse = {
          success: false,
          error: 'Service not found',
        };
        res.status(404).json(response);
        return;
      }

      // Emit onboarding event for deployment creation
      if (user && deployment) {
        emitOnboardingEvent('deployment:created', {
          organizationId: user.organizationId,
          userId: user.userId || user.id,
          deploymentId: deployment.id,
        });
      }

      // Emit WebSocket event for deployment started
      try {
        const wsServer: WebSocketServer = req.app.get('wsServer');
        if (wsServer) {
          const deploymentEvents = new DeploymentEvents(wsServer);
          deploymentEvents.deploymentStarted(organizationId || 'default-org', {
            id: deployment.id,
            service_name: 'Unknown Service',
            environment: deployment.environment,
            deployed_by: deployment.deployed_by,
          });
        }
      } catch (wsError) {
        console.error('Error emitting WebSocket event:', wsError);
        // Don't fail the request if WebSocket fails
      }

      const response: ApiResponse = {
        success: true,
        data: deployment,
        message: 'Deployment created successfully',
      };

      res.status(201).json(response);
    } catch (error) {
      console.error('Error creating deployment:', error);
      const response: ApiResponse = {
        success: false,
        error: 'Failed to create deployment',
      };
      res.status(500).json(response);
    }
  }

  async delete(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const organizationId = (req as any).user?.organizationId;
      const deleted = await repository.delete(id, organizationId);

      if (!deleted) {
        const response: ApiResponse = {
          success: false,
          error: 'Deployment not found',
        };
        res.status(404).json(response);
        return;
      }

      const response: ApiResponse = {
        success: true,
        message: 'Deployment destroyed successfully',
      };

      res.json(response);
    } catch (error) {
      console.error('Error deleting deployment:', error);
      const response: ApiResponse = {
        success: false,
        error: 'Failed to delete deployment',
      };
      res.status(500).json(response);
    }
  }
}
