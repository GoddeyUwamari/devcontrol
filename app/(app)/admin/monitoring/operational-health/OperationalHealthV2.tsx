'use client'

import { useState } from 'react'
import { usePlan } from '@/lib/hooks/use-plan'
import { SEE_PLANS } from '@/lib/plan/tier-required'
import type { MonitoringRange, PlanInfo } from './observabilityTypes'
import { bannerView, headerView, monitorView, tilesView, typeCards } from './operationalHealthModel'
import { DEFAULT_RANGE } from './operationalHealthCopy'
import { useOperationalHealthData } from './useOperationalHealthData'
import { useSloSummary } from './useSloSummary'
import { HealthHeader } from './HealthHeader'
import { HealthBanner } from './HealthBanner'
import { HealthTiles } from './HealthTiles'
import { TypeCards } from './TypeCards'
import { WhatWeMonitor } from './WhatWeMonitor'
import { RelatedLinks } from './RelatedLinks'
import { ResourceTable } from './ResourceTable'
import { tableView } from './resourceTableModel'
import { ActiveAlarms } from './ActiveAlarms'
import { alarmsListView } from './alarmsListModel'
import { ResponseTimeChart } from './ResponseTimeChart'
import { responseTimeView } from './responseTimeModel'

/**
 * The Operational Health page (NEXT_PUBLIC_OBSERVABILITY_V2), on every plan. Reads
 * GET /api/observability/resources and /alarms (useOperationalHealthData) and,
 * on Enterprise, GET /api/slos/evaluate once (useSloSummary). Never the legacy
 * /api/cloudwatch/* or /api/prometheus/* routes. O1: the top of the page; O2:
 * the Resource checks table; O3a: the Active alarms list (the same alarms answer
 * and retry as the tile); O3b: the load balancer response-time chart under the table
 * (from the same resources answer; nothing when no load balancer has data).
 */
export default function OperationalHealthV2() {
  const [range, setRange] = useState<MonitoringRange>(DEFAULT_RANGE)
  const { resources, alarms, busy, refresh, retryAlarms, table, tableSource, setTable } = useOperationalHealthData(range)
  const planHook = usePlan()
  const plan: PlanInfo = { status: planHook.status, tier: planHook.tier }
  const { slo, retry: retrySlo } = useSloSummary(plan)

  const monitor = monitorView(resources, alarms, slo, plan, SEE_PLANS)
  // A new range starts the table at page 1; the search and filter are kept.
  const onRange = (next: MonitoringRange) => {
    setRange(next)
    setTable({ page: 1 })
  }
  return (
    <main className="mx-auto flex max-w-[1240px] flex-col gap-5 px-4 py-6 sm:px-6">
      <HealthHeader view={headerView(resources, alarms)} range={range} onRange={onRange} onRefresh={refresh} busy={busy} />
      <HealthBanner banner={bannerView(resources, alarms)} onRetry={refresh} />
      <HealthTiles tiles={tilesView(resources, alarms)} onRetry={refresh} onRetryAlarms={retryAlarms} />
      <ActiveAlarms view={alarmsListView(alarms, resources)} onRetry={retryAlarms} />
      <TypeCards cards={typeCards(resources)} />
      <ResourceTable view={tableView(tableSource.source, tableSource.query, undefined, resources)} query={table} onQuery={setTable} onRetry={refresh} />
      <ResponseTimeChart view={responseTimeView(resources)} />
      <WhatWeMonitor groups={monitor.groups} planNote={monitor.planNote} seePlans={SEE_PLANS} onRetryAlarms={retryAlarms} onRetrySlo={retrySlo} />
      <RelatedLinks />
    </main>
  )
}
