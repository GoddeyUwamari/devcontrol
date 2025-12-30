import { Request, Response } from 'express';
import { DeploymentsRepository } from '../repositories/deployments.repository';
import { CreateDeploymentRequest, DeploymentFilters, ApiResponse } from '../types';
import { DeploymentEvents } from '../services/deploymentEvents';
import { WebSocketServer } from '../websocket/server';

const repository = new DeploymentsRepository();

export class DeploymentsController {
  async getAll(req: Request, res: Response): Promise<void> {
    try {
      const filters: DeploymentFilters = {
        service_id: req.query.service_id as string,
        environment: req.query.environment as string,
        status: req.query.status as string,
        limit: req.query.limit ? parseInt(req.query.limit as string) : 50,
        offset: req.query.offset ? parseInt(req.query.offset as string) : 0,
      };

      const { deployments, total } = await repository.findAll(filters);

      const response: ApiResponse = {
        success: true,
        data: deployments,
        total,
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
      const deployment = await repository.findById(id);

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

      const deployment = await repository.create(deploymentData);

      // Emit WebSocket event for deployment started
      try {
        const wsServer: WebSocketServer = req.app.get('wsServer');
        if (wsServer) {
          const deploymentEvents = new DeploymentEvents(wsServer);
          const organizationId = (req as any).organizationId || 'default-org';

          deploymentEvents.deploymentStarted(organizationId, {
            id: deployment.id,
            service_name: deployment.service_name || 'Unknown Service',
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
      const deleted = await repository.delete(id);

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
