---
name: frames-on-fresh-ports
description: check-frames.sh reuses a dev server already on :9000, whose in-memory store keeps every set an earlier probe published, and the welcome-page checks then fail
metadata:
  type: project
---

`tools/check-frames.sh` (and `npm test -- --frames`) reuses whatever already answers on
`:9000` and `:9222`. The dev server's `api/data-sets` store is in memory and keeps every set
a probe has published since it started (`mine-…` tiles), so a reused server fails the
welcome page's checks ("the official games in the manifest's order", the moderator's
tiles) while every frame still matches. Run the frames on fresh ports instead:
`DEV_PORT=9310 CDP_PORT=9311 bash tools/check-frames.sh`.

**Why:** the author, or another session, often has a dev server running on :9000.
**How to apply:** when only the welcome page's checks fail and `using the dev server
already on :9000` is printed, rerun on fresh ports before suspecting the change. See
[[test-publish-on-throwaway-dev-server]] and [[live-tree-is-served]].
