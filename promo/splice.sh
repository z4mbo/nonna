#!/usr/bin/env bash
# Usage: ./splice.sh <screen-recording.(mov|mp4)> [output.mp4]
# Joins nonna-intro.mp4 + your recording + nonna-outro.mp4 into one 1920x1080 30fps H.264 MP4 for X.
# The recording is scaled/letterboxed to 1080p; if it has no audio track, silence is added.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
REC="${1:?usage: splice.sh <recording> [out.mp4]}"
OUT="${2:-nonna-x-promo.mp4}"
DUR="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$REC")"
if ffprobe -v error -select_streams a -show_entries stream=index -of csv=p=0 "$REC" | grep -q .; then
  ASRC="[1:a]"; EXTRA=()
else
  ASRC="[3:a]"; EXTRA=(-f lavfi -t "$DUR" -i anullsrc=r=48000:cl=stereo)
fi
ffmpeg -y -i "$DIR/nonna-intro.mp4" -i "$REC" -i "$DIR/nonna-outro.mp4" "${EXTRA[@]}" -filter_complex "\
[0:v]fps=30,setsar=1,format=yuv420p[v0];\
[1:v]fps=30,scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0xFAF3E4,setsar=1,format=yuv420p[v1];\
[2:v]fps=30,setsar=1,format=yuv420p[v2];\
[0:a]aresample=48000,aformat=channel_layouts=stereo[a0];\
${ASRC}aresample=48000,aformat=channel_layouts=stereo[a1];\
[2:a]aresample=48000,aformat=channel_layouts=stereo[a2];\
[v0][a0][v1][a1][v2][a2]concat=n=3:v=1:a=1[v][a]" \
  -map "[v]" -map "[a]" -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p \
  -c:a aac -b:a 192k -movflags +faststart "$OUT"
echo "Done: $OUT"
