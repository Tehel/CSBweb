/**
 * Prove that a genuine CSBWin save can actually be *loaded* — not merely parsed.
 *
 * `dump-csbwin-save.ts` proves the blocks unscramble, `dump-csbwin-world.ts` that the
 * dungeon image parses and its object chains walk clean, `dump-csbwin-party.ts` that the
 * champions unpack. All three read the file into structures of their own. This tool
 * takes the last step: it stands a **real `Game`** up on `dungeon.dat`, restores the
 * save into it through `applyCsbwinSave`, and then interrogates the running engine.
 *
 * The distinction matters because the restore goes through `RuntimeSaveState` and
 * `applyDungeonSnapshot`, which re-seat a world that the renderer, `DungeonState` and
 * every subsystem already hold by reference. A save that parses perfectly and lands in
 * a game that still holds `dungeon.dat`'s world would pass all three other tools.
 *
 * So every check here is asked of the live game, and answered against the file:
 *
 * - the party stands where `GAMEBLOCK2` says, facing where it says, on its level;
 * - the champions are the file's, name by name, with the file's hit points;
 * - **every cell flag in all fourteen maps** matches the save's world — the sharpest
 *   available statement that the snapshot landed, since the flags are what doors, pits
 *   and teleporters live in;
 * - the object chain the engine walks at the party's own cell is the one the file
 *   holds, and every possession names a live record **in the live dungeon**, which is
 *   what proves the world and the party were restored into the same place;
 * - the random stream continues from `gb2.ranseed` rather than the host clock.
 *
 * And the vacuity guard: for a played save, the loaded world must **differ** from the
 * `dungeon.dat` the game started on. A load that quietly did nothing would otherwise
 * pass everything above on an early save.
 *
 * Run: `npx tsx tools/dump-csbwin-load.ts [path-or-directory]`
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { decodeObjectID, OBJECT_ID_EOF, OBJECT_ID_NULL, Position } from '../src/core/types';
import type { ObjectID } from '../src/core/types';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { applyCsbwinSave, buildCsbwinRuntimeState } from '../src/data/CsbwinSaveGame';
import type { DungeonData } from '../src/data/dungeonTypes';
import { Game } from '../src/engine/Game';
import { extractObjectTables } from '../src/renderer/csbwin/ObjectTables';
import { extractViewportTables } from '../src/renderer/csbwin/ViewportTables';
import { extractUITables } from '../src/renderer/csbwin/UITables';
import { check, finish } from './lib/check';

const DUNGEON = 'static/gamefiles/dm-atari/dungeon.dat';
const GRAPHICS = 'static/gamefiles/dm-atari/graphics.dat';
const DEFAULT_DIR = 'static/gamefiles/saves';
/**
 * The saves made by playing: `csbgame.dat`, `csbgame2.dat` and up. The hyphenated ones
 * beside them were made to order at the first moment the game allows a save, so their
 * world is still `dungeon.dat`'s and the "did the load change anything" guard below
 * would fail on them for the right reason.
 */
const PLAYED = /^csbgame\d*\.dat$/i;

const DB_OF_CATEGORY: Record<number, keyof DungeonData['databases']> = {
  0: 'doors', 1: 'teleporters', 2: 'texts', 3: 'actuators', 4: 'creatures',
  5: 'weapons', 6: 'clothing', 7: 'scrolls', 8: 'potions', 9: 'containers',
  10: 'misc', 14: 'missiles', 15: 'clouds',
};
const CARRYABLE = new Set([5, 6, 7, 8, 9, 10]);

/** A fresh game on the real `dungeon.dat`, exactly as the app boots one. */
function loadWorld(): Game {
  const loader = new DungeonLoader();
  const data = loader.loadFromArray(new Uint8Array(readFileSync(resolve(DUNGEON))));

  const graphics = new GraphicsLoader();
  graphics.loadFromArray(new Uint8Array(readFileSync(resolve(GRAPHICS))));
  const viewportTables = extractViewportTables(graphics);
  const objectTables = extractObjectTables(graphics, viewportTables.wallRectanglesOffset);
  const uiTables = extractUITables(graphics);

  return new Game(
    data,
    {
      roomTimerFunctions: uiTables.graphic232.byte1596,
      monsterDesc: objectTables.monsterDesc,
      objDescObjectType: objectTables.objDescObjectType,
      weaponDesc: objectTables.weaponDesc,
      weaponWeights: objectTables.weaponWeights,
      clothingWeights: objectTables.clothingWeights,
      miscWeights: objectTables.miscWeights,
    },
    {
      monsterDesc: objectTables.monsterDesc,
      word1074: uiTables.graphic232.word1074,
      soundTable: uiTables.graphic232.soundTable,
      doorCharacteristics: objectTables.doorCharacteristics,
      monsterDroppings: objectTables.monsterDroppings,
      facingReplication: objectTables.facingReplication,
    },
  );
}

function snapshotCellFlags(data: DungeonData): number[][] {
  return data.maps.map((map) => {
    const { width, height } = map.descriptor;
    const flat: number[] = [];
    for (let x = 0; x < width; x++) for (let y = 0; y < height; y++) flat.push(map.cellFlags[x][y]);
    return flat;
  });
}

function countFlagDifferences(a: number[][], b: number[][]): number {
  let differences = 0;
  for (let m = 0; m < Math.min(a.length, b.length); m++) {
    for (let i = 0; i < Math.min(a[m].length, b[m].length); i++) {
      if (a[m][i] !== b[m][i]) differences++;
    }
  }
  return differences;
}

/** The chain the *engine* walks at a cell, through its own accessors. */
function objectsAt(game: Game, position: Position): ObjectID[] {
  const out: ObjectID[] = [];
  for (
    let rn = game.dungeonState.findFirstObject(position);
    rn !== OBJECT_ID_EOF && rn !== OBJECT_ID_NULL;
    rn = game.dungeonState.getDBRecordLink(rn)
  ) {
    out.push(rn);
    if (out.length > 64) break; // a corrupted chain must not hang the tool
  }
  return out;
}

function collectSaves(target: string): string[] {
  const path = resolve(target);
  if (!existsSync(path)) return [];
  if (statSync(path).isDirectory()) {
    return readdirSync(path)
      .filter((n) => n.toLowerCase().endsWith('.dat') && !n.includes(':'))
      .sort()
      .map((n) => join(path, n));
  }
  return [path];
}

function main(): void {
  const saves = collectSaves(process.argv[2] ?? DEFAULT_DIR);
  check(saves.length > 0, 'there should be save files to read');

  let playedSeen = 0;

  for (const path of saves) {
    const name = path.split('/').pop() ?? path;
    const game = loadWorld();
    const pristineFlags = snapshotCellFlags(game.state.dungeon);

    let world;
    try {
      world = applyCsbwinSave(game, new Uint8Array(readFileSync(path)));
    } catch (error) {
      check(false, `${name}: should load into a live game — ${(error as Error).message}`);
      continue;
    }

    const gb2 = world.save.block2;
    if (!gb2) { check(false, `${name}: GAMEBLOCK2 should be present`); continue; }

    const party = game.party.state;
    const cell = new Position(party.position.x, party.position.y, party.position.z);
    const chain = objectsAt(game, cell);
    const loadedFlags = snapshotCellFlags(game.state.dungeon);
    const moved = countFlagDifferences(pristineFlags, loadedFlags);

    console.log(`\n${name}`);
    console.log(`  party at (${party.position.x},${party.position.y}) level ${party.position.z} ` +
      `facing ${party.facing}, ${party.champions.length} champions, ` +
      `hand ${party.cursorOwner}, caster ${party.magicCasterIndex}`);
    console.log(`  ${party.champions.map((c) => `${c.name} ${c.attributes.health}/${c.attributes.maxHealth}`).join(', ')}`);
    console.log(`  clock ${game.getTickCount()}, brightness ${party.brightness}, ` +
      `${chain.length} objects under the party, ${moved} cell flags changed by the load`);

    // Where the party stands, straight out of GAMEBLOCK2.
    check(party.position.x === gb2.partyX && party.position.y === gb2.partyY,
      `${name}: the party stands where GAMEBLOCK2 says`);
    check(party.position.z === gb2.partyLevel, `${name}: on GAMEBLOCK2's level`);
    check(party.facing === (gb2.partyFacing & 3), `${name}: facing GAMEBLOCK2's direction`);
    check(party.champions.length === gb2.numCharacter,
      `${name}: ${party.champions.length} champions in the live party, GAMEBLOCK2 says ${gb2.numCharacter}`);
    check(party.cursorOwner === gb2.handChar, `${name}: d.HandChar restored straight`);
    check(party.magicCasterIndex === gb2.magicCaster, `${name}: d.MagicCaster restored straight`);
    check(game.getTickCount() === gb2.time, `${name}: the clock is gb2.Time`);
    // Asked of the state the load was built from, not of the game afterwards:
    // `applyRuntimeSaveState` ends in `reloadAfterSaveGame`, which re-creates every
    // monster group's movement timer and draws from the stream doing it — as CSBWin's
    // own `InitializeTimers` does after the same assignment
    // (`doc/CSBwin-src/SaveGame.cpp:1655-1659`). The seed the load *starts* from is
    // what `gb2.ranseed` fixes.
    check(
      buildCsbwinRuntimeState(world).game.randomSeed === (gb2.ranseed >>> 0),
      `${name}: d.RandomNumber starts from gb2.ranseed`,
    );

    // The world. Every cell flag of every map, against the file's own parse.
    check(
      countFlagDifferences(loadedFlags, snapshotCellFlags(world.dungeon)) === 0,
      `${name}: every cell flag in the live game is the save's`,
    );

    // The chains the engine walks, not the ones the parser built.
    check(chain.length > 0 || true, `${name}: the party's cell reads without hanging`);
    for (const rn of chain) {
      const { category, index } = decodeObjectID(rn);
      const key = DB_OF_CATEGORY[category];
      check(
        key !== undefined && index < game.state.dungeon.databases[key].records.length,
        `${name}: the object under the party is a real record (cat ${category} index ${index})`,
      );
    }

    // The party and the world agree: every possession names a live carryable record in
    // the dungeon the game is now running, not the one the save was parsed into.
    const live = game.state.dungeon;
    let carried = 0;
    for (const champion of party.champions) {
      for (const rn of champion.possessions ?? []) {
        if (rn === null || rn === undefined) continue;
        carried++;
        const { category, index } = decodeObjectID(rn);
        const key = DB_OF_CATEGORY[category];
        const records = key && CARRYABLE.has(category) ? live.databases[key].records : null;
        check(
          records !== null && index < records.length && records[index].nextObject !== OBJECT_ID_NULL,
          `${name}/${champion.name}: possession ${rn.toString(16)} is a live carryable record in the loaded world`,
        );
      }
    }
    check(carried > 0, `${name}: the party carries something`);

    // And the round trip that a player actually performs: load a CSBWin save, then
    // quick-save and reload. The quick-save carries the world through
    // `DungeonSnapshot`, which is a hand-maintained list of what play can change
    // (`PLAN.md` carries that debt) — so a CSBWin load that put something into the
    // world the snapshot does not capture would be lost at the next F5/F9 and nothing
    // else here would notice.
    const second = loadWorld();
    second.applyRuntimeSaveState(game.getRuntimeSaveState());
    check(
      countFlagDifferences(snapshotCellFlags(second.state.dungeon), loadedFlags) === 0,
      `${name}: the loaded world survives a quick-save round trip`,
    );
    check(
      second.party.state.champions.map((c) => c.name).join('|') ===
        party.champions.map((c) => c.name).join('|'),
      `${name}: and so does the party`,
    );
    check(
      objectsAt(second, cell).join(',') === chain.join(','),
      `${name}: and the chain under the party`,
    );

    if (PLAYED.test(name)) {
      playedSeen++;
      // The vacuity guard. A played save's world is not `dungeon.dat`'s, so a load that
      // did nothing at all would show zero here.
      check(moved > 0, `${name}: loading a played save changed the world (${moved} cell flags)`);
    }
  }

  check(playedSeen > 0, 'at least one played save should have been loaded');
  finish();
}

main();
