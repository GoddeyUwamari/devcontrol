import { useEffect, useState } from 'react';
import { tokenManager } from '@/lib/services/auth.service';

/**
 * The current user's organization role, read from the access token's own
 * JWT `role` claim (see tokenManager.getCurrentRole) -- UI-display-only.
 * Neither the login/register response's `user` object nor AuthContext's
 * Organization type currently carries this anywhere else, so this is the
 * only place in the frontend that can answer "what is my role in the
 * current org" without a backend change. Returns null on the server and
 * during the first client render (before the token can be read), then the
 * real role after mount -- callers should treat null as "unknown, not yet
 * determined" and fail closed (hide the control) rather than assume it
 * means "not an admin."
 *
 * This is UI convenience only. The backend's own JWT verification (e.g.
 * StripeController.requireBillingAdmin) is the actual security boundary
 * for every action this hook is used to gate -- hiding a control here
 * never substitutes for that check.
 */
export function useCurrentRole(): string | null {
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    setRole(tokenManager.getCurrentRole());
  }, []);

  return role;
}

/** True once we've confirmed the current user is an org owner or admin. */
export function useIsBillingAdmin(): boolean {
  const role = useCurrentRole();
  return role === 'owner' || role === 'admin';
}
