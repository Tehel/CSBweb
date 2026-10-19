---
name: dockerignore-allowlist
description: .dockerignore is an allowlist; a new top-level file the build needs (a Vite entry's .html) breaks only the image, which only check-image.sh catches
metadata:
  type: project
---

`.dockerignore` starts with `*` and lets in only what it names (`index.html`, `stats.html`,
`src/`, `server/`, `tools/**/*.ts`, the configs). A new file outside those that `npm run build`
needs, such as another Vite entry's `.html` at the root, is missing from the image's build
stage: `npm test` and `check-frames.sh` pass, and only `bash tools/check-image.sh` fails, at
`docker build`.

**Why:** the statistics page's `stats.html` passed every local check and broke the image.

**How to apply:** add a new root file to `.dockerignore` in the same commit, and run
`check-image.sh` before committing a change to what the build reads.
