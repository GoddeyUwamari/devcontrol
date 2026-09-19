'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, FileQuestion, RefreshCw } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useSubscription } from '@/lib/hooks/useSubscription';
import { UpgradePrompt } from '@/components/billing/upgrade-prompt';
import { useSoc2Readiness } from '@/lib/hooks/useSoc2Readiness';
import { DispositionBadge } from '@/components/compliance/soc2-badges';
import { Soc2ObservedEvidenceList } from '@/components/compliance/Soc2ObservedEvidenceList';
import { Soc2CustomerEvidenceSection } from '@/components/compliance/Soc2CustomerEvidenceSection';
import { useDemoMode } from '@/components/demo/demo-mode-toggle';
import { useSalesDemo } from '@/lib/demo/sales-demo-data';

/**
 * SOC 2 Readiness detail page. Uses GET /api/soc2/readiness (all six criteria) and
 * GET /api/soc2/evidence?criterionId= (technical evidence per criterion, via
 * Soc2ObservedEvidenceList). This endpoint is NOT Enterprise-gated server-side, so this
 * page's technical readiness view is visible to any authenticated user regardless of
 * tier -- only the Customer-Provided Evidence *management* section below is
 * Enterprise-gated, matching backend/src/routes/soc2-customer-evidence.routes.ts's
 * actual requireEnterprise gate.
 *
 * There is no combined SOC 2 score anywhere on this page, by design -- no combined
 * evaluator exists in the backend (soc2_control_evaluations.customer_evidence_ids
 * remains unused). Each criterion shows its own technical evidence and customer
 * evidence as independent, clearly separated facts.
 */
export default function Soc2ReadinessDetailPage() {
  const router = useRouter();
  const { data: criteria, isLoading, error, refetch } = useSoc2Readiness();
  const { isEnterprise, isLoading: subscriptionLoading } = useSubscription();
  const [activeCriterionId, setActiveCriterionId] = useState<string | null>(null);
  const demoMode = useDemoMode();
  const { enabled: salesDemoMode } = useSalesDemo();
  // Same composed signal useSoc2Readiness()/useSoc2Evidence()/useCustomerEvidenceList()
  // already use internally -- demoMode and salesDemoMode are two independently
  // persisted signals (see those hooks' own docblocks), so the disclosure must react to
  // either one, not useDemoMode() alone.
  const isDemoActive = demoMode || salesDemoMode;

  const selected = criteria?.find((c) => c.criterionId === (activeCriterionId ?? criteria?.[0]?.criterionId));

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6 sm:px-6 sm:py-8 lg:px-14 lg:py-10 max-w-[1320px] mx-auto">
      <button
        type="button"
        onClick={() => router.push('/compliance/frameworks')}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-700 mb-4"
      >
        <ArrowLeft size={13} /> Back to Compliance Frameworks
      </button>

      <div className="mb-6">
        <p className="text-xs font-bold text-violet-600 uppercase tracking-widest mb-1.5">Security / Compliance / SOC 2</p>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight mb-1.5">SOC 2 Readiness</h1>
        <p className="text-xs text-slate-500 font-medium leading-relaxed max-w-2xl">
          Technical evidence DevControl observes from your connected AWS account, and supporting evidence your
          organization provides. This is supplementary readiness evidence — not a SOC 2 certification, Type II audit,
          or auditor approval.
        </p>
        {isDemoActive && (
          <p className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-3 max-w-2xl">
            Sample data for demonstration — not evidence from a real AWS account.
          </p>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-10 w-full max-w-xl" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4 flex items-center justify-between gap-3">
          <p className="text-sm text-red-600">{error instanceof Error ? error.message : 'Failed to load SOC 2 readiness'}</p>
          <button
            type="button"
            onClick={() => refetch()}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-700 hover:text-red-800 shrink-0"
          >
            <RefreshCw size={12} /> Retry
          </button>
        </div>
      ) : !criteria || criteria.length === 0 ? (
        <EmptyState
          icon={FileQuestion}
          title="No SOC 2 criteria configured"
          description="SOC 2 Readiness criteria are not currently available."
        />
      ) : (
        <Tabs
          value={selected?.criterionId}
          onValueChange={setActiveCriterionId}
          className="w-full"
        >
          <TabsList className="flex-wrap h-auto justify-start mb-4">
            {criteria.map((c) => (
              <TabsTrigger key={c.criterionId} value={c.criterionId} className="text-xs">
                {c.criterionId}
              </TabsTrigger>
            ))}
          </TabsList>

          {criteria.map((c) => (
            <TabsContent key={c.criterionId} value={c.criterionId} className="space-y-5">
              {/* Criterion summary */}
              <div className="bg-white rounded-xl border border-slate-200 p-5 sm:p-7">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <span className="text-xs font-bold px-2 py-0.5 rounded bg-violet-50 text-violet-700">{c.criterionId}</span>
                  <DispositionBadge dispositionClass={c.dispositionClass} />
                </div>
                <p className="text-sm font-semibold text-slate-900 mb-2">{c.name}</p>
                <p className="text-xs text-slate-700 leading-relaxed mb-1.5">{c.evidenceClaim}</p>
                <p className="text-xs text-slate-400 leading-relaxed mb-4">{c.limitation}</p>

                {c.evaluated && c.evidenceSummary ? (
                  <div className="text-xs text-slate-600 leading-relaxed border-t border-slate-100 pt-3">
                    <span className="font-semibold text-emerald-700">{c.evidenceSummary.supports} supports</span>
                    {' · '}
                    <span className="font-semibold text-red-600">{c.evidenceSummary.contradicts} contradicts</span>
                    {' · '}
                    <span>{c.evidenceSummary.unknown} unknown</span>
                    {c.computedAt && (
                      <p className="text-xs text-slate-400 mt-1">Evaluation computed at {new Date(c.computedAt).toLocaleString()}</p>
                    )}
                  </div>
                ) : (
                  <div className="border-t border-slate-100 pt-3">
                    <p className="text-xs font-medium text-slate-500">Not yet evaluated</p>
                    <p className="text-xs text-slate-400 mt-0.5">No technical evaluation has been computed for this criterion yet.</p>
                  </div>
                )}
              </div>

              {/* AWS-Observed Evidence */}
              <div className="bg-white rounded-xl border border-slate-200 p-5 sm:p-7">
                <p className="text-xs font-bold text-blue-600 uppercase tracking-widest mb-1">AWS-Observed Evidence</p>
                <p className="text-xs text-slate-500 mb-4">Technical facts DevControl observed directly from your connected AWS account.</p>
                <Soc2ObservedEvidenceList criterionId={c.criterionId} />
              </div>

              {/* Customer-Provided Evidence (Enterprise-gated) */}
              {subscriptionLoading ? (
                <Skeleton className="h-32 w-full" />
              ) : isEnterprise ? (
                <Soc2CustomerEvidenceSection criterionId={c.criterionId} criteria={criteria} canManage />
              ) : (
                <UpgradePrompt
                  variant="card"
                  title="Customer-Provided Evidence"
                  description="Submit your own supporting evidence — policies, procedures, training records, and attestations — for SOC 2 Readiness criteria."
                  requiredTier="enterprise"
                  feature="Customer evidence management"
                />
              )}
            </TabsContent>
          ))}
        </Tabs>
      )}
    </div>
  );
}
