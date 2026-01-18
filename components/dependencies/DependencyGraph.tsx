'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  Node,
  Edge,
  useNodesState,
  useEdgesState,
  MarkerType,
  Panel,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { Loader2, AlertCircle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { dependenciesService } from '@/lib/services/dependencies.service'

// Simple layout algorithm (dagre requires complex setup, using grid for now)
const getLayoutedElements = (nodes: Node[], edges: Edge[]) => {
  const columns = 5
  const nodeWidth = 180
  const nodeHeight = 80
  const gap = 100

  const layoutedNodes = nodes.map((node, index) => ({
    ...node,
    position: {
      x: (index % columns) * (nodeWidth + gap),
      y: Math.floor(index / columns) * (nodeHeight + gap),
    },
  }))

  return { nodes: layoutedNodes, edges }
}

interface DependencyGraphProps {
  onRefresh: () => void
  graphRef?: React.RefObject<HTMLDivElement>
}

export function DependencyGraph({ onRefresh, graphRef }: DependencyGraphProps) {
  const internalRef = useRef<HTMLDivElement>(null)
  const activeRef = graphRef || internalRef
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])

  // Fetch graph data
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['dependencies', 'graph'],
    queryFn: () => dependenciesService.getGraph(),
  })

  // Update nodes and edges when data changes
  useEffect(() => {
    if (data) {
      // Transform edges with styling
      const transformedEdges = data.edges.map((edge) => ({
        ...edge,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: edge.data?.isCritical ? '#ef4444' : '#6b7280',
        },
        style: {
          stroke: edge.data?.isCritical ? '#ef4444' : '#6b7280',
          strokeWidth: edge.data?.isCritical ? 3 : 2,
        },
        labelStyle: {
          fontSize: 10,
          fontWeight: edge.data?.isCritical ? 'bold' : 'normal',
        },
      }))

      // Apply layout
      const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
        data.nodes,
        transformedEdges
      )

      setNodes(layoutedNodes)
      setEdges(layoutedEdges)
    }
  }, [data, setNodes, setEdges])

  const handleRefresh = () => {
    refetch()
    onRefresh()
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[600px] border rounded-lg">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-[600px] border rounded-lg space-y-4">
        <AlertCircle className="h-8 w-8 text-red-600" />
        <div className="text-center">
          <h3 className="font-semibold">Error Loading Graph</h3>
          <p className="text-sm text-muted-foreground">{(error as Error).message}</p>
        </div>
        <Button onClick={handleRefresh} variant="outline">
          <RefreshCw className="h-4 w-4 mr-2" />
          Retry
        </Button>
      </div>
    )
  }

  if (!nodes.length) {
    return (
      <div className="flex flex-col items-center justify-center h-[600px] border rounded-lg space-y-4">
        <Network className="h-12 w-12 text-muted-foreground" />
        <div className="text-center">
          <h3 className="font-semibold">No Dependencies Yet</h3>
          <p className="text-sm text-muted-foreground">
            Add your first dependency to see the graph visualization
          </p>
        </div>
      </div>
    )
  }

  return (
    <div ref={activeRef} className="h-[600px] border rounded-lg bg-gray-50">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        fitView
        attributionPosition="bottom-left"
      >
        <Background />
        <Controls />
        <MiniMap />
        <Panel position="top-right" className="bg-white p-4 rounded-lg shadow-md space-y-2">
          <div className="text-sm font-semibold">Legend</div>
          <div className="flex items-center gap-2 text-xs">
            <div className="w-8 h-0.5 bg-gray-500" />
            <span>Standard</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <div className="w-8 h-1 bg-red-500" />
            <span>Critical Path</span>
          </div>
          <Button size="sm" onClick={handleRefresh} className="w-full mt-2">
            <RefreshCw className="h-3 w-3 mr-1" />
            Refresh
          </Button>
        </Panel>
      </ReactFlow>
    </div>
  )
}

function Network(props: any) {
  return <svg {...props} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="2"/><path d="M12 2v3m0 14v3m10-10h-3M5 12H2m15.071-7.071l-2.121 2.121m-5.9 5.9l-2.121 2.121m12.021 0l-2.121-2.121m-5.9-5.9l-2.121-2.121"/></svg>
}
