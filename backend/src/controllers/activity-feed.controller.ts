import { Request, Response } from 'express';
import { ActivityFeedService } from '../services/activity-feed.service';

const service = new ActivityFeedService();

export class ActivityFeedController {
  /**
   * GET /api/platform/activity
   */
  async getActivity(req: Request, res: Response): Promise<void> {
    const organizationId = (req as any).user?.organizationId;
    if (!organizationId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    try {
      const events = await service.getActivityFeed(organizationId);
      res.json({ success: true, data: events });
    } catch (error: any) {
      console.error('[Activity Feed] Controller error:', error.message);
      res.status(500).json({ success: false, error: 'Failed to fetch activity feed' });
    }
  }
}
