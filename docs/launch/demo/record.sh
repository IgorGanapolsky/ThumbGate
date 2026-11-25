#!/usr/bin/env bash
# Record the scripted session to a cast, render it to frames with agg, encode MP4 with ffmpeg.
set -eu
DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="$DIR/.."
asciinema rec --overwrite --cols 100 --rows 32 --command "bash $DIR/demo.sh" "$OUT/thumbgate-demo.cast"
agg --font-size 20 --theme dracula --fps-cap 20 "$OUT/thumbgate-demo.cast" "$OUT/thumbgate-demo.gif"
~/.local/bin/ffmpeg -y -i "$OUT/thumbgate-demo.gif" -movflags +faststart -pix_fmt yuv420p \
  -vf "scale=1280:720:force_original_aspect_ratio=decrease:flags=lanczos,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=0x282a36" \
  -r 20 "$OUT/thumbgate-demo.mp4"
