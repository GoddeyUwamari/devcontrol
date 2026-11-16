/**
 * Server-log safety for a multi-region scan's region runs (PR 1b, review L-3).
 *
 * The A7 line a region writes is clean, but helpers it calls (shared with the scan
 * without the flag) logged raw AWS error text and resource names: an SCP refusal's
 * message carries the assumed-role ARN with the account ID; a DynamoDB table, a Lambda
 * function or an ARN is a customer resource name. With the flag on these run once per
 * region.
 *
 * Inside a region run (inRegionLogContext, set by the region worker only) those helpers
 * log the error's name and no resource name. Outside one, including every path of a
 * scan without the flag, they log exactly what they always did.
 */
import { AsyncLocalStorage } from 'async_hooks';

const regionRun = new AsyncLocalStorage<string>();

/** Runs `fn` as part of `region`'s run: helpers it calls log safely. */
export function inRegionLogContext<T>(region: string, fn: () => T): T {
  return regionRun.run(region, fn);
}

/** Whether the caller runs inside a region run of a multi-region scan. */
export function inRegionRun(): boolean {
  return regionRun.getStore() !== undefined;
}

/** An error's name for a log line (never its message). */
export function errorNameOf(error: unknown): string {
  const e = error as { name?: unknown } | null | undefined;
  return typeof e?.name === 'string' && e.name ? e.name : 'Error';
}

/**
 * What a log line says: `outside` (the line's original text, unchanged) or, inside a
 * region run, `inside` (text with no AWS message and no resource name).
 */
export function regionSafe<T>(outside: T, inside: string): T | string {
  return inRegionRun() ? inside : outside;
}
