import { Request, Response } from 'express';
import {
  AccountSecurityFindingsRepository,
  AccountFindingCategory,
} from '../repositories/account-security-findings.repository';
import { ApiResponse } from '../types';
import { ComplianceSeverity } from '../types/aws-resources.types';

const repository = new AccountSecurityFindingsRepository();

export class AccountSecurityFindingsController {
  /**
   * GET /api/security/account-findings
   * Get active account-level security findings (security groups, IAM) with optional filters
   */
  async getActive(req: Request, res: Response): Promise<void> {
    try {
      const organizationId = (req as any).user?.organizationId;
      if (!organizationId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const findings = await repository.getActive(organizationId, {
        category: req.query.category as AccountFindingCategory | undefined,
        severity: req.query.severity as ComplianceSeverity | undefined,
        limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
      });

      const response: ApiResponse = {
        success: true,
        data: findings,
        total: findings.length,
      };

      res.json(response);
    } catch (error) {
      console.error('Error fetching account security findings:', error);
      const response: ApiResponse = {
        success: false,
        error: 'Failed to fetch account security findings',
      };
      res.status(500).json(response);
    }
  }

  /**
   * GET /api/security/account-findings/stats
   * Get active-finding counts by severity and category
   */
  async getStats(req: Request, res: Response): Promise<void> {
    try {
      const organizationId = (req as any).user?.organizationId;
      if (!organizationId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const stats = await repository.getStats(organizationId);

      const response: ApiResponse = {
        success: true,
        data: stats,
      };

      res.json(response);
    } catch (error) {
      console.error('Error fetching account security finding stats:', error);
      const response: ApiResponse = {
        success: false,
        error: 'Failed to fetch account security finding statistics',
      };
      res.status(500).json(response);
    }
  }
}
