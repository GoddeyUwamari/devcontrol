/**
 * Recording a deployment by hand (POST /api/deployments).
 *
 * DevControl never performs a deployment. A person records one that has
 * already happened: which service, which environment, and whether it
 * succeeded or failed. The server decides who recorded it (the signed-in
 * user) and when (now); the body can't set either.
 */

/** The results a person can record. 'deploying' is never accepted from a caller. */
export const RECORDED_RESULTS = ['success', 'failed'] as const;
export type RecordedResult = (typeof RECORDED_RESULTS)[number];

/** metadata.source on every row created through POST /api/deployments. The GitHub webhook writes 'github_actions'. */
export const MANUAL_RECORD_SOURCE = 'manual';

// Client-facing messages. They name nothing internal and never say whether a
// service exists in another organization.
export const RECORD_MESSAGES = {
  chooseService: 'Choose a service.',
  chooseExistingService: 'Choose an existing service.',
  invalidStatus: "Invalid status: use 'success' or 'failed'.",
  notRecorded: 'The deployment could not be recorded.',
} as const;
