'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts'
import { Users, DollarSign, TrendingUp, Lock, Download } from 'lucide-react'
import { usePlan } from '@/lib/hooks/use-plan'
import { useDemoMode } from '@/components/demo/demo-mode-toggle'
import { useSalesDemo } from '@/lib/demo/sales-demo-data'
import { platformStatsService } from '@/lib/services/platform-stats.service'
import awsAccountsService from '@/lib/services/aws-accounts.service'
import type { PlatformDashboardStats } from '@/lib/types'
import Link from 'next/link'
import { annualizeMonthly } from '@/lib/utils'
import { describeStatsSpend } from '../cost-display'
import { demoAttributionCsv, demoAttributionCsvFilename } from './demo-attribution-csv'

// ── Demo data ─────────────────────────────────────────────────────────────────

const DEMO_DATA = {
  total_monthly_cost: 94280,
  by_team: [
    { team_name: 'Platform Engineering', cost: 32400 },
    { team_name: 'Backend API',          cost: 24600 },
    { team_name: 'Data & Analytics',     cost: 18900 },
    { team_name: 'Frontend',             cost: 9800  },
    { team_name: 'DevOps',               cost: 8580  },
  ],
  by_service: [
    { service_name: 'analytics-worker',    cost: 12400 },
    { service_name: 'api-gateway',         cost: 11200 },
    { service_name: 'payment-processor',   cost: 9800  },
    { service_name: 'auth-service',        cost: 8600  },
    { service_name: 'data-pipeline',       cost: 7400  },
    { service_name: 'notification-worker', cost: 5200  },
  ],
  by_resource_type: [
    { resource_type: 'EC2',    cost: 38400 },
    { resource_type: 'RDS',    cost: 24600 },
    { resource_type: 'EKS',    cost: 14200 },
    { resource_type: 'S3',     cost: 8800  },
    { resource_type: 'Lambda', cost: 4800  },
    { resource_type: 'Other',  cost: 3480  },
  ],
}

const COLORS = ['#7C3AED', '#4f8ef7', '#38c9a0', '#f59e0b', '#e05d2e', '#64748b']

// ── Custom tooltip ─────────────────────────────────────────────────────────────

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-200 rounded-lg px-4 py-3 shadow-lg">
      <p className="text-xs font-semibold text-slate-700 mb-1">{label}</p>
      <p className="text-sm font-bold text-violet-700">${payload[0].value.toLocaleString()}/mo</p>
    </div>
  )
}

// ── Demo label ─────────────────────────────────────────────────────────────────

/** On-page label for every block that shows sample team data. */
const DemoDataBadge = () => (
  <span data-testid="by-team-demo-badge" className="inline-flex items-center rounded-full bg-amber-50 border border-amber-200 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800">
    Demo data
  </span>
)

// ── Page ───────────────────────────────────────────────────────────────────────

export default function CostsByTeamPage() {
  const { isFree } = usePlan()
  const demoMode = useDemoMode()
  const { enabled: salesDemo } = useSalesDemo()
  const isDemoActive = demoMode || salesDemo
  const [activeTab, setActiveTab] = useState<'team' | 'service' | 'resource'>('team')

  // Real mode shows no team/service/resource-type breakdown. DevControl does not
  // yet allocate the AWS bill to teams or services: the former breakdown summed
  // infrastructure_resources, which discovery never fills, so every team read $0
  // next to a real total. The breakdown below is demo data only.
  //
  // The spend card reads the same figure Dashboard/costs/efficiency use for live
  // spend, labeled by its costSource: an inventory estimate is never called spend.
  const { data: platformStats, isLoading: statsLoading, isError: statsError } = useQuery<PlatformDashboardStats>({
    queryKey: ['platform-dashboard-stats'],
    queryFn: platformStatsService.getDashboardStats,
    staleTime: 4 * 60 * 60 * 1000, gcTime: 24 * 60 * 60 * 1000,
    refetchOnWindowFocus: false, refetchOnMount: false, retry: false,
    enabled: !isDemoActive,
  })

  const { data: awsAccounts } = useQuery({
    queryKey: ['aws-accounts'],
    queryFn: awsAccountsService.getAccounts,
    enabled: !isDemoActive,
  })

  const data = isDemoActive ? DEMO_DATA : null
  const totalCost = data?.total_monthly_cost ?? 0
  const isAwsConnected = isDemoActive || (awsAccounts?.length ?? 0) > 0
  const spend = describeStatsSpend(platformStats, { isLoading: statsLoading, isError: statsError })

  // ── Free gate ──
  if (isFree && !isDemoActive) {
    return (
      <div className="max-w-[1320px] mx-auto px-4 py-6 sm:px-6 sm:py-8 lg:px-14 lg:py-10 min-h-screen">
        <div className="mb-8">
          <p className="text-xs font-bold uppercase tracking-widest text-violet-700 mb-1.5">Costs</p>
          <h1 className="text-2xl font-bold text-gray-900">Cost Attribution</h1>
          <p className="text-xs text-gray-500 font-medium mt-1.5">Attribution of AWS spend to teams, services, and resource types.</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl py-16 px-10 text-center">
          <div className="w-12 h-12 rounded-full bg-violet-50 flex items-center justify-center mx-auto mb-4">
            <Lock className="w-5 h-5 text-violet-600" />
          </div>
          <h2 className="text-sm font-semibold text-gray-900 mb-2">Starter Plan Required</h2>
          <p className="text-gray-500 text-sm max-w-md mx-auto mb-6">
            Cost attribution by team is available on the Starter plan and above.
          </p>
          <Link href="/settings/billing/upgrade" className="inline-block bg-violet-700 text-white px-6 py-2.5 rounded-lg text-sm font-semibold no-underline">
            Upgrade to Starter
          </Link>
        </div>
      </div>
    )
  }

  // Demo mode only (the button is not rendered otherwise): the file is labeled
  // as demo data in its name and first row.
  const handleExportCSV = () => {
    const blob = new Blob([demoAttributionCsv(DEMO_DATA)], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = demoAttributionCsvFilename(new Date())
    a.click()
    URL.revokeObjectURL(url)
  }

  const tabs = [
    { key: 'team',     label: 'By Team',          data: data?.by_team?.map(d => ({ name: d.team_name, cost: d.cost })) ?? []     },
    { key: 'service',  label: 'By Service',        data: data?.by_service?.map(d => ({ name: d.service_name, cost: d.cost })) ?? [] },
    { key: 'resource', label: 'By Resource Type',  data: data?.by_resource_type?.map(d => ({ name: d.resource_type, cost: d.cost })) ?? [] },
  ]

  const activeData = tabs.find(t => t.key === activeTab)?.data ?? []
  const topItem = activeData[0]

  return (
    <div className="px-4 py-6 sm:px-6 sm:py-8 lg:px-14 lg:py-10 max-w-[1400px] mx-auto min-h-screen bg-slate-50">

      {/* ── HEADER ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-8">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-violet-700 mb-1.5">Costs</p>
          <h1 className="text-2xl font-bold text-gray-900">Cost Attribution</h1>
          <p className="text-xs text-gray-500 font-medium mt-1.5">
            Attribution of AWS spend to teams, services, and resource types.
          </p>
        </div>
        {isDemoActive && (
          <button onClick={handleExportCSV} className="flex items-center gap-2 bg-white border border-gray-200 text-slate-600 px-4 py-2 rounded-lg text-sm font-medium shrink-0 hover:border-violet-300 hover:text-violet-700 transition-colors">
            <Download size={14} /> Export CSV
          </button>
        )}
      </div>

      {isDemoActive ? (
        <>
          {/* ── KPI CARDS (demo data) ── */}
          <div className="mb-3">
            <DemoDataBadge />
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {[
              { label: 'Total Monthly Spend', value: `$${DEMO_DATA.total_monthly_cost.toLocaleString()}`,                    icon: DollarSign, color: '#7C3AED' },
              { label: 'Annual Projection',   value: `$${annualizeMonthly(DEMO_DATA.total_monthly_cost).toLocaleString()}`, icon: TrendingUp, color: '#4f8ef7' },
              { label: 'Teams Tracked',       value: String(DEMO_DATA.by_team.length),                                       icon: Users,      color: '#38c9a0' },
              { label: 'Top Spender',         value: topItem ? topItem.name.split(' ')[0] : 'N/A',                           icon: DollarSign, color: '#e05d2e' },
            ].map(({ label, value, icon: Icon, color }) => (
              <div key={label} className="bg-white border border-gray-100 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: color + '15' }}>
                    <Icon size={14} style={{ color }} />
                  </div>
                  <p className="text-xs font-bold uppercase tracking-widest text-slate-500">{label}</p>
                </div>
                <p className="text-2xl font-bold text-slate-900">{value}</p>
              </div>
            ))}
          </div>

          {/* ── TABS (demo data) ── */}
          <div className="bg-white border border-gray-100 rounded-xl overflow-hidden mb-5">
            <div className="flex border-b border-gray-100">
              {tabs.map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key as any)}
                  className={`px-6 py-3.5 text-sm font-medium transition-colors border-b-2 ${
                    activeTab === tab.key
                      ? 'border-violet-600 text-violet-700 bg-violet-50/50'
                      : 'border-transparent text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="p-6">
              <div className="mb-4">
                <DemoDataBadge />
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Bar Chart */}
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">Monthly spend</p>
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={activeData} layout="vertical" margin={{ top: 0, right: 20, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                      <XAxis type="number" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => '$' + (v / 1000).toFixed(0) + 'K'} />
                      <YAxis type="category" dataKey="name" tick={{ fill: '#475569', fontSize: 11 }} axisLine={false} tickLine={false} width={130} />
                      <Tooltip content={<CustomTooltip />} />
                      <Bar dataKey="cost" radius={[0, 4, 4, 0]}>
                        {activeData.map((_, i) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {/* Table */}
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">Breakdown</p>
                  <div className="flex flex-col gap-2">
                    {activeData.map((item, i) => {
                      const pct = totalCost > 0 ? Math.round((item.cost / totalCost) * 100) : 0
                      return (
                        <div key={i} className="flex items-center gap-3">
                          <div className="w-3 h-3 rounded-sm shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                          <span className="text-sm text-slate-700 flex-1 truncate">{item.name}</span>
                          <span className="text-xs text-slate-500 w-8 text-right shrink-0">{pct}%</span>
                          <div className="w-24 h-1.5 bg-slate-100 rounded-full overflow-hidden shrink-0">
                            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: COLORS[i % COLORS.length] }} />
                          </div>
                          <span className="text-sm font-semibold text-slate-900 w-24 text-right shrink-0">
                            ${item.cost.toLocaleString()}
                          </span>
                        </div>
                      )
                    })}
                    <div className="border-t border-slate-100 pt-2 mt-1 flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Total</span>
                      <span className="text-sm font-bold text-slate-900">${totalCost.toLocaleString()}/mo</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      ) : (
        <>
          {/* ── SPEND (labeled by its source) ── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <div className="bg-white border border-gray-100 rounded-xl p-4" data-testid="by-team-spend-card">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: '#7C3AED15' }}>
                  <DollarSign size={14} style={{ color: '#7C3AED' }} />
                </div>
                <p className="text-xs font-bold uppercase tracking-widest text-slate-500">{spend.label}</p>
              </div>
              <p className="text-2xl font-bold text-slate-900">{spend.value}</p>
              <p className="text-xs text-slate-500 mt-1">{spend.sub}</p>
            </div>
          </div>

          {/* ── ATTRIBUTION: not available ── */}
          <div className="bg-white border border-gray-100 rounded-xl p-6 mb-5" data-testid="by-team-attribution-unavailable">
            <div className="flex flex-col items-center justify-center text-center py-10">
              <Users size={32} className="text-slate-300 mb-3" />
              <p className="text-slate-700 text-sm font-semibold">Cost attribution by team and service is not available yet</p>
              <p className="text-slate-500 text-xs mt-2 max-w-lg">
                {isAwsConnected
                  ? 'DevControl does not yet allocate your AWS bill to teams or services, so no per-team or per-service amounts are shown. The figure above is your account total, not split by owner.'
                  : 'Connect your AWS account to see your AWS spend. Allocation to teams and services is not available yet.'}
              </p>
              <Link href="/costs" className="text-xs font-semibold text-violet-700 no-underline mt-4">
                See spend by AWS service →
              </Link>
            </div>
          </div>
        </>
      )}

    </div>
  )
}
