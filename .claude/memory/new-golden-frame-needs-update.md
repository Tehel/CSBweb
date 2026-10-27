---
name: new-golden-frame-needs-update
description: check-frames.sh compares only the frames already in tools/frames/; a new shot() passes unseen until --update writes it
metadata:
  type: project
---

`bash tools/check-frames.sh` compares the frames the baseline `tools/frames/` already
has. A new `shot('NN-name')` in `tools/probe-frames.ts` is written to a temporary
folder that the script deletes, and the comparison still says "all 20 frames match".

To add frames: run `bash tools/check-frames.sh` once to see every existing frame
`same`, then `bash tools/check-frames.sh --update`, then `git status --short tools/frames`:
only the new PNGs may appear (`??`), none modified. Look at them with `Read` before
committing. Update the frame count in `CLAUDE.md` ("compares N live screen states").

**Why:** a new frame that was never written is evidence of nothing, and the run says
nothing about it.

**How to apply:** every renderer or UI item that "owes a golden frame". See
[[probe-frames-storage-flags]].
