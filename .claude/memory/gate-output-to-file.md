---
name: gate-output-to-file
description: Run `npm test -- --frames` into a scratchpad file, never through `| tail`: the frames result scrolls away and the exit code is tail's
metadata:
  type: feedback
---

`npm test -- --frames 2>&1 | tail -15` loses the gate's evidence: the frames' and the
other tools' lines scroll out of the tail, and the exit code shown is `tail`'s (0 even
with a tool failed). Redirect the whole output to a file in the scratchpad, then grep it
for `FAIL`, `DIFF` and the closing `N/M passed` line.

**Why:** a cut-off run left the frames' result unknown and cost a second ~4-minute
`check-frames.sh` run to establish it.

**How to apply:** `npm test -- --frames > "$SCRATCH/gate.log" 2>&1; echo exit $?`, run in
the background (the gate passes 400 s on WSL), then grep the log. A known failure on this
checkout is [[wsl-known-failures]]; fresh ports are [[frames-on-fresh-ports]].
