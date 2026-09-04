import { useQuery } from '@tanstack/react-query';
import {
  accountSecurityFindingsService,
  AccountSecurityFinding,
  AccountFindingStats,
} from '@/lib/services/account-security-findings.service';

/**
 * Hook to fetch active account-level security findings (security groups, IAM).
 * `limit` is passed straight through to the API's optional query param — pass
 * `undefined` (the default) to fetch the full, unlimited list. Do not give this
 * a small default: a caller silently limiting the list must show an explicit
 * count so it can't be mistaken for the full set.
 */
export function useAccountSecurityFindings(limit?: number, enabled = true) {
  return useQuery<AccountSecurityFinding[]>({
    queryKey: ['account-security-findings', limit],
    queryFn: () => accountSecurityFindingsService.getActive({ limit }),
    staleTime: 5 * 60 * 1000,       // 5 minutes
    refetchInterval: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: false,
    retry: false,
    enabled,
  });
}

/**
 * Hook to fetch active-finding counts by severity/category
 */
export function useAccountSecurityFindingStats(enabled = true) {
  return useQuery<AccountFindingStats>({
    queryKey: ['account-security-findings-stats'],
    queryFn: () => accountSecurityFindingsService.getStats(),
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
    enabled,
  });
}
