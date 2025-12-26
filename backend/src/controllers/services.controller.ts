import { Request, Response, NextFunction } from 'express';
import { ServicesRepository } from '../repositories/services.repository';
import { CreateServiceRequest, UpdateServiceRequest, ServiceFilters, ApiResponse } from '../types';
import { NotFoundError, DatabaseError } from '../utils/errors';

const repository = new ServicesRepository();

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

      const { services, total } = await repository.findAll(filters);

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
      const service = await repository.findById(id);

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
      const service = await repository.create(serviceData);

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
      const service = await repository.update(id, updates);

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
      const deleted = await repository.delete(id);

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
