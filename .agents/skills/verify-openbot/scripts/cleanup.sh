#!/usr/bin/env bash
# cleanup.sh <name>: stops what launch.sh started for <name> and removes its scratch folder. Evidence stays.
set -uo pipefail
dir="/tmp/verify-openbot/${1:?name}"
[ -f "$dir/pids" ] || { echo "nothing to clean for $1"; exit 0; }
while read -r kind pid; do
  if [ "$kind" = dev ]; then kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null; else kill "$pid" 2>/dev/null; fi
done < "$dir/pids"
sleep 3; rm -rf "$dir"; echo "cleaned $1"
