'use client'

import { useEffect, useState, useCallback } from 'react'
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
import { Layers, Rocket, Server, Users, Activity, Plus, LayoutDashboard, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { servicesService } from '@/lib/services/services.service'
import { deploymentsService } from '@/lib/services/deployments.service'
import { infrastructureService } from '@/lib/services/infrastructure.service'
import { nlQueryService } from '@/lib/services/nl-query.service'

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [searchValue, setSearchValue] = useState('')
  const [isNLQuery, setIsNLQuery] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
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
    if (!isNLQuery || isProcessing) return

    setIsProcessing(true)
    try {
      const intent = await nlQueryService.parseQuery(searchValue)

      // Build URL with filters
      let url = `/${intent.target}`
      if (intent.filters && Object.keys(intent.filters).length > 0) {
        const params = new URLSearchParams(intent.filters)
        url += `?${params.toString()}`
      }

      setOpen(false)
      setSearchValue('')

      toast.success(intent.explanation, {
        icon: <Sparkles className="h-4 w-4" />,
      })

      router.push(url)
    } catch (error) {
      console.error('NL Query failed:', error)
      toast.error('Could not understand query', {
        description: 'Try being more specific or use keyword search',
      })
    } finally {
      setIsProcessing(false)
    }
  }, [isNLQuery, isProcessing, searchValue, router])

  // Keyboard shortcut to open/close
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((open) => !open)
      }

      // Enter key for NL query
      if (e.key === 'Enter' && isNLQuery && !e.shiftKey && open) {
        e.preventDefault()
        handleNLQuery()
      }
    }

    document.addEventListener('keydown', down)
    return () => document.removeEventListener('keydown', down)
  }, [isNLQuery, handleNLQuery, open])

  const runCommand = useCallback((command: () => void) => {
    setOpen(false)
    setSearchValue('')
    command()
  }, [])

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <DialogTitle className="sr-only">Command Palette</DialogTitle>
      <div className="relative">
        <CommandInput
          placeholder="Search services, deployments, infrastructure..."
          value={searchValue}
          onValueChange={setSearchValue}
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
              <Sparkles className="h-8 w-8 mx-auto mb-2 text-purple-600 dark:text-purple-400" />
              <p className="text-sm font-medium">Press Enter to search with AI</p>
              <p className="text-xs text-muted-foreground mt-1">
                Or keep typing to see matching items
              </p>
            </div>
          ) : (
            'No results found.'
          )}
        </CommandEmpty>

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
      </CommandList>
    </CommandDialog>
  )
}
