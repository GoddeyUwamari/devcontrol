'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import {
  Command, CommandDialog, CommandEmpty, CommandGroup,
  CommandInput, CommandItem, CommandList, CommandSeparator,
} from '@/components/ui/command'
import { DialogTitle } from '@/components/ui/dialog'
import {
  Layers, Rocket, Server, Users, Activity, Plus,
  LayoutDashboard, Sparkles, X, AlertCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { servicesService } from '@/lib/services/services.service'
import { deploymentsService } from '@/lib/services/deployments.service'
import { infrastructureService } from '@/lib/services/infrastructure.service'
import { nlQueryService, NLQueryResult } from '@/lib/services/nl-query.service'

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [nlResult, setNlResult] = useState<NLQueryResult | null>(null)
  const router = useRouter()

  const isNL = search.trim().split(/\s+/).length >= 2 ||
    /\b(show|find|get|list|where|which|what)\b/i.test(search)

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

  // Open/close with ⌘K — standard bubbling phase, no capture
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen(prev => !prev)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  // Reset state when closed
  useEffect(() => {
    if (!open) {
      setSearch('')
      setNlResult(null)
      setIsProcessing(false)
    }
  }, [open])

  const runNLQuery = useCallback(async () => {
    if (!search.trim() || isProcessing) return
    setIsProcessing(true)
    setNlResult(null)
    try {
      const result = await nlQueryService.executeQuery(search)
      setNlResult(result)
    } catch {
      toast.error('Could not process query', {
        description: 'Try: "show expensive EC2" or "critical alerts today"',
      })
    } finally {
      setIsProcessing(false)
    }
  }, [search, isProcessing])

  const runCommand = useCallback((fn: () => void) => {
    setOpen(false)
    fn()
  }, [])

  // Handle Enter via onKeyDown on the CommandInput — no global listener needed
  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && isNL && !isProcessing) {
      e.preventDefault()
      e.stopPropagation()
      runNLQuery()
    }
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
    >
      <DialogTitle className="sr-only">Command Palette</DialogTitle>
      <div className="relative">
        <CommandInput
          placeholder="Search or ask anything..."
          value={search}
          onValueChange={(v) => { setSearch(v); setNlResult(null) }}
          onKeyDown={handleInputKeyDown}
        />
        {isNL && (
          <div className="absolute right-3 top-3 flex items-center gap-2
            text-xs text-purple-600 dark:text-purple-400">
            <Sparkles className="h-4 w-4 animate-pulse" />
            <span>AI Search</span>
          </div>
        )}
      </div>

      <CommandList>
        <CommandEmpty>
          {isNL ? (
            <div className="text-center py-6">
              <Sparkles className="h-8 w-8 mx-auto mb-2 text-purple-600" />
              {isProcessing ? (
                <p className="text-sm font-medium text-purple-600">
                  Analyzing your infrastructure...
                </p>
              ) : (
                <>
                  <p className="text-sm font-medium">
                    Press Enter to search with AI
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Try: "show expensive EC2" · "critical alerts today"
                  </p>
                </>
              )}
            </div>
          ) : (
            'No results found.'
          )}
        </CommandEmpty>

        {/* AI Results */}
        {nlResult && (
          <Command shouldFilter={false}>
            <CommandGroup heading={
              <div className="flex items-center justify-between w-full pr-2">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-3 w-3 text-purple-600" />
                  <span>AI Results</span>
                  <span className="text-xs text-muted-foreground font-normal">
                    {nlResult.rowCount} result{nlResult.rowCount !== 1 ? 's' : ''}
                    · {nlResult.executionMs}ms
                  </span>
                </div>
                <button onClick={() => setNlResult(null)}
                  className="text-muted-foreground hover:text-foreground">
                  <X className="h-3 w-3" />
                </button>
              </div>
            }>
              <div className="px-2 py-2 text-xs text-muted-foreground
                border-b border-border mb-1">
                {nlResult.data.summary}
              </div>
              {nlResult.data.rows.length === 0 ? (
                <div className="px-2 py-3 text-xs text-center
                  text-muted-foreground flex items-center justify-center gap-2">
                  <AlertCircle className="h-3 w-3" />
                  No data matched. Try rephrasing.
                </div>
              ) : (
                nlResult.data.rows.slice(0, 8).map((row, idx) => {
                  const label = String(
                    row.resource_name ?? row.name ?? row.service_name ??
                    row.alert_name ?? row.title ?? Object.values(row)[0] ?? '—'
                  )
                  const sub1 = String(
                    row.resource_type ?? row.type ?? row.service_type ??
                    row.severity ?? Object.values(row)[1] ?? ''
                  )
                  const sub2 = String(
                    row.monthly_cost
                      ? '$' + Number(row.monthly_cost).toLocaleString() + '/mo'
                      : row.region ?? row.status ?? row.environment ??
                        Object.values(row)[2] ?? ''
                  )
                  return (
                    <CommandItem key={idx} onSelect={() => {
                      setOpen(false)
                      router.push(`/${nlResult.intent.target}`)
                    }}>
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
                <CommandItem onSelect={() => {
                  setOpen(false)
                  router.push(`/${nlResult.intent.target}`)
                }}>
                  <span className="text-xs text-purple-600 font-medium">
                    View all {nlResult.rowCount} results →
                  </span>
                </CommandItem>
              )}
            </CommandGroup>
            <CommandSeparator />
          </Command>
        )}

        {/* Normal search results — only when no NL result showing */}
        {!nlResult && (
          <>
            <CommandGroup heading="Actions">
              <CommandItem onSelect={() =>
                runCommand(() => router.push('/services'))}>
                <Plus className="mr-2 h-4 w-4" />
                Create Service
              </CommandItem>
              <CommandItem onSelect={() =>
                runCommand(() => router.push('/deployments'))}>
                <Rocket className="mr-2 h-4 w-4" />
                Record Deployment
              </CommandItem>
              <CommandItem onSelect={() =>
                runCommand(() => router.push('/infrastructure'))}>
                <Server className="mr-2 h-4 w-4" />
                Add Infrastructure
              </CommandItem>
            </CommandGroup>

            <CommandSeparator />

            <CommandGroup heading="Navigate">
              <CommandItem onSelect={() =>
                runCommand(() => router.push('/dashboard'))}>
                <LayoutDashboard className="mr-2 h-4 w-4" />
                Dashboard
              </CommandItem>
              <CommandItem onSelect={() =>
                runCommand(() => router.push('/services'))}>
                <Layers className="mr-2 h-4 w-4" />
                Services
              </CommandItem>
              <CommandItem onSelect={() =>
                runCommand(() => router.push('/deployments'))}>
                <Rocket className="mr-2 h-4 w-4" />
                Deployments
              </CommandItem>
              <CommandItem onSelect={() =>
                runCommand(() => router.push('/infrastructure'))}>
                <Server className="mr-2 h-4 w-4" />
                Infrastructure
              </CommandItem>
              <CommandItem onSelect={() =>
                runCommand(() => router.push('/teams'))}>
                <Users className="mr-2 h-4 w-4" />
                Teams
              </CommandItem>
              <CommandItem onSelect={() =>
                runCommand(() => router.push('/admin/monitoring'))}>
                <Activity className="mr-2 h-4 w-4" />
                Monitoring
              </CommandItem>
            </CommandGroup>

            {services.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup heading="Services">
                  {services.slice(0, 5).map(s => (
                    <CommandItem key={s.id}
                      onSelect={() => runCommand(() => router.push('/services'))}>
                      <Layers className="mr-2 h-4 w-4" />
                      <div className="flex flex-col">
                        <span>{s.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {s.template} · {s.status}
                        </span>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}

            {deployments.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup heading="Recent Deployments">
                  {deployments.slice(0, 3).map(d => (
                    <CommandItem key={d.id}
                      onSelect={() => runCommand(() => router.push('/deployments'))}>
                      <Rocket className="mr-2 h-4 w-4" />
                      <div className="flex flex-col">
                        <span>
                          {d.serviceName || d.serviceId?.substring(0, 8) || 'Unknown'}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {d.environment} · {d.status}
                        </span>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}

            {infrastructure.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup heading="Infrastructure">
                  {infrastructure.slice(0, 3).map(r => (
                    <CommandItem key={r.id}
                      onSelect={() => runCommand(() => router.push('/infrastructure'))}>
                      <Server className="mr-2 h-4 w-4" />
                      <div className="flex flex-col">
                        <span>
                          {r.serviceName || r.serviceId?.substring(0, 8) || 'Unknown'}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {r.resourceType} · {r.awsRegion}
                        </span>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </>
        )}
      </CommandList>
    </CommandDialog>
  )
}
