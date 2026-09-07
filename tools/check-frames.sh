#!/bin/bash
# Re-run the golden-frame probe and byte-compare against tools/frames/.
# Requires: `npm run dev` on :9000 and headless Chrome on --remote-debugging-port=9222.
# See the header of tools/probe-frames.mjs for the exact commands.
set -u
root="$(cd "$(dirname "$0")/.." && pwd)"
out="$(mktemp -d)"
node "$root/tools/probe-frames.mjs" "$out" || exit 1
echo "--- frame comparison ---"
rc=0
for f in "$root"/tools/frames/*.png; do
  n="$(basename "$f")"
  if cmp -s "$f" "$out/$n"; then echo "  same  $n"; else echo "  DIFF  $n  ($out/$n)"; rc=1; fi
done
[ "$rc" = 0 ] && rm -rf "$out"
exit $rc
