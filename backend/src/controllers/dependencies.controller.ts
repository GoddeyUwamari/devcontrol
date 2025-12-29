import { Request, Response, NextFunction } from 'express';
import { DependenciesRepository } from '../repositories/dependencies.repository';
import {
  CreateDependencyRequest,
  UpdateDependencyRequest,
  DependencyFilters,
  ApiResponse,
} from '../types';
import { NotFoundError, ValidationError } from '../utils/errors';

const repository = new DependenciesRepository();

export class DependenciesController {
  /**
   * GET /api/dependencies
   * Get all dependencies with optional filters
   */
  async getAll(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const filters: DependencyFilters = {
        source_service_id: req.query.source_service_id as string,
        target_service_id: req.query.target_service_id as string,
        dependency_type: req.query.dependency_type as any,
        is_critical: req.query.is_critical === 'true' ? true : undefined,
      };

      const dependencies = await repository.findAll(filters);

      const response: ApiResponse = {
        success: true,
        data: dependencies,
        total: dependencies.length,
      };

      res.json(response);
    } catch (error) {
      console.error('Error fetching dependencies:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch dependencies',
      });
    }
  }

  /**
   * GET /api/dependencies/:id
   * Get dependency by ID
   */
  async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const dependency = await repository.findById(id);

      if (!dependency) {
        throw new NotFoundError('Dependency');
      }

      const response: ApiResponse = {
        success: true,
        data: dependency,
      };

      res.json(response);
    } catch (error) {
      if (error instanceof NotFoundError) {
        res.status(404).json({
          success: false,
          error: error.message,
        });
      } else {
        console.error('Error fetching dependency:', error);
        res.status(500).json({
          success: false,
          error: 'Failed to fetch dependency',
        });
      }
    }
  }

  /**
   * POST /api/dependencies
   * Create new dependency (Admin+ only)
   */
  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const dependencyData: CreateDependencyRequest = req.body;

      // Validation
      if (!dependencyData.source_service_id || !dependencyData.target_service_id) {
        throw new ValidationError('Source and target service IDs are required');
      }

      if (dependencyData.source_service_id === dependencyData.target_service_id) {
        throw new ValidationError('Service cannot depend on itself');
      }

      const validTypes = ['runtime', 'data', 'deployment', 'shared-lib'];
      if (!validTypes.includes(dependencyData.dependency_type)) {
        throw new ValidationError(`Invalid dependency type. Must be one of: ${validTypes.join(', ')}`);
      }

      const createdBy = (req as any).user?.email || 'system';
      const organizationId = (req as any).organizationId!;

      const dependency = await repository.create(
        dependencyData,
        createdBy,
        organizationId
      );

      const response: ApiResponse = {
        success: true,
        data: dependency,
        message: 'Dependency created successfully',
      };

      res.status(201).json(response);
    } catch (error) {
      if (error instanceof ValidationError) {
        res.status(400).json({
          success: false,
          error: error.message,
        });
      } else {
        console.error('Error creating dependency:', error);
        res.status(500).json({
          success: false,
          error: 'Failed to create dependency',
        });
      }
    }
  }

  /**
   * PUT /api/dependencies/:id
   * Update dependency (Admin+ only)
   */
  async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const updates: UpdateDependencyRequest = req.body;

      // Validate dependency type if provided
      if (updates.dependency_type) {
        const validTypes = ['runtime', 'data', 'deployment', 'shared-lib'];
        if (!validTypes.includes(updates.dependency_type)) {
          throw new ValidationError(`Invalid dependency type. Must be one of: ${validTypes.join(', ')}`);
        }
      }

      const dependency = await repository.update(id, updates);

      if (!dependency) {
        throw new NotFoundError('Dependency');
      }

      const response: ApiResponse = {
        success: true,
        data: dependency,
        message: 'Dependency updated successfully',
      };

      res.json(response);
    } catch (error) {
      if (error instanceof ValidationError) {
        res.status(400).json({
          success: false,
          error: error.message,
        });
      } else if (error instanceof NotFoundError) {
        res.status(404).json({
          success: false,
          error: error.message,
        });
      } else {
        console.error('Error updating dependency:', error);
        res.status(500).json({
          success: false,
          error: 'Failed to update dependency',
        });
      }
    }
  }

  /**
   * DELETE /api/dependencies/:id
   * Delete dependency (Admin+ only)
   */
  async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const deleted = await repository.delete(id);

      if (!deleted) {
        throw new NotFoundError('Dependency');
      }

      const response: ApiResponse = {
        success: true,
        message: 'Dependency deleted successfully',
      };

      res.json(response);
    } catch (error) {
      if (error instanceof NotFoundError) {
        res.status(404).json({
          success: false,
          error: error.message,
        });
      } else {
        console.error('Error deleting dependency:', error);
        res.status(500).json({
          success: false,
          error: 'Failed to delete dependency',
        });
      }
    }
  }

  /**
   * GET /api/dependencies/graph
   * Get dependency graph formatted for React Flow
   */
  async getGraph(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const graph = await repository.getGraph();

      const response: ApiResponse = {
        success: true,
        data: graph,
      };

      res.json(response);
    } catch (error) {
      console.error('Error fetching dependency graph:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch dependency graph',
      });
    }
  }

  /**
   * GET /api/dependencies/impact/:serviceId
   * Get impact analysis for a service
   */
  async getImpactAnalysis(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { serviceId } = req.params;
      const analysis = await repository.getImpactAnalysis(serviceId);

      const response: ApiResponse = {
        success: true,
        data: analysis,
      };

      res.json(response);
    } catch (error) {
      if ((error as Error).message === 'Service not found') {
        res.status(404).json({
          success: false,
          error: 'Service not found',
        });
      } else {
        console.error('Error fetching impact analysis:', error);
        res.status(500).json({
          success: false,
          error: 'Failed to fetch impact analysis',
        });
      }
    }
  }

  /**
   * GET /api/dependencies/cycles
   * Detect circular dependencies
   */
  async detectCycles(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const cycles = await repository.detectCircularDependencies();

      const response: ApiResponse = {
        success: true,
        data: cycles,
        message: cycles.length > 0
          ? `Found ${cycles.length} circular dependency cycle(s)`
          : 'No circular dependencies detected',
      };

      res.json(response);
    } catch (error) {
      console.error('Error detecting circular dependencies:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to detect circular dependencies',
      });
    }
  }

  /**
   * GET /api/services/:id/dependencies
   * Get dependencies for a specific service
   */
  async getServiceDependencies(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { id } = req.params;
      const dependencies = await repository.getServiceDependencies(id);

      const response: ApiResponse = {
        success: true,
        data: dependencies,
      };

      res.json(response);
    } catch (error) {
      console.error('Error fetching service dependencies:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch service dependencies',
      });
    }
  }
}
