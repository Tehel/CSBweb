---
name: stage-explicitly
description: Never `git add -A` — the author edits the tree mid-session; a file holding the author's uncommitted edits is staged without them
metadata:
  type: feedback
---

Stage commits by explicit path, never with `git add -A` or `git add .`.

**Why:** the author edits files *while a session is running*; a blanket add once swept
their in-progress edits into a commit. Excluding one path is not enough, because the
hazard is whatever the author happens to be editing.

**How to apply:** stage the files the change touched. If the set is large, read
`git status --short` and pick from it, skipping anything not yours, untracked files above
all.

**A file the commit needs that already holds the author's uncommitted edits** (DEBT.md,
which every `/pay-debt` commit touches and the author edits between sessions): `git add`
would take their edits along, and `git add -p` is interactive, so it cannot run here.
Before touching the file, save their diff, `git diff DEBT.md > <scratchpad>/author.patch`.
At commit time, copy the working file, `patch -R <copy> <scratchpad>/author.patch`, and
stage the copy with
`git update-index --cacheinfo 100644,$(git hash-object -w <copy>),DEBT.md`. Then check
that `git diff DEBT.md` is exactly their patch: their edit stays unstaged in the tree.
Say so in the report.

The reverse-apply fails when one of your edits sits next to one of theirs (an index row
deleted beside the row they moved): chain the commit on its success with `&&`, never
`;`, and when it fails undo their edit in the copy by hand.
