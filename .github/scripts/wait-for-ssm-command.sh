#!/usr/bin/env bash
#
# Bounded polling for an AWS SSM RunCommand invocation to reach a terminal
# state — a replacement for `aws ssm wait command-executed`, whose default
# waiter ceiling (20 attempts x 5s = ~100s) is too short for a production
# backend deploy/rollback, which legitimately runs `npm install` on the host
# and can take several minutes. In run 33836015818 (deploy of commit
# 5c488d7b91554d36ea738413a7ab80d45c80b7c6), a real, successful ~3m15s
# deploy was reported as a FAILED deploy-backend job because the waiter gave
# up while the SSM command was still genuinely InProgress — not because
# anything had actually failed. That false failure skipped the smoke-test /
# record-success / rollback safety steps entirely.
#
# This script polls `aws ssm get-command-invocation` directly instead, so
# every genuinely non-terminal SSM status (Pending, InProgress, Delayed,
# Cancelling) is treated as "still running," never as a failure. Only a real
# terminal status (Success, Failed, Cancelled, TimedOut) — or exceeding the
# maximum wait time while still non-terminal — ends the loop. The logic
# tested locally (see backend/src/services/__tests__/wait-for-ssm-command.test.ts)
# is the exact logic that runs in CI: this script isn't reconstructed or
# duplicated inline in ci.yml.
#
# Usage: wait-for-ssm-command.sh <command-id> <instance-id>
#
# Env overrides (only used by tests; production relies on the defaults):
#   SSM_WAIT_MAX_SECONDS   Maximum total time to wait for a terminal status.
#                          Default 600 (10 minutes) — about 3x the ~3m15s
#                          worst-case observed deploy, enough headroom for
#                          normal npm-registry/network variance while still
#                          bounding a genuinely hung command, not waiting
#                          on it forever.
#   SSM_WAIT_POLL_SECONDS  Delay between polls. Default 15.
#
# On Success: prints the command's stdout, exits 0.
# On any other terminal status, or on exceeding SSM_WAIT_MAX_SECONDS while
# still non-terminal: prints stdout and stderr, exits 1 — the same
# stdout/stderr-then-exit-1 shape the calling step previously produced
# inline, so downstream step outcomes (smoke test being skipped, rollback's
# `if:` conditions, "Fail job on broken deploy") are unaffected by this
# change.
set -euo pipefail

COMMAND_ID="$1"
INSTANCE_ID="$2"

MAX_WAIT_SECONDS="${SSM_WAIT_MAX_SECONDS:-600}"
POLL_INTERVAL_SECONDS="${SSM_WAIT_POLL_SECONDS:-15}"

# SSM CommandInvocation statuses, per the API: Pending, InProgress, Delayed,
# Success, Cancelled, TimedOut, Failed, Cancelling. Only these four are
# terminal — everything else means "still running," including Cancelling
# (a cancellation is in flight but not yet finalized).
is_terminal() {
  case "$1" in
    Success|Failed|Cancelled|TimedOut) return 0 ;;
    *) return 1 ;;
  esac
}

elapsed=0
STATUS="Pending"

while true; do
  STATUS=$(aws ssm get-command-invocation \
    --command-id "$COMMAND_ID" --instance-id "$INSTANCE_ID" \
    --query "Status" --output text)

  if is_terminal "$STATUS"; then
    break
  fi

  if [ "$elapsed" -ge "$MAX_WAIT_SECONDS" ]; then
    echo "::error::SSM command $COMMAND_ID did not reach a terminal state within ${MAX_WAIT_SECONDS}s (last status: $STATUS) — treating as failed."
    STATUS="TimedOutWaiting"
    break
  fi

  echo "SSM command $COMMAND_ID status: $STATUS (elapsed ${elapsed}s/${MAX_WAIT_SECONDS}s) — polling again in ${POLL_INTERVAL_SECONDS}s..."
  sleep "$POLL_INTERVAL_SECONDS"
  elapsed=$((elapsed + POLL_INTERVAL_SECONDS))
done

echo "--- stdout ---"
aws ssm get-command-invocation \
  --command-id "$COMMAND_ID" --instance-id "$INSTANCE_ID" \
  --query "StandardOutputContent" --output text

if [ "$STATUS" != "Success" ]; then
  echo "--- stderr ---"
  aws ssm get-command-invocation \
    --command-id "$COMMAND_ID" --instance-id "$INSTANCE_ID" \
    --query "StandardErrorContent" --output text
  echo "SSM command finished with status: $STATUS"
  exit 1
fi
