'use client'

import React, { useEffect, useRef } from 'react'
import { ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, Node, Edge, useNodesState, useEdgesState, MarkerType, Panel } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Loader2, AlertCircle, RefreshCw, Network } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useDependencyGraph } from '@/lib/hooks/use-dependencies'

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
  organizationId: string | null
  onNodeClick?: (node: Node) => void
  onEdgeClick?: (edge: Edge) => void
}

export function DependencyGraph(props: DependencyGraphProps) {
  return (
    <ReactFlowProvider>
      <DependencyGraphInner {...props} />
    </ReactFlowProvider>
  )
}

function DependencyGraphInner({ organizationId, onNodeClick, onEdgeClick }: DependencyGraphProps) {
  const graphRef = useRef<HTMLDivElement>(null)
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])

  const { data: graphData, isPending, isError, error, refetch } = useDependencyGraph(organizationId)

  // Update nodes and edges when data changes
  useEffect(() => {
    if (graphData) {
      const transformedEdges = graphData.edges.map((edge) => ({
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

      const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
        graphData.nodes as Node[],
        transformedEdges as Edge[]
      )

      setNodes(layoutedNodes)
      setEdges(layoutedEdges)
    }
  }, [graphData, setNodes, setEdges])

  if (isError) {
    return (
      <div role="alert" className="flex flex-col items-center justify-center h-[400px] border rounded-lg space-y-4">
        <AlertCircle className="h-8 w-8 text-red-600" aria-hidden="true" />
        <div className="text-center">
          <h3 className="font-semibold">Error Loading Graph</h3>
          <p className="text-sm text-muted-foreground">{(error as Error).message}</p>
        </div>
        <Button onClick={() => refetch()} variant="outline">
          <RefreshCw className="h-4 w-4 mr-2" />
          Retry
        </Button>
      </div>
    )
  }

  if (isPending) {
    return (
      <div className="flex items-center justify-center h-[400px] border rounded-lg" aria-label="Loading dependency graph">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden="true" />
      </div>
    )
  }

  if (graphData.edges.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-[400px] border rounded-lg space-y-4">
        <Network className="h-12 w-12 text-muted-foreground" aria-hidden="true" />
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
    <div ref={graphRef} className="w-full h-[400px] sm:h-[600px] border rounded-lg bg-gray-50 overflow-hidden">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={true}
        zoomOnScroll={false}
        zoomOnPinch={true}
        panOnScroll={false}
        onNodeClick={(event, node) => onNodeClick?.(node)}
        onEdgeClick={(event, edge) => onEdgeClick?.(edge)}
        fitView
        attributionPosition="bottom-left"
      >
        <Background />
        <Controls />
        <MiniMap
          nodeColor="#64748B"
          maskColor="rgba(241,245,249,0.7)"
          style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '8px' }}
          pannable
          zoomable
        />
        <Panel position="top-right" className="bg-white p-4 rounded-lg shadow-md space-y-2">
          <div className="text-sm font-semibold">Legend</div>
          <div className="flex items-center gap-2 text-xs">
            <div className="w-8 h-0.5 bg-gray-500" />
            <span>Standard</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <div className="w-8 h-1 bg-red-500" />
            <span>Critical</span>
          </div>
          <Button size="sm" onClick={() => refetch()} className="w-full mt-2">
            <RefreshCw className="h-3 w-3 mr-1" />
            Refresh
          </Button>
        </Panel>
      </ReactFlow>
    </div>
  )
}
