#!/usr/bin/env bash
# record.sh <display> <file.mp4> [seconds]: a short screen recording.
set -euo pipefail
mkdir -p "$(dirname "$2")"
ffmpeg -loglevel error -y -f x11grab -framerate 12 -i "$1" -t "${3:-8}" -pix_fmt yuv420p "$2"; echo "$2"
