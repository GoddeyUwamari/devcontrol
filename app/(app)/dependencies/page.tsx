'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Network, List, Activity, AlertTriangle, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Breadcrumb } from '@/components/navigation/breadcrumb'
import { dependenciesService } from '@/lib/services/dependencies.service'
import dynamic from 'next/dynamic'

// Dynamically import React Flow component to avoid SSR issues
const DependencyGraph = dynamic(
  () => import('@/components/dependencies/DependencyGraph').then(mod => mod.DependencyGraph),
  { ssr: false }
)

const DependencyList = dynamic(
  () => import('@/components/dependencies/DependencyList').then(mod => mod.DependencyList),
  { ssr: false }
)

const ImpactAnalysisView = dynamic(
  () => import('@/components/dependencies/ImpactAnalysisView').then(mod => mod.ImpactAnalysisView),
  { ssr: false }
)

const AddDependencyDialog = dynamic(
  () => import('@/components/dependencies/AddDependencyDialog').then(mod => mod.AddDependencyDialog),
  { ssr: false }
)

export default function DependenciesPage() {
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
  const [activeTab, setActiveTab] = useState('graph')

  // Fetch all dependencies
  const {
    data: dependencies = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['dependencies'],
    queryFn: () => dependenciesService.getAll(),
  })

  // Fetch circular dependencies
  const {
    data: cycles = [],
    refetch: refetchCycles,
  } = useQuery({
    queryKey: ['dependencies', 'cycles'],
    queryFn: () => dependenciesService.detectCircularDependencies(),
  })

  // Calculate stats
  const stats = {
    total: dependencies.length,
    critical: dependencies.filter(d => d.isCritical).length,
    byType: {
      runtime: dependencies.filter(d => d.dependencyType === 'runtime').length,
      data: dependencies.filter(d => d.dependencyType === 'data').length,
      deployment: dependencies.filter(d => d.dependencyType === 'deployment').length,
      'shared-lib': dependencies.filter(d => d.dependencyType === 'shared-lib').length,
    },
  }

  return (
    <div className="space-y-6 p-6">
      {/* Breadcrumb */}
      <Breadcrumb
        items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Dependencies', current: true },
        ]}
      />

      {/* Header */}
      <div>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Service Dependencies</h1>
            <p className="text-muted-foreground mt-1">
              Visualize and manage service dependency relationships
            </p>
          </div>
          <Button onClick={() => setIsAddDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Dependency
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <StatCard
          label="Total Dependencies"
          value={stats.total}
          icon={Network}
        />
        <StatCard
          label="Critical Path"
          value={stats.critical}
          icon={AlertTriangle}
          variant={stats.critical > 0 ? 'warning' : 'default'}
        />
        <StatCard
          label="Runtime Dependencies"
          value={stats.byType.runtime}
          icon={Activity}
        />
        <StatCard
          label="Circular Cycles"
          value={cycles.length}
          icon={AlertTriangle}
          variant={cycles.length > 0 ? 'destructive' : 'default'}
        />
      </div>

      {/* Circular Dependency Alert */}
      {cycles.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <strong>Warning:</strong> {cycles.length} circular dependency cycle{cycles.length > 1 ? 's' : ''} detected.
            This can cause deployment issues and runtime failures.
            {' '}
            <button
              onClick={() => setActiveTab('list')}
              className="underline font-semibold"
            >
              View details
            </button>
          </AlertDescription>
        </Alert>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="graph">
            <Network className="h-4 w-4 mr-2" />
            Graph View
          </TabsTrigger>
          <TabsTrigger value="list">
            <List className="h-4 w-4 mr-2" />
            List View
          </TabsTrigger>
          <TabsTrigger value="impact">
            <Activity className="h-4 w-4 mr-2" />
            Impact Analysis
          </TabsTrigger>
        </TabsList>

        <TabsContent value="graph" className="space-y-4">
          <DependencyGraph onRefresh={refetch} />
        </TabsContent>

        <TabsContent value="list" className="space-y-4">
          <DependencyList
            dependencies={dependencies}
            cycles={cycles}
            isLoading={isLoading}
            onRefresh={refetch}
          />
        </TabsContent>

        <TabsContent value="impact" className="space-y-4">
          <ImpactAnalysisView />
        </TabsContent>
      </Tabs>

      {/* Add Dependency Dialog */}
      <AddDependencyDialog
        open={isAddDialogOpen}
        onClose={() => setIsAddDialogOpen(false)}
        onSuccess={() => {
          refetch()
          refetchCycles()
        }}
      />
    </div>
  )
}

// Stats Card Component
function StatCard({
  label,
  value,
  icon: Icon,
  variant = 'default',
}: {
  label: string
  value: number
  icon: any
  variant?: 'default' | 'warning' | 'destructive'
}) {
  const variantStyles = {
    default: 'border-border',
    warning: 'border-orange-200 bg-orange-50',
    destructive: 'border-red-200 bg-red-50',
  }

  return (
    <div className={`border rounded-lg p-4 ${variantStyles[variant]}`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <p className="text-2xl font-bold mt-1">{value}</p>
        </div>
        <Icon className="h-8 w-8 text-muted-foreground" />
      </div>
    </div>
  )
}
