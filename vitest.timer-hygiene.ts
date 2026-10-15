/**
 * Timer hygiene for the frontend suite (loaded by vitest.setup.ts).
 *
 * jsdom tests run on Node's own timers, and the environment deletes `document`
 * and `window` at teardown. A timer a test started and never cleared therefore
 * fires during a later test, or after the file has been torn down
 * ("ReferenceError: document is not defined"), and the failure is reported
 * against whichever test happens to be running.
 *
 * - Every real setTimeout/setInterval scheduled from app or test code while a
 *   test is running is remembered until it fires or is cleared;
 *   cancelLeftoverTimers() (run after each test, once the test and its own
 *   hooks have finished) clears the ones still pending and returns them, so
 *   the setup can log each one's creation site. Timers scheduled by library
 *   code -- node_modules (React's scheduler, TanStack Query, Testing Library)
 *   or Node's own internals (node:..., e.g. undici's refreshed fast timers,
 *   which a clear would kill for the rest of the worker) -- or outside a test
 *   (module scope, beforeAll) are left alone.
 * - A callback that throws is rethrown with the test that scheduled it and
 *   where, so the unhandled error points at its source. Nothing is swallowed.
 *
 * vi.useFakeTimers() replaces these wrappers wholesale while it is active, and
 * vi.useRealTimers() puts them back.
 */
import { expect } from 'vitest'
import { promisify } from 'node:util'

type Owner = { test: string; file: string | undefined; scheduledAt: string; site: string; tracked: boolean }
type Handle = Parameters<typeof clearTimeout>[0]

const ORIGINAL = Symbol.for('devcontrol.timerHygiene.original')
const STATE = Symbol.for('devcontrol.timerHygiene.state')

type Timers = {
  setTimeout: typeof setTimeout
  clearTimeout: typeof clearTimeout
  setInterval: typeof setInterval
  clearInterval: typeof clearInterval
}

// One state per worker: the setup file is evaluated once per test file, and
// must never wrap its own wrappers.
type Pending = { owner: Owner; clear: () => void }
const g = globalThis as typeof globalThis & { [STATE]?: { real: Timers; pending: Map<number, Pending> } }
const realOf = <T>(fn: T): T => ((fn as { [ORIGINAL]?: T })[ORIGINAL] ?? fn)
const state = (g[STATE] ??= {
  real: {
    setTimeout: realOf(globalThis.setTimeout),
    clearTimeout: realOf(globalThis.clearTimeout),
    setInterval: realOf(globalThis.setInterval),
    clearInterval: realOf(globalThis.clearInterval),
  },
  pending: new Map(),
})

/** The real timers, unaffected by the wrappers or by vi.useFakeTimers(). */
export const realTimers: Timers = state.real

const idOf = (handle: Handle): number => Number(handle)

// A caller frame in a dependency or in Node itself (node:internal/..., e.g.
// undici's fast timers behind fetch) is library code, not the test's.
const LIBRARY_FRAME = /\/node_modules\/|node:/

/** "path/to/file.ts:12" from a stack frame line, relative to the project root. */
function siteOf(frame: string): string {
  // Paths may contain parentheses (Next.js route groups such as app/(app)/...).
  const location = frame.match(/\((.+):(\d+):\d+\)\s*$/) ?? frame.match(/at (.+):(\d+):\d+\s*$/)
  if (!location) return frame.trim()
  const path = location[1].replace(/^file:\/\//, '')
  const root = process.cwd() + '/'
  return `${path.startsWith(root) ? path.slice(root.length) : path}:${location[2]}`
}

function ownerOfNewTimer(): Owner | null {
  const { currentTestName, testPath } = expect.getState()
  if (!currentTestName) return null
  const frames = (new Error().stack ?? '').split('\n').slice(1).filter((line) => !line.includes('vitest.timer-hygiene'))
  const caller = frames[0] ?? ''
  return {
    test: currentTestName,
    file: testPath,
    scheduledAt: frames.join('\n'),
    site: siteOf(caller),
    tracked: !LIBRARY_FRAME.test(caller),
  }
}

function withSource(error: unknown, owner: Owner | null): unknown {
  if (!owner || !(error instanceof Error)) return error
  const running = expect.getState().currentTestName === owner.test
  error.message +=
    `\n\n[timer hygiene] This timer was scheduled during the test "${owner.test}" (${owner.file ?? 'unknown file'})` +
    `${running ? '' : ', which had already finished'}. Scheduled at:\n${owner.scheduledAt}`
  return error
}

function wrapSet(real: typeof setTimeout | typeof setInterval, clear: (h: Handle) => void, repeats: boolean) {
  const wrapped = function (this: unknown, callback: unknown, ms?: number, ...args: unknown[]) {
    if (typeof callback !== 'function') return (real as (...a: unknown[]) => unknown)(callback, ms, ...args)
    const owner = ownerOfNewTimer()
    let id = NaN
    const run = function (this: unknown, ...callArgs: unknown[]) {
      if (!repeats) state.pending.delete(id)
      try {
        return callback.apply(this, callArgs)
      } catch (error) {
        throw withSource(error, owner)
      }
    }
    const handle = (real as (...a: unknown[]) => Handle)(run, ms, ...args)
    id = idOf(handle)
    if (owner?.tracked) state.pending.set(id, { owner, clear: () => clear(handle) })
    return handle
  }
  Object.defineProperty(wrapped, ORIGINAL, { value: real })
  const custom = (real as unknown as Record<symbol, unknown>)[promisify.custom]
  if (custom) Object.defineProperty(wrapped, promisify.custom, { value: custom })
  return wrapped as unknown as typeof real
}

function wrapClear(real: (h: Handle) => void) {
  const wrapped = function (handle: Handle) {
    if (handle != null) state.pending.delete(idOf(handle))
    return real(handle)
  }
  Object.defineProperty(wrapped, ORIGINAL, { value: real })
  return wrapped as typeof real
}

export function installTimerHygiene(): void {
  const { real } = state
  globalThis.setTimeout = wrapSet(real.setTimeout, real.clearTimeout, false) as typeof setTimeout
  globalThis.setInterval = wrapSet(real.setInterval, real.clearInterval, true) as typeof setInterval
  globalThis.clearTimeout = wrapClear(real.clearTimeout) as typeof clearTimeout
  globalThis.clearInterval = wrapClear(real.clearInterval) as typeof clearInterval
}

/** Real timers scheduled by app or test code during a test that have neither fired nor been cleared. */
export function pendingTimerCount(): number {
  return state.pending.size
}

/** Clears the pending app/test timers and returns who scheduled each one, where. */
export function cancelLeftoverTimers(): Array<{ test: string; file: string | undefined; site: string }> {
  const cancelled = [...state.pending.values()].map(({ owner, clear }) => {
    clear()
    return { test: owner.test, file: owner.file, site: owner.site }
  })
  state.pending.clear()
  return cancelled
}
