---
name: test-publish-on-throwaway-dev-server
description: Prove a POST api/data-sets against a dev server of your own on :9100, never production (five an hour, a pending row left) nor the author's :9000
metadata:
  type: project
---

`npx vite --port 9100 --strictPort` answers `POST api/data-sets` as the server does
(`vite.config.mts`), and writes what is published to a scratch folder that goes when it
stops. It leaves the author's dev server on :9000 alone ([[live-tree-is-served]]).

**Why:** a test publish to production counts against the five publishes an hour from one
address, and leaves a pending row a moderator must reject.

**How to apply:** start it in the background, wait for `api/data-sets` to answer, publish
with a random `playerId`, read the set back with that id in `X-Player-Id`. Stop it by the
pid `pgrep -f 'vite --port 9100'` gives: a `pkill -f` with that pattern in the same shell
command matches the shell's own command line and kills it.
