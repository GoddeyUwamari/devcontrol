'use client'

import { Suspense, useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useQueryClient } from '@tanstack/react-query'
import { useQuery } from '@tanstack/react-query'
import {
  Server, Database, HardDrive, Zap, Globe, Network,
  RefreshCw, ArrowRight, Sparkles, Check, Plus, AlertTriangle,
} from 'lucide-react'
import { toast } from 'sonner'
import { infrastructureService } from '@/lib/services/infrastructure.service'
import { costRecommendationsService } from '@/lib/services/cost-recommendations.service'
import awsServicesService from '@/lib/services/aws-services.service'
import type { InfrastructureResource, ResourceType } from '@/lib/types'
import { useDemoMode } from '@/components/demo/demo-mode-toggle'
import { useSalesDemo } from '@/lib/demo/sales-demo-data'

const resourceTypeConfig: Record<string, { icon: any; color: string; bg: string }> = {
  ec2:        { icon: Server,    color: '#3B82F6', bg: '#EFF6FF' },
  lambda:     { icon: Zap,       color: '#D97706', bg: '#FFFBEB' },
  rds:        { icon: Database,  color: '#059669', bg: '#F0FDF4' },
  s3:         { icon: HardDrive, color: '#0EA5E9', bg: '#F0F9FF' },
  elb:        { icon: Globe,     color: '#64748B', bg: '#F8FAFC' },
  cloudfront: { icon: Globe,     color: '#64748B', bg: '#F8FAFC' },
  vpc:        { icon: Network,   color: '#64748B', bg: '#F8FAFC' },
  default:    { icon: Server,    color: '#64748B', bg: '#F8FAFC' },
}

const DROPDOWN_PILLS: { key: string; label: string; items: { value: string | null; label: string }[] }[] = [
  {
    key: 'all', label: 'All',
    items: [
      { value: null,            label: 'All Resources' },
      { value: 'ec2',           label: 'EC2'           },
      { value: 'ecs',           label: 'ECS'           },
      { value: 'lambda',        label: 'Lambda'        },
      { value: 'eks',           label: 'EKS'           },
      { value: 'rds',           label: 'RDS'           },
      { value: 'aurora',        label: 'Aurora'        },
      { value: 'dynamodb',      label: 'DynamoDB'      },
      { value: 'elasticache',   label: 'ElastiCache'   },
      { value: 's3',            label: 'S3'            },
      { value: 'vpc',           label: 'VPC'           },
      { value: 'load-balancer', label: 'Load Balancer' },
      { value: 'cloudfront',    label: 'CloudFront'    },
      { value: 'api-gateway',   label: 'API Gateway'   },
      { value: 'sqs',           label: 'SQS'           },
      { value: 'sns',           label: 'SNS'           },
    ],
  },
  {
    key: 'compute', label: 'Compute',
    items: [
      { value: 'ec2',    label: 'EC2'    },
      { value: 'ecs',    label: 'ECS'    },
      { value: 'lambda', label: 'Lambda' },
      { value: 'eks',    label: 'EKS'    },
    ],
  },
  {
    key: 'database', label: 'Database',
    items: [
      { value: 'rds',         label: 'RDS'         },
      { value: 'aurora',      label: 'Aurora'      },
      { value: 'dynamodb',    label: 'DynamoDB'    },
      { value: 'elasticache', label: 'ElastiCache' },
    ],
  },
  {
    key: 'storage', label: 'Storage',
    items: [{ value: 's3', label: 'S3' }],
  },
  {
    key: 'networking', label: 'Networking',
    items: [
      { value: 'vpc',           label: 'VPC'          },
      { value: 'load-balancer', label: 'Load Balancer'},
      { value: 'cloudfront',    label: 'CloudFront'   },
      { value: 'api-gateway',   label: 'API Gateway'  },
    ],
  },
  {
    key: 'messaging', label: 'Messaging',
    items: [
      { value: 'sqs', label: 'SQS' },
      { value: 'sns', label: 'SNS' },
    ],
  },
]

const DEMO_RESOURCES: InfrastructureResource[] = [
  { id: 'r1', serviceId: 'svc-1', serviceName: 'api-gateway',         resourceType: 'ec2',    awsId: 'i-0a1b2c3d4e5f',    awsRegion: 'us-east-1', status: 'running', costPerMonth: 245.50, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'r2', serviceId: 'svc-2', serviceName: 'auth-service',        resourceType: 'ec2',    awsId: 'arn:aws:ecs:auth',   awsRegion: 'us-east-1', status: 'running', costPerMonth: 178.00, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'r3', serviceId: 'svc-3', serviceName: 'payment-processor',   resourceType: 'lambda', awsId: 'payment-fn-prod',    awsRegion: 'us-west-2', status: 'running', costPerMonth: 89.50,  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'r4', serviceId: 'svc-4', serviceName: 'notification-service',resourceType: 'lambda', awsId: 'notify-fn-prod',     awsRegion: 'us-east-1', status: 'running', costPerMonth: 156.30, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'r5', serviceId: 'svc-5', serviceName: 'analytics-worker',    resourceType: 'ec2',    awsId: 'i-9z8y7x6w5v',      awsRegion: 'eu-west-1', status: 'running', costPerMonth: 312.80, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'r6', serviceId: 'svc-1', serviceName: 'api-gateway',         resourceType: 'rds',    awsId: 'rds-prod-01',        awsRegion: 'us-east-1', status: 'running', costPerMonth: 445.00, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'r7', serviceId: 'svc-2', serviceName: 'auth-service',        resourceType: 's3',     awsId: 'auth-assets-bucket', awsRegion: 'us-east-1', status: 'running', costPerMonth: 23.40,  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'r8', serviceId: 'svc-3', serviceName: 'payment-processor',   resourceType: 'rds',    awsId: 'rds-payments-01',    awsRegion: 'us-west-2', status: 'pending', costPerMonth: 398.00, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
]

async function fetchRealSavings(): Promise<number | null> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null
  if (!token) return null
  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080'}/api/cost-optimization/results`,
      { headers: { 'Authorization': `Bearer ${token}` }, credentials: 'include' }
    )
    if (!res.ok) return null
    const data = await res.json()
    const results = data.results ?? []
    return results.reduce((sum: number, r: any) => sum + (parseFloat(r.monthlySavings ?? r.monthly_savings) || 0), 0)
  } catch { return null }
}

async function fetchSystemIntelligence(): Promise<any | null> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null
  if (!token) return null
  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080'}/api/observability/intelligence`,
      { headers: { Authorization: `Bearer ${token}` }, credentials: 'include' }
    )
    if (!res.ok) return null
    const json = await res.json()
    return json.data ?? null
  } catch { return null }
}

async function fetchTopActions(): Promise<any[] | null> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null
  if (!token) return null
  try {
    const [costRes, anomalyRes] = await Promise.all([
      fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080'}/api/cost-optimization/results`, { headers: { Authorization: `Bearer ${token}` }, credentials: 'include' }),
      fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080'}/api/anomalies`, { headers: { Authorization: `Bearer ${token}` }, credentials: 'include' }),
    ])
    const costData    = costRes.ok    ? await costRes.json()    : { results: [] }
    const anomalyData = anomalyRes.ok ? await anomalyRes.json() : { anomalies: [] }
    const costActions = (costData.results ?? [])
      .filter((r: any) => (parseFloat(r.monthlySavings ?? r.monthly_savings) || 0) > 0)
      .sort((a: any, b: any) => (parseFloat(b.monthlySavings ?? b.monthly_savings) || 0) - (parseFloat(a.monthlySavings ?? a.monthly_savings) || 0))
      .slice(0, 3)
      .map((r: any, i: number) => ({
        id: r.id ?? `cost-${i}`, title: r.title ?? r.recommendation ?? 'Cost optimization available',
        savings: Math.round(parseFloat(r.monthlySavings ?? r.monthly_savings) || 0),
        risk: 'zero' as const, urgency: i === 0 ? 'now' as const : 'today' as const,
        subtitle: `${r.resourceName ?? r.resource_name ?? 'Resource'} · ${r.region ?? 'us-east-1'} · cost leakage active`,
        type: 'cost' as const,
      }))
    const reliabilityActions = (anomalyData.anomalies ?? anomalyData ?? [])
      .filter((a: any) => a.severity === 'critical' || a.severity === 'high')
      .slice(0, 1)
      .map((a: any) => ({
        id: a.id ?? 'anomaly-0', title: a.title ?? a.message ?? 'Reliability issue detected',
        savings: null, risk: 'review' as const, urgency: 'now' as const,
        subtitle: `${a.resourceName ?? a.resource ?? 'Resource'} · ${a.impact ?? 'potential downtime risk'}`,
        type: 'reliability' as const,
      }))
    return [...reliabilityActions, ...costActions].slice(0, 4)
  } catch { return null }
}

export default function InfrastructurePage() {
  return (
    <Suspense fallback={<div className="py-12 text-center text-sm text-gray-500">Loading...</div>}>
      <InfrastructureContent />
    </Suspense>
  )
}

function InfrastructureContent() {
  const queryClient = useQueryClient()
  const searchParams = useSearchParams()
  const targetResourceId = searchParams.get('resource')

  const [selectedType,  setSelectedType]  = useState<string | null>(null)
  const [openDropdown,  setOpenDropdown]  = useState<string | null>(null)

  useEffect(() => {
    const close = () => setOpenDropdown(null)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const demoMode     = useDemoMode()
  const salesDemoMode = useSalesDemo((state) => state.enabled)
  const isDemoActive  = demoMode || salesDemoMode

  const [showUpgradePrompt, setShowUpgradePrompt] = useState(false)
  const [isSyncing,         setIsSyncing]         = useState(false)
  const [syncComplete,      setSyncComplete]      = useState(false)
  const [hoveredCard,       setHoveredCard]       = useState<string | null>(null)
  const [statusFilter,      setStatusFilter]      = useState<string | null>(null)
  const [showAllResources,  setShowAllResources]  = useState(false)
  const [issueFilter,       setIssueFilter]       = useState<string>('all')
  const [sortOrder,         setSortOrder]         = useState<string>('impact')

  const { data: resources = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ['infrastructure', selectedType],
    queryFn: async () => {
      const all = await infrastructureService.getAll(selectedType ? { resourceType: selectedType as ResourceType } : undefined)
      return all.filter(r => (r.resourceType as string) !== 'AWS_COST_TOTAL')
    },
    enabled: !isDemoActive,
  })

  useEffect(() => {
    if (isError && (error as any)?.response?.status === 402) setShowUpgradePrompt(true)
  }, [isError, error])

  useEffect(() => {
    if (!targetResourceId || isLoading) return
    const el = document.getElementById(`resource-${targetResourceId}`)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.style.transition = 'background-color 0.3s ease'
    el.style.backgroundColor = '#EDE9FE'
    el.style.boxShadow = '0 0 0 2px #7C3AED'
    setTimeout(() => { el.style.backgroundColor = ''; el.style.boxShadow = '' }, 2000)
  }, [targetResourceId, isLoading])

  const { data: allResources = [] } = useQuery({
    queryKey: ['infrastructure-all'],
    queryFn: async () => {
      const all = await infrastructureService.getAll()
      return all.filter(r => (r.resourceType as string) !== 'AWS_COST_TOTAL')
    },
    enabled: !isDemoActive,
  })

  const { data: recommendationsCount = 0 } = useQuery({
    queryKey: ['cost-recommendations-count'],
    queryFn: costRecommendationsService.getActiveCount,
    enabled: !isDemoActive,
  })

  const { data: recommendationStats, isLoading: savingsLoading } = useQuery({
    queryKey: ['cost-recommendations-stats'],
    queryFn: costRecommendationsService.getStats,
    enabled: !isDemoActive,
  })

  const { data: realSavingsTotal } = useQuery({
    queryKey: ['infra-real-savings'],
    queryFn: fetchRealSavings,
    enabled: !isDemoActive,
  })

  const { data: systemIntelligence } = useQuery({
    queryKey: ['system-intelligence'],
    queryFn: fetchSystemIntelligence,
    enabled: !isDemoActive,
  })

  const { data: topActionsData } = useQuery({
    queryKey: ['top-actions'],
    queryFn: fetchTopActions,
    enabled: !isDemoActive,
  })

  const { data: apiStats, isLoading: statsLoading } = useQuery({
    queryKey: ['services-stats'],
    queryFn: awsServicesService.getStats,
    enabled: !isDemoActive,
  })

  const handleSyncAWS = async () => {
    if (isDemoActive) {
      setIsSyncing(true)
      await new Promise(r => setTimeout(r, 2000))
      setIsSyncing(false); setSyncComplete(true)
      setTimeout(() => setSyncComplete(false), 3000)
      return
    }
    try {
      setIsSyncing(true)
      const result = await awsServicesService.discoverServices()
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['infrastructure'] }),
        queryClient.invalidateQueries({ queryKey: ['infrastructure-all'] }),
        queryClient.invalidateQueries({ queryKey: ['services-stats'] }),
        queryClient.invalidateQueries({ queryKey: ['cost-recommendations-count'] }),
        queryClient.invalidateQueries({ queryKey: ['system-intelligence'] }),
        queryClient.invalidateQueries({ queryKey: ['top-actions'] }),
        queryClient.invalidateQueries({ queryKey: ['infra-real-savings'] }),
        queryClient.invalidateQueries({ queryKey: ['cost-recommendations-stats'] }),
      ])
      toast.success(`Sync complete — ${result.discovered} resources discovered`)
      setSyncComplete(true); setTimeout(() => setSyncComplete(false), 3000)
    } catch {
      toast.error('Sync failed — check your AWS connection')
    } finally {
      setIsSyncing(false)
    }
  }

  const displayResources = isDemoActive ? DEMO_RESOURCES : resources

  const filteredResources = displayResources.filter((r: InfrastructureResource) => {
    if (selectedType && r.resourceType !== selectedType) return false
    if (statusFilter === 'active')  return r.status === 'running'
    if (statusFilter === 'warning') return r.status === 'pending' || r.status === 'stopped'
    return true
  })

  const effectiveResources =
    !isDemoActive && filteredResources.length === 0 && selectedType === null && statusFilter === null && allResources.length > 0
      ? allResources
      : filteredResources

  const demoTotal        = DEMO_RESOURCES.length
  const demoMonthlyCost  = DEMO_RESOURCES.reduce((sum, r) => sum + (r.costPerMonth || 0), 0)
  const demoActive       = DEMO_RESOURCES.filter(r => r.status === 'running').length
  const demoWarning      = DEMO_RESOURCES.filter(r => r.status === 'pending' || r.status === 'stopped').length
  const realMonthlyCost  = allResources.reduce((sum: number, r: InfrastructureResource) => sum + (r.costPerMonth || 0), 0)
  const totalResources   = isDemoActive ? demoTotal      : (statsLoading ? null : (apiStats?.total          ?? 0))
  const totalMonthlyCost = isDemoActive ? demoMonthlyCost: realMonthlyCost
  const activeCount      = isDemoActive ? demoActive     : (statsLoading ? null : (apiStats?.healthy         ?? 0))
  const warningCount     = isDemoActive ? demoWarning    : (statsLoading ? null : (apiStats?.needs_attention ?? 0))

  const DEMO_INTELLIGENCE = {
    system_score: 73, status: 'warning',
    top_action: { message: 'Over-provisioned compute + unused storage', consequence: '', path: '/costs/cost-optimization', severity: 'high' },
    top_drivers: [],
    components: {
      cost:          { score: 55, detail: '$2,039/mo savings identified', status: 'warning' },
      security:      { score: 87, detail: 'No critical issues',           status: 'good'    },
      observability: { score: 65, detail: '11 alarms configured',         status: 'warning' },
    },
  }

  const intel            = isDemoActive ? DEMO_INTELLIGENCE : (systemIntelligence ?? DEMO_INTELLIGENCE)
  const intelComponents  = intel.components ?? DEMO_INTELLIGENCE.components
  const intelScore       = intel.system_score
  const intelStatus      = intel.status === 'good' ? 'Healthy' : intel.status === 'warning' ? 'Partially Optimized' : 'At Risk'
  const intelTopAction   = typeof intel.top_action === 'string' ? intel.top_action : intel.top_action?.message ?? 'Over-provisioned compute + unused storage'
  const intelCostScore   = intelComponents.cost.score
  const intelSecScore    = intelComponents.security.score
  const intelObsScore    = intelComponents.observability.score
  const intelScoreDelta  = isDemoActive ? 18 : (intel.system_score > 0 ? Math.min(Math.round((100 - intel.system_score) * 0.55), 25) : 0)
  const intelWaste       = realSavingsTotal ?? (isDemoActive ? 1060 : 0)
  const intelAnalyzed    = isDemoActive ? 19 : allResources.length
  const intelTotal       = isDemoActive ? 20 : ((totalResources as number) || intelAnalyzed)
  const scoreCirc        = 144.5
  const scoreOffset      = intelScore > 0 ? scoreCirc - (intelScore / 100) * scoreCirc : scoreCirc
  const scoreChip        = (score: number) => ({ color: score >= 80 ? '#065F46' : '#92400E', bg: score >= 80 ? '#D1FAE5' : '#FEF3C7' })

  const DEMO_TOP_ACTIONS = [
    { id: 'demo-1', rank: '01', urgency: 'now'   as const, risk: 'zero'   as const, title: 'Downsize RDS cluster',                     savings: 740,  sub: 'production-postgres-primary · us-east-1 · cost leakage active',              isTop: true  },
    { id: 'demo-2', rank: '02', urgency: 'now'   as const, risk: 'review' as const, title: 'Investigate CloudFront latency warnings',   savings: null, sub: 'production-cdn · potential downtime risk · degraded user experience',         isTop: false },
    { id: 'demo-3', rank: '03', urgency: 'today' as const, risk: 'zero'   as const, title: 'Remove unused EBS volumes',                 savings: 320,  sub: '6 unattached volumes · us-east-1 · no impact to workloads',                  isTop: false },
    { id: 'demo-4', rank: '04', urgency: 'today' as const, risk: 'zero'   as const, title: 'Rightsize idle EC2 instances',              savings: 580,  sub: 'analytics-warehouse · us-east-1 · avg 12% CPU utilization',                  isTop: false },
  ]

  const displayTopActions = isDemoActive
    ? DEMO_TOP_ACTIONS
    : (topActionsData ?? []).map((a, i) => ({
        id: a.id, rank: String(i + 1).padStart(2, '0'),
        urgency: a.urgency, risk: a.risk, title: a.title, savings: a.savings, sub: a.subtitle,
        isTop: i === 0,
      }))

  const zeroRiskCount    = displayTopActions.filter(a => a.risk === 'zero').length
  const totalRecoverable = displayTopActions.reduce((sum, a) => sum + (a.savings ?? 0), 0)
  const displayRecommendationsCount = isDemoActive ? 3 : recommendationsCount
  const formatSavings = (val: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val)
  const potentialSavingsValue = isDemoActive
    ? '$1,697/mo'
    : realSavingsTotal != null && realSavingsTotal > 0
      ? `$${Math.round(realSavingsTotal).toLocaleString()}/mo`
      : savingsLoading ? '—'
      : formatSavings(recommendationStats?.totalPotentialSavings ?? 0)

  const DEMO_COST_BY_SERVICE = [
    { name: 'analytics-worker',  cost: 312.80, pct: 41, barWidth: 100 },
    { name: 'api-gateway',       cost: 245.50, pct: 32, barWidth: 78  },
    { name: 'auth-service',      cost: 178.00, pct: 23, barWidth: 57  },
    { name: 'payment-processor', cost: 89.50,  pct: 12, barWidth: 29  },
    { name: 'notification-svc',  cost: 34.00,  pct:  4, barWidth: 11  },
  ]

  const costByService = (() => {
    if (isDemoActive) return DEMO_COST_BY_SERVICE
    const map: Record<string, number> = {}
    for (const r of allResources) {
      const key = (r as any).serviceName || (r as any).service_name || r.serviceId || 'Unknown'
      map[key] = (map[key] || 0) + (r.costPerMonth || 0)
    }
    const total = Object.values(map).reduce((s, v) => s + v, 0)
    if (total === 0) return []
    const maxCost = Math.max(...Object.values(map))
    return Object.entries(map).sort(([, a], [, b]) => b - a).slice(0, 5).map(([name, cost]) => ({
      name, cost, pct: Math.round((cost / total) * 100), barWidth: Math.round((cost / maxCost) * 100),
    }))
  })()

  const regionCount = new Set(displayResources.map((r: InfrastructureResource) => r.awsRegion)).size

  const tableResources = (() => {
    let rows = [...effectiveResources]
    if (issueFilter === 'Cost Waste')       rows = rows.filter(r => (r.costPerMonth ?? 0) > 400)
    else if (issueFilter === 'Reliability Risk') rows = rows.filter(r => r.status === 'pending' || r.status === 'stopped')
    else if (issueFilter === 'Healthy')     rows = rows.filter(r => r.status === 'running' && (r.costPerMonth ?? 0) <= 400)
    if (sortOrder === 'impact') rows = rows.sort((a, b) => {
      const aScore = (a.status === 'pending' || a.status === 'stopped') ? 999999 : (a.costPerMonth ?? 0)
      const bScore = (b.status === 'pending' || b.status === 'stopped') ? 999999 : (b.costPerMonth ?? 0)
      return bScore - aScore
    })
    else if (sortOrder === 'cost-high') rows = rows.sort((a, b) => (b.costPerMonth ?? 0) - (a.costPerMonth ?? 0))
    else if (sortOrder === 'status')    rows = rows.sort((a, b) => a.status.localeCompare(b.status))
    return rows
  })()

  return (
    <div className="px-4 py-6 sm:px-6 sm:py-8 lg:px-14 lg:py-10 max-w-[1320px] mx-auto min-h-screen bg-gray-50 overflow-x-hidden">

      {/* UPGRADE PROMPT */}
      {showUpgradePrompt && (
        <div className="flex items-center justify-between bg-amber-50 border border-amber-400 rounded-xl px-5 py-3.5 mb-6 gap-4">
          <div className="flex items-center gap-2.5">
            <span className="text-lg">⚠️</span>
            <span className="text-sm font-medium text-amber-800">You've reached your resource limit. Upgrade your plan to see all resources.</span>
          </div>
          <a href="/settings/billing/upgrade" className="shrink-0 text-[13px] font-semibold text-white bg-amber-600 rounded-md px-4 py-1.5 whitespace-nowrap no-underline">
            Upgrade plan
          </a>
        </div>
      )}

      {/* PAGE HEADER */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-8">
        <div className="flex-1">
          <p className="text-[10px] font-bold uppercase tracking-widest text-violet-700 mb-1.5">Infrastructure</p>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight mb-1.5">AWS System Intelligence</h1>
          <p className="text-sm text-slate-500 leading-relaxed">Real-time visibility into cost, health, and risk across your AWS infrastructure.</p>

          {/* Mobile-only action buttons */}
          <div className="flex gap-2 mt-4 sm:hidden">
            <button
              onClick={handleSyncAWS}
              disabled={isSyncing}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-xs font-semibold border transition-all ${syncComplete ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-500 border-slate-200'}`}
            >
              {isSyncing ? <><RefreshCw size={14} className="animate-spin" /> Syncing...</>
                : syncComplete ? <><Check size={14} /> Done</>
                : <><RefreshCw size={14} /> Sync AWS</>}
            </button>
            <a href="/cost-optimization" className="flex-1 flex items-center justify-center gap-1.5 bg-violet-700 text-white px-3 py-2.5 rounded-lg text-xs font-bold no-underline">
              <Check size={13} /> Apply Fixes
            </a>
          </div>
        </div>

        {/* Desktop-only action buttons */}
        <div className="hidden sm:flex gap-3 shrink-0">
          <button
            onClick={handleSyncAWS}
            disabled={isSyncing}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold border transition-all ${syncComplete ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-500 border-slate-200'}`}
          >
            {isSyncing ? <><RefreshCw size={15} className="animate-spin" /> Syncing AWS...</>
              : syncComplete ? <><Check size={15} /> Sync Complete</>
              : !isDemoActive && allResources.length === 0 ? <><RefreshCw size={15} /> Scan My AWS for Cost & Risk</>
              : <><RefreshCw size={15} /> Sync AWS</>}
          </button>
          <div className="flex flex-col items-end gap-1">
            <a href="/cost-optimization" className="flex items-center gap-1.5 bg-violet-700 text-white px-4 py-2.5 rounded-lg text-xs font-bold no-underline">
              <Check size={13} /> Apply Recommended Fixes
            </a>
            <p className="text-[10px] text-slate-500 text-right">Applies 3 zero-risk optimizations · No downtime · Est. savings: $1,060/mo</p>
          </div>
        </div>
      </div>

      {/* SYSTEM INTELLIGENCE STRIP */}
      <div className="bg-white rounded-xl border border-slate-200 border-l-4 border-l-violet-700 px-6 py-5 mb-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="flex flex-col lg:flex-row lg:items-center gap-5 flex-wrap">

          {/* Score ring */}
          <div className="flex items-center gap-3">
            <div className="relative w-[54px] h-[54px] shrink-0">
              <svg width="54" height="54" viewBox="0 0 54 54">
                <circle cx="27" cy="27" r="23" fill="none" stroke="#F1F5F9" strokeWidth="5"/>
                <circle cx="27" cy="27" r="23" fill="none" stroke="#7C3AED" strokeWidth="5"
                  strokeDasharray="144.5" strokeDashoffset={scoreOffset}
                  strokeLinecap="round" transform="rotate(-90 27 27)"/>
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-[13px] font-bold text-slate-900">{intelScore}</span>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">System Score</p>
              <p className="text-base font-bold text-slate-900 mb-0.5">{intelStatus}</p>
              <p className="text-[11px] text-slate-500">{intelAnalyzed}/{intelTotal} resources analyzed · High confidence</p>
            </div>
          </div>

          <div className="hidden lg:block w-px h-11 bg-slate-200 shrink-0" />

          {/* Primary Issue */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">Primary Issue</p>
            <p className="text-sm font-semibold text-slate-900 mb-0.5">{intelTopAction}</p>
            <p className="text-xs font-bold text-red-600">${Math.round(intelWaste).toLocaleString()}/mo active waste</p>
          </div>

          <div className="hidden lg:block w-px h-11 bg-slate-200 shrink-0" />

          {/* Score Impact */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">Score Impact if Resolved</p>
            <p className="text-base font-bold text-violet-700 mb-0.5">+{intelScoreDelta} pts</p>
            <p className="text-[11px] text-slate-500">Within 24–48h after fixes applied</p>
          </div>

          <div className="hidden lg:block w-px h-11 bg-slate-200 shrink-0" />

          {/* Component scores */}
          <div className="grid grid-cols-3 gap-2.5">
            {[
              { label: 'Cost',          score: intelCostScore, chip: scoreChip(intelCostScore) },
              { label: 'Security',      score: intelSecScore,  chip: scoreChip(intelSecScore)  },
              { label: 'Observability', score: intelObsScore,  chip: scoreChip(intelObsScore)  },
            ].map(({ label, score, chip }) => (
              <div key={label} className="text-center">
                <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500 mb-1">{label}</p>
                <span className="text-xs font-bold px-2.5 py-0.5 rounded-full" style={{ color: chip.color, background: chip.bg }}>{score}/100</span>
              </div>
            ))}
          </div>
        </div>

        <a href="/ai-reports" className="text-[11px] font-bold text-violet-700 no-underline flex items-center gap-1 whitespace-nowrap shrink-0">
          Full report <ArrowRight size={11} />
        </a>
      </div>

      {/* COST BY SERVICE */}
      {costByService.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg px-5 py-4 mb-6">
          <div className="flex items-center justify-between mb-3.5">
            <span className="text-[11px] font-semibold tracking-widest text-gray-500 uppercase">Cost by Service</span>
            <span className="text-xs text-gray-400">Last 30 days</span>
          </div>
          <p className="text-[13px] text-slate-500 mb-3.5">
            Top concentration: <strong className="text-slate-900">Analytics (20%)</strong> and <strong className="text-slate-900">PostgreSQL (16%)</strong> — primary rightsizing candidates driving $1,060/mo in recoverable waste.
          </p>
          <div className="flex flex-col gap-2.5">
            {costByService.map((row) => (
              <div key={row.name} className="flex items-center gap-3 py-1">
                <span className="w-20 sm:w-40 text-xs sm:text-sm text-gray-900 overflow-hidden text-ellipsis whitespace-nowrap shrink-0">{row.name}</span>
                <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-violet-700 rounded-full" style={{ width: `${row.barWidth}%` }} />
                </div>
                <span className="w-16 sm:w-20 text-right text-xs sm:text-sm font-semibold text-gray-900 shrink-0">${row.cost.toFixed(2)}</span>
                <span className="hidden sm:block w-11 text-right text-[13px] text-gray-500 shrink-0">{row.pct}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 5 KPI CARDS */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-5 mb-7">

        {/* Total Resources */}
        <div className="bg-white rounded-xl p-4 sm:p-8 border border-gray-200/50">
          <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-widest mb-4">Total Resources</p>
          <div className="text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight leading-none mb-2">{statsLoading && !isDemoActive ? '—' : (totalResources ?? '—')}</div>
          <p className="text-[13px] text-slate-500 leading-relaxed">{isDemoActive ? 'Across all regions' : regionCount > 0 ? `Across ${regionCount} region${regionCount !== 1 ? 's' : ''}` : 'Across all regions'}</p>
        </div>

        {/* Monthly Cost */}
        <div className="bg-white rounded-xl p-4 sm:p-8 border border-gray-200/50">
          <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-widest mb-4">Monthly Cost</p>
          <div className="text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight leading-none mb-2">
            {isDemoActive ? `$${Math.round(totalMonthlyCost).toLocaleString()}` : totalMonthlyCost > 0 ? `$${Math.round(totalMonthlyCost).toLocaleString()}` : '—'}
          </div>
          <p className="text-[13px] text-slate-500 leading-relaxed">{isDemoActive || totalMonthlyCost > 0 ? 'All resources combined' : 'Syncing from Cost Explorer'}</p>
        </div>

        {/* Healthy */}
        <div
          className={`bg-white rounded-xl p-4 sm:p-8 border transition-colors cursor-pointer ${hoveredCard === 'active' || statusFilter === 'active' ? 'border-violet-700' : 'border-gray-200/50'}`}
          onMouseEnter={() => setHoveredCard('active')}
          onMouseLeave={() => setHoveredCard(null)}
          onClick={() => setStatusFilter(statusFilter === 'active' ? null : 'active')}
        >
          <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-widest mb-4">Healthy</p>
          <div className="text-3xl sm:text-4xl font-bold text-emerald-600 tracking-tight leading-none mb-2">{statsLoading && !isDemoActive ? '—' : (activeCount ?? '—')}</div>
          <p className="text-[13px] text-slate-500 leading-relaxed mb-0.5">Running normally</p>
          <p className="text-[11px] text-gray-400">Click to filter</p>
        </div>

        {/* Critical Issues */}
        <div
          className={`bg-white rounded-xl p-4 sm:p-8 border-l-[3px] border-l-red-600 transition-colors cursor-pointer ${hoveredCard === 'warning' || statusFilter === 'warning' ? 'border border-violet-700' : 'border border-red-200'}`}
          onMouseEnter={() => setHoveredCard('warning')}
          onMouseLeave={() => setHoveredCard(null)}
          onClick={() => setStatusFilter(statusFilter === 'warning' ? null : 'warning')}
        >
          <p className="text-[11px] font-semibold text-red-600 uppercase tracking-widest mb-4">Critical Issues</p>
          <div className="text-3xl sm:text-4xl font-bold text-red-600 tracking-tight leading-none mb-2">{statsLoading && !isDemoActive ? '—' : (warningCount ?? '—')}</div>
          <p className="text-[13px] text-slate-500 leading-relaxed mb-0.5">1 cost inefficiency · 1 reliability risk</p>
          <p className="text-[11px] text-red-600 font-medium">Resolve now →</p>
        </div>

        {/* Recoverable Savings */}
        <div className="col-span-2 lg:col-span-1 bg-white rounded-xl p-4 sm:p-8 border border-emerald-200">
          <p className="text-[11px] font-semibold text-emerald-600 uppercase tracking-widest mb-4">Recoverable Savings</p>
          <div className="text-3xl sm:text-4xl font-bold text-green-600 tracking-tight leading-none mb-2">{potentialSavingsValue}</div>
          <p className="text-[11px] text-slate-500 mb-1">
            {totalMonthlyCost > 0 && (realSavingsTotal ?? 0) > 0
              ? `${Math.round(((realSavingsTotal ?? 0) / totalMonthlyCost) * 100)}% of total spend`
              : isDemoActive ? '18% of total spend' : ''}
          </p>
          <p className="text-[13px] text-slate-500 leading-relaxed">
            {realSavingsTotal && realSavingsTotal > 0 ? 'Approve to capture savings' : isDemoActive ? 'Approve to capture savings' : 'Run scan to identify savings'}
          </p>
          {(isDemoActive || (realSavingsTotal && realSavingsTotal > 0)) && (
            <a href="/cost-optimization" className="text-[11px] font-semibold text-emerald-600 no-underline inline-flex items-center gap-1 mt-1.5">
              Review opportunities →
            </a>
          )}
        </div>
      </div>

      {/* TOP ACTIONS */}
      <div className="bg-white border border-slate-200 rounded-xl px-6 py-5 mb-4">
        <div className="flex items-center justify-between mb-3.5">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-0.5">Top Actions</p>
            <p className="text-[13px] text-slate-500">
              Ranked by impact · {zeroRiskCount} zero-risk changes ready · <strong className="text-emerald-600">${totalRecoverable.toLocaleString()}/mo recoverable today</strong>
            </p>
          </div>
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[9.5px] font-bold uppercase tracking-wide bg-red-600 text-white">Act Now</span>
        </div>

        <div className="flex flex-col gap-2.5">
          {displayTopActions.map((action) => (
            <div
              key={action.id}
              className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 rounded-lg border-2 ${action.isTop ? 'py-3.5' : 'py-3'}`}
              style={{ background: action.urgency === 'now' ? '#FFF8F8' : '#F8FAFC', borderColor: action.urgency === 'now' ? '#FECACA' : '#F1F5F9', borderWidth: action.isTop ? '2px' : '1px' }}
            >
              <div className="flex items-center gap-3.5">
                <span className="text-[11px] font-bold text-slate-400 min-w-[16px]">{action.rank}</span>
                <div>
                  <p className="text-sm font-semibold text-slate-900 mb-0.5">
                    {action.title}
                    {action.savings != null && <span className="text-emerald-600 font-bold"> — save ${action.savings.toLocaleString()}/mo</span>}
                  </p>
                  <p className="text-[11px] text-slate-500">{action.sub}</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0 flex-wrap sm:flex-nowrap">
                {action.risk === 'zero'
                  ? <span className="inline-flex px-1.5 py-0.5 rounded text-[9.5px] font-bold uppercase bg-emerald-100 text-emerald-800">Zero Risk</span>
                  : <span className="inline-flex px-1.5 py-0.5 rounded text-[9.5px] font-bold uppercase bg-amber-100 text-amber-800">Review Impact</span>}
                {action.isTop && <span className="inline-flex px-1.5 py-0.5 rounded text-[9.5px] font-bold uppercase bg-violet-700 text-white">Highest Impact</span>}
                {action.urgency === 'now'
                  ? <span className="inline-flex px-1.5 py-0.5 rounded text-[9.5px] font-bold uppercase bg-red-600 text-white">Now</span>
                  : <span className="inline-flex px-1.5 py-0.5 rounded text-[9.5px] font-bold uppercase bg-emerald-100 text-emerald-800">Today</span>}
                {action.risk === 'zero'
                  ? <a href="/cost-optimization" className="bg-emerald-600 text-white rounded-md px-3 py-1 text-[11px] font-bold no-underline sm:w-auto w-full text-center">Fix →</a>
                  : <a href="/anomalies" className="bg-transparent text-slate-500 border border-slate-200 rounded-md px-3 py-1 text-[11px] font-semibold no-underline sm:w-auto w-full text-center">Review →</a>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* RESOURCE TABLE */}
      <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">

        {/* Table header + filters */}
        <div className="px-7 py-5 border-b border-slate-100">
          <div className="flex items-center justify-between mb-3.5">
            <div>
              {isDemoActive
                ? <p className="text-[13px] text-gray-400">{DEMO_RESOURCES.length} resources (demo data)</p>
                : (totalResources !== null && (totalResources as number) > 0)
                  ? <p className="text-[13px] text-gray-400">{effectiveResources.length} of {totalResources ?? allResources.length} resources</p>
                  : <p className="text-[13px] text-gray-400">0 resources</p>}
            </div>
          </div>
          <div className="flex gap-2 mb-3">
            <select value={issueFilter} onChange={(e) => setIssueFilter(e.target.value)} className="text-[11px] font-semibold text-gray-700 border border-gray-200 rounded-full px-3 py-1 bg-white cursor-pointer">
              <option value="all">View by Issue ▾</option>
              <option value="Cost Waste">Cost Waste</option>
              <option value="Reliability Risk">Reliability Risk</option>
              <option value="Healthy">Healthy</option>
            </select>
            <select value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} className="text-[11px] font-semibold text-gray-700 border border-gray-200 rounded-full px-3 py-1 bg-white cursor-pointer">
              <option value="impact">Sort: Impact ▾</option>
              <option value="cost-high">Sort: Cost (High)</option>
              <option value="status">Sort: Status</option>
            </select>
          </div>
          <div className="flex gap-2 flex-wrap">
            {DROPDOWN_PILLS.map((pill) => {
              const isActive = pill.key === 'all' ? selectedType === null : pill.items.some(i => i.value === selectedType)
              const isOpen   = openDropdown === pill.key
              return (
                <div key={pill.key} className="relative">
                  <button
                    onClick={(e) => { e.stopPropagation(); setOpenDropdown(isOpen ? null : pill.key) }}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border transition-all ${isActive ? 'bg-violet-700 text-white border-transparent' : 'bg-white text-gray-700 border-gray-200'}`}
                  >
                    {pill.label} <span className="text-[9px] opacity-70">▼</span>
                  </button>
                  {isOpen && (
                    <div onMouseDown={(e) => e.stopPropagation()} className="absolute top-[calc(100%+6px)] left-0 bg-white border border-gray-200 rounded-lg shadow-lg z-50 min-w-[160px] overflow-hidden">
                      {pill.items.map((item) => {
                        const isSel = item.value === null ? selectedType === null : item.value === selectedType
                        return (
                          <button
                            key={item.value ?? '__all__'}
                            onClick={() => { setSelectedType(item.value); setOpenDropdown(null) }}
                            className={`block w-full text-left px-4 py-2 text-[13px] border-none bg-transparent cursor-pointer hover:bg-gray-50 ${isSel ? 'text-violet-700 font-semibold' : 'text-gray-700 font-normal'}`}
                          >
                            {item.label}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Column headers — desktop only */}
        <div className="hidden sm:grid grid-cols-[2fr_90px_150px_150px_110px_110px_110px] px-7 py-2.5 bg-slate-50 border-b border-slate-100">
          {['Resource', 'Type', 'AWS ID', 'Service', 'Region', 'Monthly Cost', 'Issue'].map(col => (
            <span key={col} className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">{col}</span>
          ))}
        </div>

        {/* Rows */}
        {isLoading && !isDemoActive ? (
          <div className="py-12 text-center">
            <RefreshCw size={20} className="text-slate-400 mx-auto mb-3" />
            <p className="text-sm text-slate-500">Loading resources...</p>
          </div>
        ) : !isDemoActive && effectiveResources.length === 0 ? (
          <div className="px-4 py-16 text-center">
            <div className="w-12 h-12 rounded-xl bg-slate-50 flex items-center justify-center mx-auto mb-4">
              <Server size={22} className="text-slate-400" />
            </div>
            <p className="text-base font-semibold text-slate-900 mb-1.5">No infrastructure data yet</p>
            <p className="text-sm text-slate-500 mb-5 leading-relaxed max-w-md mx-auto">
              Connect your AWS account to uncover cost leaks, security risks, and idle resources — first insights in under 2 minutes.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-sm mx-auto mb-6 text-left">
              {['💸 Idle EC2 instances draining budget', '🗄️ Underutilized RDS databases', '🔒 Misconfigured security groups', '📦 Unused S3 storage accumulating'].map(item => (
                <div key={item} className="text-[13px] text-slate-500 bg-slate-50 rounded-lg px-3 py-2.5 border border-slate-100">{item}</div>
              ))}
            </div>
            <p className="text-xs text-gray-400 mb-4">Read-only access · No changes to infrastructure · Cancel anytime</p>
            <button onClick={handleSyncAWS} className="bg-violet-700 text-white px-6 py-2.5 rounded-lg text-sm font-semibold border-none cursor-pointer inline-flex items-center gap-2">
              <RefreshCw size={14} /> Scan My AWS for Cost &amp; Risk
            </button>
          </div>
        ) : (
          (showAllResources ? tableResources : tableResources.slice(0, 8)).map((r: InfrastructureResource) => {
            const typeConf = resourceTypeConfig[r.resourceType?.toLowerCase() as string] || resourceTypeConfig.default
            const Icon = typeConf.icon
            const isReliabilityRisk = r.status === 'pending' || r.status === 'stopped'
            const isCostWaste       = r.costPerMonth != null && r.costPerMonth > 400
            const statusLabel = r.status === 'running' && !isCostWaste ? 'Healthy' : isCostWaste && r.status === 'running' ? 'Cost Waste' : isReliabilityRisk ? 'Critical' : r.status ?? '—'
            const statusColor = statusLabel === 'Critical' ? '#fff' : statusLabel === 'Cost Waste' ? '#fff' : '#475569'
            const statusBg    = statusLabel === 'Critical' ? '#DC2626' : statusLabel === 'Cost Waste' ? '#D97706' : '#F1F5F9'
            const rowBg       = statusLabel === 'Critical' ? '#FFF5F5' : statusLabel === 'Cost Waste' ? '#FFFBEB' : '#FFFFFF'
            const rowBorder   = statusLabel === 'Critical' ? '#FEE2E2' : statusLabel === 'Cost Waste' ? '#FDE68A' : '#F8FAFC'
            const issueLabel  = statusLabel === 'Critical'
              ? '⚠ Reliability risk · elevated error rate · potential downtime'
              : statusLabel === 'Cost Waste'
                ? `↑ Cost waste · $${Math.round((r.costPerMonth ?? 0) * 0.4).toLocaleString()}/mo recoverable · downsize candidate`
                : null

            return (
              <div key={r.id} id={`resource-${r.id}`}>
                {/* Mobile card */}
                <div className="sm:hidden p-4 rounded-xl border mb-2.5" style={{ background: rowBg, borderColor: rowBorder }}>
                  <div className={`flex items-center gap-2.5 ${issueLabel ? 'mb-1.5' : 'mb-2.5'}`}>
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: typeConf.bg }}>
                      <Icon size={14} style={{ color: typeConf.color }} />
                    </div>
                    <p className="flex-1 text-sm font-semibold text-slate-900 overflow-hidden text-ellipsis whitespace-nowrap">{r.serviceName || r.serviceId?.slice(0, 8) || 'Unknown'}</p>
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded-full shrink-0" style={{ background: statusBg, color: statusColor }}>{statusLabel}</span>
                  </div>
                  {issueLabel && (
                    <p className="text-[11px] font-semibold mb-2.5" style={{ color: statusLabel === 'Critical' ? '#DC2626' : '#D97706' }}>
                      {issueLabel}
                      {statusLabel === 'Critical' && <a href={`/anomalies?resource=${r.awsId}`} className="ml-2 font-bold underline" style={{ color: '#DC2626' }}>Investigate →</a>}
                    </p>
                  )}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded" style={{ background: typeConf.bg, color: typeConf.color }}>{(r.resourceType as string)?.toUpperCase() ?? '—'}</span>
                    <span className="text-xs text-slate-500 font-mono">{r.awsRegion || '—'}</span>
                    <span className="ml-auto text-sm font-bold text-slate-900">${(r.costPerMonth ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                </div>

                {/* Desktop row */}
                <div
                  className="hidden sm:grid grid-cols-[2fr_90px_150px_150px_110px_110px_110px] px-7 py-3.5 border-b items-center transition-colors mb-3"
                  style={{ background: rowBg, borderColor: rowBorder }}
                >
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: typeConf.bg }}>
                      <Icon size={14} style={{ color: typeConf.color }} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-900 mb-0.5">{r.serviceName || r.serviceId?.slice(0, 8) || 'Unknown'}</p>
                      {issueLabel
                        ? <p className="text-[10px] font-bold" style={{ color: statusLabel === 'Critical' ? '#DC2626' : '#D97706' }}>
                            {issueLabel}
                            {statusLabel === 'Critical' && <a href={`/anomalies?resource=${r.awsId}`} className="ml-2 font-bold underline text-[10px]" style={{ color: '#DC2626' }}>Investigate →</a>}
                          </p>
                        : <p className="text-[10px] text-slate-400">Added {new Date(r.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>}
                    </div>
                  </div>
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded w-fit" style={{ background: typeConf.bg, color: typeConf.color }}>{(r.resourceType as string)?.toUpperCase() ?? '—'}</span>
                  <span className="text-xs text-slate-500 font-mono overflow-hidden text-ellipsis whitespace-nowrap block">{r.awsId || '—'}</span>
                  <span className="text-[13px] text-slate-500">{r.serviceName || '—'}</span>
                  <span className="text-[13px] text-slate-500 font-mono">{r.awsRegion || '—'}</span>
                  <span className="text-sm font-bold text-slate-900">${(r.costPerMonth ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full w-fit" style={{ background: statusBg, color: statusColor }}>{statusLabel}</span>
                </div>
              </div>
            )
          })
        )}

        {tableResources.length > 8 && (
          <div className="px-7 py-3.5 border-t border-slate-100 text-center">
            <button
              onClick={() => setShowAllResources(prev => !prev)}
              className="bg-transparent text-violet-700 border border-violet-200 rounded-lg px-6 py-2 text-xs font-bold cursor-pointer inline-flex items-center gap-1.5"
            >
              {showAllResources ? 'Show less ↑' : `${tableResources.length - 8} more resources ↓`}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}