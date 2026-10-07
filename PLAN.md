# dmweb – Implementation Plan

Project priority: **maximum compliance with the CSBWin C++ implementation** in `doc/CSBwin-src/`.

This document is the **authority on detailed project status**. Every phase carries progress
markers; keep them honest. Marker meanings:

- ✅ done and believed faithful to CSBWin
- ⚠️ implemented but knowingly diverges or is incomplete — the note says how
- ⏳ not started, or a placeholder stands in for the real logic
- ⏸️ postponed until the default dungeon is validated (`DEBT.md` → "Priority")
- 🚫 deliberately skipped (the note says why)

**When you defer part of a job, record the deferral here.** A phase marked ✅ with silent
gaps is worse than one marked ⚠️.

This file carries only the phases that still have work in them, and describes them as
they stand (`CLAUDE.md` → "Write down the present, not the past"). When a phase is
finished, lift anything still open into **`DEBT.md`**, which is the authority on debt, and
any verified fact into `doc/`; then delete the phase's body and add its line to
"Completed phases".

## Current priority: a working game on the default dungeon

The goal is a complete, faithful game on `dm-atari`. The work, in order:

1. **`DEBT.md`'s active rows**: the unported CSBWin features the default dungeon and
   Chaos Strikes Back reach (`DEBT.md` → "Priority"). `DEBT.md` says how
   to work an item. **One item per commit, a few per session**, then `/clear`. Its index is
   the live status; its first row is the next item.
2. **Phase 17, deployment**, now that Conflux 3.5 is a data set, before the rest of
   `DEBT.md`'s rows and before the extras. Its row in `DEBT.md`'s index marks the place.
3. Phase 15 step 4 interleaves anywhere.

⏸️ **Postponed until the default dungeon is validated**: a save of a dungeon the port does
not know (`DEBT.md` G22), CSBWin's debugging features (G14, the ASCII dump), and Phase 15
step 5. The retail dungeon uses none of them. Features of **Chaos Strikes
Back** are not postponed: it is the next dungeon to try.

## Ground rules

1. **The build must stay clean.** `npm run build` runs `tsc && vite build`; `tsc --noEmit`
   must pass with zero errors before any commit. Note that `vite build` alone will happily
   succeed on broken code — esbuild strips types without checking them — so `tsc` is the
   only real gate. (The project sat with a broken `tsc` and a genuine runtime bug hidden
   among the type errors; don't let that recur.)
2. **No guessed tables in the shipping path.** If a rectangle/offset/formula is not extracted
   from the game data or transcribed from CSBWin, mark it as temporary.
3. **One renderer is authoritative**: the bytecode-based path.
4. Prefer small tooling over manual reasoning: table dumps, render probes, trace hooks.

## Status

**Working:**
- Data loading: `dungeon.dat`, `graphics.dat`, `CSBgraphics.dat`, save games (base and
  extended).
- The bytecode viewport renderer, the authoritative path. Every `0x22e` rectangle table is
  extracted at runtime; no guessed geometry remains in the renderer.
- Movement and collision: stamina per step, the move delay in ticks, CSBWin's one mouse
  queue for keys and clicks, and timers processed straight after a move.
- The timer queue, with CSBWin's duplicate-timer rules.
- Actuators, DSA scripting, teleporters, pits, doors, false walls.
- Missiles, throwing and clouds.
- Skills and experience (mastery, `AdjustSkills`, `LevelUp`), magic casting (all three
  spell classes), worn-object bonuses.
- Light levels and palette switching, sound, the message area (`SCROLLING_TEXT`), most of
  the DM UI.
- Monsters (`Monster.cpp`): groups hunt, flee, throw missiles, hit the party, take damage
  and die. The champions' own attacks (`Attack.cpp`), through the Party Attack Filter.
- The champion lifecycle: the Hall of Champions mirrors, the Reincarnate screen, feeding,
  poison, pit falls, death and bones, the Altar of Vi; sleep.
- The pre-game sequence: the title animation, the dungeon entrance, the door animation and
  the credits scroll. The game's `dungeon.dat` is read after ENTER, as CSBWin reads it.
- Saves: a save is a CSBWin `.dat` file, all sixteen blocks, written by the game and
  read back as a genuine one is (`doc/CSBWIN_SAVEGAME_REFERENCE.md`). The dialog behind
  the disk icon and at the entrance lists them by playthrough, with LOAD, SAVE, EXPORT
  and an import by a file dropped on the page; F5 and F9, and the Sleepsave
  (`doc/SAVES.md`).
- Three data sets (`src/data/DataSets.ts`: `dm-atari`, the default, `dm-windows` and
  `csb`), one chosen before the boot by `?dungeon=<id>`, and the DM Rules toggle.
- Debug scaffolding is the chrome beside the canvas (`src/ui/`): the settings, the map
  preview and the champion panel. Its teleport by a click on the map and its cursor
  filter trace are behind `isDebugFeaturesEnabled()`. It has no log of its own: what
  the page reports goes to the console, a move's position at debug level, what F5,
  F9 or the Sleepsave did at info level.

**Incomplete:**
- ⚠️ **Validation.** Several completed phases listed validation steps (render tests, render
  probes, pixel comparisons against CSBWin screenshots) that were never carried out.
  Phase 15 gathers them.
- Everything in `DEBT.md`: the technical debt, the known divergences from CSBWin, and the
  unported CSBWin features (tier G).

**The evidence.** `npm test` runs `tsc` and every tool listed in `tools/run-checks.mjs`;
`npm test -- --frames` adds the golden frames. There is still no test *framework*:

1. **Golden frames.** `tools/probe-frames.mjs` and `tools/check-frames.sh` drive the real
   app over the DevTools Protocol and compare the screen states in `tools/frames/`. The
   probe reads the 320x200 canvas back and `tools/compare-frames.mjs` compares pixels, so
   nothing depends on the host machine. It also fails a baseline that holds two identical
   frames, so a frame that can no longer fail is caught.
2. **Verification tools.** `tools/run-checks.mjs` is the one list of them; don't copy it
   anywhere. They load the real game files, drive the real engine with a fixed RNG seed,
   print a human-readable table and assert invariants through `tools/lib/check.ts`, whose
   `finish()` also fails a run that made no checks. They are the regression suite for
   everything the frames cannot see. The pattern is in `.claude/skills/verification-tools/`;
   what Phase 15 still owes is shared fixtures.

## Completed phases

Open items from them are in `DEBT.md`. `doc/PLAN_ARCHIVE.md` (frozen) holds the working
notes of the phases closed up to 2026-09-26; for a phase closed later, its line here and
`git log` are the record.

| Phase | Subject |
| --- | --- |
| 0 | Consolidate rendering entrypoint |
| 1 | Load CSBWin viewport tables from `graphics.dat` |
| 2 | Faithful low-level blitter (pixel-index buffer) |
| 3 | Floor/ceiling pipeline |
| 4 | `SummarizeRoomInfo()` authoritative |
| 5 | Opcode surface area |
| 6 | Custom skins / `BACKGROUND_LIB` |
| 7 | UI rendering (faithful DM layout) |
| 7.5 | Light level / palette switching |
| 8 | CSBWin-compatible actuators |
| 8.5 | Teleporter cell actions parity |
| 9 | CSBWin-compatible missiles |
| 9.5 | Skills & experience parity |
| 9.75 | Magic casting parity |
| 10 | CSBWin-compatible save/load, and the save dialog (`doc/SAVES.md`) |
| 11 | Unify the messaging system |
| 12 | Monsters: AI, movement, combat |
| 13 | Champion lifecycle |
| 14 | Structural cleanup |
| 16 | Title screen and dungeon entrance |

## Next Steps (Phased)

Only the phases with work left in them.

### Phase 15 — Verification

Goal: pay down the validation debt. Phases 2, 4, 5 and 7 all list validation steps that were
never carried out, because the project has **no test framework**.

1. ✅ **Test runner.** `npm test` → `tools/run-checks.mjs`: `tsc --noEmit`, then the
   asserting tools, then the frames with `--frames`. ~14s, ~33s with frames.
   `tools/` is inside the type gate. Shared helpers in `tools/lib/check.ts`.
   <sub>How it went, and the two real bugs it surfaced: `doc/PLAN_ARCHIVE.md` → "Phase 15".</sub>
2. ⚠️ **Golden-frame rendering tests.** `tools/check-frames.sh` starts its own dev server
   and headless Chrome and takes `--update`. Fourteen frames: the first six load
   the app with `?intro=0`, and `07-entrance` / `08-credits` / `12-game-loaded` load it
   again without, which is the only standing evidence that the corridor behind the prison
   doors actually renders. The rest boot with `?intro=0` once more and stand the party on
   a fixed square (`FACE` in `tools/probe-frames.mjs`): a pressed crack switch
   (`doc/PROVEN_FACTS.md`, "`dm-atari/graphics.dat` is CSBWin's with three items from the 1.2 disk"), two door ornaments, and a
   mirror on each F2 edge wall, positions 7 and 9 of `DrawWallDecoration`. Still owed to
   make it a real test: comparing the palette-index buffer rather than the RGBA canvas it
   is converted to.
   <sub>Baseline re-capture story: `doc/PLAN_ARCHIVE.md` → "Phase 15".</sub>

3. ✅ **Render probe.** `tools/dump-render-probe.ts` runs every cell program of
   `pStdDrawCode` on its own, headless, over hand-built room data, against the real
   `graphics.dat` and `dm-atari` level 0, in both mirror parities. It asserts that the
   port's table is null in exactly CSBWin's 46 `NOP` slots, that no program warns or
   writes a pixel outside the 16 colours, and that all 244 renders hash as
   `tools/reference/render-probe.tsv` records. A deliberate renderer change looks with
   `--png` (one contact sheet per parity in `tools/output/`) and rewrites the baseline
   with `--update`. Each slot is tried with one summary per room type (a closed door, a
   visible pit and teleporter, no decorations or objects), so wall and floor decorations,
   text, objects and the other door states are still seen only by the golden frames.
4. 🔄 **Parser round-trip checks** for `dungeon.dat` / `graphics.dat` table extraction, so
   table regressions surface immediately. Part-paid by Phase 16: `tools/dump-image-codec.ts`
   decodes every image in both data sets and asserts each one fills its own buffer exactly,
   which is what caught the codec bug's blast radius, and checks each opcode on a hand-built
   stream. The *table* extraction (`0x22e`..`0x232`) still has no round-trip check beyond the
   canaries individual tools assert.
5. ⏸️ Compare against CSBWin screenshots for a few known scenes (Phase 7's skipped
   validation). Postponed, perhaps for good: staging the same scene in CSBWin without
   cheats costs more than it would prove, and the golden frames and the render probe
   already catch any pixel that changes unintentionally. When it is taken, the canvas's
   colours go with it: an Atari intensity times 36, not CSBWin's RGB555 (`DEBT.md` H).

Status: 🔄 in progress — steps 1, 2 and 3 done, 4 part-done; 5 postponed.

### Phase 17 — Deployment: the game served from the author's VPS

Goal: the game on the author's VPS (a V-R4 that already serves other projects), in a Docker
container. The game files come from a mounted directory, not from the image. A small Node
server serves the page and the files, and counts games: games started, won and lost.
There are no logins.

Conflux 3.5 is one of the data sets it ships, and it comes before the extras. Until then, `npm run dev` is the only way the game runs.

**The pattern is the sibling projects'** (`SenTynel`, `gpo`, `linkedin-games/player`,
next to this checkout):

- A two-stage `node:24-alpine` image. The runtime stage has no `node_modules`
  (`linkedin-games/player`: zero production dependencies, SQLite from `node:sqlite`), runs
  as `USER node` (uid 1000, the VPS's `ubuntu`, so a bind-mounted directory is writable
  in the container and readable over SSH), and uses the exec form, so Node is PID 1 and
  receives SIGTERM.
- Compose publishes on **`127.0.0.1:<port>` only**. The host's nginx proxies to it, with
  a certbot certificate, one `server` block per subdomain (`gpo/utils/nginx-gpo.conf`).
  A port published on `0.0.0.0` answers the whole internet whatever `ufw` says
  (`linkedin-games/player/docker-compose.yaml`).
- Deploys go through `docker save | gzip`, then `scp`, then `docker load`, then
  `docker-compose down && up -d`: the VPS's Compose v1 cannot recreate a container
  (`linkedin-games/player/docs/deployment.md`). The target comes from a gitignored `.env`,
  as in `SenTynel/utils/deploy.sh`: the repository names no host, login or remote path.
  The author deploys by hand. A session's job ends at "built, checked, here is the
  command".

**Shape:**

```
image:   dist/ (the built page) + server/ (one TS entry point, run by Node 24 as is)
mounts:  /data/gamefiles  :ro   the data sets, swoosh/, manifest.json
         /data/stats            stats.db (SQLite, WAL)
env:     PORT, GAMEFILES_DIR, STATS_DB
```

**The site is served over HTTPS**, with a Let's Encrypt certificate from certbot. It
has to be: `crypto.subtle` (`src/data/DungeonSignature.ts`) and `crypto.randomUUID` exist
only in a secure context. The dev server's `localhost` counts as one, and a plain-HTTP
address does not.

**The page ships as it is**, debug chrome included. The redesign (`DEBT.md` E15) replaces
it later, along with the FAQ and the statistics page.

1. ✅ **The manifest.** `static/gamefiles/manifest.json`, committed with the files it
   describes, lists each set (its `dir` relative to the manifest), the default set's id
   and the FTL logo's folder, or none. `src/data/DataSets.ts` parses it for the page and
   the tools. The page fetches it first (`loadManifest`, `src/main.ts`), and one that is
   missing or malformed ends the boot on `fatalMessage`, saying why; the chooser lists
   it. The tools read it through `tools/lib/dataSets.ts`, and `dump-data-sets` asserts
   the parser's refusals and that every folder holds the files its flags promise. The
   store's upgrade gives version-1 rows `'dm-atari'` as a literal
   (`src/data/saves/idb.ts`), whatever the manifest's default. Every URL is relative to
   the page (Vite `base: './'`), so the game also runs under a sub-path.

   The deployed manifest is the author's, uploaded with the files. It lists `dm-atari`
   (the default), `csb`, `kids-dungeon` and Conflux, and not `3d2d1d`, `dm-windows` or
   the other Atari versions. The repository's manifest keeps every set, because the
   tools need them all.
2. ✅ **The build ships no game data.** `static/` is Vite's `publicDir` for the dev server
   only (`vite.config.mts`), which serves the game files, the manuals and the rest of it
   as they stand; a build ships none of it. The page's own files are modules under
   `src/assets/`, which the build hashes: the favicon, named by `index.html`, and the CRT's
   scanlines, imported by `src/main.ts` (small enough that the bundle inlines them). A
   build is `index.html` and `assets/`, under 1 MB. `tools/dump-build.ts` builds into a
   scratch folder and asserts it: only the page's own file types, nothing of `static/`,
   and every file `index.html` names present.
3. ⏳ **The server.** `server/server.ts`, on `node:http`, with no dependency. Node 24
   strips the types (as `gpo/prod-server.ts` does), so it uses only erasable syntax and
   imports with `.ts` extensions. It is inside the `tsc` gate, as `tools/` is.

   It replaces the stale `server.js`, which runs Express on port 9010 and has an
   unauthenticated `/stopserver` that exits the process. The `express` and
   `serve-favicon` dependencies go with it.

   What it serves:
   - `dist/`. Hashed assets are `immutable`, and `index.html` is `no-cache`.
   - `gamefiles/` from `GAMEFILES_DIR`, with ETag and Last-Modified. A path that leaves
     the directory is refused.
   - `api/event` and `api/stats` (steps 4 and 5).
   - `api/health`, for the compose healthcheck.

   At startup it checks that the manifest parses and that each folder it names exists,
   so a bad mount fails the container rather than the player's boot. It shuts down on
   SIGTERM, closing the database, and logs to stdout.
4. ⏳ **The player id and the events.** All of this is page-side (`src/ui/`). The engine
   sends nothing and stays silent, as it does today.

   The player id is a `crypto.randomUUID()` drawn at first start and kept in
   `localStorage`, as `src/ui/settings.ts` keeps the settings. If the player clears it,
   the page draws a new one, and that is accepted: the id is for counting players, not
   for knowing who they are.

   A game is its **playthrough** (`doc/SAVES.md` → "A playthrough"). The id is drawn when
   the game is new and carried by every save, so one game's events link up across loads,
   sessions and imports. Each event carries the player id, the data set, the playthrough
   and the build (a git hash through Vite's `define`):
   - `started`: a new game's first tick (the boot's new game, or RISE's new adventure).
   - `party`: at `GameHost.championJoined` (`src/main.ts:343`), with the champions'
     names. A DM party is empty at the first tick and fills up in the Hall.
   - `won` and `lost`: at `showEndOfGame` (`src/main.ts:446`), with the game clock and
     the party's names. A lost game also carries the level and square
     (`party.state.position`, read there already).

   **Anonymity is a rule of the code, not just of the FAQ.** No player's name, no
   address and no browser fingerprint (user agent, screen, language) is sent or stored.
   A name typed on the Reincarnate screen is the player's own text, so it is never sent.
   The champion is reported by its mirror's name (`HallOfChampions.reincarnationSource`)
   and flagged as reincarnated. A party that comes from a save (RISE, an imported game)
   has names nobody has vouched for, so a name is reported only if it is one of the
   dungeon's mirrors. There is no `visit` event: the player id appears only with a game.

   Events are sent with `navigator.sendBeacon`, and a failure is ignored: nothing an
   event does delays or breaks the game. Only a production build sends them, so dev and
   the tools never do.
5. ⏳ **The statistics store.** SQLite through `node:sqlite`, as in
   `linkedin-games/player`, in one `events` table: when, player, type, set, playthrough,
   build and a JSON payload.

   The database file is on the host, in the mounted `/data/stats` (`STATS_DB`), and never
   in the container's writable layer, which is lost on every deploy's `down`. It runs in
   WAL mode, and the server closes it on SIGTERM so the WAL is checkpointed into the main
   file. The server creates the schema if the file is missing.

   The server validates every event: a known type and a body of at most 4 KB. It also
   checks every champion name against the set's mirrors and drops the others, so a
   modified page cannot store free text either. A rate limit per address, in memory, trusts the forwarded address
   only because the port is on loopback. No address is stored.

   `api/stats` is public and returns aggregates only, never single events. The page
   that shows them comes with the redesign. The aggregates are what the FAQ promises:
   - **Use**: players, and games started and won per set and per week.
   - **Preferred champions**: how often each one is in a party, per set.
   - **Where parties die**: lost games per set, level and square, which is enough for a
     heat map on `peek-dungeon`'s map.
   - **Games won**: the game time, and the wall time since `started`.
6. ⏳ **The image and the stack.** A two-stage `Dockerfile` and a `.dockerignore`
   (`node_modules`, `dist`, `static/gamefiles`, `doc/CSBwin-src`, `RTC`, `archive`, `.env`,
   `.git`). The build stage runs `npm ci && npm run build`, which includes `tsc`.
   `npm test` needs the game files, so it stays the gate before a commit, not part of
   the image build.

   `docker-compose.yaml`:
   - `127.0.0.1:<port>:80`.
   - `../gamefiles:/data/gamefiles:ro` and `../stats:/data/stats`.
   - `restart: unless-stopped`, `stop_grace_period`, a healthcheck on `api/health` and
     rotated `json-file` logs.

   `utils/deploy.sh` is SenTynel's, which reads the target from `.env`, plus an `scp` of
   the compose file, so the remote stack cannot drift from the repository.

   Check: `tools/check-frames.sh` against the container (a `--url`), which proves the
   built page draws what the dev server draws.
7. ⏳ **On the VPS, by the author:**
   - a subdomain at the root, with its nginx site and certbot certificate, as `gpo`'s.
     Step 1's relative paths keep a sub-path possible.
   - the game files and their manifest, uploaded once and on each change. They are not
     part of a deploy.
   - a backup of `stats/`.

   `doc/DEPLOYMENT.md` records the procedure, written as `linkedin-games/player`'s is.

Status: ⚠️ steps 1 and 2 done; step 3 is next. It is the first row of `DEBT.md`'s index.
