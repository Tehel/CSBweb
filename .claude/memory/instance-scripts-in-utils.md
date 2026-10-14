---
name: instance-scripts-in-utils
description: A script that acts on a CSBweb instance is a durable tool in utils/, finding its own inputs, asking a yes per item before publishing, downloading nothing before it
metadata:
  type: feedback
---

A script that seeds or changes a CSBweb instance belongs in `utils/`, as part of the
"set up an instance" procedure the author means to write, not in the scratchpad as a
one-off. It finds its own inputs (`utils/submit-forum-dungeons.ts` reads the forum's list
itself), and takes the instance's URL and a `playerId` as arguments.

**Why:** the author redirected a one-off submission plan twice: first to a script kept in
`utils/` that discovers the candidates itself, then to downloading a dungeon's files only
once it is approved.

**How to apply:** anything that publishes asks a yes per item, showing what will be
published (name, authors, description), offers a `--dry-run`, and fetches nothing heavy
before the yes. `utils/` is in `tsconfig.json`'s `include`, so `npm test`'s `tsc` checks it.
Document it in `doc/DEPLOYMENT.md`.
