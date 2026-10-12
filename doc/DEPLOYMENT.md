# Deployment: the game on the author's VPS

> **Deployment is done by hand, by the author.** This page is reference for the person at
> the keyboard, not a runbook for an assistant to execute. A session's job ends at "built,
> checked, here is the command"; SSH to the VPS is read-only inspection, and only when the
> author allows it.

The game is served at `https://csbweb.looten.net/`, from a Docker container on the author's
VPS, which serves other projects too. A small Node server (`server/`) serves the built page,
the game files and the statistics' API (`doc/STATISTICS.md`). There are no logins. The game
files are mounted from the host, never part of the image.

The setup follows the author's other projects on the same VPS (`linkedin-games/player`
above all): a two-stage `node:24-alpine` image with no `node_modules`, a loopback-only port
behind the host's nginx, and a deploy by `docker save`, `scp` and `docker load`.

## What runs where

```
image      dist/ (the built page) + server/ (run by Node 24 as is) + src/data/DataSets.ts
mounts     /data/gamefiles  :ro   the data sets, swoosh/, manifest.json
           /data/stats            stats.db (SQLite, WAL), backups/
env        PORT (8085), DIST_DIR, GAMEFILES_DIR, STATS_DB
```

On the VPS, everything is in one folder, `DEPLOY_DIR` (`~/csbweb`):

```
~/csbweb/
├── docker-compose.yaml   copied by every deploy, so it cannot drift from the repository
├── .env                  the stack's own, kept on the VPS (see below)
├── gamefiles/            uploaded by hand; everything under it is public
│   ├── manifest.json     the data sets the page offers
│   ├── swoosh/           the FTL logo, as the manifest names it
│   └── dm-atari/, csb/, … one folder per data set the manifest lists
└── stats/                written by the container (uid 1000)
    ├── stats.db, stats.db-wal, stats.db-shm
    ├── backups/          the nightly snapshots, 14 days of them
    └── backup.log
```

**The manifest is inside `gamefiles/`**, next to the folders it names. The server reads
`/data/gamefiles/manifest.json`, and nothing outside the mounted folder is visible to it.

## The site

**HTTPS is required**, not optional: `crypto.subtle` (`src/data/DungeonSignature.ts`) and
`crypto.randomUUID` exist only in a secure context. The dev server's `localhost` is one,
and a plain-HTTP address is not. The certificate is Let's Encrypt's, from certbot.

The host's nginx has one `server` block for the subdomain, which proxies everything to the
container's port and passes the client's address:

```nginx
location / {
    proxy_pass http://127.0.0.1:8085;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}
```

`X-Real-IP` is what the rate limit of `api/event` counts. Without it, every player shares
the one bucket of the proxy's address. The server trusts the header only because the
container's port is published on loopback (`server/app.ts`, `clientAddress`).

The page ships as it is, debug chrome included. Every URL in it is relative to the page
(Vite `base: './'`), so the game would also run under a sub-path.

## The game files and the manifest

`static/gamefiles/manifest.json`, committed with the files it describes, lists each set
(its `dir` relative to the manifest), the default set's id and the FTL logo's folder, or
none. A set names only what differs from the defaults: `dir` left out is the set's `id`,
and each flag (`csbGraphics`, `miniDat`, `hintOracle`, `hidden`) left out is `false`. `src/data/DataSets.ts` parses it, for the page, the tools and the server. The page
fetches it first (`loadManifest`, `src/main.ts`), and one that is missing or malformed ends
the boot on `fatalMessage`, saying why. The tools read it through `tools/lib/dataSets.ts`,
and `tools/dump-data-sets.ts` asserts the parser's refusals and that every folder holds the
files its flags promise.

The repository's manifest keeps every set, because the tools need them all. The deployed
one is the author's own copy, uploaded with the files: which sets the site offers is the
author's choice. Today it is the repository's, all nine sets.

The manifest is strict JSON, read by `JSON.parse`: a comment makes it unreadable, and the
server will not start on it. To take a set off the welcome page without deleting it, give it
`"hidden": true`: its grid leaves it out (`chooserSets`, `src/data/DataSets.ts`), and
`?dungeon=<id>` plays it all the same, as CONTINUE does a save of it. The server treats it as any other set: its folder is checked at start-up,
its files are served, and its events are taken. Keys the parser does not know are
ignored, so a note can go in a key of its own, such as `"_note"`.

Each set's folder holds its thumbnail, `<id>-thumbnail.png` (`dm-atari/dm-atari-thumbnail.png`,
`kids-dungeon-24/kids-dungeon-thumbnail.png`): the last frame of its title, which the
welcome page's tile shows, so the page fetches no game file to draw its grid.
`npx tsx tools/gen-thumbnails.ts` writes every set's from its `graphics.dat`, drawn as the form
that adds a player's own set draws one (`src/renderer/intro/TitleThumbnail.ts`), and `npm test`
checks the committed ones (`--check`). A set added to the manifest needs its thumbnail
written before it is uploaded; without one, its tile's picture is a blank box.

The game files are not part of a deploy. They are uploaded once, and again when they
change. **Everything in `gamefiles/` can be downloaded**, readmes and stray folders
included, since the server serves the folder as it stands.

**The server checks the manifest only at start-up** (below). After changing the manifest,
or the folders it names, restart the stack. A file the page asks for is read when it is
asked for, so replacing a data set's files needs no restart.

## The build

`npm run build` is `tsc && vite build`. `static/` is Vite's `publicDir` for the dev server
only (`vite.config.mts`), so a build ships none of the game files, the manuals or anything
else there. The page's own files are under `src/assets/`: `favicon.ico`, named by
`index.html`, and the welcome page's logo, `csbweb-logo.jpg`, imported by
`src/ui/welcomePage.ts`; the build hashes both. A build is `index.html` and `assets/`, under 1 MB.
`tools/dump-build.ts` builds into a scratch folder and asserts it: only the page's own file
types, nothing of `static/`, every file `index.html` names present, and no probe handle.

**The probe handle** (`window.__probe`, `src/main.ts`), through which the CDP probes drive
the page, is the dev server's, and a build's only with `CSBWEB_PROBE=1` (`__CSBWEB_PROBE__`,
`vite.config.mts`). A deployed bundle has none.

The build is named by `CSBWEB_BUILD` where it is given (the image's build stage has no
`.git`), or by the checkout's commit. The page's events carry it (`doc/STATISTICS.md`).

## The server

`server/server.ts`, on `node:http` and `node:sqlite`, with no dependency. Node 24 runs it as
it is, stripping the types, so it uses only erasable syntax, marks its type-only imports
and names its imports with `.ts`. `server/tsconfig.json` holds it to that, and `npm test`
runs `tsc` on it beside the root project. The package is an ES module
(`"type": "module"`), so that Node runs `server.ts` and the page's manifest parser, which
the server imports from `../src/data/`. `npm start` runs it locally, on Node 22.18 or later.

It reads `PORT` (8085), `DIST_DIR` and `GAMEFILES_DIR` (the checkout's `dist/` and
`static/gamefiles/`), and `STATS_DB` (the checkout's `stats/stats.db`, which git ignores),
and serves (`server/app.ts`):

| Path | What | Caching |
| --- | --- | --- |
| `/` | `dist/index.html` | `no-cache` |
| `/assets/…` | `dist/assets/…`, hashed names | `immutable` |
| `/gamefiles/…` | `GAMEFILES_DIR/…` | `no-cache`, ETag and Last-Modified |
| `/api/health` | `{"ok":true}`, for the healthcheck | `no-store` |
| `/api/event` | POST: one of the page's events (`doc/STATISTICS.md`) | |
| `/api/stats` | the statistics' aggregates | `no-store` |

Every file answers a conditional GET with 304, and only GET and HEAD are allowed, except on
`api/event`. A path with a segment that starts with `.`, or holds a `/`, a `\` or a NUL once
decoded, is refused with 400 before it reaches the disk.

**At start-up** it checks that `index.html` is built, that the manifest parses and that
each folder it names exists, then opens the store (making it, and its folder, when
missing). Any failure prints `Not starting: <why>` and exits with 1, so a bad mount fails
the container rather than the player's boot. On SIGTERM it stops listening, lets the
requests in flight finish (5 s at most), closes the store, which checkpoints the WAL into
the file, and exits with 0. It logs to stdout. `tools/dump-server.ts` asserts all of it,
`server.ts` run as its own process included.

## The image and the stack

`Dockerfile`, two stages on `node:24-alpine`:

- **The build stage** runs `npm ci && npm run build`, `tsc` included. Its context is an
  allowlist (`.dockerignore`): the page's sources, `server/`, the tools' `.ts` that `tsc`
  checks beside them, and the package and build files. No game file, no `.git` and no
  `.env` can reach it, so the commit comes in as the build argument `CSBWEB_BUILD`.
- **The runtime stage** has no `node_modules`: `package.json` (for `"type": "module"`),
  `server/`, `src/data/DataSets.ts` and the built `dist/`. It runs as `USER node`, uid
  1000, the VPS's `ubuntu`, so the mounted `stats/` is writable in the container and
  readable over SSH. The exec form makes Node PID 1, which receives SIGTERM, and
  `--disable-warning=ExperimentalWarning` silences `node:sqlite`'s warning.

`npm test` needs the game files, so it is the gate before a commit, not part of the image's
build.

`docker-compose.yaml` runs `csbweb:latest` as the container `csbweb`:

- **`127.0.0.1:${CSBWEB_PORT:-8085}:8085`, loopback only.** A port published on `0.0.0.0`
  answers the whole internet whatever `ufw` says: Docker's published ports are rewritten in
  the `nat` table before `ufw`'s filter rules are consulted.
- `./gamefiles:/data/gamefiles:ro` and `./stats:/data/stats`, bind mounts: the data lives
  on the host, and a deploy's `down` loses nothing.
- `restart: unless-stopped`, a 10 s `stop_grace_period`, a healthcheck on `api/health`
  (busybox's `wget`), and `json-file` logs rotated at 3 × 10 MB.
- `version: '3.8'`, for the VPS's Compose v1.

**`.env` on the VPS** is the stack's, beside the compose file, and `deploy.sh` does not copy
it. Compose reads it twice over: for `${CSBWEB_PORT}` in the compose file, and as the
container's `env_file`. So it must exist, even empty, or Compose refuses to start the
stack; and every variable in it reaches the container's environment, where it overrides
the image's own `PORT`, `DIST_DIR`, `GAMEFILES_DIR` and `STATS_DB`. A change to it needs the
container recreated (a deploy, or `down && up -d`): `docker-compose restart` keeps the old
environment.

**The local `.env`**, at the repository's root and gitignored, is the deploy target, so the
repository names no host, login or remote path:

```
DEPLOY_HOST=<user>@<host>
DEPLOY_DIR=<the absolute path of ~/csbweb>
```

The path must be absolute. A `~` would be expanded on the author's machine when bash reads
the file, and quoted in the remote command anyway.

## Deploying

```bash
npm test                       # the gate
bash tools/check-image.sh      # optional: the golden frames against the image (Docker, Chrome)
npm run deploy                 # utils/deploy.sh
```

`utils/deploy.sh` builds `csbweb:latest`, with the commit as `CSBWEB_BUILD` (`-dirty` when
tracked files differ from it), `docker save | gzip`s it, makes `stats/` over SSH as the
login user (so that uid 1000 can write it), `scp`s the image and `docker-compose.yaml` into
`DEPLOY_DIR`, then loads the image and runs `docker-compose down && docker-compose up -d`.

**Why `down && up -d`:** the VPS runs `docker-compose` 1.29.2, the last Python v1 release,
against a current Docker Engine, and v1 cannot recreate a container there. It reads
`ContainerConfig` from the old container's image, which images built by a modern Docker no
longer carry, and fails with a `KeyError` after it has stopped the old container and before
it has made the new one (`linkedin-games/player`'s `docs/deployment.md`). `down` first
never takes that path, at the cost of a few seconds' outage per deploy, during which nginx
answers 502.

`tools/check-image.sh` builds the image with `CSBWEB_PROBE=1` as `csbweb:probe`, runs it over
the checkout's game files and a throwaway stats folder, and runs
`tools/check-frames.sh --url` against it: the twenty golden frames, drawn by the built
page as the container serves it, must match the dev server's. The probe image is never
deployed.

## Checking it

```bash
curl -s https://csbweb.looten.net/api/health                   # {"ok":true}
curl -sI https://csbweb.looten.net/gamefiles/manifest.json      # 200
ssh <host> 'cd ~/csbweb && docker-compose ps && docker-compose logs --tail 20'
```

A healthy start logs one line, `Listening on port 8085: /app/dist, and /data/gamefiles
(<the sets>); statistics in /data/stats/stats.db`.

**A container that fails to start is retried with a growing delay**: 13 s, 27 s, 51 s, then
about a minute between attempts. While it waits, `docker-compose ps` says "Restarting", even
once the cause is fixed, so a fix seems not to work for up to a minute. `docker-compose
restart` tries again at once. `docker-compose logs` shows each attempt's `Not starting:`
line; a `down` deletes the container and its log with it.

`api/health` answers as soon as the server listens; it does not re-read the files. A
manifest moved away after a good start leaves a healthy container whose page cannot boot,
which the second `curl` above catches.

## Backups

The host's cron runs `server/backup.ts` in the container every night. It snapshots the
store with `node:sqlite`'s `backup` while the server keeps serving, WAL included, into one
self-contained file, `stats/backups/stats-<date>.db`, and prints one JSON line. A `cp` of
the live file would be unsafe: its WAL holds events the main file does not have yet. The
crontab line deletes the snapshots older than 14 days:

```
17 3 * * * cd /home/ubuntu/csbweb && /usr/bin/docker-compose exec -T csbweb node --disable-warning=ExperimentalWarning server/backup.ts < /dev/null >> /home/ubuntu/csbweb/stats/backup.log 2>&1 && find /home/ubuntu/csbweb/stats/backups -name '*.db' -mtime +14 -delete
```

**`< /dev/null` is not optional.** `docker-compose exec -T` reads stdin. Under cron that is
harmless, but in a script fed over `ssh` it swallows the rest of the script.

`ls ~/csbweb/stats/backups/` is the check that the job runs: an empty or missing folder
means it does not. `tools/dump-server.ts` asserts the script against a running server: the
snapshot holds the events still in the WAL, the server keeps serving, and a missing store
exits 1.

`utils/pull-backups.sh` copies the snapshots off the VPS, with `rsync`, into
`../backups/csbweb/` beside the checkout (`BACKUP_PULL_DIR` overrides it), reading the
target from the local `.env`.

**Restore:**

```bash
cd ~/csbweb
docker-compose stop
cp stats/backups/stats-<date>.db stats/stats.db
rm -f stats/stats.db-wal stats/stats.db-shm   # stale sidecars would bring the old state back
docker-compose up -d
```

## Things that are true about restarts

- **The rate limit's counts are in memory**, so a restart resets them, which is harmless.
- **Nothing is lost**: every event is in `stats.db` before `api/event` answers 204, and a
  SIGTERM checkpoints the WAL. A `down` loses only the container's log.
- **The manifest is read again** at every start, and only then.
