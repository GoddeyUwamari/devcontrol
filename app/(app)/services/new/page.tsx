'use client'

import { useEffect, useId, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Loader2, ArrowLeft, Layers, ChevronRight } from 'lucide-react'
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
import { PAGE_SUBTITLE_CLASS, PAGE_TITLE_CLASS } from '@/components/ui/typography'
import { cn } from '@/lib/utils'
import { servicesService } from '@/lib/services/services.service'
import { teamsService } from '@/lib/services/teams.service'
import { logError } from '@/lib/safe-log'
import { useServiceLimit } from '@/lib/hooks/use-service-limit'
import { useAuth } from '@/lib/contexts/auth-context'
import {
  SERVICE_LIMIT_CONTACT_HREF,
  SERVICE_LIMIT_COPY,
  SERVICE_LIMIT_SEE_PLANS_HREF,
  SERVICE_LIMIT_UPDATE_BILLING_HREF,
} from '@/lib/service-limit/copy'
import { serviceLimitRefusalMessage } from '@/lib/service-limit/refusal'
import type { ServiceLimit } from '@/lib/types'
import { returnPathAfterCreate } from './return-path'

// Validation schema using Zod (matches backend schema)
const serviceSchema = z.object({
  name: z.string()
    .min(3, 'Service name must be at least 3 characters')
    .max(50, 'Service name must be less than 50 characters')
    .regex(/^[a-z0-9-]+$/, 'Only lowercase letters, numbers, and hyphens allowed'),
  template: z.enum(['api', 'frontend', 'worker', 'database'], {
    error: () => ({ message: 'Please select a valid template' })
  }),
  owner: z.string().email('Must be a valid email address'),
  // Optional (onboarding D1): no team is sent as no team_id at all.
  teamId: z.string().uuid('Please select a team').optional(),
  description: z.string().max(500, 'Description must be less than 500 characters').optional(),
  githubUrl: z.string().url('Must be a valid URL').optional().or(z.literal('')),
})

type ServiceFormData = z.infer<typeof serviceSchema>

const NOTICE_LINK = 'font-semibold text-ink-accent underline'

/** The Team select's "no team" choice (a Radix SelectItem cannot have an empty value). Never sent. */
const NO_TEAM = 'no-team'

/** Onboarding D2 / D4 / D8, founder-approved copy. */
export const NEW_SERVICE_COPY = {
  moreOptions: 'More options',
  ownerLabel: 'Owner email',
  ownerHelp: 'Who to contact about this service. Defaults to you.',
  teamLabel: 'Team (optional)',
  teamHelp: 'You can group services into teams later.',
  noTeam: 'No team',
} as const

/**
 * At the services limit (stage-a C1-C5): why no service can be created, with
 * the plan's way forward. Existing services are never affected. Explanatory
 * only: POST /api/services refuses on its own (402).
 */
function ServiceLimitNotice({ limit }: { limit: ServiceLimit & { max: number } }) {
  const c = SERVICE_LIMIT_COPY
  let body: React.ReactNode
  if (limit.reason) {
    body = <>{c.holdBody(limit.freePlan, limit.max, limit.used)} <Link href={SERVICE_LIMIT_UPDATE_BILLING_HREF} className={NOTICE_LINK}>{c.updateBilling}</Link></>
  } else if (limit.upgradeAvailable) {
    body = <>{c.planBody(limit.plan, limit.max, limit.used)} <Link href={SERVICE_LIMIT_SEE_PLANS_HREF} className={NOTICE_LINK}>{c.seePlans}</Link></>
  } else {
    body = <>{c.planBody(limit.plan, limit.max, limit.used)} {c.managedLead}<a href={SERVICE_LIMIT_CONTACT_HREF} className={NOTICE_LINK}>{c.contactUs}</a>.</>
  }
  return (
    <div role="status" data-testid="service-limit-notice" className="rounded-lg border border-border bg-muted px-4 py-3">
      <p className="m-0 text-ui font-semibold text-ink">{c.title}</p>
      <p className="m-0 mt-1 text-ui text-ink-body">{body}</p>
    </div>
  )
}

export default function NewServicePage() {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const limitReasonId = useId()
  const moreOptionsId = useId()
  const serviceLimit = useServiceLimit()
  const { user, isLoading: authLoading } = useAuth()
  const userEmail = user?.email
  const limit = serviceLimit.data
  const atLimit = limit !== undefined && limit.reached && limit.max !== null

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
    getFieldState,
    formState: { errors, isValid },
  } = useForm<ServiceFormData>({
    resolver: zodResolver(serviceSchema),
    mode: 'onChange',
    defaultValues: { owner: userEmail ?? '' },
  })

  const template = watch('template')
  const teamId = watch('teamId')

  // D2: the owner defaults to the signed-in user, once, and never over a value
  // already typed (the user can arrive after the first render).
  const ownerPrefilled = useRef(Boolean(userEmail))
  useEffect(() => {
    if (!userEmail || ownerPrefilled.current) return
    ownerPrefilled.current = true
    if (getFieldState('owner').isDirty) return
    setValue('owner', userEmail, { shouldValidate: true })
  }, [userEmail, getFieldState, setValue])

  // D8: "More options" starts collapsed. It opens on its own, and cannot be
  // collapsed, while a field inside it has an error or while there is no email
  // to default the owner to (the one required field inside would otherwise be
  // empty and out of sight). Once opened that way it stays open after the fix,
  // so it never closes under the user's typing; they collapse it themselves.
  const [moreOptionsOpen, setMoreOptionsOpen] = useState(false)
  const errorInMoreOptions = Boolean(errors.teamId || errors.owner || errors.githubUrl || errors.description)
  const ownerNeedsInput = !authLoading && !userEmail
  const moreOptionsHeldOpen = errorInMoreOptions || ownerNeedsInput
  const moreOptionsExpanded = moreOptionsOpen || moreOptionsHeldOpen
  useEffect(() => {
    if (moreOptionsHeldOpen) setMoreOptionsOpen(true)
  }, [moreOptionsHeldOpen])

  const onSubmit = async (data: ServiceFormData) => {
    // At the limit nothing is sent (the button is disabled too); the server refuses on its own anyway.
    if (atLimit) return
    setIsSubmitting(true)
    const toastId = toast.loading('Creating service...')

    try {
      await servicesService.create({
        name: data.name,
        template: data.template,
        owner: data.owner,
        teamId: data.teamId || undefined,
        description: data.description || undefined,
        githubUrl: data.githubUrl || undefined,
      })
      toast.success('Service created successfully!', { id: toastId })
      router.push(returnPathAfterCreate())
    } catch (error) {
      logError('Error creating service', error)
      // C7: the server's own message, never the HTTP client's generic one; the notice then shows.
      const refusal = serviceLimitRefusalMessage(error)
      if (refusal) {
        toast.error(SERVICE_LIMIT_COPY.notCreatedTitle, { id: toastId, description: refusal })
        void serviceLimit.refetch()
      } else {
        toast.error((error as Error)?.message || 'Failed to create service', { id: toastId })
      }
      setIsSubmitting(false)
    }
  }

  return (
    <div className="space-y-6 px-4 md:px-6 lg:px-8 py-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className={PAGE_TITLE_CLASS}>Create New Service</h1>
          <p className={cn(PAGE_SUBTITLE_CLASS, 'mt-2')}>
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
          {atLimit && <div className="mb-6"><ServiceLimitNotice limit={{ ...limit, max: limit.max as number }} /></div>}
          <form method="post" onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-6">
            {/* Service Name */}
            <div className="space-y-2">
              <Label htmlFor="name" className="text-ui font-medium">
                Service Name <span className="text-ink-danger">*</span>
              </Label>
              <Input
                id="name"
                placeholder="my-awesome-service"
                {...register('name')}
                className={errors.name ? 'border-red-500 text-base' : 'text-base'}
              />
              {errors.name && (
                <p className="text-ui text-ink-danger">{errors.name.message}</p>
              )}
              <p className="text-meta text-muted-foreground">
                Use lowercase letters, numbers, and hyphens only
              </p>
            </div>

            {/* Template */}
            <div className="space-y-2">
              <Label htmlFor="template" className="text-ui font-medium">
                Template <span className="text-ink-danger">*</span>
              </Label>
              <Select
                value={template}
                onValueChange={(value) => setValue('template', value as 'api' | 'frontend' | 'worker' | 'database', { shouldValidate: true })}
              >
                <SelectTrigger id="template" className={errors.template ? 'border-red-500' : ''}>
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
                <p className="text-ui text-ink-danger">{errors.template.message}</p>
              )}
            </div>

            {/* More options (D8): collapsed by default; Name and Template stay above */}
            <div>
              <button
                type="button"
                aria-expanded={moreOptionsExpanded}
                aria-controls={moreOptionsId}
                onClick={() => { if (!moreOptionsHeldOpen) setMoreOptionsOpen(!moreOptionsOpen) }}
                className="inline-flex items-center gap-1.5 rounded-md text-ui font-medium text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <ChevronRight className={cn('h-4 w-4 transition-transform', moreOptionsExpanded && 'rotate-90')} aria-hidden="true" />
                {NEW_SERVICE_COPY.moreOptions}
              </button>
              <div id={moreOptionsId} data-testid="more-options" hidden={!moreOptionsExpanded} className="mt-6 space-y-6">
                {/* Team (D1, D4): optional; no team is sent as no team_id */}
                <div className="space-y-2">
                  <Label htmlFor="teamId" className="text-ui font-medium">
                    {NEW_SERVICE_COPY.teamLabel}
                  </Label>
                  <Select
                    value={teamId ?? NO_TEAM}
                    onValueChange={(value) => setValue('teamId', value === NO_TEAM ? undefined : value, { shouldValidate: true })}
                    disabled={teamsLoading}
                  >
                    <SelectTrigger id="teamId" className={errors.teamId ? 'border-red-500' : ''}>
                      <SelectValue placeholder={teamsLoading ? 'Loading teams...' : NEW_SERVICE_COPY.noTeam} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_TEAM}>{NEW_SERVICE_COPY.noTeam}</SelectItem>
                      {teams.map((team) => (
                        <SelectItem key={team.id} value={team.id}>
                          {team.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {errors.teamId && (
                    <p className="text-ui text-ink-danger">{errors.teamId.message}</p>
                  )}
                  <p className="text-meta text-muted-foreground">{NEW_SERVICE_COPY.teamHelp}</p>
                </div>

                {/* Owner email (D2) */}
                <div className="space-y-2">
                  <Label htmlFor="owner" className="text-ui font-medium">
                    {NEW_SERVICE_COPY.ownerLabel} <span className="text-ink-danger">*</span>
                  </Label>
                  <Input
                    id="owner"
                    type="email"
                    placeholder="owner@example.com"
                    {...register('owner')}
                    className={errors.owner ? 'border-red-500 text-base' : 'text-base'}
                  />
                  {errors.owner && (
                    <p className="text-ui text-ink-danger">{errors.owner.message}</p>
                  )}
                  <p className="text-meta text-muted-foreground">{NEW_SERVICE_COPY.ownerHelp}</p>
                </div>

                {/* GitHub URL (Optional) */}
                <div className="space-y-2">
                  <Label htmlFor="githubUrl" className="text-ui font-medium">GitHub Repository URL</Label>
                  <Input
                    id="githubUrl"
                    type="url"
                    placeholder="https://github.com/username/repo"
                    {...register('githubUrl')}
                    className={errors.githubUrl ? 'border-red-500 text-base' : 'text-base'}
                  />
                  {errors.githubUrl && (
                    <p className="text-ui text-ink-danger">{errors.githubUrl.message}</p>
                  )}
                  <p className="text-meta text-muted-foreground">Optional</p>
                </div>

                {/* Description (Optional) */}
                <div className="space-y-2">
                  <Label htmlFor="description" className="text-ui font-medium">Description</Label>
                  <Textarea
                    id="description"
                    placeholder="A brief description of your service..."
                    rows={4}
                    {...register('description')}
                    className={errors.description ? 'border-red-500 text-base' : 'text-base resize-none min-h-[100px]'}
                  />
                  {errors.description && (
                    <p className="text-ui text-ink-danger">{errors.description.message}</p>
                  )}
                  <p className="text-meta text-muted-foreground">
                    Optional - Maximum 500 characters
                  </p>
                </div>
              </div>
            </div>

            {/* Submit Button */}
            <div className="flex items-center gap-4 pt-4 border-t">
              <Button
                type="submit"
                disabled={!isValid || isSubmitting || atLimit}
                aria-describedby={atLimit ? limitReasonId : undefined}
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
              {atLimit && <span id={limitReasonId} data-testid="service-limit-submit-reason" className="text-meta text-ink-muted">{SERVICE_LIMIT_COPY.submitReason}</span>}
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
