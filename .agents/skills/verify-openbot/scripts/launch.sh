#!/usr/bin/env bash
# launch.sh <name> [display] [cdp-port]: starts this checkout's dev app on its own display, HOME and profile.
set -euo pipefail
name="${1:?name}"; display="${2:-:41}"; port="${3:-9441}"
dir="/tmp/verify-openbot/$name"; mkdir -p "$dir/home" /tmp/verify-openbot/evidence; : > "$dir/pids"
if ! xdpyinfo -display "$display" >/dev/null 2>&1; then
  Xvfb "$display" -screen 0 1920x1200x24 -nolisten tcp >/dev/null 2>&1 & echo "xvfb $!" >> "$dir/pids"; sleep 1
fi
HOME="$dir/home" DISPLAY="$display" OPENBOT_DEV_INSTANCE_ID="$name" OPENBOT_DEV_REMOTE_DEBUGGING_PORT="$port" \
  OPENBOT_DEV_TEST_CLIENT_ENABLED=0 setsid bun run dev > "$dir/dev.log" 2>&1 & echo "dev $!" >> "$dir/pids"
for _ in $(seq 1 80); do
  sleep 3
  if node "$(dirname "$0")/drive.mjs" "$port" doctor >/dev/null 2>&1; then echo "ready on $display, CDP $port"; exit 0; fi
done
echo "not ready; see $dir/dev.log" >&2; exit 1
