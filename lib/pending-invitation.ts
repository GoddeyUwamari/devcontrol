/**
 * An invitation the user opened but has not accepted yet, kept for this tab
 * only (sessionStorage) so it survives the sign-in or registration it needs
 * first: the link is cleaned out of the URL as soon as it is read, and the
 * token is never put into a return path or any other URL.
 *
 * Kept for at most as long as an invitation is valid (7 days); an older or
 * malformed entry is removed when read. Cleared when the invitation is
 * accepted, turns out to be already accepted or no longer usable, and on
 * logout.
 */

export const PENDING_INVITATION_KEY = "pendingInvitation";

/** Same lifetime as the invitation itself (backend: 7 days). */
export const PENDING_INVITATION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

interface PendingInvitation {
  token: string;
  savedAt: number;
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function savePendingInvitation(token: string, now: number = Date.now()): void {
  try {
    const entry: PendingInvitation = { token, savedAt: now };
    storage()?.setItem(PENDING_INVITATION_KEY, JSON.stringify(entry));
  } catch {
    // Storage full or blocked: the invitation still works in this page view.
  }
}

/** The pending invitation's token, or null (an expired or malformed entry is removed). */
export function readPendingInvitation(now: number = Date.now()): string | null {
  let raw: string | null = null;
  try {
    raw = storage()?.getItem(PENDING_INVITATION_KEY) ?? null;
  } catch {
    return null;
  }
  if (raw === null) return null;

  try {
    const entry = JSON.parse(raw) as Partial<PendingInvitation> | null;
    if (
      entry &&
      typeof entry.token === "string" &&
      entry.token.length > 0 &&
      typeof entry.savedAt === "number" &&
      entry.savedAt <= now &&
      now - entry.savedAt < PENDING_INVITATION_MAX_AGE_MS
    ) {
      return entry.token;
    }
  } catch {
    // Malformed: removed below.
  }
  clearPendingInvitation();
  return null;
}

export function hasPendingInvitation(now: number = Date.now()): boolean {
  return readPendingInvitation(now) !== null;
}

export function clearPendingInvitation(): void {
  try {
    storage()?.removeItem(PENDING_INVITATION_KEY);
  } catch {
    // Blocked storage holds nothing to clear.
  }
}
