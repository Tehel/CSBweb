/**
 * A save of a dungeon with DSAs (`DEBT.md` G1, that step): the DSAs themselves, and what
 * they keep in `EXPOOL`, the global variables and the record that disables saves.
 *
 * 1. **`WriteDSAs`** (`doc/CSBwin-src/SaveGame.cpp:767-780`, `DSA::Write`,
 *    `doc/CSBwin-src/DSA.cpp:5672-5695`): `buildDsaSection` over the DSAs read from
 *    Conflux 3.5's `dungeon.dat` gives that file's DSA section back, byte for byte.
 * 2. **The global variables at a read** (`LoadGame`, `SaveGame.cpp:1746-1760`): sixteen
 *    to each `(EDT_Database << 24) | (EDBT_GlobalVariables << 16) | i` record, from the
 *    first up to one missing. A game on Conflux has its two records' 32; a game on
 *    `csbgame7.dat`, which has none, has none, and `GLOBALSTORE` refuses every index.
 *    Conflux keeps older records under both keys, and the first of each chain is read.
 * 3. **The global variables at a save** (`SaveGame.cpp:1141-1148`): copied into their
 *    records, which keep their place in the pool, so a second save leaves its size.
 * 4. **The round trip**: `csbgame7.dat` given three DSAs, one of them with its state
 *    moved in play, and two records of globals, saved and loaded into another game. The
 *    DSAs and the globals come back as they were.
 * 5. **3D2D1D**, a dungeon with six DSAs and no globals, saved and loaded.
 * 6. **Conflux 3.5**, saved and loaded: its 64 levels, which `ReadDatabases` reads with no
 *    bound (`doc/CSBwin-src/SaveGame.cpp:2411-2427`), its 131 DSAs and its 32 globals.
 * 7. **`&DISABLESAVES`** (`doc/CSBwin-src/DSA.cpp:2945-2955`): a program's nonzero sets
 *    `disableSaves` and its 0 clears it. A save writes the record of no data that says so
 *    into the running pool (`SaveGame.cpp:1200-1201`), one more at each save, and a load
 *    sets `disableSaves` from it and reads every such record out of the loaded pool
 *    (`:1791-1793`); a save with it clear writes none, and loads with it clear.
 * 8. **The overlay palette** (`SaveGame.cpp:1151-1164`, `:1761-1789`): every save `Read`s
 *    and `Write`s its 24 records into the pool. The identity, which `ClearOverlayPalette`
 *    makes (`doc/CSBwin-src/data.cpp:117-145`), is what every genuine save holds, and
 *    written into an empty pool it is the pool of each that holds nothing else, byte for
 *    byte. So a save of a game on `dungeon.dat`, which has no pool, is CSBWin's pool. A
 *    palette changed in play comes back from a save, and a world without all 24 records,
 *    `dungeon.dat`'s, reads as the identity.
 *
 * Run: `npx tsx tools/dump-dsa-save.ts`
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

import {
  Expool, readDisableSaves, readGlobalVariables, readOverlayPalette, type ExpoolDatabase,
} from '../src/data/CsbwinExpool';
import { buildDsaSection, readExtendedFeatures, EXTENDED_FEATURES_SIZE } from '../src/data/CsbwinExtendedFeatures';
import type { DsaDefinition } from '../src/data/dungeonTypes';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { loadCsbwinWorld } from '../src/data/CsbwinDungeonImage';
import { loadSaveGameState } from '../src/data/SaveGameLoader';
import { applyCsbwinSave } from '../src/engine/CsbwinSaveGame';
import { buildSaveFile } from '../src/engine/SaveGameFile';
import { StkOp } from '../src/engine/DsaSystem';
import { identityOverlayPalette } from '../src/engine/OverlayPalette';
import { freshGame, globalStore, int, op, run } from './lib/dsa';
import { newGame, stockGraphics } from './lib/game';
import { check, finish } from './lib/check';
import { genuineSaves } from './lib/saves';

const CONFLUX = 'static/gamefiles/conflux-3.5-b8/dungeon.dat';
const conflux = new Uint8Array(readFileSync(CONFLUX));
const same = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a, (_k, v) => (v instanceof Uint16Array ? Array.from(v) : v)) ===
  JSON.stringify(b, (_k, v) => (v instanceof Uint16Array ? Array.from(v) : v));
const countOf = (index: { entries: unknown[] } | undefined): number => (index?.entries ?? []).filter((d) => d).length;
const globalsKey = (i: number): number => ((5 << 24) | (4 << 16) | i) >>> 0;
/** `(EDT_Database << 24) | (EDBT_DisableSaves << 16)` (`doc/CSBwin-src/CSB.h:1552`, `:1558`). */
const disableSavesKey = ((5 << 24) | (5 << 16)) >>> 0;

console.log('1. WriteDSAs');
{
  const read = readExtendedFeatures(conflux);
  const start = EXTENDED_FEATURES_SIZE + (read.objectIndex?.typeMap.length ?? 0) * 3;
  const written = buildDsaSection(read.dsaIndex!);
  const file = read.data.subarray(start, start + written.length);
  const dsas = read.dsaIndex!.entries.filter((dsa) => dsa).length;
  console.log(`  Conflux: ${dsas} DSAs, a section of ${written.length} bytes`);
  check(dsas === 131 && read.header?.numDSA === 131, 'Conflux defines 131 DSAs');
  check(written.length > 0 && file.every((byte, i) => byte === written[i]),
    "the DSAs written are Conflux's DSA section, byte for byte");
}

console.log('2. The global variables at a read');
{
  const data = new DungeonLoader().loadDungeonDat(new Uint8Array(conflux));
  const game = newGame(data, stockGraphics());
  const globals = game.systems.dsa.getGlobalVariables();
  console.log(`  Conflux: ${globals.length}, from [${globals.slice(0, 8).join(', ')}, …]`);
  check(globals.length === 32, "a game on Conflux has its two records' 32 global variables");
  check(same(globals, readGlobalVariables(data)) && same(globals.slice(0, 8), [0, 1, 0, 1, 3, 3, 3, 3]),
    "and each starts at its record's value");
  // Conflux's pool keeps older records under the same keys; `Locate` takes the first of
  // the chain, the newest written, and so does the read.
  const copies = (key: number): number => new Expool(data).keys().filter((k) => k === key).length;
  console.log(`  records under the two keys: ${copies(globalsKey(0))} and ${copies(globalsKey(1))}`);
  check(copies(globalsKey(0)) === 9 && copies(globalsKey(1)) === 4 &&
    same(globals.slice(0, 16), new Expool(data).locate(globalsKey(0))) &&
    same(globals.slice(16), new Expool(data).locate(globalsKey(1))),
  "Conflux holds 9 and 4 records under the globals' keys, and the globals are each chain's first");

  const csb = freshGame();
  console.log(`  csbgame7.dat: ${csb.systems.dsa.getGlobalVariables().length}`);
  check(csb.systems.dsa.getGlobalVariables().length === 0, 'a game on csbgame7.dat, with no record, has none');
}

console.log('3 and 4. The global variables at a save, and the round trip');
{
  const game = freshGame();
  const data = game.ctx.state.dungeon;
  const expool = new Expool(data);
  expool.write(globalsKey(0), new Array<number>(16).fill(0));
  expool.write(globalsKey(1), new Array<number>(16).fill(0));
  // The records a game reads: a load from a save of this world takes them.
  const values = Array.from({ length: 32 }, (_, i) => (0x1000 * i + 7) | 0);
  values[31] = -2;
  game.systems.dsa.setGlobalVariables(values);

  const program = (n: number): Uint16Array => Uint16Array.from([...int(n), globalStore(n & 31)]);
  const dsa = (description: string, localState: number, state: number): DsaDefinition => ({
    description, state, localState, groupId: 3, numStates: 4, firstDisplayedState: 1,
    states: [
      { actions: [{ column: 0, program: program(1) }, { column: 2, program: program(2) }] },
      null,
      { actions: [] },
      { actions: [{ column: 11, program: program(3) }] },
    ],
  });
  data.dsaIndex = { entries: new Array<DsaDefinition | null>(256).fill(null) };
  data.dsaIndex.entries[0] = dsa('Water Overlay', 1, 0);
  data.dsaIndex.entries[7] = dsa('a state of its actuator', 0, 0);
  data.dsaIndex.entries[255] = dsa('the last', 1, 0);
  // A DSA whose state is its own (`localState` 1) moved in play.
  data.dsaIndex.entries[255]!.state = 3;
  const before = JSON.parse(JSON.stringify(data.dsaIndex, (_k, v) => (v instanceof Uint16Array ? Array.from(v) : v)));

  const first = buildSaveFile(game);
  const blocks = data.expool!.length;
  const second = buildSaveFile(game);
  check(data.expool!.length === blocks && second.length === first.length,
    'a second save writes the globals into the same records, and the pool keeps its size');
  check(same(readGlobalVariables(data).map((v) => v | 0), values), "the records hold the game's globals once saved");
  check(loadSaveGameState(first).extendedFeatures?.numDSA === 3, "the file's header counts the three DSAs");

  const other = freshGame();
  applyCsbwinSave(other, first);
  const after = other.ctx.state.dungeon.dsaIndex;
  console.log(`  loaded: ${after?.entries.filter((d) => d).length} DSAs, ${other.systems.dsa.getGlobalVariables().length} globals`);
  check(same(after, before), 'the DSAs load back as they were saved, the moved state with them');
  check(same(other.systems.dsa.getGlobalVariables(), values), 'the 32 globals load back as they were');
}

console.log('5. 3D2D1D');
{
  const graphics = stockGraphics();
  const game = newGame(new DungeonLoader().loadDungeonDat(new Uint8Array(readFileSync('static/gamefiles/3D2D1D/dungeon.dat'))), graphics);
  const before = game.ctx.state.dungeon.dsaIndex;
  const other = freshGame();
  applyCsbwinSave(other, buildSaveFile(game));
  const after = other.ctx.state.dungeon.dsaIndex;
  console.log(`  ${after?.entries.filter((d) => d).length} DSAs loaded`);
  check(countOf(before) === 6 && same(after, before), "a 3D2D1D game saves, and loads back with its six DSAs");
}

console.log('6. Conflux 3.5');
{
  const game = newGame(new DungeonLoader().loadDungeonDat(new Uint8Array(conflux)), stockGraphics());
  const before = game.ctx.state.dungeon.dsaIndex;
  const other = freshGame();
  let error = '';
  try {
    applyCsbwinSave(other, buildSaveFile(game));
  } catch (e) {
    error = String(e);
  }
  const after = other.ctx.state.dungeon;
  console.log(`  ${error || `${after.maps.length} levels, ${countOf(after.dsaIndex)} DSAs, ${other.systems.dsa.getGlobalVariables().length} globals`}`);
  check(error === '' && after.maps.length === 64, 'a save of a Conflux game loads, its 64 levels with it');
  check(same(after.dsaIndex, before) && same(other.systems.dsa.getGlobalVariables(), game.systems.dsa.getGlobalVariables()),
    'and its 131 DSAs and 32 globals');
}

console.log('7. &DISABLESAVES');
{
  const set = run([...int(7), op(StkOp.DISABLE_SAVES)]);
  const setThen = set.game.systems.dsa.disableSaves;
  const cleared = run([...int(0), op(StkOp.DISABLE_SAVES)], (game) => { game.systems.dsa.disableSaves = true; });
  console.log(`  7, then 0: disableSaves ${setThen}, then ${cleared.game.systems.dsa.disableSaves}`);
  check(setThen && !cleared.game.systems.dsa.disableSaves, 'a nonzero sets disableSaves, and 0 clears it');

  // `run`'s test DSA is not in the header's counts, so the save is of a game of its own.
  const game = freshGame();
  game.systems.dsa.disableSaves = true;
  const records = (data: Parameters<typeof readDisableSaves>[0]): number =>
    new Expool(data).keys().filter((key) => key === disableSavesKey).length;
  const first = buildSaveFile(game);
  const second = buildSaveFile(game);
  const running = records(game.ctx.state.dungeon);
  const inFile = records(loadCsbwinWorld(first).dungeon);
  console.log(`  saved twice: ${running} records in the running pool, ${inFile} in the first file`);
  check(running === 2 && inFile === 1, 'each save writes one record more into the running pool, and the file holds them');

  const other = freshGame();
  applyCsbwinSave(other, second);
  console.log(`  loaded: disableSaves ${other.systems.dsa.disableSaves}, ${records(other.ctx.state.dungeon)} records left`);
  check(other.systems.dsa.disableSaves && records(other.ctx.state.dungeon) === 0,
    'a load sets disableSaves from the records, and reads every one out of the pool');

  other.systems.dsa.disableSaves = false;
  const clear = buildSaveFile(other);
  const back = freshGame();
  back.systems.dsa.disableSaves = true;
  applyCsbwinSave(back, clear);
  check(records(loadCsbwinWorld(clear).dungeon) === 0 && !back.systems.dsa.disableSaves,
    'a save with it clear writes no record, and loads with it clear');
}

console.log('8. The overlay palette');
{
  const sameBytes = (a: Uint8Array | null | undefined, b: Uint8Array): boolean =>
    !!a && a.length === b.length && a.every((v, i) => v === b[i]);
  const paletteKey = (i: number): number => ((7 << 24) + i) >>> 0;
  const identity = identityOverlayPalette();
  const emptyPool = (): ExpoolDatabase => ({ header: { objectCounts: new Array<number>(16).fill(0) } });
  const stored = emptyPool();
  new Expool(stored).storeOverlayPalette(identity);
  const identityPool = stored.expool!;

  let alone = 0;
  for (const path of genuineSaves()) {
    const file = basename(path);
    const { dungeon } = loadCsbwinWorld(new Uint8Array(readFileSync(path)));
    check(sameBytes(readOverlayPalette(dungeon), identity), `${file}: its 24 records read as the identity`);
    if (new Expool(dungeon).keys().length === 24) {
      check(sameBytes(dungeon.expool, identityPool),
        `${file}: the identity stored into an empty pool is its ${identityPool.length} bytes`);
      alone++;
    }
  }
  console.log(`  the identity is every genuine save's palette, and ${alone} pools hold it alone`);
  check(alone >= 5, `at least five pools are the palette records alone (${alone})`);

  const dat = (): Uint8Array => new Uint8Array(readFileSync('static/gamefiles/dm-atari/dungeon.dat'));
  const game = newGame(new DungeonLoader().loadDungeonDat(dat()), stockGraphics());
  check(game.ctx.state.dungeon.expool === undefined && sameBytes(game.ctx.overlayPalette, identity),
    "a game on dm-atari's dungeon.dat, which has no pool, has the identity");
  const written = loadCsbwinWorld(buildSaveFile(game)).dungeon;
  console.log(`  its save: a pool of ${written.header.objectCounts[11]} blocks`);
  check(written.header.objectCounts[11] === 9 && sameBytes(written.expool, identityPool),
    "and its save holds the directory and the 24 records, CSBWin's pool");

  // `&PALETTE` is G25's: the palette is changed in place, as `SetOverlayPalette` does.
  const changed = Uint8Array.from(identity, (_v, i) => (7 * i + 3) & 0xff);
  game.ctx.overlayPalette.set(changed);
  const file = buildSaveFile(game);
  const other = freshGame();
  applyCsbwinSave(other, file);
  check(sameBytes(other.ctx.overlayPalette, changed), 'a palette changed in play loads back as it was saved');

  const partial = loadCsbwinWorld(file).dungeon;
  new Expool(partial).read(paletteKey(23));
  check(readOverlayPalette(partial) === null, 'a pool short of one record has no palette');
  other.readNewGame(new DungeonLoader().loadDungeonDat(dat()));
  check(sameBytes(other.ctx.overlayPalette, identity), 'and a new game read over a changed palette has the identity');
}

finish();
