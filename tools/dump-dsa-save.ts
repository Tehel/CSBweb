/**
 * A save of a dungeon with DSAs (`DEBT.md` G1, that step): the DSAs themselves, and the
 * global variables they keep in `EXPOOL`.
 *
 * 1. **`WriteDSAs`** (`doc/CSBwin-src/SaveGame.cpp:767-780`, `DSA::Write`,
 *    `doc/CSBwin-src/DSA.cpp:5672-5695`): `buildDsaSection` over the DSAs read from
 *    Conflux 3.5's `dungeon.dat` gives that file's DSA section back, byte for byte.
 * 2. **The global variables at a read** (`LoadGame`, `SaveGame.cpp:1746-1760`): sixteen
 *    to each `(EDT_Database << 24) | (EDBT_GlobalVariables << 16) | i` record, from the
 *    first up to one missing. A game on Conflux has its two records' 32; a game on
 *    `csbgame7.dat`, which has none, has none, and `GLOBALSTORE` refuses every index.
 * 3. **The global variables at a save** (`SaveGame.cpp:1141-1148`): copied into their
 *    records, which keep their place in the pool, so a second save leaves its size.
 * 4. **The round trip**: `csbgame7.dat` given three DSAs, one of them with its state
 *    moved in play, and two records of globals, saved and loaded into another game. The
 *    DSAs and the globals come back as they were.
 * 5. **3D2D1D**, a dungeon with six DSAs and no globals, saved and loaded.
 *
 * Run: `npx tsx tools/dump-dsa-save.ts`
 */
import { readFileSync } from 'node:fs';

import { Expool, readGlobalVariables } from '../src/data/CsbwinExpool';
import { buildDsaSection, readExtendedFeatures, EXTENDED_FEATURES_SIZE } from '../src/data/CsbwinExtendedFeatures';
import type { DsaDefinition } from '../src/data/dungeonTypes';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { loadSaveGameState } from '../src/data/SaveGameLoader';
import { applyCsbwinSave } from '../src/engine/CsbwinSaveGame';
import { buildSaveFile } from '../src/engine/SaveGameFile';
import { freshGame, globalStore, int } from './lib/dsa';
import { newGame, stockGraphics } from './lib/game';
import { check, finish } from './lib/check';

const CONFLUX = 'static/gamefiles/conflux-3.5-b8/dungeon.dat';
const conflux = new Uint8Array(readFileSync(CONFLUX));
const same = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a, (_k, v) => (v instanceof Uint16Array ? Array.from(v) : v)) ===
  JSON.stringify(b, (_k, v) => (v instanceof Uint16Array ? Array.from(v) : v));
const countOf = (index: { entries: unknown[] } | undefined): number => (index?.entries ?? []).filter((d) => d).length;
const globalsKey = (i: number): number => ((5 << 24) | (4 << 16) | i) >>> 0;

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

finish();
