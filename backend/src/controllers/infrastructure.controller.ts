import { Request, Response } from 'express';
import { AWSResourcesRepository } from '../repositories/awsResources.repository';
import { InfrastructureRepository } from '../repositories/infrastructure.repository';
import { CreateInfrastructureRequest, InfrastructureFilters, ApiResponse } from '../types';
import awsCostService from '../services/aws-cost.service';
import { pool } from '../config/database';

const repository = new InfrastructureRepository();
const awsRepository = new AWSResourcesRepository(pool);

export class InfrastructureController {
  async getAll(req: Request, res: Response): Promise<void> {
    try {
      const organizationId = (req as any).user?.organizationId;

      if (organizationId) {
        const filters: any = {};
        if (req.query.resource_type) {
          filters.resource_type = req.query.resource_type as string;
        }
        if (req.query.status) {
          filters.status = req.query.status as string;
        }

        const result = await awsRepository.findAll(organizationId, filters);

        const mapped = result.resources.map((r: any) => ({
          id: r.id,
          serviceId: r.id,
          serviceName:
            r.resource_name ||
            r.resourceName ||
            r.resource_id ||
            r.resourceId ||
            r.resource_type ||
            'Unknown',
          resourceType:
            r.resource_type ||
            r.resourceType ||
            'unknown',
          awsId:
            r.resource_id ||
            r.resourceId ||
            r.resource_arn ||
            r.resourceArn ||
            '—',
          awsRegion:
            r.region ||
            r.aws_region ||
            r.awsRegion ||
            '—',
          status:
            (() => {
              const s = (
                r.status ||
                r.resource_status ||
                ''
              ).toLowerCase()
              return s === 'available' ||
                s === 'running' ||
                s === 'active' ||
                s === 'in-use'
                  ? 'running'
                  : s === 'stopped'
                    ? 'stopped'
                    : s
                      ? 'pending'
                      : 'running'
            })(),
          costPerMonth: parseFloat(r.estimated_monthly_cost) || 0,
          metadata: r.metadata,
          createdAt: r.created_at || new Date().toISOString(),
          updatedAt: r.updated_at || new Date().toISOString(),
        }));

        res.json({ success: true, data: mapped });
        return;
      }

      // Fallback to original repository for unauthenticated or legacy
      const infraFilters: InfrastructureFilters = {
        service_id: req.query.service_id as string,
        resource_type: req.query.resource_type as string,
        status: req.query.status as string,
        limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
        offset: req.query.offset ? parseInt(req.query.offset as string) : undefined,
      };

      const resources = await repository.findAll(infraFilters);

      res.json({ success: true, data: resources });
    } catch (error) {
      console.error('Error fetching infrastructure:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch infrastructure resources',
      });
    }
  }

  async getById(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const resource = await repository.findById(id);

      if (!resource) {
        const response: ApiResponse = {
          success: false,
          error: 'Infrastructure resource not found',
        };
        res.status(404).json(response);
        return;
      }

      const response: ApiResponse = {
        success: true,
        data: resource,
      };

      res.json(response);
    } catch (error) {
      console.error('Error fetching infrastructure resource:', error);
      const response: ApiResponse = {
        success: false,
        error: 'Failed to fetch infrastructure resource',
      };
      res.status(500).json(response);
    }
  }

  async create(req: Request, res: Response): Promise<void> {
    try {
      const resourceData: CreateInfrastructureRequest = req.body;

      // Validate required fields
      if (!resourceData.service_id || !resourceData.resource_type ||
          !resourceData.aws_id || !resourceData.aws_region ||
          !resourceData.status || resourceData.cost_per_month === undefined) {
        const response: ApiResponse = {
          success: false,
          error: 'Missing required fields: service_id, resource_type, aws_id, aws_region, status, cost_per_month',
        };
        res.status(400).json(response);
        return;
      }

      const resource = await repository.create(resourceData);

      const response: ApiResponse = {
        success: true,
        data: resource,
        message: 'Infrastructure resource created successfully',
      };

      res.status(201).json(response);
    } catch (error) {
      console.error('Error creating infrastructure resource:', error);
      const response: ApiResponse = {
        success: false,
        error: 'Failed to create infrastructure resource',
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
          error: 'Infrastructure resource not found',
        };
        res.status(404).json(response);
        return;
      }

      const response: ApiResponse = {
        success: true,
        message: 'Infrastructure resource deleted successfully',
      };

      res.json(response);
    } catch (error) {
      console.error('Error deleting infrastructure resource:', error);
      const response: ApiResponse = {
        success: false,
        error: 'Failed to delete infrastructure resource',
      };
      res.status(500).json(response);
    }
  }

  async getCosts(req: Request, res: Response): Promise<void> {
    try {
      const costBreakdown = await repository.getCostBreakdown();

      const response: ApiResponse = {
        success: true,
        data: costBreakdown,
      };

      res.json(response);
    } catch (error) {
      console.error('Error fetching cost breakdown:', error);
      const response: ApiResponse = {
        success: false,
        error: 'Failed to fetch cost breakdown',
      };
      res.status(500).json(response);
    }
  }

  async syncAWS(req: Request, res: Response): Promise<void> {
    try {
      // Check if AWS credentials are configured
      const isConfigured = process.env.AWS_ACCESS_KEY_ID &&
                          process.env.AWS_SECRET_ACCESS_KEY &&
                          process.env.AWS_REGION;

      if (!isConfigured) {
        const response: ApiResponse = {
          success: false,
          error: 'AWS credentials not configured. Please set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and AWS_REGION in environment variables.',
        };
        res.status(400).json(response);
        return;
      }

      // Fetch monthly costs from AWS Cost Explorer
      let awsCosts;
      try {
        awsCosts = await awsCostService.fetchMonthlyCosts();
      } catch (error: any) {
        // Check if it's a Cost Explorer not enabled error
        if (error.message && error.message.includes('not enabled')) {
          const response: ApiResponse = {
            success: false,
            error: 'AWS Cost Explorer is not enabled. Please enable it in your AWS account.',
          };
          res.status(503).json(response);
          return;
        }

        // Generic AWS API error
        console.error('AWS API error:', error);
        const response: ApiResponse = {
          success: false,
          error: `AWS API error: ${error.message || 'Unknown error'}`,
        };
        res.status(502).json(response);
        return;
      }

      // Update or insert AWS cost total in database
      const awsId = 'cost-explorer-total';
      const resourceType = 'AWS_COST_TOTAL';

      // Check if record exists
      const existingRecord = await pool.query(
        'SELECT id FROM infrastructure_resources WHERE aws_id = $1 AND resource_type = $2',
        [awsId, resourceType]
      );

      const now = new Date();
      let resourcesSynced = 0;

      if (existingRecord.rows.length > 0) {
        // Update existing record
        await pool.query(
          `UPDATE infrastructure_resources
           SET cost_per_month = $1, status = $2, updated_at = $3, metadata = $4
           WHERE aws_id = $5 AND resource_type = $6`,
          [
            awsCosts.total,
            'Active',
            now,
            JSON.stringify({
              last_synced_at: now.toISOString(),
              period: awsCosts.period,
              by_service: awsCosts.byService,
            }),
            awsId,
            resourceType,
          ]
        );
        resourcesSynced = 1;
      } else {
        // Insert new record
        await pool.query(
          `INSERT INTO infrastructure_resources
           (service_id, resource_type, aws_id, aws_region, status, cost_per_month, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            null,
            resourceType,
            awsId,
            process.env.AWS_REGION || 'us-east-1',
            'Active',
            awsCosts.total,
            JSON.stringify({
              last_synced_at: now.toISOString(),
              period: awsCosts.period,
              by_service: awsCosts.byService,
            }),
          ]
        );
        resourcesSynced = 1;
      }

      const response: ApiResponse = {
        success: true,
        data: {
          resourcesSynced,
          totalCost: awsCosts.total,
          lastSyncedAt: now.toISOString(),
          period: awsCosts.period,
          byService: awsCosts.byService,
        },
        message: 'Successfully synced AWS resources',
      };

      res.json(response);
    } catch (error) {
      console.error('Error syncing AWS resources:', error);
      const response: ApiResponse = {
        success: false,
        error: 'Failed to sync AWS resources',
      };
      res.status(500).json(response);
    }
  }
}
