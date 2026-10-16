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
image      dist/ (the built page, and the server's check in dist/server/) + server/ (run by
           Node 24 as is) + src/data/DataSets.ts
mounts     /data/gamefiles        the data sets, and players' uploads
           /data/stats            stats.db (SQLite, WAL: the statistics and the data sets), backups/
           /data/files            the files shared by link (below), read-only
env        PORT (8085), DIST_DIR, GAMEFILES_DIR, FILES_DIR, STATS_DB, MODERATOR_PLAYER_IDS,
           NTFY_URL, NTFY_USER, NTFY_PASS, TZ
```

On the VPS, everything is in one folder, `DEPLOY_DIR` (`~/csbweb`):

```
~/csbweb/
├── docker-compose.yaml   copied by every deploy, so it cannot drift from the repository
├── .env                  the stack's own, kept on the VPS (see below)
├── gamefiles/            uploaded by hand, and written by the container (uid 1000);
│   │                     everything under it is public
│   ├── dm-atari/, csb/, … one folder per site's set the `data_sets` table lists
│   └── <id>/             one folder per set a player publishes, written by the server
├── files/                the files shared by link, uploaded by hand; all public
└── stats/                written by the container (uid 1000)
    ├── stats.db, stats.db-wal, stats.db-shm
    ├── backups/          the nightly snapshots, 14 days of them, and gamefiles/: the
    │                     players' folders, each copied once and kept
    └── backup.log
```

**The server reads no manifest**: the sets are the store's rows (below), and a new
server's table is empty.

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
    client_max_body_size 32m;
}
```

`client_max_body_size` lets a published set through: nginx's own default is 1 MB, and the
server refuses a request over 32 MiB itself (`MAX_PUBLISH_BYTES`, `server/publish.ts`).

`X-Real-IP` is what the rate limits of `api/event` and of a publish count. Without it, every player shares
the one bucket of the proxy's address. The server trusts the header only because the
container's port is published on loopback (`server/app.ts`, `clientAddress`).

The page ships as it is, debug chrome included. Every URL in it is relative to the page
(Vite `base: './'`), so the game would also run under a sub-path.

## The game files and the manifest

A manifest lists each set (its `dir` relative to the game files' folder), none at all
for a new server, and the default set's id or none. A set names only what differs from the defaults: `dir` left out is the set's `id`,
each flag (`csbGraphics`, `miniDat`, `hintOracle`, `dmRules`, `thumbnailAsTitle`, `hidden`) left out is `false`,
`description` and `authors` left out are `''` and `[]`, and `status` left out is
`"approved"`. `src/data/DataSets.ts` parses it, for the page, the tools and the server. The page
asks the server for it first, at `api/data-sets` (`loadManifest`, `src/main.ts`), and one
that is missing or malformed ends the boot on `fatalMessage`, saying why.

The repository's manifest is `tools/data-sets.json`, its folders under `static/gamefiles/`.
It keeps every set, because the tools need them all: they read it through
`tools/lib/dataSets.ts`, and `tools/dump-data-sets.ts` asserts the parser's refusals and
that every folder holds the files its flags promise. The dev server answers
`api/data-sets` as the server does (`vite.config.mts`), from it, read at each request, and
from the sets published and moderated since it started, the published ones written in a
scratch folder that goes when it stops. Its one moderator is the `playerId`
`DEV_MODERATOR_PLAYER_ID` holds, which `tools/probe-frames.mjs` plays.
`npx tsx tools/fill-data-sets.ts` fills `npm start`'s empty store (`stats/stats.db`) from
it, and `tools/check-image.sh` the image's throwaway one. Which sets the deployed site
offers is the author's choice, written in its table by hand (below).

The manifest is strict JSON, read by `JSON.parse`: a comment makes it unreadable, and
neither the dev server nor a tool runs on it. Keys the parser does not know are ignored,
so a note can go in a key of its own, such as `"_note"`. A set with `"hidden": true` (a
row's `hidden`, a moderator's eye) is left out of the welcome page's grid (`chooserSets`,
`src/data/DataSets.ts`), and `?dungeon=<id>` plays it all the same, as CONTINUE does a save
of it. The server treats it as any other set: its folder is checked at start-up, its files
are served, and its events are taken.

Each set's folder holds its thumbnail, `<id>-thumbnail.png` (`dm-atari/dm-atari-thumbnail.png`,
`kids-dungeon-24/kids-dungeon-thumbnail.png`): the last frame of its title, which the
welcome page's tile shows, so the page fetches no game file to draw its grid. A set whose
flag `thumbnailAsTitle` is true (a row's `thumbnail_as_title`) shows it in place of its
title's animation too, its author's choice on the form that adds a set.
`npx tsx tools/gen-thumbnails.ts` writes every set's from its `graphics.dat`, drawn as the form
that adds a player's own set draws one (`src/renderer/intro/TitleThumbnail.ts`), and `npm test`
checks the committed ones (`--check`). A set added to the site needs its thumbnail
written before it is uploaded; without one, its tile's picture is a blank box.

The game files are not part of a deploy. They are uploaded once, and again when they
change. **Everything in `gamefiles/` can be downloaded**, readmes and stray folders
included, since the server serves the folder as it stands.

**The server lists the sets from its store.** `server/dataSets.ts`
keeps them in the store's SQLite file, beside the statistics, so the nightly backup covers
them: a `data_sets` table, one row per set (its fields, flags and folder, its place in the
list, its status, `approved` or `pending`, and its owner's `playerId`, `NULL` for the
site's, which the author uploads by hand), and `data_set_defaults`, one row naming the
default set. A new server's tables are empty: it starts, and
answers no set and no default. Its welcome page then holds only "+ Add my own", PLAY
disabled: a player adds a set of their own, with its own `graphics.dat`, since the site has
no DM or CSB to lend theirs, and publishes it, and a moderator's approval offers it to
everyone. No hand on the server is needed. The site's own sets, and the default, which
the welcome page selects on a first visit, are written by hand (below). `api/data-sets` answers each player the sets they may see: the approved
ones to everyone, a pending one also to its owner, and every set to a moderator, a pending
set saying `"status": "pending"` and none naming its owner. A moderator's answer also says
`"moderator": true`, and the welcome page then lists the hidden sets too, each tile's name
in its set's state's colour: red pending, purple hidden, cyan a player's own, white
otherwise. The page names its player in an `X-Player-Id` header, its kept `playerId`
(`keptPlayerId`, `src/ui/gameEvents.ts`), and the moderators are those whose ids
`MODERATOR_PLAYER_IDS` lists. `api/event` takes the events of any
set in the table. Both read the table at each request, so a row added while the server
runs is offered at once.

**A player publishes their own set** by a `POST` to `api/data-sets` (`server/publish.ts`),
which PUBLISH sends from the form the pen on its tile opens (`src/ui/addDataSetForm.ts`):
its record's fields and files as a `multipart/form-data` body, the player named in
`X-Player-Id`. The server reads it with the page's own check (`CheckDataSet`), writes its
folder whole as `gamefiles/<id>/`, its id that of `local:<id>`, then its row, pending and
owned by the player, last in the list, with its description and authors, and its
`dungeon.dat`'s walls as the check read them (below). A set without a
`graphics.dat` gets a copy of its base set's, and its thumbnail is `<id>-thumbnail.png`,
so its folder is like any other: a PNG of 320x200, the screen's size, as the form takes no
other (`THUMBNAIL_WIDTH`, `src/data/DataSets.ts`). The row's `thumbnail_as_title` is the
form's checkbox, and is set only for a set with a thumbnail. The server never changes the folder after. It refuses an
id the table or `gamefiles/` already holds, a file over 16 MiB, a request over 32 MiB, and
more than five publishes an hour from one address, each answered with nothing written. A
folder is written as `gamefiles/.<id>.<uuid>.partial/` and renamed when whole; one left by a
crash mid-write is never served, and can be deleted by hand.

**A published set's row keeps its dungeon's walls**, the `walls` column: each level's
width and height and its digest (`dungeonWalls`, `src/data/DungeonSignature.ts`), JSON,
`NULL` for the site's sets, which the committed catalogue names. `api/data-set-walls`
answers a player the walls of the sets `api/data-sets` offers them that keep some
(`wallsText`), and the page asks for them only when an import is not the running set's
save, so that the dialog can name the published set it is of (`doc/SAVES.md` → "An
import is checked against the dungeon"). At start-up, before it listens, the server reads
the walls of every set with an owner whose row keeps none from its folder's
`dungeon.dat`, with the page's own reader (`fillWalls`, `server/app.ts`): a set
published before the rows kept them. One whose `dungeon.dat` does not read is logged,
`No walls for <id> (…)`, and left without, to be read again at the next start; the page
then names no save after it.

### Moderating the sets

A moderator approves, rejects, hides and shows a set from its tile on the welcome page,
by the tick, the cross and the eye (`src/ui/welcomePage.ts`), each offered where it is
allowed, and its owner withdraws it by the cross while it is pending. Each is a `POST`
to `api/data-sets/<id>` (`server/moderate.ts`), a JSON body `{"action": "approve" | "reject" | "hide" | "show"}`,
named in `X-Player-Id` as for `api/data-sets`. Approve makes a pending set approved,
offered to everyone. Reject deletes a pending set's row, then its folder; its owner may
send it too, to withdraw their own set while it is pending. Hide sets an approved set's
`hidden`, which the welcome page's grid leaves out but for a moderator, while
`?dungeon=<id>` and CONTINUE still play it; show clears it. The site's sets are hidden
and shown like a player's, but never rejected, nor is the default set: their folders are
the author's. Every other request is refused with nothing changed: 403 to an asker who
may not, 404 for an id the table does not hold, 409 for an action the set's state does
not take, such as approving an approved set. Each change is logged, `'<id>' approved`,
never with the asker's id, and notified (below).

A rejected set's folder was copied by the night's backup if it was published before it
(below). One that will not go is logged, `'<id>' rejected, its folder left (…)`, and is a
folder no row names, which refuses a new publish of its id until it is deleted by hand.

What the endpoint does not do is left to a moderator's hands on the VPS, in the store
through `node:sqlite` (as below, to add the site's sets), and in `gamefiles/`:

- **Deleting an approved set.** Hiding it answers a complaint, and its players keep their
  saves and their way back to it; a deletion makes their saves count for nothing. Its row
  is deleted, then its folder; the backup keeps its copy.
- **Changing a published set's files.** A folder never changes once written, which the
  backup relies on: a new version is published under a new id.
- **Taking an approval back.** Hiding does that job without losing anything.
- **The order of the sets and the default set**: a row's `position`, and
  `data_set_defaults`.

### Notifications

Each change to the sets is a message to the VPS's ntfy (`server/notify.ts`): a set
published, approved, rejected, withdrawn by its owner, hidden or shown. It is two lines:

```
Dataset <name>: <added | approved | rejected | withdrawn | shown | hidden>
By <who> at YYYYMMDD HH:mm
```

`<name>` is the set's name, not its id. `<who>` is the moderator's alias from
`MODERATOR_PLAYER_IDS`, or `moderator <n>`, their place in that list, for one without;
`its owner` for a set withdrawn; `a player` for a set published by someone who does not
moderate. A `playerId` is never sent. The time is the server's local time: the container's
is UTC unless `.env` sets `TZ` (`TZ=Europe/Paris`).

The server posts to `NTFY_URL`, the topic's whole URL (`https://<host>/<topic>`), with
Basic authentication where `NTFY_USER` is set (`NTFY_PASS` its password). Without
`NTFY_URL`, nothing is sent; one that is not an http(s) URL stops the start. A message is
sent and forgotten: no request waits on it, and one that ntfy refuses, or does not answer
within 10 s, is logged (`ntfy: '<name>' approved, answered 401`) and dropped. The dev
server sends none.

### Writing the site's sets

The site's sets are rows written by hand, in the store through `node:sqlite`, once their
folders are uploaded: a row with no `owner`, `approved`, its flags `0` or `1`, its
`authors` a JSON list, and `data_set_defaults`'s one row, the default set, without which
the welcome page selects nothing on a first visit. A set is added last in the list:

```bash
docker-compose exec -T csbweb node --disable-warning=ExperimentalWarning -e "
const db = new (require('node:sqlite').DatabaseSync)('/data/stats/stats.db');
db.prepare(\"INSERT INTO data_sets (id, name, dir, position, status, csb_graphics, description, authors) VALUES (?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM data_sets), 'approved', ?, ?, ?)\")
  .run('dm-atari', 'Dungeon Master', 'dm-atari', 1, 'The original.', JSON.stringify(['FTL Games']));
db.prepare('INSERT INTO data_set_defaults (only, default_set) VALUES (1, ?)').run('dm-atari');
" < /dev/null
```

and a set's description and authors are changed in place:

```bash
docker-compose exec -T csbweb node --disable-warning=ExperimentalWarning -e "new (require('node:sqlite').DatabaseSync)('/data/stats/stats.db').prepare('UPDATE data_sets SET description = ?, authors = ? WHERE id = ?').run('The original.', JSON.stringify(['FTL Games']), 'dm-atari')" < /dev/null
```

Each request reads the table, so a row is offered at once, with no restart; its folder is
checked at the next start, which a folder that is not there stops.

A file the page asks for is read when it is asked for, so replacing a data set's files
needs no restart.

### The community's dungeons

The community's CSBWin dungeons are offered to an instance by
`utils/submit-forum-dungeons.ts`, which submits each as a player publishes their own set,
pending a moderator's approval:

```bash
npx tsx utils/submit-forum-dungeons.ts --instance https://csbweb.example --player <playerId> [--dry-run]
```

It reads the Dungeon Master forum's list of custom dungeons (`viewtopic.php?t=31516`), keeps
the entries whose engines name CSBWin and that the instance does not list by name, and asks,
one at a time, with the list's authors and a description from the dungeon's topic, both
editable. Only on a yes does it download the dungeon's files, from the forum's shared
OneDrive, which keeps every dungeon of the list; it asks which archive and which of its
dungeons where there are several, checks each with the form's check, draws its thumbnail,
and skips one whose `dungeon.dat` is one of the instance's sets' (it asks again where only
the walls are the same). A dungeon without a `graphics.dat` of its own plays DM's or CSB's,
so it is refused by an instance that has neither. A RAR or 7z archive needs `7z`, `unrar`
or `bsdtar` on the PATH. The rate limit allows five publishes an hour: the script stops at
the sixth, and a run an hour later finds the first five listed, pending and the player's,
and does not offer them again.

## The files shared by link

`files/` beside the compose file holds what the author shares with a link, and
`https://csbweb.looten.net/files/<path>` downloads `files/<path>`, sub-folders included:

```bash
scp manual.pdf <vps>:csbweb/files/      # https://csbweb.looten.net/files/manual.pdf
```

A file is served as the game files are (`server/app.ts`), its type read from its extension
in any case (`CONTENT_TYPES`), `application/octet-stream` for one the table does not name,
which a browser downloads rather than shows. A missing file and a folder are 404: there is
no listing, so a link is the only way to a file, but **anyone who has the link has the
file**. A dot-file is never served. The container mounts the folder read-only, and the
server does not check it at start-up: a folder that is not there serves nothing. It is not
in the backups.

It is the game's origin: an `.html` or `.svg` put there runs its scripts beside the page,
with the players' saves in reach. Share those zipped.

## The build

`npm run build` is `tsc && vite build && vite build --ssr`. `static/` is Vite's `publicDir` for the dev server
only (`vite.config.mts`), so a build ships none of the game files, the manuals or anything
else there. The page's own files are under `src/assets/`: `favicon.ico`, named by
`index.html`, the welcome page's logo, `csbweb-logo.jpg`, imported by
`src/ui/welcomePage.ts`, and the Atari disk's FTL logo, `swoosh.img` and `swoosh.wav`,
imported by `src/main.ts`, which every set shares, so that every install has it and no
player uploads it, and the installed game's icons, named by its web app manifest,
`manifest.webmanifest`; the build hashes them, and inlines `swoosh.img`, 3 KB, in the
bundle. The manifest itself is built beside `index.html` under a name that does not change,
as a browser keeps an installed app's manifest URL (`webAppManifest`, `vite.config.mts`). A
build is `index.html`, `manifest.webmanifest` and `assets/`, about 1.4 MB, and the
server's module.

**The server's module** is the second build, `--ssr`: the page's check of a player's own
set, `checkLocalDataSet` (`src/data/LocalDataSets.ts`) and every reader under it, bundled
into one module that imports nothing, `dist/server/LocalDataSets.js` (`vite.config.mts`).
The server cannot import the page's sources as it imports `DataSets.ts`, since they are not
erasable syntax and the image has no `node_modules`, so it loads this module instead and
reads a set with the page's own readers. It is never served.

`tools/dump-build.ts` builds both into a scratch folder and asserts them: only the page's own file
types, nothing of `static/`, every file `index.html` names present, the manifest's icons too, no probe handle, and a
server's module that imports nothing and says of DM's and CSB's files, and of a file that
does not read, what the source's check says.

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
(`"type": "module"`), so that Node runs `server.ts` and the page's `DataSets.ts`, whose
routes and limits the server imports from `../src/data/`. `npm start` runs it locally, on Node 22.18 or later.

It reads `PORT` (8085), `DIST_DIR` and `GAMEFILES_DIR` (the checkout's `dist/` and
`static/gamefiles/`), `FILES_DIR` (the checkout's `files/`, which git ignores), and `STATS_DB` (the
checkout's `stats/stats.db`, which git ignores), `MODERATOR_PLAYER_IDS`, the moderators,
comma-separated `<playerId>[=<alias>]`, spaces around a comma or the `=` ignored, to whom
`api/data-sets` offers every set (unset or empty, no one; an entry that is not a
`playerId`, or whose alias is empty, stops the start), and `NTFY_URL`, `NTFY_USER`,
`NTFY_PASS` and `TZ`, for the notifications ("Notifications", above), and serves (`server/app.ts`):

| Path | What | Caching |
| --- | --- | --- |
| `/` | `dist/index.html` | `no-cache` |
| `/manifest.webmanifest` | `dist/manifest.webmanifest`, the installed game's | `no-cache` |
| `/assets/…` | `dist/assets/…`, hashed names | `immutable` |
| `/server/…` | 404: `dist/server/` is the server's module | |
| `/gamefiles/…` | `GAMEFILES_DIR/…` | `no-cache`, ETag and Last-Modified |
| `/files/…` | `FILES_DIR/…`, the files shared by link | `no-cache`, ETag and Last-Modified |
| `/api/data-sets` | the `data_sets` table's sets the `X-Player-Id` may see, as a manifest; POST: a set published | `no-store`, `Vary: X-Player-Id` |
| `/api/data-sets/<id>` | POST: the set approved, rejected, hidden or shown by a moderator, or withdrawn by its owner | `no-store` |
| `/api/data-set-walls` | the walls of those of the same sets that keep some: the published ones | `no-store`, `Vary: X-Player-Id` |
| `/api/health` | `{"ok":true}`, for the healthcheck | `no-store` |
| `/api/event` | POST: one of the page's events (`doc/STATISTICS.md`) | |
| `/api/stats` | the statistics' aggregates | `no-store` |

Every file answers a conditional GET with 304, and only GET and HEAD are allowed, except on
`api/event`, `api/data-sets`'s POST and `api/data-sets/<id>`, POST only. A path with a segment that starts with `.`, or holds a `/`, a `\` or a NUL once
decoded, is refused with 400 before it reaches the disk. A folder is 404, never a listing.

**At start-up** it opens the store (making it, and its folder, when missing), checks
that `index.html` is built, and that the game files' folder and each folder the table's
sets name exist, which may be none; then it loads the server's module (`loadCheckDataSet`, `server/app.ts`). Any failure prints `Not starting: <why>` and exits with 1, so a bad mount fails
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
  `server/`, `src/data/DataSets.ts` and the built `dist/`, the server's module in it. It runs as `USER node`, uid
  1000, the VPS's `ubuntu`, so the mounted `stats/` is writable in the container and
  readable over SSH. The exec form makes Node PID 1, which receives SIGTERM, and
  `--disable-warning=ExperimentalWarning` silences `node:sqlite`'s warning.

`npm test` needs the game files, so it is the gate before a commit, not part of the image's
build.

`docker-compose.yaml` runs `csbweb:latest` as the container `csbweb`:

- **`127.0.0.1:${CSBWEB_PORT:-8085}:8085`, loopback only.** A port published on `0.0.0.0`
  answers the whole internet whatever `ufw` says: Docker's published ports are rewritten in
  the `nat` table before `ufw`'s filter rules are consulted.
- `./files:/data/files:ro`, the files shared by link, below.
- `./gamefiles:/data/gamefiles` and `./stats:/data/stats`, bind mounts: the data lives
  on the host, and a deploy's `down` loses nothing. Both are read-write: a set a player
  publishes is written under `gamefiles/`, as its row is in the store, so both folders must
  belong to uid 1000 on the host, as the login user's do. `tools/check-image.sh` mounts each
  of the checkout's game folders read-only in a throwaway one, where the probe's publish writes.
- `restart: unless-stopped`, a 10 s `stop_grace_period`, a healthcheck on `api/health`
  (busybox's `wget`), and `json-file` logs rotated at 3 × 10 MB.
- `version: '3.8'`, for the VPS's Compose v1.

**`.env` on the VPS** is the stack's, beside the compose file, and `deploy.sh` does not copy
it. Compose reads it twice over: for `${CSBWEB_PORT}` in the compose file, and as the
container's `env_file`. So it must exist, even empty, or Compose refuses to start the
stack; and every variable in it reaches the container's environment, where it overrides
the image's own `PORT`, `DIST_DIR`, `GAMEFILES_DIR`, `FILES_DIR` and `STATS_DB`. It holds
`MODERATOR_PLAYER_IDS`, the moderators' `playerId`s (each the browser's `localStorage`
key `csbweb_player_v1`, on the site), each with an optional `=<alias>` that notifications
name them by (`<id>=Alice,<id>`), comma-separated, secrets: whoever sends one sees
every pending and hidden set. It holds `NTFY_URL`, `NTFY_USER` and `NTFY_PASS`, the ntfy
topic and its login, also secrets, and `TZ`, the time zone the notifications are dated in
("Notifications", above). A
change to it needs the
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
the checkout's game files and a throwaway stats folder, whose store
`tools/fill-data-sets.ts` fills from `tools/data-sets.json`, runs the server's module in it on DM's own files, and runs
`tools/check-frames.sh --url` against it: the golden frames, drawn by the built
page as the container serves it, must match the dev server's. The probe image is never
deployed.

## Checking it

```bash
curl -s https://csbweb.looten.net/api/health                   # {"ok":true}
curl -s https://csbweb.looten.net/api/data-sets                # the sets, as a manifest
ssh <host> 'cd ~/csbweb && docker-compose ps && docker-compose logs --tail 20'
```

A healthy start logs one line, `Listening on port 8085: /app/dist, and /data/gamefiles
(<the sets>, from the data_sets table); store in /data/stats/stats.db`, `no set` for the
sets while the table is empty.

**A container that fails to start is retried with a growing delay**: 13 s, 27 s, 51 s, then
about a minute between attempts. While it waits, `docker-compose ps` says "Restarting", even
once the cause is fixed, so a fix seems not to work for up to a minute. `docker-compose
restart` tries again at once. `docker-compose logs` shows each attempt's `Not starting:`
line; a `down` deletes the container and its log with it.

`api/health` answers as soon as the server listens; it does not re-read the files. A set's
folder moved away after a good start leaves a healthy container whose page cannot play
that set.

## Backups

The host's cron runs `server/backup.ts` in the container every night. It snapshots the
store with `node:sqlite`'s `backup` while the server keeps serving, WAL included, into one
self-contained file, `stats/backups/stats-<date>.db`, the data sets' tables with the
events. A `cp` of the live file would be unsafe: its WAL holds events the main file does
not have yet.

It then copies the folders the snapshot's sets with an owner live in, the sets players
published, into `stats/backups/gamefiles/<dir>/`. The site's folders, with no owner, are not
copied: the author uploads them by hand, from their own copy. A player's folder is whole before
its row is written and never changes after, so each is copied once, through a `.partial`
name renamed when whole, and kept for good, a deleted set's included, since a snapshot
still names it. It prints one JSON line, `backup_ok` with the folders copied and the
number kept, and exits with 1 when the store cannot be read or a folder cannot be copied
(`backup_failed`). The crontab line deletes the snapshots older than 14 days, and only
them:

```
17 3 * * * cd /home/ubuntu/csbweb && /usr/bin/docker-compose exec -T csbweb node --disable-warning=ExperimentalWarning server/backup.ts < /dev/null >> /home/ubuntu/csbweb/stats/backup.log 2>&1 && find /home/ubuntu/csbweb/stats/backups -name '*.db' -mtime +14 -delete
```

**`< /dev/null` is not optional.** `docker-compose exec -T` reads stdin. Under cron that is
harmless, but in a script fed over `ssh` it swallows the rest of the script.

`ls ~/csbweb/stats/backups/` is the check that the job runs: an empty or missing folder
means it does not. `tools/dump-server.ts` asserts the script against a running server: the
snapshot holds the events still in the WAL, the server keeps serving, and a missing store
exits 1; a player's folder is copied whole, the site's not, the next run keeps the copy,
and a player's folder that is not there exits 1.

`utils/pull-backups.sh` copies `stats/backups/` off the VPS, the snapshots and the players' folders, with `rsync`, into
`../backups/csbweb/` beside the checkout (`BACKUP_PULL_DIR` overrides it), reading the
target from the local `.env`.

**Restore:**

```bash
cd ~/csbweb
docker-compose stop
cp stats/backups/stats-<date>.db stats/stats.db
rm -f stats/stats.db-wal stats/stats.db-shm   # stale sidecars would bring the old state back
cp -rn stats/backups/gamefiles/. gamefiles/   # the players' folders a lost gamefiles/ lacks
docker-compose up -d
```

The server will not start while a folder the table names is missing (`Not starting:`), so
a restore that forgets the players' folders says so.

## Things that are true about restarts

- **The rate limit's counts are in memory**, so a restart resets them, which is harmless.
- **Nothing is lost**: every event is in `stats.db` before `api/event` answers 204, and a
  SIGTERM checkpoints the WAL. A `down` loses only the container's log.
