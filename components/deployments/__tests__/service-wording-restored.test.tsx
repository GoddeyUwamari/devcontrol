/**
 * Wording #221 changed while Add Service was hidden, restored now that it is
 * back: the deployment setup checklist's first step and the dashboard service
 * grid's empty state point the user at creating a service.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DeploymentSetupChecklist } from '../DeploymentSetupChecklist'
import { ServiceHealthGrid } from '@/components/dashboard/service-health-grid'

describe('restored service wording', () => {
  it('the deployment setup checklist starts with Create Service', () => {
    render(<DeploymentSetupChecklist />)
    expect(screen.getByText('Create Service')).toBeInTheDocument()
    expect(screen.getByText('Register your first application')).toBeInTheDocument()
    expect(screen.queryByText('Review Services')).not.toBeInTheDocument()
  })

  it('the dashboard service grid with no services invites adding the first one', () => {
    render(<ServiceHealthGrid services={[]} isLoading={false} />)
    expect(screen.getByText('Add your first service to get started')).toBeInTheDocument()
    expect(screen.queryByText('No services are registered yet')).not.toBeInTheDocument()
  })
})
