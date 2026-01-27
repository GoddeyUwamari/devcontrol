import { Request, Response, NextFunction } from 'express';
import { Pool } from 'pg';
import { AWSResourcesRepository } from '../repositories/awsResources.repository';
import { AWSResourceDiscoveryService } from '../services/awsResourceDiscovery';
import { AWSResourcesExportService } from '../services/awsResourcesExport.service';
import { ApiResponse } from '../types/api.types';
import { ResourceFilters } from '../types/aws-resources.types';
import { ExportFormat, ExportColumn } from '../types/export.types';

export class AWSResourcesController {
  private repository: AWSResourcesRepository;
  private discoveryService: AWSResourceDiscoveryService;

  constructor(private pool: Pool) {
    this.repository = new AWSResourcesRepository(pool);
    this.discoveryService = new AWSResourceDiscoveryService(pool);
  }

  /**
   * GET /api/aws-resources
   * List all AWS resources with optional filters
   */
  async getAll(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = (req as any).user?.organizationId;
      if (!organizationId) {
        res.status(400).json({
          success: false,
          message: 'Organization ID not found',
          data: null,
          timestamp: new Date().toISOString(),
        } as ApiResponse<null>);
        return;
      }

      const filters: ResourceFilters = {
        resource_type: req.query.resource_type as any,
        region: req.query.region as string,
        status: req.query.status as any,
        is_encrypted: req.query.is_encrypted === 'true' ? true : req.query.is_encrypted === 'false' ? false : undefined,
        is_public: req.query.is_public === 'true' ? true : req.query.is_public === 'false' ? false : undefined,
        has_backup: req.query.has_backup === 'true' ? true : req.query.has_backup === 'false' ? false : undefined,
        search: req.query.search as string,
        page: req.query.page ? parseInt(req.query.page as string) : 1,
        limit: req.query.limit ? parseInt(req.query.limit as string) : 50,
      };

      const result = await this.repository.findAll(organizationId, filters);

      res.json({
        success: true,
        message: 'Resources retrieved successfully',
        data: result,
        timestamp: new Date().toISOString(),
      } as ApiResponse<typeof result>);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/aws-resources/stats
   * Get resource statistics
   */
  async getStats(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = (req as any).user?.organizationId;
      if (!organizationId) {
        res.status(400).json({
          success: false,
          message: 'Organization ID not found',
          data: null,
          timestamp: new Date().toISOString(),
        } as ApiResponse<null>);
        return;
      }

      const stats = await this.repository.getStats(organizationId);

      res.json({
        success: true,
        message: 'Statistics retrieved successfully',
        data: stats,
        timestamp: new Date().toISOString(),
      } as ApiResponse<typeof stats>);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/aws-resources/compliance
   * Get all compliance issues
   */
  async getComplianceIssues(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = (req as any).user?.organizationId;
      if (!organizationId) {
        res.status(400).json({
          success: false,
          message: 'Organization ID not found',
          data: null,
          timestamp: new Date().toISOString(),
        } as ApiResponse<null>);
        return;
      }

      const issues = await this.repository.getComplianceIssues(organizationId);

      res.json({
        success: true,
        message: 'Compliance issues retrieved successfully',
        data: issues,
        timestamp: new Date().toISOString(),
      } as ApiResponse<typeof issues>);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/aws-resources/orphaned
   * Get orphaned resources
   */
  async getOrphaned(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = (req as any).user?.organizationId;
      if (!organizationId) {
        res.status(400).json({
          success: false,
          message: 'Organization ID not found',
          data: null,
          timestamp: new Date().toISOString(),
        } as ApiResponse<null>);
        return;
      }

      const orphaned = await this.repository.getOrphaned(organizationId);

      res.json({
        success: true,
        message: 'Orphaned resources retrieved successfully',
        data: orphaned,
        timestamp: new Date().toISOString(),
      } as ApiResponse<typeof orphaned>);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/aws-resources/:id
   * Get single resource by ID
   */
  async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const organizationId = (req as any).user?.organizationId;

      if (!organizationId) {
        res.status(400).json({
          success: false,
          message: 'Organization ID not found',
          data: null,
          timestamp: new Date().toISOString(),
        } as ApiResponse<null>);
        return;
      }

      const resource = await this.repository.findById(id, organizationId);

      if (!resource) {
        res.status(404).json({
          success: false,
          message: 'Resource not found',
          data: null,
          timestamp: new Date().toISOString(),
        } as ApiResponse<null>);
        return;
      }

      res.json({
        success: true,
        message: 'Resource retrieved successfully',
        data: resource,
        timestamp: new Date().toISOString(),
      } as ApiResponse<typeof resource>);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/aws-resources/discover
   * Trigger resource discovery scan
   */
  async discover(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = (req as any).user?.organizationId;
      if (!organizationId) {
        res.status(400).json({
          success: false,
          message: 'Organization ID not found',
          data: null,
          timestamp: new Date().toISOString(),
        } as ApiResponse<null>);
        return;
      }

      // Run discovery in background (don't await)
      this.discoveryService.discoverAllResources(organizationId)
        .then(result => {
          console.log('[Discovery] Completed:', result);
        })
        .catch(error => {
          console.error('[Discovery] Failed:', error);
        });

      res.json({
        success: true,
        message: 'Resource discovery started',
        data: {
          status: 'running',
          message: 'Discovery scan has been initiated. Results will be available shortly.',
        },
        timestamp: new Date().toISOString(),
      } as ApiResponse<any>);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/aws-resources/discovery/jobs
   * Get discovery job history
   */
  async getDiscoveryJobs(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = (req as any).user?.organizationId;
      if (!organizationId) {
        res.status(400).json({
          success: false,
          message: 'Organization ID not found',
          data: null,
          timestamp: new Date().toISOString(),
        } as ApiResponse<null>);
        return;
      }

      const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;
      const jobs = await this.repository.getDiscoveryJobs(organizationId, limit);

      res.json({
        success: true,
        message: 'Discovery jobs retrieved successfully',
        data: jobs,
        timestamp: new Date().toISOString(),
      } as ApiResponse<typeof jobs>);
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /api/aws-resources/:id
   * Delete resource tracking (not the actual AWS resource)
   */
  async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const organizationId = (req as any).user?.organizationId;

      if (!organizationId) {
        res.status(400).json({
          success: false,
          message: 'Organization ID not found',
          data: null,
          timestamp: new Date().toISOString(),
        } as ApiResponse<null>);
        return;
      }

      const deleted = await this.repository.delete(id, organizationId);

      if (!deleted) {
        res.status(404).json({
          success: false,
          message: 'Resource not found',
          data: null,
          timestamp: new Date().toISOString(),
        } as ApiResponse<null>);
        return;
      }

      res.json({
        success: true,
        message: 'Resource tracking deleted successfully',
        data: { id },
        timestamp: new Date().toISOString(),
      } as ApiResponse<{ id: string }>);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/aws-resources/export
   * Export AWS resources to CSV or PDF
   */
  async exportResources(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = (req as any).user?.organizationId;
      const { format, columns, filters } = req.body;

      // Validation
      if (!organizationId) {
        res.status(400).json({
          success: false,
          message: 'Organization ID not found',
          data: null,
          timestamp: new Date().toISOString(),
        } as ApiResponse<null>);
        return;
      }

      if (!format || !['csv', 'pdf'].includes(format)) {
        res.status(400).json({
          success: false,
          message: 'Invalid format. Must be csv or pdf',
          data: null,
          timestamp: new Date().toISOString(),
        } as ApiResponse<null>);
        return;
      }

      if (!columns || !Array.isArray(columns) || columns.length === 0) {
        res.status(400).json({
          success: false,
          message: 'At least one column must be selected',
          data: null,
          timestamp: new Date().toISOString(),
        } as ApiResponse<null>);
        return;
      }

      // Generate export
      const exportService = new AWSResourcesExportService(this.pool);
      const fileBuffer =
        format === 'csv'
          ? await exportService.generateCSV(organizationId, filters || {}, columns)
          : await exportService.generatePDF(organizationId, filters || {}, columns);

      // Generate filename with timestamp
      const now = new Date();
      const timestamp = now
        .toISOString()
        .slice(0, 16)
        .replace(/[T:]/g, '-');
      const filename = `aws-resources-${timestamp}.${format}`;

      // Set response headers for file download
      res.setHeader('Content-Type', format === 'csv' ? 'text/csv' : 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', fileBuffer.length.toString());

      // Send file
      res.send(fileBuffer);
    } catch (error) {
      next(error);
    }
  }
}
