#!/usr/bin/env bash
# Scratch server for real checks: serves this checkout with a throwaway copy of the
# main checkout's learner/, so the real learner/ and the user's 4810 are never touched.
# Usage: scripts/scratch-server.sh <port> [--slow-tutor]
#   --slow-tutor  CLAUDE_BIN is a fake that sleeps 120 s: busy, cancel and timeout
#                 states without a paid call.
# Prints the URL, PID and data dir. Stop with: kill <PID>
set -euo pipefail
port=${1:?usage: scripts/scratch-server.sh <port> [--slow-tutor]}
[ "$port" = 4810 ] && { echo "4810 is the user's server; pick another port" >&2; exit 1; }
root=$(cd "$(dirname "$0")/.." && pwd)
main=$(git -C "$root" worktree list --porcelain | sed -n '1s/^worktree //p')
dir=$(mktemp -d "${TMPDIR:-/tmp}/mindgap-scratch.XXXXXX")
cp -R "$main/learner" "$dir/learner"
vars=(PORT="$port" MINDGAP_DATA_DIR="$dir/learner")
if [ "${2:-}" = --slow-tutor ]; then
  # exec, not a child process: a wrapped sleep outlives the kill and holds the pipe,
  # so cancel looks hung (2026-10-28).
  printf '#!/bin/sh\nexec sleep 120\n' > "$dir/slow-tutor"
  chmod +x "$dir/slow-tutor"
  vars+=(MINDGAP_TUTOR=claude CLAUDE_BIN="$dir/slow-tutor")
fi
cd "$root"
env "${vars[@]}" nohup node server.mjs > "$dir/server.log" 2>&1 &
pid=$!
for _ in $(seq 50); do grep -q listening "$dir/server.log" && break; sleep 0.1; done
grep -q listening "$dir/server.log" || { cat "$dir/server.log" >&2; kill "$pid" 2>/dev/null; exit 1; }
echo "url  http://127.0.0.1:$port"
echo "pid  $pid"
echo "data $dir/learner"
