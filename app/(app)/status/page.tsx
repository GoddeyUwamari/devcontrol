'use client'

import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, XCircle, Loader2, Activity, RefreshCw } from 'lucide-react'
import { monitoringService } from '@/lib/services/monitoring.service'

/**
 * DevControl's own service status: the result of a live check against
 * DevControl's backend /health endpoint (API reachable, database connected).
 *
 * It says nothing about the customer's AWS resources, and DevControl does not
 * record uptime history, incidents, or per-region status, so none are shown.
 */
export default function StatusPage() {
  const { data: health, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['devcontrol-service-status'],
    queryFn: monitoringService.getSystemHealth,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  })

  const backend = health?.services[0]
  const operational = health?.status === 'operational'
  const checkedAt = health ? new Date(health.lastUpdate) : null

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6 sm:px-6 sm:py-8 lg:px-14 lg:py-10 max-w-[1320px] mx-auto">

      {/* Page header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-8">
        <div>
          <p className="text-xs font-bold text-violet-600 uppercase tracking-widest mb-1.5">Observability</p>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight mb-1.5">DevControl Service Status</h1>
          <p className="text-xs text-slate-500 font-medium leading-relaxed max-w-2xl">
            Whether DevControl&apos;s own API and database are responding. This page does not report on your AWS resources.
          </p>
        </div>
        <a href="/monitoring" className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white px-4 py-2.5 rounded-lg text-sm font-semibold no-underline transition-colors whitespace-nowrap self-start">
          <Activity size={14} /> AWS Monitoring
        </a>
      </div>

      {/* Current status */}
      <div
        data-testid="devcontrol-status"
        className={`rounded-2xl border p-6 sm:p-8 mb-7 flex items-center gap-4 sm:gap-5 ${
          isLoading ? 'bg-white border-slate-200' : operational ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
        }`}
      >
        <div className={`w-12 h-12 sm:w-14 sm:h-14 rounded-full flex items-center justify-center shrink-0 ${
          isLoading ? 'bg-slate-100' : operational ? 'bg-green-100' : 'bg-red-100'
        }`}>
          {isLoading
            ? <Loader2 size={26} className="text-slate-400 animate-spin" />
            : operational
              ? <CheckCircle2 size={26} className="text-green-600" />
              : <XCircle size={26} className="text-red-600" />}
        </div>
        <div className="flex-1">
          <h2 className={`text-xl sm:text-2xl font-bold tracking-tight mb-1 ${
            isLoading ? 'text-slate-500' : operational ? 'text-green-600' : 'text-red-600'
          }`}>
            {isLoading
              ? 'Checking DevControl…'
              : operational
                ? 'DevControl is operational'
                : 'DevControl is not responding normally'}
          </h2>
          <p className="text-sm text-slate-500">
            {isLoading
              ? 'Contacting the DevControl API.'
              : operational
                ? 'The DevControl API responded and reports its database as connected.'
                : backend?.error
                  ? `The health check failed: ${backend.error}.`
                  : 'The health check failed.'}
            {checkedAt && ` Checked at ${checkedAt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}.`}
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-2 bg-white text-slate-600 border border-slate-200 px-3.5 py-2 rounded-lg text-xs font-medium cursor-pointer hover:bg-slate-50 transition-colors whitespace-nowrap disabled:opacity-50 shrink-0"
        >
          <RefreshCw size={13} className={isFetching ? 'animate-spin' : ''} /> Check again
        </button>
      </div>

      {/* What was checked */}
      {!isLoading && backend && (
        <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden mb-6">
          <div className="px-5 sm:px-7 py-4 border-b border-slate-100">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-0.5">What was checked</p>
            <p className="text-sm text-slate-500">A single request from your browser to DevControl&apos;s health endpoint.</p>
          </div>
          <div className="px-5 sm:px-7 py-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-1">DevControl API</p>
              <p className={`text-sm font-bold ${operational ? 'text-green-600' : 'text-red-600'}`}>{operational ? 'Responding' : 'Not responding normally'}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-1">DevControl database</p>
              <p className={`text-sm font-bold ${operational ? 'text-green-600' : 'text-slate-500'}`}>{operational ? 'Connected' : 'Unknown'}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-1">Response time for this check</p>
              <p className="text-sm font-bold text-slate-900">{backend.responseTime} ms</p>
            </div>
          </div>
        </div>
      )}

      <p className="text-xs text-slate-500 leading-relaxed">
        DevControl does not currently publish uptime history or incident reports.
      </p>
    </div>
  )
}
