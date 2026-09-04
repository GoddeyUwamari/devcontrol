import { Request, Response } from 'express';
import {
  AccountSecurityFindingsRepository,
  AccountFindingCategory,
  AccountFindingDisposition,
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

  /**
   * POST /api/security/account-findings/:id/acknowledge
   * Records that a user has seen this finding. Does not require a note and does
   * not change AWS infrastructure or the finding's system-owned observation status.
   */
  async acknowledge(req: Request, res: Response): Promise<void> {
    await this.applyDisposition(req, res, 'acknowledged', { requireNote: false });
  }

  /**
   * POST /api/security/account-findings/:id/dismiss
   * Records that a user has dismissed this finding. Requires a non-empty note
   * justifying the dismissal.
   */
  async dismiss(req: Request, res: Response): Promise<void> {
    await this.applyDisposition(req, res, 'dismissed', { requireNote: true });
  }

  /**
   * POST /api/security/account-findings/:id/accept-risk
   * Records that a user has accepted the risk this finding represents. Requires
   * a non-empty note justifying the acceptance.
   */
  async acceptRisk(req: Request, res: Response): Promise<void> {
    await this.applyDisposition(req, res, 'accepted_risk', { requireNote: true });
  }

  private async applyDisposition(
    req: Request,
    res: Response,
    disposition: AccountFindingDisposition,
    options: { requireNote: boolean }
  ): Promise<void> {
    try {
      const organizationId = (req as any).user?.organizationId;
      const actorId = (req as any).user?.userId;
      if (!organizationId || !actorId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const findingId = req.params.id;
      const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';

      if (options.requireNote && note.length === 0) {
        res.status(400).json({
          success: false,
          error: `A non-empty note is required to ${disposition === 'accepted_risk' ? 'accept risk for' : disposition} this finding`,
        });
        return;
      }

      const result = await repository.setDisposition(
        organizationId,
        findingId,
        disposition,
        actorId,
        note.length > 0 ? note : null
      );

      if (result.outcome === 'not_found') {
        res.status(404).json({ success: false, error: 'Finding not found' });
        return;
      }

      if (result.outcome === 'resolved') {
        res.status(409).json({
          success: false,
          error: 'This finding is already verified resolved and cannot be dispositioned',
        });
        return;
      }

      const response: ApiResponse = { success: true, data: result.finding };
      res.json(response);
    } catch (error) {
      console.error(`Error applying ${disposition} disposition:`, error);
      const response: ApiResponse = {
        success: false,
        error: `Failed to ${disposition === 'accepted_risk' ? 'accept risk for' : disposition} finding`,
      };
      res.status(500).json(response);
    }
  }
}
