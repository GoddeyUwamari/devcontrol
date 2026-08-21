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
#   - dest was a symlink pointing at a DIFFERENT, but independently verified
#     valid, release, and release_dir is also verified valid: the symlink is
#     advanced to release_dir via an atomic temp-symlink + `mv -T` swap
#     (Case F)
# Exit 1 (fails loudly; dest is never modified):
#   - dest is a symlink pointing somewhere else that does NOT qualify for
#     Case F — points outside the releases directory, its target is
#     missing, or either the current or new release fails the "valid
#     release" check (Case B2, wrong/unverifiable target)
#   - dest exists as a real directory (Case C)
#   - dest exists as any other unexpected object (Case D)
#   - the ln -s itself hits a genuine OS-level failure, either during the
#     original Case A create or during the Case F temporary-symlink step
#     (Case E) — its exit status and stderr propagate as-is, nothing here
#     recovers from it, and dest is left exactly as it was found
set -euo pipefail

RELEASE_DIR="$1"
DEST="${2:-/home/ubuntu/devcontrol/database}"

if [ ! -d "$RELEASE_DIR" ]; then
  echo "ERROR: release directory '$RELEASE_DIR' does not exist or is not a directory — refusing to symlink to it." >&2
  exit 1
fi

RESOLVED_RELEASE="$(readlink -f "$RELEASE_DIR")"
RELEASES_DIR="$(dirname "$RESOLVED_RELEASE")"

# A "valid release" is a directory living directly under RELEASES_DIR whose
# own basename exactly matches the content of its own .deployed_sha marker
# (the file CI writes inside the release directory before ever touching the
# symlink — see database/migrations/README.md's "Deployed-SHA marker"
# section). This is deliberately symmetric: Case F checks it against BOTH
# the already-live target and the newly prepared release, not just one side.
# A directory merely existing under RELEASES_DIR is not sufficient — it must
# prove its own identity via the marker.
is_valid_release() {
  local dir="$1"
  [ -d "$dir" ] || return 1
  [ "$(dirname "$dir")" = "$RELEASES_DIR" ] || return 1
  local marker="$dir/.deployed_sha"
  [ -f "$marker" ] || return 1
  local marker_content
  marker_content="$(cat "$marker" 2>/dev/null)"
  [ "$(basename "$dir")" = "$marker_content" ]
}

if [ -L "$DEST" ]; then
  CURRENT_TARGET="$(readlink "$DEST")"
  RESOLVED_CURRENT="$(readlink -f "$DEST")"

  if [ "$RESOLVED_CURRENT" = "$RESOLVED_RELEASE" ]; then
    echo "Case B: '$DEST' already symlinked to '$RELEASE_DIR' — idempotent, nothing to do."
    exit 0
  fi

  # Case F candidate: dest is a symlink pointing at a target other than
  # release_dir. Before falling through to the original unconditional
  # refusal (Case B2), determine whether this is a safe, auditable advance
  # between two independently verified known releases. Any single failure
  # here — missing target, target outside RELEASES_DIR, current release not
  # verifiable, new release not verifiable — disqualifies Case F and falls
  # straight through to Case B2, unchanged.
  ADVANCE_OK=1
  if [ ! -e "$RESOLVED_CURRENT" ]; then
    ADVANCE_OK=0
  elif [ "$(dirname "$RESOLVED_CURRENT")" != "$RELEASES_DIR" ]; then
    ADVANCE_OK=0
  elif ! is_valid_release "$RESOLVED_CURRENT"; then
    ADVANCE_OK=0
  elif ! is_valid_release "$RESOLVED_RELEASE"; then
    ADVANCE_OK=0
  fi

  if [ "$ADVANCE_OK" = "1" ]; then
    TMP_LINK="${DEST}.new.$$"
    rm -f "$TMP_LINK" 2>/dev/null || true
    if ! ln -s "$RELEASE_DIR" "$TMP_LINK"; then
      echo "ERROR: Case F failed — could not create temporary symlink '$TMP_LINK' -> '$RELEASE_DIR'." >&2
      echo "'$DEST' left completely untouched — still points at '$CURRENT_TARGET'." >&2
      rm -f "$TMP_LINK" 2>/dev/null || true
      exit 1
    fi
    mv -T "$TMP_LINK" "$DEST"
    echo "Case F: advanced '$DEST' from known release '$(basename "$RESOLVED_CURRENT")' to new release '$(basename "$RESOLVED_RELEASE")'."
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
