/**
 * Slack delivery is shown but disabled: the form never turns it on, and a
 * saved schedule is submitted without it, including an existing schedule
 * that had it enabled.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { CreateScheduleModal } from '../CreateScheduleModal'
import type { CreateScheduleRequest, ScheduledReport } from '@/lib/services/scheduled-reports.service'

const slackSchedule: ScheduledReport = {
  id: 'sched-1',
  organization_id: 'org-1',
  name: 'Weekly cost',
  description: null,
  report_type: 'cost_summary',
  schedule_type: 'daily',
  schedule_time: '09:00:00',
  schedule_day_of_week: null,
  schedule_day_of_month: null,
  timezone: 'UTC',
  delivery_email: true,
  delivery_slack: true,
  email_recipients: ['ops@example.com'],
  slack_channels: ['#reports'],
  format: 'pdf',
  filters: {},
  columns: [],
  enabled: true,
  last_run_at: null,
  last_run_status: null,
  last_run_error: null,
  next_run_at: null,
  run_count: 0,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

function goToStep(step: number) {
  for (let i = 1; i < step; i++) fireEvent.click(screen.getByRole('button', { name: 'Next' }))
}

describe('CreateScheduleModal -- Slack delivery unavailable', () => {
  it('shows the Slack option disabled and unchecked, with the reason', () => {
    render(<CreateScheduleModal open onClose={() => {}} onSubmit={async () => {}} />)
    goToStep(3)

    const reason = screen.getByText("Slack delivery isn't available yet")
    const slackBox = document.querySelector('[aria-describedby="slack-delivery-unavailable"]') as HTMLButtonElement
    expect(reason).toHaveAttribute('id', 'slack-delivery-unavailable')
    expect(slackBox).toBeDisabled()
    expect(slackBox).toHaveAttribute('data-state', 'unchecked')

    fireEvent.click(slackBox)
    expect(slackBox).toHaveAttribute('data-state', 'unchecked')
    expect(screen.queryByPlaceholderText('#reports, #alerts')).not.toBeInTheDocument()
  })

  it('an existing Slack-enabled schedule is saved without Slack delivery', async () => {
    const onSubmit = vi.fn<(data: CreateScheduleRequest) => Promise<void>>().mockResolvedValue(undefined)
    render(<CreateScheduleModal open isEditing initialData={slackSchedule} onClose={() => {}} onSubmit={onSubmit} />)

    goToStep(3)
    const slackBox = document.querySelector('[aria-describedby="slack-delivery-unavailable"]') as HTMLButtonElement
    expect(slackBox).toHaveAttribute('data-state', 'unchecked')

    goToStep(3)
    fireEvent.click(screen.getByRole('button', { name: 'Update Schedule' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      delivery_email: true,
      email_recipients: ['ops@example.com'],
      delivery_slack: false,
      slack_channels: [],
    })
  })

  it('email off leaves no delivery method, so the step cannot proceed', () => {
    render(<CreateScheduleModal open onClose={() => {}} onSubmit={async () => {}} />)
    goToStep(3)

    fireEvent.click(document.querySelector('[aria-describedby="slack-delivery-unavailable"]') as HTMLButtonElement)
    const checkboxes = screen.getAllByRole('checkbox')
    fireEvent.click(checkboxes[0])

    expect(screen.getByText('Please enable at least one delivery method')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  })
})
