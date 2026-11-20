/**
 * Recording a deployment by hand (the "Record a deployment" form on the
 * Deployments page). DevControl never performs a deployment: a person records
 * one that has already happened, with the result they choose. Copy approved
 * in review-logs/deployments/d2-build.md §1.
 */

export type RecordedResult = 'success' | 'failed'

export const RECORD_RESULT_LABELS: Record<RecordedResult, string> = {
  success: 'Succeeded',
  failed: 'Failed',
}

/** The regions the form offers (the union of the old modal and /deployments/new lists). */
export const RECORD_REGIONS: { value: string; label: string }[] = [
  { value: 'us-east-1', label: 'us-east-1 (N. Virginia)' },
  { value: 'us-east-2', label: 'us-east-2 (Ohio)' },
  { value: 'us-west-1', label: 'us-west-1 (N. California)' },
  { value: 'us-west-2', label: 'us-west-2 (Oregon)' },
  { value: 'eu-west-1', label: 'eu-west-1 (Ireland)' },
  { value: 'eu-central-1', label: 'eu-central-1 (Frankfurt)' },
  { value: 'ap-southeast-1', label: 'ap-southeast-1 (Singapore)' },
  { value: 'ap-northeast-1', label: 'ap-northeast-1 (Tokyo)' },
]

export const RECORD_COPY = {
  title: 'Record a deployment',
  description: "Record a deployment that has already happened. DevControl keeps the record; it doesn't deploy anything.",
  serviceLabel: 'Service',
  servicePlaceholder: 'Choose a service',
  servicesLoading: 'Loading services…',
  servicesNone: 'No services are registered yet. An owner or admin can add one in Services & Ownership.',
  servicesFailed: 'Services could not be loaded. Close this and try again.',
  resultLabel: 'Result',
  resultHint: 'Choose whether the deployment succeeded or failed.',
  timeNote: 'Recorded with the current time.',
  submit: 'Record deployment',
  submitting: 'Recording…',
  cancel: 'Cancel',
  chooseService: 'Choose a service.',
  fallbackError: 'The deployment could not be recorded. Try again.',
  viewerError: "Viewers can't record deployments. Ask an owner, admin or member.",
} as const

/** The confirmation shown after a record is saved. */
export function recordedMessage(serviceName: string, environment: string, result: RecordedResult): string {
  return `Deployment recorded: ${serviceName} in ${environment} · ${RECORD_RESULT_LABELS[result]}`
}

/**
 * What the form shows when recording fails. The server's own message for a
 * 4xx (e.g. "Choose an existing service."), a fixed sentence for a viewer's
 * 403, and the fallback for everything else -- a network error, a 5xx, or a
 * 4xx with no message. axios's "Request failed with status code …" and any
 * server-error body are never shown.
 */
export function recordErrorMessage(err: unknown): string {
  const response = (err as { response?: { status?: unknown; data?: { error?: unknown } } } | null)?.response
  const status = typeof response?.status === 'number' ? response.status : null
  if (status === 403) return RECORD_COPY.viewerError
  const message = response?.data?.error
  if (status !== null && status >= 400 && status < 500 && typeof message === 'string' && message.trim()) {
    return message.trim()
  }
  return RECORD_COPY.fallbackError
}

/** Whether a deployment row was recorded by hand (POST /api/deployments), not by the pipeline. */
export function isManualRecord(deployment: { metadata?: Record<string, unknown> | null }): boolean {
  return deployment.metadata?.source === 'manual'
}
