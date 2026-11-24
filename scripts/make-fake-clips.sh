#!/usr/bin/env bash
# Make a fake TeslaCam folder for trying the app without real footage.
#
#   scripts/make-fake-clips.sh <output-folder> [seconds-per-clip]
#
# Writes <output-folder>/TeslaCam with Sentry, Saved and Recent clips,
# 4-camera and 6-camera (pillar) events, event.json and thumb.png, laid
# out and named the way the car does it. Each video shows its camera name
# and the seconds since the clip started, so you can see that the
# cameras play in step. Clips are short (default 20 s) and small.
# Needs ffmpeg.
set -euo pipefail

OUT="${1:?usage: $0 <output-folder> [seconds-per-clip]}"
SECS="${2:-20}"
ROOT="${OUT}/TeslaCam"

FOUR=(front back left_repeater right_repeater)
SIX=(front back left_repeater right_repeater left_pillar right_pillar)

# A bold font for the labels, if fontconfig can find one.
FONT=""
if command -v fc-match >/dev/null; then
  FONT="$(fc-match -f '%{file}' 'sans:bold' 2>/dev/null || true)"
fi

# Each camera gets its own pattern colour so they are easy to tell apart.
hue() {
  case "$1" in
    front) echo 0 ;; back) echo 180 ;;
    left_repeater) echo 60 ;; right_repeater) echo 120 ;;
    left_pillar) echo 240 ;; right_pillar) echo 300 ;;
    *) echo 30 ;;
  esac
}

# clip <file> <camera> <start label>
clip() {
  local file="$1" cam="$2" label="$3" vf
  vf="hue=h=$(hue "${cam}")"
  if [[ -n "${FONT}" ]]; then
    vf+=",drawtext=fontfile=${FONT}:fontcolor=white"
    vf+=":box=1:boxcolor=black@0.6:fontsize=22:x=(w-tw)/2:y=10"
    vf+=":text='${cam}  ${label}'"
    vf+=",drawtext=fontfile=${FONT}:fontcolor=white"
    vf+=":box=1:boxcolor=black@0.6:fontsize=40"
    vf+=":x=(w-tw)/2:y=h-th-20:text='+%{pts\\:hms}'"
  fi
  ffmpeg -hide_banner -loglevel error -y \
    -f lavfi -i "testsrc2=size=480x360:rate=24:duration=${SECS}" \
    -vf "${vf}" -c:v libx264 -preset veryfast -crf 32 \
    -pix_fmt yuv420p -movflags +faststart "${file}"
}

# stamp <epoch seconds> <date format> -> local time text
stamp() { date -d "@$1" +"$2"; }

# event <folder> <first clip epoch> <clip count> <reason|-> <cams...>
# The event happens 2/3 of the way into the first clip; the folder is
# named a little after it, like the car does.
event() {
  local dir="$1" start="$2" count="$3" reason="$4"
  shift 4
  local cams=("$@") i t name cam ev
  mkdir -p "${dir}"
  for ((i = 0; i < count; i++)); do
    t=$((start + i * SECS))
    name="$(stamp "${t}" '%Y-%m-%d_%H-%M-%S')"
    for cam in "${cams[@]}"; do
      clip "${dir}/${name}-${cam}.mp4" "${cam}" \
        "$(stamp "${t}" '%H:%M:%S')"
    done
  done
  [[ "${reason}" == "-" ]] && return 0
  ev=$((start + SECS * 2 / 3))
  cat > "${dir}/event.json" <<EOF
{"timestamp":"$(stamp "${ev}" '%Y-%m-%dT%H:%M:%S')",\
"city":"Testville","street":"1 Example Way",\
"est_lat":"37.4220","est_lon":"-122.0841",\
"reason":"${reason}","camera":"0"}
EOF
  ffmpeg -hide_banner -loglevel error -y \
    -ss "$((SECS * 2 / 3))" -i "${dir}/$(stamp "${start}" \
    '%Y-%m-%d_%H-%M-%S')-front.mp4" -frames:v 1 \
    -vf scale=240:-2 "${dir}/thumb.png"
}

# folder <first clip epoch> -> event folder name
folder() { stamp "$(($1 + SECS + 7))" '%Y-%m-%d_%H-%M-%S'; }

# Fixed days, so every run gives the same folders.
day() { date -d "$1" +%s; }
D1="$(day '2026-11-03 14:12:05')"
D2="$(day '2026-11-03 21:47:30')"
D3="$(day '2026-11-06 08:05:12')"
D4="$(day '2026-11-06 18:31:44')"
D5="$(day '2026-11-09 11:20:00')"
D6="$(day '2026-11-10 07:58:20')"

mkdir -p "${ROOT}"/{SentryClips,SavedClips,RecentClips}

S="${ROOT}/SentryClips"
event "${S}/$(folder "${D1}")" "${D1}" 2 \
  sentry_aware_object_detection "${FOUR[@]}"
event "${S}/$(folder "${D2}")" "${D2}" 2 \
  sentry_aware_accel_0.31 "${FOUR[@]}"
event "${S}/$(folder "${D4}")" "${D4}" 2 \
  sentry_aware_object_detection "${SIX[@]}"

V="${ROOT}/SavedClips"
event "${V}/$(folder "${D3}")" "${D3}" 2 user_interaction_honk "${SIX[@]}"
# An older-style event with no event.json or thumbnail.
event "${V}/$(folder "${D5}")" "${D5}" 1 - "${FOUR[@]}"

# Recent clips sit loose in RecentClips, one set per clip.
event "${ROOT}/RecentClips" "${D6}" 3 - "${FOUR[@]}"

echo "Fake clips written to ${ROOT}"
