#!/usr/bin/env bash
# shot.sh <display> <file.png>: one screenshot of the whole display.
set -euo pipefail
mkdir -p "$(dirname "$2")"; ffmpeg -loglevel error -y -f x11grab -i "$1" -frames:v 1 "$2"; echo "$2"
