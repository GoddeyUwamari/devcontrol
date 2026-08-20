#!/usr/bin/env bash
#
# Decides how to point /home/ubuntu/devcontrol/database at a freshly
# extracted migration-tooling release, without ever blindly overwriting an
# unknown destination state. CI ships this exact file to the host and runs
# it — the logic tested locally is the logic that executes in production,
# with no re-parsing through any other shell's quoting in between.
#
# Usage: deploy-migration-symlink.sh <release_dir> [dest]
#   release_dir  Absolute path to the extracted release directory. Must
#                already exist.
#   dest         Path to manage. Defaults to the real production path;
#                overridable only so tests can point it at a disposable dir.
#
# Exit 0:
#   - dest did not exist: created as a symlink to release_dir (Case A)
#   - dest was already a symlink pointing at release_dir (Case B, idempotent)
# Exit 1 (fails loudly; dest is never modified):
#   - dest is a symlink pointing somewhere else (Case B2, wrong target)
#   - dest exists as a real directory (Case C)
#   - dest exists as any other unexpected object (Case D)
#   - the ln -s itself hits a genuine OS-level failure (Case E) — its exit
#     status and stderr propagate as-is, nothing here recovers from it
set -euo pipefail

RELEASE_DIR="$1"
DEST="${2:-/home/ubuntu/devcontrol/database}"

if [ ! -d "$RELEASE_DIR" ]; then
  echo "ERROR: release directory '$RELEASE_DIR' does not exist or is not a directory — refusing to symlink to it." >&2
  exit 1
fi

if [ -L "$DEST" ]; then
  CURRENT_TARGET="$(readlink "$DEST")"
  RESOLVED_CURRENT="$(readlink -f "$DEST")"
  RESOLVED_RELEASE="$(readlink -f "$RELEASE_DIR")"
  if [ "$RESOLVED_CURRENT" = "$RESOLVED_RELEASE" ]; then
    echo "Case B: '$DEST' already symlinked to '$RELEASE_DIR' — idempotent, nothing to do."
    exit 0
  fi
  echo "ERROR: '$DEST' is a symlink pointing to '$CURRENT_TARGET', not '$RELEASE_DIR'." >&2
  echo "Refusing to overwrite an existing symlink pointing elsewhere — a human must investigate." >&2
  exit 1
fi

if [ -d "$DEST" ]; then
  echo "ERROR: '$DEST' already exists as a REAL DIRECTORY, not a symlink." >&2
  echo "Automatic replacement is intentionally refused — a human must explicitly remediate the legacy directory before this deploy can proceed safely." >&2
  exit 1
fi

if [ -e "$DEST" ]; then
  echo "ERROR: '$DEST' exists as an unexpected filesystem object (neither a symlink nor a directory)." >&2
  echo "Refusing to replace it automatically — a human must investigate." >&2
  exit 1
fi

ln -s "$RELEASE_DIR" "$DEST"
echo "Case A: created symlink '$DEST' -> '$RELEASE_DIR'."
