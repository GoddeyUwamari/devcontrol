import { useQuery } from '@tanstack/react-query';
import { activityFeedService, ActivityEvent } from '@/lib/services/activity-feed.service';

export function useActivityFeed(organizationId?: string, enabled = true) {
  return useQuery<ActivityEvent[]>({
    queryKey: ['activity-feed', organizationId],
    queryFn: () => activityFeedService.getActivity(),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
    enabled: enabled && !!organizationId,
  });
}
