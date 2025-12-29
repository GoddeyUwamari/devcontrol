'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Breadcrumb } from '@/components/navigation/breadcrumb'

export default function TeamsPage() {
  return (
    <div className="space-y-6 px-4 md:px-6 lg:px-8">
      <Breadcrumb
        items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Teams' }
        ]}
      />

      <div>
        <h1 className="text-3xl font-bold tracking-tight">Teams</h1>
        <p className="text-muted-foreground mt-2">
          Manage teams and their service ownership
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Teams</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">Teams page coming soon...</p>
        </CardContent>
      </Card>
    </div>
  )
}