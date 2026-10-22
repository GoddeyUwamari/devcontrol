'use client'

import { useEffect, useState } from 'react'

/** Milliseconds from `now` until one second after the next local midnight. */
export function msUntilNextLocalMidnight(now: number): number {
  const next = new Date(now)
  next.setHours(24, 0, 0, 0)
  return Math.max(1000, next.getTime() - now + 1000)
}

/**
 * Date.now(), read again just after each local midnight while `enabled`, so
 * "today" / "yesterday" (formatWhen) stay right in a tab left open overnight.
 * Those labels change only at midnight, so one timer per day is enough. No
 * request is made.
 */
export function useNowEachLocalDay(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!enabled) return
    let timer: ReturnType<typeof setTimeout>
    const schedule = () => {
      timer = setTimeout(() => { setNow(Date.now()); schedule() }, msUntilNextLocalMidnight(Date.now()))
    }
    schedule()
    return () => clearTimeout(timer)
  }, [enabled])
  return now
}
