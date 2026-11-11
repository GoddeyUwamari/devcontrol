import { Request, Response, NextFunction, RequestHandler } from 'express'
import { pool } from '../config/database'

/**
 * A listed feature whose table does not exist yet answers
 * 501 FEATURE_NOT_AVAILABLE instead of a 500 from the failing query.
 *
 * The API keys and webhook endpoint tables are not created by the canonical
 * migrations and are absent in production, so every /api/keys and
 * /api/webhooks request failed there. The frontend shows both as
 * "Coming soon" (lib/features/coming-soon.ts) and makes no request; this
 * covers anything else that calls the routes. Nothing turns it on: the routes
 * start working on their own once a migration creates the table.
 *
 * Mount it AFTER authentication and after any role check, so an
 * unauthenticated caller still gets 401 and a disallowed role still gets 403.
 * A route that validates its input first (POST /api/webhooks checks the
 * destination) calls featureTablePresent() itself after that check, so a bad
 * destination is still refused with 400 whether or not the table exists.
 * A table that exists is remembered for the life of the process; a missing
 * one is probed again at most every RECHECK_MS. If the probe itself fails
 * (database unavailable), the request goes on to its handler, as before.
 */
/** A table name in the public schema, e.g. the api_keys table. */
export type FeatureTable = string

export const FEATURE_NOT_AVAILABLE = 'FEATURE_NOT_AVAILABLE'
export const RECHECK_MS = 60_000

type Probe = { present: boolean; checkedAt: number }
const probes = new Map<FeatureTable, Probe>()

/** Test hook: forget every cached probe. */
export function resetFeatureTableCache(): void {
  probes.clear()
}

async function tableExists(table: FeatureTable, now: number): Promise<boolean> {
  const cached = probes.get(table)
  if (cached && (cached.present || now - cached.checkedAt < RECHECK_MS)) return cached.present
  const { rows } = await pool.query<{ t: string | null }>('SELECT to_regclass($1) AS t', [`public.${table}`])
  const present = rows[0]?.t != null
  probes.set(table, { present, checkedAt: now })
  return present
}

/**
 * Whether the table exists: true or false, or null when the probe itself
 * failed (the caller then goes on as it did before this check existed).
 */
export async function featureTablePresent(table: FeatureTable): Promise<boolean | null> {
  try {
    return await tableExists(table, Date.now())
  } catch {
    return null
  }
}

/** The 501 answer for a feature whose table does not exist yet. */
export function sendFeatureNotAvailable(res: Response, message: string): void {
  res.status(501).json({ success: false, code: FEATURE_NOT_AVAILABLE, message })
}

export function requireFeatureTable(table: FeatureTable, message: string): RequestHandler {
  return async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    if ((await featureTablePresent(table)) === false) {
      sendFeatureNotAvailable(res, message)
      return
    }
    next()
  }
}
