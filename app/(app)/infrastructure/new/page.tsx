'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Loader2, ArrowLeft, Server } from 'lucide-react'
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
import { infrastructureService } from '@/lib/services/infrastructure.service'
import { servicesService } from '@/lib/services/services.service'

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
const infrastructureSchema = z.object({
  serviceId: z.string().uuid('Please select a service'),
  resourceType: z.enum(['ec2', 'rds', 'vpc', 's3', 'lambda', 'cloudfront', 'elb'], {
    errorMap: () => ({ message: 'Please select a resource type' })
  }),
  awsId: z.string().min(1, 'AWS Resource ID is required'),
  awsRegion: z.string().regex(/^[a-z]{2}-[a-z]+-\d$/, 'Please select a valid AWS region'),
  costPerMonth: z.string()
    .regex(/^\d+(\.\d{1,2})?$/, 'Must be a valid number with up to 2 decimal places')
    .transform(val => parseFloat(val))
    .refine(val => val >= 0, 'Cost must be non-negative')
    .optional(),
})

type InfrastructureFormData = z.infer<typeof infrastructureSchema>

export default function NewInfrastructurePage() {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Fetch services for dropdown
  const { data: services = [], isLoading: servicesLoading } = useQuery({
    queryKey: ['services'],
    queryFn: servicesService.getAll,
  })

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isValid },
  } = useForm<InfrastructureFormData>({
    resolver: zodResolver(infrastructureSchema),
    mode: 'onChange',
  })

  const serviceId = watch('serviceId')
  const resourceType = watch('resourceType')
  const awsRegion = watch('awsRegion')

  const onSubmit = async (data: InfrastructureFormData) => {
    setIsSubmitting(true)

    const promise = infrastructureService.create({
      serviceId: data.serviceId,
      resourceType: data.resourceType,
      awsId: data.awsId,
      awsRegion: data.awsRegion,
      costPerMonth: data.costPerMonth,
    })

    toast.promise(promise, {
      loading: 'Creating infrastructure resource...',
      success: 'Infrastructure resource created successfully!',
      error: (err) => {
        setIsSubmitting(false)
        return err.message || 'Failed to create infrastructure resource'
      },
    })

    try {
      await promise
      router.push('/infrastructure')
    } catch (error) {
      console.error('Error creating infrastructure resource:', error)
      setIsSubmitting(false)
    }
  }

  return (
    <div className="space-y-6 px-4 md:px-6 lg:px-8 py-6 max-w-4xl mx-auto">
      <Breadcrumb
        items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Infrastructure', href: '/infrastructure' },
          { label: 'Add Resource', current: true },
        ]}
      />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Add Infrastructure Resource</h1>
          <p className="text-muted-foreground mt-2">
            Track an AWS resource for a service
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
              <Server className="h-5 w-5 text-[#635BFF]" />
            </div>
            <div>
              <CardTitle>Resource Details</CardTitle>
              <CardDescription>
                Add AWS infrastructure resource information
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            {/* Service Selection */}
            <div className="space-y-2">
              <Label htmlFor="serviceId" className="text-sm font-medium">
                Service <span className="text-red-500">*</span>
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
                <p className="text-sm text-red-600">{errors.serviceId.message}</p>
              )}
              {services.length === 0 && !servicesLoading && (
                <p className="text-xs text-amber-600">
                  No services found. Please create a service first.
                </p>
              )}
            </div>

            {/* Resource Type */}
            <div className="space-y-2">
              <Label htmlFor="resourceType" className="text-sm font-medium">
                Resource Type <span className="text-red-500">*</span>
              </Label>
              <Select
                value={resourceType}
                onValueChange={(value) => setValue('resourceType', value as 'ec2' | 'rds' | 'vpc' | 's3' | 'lambda' | 'cloudfront' | 'elb', { shouldValidate: true })}
              >
                <SelectTrigger className={errors.resourceType ? 'border-red-500' : ''}>
                  <SelectValue placeholder="Select a resource type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ec2">EC2 Instance</SelectItem>
                  <SelectItem value="rds">RDS Database</SelectItem>
                  <SelectItem value="vpc">VPC</SelectItem>
                  <SelectItem value="s3">S3 Bucket</SelectItem>
                  <SelectItem value="lambda">Lambda Function</SelectItem>
                  <SelectItem value="cloudfront">CloudFront Distribution</SelectItem>
                  <SelectItem value="elb">Elastic Load Balancer</SelectItem>
                </SelectContent>
              </Select>
              {errors.resourceType && (
                <p className="text-sm text-red-600">{errors.resourceType.message}</p>
              )}
            </div>

            {/* AWS Resource ID */}
            <div className="space-y-2">
              <Label htmlFor="awsId" className="text-sm font-medium">
                AWS Resource ID <span className="text-red-500">*</span>
              </Label>
              <Input
                id="awsId"
                placeholder="i-1234567890abcdef0"
                {...register('awsId')}
                className={errors.awsId ? 'border-red-500 text-base' : 'text-base'}
              />
              {errors.awsId && (
                <p className="text-sm text-red-600">{errors.awsId.message}</p>
              )}
              <p className="text-xs text-muted-foreground">
                The AWS identifier for this resource (e.g., instance ID, bucket name, etc.)
              </p>
            </div>

            {/* AWS Region */}
            <div className="space-y-2">
              <Label htmlFor="awsRegion" className="text-sm font-medium">
                AWS Region <span className="text-red-500">*</span>
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
                <p className="text-sm text-red-600">{errors.awsRegion.message}</p>
              )}
            </div>

            {/* Cost Per Month */}
            <div className="space-y-2">
              <Label htmlFor="costPerMonth" className="text-sm font-medium">
                Monthly Cost (USD)
              </Label>
              <Input
                id="costPerMonth"
                type="text"
                placeholder="29.99"
                {...register('costPerMonth')}
                className={errors.costPerMonth ? 'border-red-500 text-base' : 'text-base'}
              />
              {errors.costPerMonth && (
                <p className="text-sm text-red-600">{errors.costPerMonth.message}</p>
              )}
              <p className="text-xs text-muted-foreground">
                Optional - Estimated monthly cost for this resource
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
                    Adding...
                  </>
                ) : (
                  <>
                    <Server className="mr-2 h-4 w-4" />
                    Add Resource
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
