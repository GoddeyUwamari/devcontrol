import { useQuery } from '@tanstack/react-query';
import { soc2Service, Soc2Observation, Soc2ReadinessCriterion, Soc2ReadinessDetail } from '@/lib/services/soc2.service';
import { useDemoMode } from '@/components/demo/demo-mode-toggle';
import { useSalesDemo } from '@/lib/demo/sales-demo-data';
import { useAuth } from '@/lib/contexts/auth-context';
import { DEMO_SOC2_READINESS, DEMO_SOC2_OBSERVATIONS } from '@/lib/demo-data/soc2-demo-data';

/**
 * Technical (AWS-observed) SOC 2 readiness -- GET /api/soc2/readiness. This endpoint is
 * authenticated but NOT Enterprise-gated server-side; do not wrap this hook's consumer
 * in any tier check.
 *
 * Demo mode: composes the app-wide REACTIVE useDemoMode() (never the one-shot
 * demoModeService.isEnabled()) together with useSalesDemo() -- these are two
 * independently-persisted signals (devcontrol_demo_mode in localStorage vs. the
 * 'sales-demo-mode' Zustand store), and salesDemoMode can be true while demoMode is
 * false (see frameworks/page.tsx / app/(app)/layout.tsx, which already OR the two for
 * exactly this reason). isDemoActive = demoMode || salesDemoMode, matching that same
 * established convention, so a Sales Demo-only session also gets the sample dataset
 * instead of silently falling through to the real endpoint. Both sources are reactive
 * (useDemoMode()'s 'demo-mode-changed' listener; useSalesDemo()'s Zustand subscription),
 * so a toggle mid-session in either direction switches this hook's return value cleanly
 * with no stale rows.
 *
 * The real query's `enabled` flag is set to false while demo mode is active, so the
 * real endpoint is never called and the real ['soc2-readiness', organizationId] query
 * cache entry is never written to with demo data -- this hook simply returns the sample
 * dataset directly, bypassing the query cache entirely, so it can never later be served
 * back as if it were real customer data.
 *
 * Keyed by organization (and disabled until it's known) so one organization's readiness
 * can never be served from cache to another's session.
 */
export function useSoc2Readiness(enabled = true) {
  const demoMode = useDemoMode();
  const { enabled: salesDemoMode } = useSalesDemo();
  const { organization } = useAuth();
  const isDemoActive = demoMode || salesDemoMode;
  const query = useQuery<Soc2ReadinessCriterion[]>({
    queryKey: ['soc2-readiness', organization?.id],
    queryFn: () => soc2Service.getReadiness(),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
    enabled: enabled && !isDemoActive && !!organization?.id,
  });

  if (isDemoActive) {
    return {
      data: DEMO_SOC2_READINESS,
      isLoading: false,
      error: null,
      refetch: () => {},
    };
  }

  return query;
}

export function useSoc2ReadinessDetail(criterionId: string, enabled = true) {
  return useQuery<Soc2ReadinessDetail>({
    queryKey: ['soc2-readiness', criterionId],
    queryFn: () => soc2Service.getReadinessDetail(criterionId),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
    enabled: enabled && !!criterionId,
  });
}

/**
 * AWS-observed evidence (Phase 2), optionally filtered by criterion. Deliberately a
 * separate query key from customer evidence -- see useCustomerEvidence.ts's docblock.
 *
 * Demo mode: same convention as useSoc2Readiness() above -- isDemoActive composes both
 * useDemoMode() and useSalesDemo() (see that hook's own docblock for why), real endpoint
 * never called, real query cache never written with demo data, filtered by criterionId
 * exactly like the real soc2Service.getEvidence(criterionId) does.
 */
export function useSoc2Evidence(criterionId?: string, enabled = true) {
  const demoMode = useDemoMode();
  const { enabled: salesDemoMode } = useSalesDemo();
  const isDemoActive = demoMode || salesDemoMode;
  const query = useQuery<Soc2Observation[]>({
    queryKey: ['soc2-evidence', criterionId ?? null],
    queryFn: () => soc2Service.getEvidence(criterionId),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
    enabled: enabled && !isDemoActive,
  });

  if (isDemoActive) {
    const data = criterionId
      ? DEMO_SOC2_OBSERVATIONS.filter((o) => o.criterionId === criterionId)
      : DEMO_SOC2_OBSERVATIONS;
    return { data, isLoading: false, error: null, refetch: () => {} };
  }

  return query;
}
