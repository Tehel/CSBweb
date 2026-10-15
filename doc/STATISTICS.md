# The statistics: what the game reports, and what the server keeps

The deployed game counts games: games started, won and lost, the parties that played them,
and where parties die (`doc/DEPLOYMENT.md` for where it runs). They serve three questions:
whether the game is actually played, which champions players prefer, and where parties die
most often. The page that shows them, and the FAQ that explains them to players, are to be
designed (`DEBT.md` E39).

## Anonymity is a rule of the code

No player's name, no address and no browser fingerprint (user agent, screen, language) is
sent or stored. A random id, drawn in the browser, is used only for counting players.
Champions go by the names they carry, which a player can type. The server's checks hold a
modified page to the same rule: the only text it can store is a champion's name, of 7
characters at most.

## The page's events

`src/ui/gameEvents.ts`, page-side. The engine sends nothing and stays silent; its one part
in it is `GameHost.championJoined`, which hands the page the champion and whether they were
reincarnated.

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
- `party`, `{ champions }`: the party as it stands once a champion has joined. A DM party
  is empty at the first tick and fills up in the Hall.
- `won`, `{ gameTime, playTime, champions }`: the game clock (`d.Time`, in ticks), the
  player's time in the game (`Game.playTime`, in ms), and the party, each champion with
  their four masteries as the won screen shows them, `DetermineMastery(chIdx, skill |
  0xc000)` for fighter, ninja, priest and wizard.
- `lost`, `{ gameTime, playTime, champions, level, x, y }`: the same without the
  masteries, and the square the party died on.

**A champion** is reported as `{ name, id }`, with `reincarnated: true` when they joined in
this page by REINCARNATE. The name is the one they carry, the mirror's or the one typed on
the Reincarnate screen, whether the game is played, loaded or RISE's. The id is their
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
shows them on the console, and the tools never send. `tools/dump-game-events.ts` asserts all
of it, the setting and the teleport included, on the real engine, the Hall's joins and a genuine save included, and that the server
takes every event the engine makes as the page sent it.

## What the server accepts

`api/event` takes a POST only (`server/app.ts`, `receiveEvent`):

1. **A rate limit** of 30 events a minute per address, counted in memory, comes first
   (429). The address is nginx's `X-Real-IP`, trusted only because the container's port
   is on loopback, and it is never stored.
2. **A body of at most 4 KB** (413 otherwise).
3. **`server/events.ts` checks it field by field** and rebuilds it from what passed (400
   otherwise): the player is a UUID, the build a token, the set one of the `data_sets`
   table's (`doc/DEPLOYMENT.md`), every number an integer in its range, at most four
   champions, a champion's id `null` or an `i16`, a won game's masteries four, and a
   champion's name 7 characters at most (`CHARDESC.name[8]`, `doc/CSBwin-src/CSB.h:2545`).

An event stored answers 204.

## The store

`server/stats.ts`: one `events` table, in the store's SQLite file (`server/store.ts`,
through `node:sqlite`), beside the data sets' (`doc/DEPLOYMENT.md`): when (the server's
clock), player, type, set, playthrough, build and the payload as JSON. The file is
`STATS_DB` (the checkout's `stats/stats.db`, which git ignores), made with its folder and
its schema when missing. In the container it is in the mounted `/data/stats`, never in the
container's writable layer, which every deploy's `down` loses. It runs in WAL mode, and the
server closes it on SIGTERM, which checkpoints the WAL into the file. A store that cannot be
opened stops the server before it listens. Its nightly backup is `doc/DEPLOYMENT.md`'s.

## `api/stats`

Public, not cached, and aggregates only: never an event, a player or a playthrough.

- **Use**: players ever, and per set and week (from Monday, UTC) the players and the games
  started and won (distinct playthroughs).
- **Preferred champions**: per set, the games a champion of each name was in a party of
  (`party`, `won` and `lost` events).
- **Where parties die**: lost games per set, level and square, which is enough for a heat
  map on `peek-dungeon`'s map.
- **Games won**: each one's week, game time, play time and wall time since its `started`
  (`null` when none came), and its party with their masteries.

`tools/dump-stats.ts` asserts the checks and the store's aggregates over a scripted
fortnight, and `tools/dump-server.ts` the API over HTTP and the store's life in `server.ts`.
