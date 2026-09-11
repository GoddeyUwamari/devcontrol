/**
 * Read-only classifier for the weekly-email cron job's execution lifecycle,
 * driven entirely by the structured log markers WeeklyAISummaryJob emits
 * (see weekly-ai-summary.job.ts's sendWeeklySummaries): a single-line
 * "[Weekly AI Summary] START {...json...}" at the top of a batch run, a
 * matching "COMPLETE {...json...}" at the end, and an "ERROR {...json...}"
 * if the batch itself throws before completing.
 *
 * This module does not fetch logs, does not touch the database, AWS, or
 * production in any way, and does not trigger the job. It only classifies
 * log text handed to it. Fetching the relevant excerpt (e.g. via a
 * read-only `aws ssm send-command` grep against the production PM2 log) is
 * the caller's responsibility -- see backend/scripts/check-weekly-email-run.js
 * for the accompanying CLI and the read-only fetch command it documents.
 *
 * Callers are responsible for passing only the log excerpt relevant to the
 * run being checked (e.g. everything logged since the last deploy). This
 * function does not itself disambiguate between multiple runs recorded
 * across process restarts in a long-lived log file -- it evaluates the
 * *last* START/COMPLETE/ERROR marker of each kind found in the text given
 * to it.
 */

export type WeeklyEmailRunStatus =
  | 'NOT_STARTED'
  | 'STARTED_NOT_COMPLETED'
  | 'COMPLETED_SUCCESSFULLY'
  | 'COMPLETED_WITH_ERRORS'
  | 'WRONG_RELEASE'
  | 'INSUFFICIENT_EVIDENCE';

export interface WeeklyEmailStartMarker {
  timestamp: string;
  releaseSha?: string;
}

export interface WeeklyEmailCompleteMarker {
  timestamp: string;
  durationMs?: number;
  organizations?: number;
  sent?: number;
  errors?: number;
  releaseSha?: string;
}

export interface WeeklyEmailErrorMarker {
  timestamp: string;
  message?: string;
  releaseSha?: string;
}

export interface WeeklyEmailRunEvidence {
  start?: WeeklyEmailStartMarker;
  complete?: WeeklyEmailCompleteMarker;
  error?: WeeklyEmailErrorMarker;
  /** Marker lines that matched the "[Weekly AI Summary] START|COMPLETE|ERROR" prefix but whose JSON payload could not be parsed. */
  unparseableMarkerCount: number;
}

export interface WeeklyEmailMonitorResult {
  status: WeeklyEmailRunStatus;
  reason: string;
  evidence: WeeklyEmailRunEvidence;
}

const MARKER_LINE = /\[Weekly AI Summary\]\s+(START|COMPLETE|ERROR)\s+(\{.*\})\s*$/;

function parseMarkers(logText: string): {
  start?: WeeklyEmailStartMarker;
  complete?: WeeklyEmailCompleteMarker;
  error?: WeeklyEmailErrorMarker;
  unparseableMarkerCount: number;
} {
  let start: WeeklyEmailStartMarker | undefined;
  let complete: WeeklyEmailCompleteMarker | undefined;
  let error: WeeklyEmailErrorMarker | undefined;
  let unparseableMarkerCount = 0;

  for (const line of logText.split('\n')) {
    const match = MARKER_LINE.exec(line.trim());
    if (!match) continue;

    const [, kind, jsonPayload] = match;
    try {
      const payload = JSON.parse(jsonPayload);
      if (kind === 'START') start = payload;
      else if (kind === 'COMPLETE') complete = payload;
      else if (kind === 'ERROR') error = payload;
    } catch {
      unparseableMarkerCount++;
    }
  }

  return { start, complete, error, unparseableMarkerCount };
}

/**
 * Classify a weekly-email cron run from a log excerpt.
 *
 * @param logText Raw log text (any surrounding, unrelated log lines are
 *   ignored -- only lines matching the structured marker format are read).
 * @param expectedReleaseSha The production release the run is expected to
 *   have executed under (e.g. the deployed backend/src/version.ts RELEASE_SHA).
 */
export function evaluateWeeklyEmailRun(
  logText: string,
  expectedReleaseSha: string
): WeeklyEmailMonitorResult {
  const { start, complete, error, unparseableMarkerCount } = parseMarkers(logText);
  const evidence: WeeklyEmailRunEvidence = { start, complete, error, unparseableMarkerCount };

  if (!start && !complete && !error) {
    if (unparseableMarkerCount > 0) {
      return {
        status: 'INSUFFICIENT_EVIDENCE',
        reason: `Found ${unparseableMarkerCount} weekly-email marker line(s) whose payload could not be parsed, and no other usable marker.`,
        evidence,
      };
    }
    return {
      status: 'NOT_STARTED',
      reason: 'No [Weekly AI Summary] START, COMPLETE, or ERROR marker found in the provided log excerpt.',
      evidence,
    };
  }

  // COMPLETE is the strongest evidence available -- it supersedes a START
  // (and any ERROR) recorded earlier in the same run.
  if (complete) {
    if (complete.releaseSha && complete.releaseSha !== expectedReleaseSha) {
      return {
        status: 'WRONG_RELEASE',
        reason: `Run completed under release ${complete.releaseSha}, expected ${expectedReleaseSha}.`,
        evidence,
      };
    }
    if (typeof complete.errors === 'number' && complete.errors > 0) {
      return {
        status: 'COMPLETED_WITH_ERRORS',
        reason: `Run completed with ${complete.errors} error(s) out of ${complete.organizations ?? 'an unknown number of'} organization(s).`,
        evidence,
      };
    }
    return {
      status: 'COMPLETED_SUCCESSFULLY',
      reason: `Run completed successfully: ${complete.sent ?? 'an unknown number of'} sent, 0 errors, ${complete.organizations ?? 'an unknown number of'} organization(s) processed.`,
      evidence,
    };
  }

  if (start) {
    if (start.releaseSha && start.releaseSha !== expectedReleaseSha) {
      return {
        status: 'WRONG_RELEASE',
        reason: `Run started under release ${start.releaseSha}, expected ${expectedReleaseSha}.`,
        evidence,
      };
    }
    return {
      status: 'STARTED_NOT_COMPLETED',
      reason: error
        ? `Run started but never logged COMPLETE; an ERROR marker was also found (${error.message ?? 'no message'}).`
        : 'Run started but no matching COMPLETE marker was found in the provided log excerpt.',
      evidence,
    };
  }

  // ERROR marker present with neither START nor COMPLETE: an unusual/
  // incomplete evidence shape -- don't guess at what happened. (`error` is
  // guaranteed defined here: the only way to reach this point is having
  // failed the `!start && !complete && !error` check above while also having
  // neither `complete` nor `start` -- i.e. `error` must be the one truthy value.)
  if (!error) {
    return {
      status: 'INSUFFICIENT_EVIDENCE',
      reason: 'No usable START, COMPLETE, or ERROR marker could be established from the provided log excerpt.',
      evidence,
    };
  }
  if (error.releaseSha && error.releaseSha !== expectedReleaseSha) {
    return {
      status: 'WRONG_RELEASE',
      reason: `An ERROR marker was found under release ${error.releaseSha}, expected ${expectedReleaseSha}, with no START or COMPLETE marker.`,
      evidence,
    };
  }
  return {
    status: 'INSUFFICIENT_EVIDENCE',
    reason: 'An ERROR marker was found with no matching START or COMPLETE marker -- cannot establish whether the run genuinely started.',
    evidence,
  };
}
