'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Loader2, ArrowLeft, Rocket } from 'lucide-react'
import { PAGE_SUBTITLE_CLASS, PAGE_TITLE_CLASS } from '@/components/ui/typography'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
import { deploymentsService } from '@/lib/services/deployments.service'
import { useRegisteredServices } from '@/lib/hooks/use-registered-services'
import { logError } from '@/lib/safe-log'

// AWS Regions
const AWS_REGIONS = [
  { value: 'us-east-1', label: 'US East (N. Virginia)' },
  { value: 'us-east-2', label: 'US East (Ohio)' },
  { value: 'us-west-1', label: 'US West (N. California)' },
  { value: 'us-west-2', label: 'US West (Oregon)' },
  { value: 'eu-west-1', label: 'Europe (Ireland)' },
  { value: 'eu-central-1', label: 'Europe (Frankfurt)' },
  { value: 'ap-southeast-1', label: 'Asia Pacific (Singapore)' },
  { value: 'ap-northeast-1', label: 'Asia Pacific (Tokyo)' },
]

// Validation schema
const deploymentSchema = z.object({
  serviceId: z.string().uuid('Please select a service'),
  environment: z.enum(['development', 'staging', 'production'], {
    error: () => ({ message: 'Please select an environment' })
  }),
  awsRegion: z.string().regex(/^[a-z]{2}-[a-z]+-\d$/, 'Please select a valid AWS region'),
  deployedBy: z.string().email('Must be a valid email address'),
})

type DeploymentFormData = z.infer<typeof deploymentSchema>

export default function NewDeploymentPage() {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Registered services for the dropdown: service_id references the services table
  const { data: services = [], isPending: servicesLoading } = useRegisteredServices()

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isValid },
  } = useForm<DeploymentFormData>({
    resolver: zodResolver(deploymentSchema),
    mode: 'onChange',
  })

  const serviceId = watch('serviceId')
  const environment = watch('environment')
  const awsRegion = watch('awsRegion')

  const onSubmit = async (data: DeploymentFormData) => {
    setIsSubmitting(true)

    const promise = deploymentsService.create({
      serviceId: data.serviceId,
      environment: data.environment,
      awsRegion: data.awsRegion,
      deployedBy: data.deployedBy,
    })

    toast.promise(promise, {
      loading: 'Creating deployment...',
      success: 'Deployment created successfully!',
      error: (err) => {
        setIsSubmitting(false)
        return err.message || 'Failed to create deployment'
      },
    })

    try {
      await promise
      router.push('/deployments')
    } catch (error) {
      logError('Error creating deployment', error)
      setIsSubmitting(false)
    }
  }

  return (
    <div className="space-y-6 px-4 md:px-6 lg:px-8 py-6 max-w-4xl mx-auto">
      <Breadcrumb
        items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Deployments', href: '/deployments' },
          { label: 'Create Deployment', current: true },
        ]}
      />

      <div className="flex items-center justify-between">
        <div>
          <h1 className={PAGE_TITLE_CLASS}>Create New Deployment</h1>
          <p className={`${PAGE_SUBTITLE_CLASS} mt-2`}>
            Deploy a service to your AWS infrastructure
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
              <Rocket className="h-5 w-5 text-[#635BFF]" />
            </div>
            <div>
              <CardTitle>Deployment Details</CardTitle>
              <CardDescription>
                Configure your deployment settings
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <form method="post" onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            {/* Service Selection */}
            <div className="space-y-2">
              <Label htmlFor="serviceId" className="text-ui font-medium">
                Service <span className="text-ink-danger">*</span>
              </Label>
              <Select
                value={serviceId}
                onValueChange={(value) => setValue('serviceId', value, { shouldValidate: true })}
                disabled={servicesLoading}
              >
                <SelectTrigger className={errors.serviceId ? 'border-red-500' : ''}>
                  <SelectValue placeholder={servicesLoading ? 'Loading services...' : 'Select a service'} />
                </SelectTrigger>
                <SelectContent>
                  {services.map((service) => (
                    <SelectItem key={service.id} value={service.id}>
                      {service.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.serviceId && (
                <p className="text-ui text-ink-danger">{errors.serviceId.message}</p>
              )}
              {services.length === 0 && !servicesLoading && (
                <p className="text-meta text-ink-warning">
                  No services found. Please create a service first.
                </p>
              )}
            </div>

            {/* Environment */}
            <div className="space-y-2">
              <Label htmlFor="environment" className="text-ui font-medium">
                Environment <span className="text-ink-danger">*</span>
              </Label>
              <Select
                value={environment}
                onValueChange={(value) => setValue('environment', value as 'development' | 'staging' | 'production', { shouldValidate: true })}
              >
                <SelectTrigger className={errors.environment ? 'border-red-500' : ''}>
                  <SelectValue placeholder="Select an environment" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="development">Development</SelectItem>
                  <SelectItem value="staging">Staging</SelectItem>
                  <SelectItem value="production">Production</SelectItem>
                </SelectContent>
              </Select>
              {errors.environment && (
                <p className="text-ui text-ink-danger">{errors.environment.message}</p>
              )}
            </div>

            {/* AWS Region */}
            <div className="space-y-2">
              <Label htmlFor="awsRegion" className="text-ui font-medium">
                AWS Region <span className="text-ink-danger">*</span>
              </Label>
              <Select
                value={awsRegion}
                onValueChange={(value) => setValue('awsRegion', value, { shouldValidate: true })}
              >
                <SelectTrigger className={errors.awsRegion ? 'border-red-500' : ''}>
                  <SelectValue placeholder="Select an AWS region" />
                </SelectTrigger>
                <SelectContent>
                  {AWS_REGIONS.map((region) => (
                    <SelectItem key={region.value} value={region.value}>
                      {region.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.awsRegion && (
                <p className="text-ui text-ink-danger">{errors.awsRegion.message}</p>
              )}
            </div>

            {/* Deployed By */}
            <div className="space-y-2">
              <Label htmlFor="deployedBy" className="text-ui font-medium">
                Deployed By (Email) <span className="text-ink-danger">*</span>
              </Label>
              <Input
                id="deployedBy"
                type="email"
                placeholder="deployer@example.com"
                {...register('deployedBy')}
                className={errors.deployedBy ? 'border-red-500 text-base' : 'text-base'}
              />
              {errors.deployedBy && (
                <p className="text-ui text-ink-danger">{errors.deployedBy.message}</p>
              )}
              <p className="text-meta text-muted-foreground">
                Email address of the person deploying this service
              </p>
            </div>

            {/* Submit Button */}
            <div className="flex items-center gap-4 pt-4 border-t">
              <Button
                type="submit"
                disabled={!isValid || isSubmitting || services.length === 0}
                className="min-w-[140px]"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Deploying...
                  </>
                ) : (
                  <>
                    <Rocket className="mr-2 h-4 w-4" />
                    Deploy Service
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
