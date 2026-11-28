import { Request, Response, NextFunction } from 'express';
import { ServicesRepository } from '../repositories/services.repository';
import { CreateServiceRequest, UpdateServiceRequest, ServiceFilters, ApiResponse } from '../types';
import { NotFoundError, DatabaseError, ValidationError } from '../utils/errors';
import { emitOnboardingEvent } from '../services/onboardingEvents';
import { defaultSource, withOrgTransaction, type ConnectionSource } from '../services/github-app/db';
import {
  SERVICES_QUOTA_LOCK_SQL,
  ServiceLimitReachedError,
  assertServiceCapacity,
  serviceLimitResponse,
} from '../middleware/subscription.middleware';

const repository = new ServicesRepository();

/** POST /api/services with a team_id that names no team of the caller's organization. */
export const TEAM_NOT_IN_WORKSPACE_MESSAGE = 'Team not found';

/**
 * Creates a service inside the services limit, all or nothing, on one
 * dedicated tenant-tagged transaction: the per-organization lock FIRST, then
 * the count, then the insert. Concurrent creations of one organization run
 * one at a time, so the last free slot goes to exactly one of them; a refusal
 * or any error rolls back and leaves nothing. Only NEW services are limited:
 * reads, updates, deletes and GitHub mappings never come here.
 *
 * A dedicated connection, not the request's: the request connection also
 * carries the fire-and-forget api_usage upsert (authenticate), which must not
 * join this transaction.
 */
export async function createServiceWithinLimit(
  serviceData: CreateServiceRequest,
  organizationId: string,
  source: ConnectionSource = defaultSource
) {
  return withOrgTransaction(source, organizationId, async (client) => {
    await client.query(SERVICES_QUOTA_LOCK_SQL, [organizationId]);
    await assertServiceCapacity(client, organizationId);
    return repository.create(serviceData, organizationId, client);
  });
}

export class ServicesController {
  async getAll(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const filters: ServiceFilters = {
        status: req.query.status as string,
        team_id: req.query.team_id as string,
        template: req.query.template as string,
        limit: req.query.limit ? parseInt(req.query.limit as string) : 50,
        offset: req.query.offset ? parseInt(req.query.offset as string) : 0,
      };

      const organizationId = req.user?.organizationId;
      if (!organizationId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const { services, total } = await repository.findAll(organizationId, filters);

      const response: ApiResponse = {
        success: true,
        data: services,
        total,
      };

      res.json(response);
    } catch (error) {
      next(new DatabaseError('Failed to fetch services'));
    }
  }

  async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const organizationId = req.user?.organizationId;
      if (!organizationId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const service = await repository.findById(id, organizationId);

      if (!service) {
        throw new NotFoundError('Service');
      }

      const response: ApiResponse = {
        success: true,
        data: service,
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const serviceData: CreateServiceRequest = req.body;
      const organizationId = req.user?.organizationId;
      if (!organizationId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      let service;
      try {
        service = await createServiceWithinLimit(serviceData, organizationId);
      } catch (error) {
        if (error instanceof ServiceLimitReachedError) {
          res.status(402).json(serviceLimitResponse(error.capacity));
          return;
        }
        throw error;
      }

      if (!service) {
        // A team was given but is not one of this organization's: 400 (onboarding
        // D5), the same answer whether it doesn't exist or belongs to another
        // organization. No team at all never comes here.
        next(new ValidationError(TEAM_NOT_IN_WORKSPACE_MESSAGE));
        return;
      }

      // Emit onboarding event for service creation
      const user = (req as any).user;
      if (user && service) {
        emitOnboardingEvent('service:created', {
          organizationId: user.organizationId,
          userId: user.userId || user.id,
          serviceId: service.id,
        });
      }

      const response: ApiResponse = {
        success: true,
        data: service,
        message: 'Service created successfully',
      };

      res.status(201).json(response);
    } catch (error) {
      next(new DatabaseError('Failed to create service'));
    }
  }

  async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const updates: UpdateServiceRequest = req.body;
      const organizationId = req.user?.organizationId;
      if (!organizationId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const service = await repository.update(id, updates, organizationId);

      if (!service) {
        throw new NotFoundError('Service');
      }

      const response: ApiResponse = {
        success: true,
        data: service,
        message: 'Service updated successfully',
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const organizationId = req.user?.organizationId;
      if (!organizationId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const deleted = await repository.delete(id, organizationId);

      if (!deleted) {
        throw new NotFoundError('Service');
      }

      const response: ApiResponse = {
        success: true,
        message: 'Service deleted successfully',
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  }
}
