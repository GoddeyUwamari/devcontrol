'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import { DialogTitle } from '@/components/ui/dialog'
import { Layers, Rocket, Server, Users, Activity, Plus, LayoutDashboard, Sparkles, X, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import { servicesService } from '@/lib/services/services.service'
import { deploymentsService } from '@/lib/services/deployments.service'
import { infrastructureService } from '@/lib/services/infrastructure.service'
import { nlQueryService, NLQueryResult } from '@/lib/services/nl-query.service'

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [searchValue, setSearchValue] = useState('')
  const [isNLQuery, setIsNLQuery] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const isProcessingRef = useRef(false)
  const nlResultRef = useRef<NLQueryResult | null>(null)
  const forceOpenRef = useRef(false)
  const [nlResult, setNlResult] = useState<NLQueryResult | null>(null)
  const router = useRouter()

  // Fetch data for search
  const { data: services = [] } = useQuery({
    queryKey: ['services'],
    queryFn: () => servicesService.getAll(),
    enabled: open,
  })

  const { data: deployments = [] } = useQuery({
    queryKey: ['deployments'],
    queryFn: () => deploymentsService.getAll(),
    enabled: open,
  })

  const { data: infrastructure = [] } = useQuery({
    queryKey: ['infrastructure'],
    queryFn: () => infrastructureService.getAll(),
    enabled: open,
  })

  // Detect if query looks like natural language
  useEffect(() => {
    setNlResult(null)
    if (searchValue.length < 3) {
      setIsNLQuery(false)
      return
    }

    const words = searchValue.split(' ').filter(w => w.length > 0)
    const hasQuestionWords = /\b(show|find|get|list|all|where|which|what)\b/i.test(searchValue)

    setIsNLQuery(words.length >= 2 || hasQuestionWords)
  }, [searchValue])

  // Handle NL query processing
  const handleNLQuery = useCallback(async () => {
    console.log('[NL] handleNLQuery fired — isNLQuery:', isNLQuery, 'isProcessing:', isProcessingRef.current, 'query:', searchValue)
    if (!isNLQuery || isProcessingRef.current) return
    isProcessingRef.current = true
    forceOpenRef.current = true
    setIsProcessing(true)
    setNlResult(null)
    try {
      const result = await nlQueryService.executeQuery(searchValue)
      nlResultRef.current = result
      setNlResult(result)
      // Keep dialog open long enough for React to render results
      await new Promise(r => setTimeout(r, 100))
      forceOpenRef.current = false
    } catch (error) {
      console.error('NL Query failed:', error)
      toast.error('Could not process query', {
        description: 'Try: "show expensive EC2" or "critical alerts today"',
      })
    } finally {
      isProcessingRef.current = false
      setIsProcessing(false)
    }
  }, [isNLQuery, searchValue])

  // Keyboard shortcut to open/close
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((open) => !open)
      }
      if (e.key === 'Enter') {
        console.log('[NL] Enter pressed — open:', open, 'isNLQuery:', isNLQuery, 'isProcessing:', isProcessingRef.current)
      }
      if (e.key === 'Enter' && open && isNLQuery && !isProcessingRef.current) {
        e.preventDefault()
        e.stopPropagation()
        handleNLQuery()
      }
    }
    document.addEventListener('keydown', down, true) // capture phase — fires before cmdk
    return () => document.removeEventListener('keydown', down, true)
  }, [open, isNLQuery, handleNLQuery])

  const runCommand = useCallback((command: () => void) => {
    setOpen(false)
    setSearchValue('')
    command()
  }, [])

  return (
    <CommandDialog
      open={open}
      onOpenChange={(value) => {
        if (!value && (forceOpenRef.current || isProcessingRef.current || nlResultRef.current)) return
        setOpen(value)
        if (!value) {
          setSearchValue('')
          setNlResult(null)
          nlResultRef.current = null
          forceOpenRef.current = false
        }
      }}
    >
      <DialogTitle className="sr-only">Command Palette</DialogTitle>
      <div className="relative">
        <CommandInput
          placeholder="Search services, deployments, infrastructure..."
          value={searchValue}
          onValueChange={setSearchValue}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && isNLQuery) {
              e.preventDefault()
              e.stopPropagation()
            }
          }}
        />
        {isNLQuery && (
          <div className="absolute right-3 top-3 flex items-center gap-2 text-xs text-purple-600 dark:text-purple-400">
            <Sparkles className="h-4 w-4 animate-pulse" />
            <span>AI Search</span>
          </div>
        )}
      </div>
      <CommandList>
        <CommandEmpty>
          {isNLQuery ? (
            <div className="text-center py-6">
              <Sparkles className="h-8 w-8 mx-auto mb-2 text-purple-600" />
              {isProcessing ? (
                <p className="text-sm font-medium text-purple-600">Analyzing your infrastructure...</p>
              ) : (
                <>
                  <p className="text-sm font-medium">Press Enter to search with AI</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Try: "show expensive EC2" · "critical alerts today" · "failed deployments"
                  </p>
                </>
              )}
            </div>
          ) : (
            'No results found.'
          )}
        </CommandEmpty>

        {!isNLQuery && (
          <>
            {/* Quick Actions */}
            <CommandGroup heading="Actions">
              <CommandItem
                onSelect={() => runCommand(() => router.push('/services'))}
              >
                <Plus className="mr-2 h-4 w-4" />
                Create Service
              </CommandItem>
              <CommandItem
                onSelect={() => runCommand(() => router.push('/deployments'))}
              >
                <Rocket className="mr-2 h-4 w-4" />
                Record Deployment
              </CommandItem>
              <CommandItem
                onSelect={() => runCommand(() => router.push('/infrastructure'))}
              >
                <Server className="mr-2 h-4 w-4" />
                Add Infrastructure
              </CommandItem>
            </CommandGroup>

            <CommandSeparator />

            {/* Navigation */}
            <CommandGroup heading="Navigation">
              <CommandItem
                onSelect={() => runCommand(() => router.push('/dashboard'))}
              >
                <LayoutDashboard className="mr-2 h-4 w-4" />
                Dashboard
              </CommandItem>
              <CommandItem
                onSelect={() => runCommand(() => router.push('/services'))}
              >
                <Layers className="mr-2 h-4 w-4" />
                Services
              </CommandItem>
              <CommandItem
                onSelect={() => runCommand(() => router.push('/deployments'))}
              >
                <Rocket className="mr-2 h-4 w-4" />
                Deployments
              </CommandItem>
              <CommandItem
                onSelect={() => runCommand(() => router.push('/infrastructure'))}
              >
                <Server className="mr-2 h-4 w-4" />
                Infrastructure
              </CommandItem>
              <CommandItem
                onSelect={() => runCommand(() => router.push('/teams'))}
              >
                <Users className="mr-2 h-4 w-4" />
                Teams
              </CommandItem>
              <CommandItem
                onSelect={() => runCommand(() => router.push('/admin/monitoring'))}
              >
                <Activity className="mr-2 h-4 w-4" />
                Monitoring
              </CommandItem>
            </CommandGroup>

            {/* Services */}
            {services.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup heading="Services">
                  {services.slice(0, 5).map((service) => (
                    <CommandItem
                      key={service.id}
                      onSelect={() => runCommand(() => router.push(`/services`))}
                    >
                      <Layers className="mr-2 h-4 w-4" />
                      <div className="flex flex-col">
                        <span>{service.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {service.template} · {service.status}
                        </span>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}

            {/* Recent Deployments */}
            {deployments.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup heading="Recent Deployments">
                  {deployments.slice(0, 3).map((deployment) => (
                    <CommandItem
                      key={deployment.id}
                      onSelect={() => runCommand(() => router.push('/deployments'))}
                    >
                      <Rocket className="mr-2 h-4 w-4" />
                      <div className="flex flex-col">
                        <span>{deployment.serviceName || deployment.serviceId?.substring(0, 8) || 'Unknown'}</span>
                        <span className="text-xs text-muted-foreground">
                          {deployment.environment} · {deployment.status}
                        </span>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}

            {/* Infrastructure */}
            {infrastructure.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup heading="Infrastructure">
                  {infrastructure.slice(0, 3).map((resource) => (
                    <CommandItem
                      key={resource.id}
                      onSelect={() => runCommand(() => router.push('/infrastructure'))}
                    >
                      <Server className="mr-2 h-4 w-4" />
                      <div className="flex flex-col">
                        <span>{resource.serviceName || resource.serviceId?.substring(0, 8) || 'Unknown'}</span>
                        <span className="text-xs text-muted-foreground">
                          {resource.resourceType} · {resource.awsRegion}
                        </span>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </>
        )}
        {/* AI Query Results */}
        {nlResult && (
          <>
            <CommandSeparator />
            <CommandGroup heading={
              <div className="flex items-center justify-between w-full pr-2">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-3 w-3 text-purple-600" />
                  <span>AI Results</span>
                  <span className="text-xs text-muted-foreground font-normal">
                    {nlResult.rowCount} result{nlResult.rowCount !== 1 ? 's' : ''} · {nlResult.executionMs}ms
                  </span>
                </div>
                <button
                  onClick={() => setNlResult(null)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            }>
              {/* Summary */}
              <div className="px-2 py-2 text-xs text-muted-foreground border-b border-border mb-1">
                {nlResult.data.summary}
              </div>

              {/* Result rows */}
              {nlResult.data.rows.length === 0 ? (
                <div className="px-2 py-3 text-xs text-center text-muted-foreground flex items-center justify-center gap-2">
                  <AlertCircle className="h-3 w-3" />
                  No data matched. Try rephrasing or check your AWS connection.
                </div>
              ) : (
                nlResult.data.rows.slice(0, 8).map((row, idx) => {
                  const values = Object.values(row).slice(0, 3)
                  const label = String(values[0] ?? '—')
                  const sub1  = String(values[1] ?? '')
                  const sub2  = String(values[2] ?? '')
                  return (
                    <CommandItem
                      key={idx}
                      onSelect={() => {
                        setOpen(false)
                        setSearchValue('')
                        setNlResult(null)
                        router.push(`/${nlResult.intent.target}`)
                      }}
                    >
                      <div className="flex flex-col min-w-0">
                        <span className="font-medium truncate">{label}</span>
                        <span className="text-xs text-muted-foreground truncate">
                          {[sub1, sub2].filter(Boolean).join(' · ')}
                        </span>
                      </div>
                    </CommandItem>
                  )
                })
              )}

              {nlResult.rowCount > 8 && (
                <CommandItem
                  onSelect={() => {
                    setOpen(false)
                    setSearchValue('')
                    setNlResult(null)
                    router.push(`/${nlResult.intent.target}`)
                  }}
                >
                  <span className="text-xs text-purple-600 font-medium">
                    View all {nlResult.rowCount} results →
                  </span>
                </CommandItem>
              )}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  )
}
