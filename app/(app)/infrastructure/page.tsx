'use client'

import { Suspense, useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
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

type ResourceFilter = 'all' | ResourceType

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

// FIX 1: All 15 resource type filter chips
const RESOURCE_TYPE_FILTERS: { value: ResourceFilter; label: string }[] = [
  { value: 'all',          label: 'All Types'    },
  { value: 'ec2',          label: 'EC2'          },
  { value: 'ecs',          label: 'ECS'          },
  { value: 'lambda',       label: 'Lambda'       },
  { value: 'rds',          label: 'RDS'          },
  { value: 's3',           label: 'S3'           },
  { value: 'eks',          label: 'EKS'          },
  { value: 'dynamodb',     label: 'DynamoDB'     },
  { value: 'cloudfront',   label: 'CloudFront'   },
  { value: 'api-gateway',  label: 'API Gateway'  },
  { value: 'elasticache',  label: 'ElastiCache'  },
  { value: 'aurora',       label: 'Aurora'       },
  { value: 'sqs',          label: 'SQS'          },
  { value: 'sns',          label: 'SNS'          },
  { value: 'elb',          label: 'Load Balancer'},
  { value: 'vpc',          label: 'VPC'          },
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

export default function InfrastructurePage() {
  return (
    <Suspense fallback={<div style={{ padding: '48px', textAlign: 'center', color: '#6b7280' }}>Loading...</div>}>
      <InfrastructureContent />
    </Suspense>
  )
}

function InfrastructureContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()

  // Initialize from URL params
  const [resourceFilter, setResourceFilter] = useState<ResourceFilter>(
    (searchParams.get('resourceType') as ResourceFilter) || 'all'
  )

  // Sync URL params → state
  useEffect(() => {
    const urlType = searchParams.get('resourceType') as ResourceFilter
    if (urlType && urlType !== resourceFilter) {
      setResourceFilter(urlType)
    }
  }, [searchParams])

  // Update URL when filter changes
  const handleFilterChange = (filter: ResourceFilter) => {
    setResourceFilter(filter)
    const params = new URLSearchParams(searchParams.toString())
    if (filter === 'all') {
      params.delete('resourceType')
    } else {
      params.set('resourceType', filter)
    }
    const queryString = params.toString()
    router.push(`/infrastructure${queryString ? `?${queryString}` : ''}`)
  }

  // FIX 1: Pass ?type= filter to the API call
  const { data: resources = [], isLoading, refetch } = useQuery({
    queryKey: ['infrastructure', resourceFilter],
    queryFn: async () => {
      const allResources = await infrastructureService.getAll(
        resourceFilter !== 'all' ? { resourceType: resourceFilter } : undefined
      )
      return allResources.filter(r => (r.resourceType as string) !== 'AWS_COST_TOTAL')
    },
  })

  // All resources (unfiltered) — used for monthly cost in real mode
  const { data: allResources = [] } = useQuery({
    queryKey: ['infrastructure-all'],
    queryFn: async () => {
      const all = await infrastructureService.getAll()
      return all.filter(r => (r.resourceType as string) !== 'AWS_COST_TOTAL')
    },
  })

  const { data: recommendationsCount = 0 } = useQuery({
    queryKey: ['cost-recommendations-count'],
    queryFn: costRecommendationsService.getActiveCount,
  })

  const demoMode = useDemoMode()
  const salesDemoMode = useSalesDemo((state) => state.enabled)
  const isDemoActive = demoMode || salesDemoMode
  const [isSyncing, setIsSyncing] = useState(false)
  const [syncComplete, setSyncComplete] = useState(false)

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
        refetch(),
        queryClient.invalidateQueries({ queryKey: ['infrastructure-all'] }),
        queryClient.invalidateQueries({ queryKey: ['services-stats'] }),
        queryClient.invalidateQueries({ queryKey: ['cost-recommendations-count'] }),
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
    if (resourceFilter === 'all') return true
    return r.resourceType === resourceFilter
  })

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

  const displayRecommendationsCount = isDemoActive ? 3 : recommendationsCount

  // Values shown in the AI insight banner still use displayResources for region counts
  const regionCount = new Set(displayResources.map((r: InfrastructureResource) => r.awsRegion)).size

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
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: '#0F172A', margin: '0 0 6px', letterSpacing: '-0.02em' }}>
            Infrastructure
          </h1>
          <p style={{ fontSize: '0.875rem', color: '#475569', margin: 0, lineHeight: 1.6 }}>
            All AWS resources across your infrastructure · Real-time cost tracking
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
                : <><RefreshCw size={15} /> Sync AWS</>
            }
          </button>
          <a href="/infrastructure/new" style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#7C3AED', color: '#fff', padding: '10px 20px', borderRadius: '8px', fontSize: '0.875rem', fontWeight: 600, textDecoration: 'none' }}>
            <Plus size={15} /> Add Resource
          </a>
        </div>
      </div>

      {/* AI INSIGHT BANNER */}
      <div style={{ background: '#fff', borderRadius: '12px', padding: '16px 24px', border: '1px solid #F1F5F9', marginBottom: '24px', display: 'flex', alignItems: 'flex-start', gap: '14px' }}>
        <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: '#7C3AED', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Sparkles size={14} style={{ color: '#fff' }} />
        </div>
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#7C3AED', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 4px' }}>AI Insight</p>
          <p style={{ fontSize: '0.875rem', color: '#1E293B', margin: 0, lineHeight: 1.6 }}>
            {isDemoActive
              ? `${demoTotal} AWS resources tracked across ${regionCount} regions. Total infrastructure cost is $${Math.round(demoMonthlyCost).toLocaleString()}/mo. RDS payments instance is showing elevated connection wait times — review query performance and connection pool settings. ${displayRecommendationsCount} optimization opportunities identified.`
              : totalResources === 0
                ? 'No resources found. Click "Sync AWS" to automatically discover all EC2, Lambda, RDS, and S3 resources from your connected AWS account.'
                : `${totalResources ?? '—'} resources tracked with $${Math.round(totalMonthlyCost).toLocaleString()}/mo total cost. ${(warningCount ?? 0) > 0 ? `${warningCount} resource${warningCount !== 1 ? 's' : ''} need attention.` : 'All resources healthy.'} ${displayRecommendationsCount > 0 ? `${displayRecommendationsCount} optimization recommendations available.` : ''}`
            }
          </p>
        </div>
        {displayRecommendationsCount > 0 && (
          <a href="/infrastructure/recommendations" style={{ fontSize: '0.78rem', fontWeight: 600, color: '#7C3AED', textDecoration: 'none', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}>
            View recommendations <ArrowRight size={12} />
          </a>
        )}
      </div>

      {/* 4 KPI CARDS — FIX 3 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px', marginBottom: '28px' }}>
        {[
          { label: 'Total Resources', value: statsLoading && !isDemoActive ? '—' : (totalResources ?? '—'),                                        sub: 'Across all regions',     valueColor: '#0F172A' },
          { label: 'Monthly Cost',    value: `$${Math.round(totalMonthlyCost).toLocaleString()}`,                                                  sub: 'All resources combined', valueColor: '#0F172A' },
          { label: 'Active',          value: statsLoading && !isDemoActive ? '—' : (activeCount ?? '—'),                                           sub: 'Running normally',       valueColor: '#059669' },
          { label: 'Needs Attention', value: statsLoading && !isDemoActive ? '—' : (warningCount ?? '—'),                                          sub: 'Warning or stopped',     valueColor: (warningCount !== null && (warningCount as number) > 0) ? '#D97706' : '#059669' },
        ].map(({ label, value, sub, valueColor }) => (
          <div key={label} style={{ background: '#fff', borderRadius: '14px', padding: '32px', border: '1px solid #E2E8F0' }}>
            <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 16px' }}>{label}</p>
            <div style={{ fontSize: '2.5rem', fontWeight: 700, color: valueColor, letterSpacing: '-0.03em', lineHeight: 1, marginBottom: '8px' }}>{value}</div>
            <p style={{ fontSize: '0.78rem', color: '#475569', margin: 0, lineHeight: 1.6 }}>{sub}</p>
          </div>
        ))}
      </div>

      {/* RESOURCE TABLE */}
      <div style={{ background: '#fff', borderRadius: '16px', border: '1px solid #F1F5F9', overflow: 'hidden' }}>

        {/* Table header + filter pills — FIX 1 */}
        <div style={{ padding: '20px 28px', borderBottom: '1px solid #F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 2px' }}>All Resources</p>
            <p style={{ fontSize: '0.78rem', color: '#94A3B8', margin: 0 }}>{filteredResources.length} of {totalResources ?? '—'} resources</p>
          </div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {RESOURCE_TYPE_FILTERS.map(({ value, label }) => (
              <button
                key={value}
                onClick={() => handleFilterChange(value)}
                style={{
                  padding: '4px 12px', borderRadius: '100px', fontSize: '0.75rem', fontWeight: 600,
                  border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                  background: resourceFilter === value ? '#7C3AED' : '#F1F5F9',
                  color: resourceFilter === value ? '#fff' : '#475569',
                }}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Column headers */}
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 100px 160px 160px 120px 110px 90px', padding: '10px 28px', background: '#F8FAFC', borderBottom: '1px solid #F1F5F9' }}>
          {['Resource', 'Type', 'AWS ID', 'Service', 'Region', 'Monthly Cost', 'Status'].map(col => (
            <span key={col} style={{ fontSize: '0.7rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{col}</span>
          ))}
        </div>

        {/* Rows */}
        {isLoading && !isDemoActive ? (
          <div style={{ padding: '48px', textAlign: 'center' }}>
            <RefreshCw size={20} style={{ color: '#94A3B8', margin: '0 auto 12px' }} />
            <p style={{ fontSize: '0.875rem', color: '#64748B', margin: 0 }}>Loading resources...</p>
          </div>
        ) : filteredResources.length === 0 ? (
          <div style={{ padding: '64px', textAlign: 'center' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: '#F8FAFC', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
              <Server size={22} style={{ color: '#94A3B8' }} />
            </div>
            <p style={{ fontSize: '1rem', fontWeight: 600, color: '#0F172A', margin: '0 0 6px' }}>No resources found</p>
            <p style={{ fontSize: '0.875rem', color: '#475569', margin: '0 0 24px', lineHeight: 1.6 }}>
              Sync your AWS account to automatically discover all infrastructure resources.
            </p>
            <button
              onClick={handleSyncAWS}
              style={{ background: '#7C3AED', color: '#fff', padding: '10px 24px', borderRadius: '8px', fontSize: '0.875rem', fontWeight: 600, border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
              <RefreshCw size={14} /> Sync AWS Now
            </button>
          </div>
        ) : (
          filteredResources.map((r: InfrastructureResource, idx: number) => {
            const typeConf = resourceTypeConfig[r.resourceType as string] || resourceTypeConfig.default
            const Icon = typeConf.icon
            const statusColor = r.status === 'running' ? '#059669' : r.status === 'pending' ? '#D97706' : r.status === 'stopped' ? '#64748B' : '#DC2626'
            const statusBg    = r.status === 'running' ? '#F0FDF4' : r.status === 'pending' ? '#FFFBEB' : r.status === 'stopped' ? '#F8FAFC' : '#FEF2F2'
            const statusLabel = r.status === 'running' ? 'Running' : r.status === 'pending' ? 'Warning' : r.status === 'stopped' ? 'Stopped' : 'Terminated'

            return (
              <div key={r.id}>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '2fr 100px 160px 160px 120px 110px 90px',
                    padding: '14px 28px',
                    borderBottom: idx < filteredResources.length - 1 ? '1px solid #F8FAFC' : 'none',
                    alignItems: 'center',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = '#F8FAFC' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
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
                      <p style={{ fontSize: '0.72rem', color: '#94A3B8', margin: 0 }}>
                        Added {new Date(r.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </p>
                    </div>
                  </div>

                  {/* Type badge */}
                  <span style={{ fontSize: '0.72rem', fontWeight: 700, padding: '3px 8px', borderRadius: '4px', background: typeConf.bg, color: typeConf.color, width: 'fit-content' }}>
                    {(r.resourceType as string).toUpperCase()}
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
                    ${r.costPerMonth?.toFixed(2) ?? '0.00'}
                  </span>

                  {/* Status badge */}
                  <span style={{ fontSize: '0.72rem', fontWeight: 700, padding: '3px 8px', borderRadius: '100px', background: statusBg, color: statusColor, width: 'fit-content' }}>
                    {statusLabel}
                  </span>
                </div>

                {/* Fix-It banner for pending status */}
                {r.status === 'pending' && (
                  <div style={{ margin: '0 28px 8px', padding: '10px 14px', background: '#FFFBEB', borderRadius: '8px', border: '1px solid #FDE68A', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <AlertTriangle size={13} style={{ color: '#D97706' }} />
                      <span style={{ fontSize: '0.78rem', color: '#92400E', fontWeight: 500 }}>
                        {isDemoActive
                          ? 'RDS instance showing elevated connection wait times. Consider scaling up or reviewing query performance.'
                          : `${(r.resourceType as string).toUpperCase()} resource requires attention. Review CloudWatch metrics for details.`
                        }
                      </span>
                    </div>
                    <a
                      href={`/anomalies?resource=${r.awsId}`}
                      style={{ fontSize: '0.72rem', fontWeight: 700, color: '#D97706', textDecoration: 'none', background: '#fff', border: '1px solid #FDE68A', padding: '3px 10px', borderRadius: '6px', flexShrink: 0 }}>
                      Investigate →
                    </a>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

    </div>
  )
}
