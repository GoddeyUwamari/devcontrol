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
import { Layers, Rocket, Server, Users, Activity, Plus, LayoutDashboard } from 'lucide-react'
import { servicesService } from '@/lib/services/services.service'
import { deploymentsService } from '@/lib/services/deployments.service'
import { infrastructureService } from '@/lib/services/infrastructure.service'

export function CommandPalette() {
  const [open, setOpen] = useState(false)
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

  // Keyboard shortcut to open/close
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((open) => !open)
      }
    }

    document.addEventListener('keydown', down)
    return () => document.removeEventListener('keydown', down)
  }, [])

  const runCommand = useCallback((command: () => void) => {
    setOpen(false)
    command()
  }, [])

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Search services, deployments, infrastructure..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

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
                    <span>{deployment.serviceName || deployment.serviceId.substring(0, 8)}</span>
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
                    <span>{resource.serviceName || resource.serviceId.substring(0, 8)}</span>
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
