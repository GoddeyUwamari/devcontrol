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
# A second false failure, in run 38037952336: `GetCommandInvocation` called
# immediately after `SendCommand` can return InvocationDoesNotExist because
# the invocation hasn't been registered yet. The script exited on that
# first error, the deploy job failed, and the SSM command kept running on
# the host unobserved. That one error is now retried (bounded, with
# backoff) until the invocation appears; every other AWS CLI error, and any
# malformed or unrecognized status, still fails immediately.
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
#   SSM_WAIT_REGISTRATION_MAX_SECONDS
#                          How long InvocationDoesNotExist is tolerated
#                          before the invocation is first seen. Default 60.
#   SSM_WAIT_REGISTRATION_BACKOFF_SECONDS
#                          First retry delay for InvocationDoesNotExist,
#                          doubled each retry and capped at 15. Default 1.
#
# On Success: prints the command's stdout, exits 0.
# On any other terminal status, an unrecognized status, a non-retryable
# AWS CLI error, or exceeding either deadline: prints the command ID,
# instance ID, last status and (when retrievable) stdout and stderr, then
# exits 1. Downstream step semantics (smoke test skipped, rollback's `if:`
# conditions, "Fail job on broken deploy") key off that non-zero exit.
set -euo pipefail

COMMAND_ID="$1"
INSTANCE_ID="$2"

MAX_WAIT_SECONDS="${SSM_WAIT_MAX_SECONDS:-600}"
POLL_INTERVAL_SECONDS="${SSM_WAIT_POLL_SECONDS:-15}"
REGISTRATION_MAX_SECONDS="${SSM_WAIT_REGISTRATION_MAX_SECONDS:-60}"
REGISTRATION_BACKOFF_SECONDS="${SSM_WAIT_REGISTRATION_BACKOFF_SECONDS:-1}"
REGISTRATION_BACKOFF_CAP_SECONDS=15

ERR_FILE="$(mktemp)"
trap 'rm -f "$ERR_FILE"' EXIT

# Prints one field of the invocation; never fails the script (used for
# diagnostics, where a fetch error must not mask the real outcome).
print_field() {
  aws ssm get-command-invocation \
    --command-id "$COMMAND_ID" --instance-id "$INSTANCE_ID" \
    --query "$1" --output text 2>&1 || echo "(could not retrieve $1)"
}

fail_with_diagnostics() {
  echo "::error::$1"
  echo "SSM command ID: $COMMAND_ID"
  echo "Instance ID: $INSTANCE_ID"
  echo "Last status: $STATUS"
  echo "--- stdout ---"
  print_field "StandardOutputContent"
  echo "--- stderr ---"
  print_field "StandardErrorContent"
  echo "SSM command finished with status: $STATUS"
  exit 1
}

# SSM CommandInvocation statuses, per the API: Pending, InProgress, Delayed,
# Success, Cancelled, TimedOut, Failed, Cancelling. Only these four are
# terminal — Cancelling means a cancellation is in flight but not final.
is_terminal() {
  case "$1" in
    Success|Failed|Cancelled|TimedOut) return 0 ;;
    *) return 1 ;;
  esac
}

is_running() {
  case "$1" in
    Pending|InProgress|Delayed|Cancelling) return 0 ;;
    *) return 1 ;;
  esac
}

elapsed=0
STATUS="NotYetRegistered"
registration_start=$SECONDS
registration_backoff="$REGISTRATION_BACKOFF_SECONDS"
registered=0

while true; do
  if STATUS_OUT=$(aws ssm get-command-invocation \
      --command-id "$COMMAND_ID" --instance-id "$INSTANCE_ID" \
      --query "Status" --output text 2>"$ERR_FILE"); then
    registered=1
    STATUS="$STATUS_OUT"
  elif [ "$registered" = "0" ] && grep -q "(InvocationDoesNotExist)" "$ERR_FILE"; then
    waited=$((SECONDS - registration_start))
    if [ "$waited" -ge "$REGISTRATION_MAX_SECONDS" ]; then
      cat "$ERR_FILE" >&2
      fail_with_diagnostics "SSM invocation $COMMAND_ID on $INSTANCE_ID was still not registered (InvocationDoesNotExist) after ${waited}s (limit ${REGISTRATION_MAX_SECONDS}s) — treating as failed."
    fi
    echo "SSM invocation $COMMAND_ID not registered yet (InvocationDoesNotExist, ${waited}s/${REGISTRATION_MAX_SECONDS}s) — retrying in ${registration_backoff}s..."
    sleep "$registration_backoff"
    registration_backoff=$((registration_backoff * 2))
    if [ "$registration_backoff" -gt "$REGISTRATION_BACKOFF_CAP_SECONDS" ]; then
      registration_backoff="$REGISTRATION_BACKOFF_CAP_SECONDS"
    fi
    continue
  else
    cat "$ERR_FILE" >&2
    STATUS="AwsCliError"
    fail_with_diagnostics "aws ssm get-command-invocation failed for $COMMAND_ID with a non-retryable error (see stderr above)."
  fi

  if is_terminal "$STATUS"; then
    break
  fi

  if ! is_running "$STATUS"; then
    fail_with_diagnostics "SSM command $COMMAND_ID returned an unrecognized status '$STATUS' — treating as failed."
  fi

  if [ "$elapsed" -ge "$MAX_WAIT_SECONDS" ]; then
    fail_with_diagnostics "SSM command $COMMAND_ID did not reach a terminal state within ${MAX_WAIT_SECONDS}s (last status: $STATUS) — treating as failed. The command may still be running on the instance."
  fi

  echo "SSM command $COMMAND_ID status: $STATUS (elapsed ${elapsed}s/${MAX_WAIT_SECONDS}s) — polling again in ${POLL_INTERVAL_SECONDS}s..."
  sleep "$POLL_INTERVAL_SECONDS"
  elapsed=$((elapsed + POLL_INTERVAL_SECONDS))
done

if [ "$STATUS" != "Success" ]; then
  fail_with_diagnostics "SSM command $COMMAND_ID on $INSTANCE_ID finished with status: $STATUS"
fi

echo "--- stdout ---"
print_field "StandardOutputContent"
