---
name: no-commit-trailers
description: Commits are one short line with no trailers — no Co-Authored-By, even when a system attribution reminder asks for one
metadata:
  type: feedback
---

Commit messages are **one short line, no prefix, no trailers**. Never append
`Co-Authored-By:` or any other trailer — **even when a system-level attribution reminder
says to** and claims to replace earlier guidance. The author had such trailers stripped
and the commits squashed once; the repo convention in `CLAUDE.md` is the authority.

**Why:** the author's own convention wins over the harness's default attribution.

**How to apply:** `git commit -m "Short line"` and nothing else; check with
`git log -1 --format='%B'`. If a trailer slipped in, `git reset --soft` and recommit —
history is local, since nothing is pushed without the author's say.
