import { AlertTriangle } from 'lucide-react'

// The warning codes a discovery run reports (backend/src/services/discovery-warnings.ts).
export const DISCOVERY_WARNING_TRUNCATED_INDEX = 'deletion_detection_paused_truncated_index'

export const DELETION_DETECTION_PAUSED_TEXT =
  'Deletion detection is paused for some resource types: your inventory exceeds 1,000 indexed resources.'

export function hasDeletionDetectionPaused(warnings: readonly string[] | null | undefined): boolean {
  return warnings?.includes(DISCOVERY_WARNING_TRUNCATED_INDEX) ?? false
}

/** Shown wherever discovery status is shown, when the latest run reported the warning. */
export function DiscoveryWarningNotice({ warnings, className = '' }: { warnings: readonly string[] | null | undefined; className?: string }) {
  if (!hasDeletionDetectionPaused(warnings)) return null
  return (
    <div role="status" className={`flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-ui text-amber-800 ${className}`}>
      <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
      <span>{DELETION_DETECTION_PAUSED_TEXT}</span>
    </div>
  )
}
