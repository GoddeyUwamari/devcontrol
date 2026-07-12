import api, { handleApiResponse } from '../api';

export type ActivityEventType = 'sync' | 'optimization' | 'security' | 'score' | 'anomaly';

export interface ActivityEvent {
  type: ActivityEventType;
  message: string;
  timestamp: string;
  severity?: string;
}

export const activityFeedService = {
  getActivity: async (): Promise<ActivityEvent[]> => {
    const response = await api.get('/api/platform/activity');
    return handleApiResponse(response);
  },
};
