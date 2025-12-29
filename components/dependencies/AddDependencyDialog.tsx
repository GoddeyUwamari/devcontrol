'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { servicesService } from '@/lib/services/services.service'
import { dependenciesService } from '@/lib/services/dependencies.service'
import type { DependencyType } from '@/lib/types'

interface AddDependencyDialogProps {
  open: boolean
  onClose: () => void
  onSuccess: () => void
}

export function AddDependencyDialog({
  open,
  onClose,
  onSuccess,
}: AddDependencyDialogProps) {
  const queryClient = useQueryClient()
  const [sourceServiceId, setSourceServiceId] = useState('')
  const [targetServiceId, setTargetServiceId] = useState('')
  const [dependencyType, setDependencyType] = useState<DependencyType>('runtime')
  const [description, setDescription] = useState('')
  const [isCritical, setIsCritical] = useState(false)

  // Fetch services for dropdowns
  const { data: services = [] } = useQuery({
    queryKey: ['services'],
    queryFn: () => servicesService.getAll(),
  })

  // Create mutation
  const createMutation = useMutation({
    mutationFn: () =>
      dependenciesService.create({
        sourceServiceId,
        targetServiceId,
        dependencyType,
        description: description || undefined,
        isCritical,
      }),
    onSuccess: () => {
      toast.success('Dependency created successfully')
      queryClient.invalidateQueries({ queryKey: ['dependencies'] })
      onSuccess()
      handleClose()
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Failed to create dependency')
    },
  })

  const handleClose = () => {
    setSourceServiceId('')
    setTargetServiceId('')
    setDependencyType('runtime')
    setDescription('')
    setIsCritical(false)
    onClose()
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (!sourceServiceId || !targetServiceId) {
      toast.error('Please select both source and target services')
      return
    }

    if (sourceServiceId === targetServiceId) {
      toast.error('A service cannot depend on itself')
      return
    }

    createMutation.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Add Service Dependency</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Source Service */}
          <div className="space-y-2">
            <Label htmlFor="source">Source Service (depends on)</Label>
            <Select value={sourceServiceId} onValueChange={setSourceServiceId}>
              <SelectTrigger>
                <SelectValue placeholder="Select source service..." />
              </SelectTrigger>
              <SelectContent>
                {services.map((service) => (
                  <SelectItem key={service.id} value={service.id}>
                    {service.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              The service that has the dependency
            </p>
          </div>

          {/* Target Service */}
          <div className="space-y-2">
            <Label htmlFor="target">Target Service (is needed by)</Label>
            <Select value={targetServiceId} onValueChange={setTargetServiceId}>
              <SelectTrigger>
                <SelectValue placeholder="Select target service..." />
              </SelectTrigger>
              <SelectContent>
                {services.map((service) => (
                  <SelectItem
                    key={service.id}
                    value={service.id}
                    disabled={service.id === sourceServiceId}
                  >
                    {service.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              The service that is depended upon
            </p>
          </div>

          {/* Dependency Type */}
          <div className="space-y-2">
            <Label htmlFor="type">Dependency Type</Label>
            <Select
              value={dependencyType}
              onValueChange={(v: DependencyType) => setDependencyType(v)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="runtime">Runtime (API Calls)</SelectItem>
                <SelectItem value="data">Data (Database)</SelectItem>
                <SelectItem value="deployment">Deployment (Deploy Order)</SelectItem>
                <SelectItem value="shared-lib">Shared Library (Code)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">Description (Optional)</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g., Auth service validates JWT tokens for API requests"
              rows={3}
            />
          </div>

          {/* Critical Flag */}
          <div className="flex items-center space-x-2">
            <Checkbox
              id="critical"
              checked={isCritical}
              onCheckedChange={(checked) => setIsCritical(checked as boolean)}
            />
            <Label htmlFor="critical" className="font-normal cursor-pointer">
              Mark as critical path dependency
            </Label>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? 'Creating...' : 'Create Dependency'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
