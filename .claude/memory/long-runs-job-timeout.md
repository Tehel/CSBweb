---
name: long-runs-job-timeout
description: npm test's 16 workers slow a tool ~3x; run-checks kills a job at 300 s, so a CSBWin run past ~100 s alone gets its own csbwin-runs.ts job
metadata:
  type: project
---

`tools/run-checks.ts` fails any job past `JOB_TIMEOUT_MS` (300 s). Under the full `npm test` (16 workers) a tool takes about three times its time alone: `csbwin-runs.ts` with the 2 h 25 CSB run took 96 s alone and timed out in the gate. It is now two jobs, `{ tool: 'csbwin-runs.ts', args: ['CSBFullRecordingV4'] }` and `args: ['--not=CSBFullRecordingV4']` (the check takes a run id or `--not=<id>`; the runner names a job by its tool and arguments, and `--only=<tool> <args>` collapses a tool's jobs into one).

**Why:** a timeout shows only as FAIL at 300032 ms, after a ten-minute gate; it looks like a hang, not a slow tool.

**How to apply:** when adding a CSBWin run (or any long tool), time `npm test -- --only=<tool>` alone; past ~100 s, give it a job of its own the same way. Related: [[csbwin-oracle]].
