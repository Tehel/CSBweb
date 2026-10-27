# The statistics: what the game reports, and what the server keeps

The deployed game counts games: games started, won and lost, the time played in them, the
parties that played them, and where parties die (`doc/DEPLOYMENT.md` for where it runs).
They serve three questions: whether the game is actually played, which champions players
prefer, and where parties die most often. The statistics page shows them ("The page", below), and the
welcome page's ABOUT (`src/ui/about.ts`) explains them to players, in this document's terms.

## Pseudonymous

No player's name, no address and no browser fingerprint (user agent, screen, language) is
sent with an event or stored with the statistics. A random id, drawn in the browser, is
used only for counting players: the statistics are pseudonymous, the id linking one
player's games, and a player who clears the site's data is given a new one (below).
Champions go by the names they carry, which a player can type. The server's checks hold a
modified page to the same rule: the only text it can store is a champion's name, of 7
characters at most, each one a name's.

The host's nginx keeps its access log (`doc/DEPLOYMENT.md` → "The site"), as any site's
does: every request's address, user agent and time, to the second, each `POST /api/event`
among them. So that a stored time does not name one request of that log, every time the
store keeps is rounded down to 10 s (`TIME_GRAIN`, `server/stats.ts`): an event's, and a
game's start and win. The answers count days and weeks, which it changes nothing of. Ten
seconds blurs the link rather than cutting it: in a quiet ten seconds, one request is the
one event.

## The page's events

`src/ui/gameEvents.ts`, page-side. The engine sends nothing and stays silent; its one part
in it is `GameHost.championJoined`, which hands the page the champion, whether they were
reincarnated, and the name their mirror's text gives them (`JoinedChampion.hero`).

**The player id** (`playerId`) is a `crypto.randomUUID()` drawn at first start and kept in
`localStorage` (`csbweb_player_v1`). If the player clears it, the page draws a new one, and
that is accepted: the id is for counting players, not for knowing who they are. There is no
`visit` event: the player id appears only with a game. It is also what says who owns a
set uploaded to the site (`doc/DEPLOYMENT.md` → "The game files and the manifest"), so it
is a secret: the server returns none and logs none.

**A game is its playthrough** (`doc/SAVES.md` → "A playthrough"), `d.RandomGameID`, so one
game's events link up across loads, sessions and imports. Each event is
`{ type, player, set, playthrough, build, payload }`, the build being the commit, or
`CSBWEB_BUILD` where the build is given one (`vite.config.mts`'s `__CSBWEB_BUILD__`):

- `started`, `{}`: a new game's first tick. A new game is the boot's or the end screen's
  `readNewGame`, or RISE's adventure read (the entrance's, or the prison's BEGIN THE
  ADVENTURE).
- `session`, `{ playTime }`: the first tick after a game is entered, a new game (after its
  `started`), the welcome page's CONTINUE or a save read at the entrance or by the disk
  menu, with the play time it entered with (`Game.playTime`, in ms, read at the read): 0
  for a new game, a save's own (`SaveEntry.playTime`). Once a page and playthrough
  (`GameEvents.entered`), so that F9 and the disk menu's loads of the same game do not
  count again. It is what ranks the sets, the time played in them, where `started` counts
  a game once however long it lasts. The server keeps no row of it (below).
- `party`, `{ champions }`: the party as it stands once a champion has joined. A DM party
  is empty at the first tick and fills up in the Hall.
- `won`, `{ gameTime, playTime, champions }`: the game clock (`d.Time`, in ticks), the
  player's time in the game (`Game.playTime`, in ms), and the party, each champion with
  their four masteries as the won screen shows them, `DetermineMastery(chIdx, skill |
  0xc000)` for fighter, ninja, priest and wizard.
- `lost`, `{ gameTime, playTime, champions, level, x, y }`: the same without the
  masteries, and the square the party died on.

**A champion** is reported as `{ name, id }`, with `reincarnated: true` and `hero`, the
mirror's name, when they joined in this page by REINCARNATE. The name is the one they
carry, the mirror's or the one typed on the Reincarnate screen, whether the game is played,
loaded or RISE's. A champion read from a save carries no `hero`: a save keeps the typed
name alone, as CSBWin's does. The id is their
portrait's `charID` (`Champion.portraitGraphic`: a cell of graphic 26, or past 23 a
`CSBgraphics.dat` portrait), and `null` for a champion read from a save, who carries the
portrait's pixels and no id, as in CSBWin. It is stored and not used yet: it is there for a
portrait beside a name, which the page can draw from its own data files, or the manifest
could list.

**The player can turn them off.** The player's settings (`src/settings/Settings.ts`, kept
in `localStorage` as `csbweb_settings_v2`) carry `statistics`, on by default: an opt-out.
`GameEvents` reads it at each event (`GameEventsDeps.enabled`), so a change counts from the
next one, and with it off nothing is read or sent, the player id not even drawn. The
settings dialog's GAME tab sets it, SEND STATISTICS (`src/renderer/ui/SettingsDialog.ts`).

**A teleport silences a game.** On a page opened with `?dev`, a click on the map dialog's
square moves the party there (`onTeleport`, `src/main.ts`), and the move down and up keys
take it a level down or up whatever is there (`onDevLevel`, `Game.devChangeLevel`); a
game played so counts for nothing. `GameEvents.teleported` marks its playthrough, kept in `localStorage`
(`csbweb_teleported_v1`, the latest 64, or for the page alone where it cannot be kept),
and no event of that playthrough is sent from then on, in that page or in a later one
that reads a save of it.

Events are sent with `navigator.sendBeacon` to `api/event`, and a failure is ignored:
nothing an event does delays or breaks the game. Only a production build sends them; dev
shows them on the console, and the tools never send. `tools/checks/game-events.ts` asserts all
of it, the setting and the teleport included, on the real engine, the Hall's joins and a genuine save included, and that the server
takes every event the engine makes as the page sent it.

## What the server accepts

`api/event` takes a POST only (`server/app.ts`, `receiveEvent`):

1. **Not from another site** (403): a POST whose `Sec-Fetch-Site` is neither `same-origin`
   nor `none`, or whose `Origin` is not the host it asks, is refused before anything else
   (`isCrossSite`), as on every POST route. `sendBeacon` sends a simple request, which any
   page could otherwise make its visitors' browsers send, each one a rate limit's bucket.
   A client that sends neither header, which no browser is, is heard.
2. **A rate limit** of 30 events a minute per address, counted in memory, comes next
   (429). The address is nginx's `X-Real-IP`, trusted only because the container's port
   is on loopback, and it is never stored. An IPv6 address counts by its /64, which a host
   is given whole, and an IPv4-mapped one as its IPv4 (`addressBucket`).
3. **A body of at most 4 KB** (413 otherwise).
4. **`server/events.ts` checks it field by field** and rebuilds it from what passed (400
   otherwise): the player is a UUID, the build a token, the set one of the `data_sets`
   table's (`doc/DEPLOYMENT.md`), every number an integer in its range, at most four
   champions, a champion's id `null` or an `i16`, a won game's masteries four, a `hero`
   only beside `reincarnated`, and a champion's name and `hero` 7 characters at most (`CHARDESC.name[8]`, `doc/CSBwin-src/CSB.h:2545`),
   not blank, and made of A to Z, the space and the Reincarnate screen's `. , ; :`, or for
   a save edited elsewhere the accented capitals À to Ý, the digits and `! ? ' - /`
   (`NAME`): no control character, bidi override, NUL or markup reaches `api/stats`.
5. **A budget of 10,000 events a day**, every address together, counted in memory
   (`EVENTS_PER_DAY`, `server/server.ts`; 429), so that no number of addresses grows the
   store by more than a few MB a day.
6. **A full log** refuses the event (507): at 500,000 rows (`MAX_EVENTS`,
   `server/stats.ts`), about 140 MB at the 280 bytes an event `tools/checks/stats.ts`
   measures, aggregates included, kept in every nightly backup. A `session`, which is no
   row of it, still counts.

An event taken answers 204, and so does a game's second `started` or `won` (below).

## The store

`server/stats.ts`: one `events` table, in the store's SQLite file (`server/store.ts`,
through `node:sqlite`), beside the data sets' (`doc/DEPLOYMENT.md`): when (the server's
clock), player, type, set, playthrough, build and the payload as JSON. The file is
`STATS_DB` (the checkout's `stats/stats.db`, which git ignores), made with its folder and
its schema when missing. In the container it is in the mounted `/data/stats`, never in the
container's writable layer, which every deploy's `down` loses. It runs in WAL mode, and the
server closes it on SIGTERM, which checkpoints the WAL into the file. A store that cannot be
opened stops the server before it listens. Its nightly backup is `doc/DEPLOYMENT.md`'s.

The `events` table is the log. What `api/stats` answers is kept beside it as the events
arrive, in the event's own transaction, so that no answer reads the log:

**A game's `started` and `won` are kept once each**, the first: a later one, a save of the
game read again or an earlier save won again, is no row of the log and changes nothing,
its party no pick (a unique index, `events_once`). A `lost` is kept every time.

- `games`, a row per set and playthrough: its first event's player (for counting, never
  answered), its first `started`'s time, and its first `won`'s time, game clock, play time
  and party.
- `deaths`, the `lost` events per set and square: every one, as a party that dies, reloads
  and dies again shows where the dungeon is hard.
- `picks`, the champions ever in a game's party, from its `party`, `won` and `lost`
  events, by their mirror's name: a reincarnated champion's `hero`, so that the names typed
  at REINCARNATE count as the champions they renamed. Each row keeps the party's slot it was
  reported in. A champion read from a save (`id` null), who may carry a typed name and no
  `hero`, counts only where their slot has no row: their join, if it was seen, named them
  already. One whose join was not seen, an imported CSBWin save's, counts by the name they
  carry.
- `sessions`, the `session` events per set and week (from Monday, UTC): a counter.
- `games.played`, each game's play time, the largest its `session`, `won` and `lost` events
  reported, whose sum is a set's time played. It lags a session: a session reports what
  came before it, and the time it starts is counted by the next one, or by the game's end.

**A `session` is never a row of `events`**, nor of `games`: no player and no time is kept
of it, which would be the player's habits. It adds one to its week's count, and raises its
game's `played` where the game has a row, made by its other events. A session of a game
with none, an imported save's, which sent no `started`, counts in its week alone, and its
time played is its `won` or `lost` event's.

A store without these tables is given them, filled once from its `events`, in the order
they arrived; one without `played` and `sessions` is given them, `played` from its `won`
and `lost` events; one whose `picks` has no `slot` is given them again from its `events`.
One made before `events_once` keeps the first `started` and `won` of each game, and is
given its picks again, where it dropped a `won`.
The events sent before `hero` count a reincarnated champion by their typed name. The sessions before then are lost: the log never held them.

## `api/stats`

Public and aggregates only: never an event, a player or a playthrough, and nothing of a set
that is pending or hidden. Every answer is kept 30 s and says so (`Cache-Control: public,
max-age=30`, `AnswerCache`), so that a loop of requests costs a lookup; making one again is
a few indexed queries, about 0.1 s at 200,000 events.

- **`api/stats`**, the public sets: players ever, time played (`playTime`, ms), sessions,
  games started and won, sessions and games started per week (from Monday, UTC), and each
  set's time played, sessions, games started and won and deaths, by time played,
  decreasing, then by games started, decreasing, then by name.
- **`api/stats/<id>`**, a public set (404 for any other): its players, time played,
  sessions, games started and won, games with a party and deaths; its ten fastest wins by game clock, then the earlier, then the game first received,
  each its day, game clock, play time and party with their masteries; its deaths per level;
  its twenty most picked champions, by their mirror's name (`picks`), with the games they
  were in and won; its sessions, games
  started and games won per week.
- **`api/stats/<id>/<level>`**, the level as its decimal number below 256: the deaths on
  each of its squares, the most first, at most 1,024, which is enough for a heat map on
  `peek-dungeon`'s map.

A win is ranked among the fastest only if its game's `started` came, and its game clock is
one its play time could run: a tick at most each VBL, which sleep reaches, at 60 VBLs a
second, and a second's slack (`CLOCK_SLACK_TICKS`). A game read from an imported CSBWin
save, which sent no `started` and carries no play time, is a win and is not ranked.

`tools/checks/stats.ts` asserts the checks, the rate limit's buckets, the store's aggregates over a scripted fortnight,
its sessions in no row of the log or of `games`, a game's second `started` and `won` in none either, a full log, every time to 10 s, the same but the sessions' made from the
log alone and for a store made before the sessions, the picks' slots, `events_once` or the 10 s, the cache, and every answer's time and size over 200,000
events, with the bytes an event costs; `tools/checks/server.ts` the API over HTTP, the limits and the budget included, and the store's life in `server.ts`.

## The page

`/stats` (`stats.html`, Vite's second entry, `src/stats/statsPage.ts`), linked from the
welcome page's footer (STATS): HTML in the welcome page's look, and none of the game's
code (`tools/checks/build.ts` holds it to a few KB of script). Its charts are CSS bars, the
count of each on hover. Everything it shows is `api/stats`'s:

- **A band across the top**, every set together: players, hours played, games started and
  won, and the sessions per week.
- **A column of the sets**, in `api/stats`'s order, each its name, its hours and its games
  started. A click selects one, `?set=<id>` in the URL (the column's first without it),
  and the rest of the page is that set's (`api/stats/<id>`):
- **The selected set**: its hours played, games started and won, deaths and players; its
  fastest wins, each its rank, its game time as `H:MM:SS` of the game clock (a tick 15
  VBLs, as the game runs awake), its play time, its party, a champion who joined by
  REINCARNATE marked `*`, a solo win badged, and its day; its deaths per level, a row a
  level from LEVEL 1 to the deepest died on, as the map dialog numbers them; its preferred
  champions, by their mirror's name, each their share of the games with a party, and their win rate once in 10
  games; and its sessions, games started and games won per week.

A chart of weeks runs from the first week answered to the current one, the weeks without
one at zero, the latest 52 at most.

What is left of it is the heat map (`DEBT.md` E40). The dev server answers `api/stats`
over the scripted fortnight of `tools/checks/stats.ts` (`tools/lib/statsFortnight.ts`), so
that the page has something to show; `tools/probe-frames.mjs` checks the page against what
`api/stats` answers, whatever the store holds.
