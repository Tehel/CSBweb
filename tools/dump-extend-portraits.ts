/**
 * `ExtendPortraits`: the Hall of Champions mirrors put into CSBWin's own form after a read.
 *
 * `_ReadEntireGame` calls it once the whole file is read, unless the file's Extended
 * Features block carried `ExpandedPortraits` (`doc/CSBwin-src/SaveGame.cpp:1503-1527`,
 * `:2030`, the flag reset at `:1563` and read at `:405`). It zeroes `word4` bits 0-11 and
 * the whole of `word6` of every live type-127 actuator.
 *
 * - `dm-atari/dungeon.dat` has no block, so its 24 mirrors are cleaned: every one carries
 *   leftover bits, and mirror 286's reads `State` = 4, `PORTRAIT_HideGraphic`. Nothing
 *   else in the world moves: it is compared, database by database, with the same file
 *   read as if its block had carried the flag.
 * - Every committed save carries the flag, so its mirrors come through as written. The
 *   ones started from the DM Windows package's `dungeon.dat` hold mirrors whose
 *   `Position` (`word6` bits 12-13) is set, which a cleaning would zero: that is the gate's
 *   evidence.
 * - CSB's Atari-era saves have no block, so they would be cleaned; they hold no mirror.
 *
 * Run: `npm test -- --only=dump-extend-portraits.ts`
 */
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

import { OBJECT_ID_NULL } from '../src/core/types';
import { loadCsbwinWorld } from '../src/data/CsbwinDungeonImage';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { getActuatorPosition, getActuatorState, getActuatorType } from '../src/data/actuatorHelpers';
import type { ActuatorRecord, Database, DungeonData } from '../src/data/dungeonTypes';
import { check, finish } from './lib/check';
import { genuineSaves } from './lib/saves';

const DUNGEON = 'tools/fixtures/gamefiles/dm-atari/dungeon.dat';
const ATARI_SAVES = ['tools/fixtures/gamefiles/csb/mini.dat', 'tools/fixtures/gamefiles/csb/csbgame2.dat'];
/** Champion 20's mirror, level 0 at (17,10): the one whose leftover bits hide its frame. */
const MIRROR_286 = 286;
const PORTRAIT_HIDE_GRAPHIC = 4;

const hex = (w: number) => w.toString(16).padStart(4, '0');

function mirrors(data: DungeonData): number[] {
  const out: number[] = [];
  data.databases.actuators.records.forEach((r, i) => {
    if (r.nextObject !== OBJECT_ID_NULL && getActuatorType(r) === 127) out.push(i);
  });
  return out;
}

function portraitBits(r: ActuatorRecord): boolean {
  return (r.word4 & 0x0fff) !== 0 || r.word6 !== 0;
}

/* ------------------------------------------------------------------ dungeon.dat --- */

const bytes = new Uint8Array(readFileSync(resolve(DUNGEON)));
// The same file read as if its block had carried the flag: every conversion, no cleaning.
const kept = new DungeonLoader().loadFromArray(bytes, { expandedPortraits: true });
const cleaned = new DungeonLoader().loadFromArray(bytes);

const found = mirrors(kept);
console.log(`dungeon.dat: ${found.length} mirrors (live type-127 actuators)`);
check(found.length === 24, `dungeon.dat has 24 mirrors (${found.length})`);
const dirty = found.filter((i) => portraitBits(kept.databases.actuators.records[i]));
console.log(`  with leftover portrait bits before ExtendPortraits: ${dirty.length}`);
for (const i of found) {
  const before = kept.databases.actuators.records[i];
  const after = cleaned.databases.actuators.records[i];
  console.log(`  ${String(i).padStart(3)}  word2 ${hex(before.word2)}  ` +
    `word4 ${hex(before.word4)} -> ${hex(after.word4)}  word6 ${hex(before.word6)} -> ${hex(after.word6)}`);
  check(!portraitBits(after), `mirror ${i}: word4 bits 0-11 and word6 are zero`);
  check(after.word2 === before.word2, `mirror ${i}: the type/value word is kept`);
  check((after.word4 & 0xf000) === (before.word4 & 0xf000), `mirror ${i}: the wall graphic ordinal is kept`);
  check(after.nextObject === before.nextObject && after.word8 === before.word8,
    `mirror ${i}: its link and word8 are kept`);
}

const m286 = kept.databases.actuators.records[MIRROR_286];
const c286 = cleaned.databases.actuators.records[MIRROR_286];
console.log(`\nmirror ${MIRROR_286}: State ${getActuatorState(m286)} -> ${getActuatorState(c286)}`);
check(getActuatorType(m286) === 127 && getActuatorState(m286) === PORTRAIT_HIDE_GRAPHIC,
  `mirror ${MIRROR_286} reads State = PORTRAIT_HideGraphic in the file`);
check(getActuatorState(c286) === 0, `mirror ${MIRROR_286}'s State is 0 once cleaned, so its frame is drawn`);

// Everything but the mirrors is untouched.
const mirrorSet = new Set(found);
// The databases by name, to compare every one of them without naming it.
const theirDatabases: Record<string, Database> = { ...cleaned.databases };
const ourDatabases: Record<string, Database> = { ...kept.databases };
for (const [name, ours] of Object.entries(ourDatabases)) {
  const theirs = theirDatabases[name]!;
  let moved = 0;
  ours.records.forEach((r, i) => {
    if (name === 'actuators' && mirrorSet.has(i)) return;
    if (JSON.stringify(r) !== JSON.stringify(theirs.records[i])) moved++;
  });
  check(moved === 0 && ours.records.length === theirs.records.length,
    `${name}: no other record moves (${moved})`);
}

/* -------------------------------------------------------------- committed saves --- */

console.log('\ncommitted saves (all carry ExpandedPortraits):');
let keptPositions = 0;
for (const path of genuineSaves()) {
  const name = basename(path);
  const world = loadCsbwinWorld(new Uint8Array(readFileSync(path)));
  const found = mirrors(world.dungeon);
  const positioned = found.filter((i) => getActuatorPosition(world.dungeon.databases.actuators.records[i]) !== 0);
  keptPositions += positioned.length;
  console.log(`  ${name.padEnd(34)} ${found.length} mirrors, ${positioned.length} with a Position`);
  check(world.save.expandedPortraits === true, `${name}: the block carries ExpandedPortraits`);
}
check(keptPositions > 0,
  `the saves' mirrors keep their Position (${keptPositions}), which ExtendPortraits would zero`);

/* ------------------------------------------------------------ CSB's Atari saves --- */

console.log('\nCSB\'s Atari-era saves (no block):');
for (const file of ATARI_SAVES) {
  const world = loadCsbwinWorld(new Uint8Array(readFileSync(resolve(file))));
  const found = mirrors(world.dungeon);
  console.log(`  ${file}: ${found.length} mirrors`);
  check(world.save.expandedPortraits === false, `${file}: no ExpandedPortraits, so it would be cleaned`);
  check(found.every((i) => !portraitBits(world.dungeon.databases.actuators.records[i])),
    `${file}: every mirror is clean`);
}

console.log();
finish();
