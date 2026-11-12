import type { AWSService } from '@/lib/services/aws-services.service'

/**
 * How a resource's owner reads on the page (Q16/Q22/Q23):
 * - 'unowned': neither an Owner nor a Team tag;
 * - 'unknown': its tags could not be read, so the owner is unknown, not
 *   missing (never counted as Unowned);
 * - a Team tag without an Owner tag is owned by that team: "No Owner tag".
 */
export type OwnerDisplay =
  | { kind: 'unowned'; label: 'Unowned' }
  | { kind: 'unknown'; label: 'Unknown · tags unreadable' }
  | { kind: 'owner'; label: string; team: string | null }
  | { kind: 'team-only'; label: 'No Owner tag'; team: string }
  | { kind: 'none'; label: '—' }

export function ownerDisplay(row: Pick<AWSService, 'owner' | 'team' | 'ownership'>): OwnerDisplay {
  if (row.ownership === 'unknown') return { kind: 'unknown', label: 'Unknown · tags unreadable' }
  if (row.ownership === 'unowned') return { kind: 'unowned', label: 'Unowned' }
  if (row.owner) return { kind: 'owner', label: row.owner, team: row.team ?? null }
  if (row.team) return { kind: 'team-only', label: 'No Owner tag', team: row.team }
  // An older backend without the ownership field: nothing is claimed.
  return { kind: 'none', label: '—' }
}

/**
 * Owner values written by automation, not by a person: the GitHub webhook
 * registers services with 'github-actions@webhook'. Matched exactly (after
 * trimming), never by pattern; add an identity here only when it is known.
 */
export const AUTOMATION_OWNERS: readonly string[] = ['github-actions@webhook']

export const NO_OWNER_SET = 'No owner set'

/** True only for a value on AUTOMATION_OWNERS (exact, after trimming). */
export function isAutomationOwner(owner: string | null | undefined): boolean {
  return typeof owner === 'string' && AUTOMATION_OWNERS.includes(owner.trim())
}

/**
 * A registered service's Owner cell: the stored owner as it is, or null
 * ("No owner set") when it is blank or a known automation identity. Display
 * only: the stored owner is never changed.
 */
export function serviceOwnerLabel(owner: string | null | undefined): string | null {
  if (!owner?.trim() || isAutomationOwner(owner)) return null
  return owner
}
