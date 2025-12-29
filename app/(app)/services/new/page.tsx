'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Loader2, ArrowLeft, Layers } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Breadcrumb } from '@/components/navigation/breadcrumb'
import { servicesService } from '@/lib/services/services.service'
import { teamsService } from '@/lib/services/teams.service'

// Validation schema using Zod (matches backend schema)
const serviceSchema = z.object({
  name: z.string()
    .min(3, 'Service name must be at least 3 characters')
    .max(50, 'Service name must be less than 50 characters')
    .regex(/^[a-z0-9-]+$/, 'Only lowercase letters, numbers, and hyphens allowed'),
  template: z.enum(['api', 'frontend', 'worker', 'database'], {
    errorMap: () => ({ message: 'Please select a valid template' })
  }),
  owner: z.string().email('Must be a valid email address'),
  teamId: z.string().uuid('Please select a team'),
  description: z.string().max(500, 'Description must be less than 500 characters').optional(),
  githubUrl: z.string().url('Must be a valid URL').optional().or(z.literal('')),
})

type ServiceFormData = z.infer<typeof serviceSchema>

export default function NewServicePage() {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Fetch teams for dropdown
  const { data: teams = [], isLoading: teamsLoading } = useQuery({
    queryKey: ['teams'],
    queryFn: teamsService.getAll,
  })

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isValid },
  } = useForm<ServiceFormData>({
    resolver: zodResolver(serviceSchema),
    mode: 'onChange',
  })

  const template = watch('template')
  const teamId = watch('teamId')

  const onSubmit = async (data: ServiceFormData) => {
    setIsSubmitting(true)

    const promise = servicesService.create({
      name: data.name,
      template: data.template,
      owner: data.owner,
      teamId: data.teamId,
      description: data.description || undefined,
      githubUrl: data.githubUrl || undefined,
    })

    toast.promise(promise, {
      loading: 'Creating service...',
      success: 'Service created successfully!',
      error: (err) => {
        setIsSubmitting(false)
        return err.message || 'Failed to create service'
      },
    })

    try {
      await promise
      router.push('/services')
    } catch (error) {
      console.error('Error creating service:', error)
      setIsSubmitting(false)
    }
  }

  return (
    <div className="space-y-6 px-4 md:px-6 lg:px-8 py-6 max-w-4xl mx-auto">
      <Breadcrumb
        items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Services', href: '/services' },
          { label: 'Create Service', current: true },
        ]}
      />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Create New Service</h1>
          <p className="text-muted-foreground mt-2">
            Define a new service to track deployments and infrastructure
          </p>
        </div>
        <Button variant="outline" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-md bg-[#635BFF]/10 flex items-center justify-center">
              <Layers className="h-5 w-5 text-[#635BFF]" />
            </div>
            <div>
              <CardTitle>Service Details</CardTitle>
              <CardDescription>
                Fill in the information below to create your service
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            {/* Service Name */}
            <div className="space-y-2">
              <Label htmlFor="name" className="text-sm font-medium">
                Service Name <span className="text-red-500">*</span>
              </Label>
              <Input
                id="name"
                placeholder="my-awesome-service"
                {...register('name')}
                className={errors.name ? 'border-red-500 text-base' : 'text-base'}
              />
              {errors.name && (
                <p className="text-sm text-red-600">{errors.name.message}</p>
              )}
              <p className="text-xs text-muted-foreground">
                Use lowercase letters, numbers, and hyphens only
              </p>
            </div>

            {/* Template */}
            <div className="space-y-2">
              <Label htmlFor="template" className="text-sm font-medium">
                Template <span className="text-red-500">*</span>
              </Label>
              <Select
                value={template}
                onValueChange={(value) => setValue('template', value as 'api' | 'frontend' | 'worker' | 'database', { shouldValidate: true })}
              >
                <SelectTrigger className={errors.template ? 'border-red-500' : ''}>
                  <SelectValue placeholder="Select a template" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="api">API Service</SelectItem>
                  <SelectItem value="frontend">Frontend Application</SelectItem>
                  <SelectItem value="worker">Background Worker</SelectItem>
                  <SelectItem value="database">Database Service</SelectItem>
                </SelectContent>
              </Select>
              {errors.template && (
                <p className="text-sm text-red-600">{errors.template.message}</p>
              )}
            </div>

            {/* Team */}
            <div className="space-y-2">
              <Label htmlFor="teamId" className="text-sm font-medium">
                Team <span className="text-red-500">*</span>
              </Label>
              <Select
                value={teamId}
                onValueChange={(value) => setValue('teamId', value, { shouldValidate: true })}
                disabled={teamsLoading}
              >
                <SelectTrigger className={errors.teamId ? 'border-red-500' : ''}>
                  <SelectValue placeholder={teamsLoading ? 'Loading teams...' : 'Select a team'} />
                </SelectTrigger>
                <SelectContent>
                  {teams.map((team) => (
                    <SelectItem key={team.id} value={team.id}>
                      {team.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.teamId && (
                <p className="text-sm text-red-600">{errors.teamId.message}</p>
              )}
              {teams.length === 0 && !teamsLoading && (
                <p className="text-xs text-amber-600">
                  No teams found. Please create a team first.
                </p>
              )}
            </div>

            {/* Owner Email */}
            <div className="space-y-2">
              <Label htmlFor="owner" className="text-sm font-medium">
                Owner Email <span className="text-red-500">*</span>
              </Label>
              <Input
                id="owner"
                type="email"
                placeholder="owner@example.com"
                {...register('owner')}
                className={errors.owner ? 'border-red-500 text-base' : 'text-base'}
              />
              {errors.owner && (
                <p className="text-sm text-red-600">{errors.owner.message}</p>
              )}
            </div>

            {/* GitHub URL (Optional) */}
            <div className="space-y-2">
              <Label htmlFor="githubUrl" className="text-sm font-medium">GitHub Repository URL</Label>
              <Input
                id="githubUrl"
                type="url"
                placeholder="https://github.com/username/repo"
                {...register('githubUrl')}
                className={errors.githubUrl ? 'border-red-500 text-base' : 'text-base'}
              />
              {errors.githubUrl && (
                <p className="text-sm text-red-600">{errors.githubUrl.message}</p>
              )}
              <p className="text-xs text-muted-foreground">Optional</p>
            </div>

            {/* Description (Optional) */}
            <div className="space-y-2">
              <Label htmlFor="description" className="text-sm font-medium">Description</Label>
              <Textarea
                id="description"
                placeholder="A brief description of your service..."
                rows={4}
                {...register('description')}
                className={errors.description ? 'border-red-500 text-base' : 'text-base resize-none min-h-[100px]'}
              />
              {errors.description && (
                <p className="text-sm text-red-600">{errors.description.message}</p>
              )}
              <p className="text-xs text-muted-foreground">
                Optional - Maximum 500 characters
              </p>
            </div>

            {/* Submit Button */}
            <div className="flex items-center gap-4 pt-4 border-t">
              <Button
                type="submit"
                disabled={!isValid || isSubmitting || teams.length === 0}
                className="min-w-[140px]"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Layers className="mr-2 h-4 w-4" />
                    Create Service
                  </>
                )}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => router.back()}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
