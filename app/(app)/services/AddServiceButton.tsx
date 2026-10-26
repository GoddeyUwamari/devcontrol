'use client'

import { useId } from 'react'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { useCurrentRole } from '@/lib/hooks/use-current-role'

export const ADD_SERVICE_ADMIN_ONLY_TEXT = 'Only admins can add services'

/**
 * + Add Service (Q10): shown to everyone. Owners and admins get the link to
 * /services/new; members and viewers a disabled button with the reason; while
 * the role is not known yet (null on the first render) a disabled button with
 * no message, so it never offers an action it can't confirm. UI only: POST
 * /api/services enforces the role, and the form shows its 403.
 */
export function AddServiceButton({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const role = useCurrentRole()
  const reasonId = useId()
  const canAdd = role === 'owner' || role === 'admin'
  const sizeClass = size === 'sm' ? 'px-3 py-1.5 text-label' : 'px-3.5 py-2 text-label'
  const label = <><Plus size={13} aria-hidden="true" /> Add Service</>

  if (canAdd) {
    return (
      <Link href="/services/new" className={`inline-flex items-center gap-1.5 rounded-lg bg-violet-600 font-semibold text-white no-underline hover:bg-violet-700 ${sizeClass}`}>
        {label}
      </Link>
    )
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled
        aria-describedby={role !== null ? reasonId : undefined}
        className={`inline-flex items-center gap-1.5 rounded-lg bg-violet-600 font-semibold text-white opacity-50 cursor-not-allowed ${sizeClass}`}
      >
        {label}
      </button>
      {role !== null && <span id={reasonId} className="text-meta text-slate-600">{ADD_SERVICE_ADMIN_ONLY_TEXT}</span>}
    </span>
  )
}
