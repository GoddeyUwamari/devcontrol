import { useSyncExternalStore } from 'react'

const subscribe = () => () => {}

/**
 * False in the server-rendered HTML and during hydration, true once React has
 * hydrated (and on every client-only render). Auth forms keep their submit
 * button disabled until then: a disabled default button also blocks Enter's
 * implicit submission, so a pre-hydration native submit cannot happen at all.
 *
 * useSyncExternalStore's server snapshot is used for hydration too, so the
 * markup matches and there is no hydration mismatch; React re-renders with
 * the client snapshot straight after.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, () => true, () => false)
}
