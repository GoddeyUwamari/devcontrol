'use client'

import { Suspense, useState, useEffect } from 'react'
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

// Dropdown filter pills
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
    items: [
      { value: 's3', label: 'S3' },
    ],
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
  { id: 'r2', serviceId: 'svc-2', serviceName: 'auth-service',         resourceType: 'ec2',    awsId: 'arn:aws:ecs:auth',   awsRegion: 'us-east-1', status: 'running', costPerMonth: 178.00, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'r3', serviceId: 'svc-3', serviceName: 'payment-processor',    resourceType: 'lambda', awsId: 'payment-fn-prod',    awsRegion: 'us-west-2', status: 'running', costPerMonth: 89.50,  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'r4', serviceId: 'svc-4', serviceName: 'notification-service', resourceType: 'lambda', awsId: 'notify-fn-prod',     awsRegion: 'us-east-1', status: 'running', costPerMonth: 156.30, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'r5', serviceId: 'svc-5', serviceName: 'analytics-worker',     resourceType: 'ec2',    awsId: 'i-9z8y7x6w5v',      awsRegion: 'eu-west-1', status: 'running', costPerMonth: 312.80, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'r6', serviceId: 'svc-1', serviceName: 'api-gateway',          resourceType: 'rds',    awsId: 'rds-prod-01',        awsRegion: 'us-east-1', status: 'running', costPerMonth: 445.00, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'r7', serviceId: 'svc-2', serviceName: 'auth-service',         resourceType: 's3',     awsId: 'auth-assets-bucket', awsRegion: 'us-east-1', status: 'running', costPerMonth: 23.40,  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'r8', serviceId: 'svc-3', serviceName: 'payment-processor',    resourceType: 'rds',    awsId: 'rds-payments-01',    awsRegion: 'us-west-2', status: 'pending', costPerMonth: 398.00, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
]

async function fetchRealSavings(): Promise<number | null> {
  const token =
    typeof window !== 'undefined'
      ? localStorage.getItem('accessToken')
      : null
  if (!token) return null
  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080'}/api/cost-optimization/results`,
      {
        headers: { 'Authorization': `Bearer ${token}` },
        credentials: 'include',
      }
    )
    if (!res.ok) return null
    const data = await res.json()
    const results = data.results ?? []
    return results.reduce(
      (sum: number, r: any) => sum + (parseFloat(r.monthlySavings ?? r.monthly_savings) || 0),
      0
    )
  } catch {
    return null
  }
}

async function fetchSystemIntelligence(): Promise<{
  system_score: number
  status: string
  top_action: string
  top_drivers: any[]
  components: {
    cost:          { score: number; detail: string; status: string }
    security:      { score: number; detail: string; status: string }
    observability: { score: number; detail: string; status: string }
  }
} | null> {
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
  } catch {
    return null
  }
}

async function fetchTopActions(): Promise<{
  id: string
  title: string
  savings: number | null
  risk: 'zero' | 'review'
  urgency: 'now' | 'today' | 'schedule'
  subtitle: string
  type: 'cost' | 'reliability'
}[] | null> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null
  if (!token) return null
  try {
    const [costRes, anomalyRes] = await Promise.all([
      fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080'}/api/cost-optimization/results`,
        { headers: { Authorization: `Bearer ${token}` }, credentials: 'include' }
      ),
      fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080'}/api/anomalies`,
        { headers: { Authorization: `Bearer ${token}` }, credentials: 'include' }
      ),
    ])

    const costData    = costRes.ok    ? await costRes.json()    : { results: [] }
    const anomalyData = anomalyRes.ok ? await anomalyRes.json() : { anomalies: [] }

    const costActions = (costData.results ?? [])
      .filter((r: any) => (parseFloat(r.monthlySavings ?? r.monthly_savings) || 0) > 0)
      .sort((a: any, b: any) =>
        (parseFloat(b.monthlySavings ?? b.monthly_savings) || 0) -
        (parseFloat(a.monthlySavings ?? a.monthly_savings) || 0)
      )
      .slice(0, 3)
      .map((r: any, i: number) => ({
        id:       r.id ?? `cost-${i}`,
        title:    r.title ?? r.recommendation ?? 'Cost optimization available',
        savings:  Math.round(parseFloat(r.monthlySavings ?? r.monthly_savings) || 0),
        risk:     'zero' as const,
        urgency:  i === 0 ? 'now' as const : 'today' as const,
        subtitle: `${r.resourceName ?? r.resource_name ?? 'Resource'} · ${r.region ?? 'us-east-1'} · cost leakage active`,
        type:     'cost' as const,
      }))

    const reliabilityActions = (anomalyData.anomalies ?? anomalyData ?? [])
      .filter((a: any) => a.severity === 'critical' || a.severity === 'high')
      .slice(0, 1)
      .map((a: any) => ({
        id:       a.id ?? 'anomaly-0',
        title:    a.title ?? a.message ?? 'Reliability issue detected',
        savings:  null,
        risk:     'review' as const,
        urgency:  'now' as const,
        subtitle: `${a.resourceName ?? a.resource ?? 'Resource'} · ${a.impact ?? 'potential downtime risk'}`,
        type:     'reliability' as const,
      }))

    return [...reliabilityActions, ...costActions].slice(0, 4)
  } catch {
    return null
  }
}

export default function InfrastructurePage() {
  return (
    <Suspense fallback={<div style={{ padding: '48px', textAlign: 'center', color: '#6b7280' }}>Loading...</div>}>
      <InfrastructureContent />
    </Suspense>
  )
}

function InfrastructureContent() {
  const queryClient = useQueryClient()

  const [selectedType,  setSelectedType]  = useState<string | null>(null)
  const [openDropdown,  setOpenDropdown]  = useState<string | null>(null)

  // Close dropdown on outside click
  useEffect(() => {
    const close = () => setOpenDropdown(null)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const demoMode = useDemoMode()
  const salesDemoMode = useSalesDemo((state) => state.enabled)
  const isDemoActive = demoMode || salesDemoMode

  const { data: resources = [], isLoading, refetch } = useQuery({
    queryKey: ['infrastructure', selectedType],
    queryFn: async () => {
      const allResources = await infrastructureService.getAll(
        selectedType ? { resourceType: selectedType as ResourceType } : undefined
      )
      return allResources.filter(r => (r.resourceType as string) !== 'AWS_COST_TOTAL')
    },
    enabled: !isDemoActive,
  })

  // All resources (unfiltered) — used for monthly cost in real mode
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

  const [isSyncing, setIsSyncing] = useState(false)
  const [syncComplete, setSyncComplete] = useState(false)
  const [hoveredCard, setHoveredCard] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<string | null>(null)
  const [showAllResources, setShowAllResources] = useState(false)
  const [issueFilter, setIssueFilter] = useState<string>('all')
  const [sortOrder, setSortOrder] = useState<string>('impact')

  // FIX 3: Fetch real stats from /api/services/stats when not in demo mode
  const { data: apiStats, isLoading: statsLoading } = useQuery({
    queryKey: ['services-stats'],
    queryFn: awsServicesService.getStats,
    enabled: !isDemoActive,
  })

  // FIX 2: Wire Sync AWS to real discovery endpoint
  const handleSyncAWS = async () => {
    if (isDemoActive) {
      setIsSyncing(true)
      await new Promise(r => setTimeout(r, 2000))
      setIsSyncing(false)
      setSyncComplete(true)
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
      setSyncComplete(true)
      setTimeout(() => setSyncComplete(false), 3000)
    } catch {
      toast.error('Sync failed — check your AWS connection')
    } finally {
      setIsSyncing(false)
    }
  }

  const displayResources = isDemoActive ? DEMO_RESOURCES : resources

  const filteredResources = displayResources.filter((r: InfrastructureResource) => {
    if (selectedType && r.resourceType !== selectedType) return false
    if (statusFilter === 'active') return r.status === 'running'
    if (statusFilter === 'warning') return r.status === 'pending' || r.status === 'stopped'
    return true
  })

  const effectiveResources =
    !isDemoActive &&
    filteredResources.length === 0 &&
    selectedType === null &&
    statusFilter === null &&
    allResources.length > 0
      ? allResources
      : filteredResources

  // FIX 3: KPI stats — demo uses computed values, real mode uses API stats
  const demoTotal       = DEMO_RESOURCES.length
  const demoMonthlyCost = DEMO_RESOURCES.reduce((sum, r) => sum + (r.costPerMonth || 0), 0)
  const demoActive      = DEMO_RESOURCES.filter(r => r.status === 'running').length
  const demoWarning     = DEMO_RESOURCES.filter(r => r.status === 'pending' || r.status === 'stopped').length

  const realMonthlyCost = allResources.reduce((sum: number, r: InfrastructureResource) => sum + (r.costPerMonth || 0), 0)

  const totalResources  = isDemoActive ? demoTotal       : (statsLoading ? null : (apiStats?.total       ?? 0))
  const totalMonthlyCost= isDemoActive ? demoMonthlyCost : realMonthlyCost
  const activeCount     = isDemoActive ? demoActive      : (statsLoading ? null : (apiStats?.healthy      ?? 0))
  const warningCount    = isDemoActive ? demoWarning     : (statsLoading ? null : (apiStats?.needs_attention ?? 0))

  const DEMO_INTELLIGENCE = {
    system_score: 73,
    status: 'warning',
    top_action: { message: 'Over-provisioned compute + unused storage', consequence: '', path: '/costs/cost-optimization', severity: 'high' },
    top_drivers: [],
    components: {
      cost:          { score: 55, detail: '$2,039/mo savings identified', status: 'warning' },
      security:      { score: 87, detail: 'No critical issues',           status: 'good'    },
      observability: { score: 65, detail: '11 alarms configured',         status: 'warning' },
    },
  }

  const intel = isDemoActive
    ? DEMO_INTELLIGENCE
    : (systemIntelligence ?? DEMO_INTELLIGENCE)

  const intelComponents = intel.components ?? DEMO_INTELLIGENCE.components

  const intelScore         = intel.system_score
  const intelStatus        = intel.status === 'good' ? 'Healthy' : intel.status === 'warning' ? 'Partially Optimized' : 'At Risk'
  const intelTopAction = typeof intel.top_action === 'string'
    ? intel.top_action
    : intel.top_action?.message ?? 'Over-provisioned compute + unused storage'
  const intelCostScore     = intelComponents.cost.score
  const intelSecurityScore = intelComponents.security.score
  const intelObsScore      = intelComponents.observability.score
  const intelScoreDelta    = isDemoActive ? 18 : (intel.system_score > 0 ? Math.min(Math.round((100 - intel.system_score) * 0.55), 25) : 0)
  const intelWaste         = realSavingsTotal ?? (isDemoActive ? 1060 : 0)
  const intelAnalyzed      = isDemoActive ? DEMO_RESOURCES.length : (allResources.length || 0)
  const intelTotal         = isDemoActive ? 20 : ((totalResources as number) || intelAnalyzed)
  const scoreCircumference = 144.5
  const scoreOffset        = intelScore > 0
    ? scoreCircumference - (intelScore / 100) * scoreCircumference
    : scoreCircumference

  const scoreChip = (score: number) => ({
    color: score >= 80 ? '#065F46' : '#92400E',
    bg:    score >= 80 ? '#D1FAE5' : '#FEF3C7',
  })

  const DEMO_TOP_ACTIONS = [
    {
      id: 'demo-1', rank: '01', urgency: 'now'   as const, risk: 'zero'   as const,
      title: 'Downsize RDS cluster', savings: 740,
      sub: 'production-postgres-primary · us-east-1 · cost leakage active',
      bg: '#FFF8F8', border: '#FECACA', isTop: true,
    },
    {
      id: 'demo-2', rank: '02', urgency: 'now'   as const, risk: 'review' as const,
      title: 'Investigate CloudFront latency warnings', savings: null,
      sub: 'production-cdn · potential downtime risk · degraded user experience',
      bg: '#FFF8F8', border: '#FECACA', isTop: false,
    },
    {
      id: 'demo-3', rank: '03', urgency: 'today' as const, risk: 'zero'   as const,
      title: 'Remove unused EBS volumes', savings: 320,
      sub: '6 unattached volumes · us-east-1 · no impact to workloads',
      bg: '#F8FAFC', border: '#F1F5F9', isTop: false,
    },
    {
      id: 'demo-4', rank: '04', urgency: 'today' as const, risk: 'zero'   as const,
      title: 'Rightsize idle EC2 instances', savings: 580,
      sub: 'analytics-warehouse · us-east-1 · avg 12% CPU utilization',
      bg: '#F8FAFC', border: '#F1F5F9', isTop: false,
    },
  ]

  const displayTopActions = isDemoActive
    ? DEMO_TOP_ACTIONS
    : (topActionsData ?? []).map((a, i) => ({
        id:      a.id,
        rank:    String(i + 1).padStart(2, '0'),
        urgency: a.urgency,
        risk:    a.risk,
        title:   a.title,
        savings: a.savings,
        sub:     a.subtitle,
        bg:      a.urgency === 'now'   ? '#FFF8F8' : '#F8FAFC',
        border:  a.urgency === 'now'   ? '#FECACA' : '#F1F5F9',
        isTop:   i === 0,
      }))

  const zeroRiskCount       = displayTopActions.filter(a => a.risk === 'zero').length
  const totalRecoverable    = displayTopActions.reduce((sum, a) => sum + (a.savings ?? 0), 0)

  const displayRecommendationsCount = isDemoActive ? 3 : recommendationsCount

  const formatSavings = (val: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val)

  const potentialSavingsValue = isDemoActive
    ? '$1,697/mo'
    : realSavingsTotal != null && realSavingsTotal > 0
      ? `$${Math.round(realSavingsTotal).toLocaleString()}/mo`
      : savingsLoading
        ? '—'
        : formatSavings(recommendationStats?.totalPotentialSavings ?? 0)

  // Cost by service — group allResources by serviceName, sum costPerMonth
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
    return Object.entries(map)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([name, cost]) => ({
        name,
        cost,
        pct: Math.round((cost / total) * 100),
        barWidth: Math.round((cost / maxCost) * 100),
      }))
  })()

  // Values shown in the AI insight banner still use displayResources for region counts
  const regionCount = new Set(displayResources.map((r: InfrastructureResource) => r.awsRegion)).size

  const tableResources = (() => {
    let rows = [...effectiveResources]

    // Issue filter
    if (issueFilter === 'Cost Waste') {
      rows = rows.filter(r => (r.costPerMonth ?? 0) > 400)
    } else if (issueFilter === 'Reliability Risk') {
      rows = rows.filter(r => r.status === 'pending' || r.status === 'stopped')
    } else if (issueFilter === 'Healthy') {
      rows = rows.filter(r => r.status === 'running' && (r.costPerMonth ?? 0) <= 400)
    }

    // Sort
    if (sortOrder === 'impact') {
      rows = rows.sort((a, b) => {
        const aScore = (a.status === 'pending' || a.status === 'stopped') ? 999999 : (a.costPerMonth ?? 0)
        const bScore = (b.status === 'pending' || b.status === 'stopped') ? 999999 : (b.costPerMonth ?? 0)
        return bScore - aScore
      })
    } else if (sortOrder === 'cost-high') {
      rows = rows.sort((a, b) => (b.costPerMonth ?? 0) - (a.costPerMonth ?? 0))
    } else if (sortOrder === 'status') {
      rows = rows.sort((a, b) => a.status.localeCompare(b.status))
    }

    return rows
  })()

  return (
    <div style={{
      padding: '40px 56px 64px',
      maxWidth: '1320px',
      margin: '0 auto',
      minHeight: '100vh',
      background: '#F9FAFB',
      fontFamily: 'Inter, system-ui, sans-serif',
    }}>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

      {/* PAGE HEADER */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '32px' }}>
        <div>
          <p style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#7C3AED', margin: '0 0 6px' }}>
            Infrastructure
          </p>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: '#0F172A', margin: '0 0 6px', letterSpacing: '-0.02em' }}>
            AWS System Intelligence
          </h1>
          <p style={{ fontSize: '0.875rem', color: '#475569', margin: 0, lineHeight: 1.6 }}>
            Real-time visibility into cost, health, and risk across your AWS infrastructure.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            onClick={handleSyncAWS}
            disabled={isSyncing}
            style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              background: syncComplete ? '#059669' : '#fff',
              color: syncComplete ? '#fff' : '#475569',
              padding: '10px 20px', borderRadius: '8px',
              fontSize: '0.875rem', fontWeight: 600,
              border: `1px solid ${syncComplete ? '#059669' : '#E2E8F0'}`,
              cursor: isSyncing ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s',
            }}>
            {isSyncing
              ? <><RefreshCw size={15} style={{ animation: 'spin 1s linear infinite' }} /> Syncing AWS...</>
              : syncComplete
                ? <><Check size={15} /> Sync Complete</>
                : (!isDemoActive && allResources.length === 0)
                  ? <><RefreshCw size={15} /> Scan My AWS for Cost & Risk</>
                  : <><RefreshCw size={15} /> Sync AWS</>
            }
          </button>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
            <a
              href="/costs/cost-optimization"
              style={{
                display: 'flex', alignItems: 'center', gap: '7px',
                background: '#7C3AED', color: '#fff',
                padding: '9px 18px', borderRadius: '7px',
                fontSize: '12px', fontWeight: 700, textDecoration: 'none',
              }}
            >
              <Check size={13} /> Apply Recommended Fixes
            </a>
            <p style={{ fontSize: '0.65rem', color: '#64748B', margin: 0, textAlign: 'right' }}>
              Applies 3 zero-risk optimizations · No downtime · Est. savings: $1,060/mo
            </p>
          </div>
        </div>
      </div>

      {/* SYSTEM INTELLIGENCE STRIP */}
      <div style={{
        background: '#fff', borderRadius: '10px',
        border: '1px solid #E2E8F0', borderLeft: '4px solid #7C3AED',
        padding: '20px 24px', marginBottom: '16px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap' }}>

          {/* Score ring */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ position: 'relative', width: '54px', height: '54px', flexShrink: 0 }}>
              <svg width="54" height="54" viewBox="0 0 54 54">
                <circle cx="27" cy="27" r="23" fill="none" stroke="#F1F5F9" strokeWidth="5"/>
                <circle cx="27" cy="27" r="23" fill="none" stroke="#7C3AED" strokeWidth="5"
                  strokeDasharray="144.5" strokeDashoffset={scoreOffset}
                  strokeLinecap="round" transform="rotate(-90 27 27)"/>
              </svg>
              <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', fontWeight: 700, color: '#0F172A' }}>{intelScore}</span>
            </div>
            <div>
              <p style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#64748B', margin: '0 0 4px' }}>System Score</p>
              <p style={{ fontSize: '0.95rem', fontWeight: 700, color: '#0F172A', margin: '0 0 3px' }}>{intelStatus}</p>
              <p style={{ fontSize: '0.68rem', color: '#64748B', margin: 0 }}>{`${intelAnalyzed}/${intelTotal} resources analyzed · High confidence`}</p>
            </div>
          </div>

          <div style={{ width: '1px', height: '44px', background: '#E2E8F0', flexShrink: 0 }} />

          {/* Primary Issue */}
          <div>
            <p style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#64748B', margin: '0 0 4px' }}>Primary Issue</p>
            <p style={{ fontSize: '0.85rem', fontWeight: 600, color: '#0F172A', margin: '0 0 3px' }}>{intelTopAction}</p>
            <p style={{ fontSize: '0.72rem', fontWeight: 700, color: '#DC2626', margin: 0 }}>{`$${Math.round(intelWaste).toLocaleString()}/mo active waste`}</p>
          </div>

          <div style={{ width: '1px', height: '44px', background: '#E2E8F0', flexShrink: 0 }} />

          {/* Score Impact */}
          <div>
            <p style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#64748B', margin: '0 0 4px' }}>Score Impact if Resolved</p>
            <p style={{ fontSize: '0.95rem', fontWeight: 700, color: '#7C3AED', margin: '0 0 3px' }}>{`+${intelScoreDelta} pts`}</p>
            <p style={{ fontSize: '0.68rem', color: '#64748B', margin: 0 }}>Within 24–48h after fixes applied</p>
          </div>

          <div style={{ width: '1px', height: '44px', background: '#E2E8F0', flexShrink: 0 }} />

          {/* Component scores */}
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            {[
              { label: 'Cost',          score: `${intelCostScore}/100`,     chip: scoreChip(intelCostScore)     },
              { label: 'Security',      score: `${intelSecurityScore}/100`, chip: scoreChip(intelSecurityScore) },
              { label: 'Observability', score: `${intelObsScore}/100`,      chip: scoreChip(intelObsScore)      },
            ].map(({ label, score, chip }) => (
              <div key={label} style={{ textAlign: 'center' }}>
                <p style={{ fontSize: '9px', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 4px' }}>{label}</p>
                <span style={{ fontSize: '12px', fontWeight: 700, color: chip.color, background: chip.bg, padding: '3px 10px', borderRadius: '100px' }}>{score}</span>
              </div>
            ))}
          </div>

        </div>

        <a href="/costs/ai-reports" style={{ fontSize: '11px', fontWeight: 700, color: '#7C3AED', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap', flexShrink: 0 }}>
          Full report <ArrowRight size={11} />
        </a>
      </div>

      {/* COST BY SERVICE */}
      {costByService.length > 0 && (
        <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: '8px', padding: '16px 20px', marginBottom: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
            <span style={{ fontSize: '0.72rem', fontWeight: 600, letterSpacing: '0.08em', color: '#6B7280', textTransform: 'uppercase' }}>Cost by Service</span>
            <span style={{ fontSize: '0.75rem', color: '#9CA3AF' }}>Last 30 days</span>
          </div>
          <p style={{ fontSize: '0.78rem', color: '#475569', margin: '0 0 14px' }}>
            Top concentration:{' '}
            <strong style={{ color: '#0F172A' }}>Analytics (20%)</strong> and{' '}
            <strong style={{ color: '#0F172A' }}>PostgreSQL (16%)</strong> — primary rightsizing candidates driving $1,060/mo in recoverable waste.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {costByService.map((row) => (
              <div key={row.name} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '4px 0' }}>
                <span style={{ width: '160px', fontSize: '0.875rem', color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }}>{row.name}</span>
                <div style={{ flex: 1, height: '6px', background: '#F3F4F6', borderRadius: '3px', overflow: 'hidden' }}>
                  <div style={{ width: `${row.barWidth}%`, height: '100%', background: '#7C3AED', borderRadius: '3px' }} />
                </div>
                <span style={{ width: '80px', textAlign: 'right', fontSize: '0.875rem', fontWeight: 600, color: '#111827', flexShrink: 0 }}>
                  ${row.cost.toFixed(2)}
                </span>
                <span style={{ width: '45px', textAlign: 'right', fontSize: '0.8rem', color: '#6B7280', flexShrink: 0 }}>{row.pct}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 5 KPI CARDS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '20px', marginBottom: '28px' }}>

        {/* Total Resources — display only */}
        <div style={{ background: '#fff', borderRadius: '12px', padding: '32px', border: '0.5px solid #e5e7eb' }}>
          <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 16px' }}>Total Resources</p>
          <div style={{ fontSize: '2.5rem', fontWeight: 700, color: '#0F172A', letterSpacing: '-0.03em', lineHeight: 1, marginBottom: '8px' }}>{statsLoading && !isDemoActive ? '—' : (totalResources ?? '—')}</div>
          <p style={{ fontSize: '0.78rem', color: '#475569', margin: 0, lineHeight: 1.6 }}>
            {isDemoActive
              ? 'Across all regions'
              : regionCount > 0
                ? `Across ${regionCount} region${regionCount !== 1 ? 's' : ''}`
                : 'Across all regions'
            }
          </p>
        </div>

        {/* Monthly Cost — display only */}
        <div style={{ background: '#fff', borderRadius: '12px', padding: '32px', border: '0.5px solid #e5e7eb' }}>
          <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 16px' }}>Monthly Cost</p>
          <div style={{ fontSize: '2.5rem', fontWeight: 700, color: '#0F172A', letterSpacing: '-0.03em', lineHeight: 1, marginBottom: '8px' }}>
            {isDemoActive
              ? `$${Math.round(totalMonthlyCost).toLocaleString()}`
              : totalMonthlyCost > 0
                ? `$${Math.round(totalMonthlyCost).toLocaleString()}`
                : '—'
            }
          </div>
          <p style={{ fontSize: '0.78rem', color: '#475569', margin: 0, lineHeight: 1.6 }}>
            {isDemoActive
              ? 'All resources combined'
              : totalMonthlyCost > 0
                ? 'All resources combined'
                : 'Syncing from Cost Explorer'
            }
          </p>
        </div>

        {/* Healthy — click to filter */}
        <div
          style={{ background: '#fff', borderRadius: '12px', padding: '32px', border: hoveredCard === 'active' || statusFilter === 'active' ? '0.5px solid #7C3AED' : '0.5px solid #e5e7eb', transition: 'border-color 0.15s ease', cursor: 'pointer' }}
          onMouseEnter={() => setHoveredCard('active')}
          onMouseLeave={() => setHoveredCard(null)}
          onClick={() => setStatusFilter(statusFilter === 'active' ? null : 'active')}
        >
          <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 16px' }}>Healthy</p>
          <div style={{ fontSize: '2.5rem', fontWeight: 700, color: '#059669', letterSpacing: '-0.03em', lineHeight: 1, marginBottom: '8px' }}>{statsLoading && !isDemoActive ? '—' : (activeCount ?? '—')}</div>
          <p style={{ fontSize: '0.78rem', color: '#475569', margin: '0 0 2px', lineHeight: 1.6 }}>Running normally</p>
          <p style={{ fontSize: '11px', color: '#9ca3af', margin: 0 }}>Click to filter</p>
        </div>

        {/* Critical Issues — click to filter */}
        <div
          style={{
            background: '#fff', borderRadius: '12px', padding: '32px',
            border: hoveredCard === 'warning' || statusFilter === 'warning'
              ? '0.5px solid #7C3AED'
              : '1px solid #FECACA',
            borderLeft: '3px solid #DC2626',
            transition: 'border-color 0.15s ease', cursor: 'pointer',
          }}
          onMouseEnter={() => setHoveredCard('warning')}
          onMouseLeave={() => setHoveredCard(null)}
          onClick={() => setStatusFilter(statusFilter === 'warning' ? null : 'warning')}
        >
          <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#DC2626', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 16px' }}>Critical Issues</p>
          <div style={{ fontSize: '2.5rem', fontWeight: 700, color: '#DC2626', letterSpacing: '-0.03em', lineHeight: 1, marginBottom: '8px' }}>{statsLoading && !isDemoActive ? '—' : (warningCount ?? '—')}</div>
          <p style={{ fontSize: '0.78rem', color: '#475569', margin: '0 0 2px', lineHeight: 1.6 }}>
            1 cost inefficiency · 1 reliability risk
          </p>
          <p style={{ fontSize: '0.68rem', color: '#DC2626', margin: 0, fontWeight: 500 }}>
            Resolve now →
          </p>
        </div>

        {/* Recoverable Savings — display only */}
        <div style={{ background: '#fff', borderRadius: '12px', padding: '32px', border: '1px solid #A7F3D0' }}>
          <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#059669', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 16px' }}>Recoverable Savings</p>
          <div style={{ fontSize: '2.5rem', fontWeight: 700, color: '#16A34A', letterSpacing: '-0.03em', lineHeight: 1, marginBottom: '8px' }}>{potentialSavingsValue}</div>
          <p style={{ fontSize: '0.72rem', color: '#64748B', margin: '0 0 4px' }}>
            {totalMonthlyCost > 0 && (realSavingsTotal ?? 0) > 0
              ? `${Math.round(((realSavingsTotal ?? 0) / totalMonthlyCost) * 100)}% of total spend`
              : isDemoActive
                ? '18% of total spend'
                : ''
            }
          </p>
          <p style={{ fontSize: '0.78rem', color: '#475569', margin: 0, lineHeight: 1.6 }}>
            {realSavingsTotal && realSavingsTotal > 0
              ? 'Approve to capture savings'
              : isDemoActive
                ? 'Approve to capture savings'
                : 'Run scan to identify savings'}
          </p>
          {(isDemoActive || (realSavingsTotal && realSavingsTotal > 0)) && (
            <a
              href="/costs/cost-optimization"
              style={{
                fontSize: '0.72rem', fontWeight: 600, color: '#059669',
                textDecoration: 'none', display: 'inline-flex', alignItems: 'center',
                gap: '3px', marginTop: '6px',
              }}
            >
              Review opportunities →
            </a>
          )}
        </div>

      </div>

      {/* TOP ACTIONS */}
      <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: '12px', padding: '20px 24px', marginBottom: '18px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
          <div>
            <p style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#64748B', margin: '0 0 3px' }}>Top Actions</p>
            <p style={{ fontSize: '0.8rem', color: '#475569', margin: 0 }}>
              Ranked by impact · {zeroRiskCount} zero-risk changes ready ·{' '}
              <strong style={{ color: '#059669' }}>${totalRecoverable.toLocaleString()}/mo recoverable today</strong>
            </p>
          </div>
          <span style={{ display: 'inline-flex', alignItems: 'center', padding: '2px 8px', borderRadius: '4px', fontSize: '9.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', background: '#DC2626', color: '#fff' }}>Act Now</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '9px' }}>
          {displayTopActions.map((action) => (
            <div key={action.id} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: action.isTop ? '15px 16px' : '13px 16px', background: action.bg,
              borderRadius: '8px', border: action.isTop ? `2px solid ${action.border}` : `1px solid ${action.border}`,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#94A3B8', minWidth: '16px' }}>{action.rank}</span>
                <div>
                  <p style={{ fontSize: '0.84rem', fontWeight: 600, color: '#0F172A', margin: '0 0 3px' }}>
                    {action.title}
                    {action.savings != null && <span style={{ color: '#059669', fontWeight: 700 }}> — save ${action.savings.toLocaleString()}/mo</span>}
                  </p>
                  <p style={{ fontSize: '0.7rem', color: '#64748B', margin: 0 }}>{action.sub}</p>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '7px', flexShrink: 0 }}>
                {action.risk === 'zero'
                  ? <span style={{ display: 'inline-flex', padding: '2px 7px', borderRadius: '4px', fontSize: '9.5px', fontWeight: 700, textTransform: 'uppercase', background: '#D1FAE5', color: '#065F46' }}>Zero Risk</span>
                  : <span style={{ display: 'inline-flex', padding: '2px 7px', borderRadius: '4px', fontSize: '9.5px', fontWeight: 700, textTransform: 'uppercase', background: '#FEF3C7', color: '#92400E' }}>Review Impact</span>
                }
                {action.isTop && (
                  <span style={{
                    display: 'inline-flex', padding: '2px 7px', borderRadius: '4px',
                    fontSize: '9.5px', fontWeight: 700, textTransform: 'uppercase',
                    letterSpacing: '0.06em', background: '#7C3AED', color: '#fff',
                  }}>
                    Highest Impact
                  </span>
                )}
                {action.urgency === 'now'
                  ? <span style={{ display: 'inline-flex', padding: '2px 7px', borderRadius: '4px', fontSize: '9.5px', fontWeight: 700, textTransform: 'uppercase', background: '#DC2626', color: '#fff' }}>Now</span>
                  : <span style={{ display: 'inline-flex', padding: '2px 7px', borderRadius: '4px', fontSize: '9.5px', fontWeight: 700, textTransform: 'uppercase', background: '#D1FAE5', color: '#065F46' }}>Today</span>
                }
                {action.risk === 'zero'
                  ? <a href="/costs/cost-optimization" style={{ background: '#059669', color: '#fff', border: 'none', borderRadius: '6px', padding: '5px 13px', fontSize: '11px', fontWeight: 700, cursor: 'pointer', textDecoration: 'none' }}>Fix →</a>
                  : <a href="/anomalies" style={{ background: 'transparent', color: '#475569', border: '1px solid #E2E8F0', borderRadius: '6px', padding: '5px 12px', fontSize: '11px', fontWeight: 600, cursor: 'pointer', textDecoration: 'none' }}>Review →</a>
                }
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* RESOURCE TABLE */}
      <div style={{ background: '#fff', borderRadius: '16px', border: '1px solid #F1F5F9', overflow: 'hidden' }}>

        {/* Table header + dropdown filter pills */}
        <div style={{ padding: '20px 28px', borderBottom: '1px solid #F1F5F9' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
            <div>
              {isDemoActive
                ? <p style={{ fontSize: '0.78rem', color: '#94A3B8', margin: 0 }}>{DEMO_RESOURCES.length} resources (demo data)</p>
                : (totalResources !== null && (totalResources as number) > 0)
                  ? <p style={{ fontSize: '0.78rem', color: '#94A3B8', margin: 0 }}>{effectiveResources.length} of{' '}{totalResources ?? allResources.length}{' '}resources</p>
                  : <p style={{ fontSize: '0.78rem', color: '#94A3B8', margin: 0 }}>0 resources</p>
              }
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
            <select value={issueFilter} onChange={(e) => setIssueFilter(e.target.value)} style={{ fontSize: '11px', fontWeight: 600, color: '#374151', border: '1px solid #E5E7EB', borderRadius: '100px', padding: '4px 12px', background: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>
              <option value="all">View by Issue ▾</option>
              <option value="Cost Waste">Cost Waste</option>
              <option value="Reliability Risk">Reliability Risk</option>
              <option value="Healthy">Healthy</option>
            </select>
            <select value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} style={{ fontSize: '11px', fontWeight: 600, color: '#374151', border: '1px solid #E5E7EB', borderRadius: '100px', padding: '4px 12px', background: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>
              <option value="impact">Sort: Impact ▾</option>
              <option value="cost-high">Sort: Cost (High)</option>
              <option value="status">Sort: Status</option>
            </select>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {DROPDOWN_PILLS.map((pill) => {
              const isActive = pill.key === 'all'
                ? selectedType === null
                : pill.items.some(i => i.value === selectedType)
              const isOpen = openDropdown === pill.key
              return (
                <div key={pill.key} style={{ position: 'relative' }}>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setOpenDropdown(isOpen ? null : pill.key)
                    }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '6px',
                      padding: '5px 12px', borderRadius: '100px', fontSize: '0.75rem', fontWeight: 600,
                      border: isActive ? 'none' : '1px solid #E5E7EB',
                      cursor: 'pointer', transition: 'all 0.15s',
                      background: isActive ? '#7C3AED' : '#fff',
                      color: isActive ? '#fff' : '#374151',
                    }}>
                    {pill.label}
                    <span style={{ fontSize: '0.6rem', opacity: 0.7 }}>▼</span>
                  </button>
                  {isOpen && (
                    <div
                      onMouseDown={(e) => e.stopPropagation()}
                      style={{
                        position: 'absolute', top: 'calc(100% + 6px)', left: 0,
                        background: '#fff', border: '1px solid #E5E7EB', borderRadius: '8px',
                        boxShadow: '0 4px 16px rgba(0,0,0,0.10)', zIndex: 50,
                        minWidth: '160px', overflow: 'hidden',
                      }}>
                      {pill.items.map((item) => {
                        const isSel = item.value === null ? selectedType === null : item.value === selectedType
                        return (
                          <button
                            key={item.value ?? '__all__'}
                            onClick={() => {
                              setSelectedType(item.value)
                              setOpenDropdown(null)
                            }}
                            style={{
                              display: 'block', width: '100%', textAlign: 'left',
                              padding: '8px 16px', fontSize: '0.82rem', border: 'none',
                              cursor: 'pointer', background: 'transparent',
                              color: isSel ? '#7C3AED' : '#374151',
                              fontWeight: isSel ? 600 : 400,
                            }}
                            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#F9FAFB' }}
                            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}>
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

        {/* Column headers */}
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 90px 150px 150px 110px 110px 110px', padding: '10px 28px', background: '#F8FAFC', borderBottom: '1px solid #F1F5F9' }}>
          {['Resource', 'Type', 'AWS ID', 'Service', 'Region', 'Monthly Cost', 'Issue'].map(col => (
            <span key={col} style={{ fontSize: '0.7rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{col}</span>
          ))}
        </div>

        {/* Rows */}
        {isLoading && !isDemoActive ? (
          <div style={{ padding: '48px', textAlign: 'center' }}>
            <RefreshCw size={20} style={{ color: '#94A3B8', margin: '0 auto 12px' }} />
            <p style={{ fontSize: '0.875rem', color: '#64748B', margin: 0 }}>Loading resources...</p>
          </div>
        ) : !isDemoActive && effectiveResources.length === 0 ? (
          <div style={{ padding: '64px', textAlign: 'center' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: '#F8FAFC', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
              <Server size={22} style={{ color: '#94A3B8' }} />
            </div>
            <div style={{ marginBottom: '24px' }}>
              <p style={{ fontSize: '1rem', fontWeight: 600, color: '#0F172A', margin: '0 0 6px' }}>
                No infrastructure data yet
              </p>
              <p style={{ fontSize: '0.875rem', color: '#475569', margin: '0 0 20px', lineHeight: 1.6 }}>
                Connect your AWS account to uncover cost leaks, security risks, and idle resources — first insights in under 2 minutes.
              </p>
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px',
                maxWidth: '480px', margin: '0 auto 24px', textAlign: 'left',
              }}>
                {[
                  '💸 Idle EC2 instances draining budget',
                  '🗄️ Underutilized RDS databases',
                  '🔒 Misconfigured security groups',
                  '📦 Unused S3 storage accumulating',
                ].map(item => (
                  <div key={item} style={{
                    fontSize: '0.78rem', color: '#475569', background: '#F8FAFC',
                    borderRadius: '8px', padding: '10px 12px', border: '1px solid #F1F5F9',
                  }}>
                    {item}
                  </div>
                ))}
              </div>
              <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: '12px 0 0' }}>
                Read-only access · No changes to infrastructure · Cancel anytime
              </p>
            </div>
            <button
              onClick={handleSyncAWS}
              style={{ background: '#7C3AED', color: '#fff', padding: '10px 24px', borderRadius: '8px', fontSize: '0.875rem', fontWeight: 600, border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
              <RefreshCw size={14} /> Scan My AWS for Cost &amp; Risk
            </button>
          </div>
        ) : (
          (showAllResources ? tableResources : tableResources.slice(0, 8)).map((r: InfrastructureResource, idx: number) => {
            const typeConf = resourceTypeConfig[r.resourceType?.toLowerCase() as string] || resourceTypeConfig.default
            const Icon = typeConf.icon

            const isReliabilityRisk = r.status === 'pending' || r.status === 'stopped'
            const isCostWaste = r.costPerMonth != null && r.costPerMonth > 400

            const statusLabel = r.status === 'running' && !isCostWaste
              ? 'Healthy'
              : isCostWaste && r.status === 'running'
                ? 'Cost Waste'
                : isReliabilityRisk
                  ? 'Critical'
                  : r.status ?? '—'

            const statusColor = statusLabel === 'Critical'  ? '#fff'    : statusLabel === 'Cost Waste' ? '#92400E' : '#475569'
            const statusBg    = statusLabel === 'Critical'  ? '#DC2626' : statusLabel === 'Cost Waste' ? '#FEF3C7' : '#F1F5F9'

            const rowBg     = statusLabel === 'Critical'  ? '#FFF5F5' : statusLabel === 'Cost Waste' ? '#FFFBEB' : 'transparent'
            const rowBorder = statusLabel === 'Critical'  ? '#FEE2E2' : statusLabel === 'Cost Waste' ? '#FDE68A' : '#F8FAFC'

            const issueLabel = statusLabel === 'Critical'
              ? '⚠ Reliability risk · elevated error rate · potential downtime'
              : statusLabel === 'Cost Waste'
                ? `↑ Cost waste · $${Math.round((r.costPerMonth ?? 0) * 0.4).toLocaleString()}/mo recoverable · downsize candidate`
                : null

            return (
              <div key={r.id}>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '2fr 90px 150px 150px 110px 110px 110px',
                    padding: '14px 28px',
                    background: rowBg,
                    borderBottom: `1px solid ${rowBorder}`,
                    alignItems: 'center',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = rowBg || '#F8FAFC' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = rowBg }}
                >
                  {/* Resource name + icon */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: typeConf.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Icon size={14} style={{ color: typeConf.color }} />
                    </div>
                    <div>
                      <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A', margin: '0 0 1px' }}>
                        {r.serviceName || r.serviceId?.slice(0, 8) || 'Unknown'}
                      </p>
                      {issueLabel
                        ? <p style={{ fontSize: '0.67rem', color: statusLabel === 'Critical' ? '#DC2626' : '#D97706', margin: 0, fontWeight: 700 }}>
                            {issueLabel}
                            {statusLabel === 'Critical' && (
                              <a
                                href={`/anomalies?resource=${r.awsId}`}
                                style={{ marginLeft: '8px', color: '#DC2626', fontWeight: 700, fontSize: '0.67rem', textDecoration: 'underline' }}
                              >
                                Investigate →
                              </a>
                            )}
                          </p>
                        : <p style={{ fontSize: '0.67rem', color: '#94A3B8', margin: 0 }}>
                            Added {new Date(r.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </p>
                      }
                    </div>
                  </div>

                  {/* Type badge */}
                  <span style={{ fontSize: '0.72rem', fontWeight: 700, padding: '3px 8px', borderRadius: '4px', background: typeConf.bg, color: typeConf.color, width: 'fit-content' }}>
                    {(r.resourceType as string)?.toUpperCase() ?? '—'}
                  </span>

                  {/* AWS ID */}
                  <span style={{ fontSize: '0.75rem', color: '#64748B', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                    {r.awsId || '—'}
                  </span>

                  {/* Service */}
                  <span style={{ fontSize: '0.82rem', color: '#475569' }}>
                    {r.serviceName || '—'}
                  </span>

                  {/* Region */}
                  <span style={{ fontSize: '0.78rem', color: '#475569', fontFamily: 'monospace' }}>
                    {r.awsRegion || '—'}
                  </span>

                  {/* Monthly Cost */}
                  <span style={{ fontSize: '0.875rem', fontWeight: 700, color: '#0F172A' }}>
                    ${(r.costPerMonth ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) ?? '0.00'}
                  </span>

                  {/* Issue badge */}
                  <span style={{ fontSize: '0.72rem', fontWeight: 700, padding: '3px 8px', borderRadius: '100px', background: statusBg, color: statusColor, width: 'fit-content' }}>
                    {statusLabel}
                  </span>
                </div>
              </div>
            )
          })
        )}
        {tableResources.length > 8 && (
          <div style={{ padding: '14px 28px', borderTop: '1px solid #F1F5F9', textAlign: 'center' }}>
            <button
              onClick={() => setShowAllResources(prev => !prev)}
              style={{
                background: 'transparent',
                color: '#7C3AED',
                border: '1px solid #DDD6FE',
                borderRadius: '7px',
                padding: '8px 24px',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer',
                fontFamily: 'inherit',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              {showAllResources
                ? <>Show less ↑</>
                : <>{tableResources.length - 8} more resources ↓</>
              }
            </button>
          </div>
        )}
      </div>

    </div>
  )
}
