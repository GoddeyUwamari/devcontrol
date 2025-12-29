'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ArrowLeft, Users, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { toast } from 'sonner'

// Validation schema
const teamSchema = z.object({
  name: z.string()
    .min(3, 'Team name must be at least 3 characters')
    .max(50, 'Team name must be less than 50 characters')
    .regex(/^[a-zA-Z0-9\s-]+$/, 'Only letters, numbers, spaces, and hyphens allowed'),
  description: z.string()
    .max(500, 'Description must be less than 500 characters')
    .optional(),
  owner: z.string()
    .email('Must be a valid email address'),
  slackChannel: z.string()
    .regex(/^#?[a-z0-9-]+$/, 'Must be a valid Slack channel (e.g., #platform-team)')
    .optional()
    .or(z.literal('')),
})

type TeamFormData = z.infer<typeof teamSchema>

export default function CreateTeamPage() {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)

  const form = useForm<TeamFormData>({
    resolver: zodResolver(teamSchema),
    defaultValues: {
      name: '',
      description: '',
      owner: '',
      slackChannel: '',
    },
  })

  const onSubmit = async (data: TeamFormData) => {
    setIsSubmitting(true)

    try {
      const response = await fetch('http://localhost:8080/api/teams', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: data.name,
          description: data.description || null,
          owner: data.owner,
          slack_channel: data.slackChannel || null,
          members: [data.owner], // Owner is first member
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || 'Failed to create team')
      }

      toast.success('Team created successfully!')
      router.push('/teams')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create team')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="space-y-6 px-4 md:px-6 lg:px-8 py-6 max-w-4xl mx-auto">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <button onClick={() => router.push('/dashboard')} className="hover:text-foreground">
          Dashboard
        </button>
        <span>›</span>
        <button onClick={() => router.push('/teams')} className="hover:text-foreground">
          Teams
        </button>
        <span>›</span>
        <span className="text-foreground">Create Team</span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Create New Team</h1>
          <p className="text-muted-foreground mt-2">
            Organize services by team ownership and collaboration
          </p>
        </div>
        <Button variant="outline" onClick={() => router.back()}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
      </div>

      {/* Form */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <div className="h-10 w-10 rounded-lg bg-blue-100 flex items-center justify-center">
              <Users className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <CardTitle>Team Details</CardTitle>
              <CardDescription>
                Fill in the information below to create your team
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              {/* Team Name */}
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium">
                      Team Name <span className="text-red-500">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Platform Engineering"
                        {...field}
                        className="text-base"
                      />
                    </FormControl>
                    <FormDescription className="text-xs">
                      Use letters, numbers, spaces, and hyphens only
                    </FormDescription>
                    <FormMessage className="text-xs" />
                  </FormItem>
                )}
              />

              {/* Owner Email */}
              <FormField
                control={form.control}
                name="owner"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium">
                      Team Owner <span className="text-red-500">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        placeholder="owner@company.com"
                        {...field}
                        className="text-base"
                      />
                    </FormControl>
                    <FormDescription className="text-xs">
                      Primary contact and team lead
                    </FormDescription>
                    <FormMessage className="text-xs" />
                  </FormItem>
                )}
              />

              {/* Description */}
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium">Description</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Team responsible for platform infrastructure and developer experience..."
                        {...field}
                        className="resize-none text-base min-h-[100px]"
                      />
                    </FormControl>
                    <FormDescription className="text-xs">
                      Optional: Brief description of the team's responsibilities
                    </FormDescription>
                    <FormMessage className="text-xs" />
                  </FormItem>
                )}
              />

              {/* Slack Channel */}
              <FormField
                control={form.control}
                name="slackChannel"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium">Slack Channel</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="#platform-engineering"
                        {...field}
                        className="text-base"
                      />
                    </FormControl>
                    <FormDescription className="text-xs">
                      Optional: Team's Slack channel for notifications
                    </FormDescription>
                    <FormMessage className="text-xs" />
                  </FormItem>
                )}
              />

              {/* Submit Button */}
              <div className="flex items-center gap-4 pt-4 border-t">
                <Button
                  type="submit"
                  disabled={isSubmitting}
                  className="min-w-[150px]"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <Users className="mr-2 h-4 w-4" />
                      Create Team
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
          </Form>
        </CardContent>
      </Card>
    </div>
  )
}
