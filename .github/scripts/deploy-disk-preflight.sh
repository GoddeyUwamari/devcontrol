#!/usr/bin/env bash
#
# Refuses a deploy before anything is downloaded, extracted or deleted when
# the filesystem(s) it will write to are short on space. CI base64-encodes
# this exact file into every deploy's SSM command (backend, migration
# tooling, admin migration tooling) and runs it first; a non-zero exit
# aborts the remote command with the running release untouched.
#
# Usage: deploy-disk-preflight.sh <min_free_mib> <path> [<path>...]
#   Every path the deploy writes to (temporary tarballs AND the install
#   location) must be listed — nothing assumes /tmp is a separate
#   filesystem from /. A path that doesn't exist yet is checked via its
#   nearest existing ancestor (the filesystem it will be created on). Each
#   path's filesystem must independently have at least <min_free_mib> MiB
#   available to the deploying (non-root) user — conservative when paths
#   share a filesystem, never optimistic when they don't.
#
# Exit 0: every filesystem has enough space. Exit 1: at least one doesn't,
# or the arguments / df output were unusable (never treated as a pass).
set -euo pipefail

if [ "$#" -lt 2 ] || ! [[ "$1" =~ ^[0-9]+$ ]]; then
  echo "ERROR: usage: deploy-disk-preflight.sh <min_free_mib> <path> [<path>...]" >&2
  exit 1
fi

MIN_FREE_MIB="$1"
shift
FAILED=0

for target in "$@"; do
  probe="$target"
  while [ ! -e "$probe" ] && [ "$probe" != "/" ]; do
    probe="$(dirname "$probe")"
  done

  # POSIX df: one header line, then "fs 1024-blocks used available capacity mount".
  avail_kib="$(df -Pk "$probe" | awk 'NR == 2 { print $4 }')"
  mount_point="$(df -Pk "$probe" | awk 'NR == 2 { print $6 }')"
  if ! [[ "$avail_kib" =~ ^[0-9]+$ ]]; then
    echo "ERROR: could not determine free space for '$target' (df returned '${avail_kib}') — refusing to deploy." >&2
    FAILED=1
    continue
  fi

  avail_mib=$((avail_kib / 1024))
  if [ "$avail_mib" -lt "$MIN_FREE_MIB" ]; then
    echo "ERROR: insufficient disk space for '$target' (filesystem '$mount_point'): ${avail_mib} MiB free, ${MIN_FREE_MIB} MiB required. Nothing was downloaded, extracted or deleted; the running release is untouched." >&2
    FAILED=1
  else
    echo "Disk preflight OK for '$target' (filesystem '$mount_point'): ${avail_mib} MiB free, ${MIN_FREE_MIB} MiB required."
  fi
done

exit "$FAILED"
