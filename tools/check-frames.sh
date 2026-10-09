#!/bin/bash
# Re-run the golden-frame probe and compare against tools/frames/.
#
# The frames are the 320x200 screen as CSBWin draws it: its palette slots, and the
# palettes they were shown through. The comparison decodes both sides and compares what
# each pixel showed. Neither end depends on the host's fonts, widget theme, window size,
# GPU or PNG encoder, so a baseline captured on one machine is checkable on another, nor
# on how an Atari colour is shown on the canvas. See the header of tools/probe-frames.mjs.
#
# This used to require two daemons started by hand — `npm run dev` on :9000 and a
# headless Chrome on :9222 — which meant it was never actually run before a commit.
# It now starts whatever is missing, in a throwaway Chrome profile, and stops again
# on the way out. An already-running dev server or Chrome is reused, not restarted.
#
#   bash tools/check-frames.sh            # compare against the committed baseline
#   bash tools/check-frames.sh --update   # accept the current rendering as the baseline
#   bash tools/check-frames.sh --url http://localhost:8088/
#                                         # compare a page served elsewhere: the image's
#                                         # (Dockerfile), built with CSBWEB_PROBE=1
set -u
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root" || exit 1

update=0
url=""
while [ $# -gt 0 ]; do
  case "$1" in
    --update) update=1 ;;
    --url) url="${2:-}"; shift ;;
    *) echo "unknown argument: $1" >&2; exit 1 ;;
  esac
  shift
done

# Overridable so a run can sit beside a dev server you already have open.
DEV_PORT="${DEV_PORT:-9000}"
CDP_PORT="${CDP_PORT:-9222}"
export CDP_PORT
export DEV_PORT

started_dev=0
started_chrome=0
dev_pid=""
chrome_pid=""
chrome_profile=""
dev_log="$(mktemp)"

cleanup() {
  if [ "$started_chrome" = 1 ] && [ -n "$chrome_pid" ]; then
    kill "$chrome_pid" 2>/dev/null
    wait "$chrome_pid" 2>/dev/null   # let it finish writing its profile before we delete it
  fi
  if [ "$started_dev" = 1 ] && [ -n "$dev_pid" ]; then
    # npm spawns vite as a child; kill the group so the server does not survive us.
    kill -- "-$dev_pid" 2>/dev/null || kill "$dev_pid" 2>/dev/null
  fi
  [ -n "$chrome_profile" ] && rm -rf "$chrome_profile" 2>/dev/null
  rm -f "$dev_log"
}
trap cleanup EXIT

listening() { curl -sf -o /dev/null --max-time 1 "$1"; }

wait_for() { # url, seconds, what
  local i=0
  while [ "$i" -lt "$(( $2 * 10 ))" ]; do
    listening "$1" && return 0
    sleep 0.1
    i=$((i + 1))
  done
  echo "  timed out waiting for $3 at $1" >&2
  return 1
}

# --- the dev server -----------------------------------------------------------------
if [ -n "$url" ]; then
  # The page is the one given, which must hand the probe `window.__probe`; no dev server.
  url="${url%/}/"
  listening "$url" || { echo "nothing answers at $url" >&2; exit 1; }
  echo "using the page at $url"
  export APP_URL="$url"
elif listening "http://127.0.0.1:$DEV_PORT/"; then
  echo "using the dev server already on :$DEV_PORT"
else
  echo "starting the dev server on :$DEV_PORT"
  setsid npm run dev -- --port "$DEV_PORT" --strictPort >"$dev_log" 2>&1 &
  dev_pid=$!
  started_dev=1
  wait_for "http://127.0.0.1:$DEV_PORT/" 30 "the dev server" || { sed -n '1,20p' "$dev_log" >&2; exit 1; }
fi

# --- headless Chrome ----------------------------------------------------------------
if listening "http://127.0.0.1:$CDP_PORT/json/version"; then
  echo "using the Chrome already on :$CDP_PORT"
else
  chrome=""
  for c in google-chrome google-chrome-stable chromium chromium-browser; do
    command -v "$c" >/dev/null 2>&1 && { chrome="$c"; break; }
  done
  if [ -z "$chrome" ]; then
    echo "SKIPPED: no Chrome found (tried google-chrome, chromium). The frame check needs one." >&2
    exit 2
  fi
  echo "starting $chrome headless on :$CDP_PORT"
  # A throwaway profile: never touch the user's own Chrome data.
  chrome_profile="$(mktemp -d)"
  "$chrome" --headless=new --remote-debugging-port="$CDP_PORT" \
    --user-data-dir="$chrome_profile" --no-first-run --no-default-browser-check \
    --window-size=1600,1000 \
    "${url:-http://localhost:$DEV_PORT/}" >/dev/null 2>&1 &
  chrome_pid=$!
  started_chrome=1
  wait_for "http://127.0.0.1:$CDP_PORT/json/version" 30 "Chrome" || exit 1
fi

# --- probe and compare ---------------------------------------------------------------
# The probe speaks CDP over the global WebSocket, which Node 22 has by default and
# Node 20-21 only behind a flag.
if node -e 'process.exit(typeof WebSocket === "undefined" ? 0 : 1)'; then
  export NODE_OPTIONS="${NODE_OPTIONS:-} --experimental-websocket"
fi
if [ "$update" = 1 ]; then
  node "$root/tools/probe-frames.mjs" "$root/tools/frames" || exit 1
  echo '--- baseline updated; review with: git diff --stat tools/frames ---'
  exit 0
fi

out="$(mktemp -d)"
node "$root/tools/probe-frames.mjs" "$out" || { rm -rf "$out"; exit 1; }
echo "--- frame comparison ---"
# What the pixels showed, not bytes: `cmp` here used to make this a test of Chrome's PNG
# encoder, which is why the same rendering on another machine failed on every frame.
node "$root/tools/compare-frames.mjs" "$root/tools/frames" "$out"
rc=$?
[ "$rc" = 0 ] && rm -rf "$out"
exit $rc
