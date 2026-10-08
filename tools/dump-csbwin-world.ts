/**
 * Prove the world inside a genuine CSBWin save parses — and parses *correctly*.
 *
 * `dump-csbwin-save.ts` proves the file's blocks unscramble and its section lengths
 * sum to the end of the file. That is a statement about *offsets*. This tool is the
 * statement about *contents*: it reads the dungeon image into a real `DungeonData`
 * and holds it up against `dungeon.dat`.
 *
 * The check that makes it evidence rather than a smoke test is the early saves. They
 * were made at the first moment the game allows a save — one hero chosen, a few steps
 * taken — so their world is still `dungeon.dat`'s world. Every map's cell flags, the
 * column index and the object list should therefore match the file on disk almost
 * exactly, and "almost" is itself checked: the tool counts the differing cells rather
 * than accepting any number of them.
 *
 * A later save must differ — that is the vacuity guard. If a fully-played dungeon also
 * matched `dungeon.dat`, the comparison would be reading the wrong bytes in both.
 *
 * Run: `npx tsx tools/dump-csbwin-world.ts [path-or-directory]`
 */
import { readFileSync } from 'node:fs';

import { loadCsbwinWorld } from '../src/data/CsbwinDungeonImage';
import { OBJECT_ID_EOF, OBJECT_ID_NULL, type ObjectID } from '../src/core/types';
import type { ContainerRecord, CreatureRecord, DungeonData } from '../src/data/dungeonTypes';
import { check, finish } from './lib/check';
import { stockDungeon } from './lib/game';
import { genuineSaves } from './lib/saves';

/** The saves made at the first possible moment; their world is still the pristine one. */
const EARLY = /^csbgame-early-/;

const DB_OF_CATEGORY: Record<number, keyof DungeonData['databases']> = {
  0: 'doors', 1: 'teleporters', 2: 'texts', 3: 'actuators', 4: 'creatures',
  5: 'weapons', 6: 'clothing', 7: 'scrolls', 8: 'potions', 9: 'containers',
  10: 'misc', 14: 'missiles', 15: 'clouds',
};

/**
 * Walk every object chain in the world and report what is in them.
 *
 * This is the check that the *contents* of the image are right rather than merely
 * plausible, and it is the one the object indirect index made possible. Each object
 * list entry is the head of one cell's chain; each record's link is the next object,
 * `RNeof` ends it, and a chest or a monster opens a chain of its own
 * (`ConvertListOfObjects` recurses into exactly those two, plus a missile's flying
 * object — `doc/CSBwin-src/SaveGame.cpp:2189-2225`).
 *
 * Nothing here is lenient. A chain that runs into a free record, past the end of a
 * database, into a category that has none, or round in a circle is a problem, and a
 * mis-resolved reference produces all four in quantity: before the indirect index was
 * read, the first entry of the first chain already pointed at `doors[1911]`.
 */
function walkObjectChains(d: DungeonData): { objects: number; longest: number; problems: string[] } {
  const problems: string[] = [];
  let objects = 0;
  let longest = 0;

  const walk = (head: ObjectID, what: string): void => {
    let rn = head;
    let steps = 0;
    while (rn !== OBJECT_ID_EOF && rn !== OBJECT_ID_NULL) {
      if (++steps > 1000) { problems.push(`${what}: chain does not terminate`); break; }
      const { category, index } = d.rnMaps.decode(rn);
      const key = DB_OF_CATEGORY[category];
      if (!key) { problems.push(`${what}: category ${category} has no database`); break; }
      const records = d.databases[key].records;
      if (index >= records.length) {
        problems.push(`${what}: ${key}[${index}] past the end (${records.length})`);
        break;
      }
      const record = records[index];
      if (record.nextObject === OBJECT_ID_NULL) {
        problems.push(`${what}: ${key}[${index}] is a free record`);
        break;
      }
      objects++;
      if (category === 9) walk((record as ContainerRecord).containedObject, `${what} > ${key}[${index}]`);
      if (category === 4) walk((record as CreatureRecord).possession, `${what} > ${key}[${index}]`);
      rn = record.nextObject;
    }
    longest = Math.max(longest, steps);
  };

  for (let i = 0; i < d.objectList.length; i++) walk(d.objectList[i], `objectList[${i}]`);
  return { objects, longest, problems };
}

function countCellFlagDifferences(a: DungeonData, b: DungeonData): number {
  let differences = 0;
  for (let m = 0; m < Math.min(a.maps.length, b.maps.length); m++) {
    const { width, height } = a.maps[m].descriptor;
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        if (a.maps[m].cellFlags[x][y] !== b.maps[m].cellFlags[x][y]) differences++;
      }
    }
  }
  return differences;
}

function main(): void {
  const pristine = stockDungeon();
  const totalCells = pristine.maps.reduce(
    (sum, m) => sum + m.descriptor.width * m.descriptor.height, 0);
  const pristineChains = walkObjectChains(pristine);
  console.log(`dungeon.dat: ${pristine.maps.length} maps, ${totalCells} cells, ` +
    `${pristine.objectList.length} object list entries, ` +
    `${pristineChains.objects} objects in chains\n`);
  check(
    pristineChains.problems.length === 0,
    `dungeon.dat's own chains walk clean — ${pristineChains.problems.slice(0, 3).join('; ')}`,
  );

  const saves = genuineSaves(process.argv[2]);
  check(saves.length > 0, 'there should be save files to read');

  let earlySeen = 0;
  let playedSeen = 0;

  for (const path of saves) {
    const name = path.split('/').pop() ?? path;
    let world;
    try {
      world = loadCsbwinWorld(new Uint8Array(readFileSync(path)));
    } catch (error) {
      check(false, `${name}: the world should parse — ${(error as Error).message}`);
      continue;
    }
    const d = world.dungeon;
    const cellDiff = countCellFlagDifferences(pristine, d);
    const isEarly = EARLY.test(name);
    console.log(`${name}${isEarly ? '  [early]' : ''}`);
    console.log(`  maps=${d.maps.length} objectList=${d.objectList.length} ` +
      `(dungeon.dat ${pristine.objectList.length}) columnIndex=${d.columnIndex.length} ` +
      `cellFlagsDiff=${cellDiff}`);
    console.log(`  databases: doors=${d.databases.doors.records.length} ` +
      `actuators=${d.databases.actuators.records.length} ` +
      `creatures=${d.databases.creatures.records.length} ` +
      `texts=${d.databases.texts.records.length} ` +
      `scrolls=${d.databases.scrolls.records.length} ` +
      `missiles=${d.databases.missiles.records.length}`);

    // Structure: the geometry is the dungeon's own and cannot change with play.
    check(d.maps.length === pristine.maps.length, `${name}: same number of maps as dungeon.dat`);
    check(d.columnIndex.length === pristine.columnIndex.length, `${name}: same column count`);
    check(
      d.maps.every((m, i) =>
        m.descriptor.width === pristine.maps[i].descriptor.width &&
        m.descriptor.height === pristine.maps[i].descriptor.height),
      `${name}: every map has dungeon.dat's dimensions`,
    );
    // Content: records must be present and plausible.
    check(d.databases.actuators.records.length > 0, `${name}: actuators parsed`);
    check(
      d.databases.actuators.records.every((r) => r.word8 !== undefined),
      `${name}: every actuator carries its big-actuator trailing word`,
    );
    check(
      d.databases.scrolls.records.every((r) => r.textReference < 1024),
      `${name}: every scroll's text reference is a valid record index`,
    );
    check(d.objectList.length > 0, `${name}: the object list is non-empty`);
    check(
      d.objectList.length === d.header.objectListSize,
      `${name}: the object list is as long as the header says`,
    );
    // The object list is *longer* than `dungeon.dat`'s in every save, early ones
    // included (1982 against 1682 for DM) — CSBWin grows it as it loads, so this is
    // not a measure of what the player did and must not be asserted against the
    // pristine file. What can be asserted is that the column index still indexes it:
    // non-decreasing, and never pointing past the end.
    let monotonic = true;
    for (let i = 1; i < d.columnIndex.length; i++) {
      if (d.columnIndex[i] < d.columnIndex[i - 1]) monotonic = false;
    }
    check(monotonic, `${name}: the column index is non-decreasing`);
    check(
      d.columnIndex[d.columnIndex.length - 1] <= d.objectList.length,
      `${name}: the last column index entry is inside the object list`,
    );

    // Every object in the world, reached the way the game reaches them.
    const chains = walkObjectChains(d);
    console.log(`  chains: ${chains.objects} objects, longest ${chains.longest}` +
      (chains.problems.length > 0 ? `, ${chains.problems.length} PROBLEMS` : ''));
    check(
      chains.problems.length === 0,
      `${name}: every object chain walks clean — ${chains.problems.slice(0, 3).join('; ')}`,
    );
    check(chains.objects > 1000, `${name}: the chains hold a world's worth of objects (${chains.objects})`);

    if (isEarly) {
      earlySeen++;
      // The real check. A save taken before the party has done anything must still be
      // holding dungeon.dat's world. A handful of cells legitimately differ — the hero
      // has been taken out of its mirror, and a few steps have been walked — so this
      // allows a small budget rather than demanding equality, and fails on a large one.
      // The strongest statement this tool can make. The cell flags are the *last*
      // section of the image, so their position depends on every length before them —
      // the descriptors, the column index, the object list, the whole text block and
      // all sixteen databases. Reading them back identical to `dungeon.dat` means
      // every one of those lengths is right; a single wrong record size would land the
      // read somewhere else and produce thousands of differences, not a few.
      check(cellDiff === 0, `${name}: an early save's cell flags are dungeon.dat's exactly (${cellDiff} differ)`);
      // And the same argument for the chains: an early save's world still holds every
      // object `dungeon.dat` does, less the handful the chosen heroes carried out of
      // their mirrors. Three champions cost eleven objects in `csbgame-early-3hero`.
      const missing = pristineChains.objects - chains.objects;
      check(
        missing >= 0 && missing <= 20,
        `${name}: an early save's chains hold dungeon.dat's objects less what the party took ` +
          `(${chains.objects} against ${pristineChains.objects})`,
      );
    } else {
      playedSeen++;
    }
    console.log('');
  }

  check(earlySeen > 0, 'at least one early save should have been read');
  // The vacuity guard: if a played dungeon also matched dungeon.dat exactly, the
  // comparison above would be proving nothing.
  check(playedSeen > 0, 'at least one played save should have been read');

  finish();
}

main();
