/**
 * `CheckCelltypes` and `CheckMonsters`: the two clean-ups `_ReadEntireGame` runs over the
 * world once the whole file is read (`doc/CSBwin-src/SaveGame.cpp:1342-1400`, `:1825-1826`),
 * a new game's and a save's alike.
 *
 * - What each changes in `dm-atari/dungeon.dat`, every committed save, and CSB's
 *   Atari-era `mini.dat` and `csbgame2.dat` (whose monster sizes are DM's: the table is
 *   compared). `CheckCelltypes` finds no room type above 6 anywhere.
 * - A save's groups on the party's level hold their `ITEM16` index in `groupIndex`, which
 *   `CheckMonster` reads as positions and may overwrite. Through `applyCsbwinSave`, the
 *   restore's `LoadPartyLevel` writes each back from its slot, so every attached group
 *   comes out with the positions its slot carried, and only a cut `numMonM1` stays.
 * - Records built to trip every arm: a size-1 group of four, a size-1 pair not opposite,
 *   one that is, a size-4 group of three, a size-4 single off 255, one on it, a size-0
 *   group of four, and a size-1 group carried by another group. And the same world
 *   through `Game`'s constructor, which is where a new game runs `CheckMonsters`.
 *
 * Run: `npx tsx tools/dump-check-monsters.ts`
 */
import { readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { DBType, OBJECT_ID_EOF, OBJECT_ID_NULL, encodeObjectID } from '../src/core/types';
import type { ObjectID } from '../src/core/types';
import { loadCsbwinWorld } from '../src/data/CsbwinDungeonImage';
import { CheckCelltypes } from '../src/data/CsbwinDungeonConversions';
import { applyCsbwinSave } from '../src/engine/CsbwinSaveGame';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import type { CreatureRecord, DungeonData } from '../src/data/dungeonTypes';
import { CheckMonsters } from '../src/engine/CheckMonsters';
import { DungeonState } from '../src/engine/DungeonState';
import { monsterHorizontalSize } from '../src/data/tables/MonsterDesc';
import { check, finish } from './lib/check';
import { gameTablesOf, newGame, stockGraphics } from './lib/game';
import { genuineSaves } from './lib/saves';

const DUNGEON = 'static/gamefiles/dm-atari/dungeon.dat';
const CSB = 'static/gamefiles/csb';
const ATARI_SAVES = ['mini.dat', 'csbgame2.dat'];

const dmTables = gameTablesOf(stockGraphics());
const monsterDesc = dmTables.monsterDesc;
const sizeOf = (type: number) => monsterHorizontalSize(monsterDesc[type]);

/* ------------------------------------------------------------------ the sizes --- */

const sizes = Array.from(monsterDesc, (d) => monsterHorizontalSize(d)).join('');
console.log(`horizontalSize by monster type 0-${monsterDesc.length - 1}: ${sizes}`);
const csbGraphics = new GraphicsLoader();
csbGraphics.loadFromArray(new Uint8Array(readFileSync(resolve(CSB, 'graphics.dat'))));
const csbSizes = Array.from(gameTablesOf(csbGraphics).monsterDesc, (d) => monsterHorizontalSize(d)).join('');
check(csbSizes === sizes, `CSB's graphics.dat gives the same sizes (${csbSizes})`);
const SIZE0 = [...sizes].indexOf('0');
const SIZE1 = [...sizes].indexOf('1');
const SIZE2 = [...sizes].indexOf('2');

/* ---------------------------------------------------------------- measurement --- */

type Fields = Pick<CreatureRecord, 'numMonM1' | 'groupIndex' | 'facing'>;
const fields = (r: CreatureRecord): Fields => ({ numMonM1: r.numMonM1, groupIndex: r.groupIndex, facing: r.facing });
const show = (f: Fields) => `n-1 ${f.numMonM1} gi ${String(f.groupIndex).padStart(3)} f ${f.facing}`;

function roomTypesAbove6(data: DungeonData): number {
  let n = 0;
  for (const map of data.maps) for (const col of map.cellFlags) for (const cell of col) if ((cell >> 5) > 6) n++;
  return n;
}

/** Run `CheckMonsters` over `data` and report every record it changed, with its whole record otherwise kept. */
function measure(label: string, data: DungeonData, attached: ReadonlySet<number> = new Set()): Map<number, [Fields, Fields]> {
  const records = data.databases.creatures.records;
  const before = records.map((r) => JSON.stringify(r));
  const beforeFields = records.map(fields);
  CheckMonsters(new DungeonState(data), monsterDesc, (line) => console.warn(line));
  const changed = new Map<number, [Fields, Fields]>();
  records.forEach((r, i) => {
    if (JSON.stringify(r) === before[i]) return;
    changed.set(i, [beforeFields[i], fields(r)]);
    const rest = { ...JSON.parse(before[i]), numMonM1: r.numMonM1, groupIndex: r.groupIndex, facing: r.facing };
    check(JSON.stringify(rest) === JSON.stringify(r), `${label}: creature ${i} changes only numMonM1, groupIndex and facing`);
  });
  const cells = roomTypesAbove6(data);
  console.log(`  ${label.padEnd(34)} room types above 6: ${cells}, groups changed: ${changed.size}`);
  check(cells === 0, `${label}: no room type above 6`);
  for (const [i, [b, a]] of changed) {
    const r = records[i];
    console.log(`      creature ${String(i).padStart(3)} type ${String(r.creatureType).padStart(2)} (size ${sizeOf(r.creatureType)})` +
      `${attached.has(i) ? ' attached' : '         '}  ${show(b)}  ->  ${show(a)}`);
  }
  return changed;
}

console.log('\ndungeon.dat and the saves, read as the port reads them (CheckCelltypes already run):');
const dungeonChanged = measure('dm-atari/dungeon.dat', new DungeonLoader().loadFromArray(new Uint8Array(readFileSync(resolve(DUNGEON)))));
check(dungeonChanged.size === 0, 'dm-atari/dungeon.dat: CheckMonsters changes nothing');

const saveFiles = [
  ...genuineSaves().map((path) => relative('.', path)),
  ...ATARI_SAVES.map((n) => join(CSB, n)),
];
const withChanges: { file: string; changed: Map<number, [Fields, Fields]> }[] = [];
for (const file of saveFiles) {
  const world = loadCsbwinWorld(new Uint8Array(readFileSync(file)));
  const attached = new Set(world.save.item16.filter((s) => s.word0 >= 0).map((s) => s.word0));
  const changed = measure(file.replace('static/gamefiles/', ''), world.dungeon, attached);
  if (changed.size > 0) withChanges.push({ file, changed });
}

/* ------------------------------------------------- a save through applyCsbwinSave --- */

// Every save that `CheckMonsters` touches, restored into a running game: an attached
// group's `groupIndex` and `facing` come back from its slot, and its cut stays.
console.log('\nthe saves it touches, through applyCsbwinSave:');
for (const { file, changed } of withChanges) {
  const bytes = new Uint8Array(readFileSync(file));
  const saved = loadCsbwinWorld(bytes);
  const savedSlots = new Map(saved.save.item16.filter((s) => s.word0 >= 0).map((s) => [s.word0, s]));
  // A running game over DM's `dungeon.dat`, as the page builds one: the load installs
  // the save's world, CSB's eleven levels as well as DM's fourteen.
  const game = newGame(new DungeonLoader().loadDungeonDat(new Uint8Array(readFileSync(DUNGEON))), stockGraphics());
  applyCsbwinSave(game, bytes);
  const records = game.ctx.dungeon.getData().databases.creatures.records;
  const pool = game.ctx.dungeon.getItem16Pool();
  for (const [i, [before, after]] of changed) {
    const r = records[i];
    const savedSlot = savedSlots.get(i);
    const slot = pool.find((s) => s.word0 === i);
    const slotIndex = slot ? pool.indexOf(slot) : -1;
    console.log(`  ${file.replace('static/gamefiles/', '')} creature ${String(i).padStart(3)}: n-1 ${r.numMonM1}, ` +
      `gi ${r.groupIndex} (slot ${slotIndex}), facing ${r.facing} (check wrote ${after.facing}, saved slot ${savedSlot ? savedSlot.facings & 3 : '-'})` +
      (slot ? `, positions ${slot.positions} (saved ${savedSlot?.positions})` : ''));
    check(r.numMonM1 === after.numMonM1, `${file}: creature ${i} keeps the cut numMonM1 ${after.numMonM1}`);
    if (savedSlot) {
      // Attached again, with what `DetachItem16` wrote back from the saved slot, not
      // what `CheckMonster` wrote: the facing tells them apart, the check's is 0.
      check(slot !== undefined && r.groupIndex === slotIndex,
        `${file}: creature ${i}, attached, is attached again after the restore`);
      check(slot !== undefined && slot.positions === savedSlot.positions && r.facing === (savedSlot.facings & 3),
        `${file}: creature ${i}, attached, takes its positions and facing back from its slot`);
    } else {
      check(r.groupIndex === after.groupIndex && r.facing === after.facing,
        `${file}: creature ${i}, off the party's level, keeps the fix (was ${show(before)})`);
    }
  }
}

/* ------------------------------------------------------- records built to trip it --- */

console.log(`\nbuilt records (size 0: type ${SIZE0}, size 1: type ${SIZE1}, size 4: type ${SIZE2}):`);

interface Case { name: string; type: number; set: Fields; want: Fields }
const cases: Case[] = [
  { name: 'size 1, a group of four', type: SIZE1,
    set: { numMonM1: 3, groupIndex: 0x1b, facing: 3 }, want: { numMonM1: 1, groupIndex: 2, facing: 0 } },
  { name: 'size 1, a pair not opposite (0, 1)', type: SIZE1,
    set: { numMonM1: 1, groupIndex: 0 | (1 << 2), facing: 3 }, want: { numMonM1: 1, groupIndex: 2, facing: 0 } },
  { name: 'size 1, a pair opposite (1, 3)', type: SIZE1,
    set: { numMonM1: 1, groupIndex: 1 | (3 << 2), facing: 2 }, want: { numMonM1: 1, groupIndex: 1 | (3 << 2), facing: 2 } },
  { name: 'size 4, a group of three', type: SIZE2,
    set: { numMonM1: 2, groupIndex: 0x55, facing: 1 }, want: { numMonM1: 0, groupIndex: 255, facing: 0 } },
  { name: 'size 4, one off 255', type: SIZE2,
    set: { numMonM1: 0, groupIndex: 5, facing: 3 }, want: { numMonM1: 0, groupIndex: 255, facing: 0 } },
  { name: 'size 4, one on 255', type: SIZE2,
    set: { numMonM1: 0, groupIndex: 255, facing: 3 }, want: { numMonM1: 0, groupIndex: 255, facing: 3 } },
  { name: 'size 0, a group of four', type: SIZE0,
    set: { numMonM1: 3, groupIndex: 0x1b, facing: 2 }, want: { numMonM1: 3, groupIndex: 0x1b, facing: 2 } },
];
const carried: Case = { name: 'size 1, a group of four carried by the size-0 group', type: SIZE1,
  set: { numMonM1: 3, groupIndex: 0x1b, facing: 1 }, want: { numMonM1: 1, groupIndex: 2, facing: 0 } };

/** dungeon.dat with the cases written over its first live groups, a carried group, and a cell of type 7. */
function builtWorld(): { data: DungeonData; indices: number[]; carriedIndex: number } {
  const data = new DungeonLoader().loadFromArray(new Uint8Array(readFileSync(resolve(DUNGEON))));
  const records = data.databases.creatures.records;
  const live = records.map((r, i) => (r.nextObject !== OBJECT_ID_NULL && r.possession === OBJECT_ID_EOF ? i : -1)).filter((i) => i >= 0);
  const indices = live.slice(0, cases.length);
  cases.forEach((c, k) => Object.assign(records[indices[k]], { creatureType: c.type }, c.set));
  // A group that is in no cell, only in the size-0 group's possessions.
  const carriedIndex = records.length;
  records.push({ ...records[indices[0]], nextObject: OBJECT_ID_EOF, possession: OBJECT_ID_EOF, creatureType: carried.type, ...carried.set });
  records[indices[cases.length - 1]].possession = encodeObjectID(0, DBType.CREATURE, carriedIndex) as ObjectID;
  return { data, indices, carriedIndex };
}

function checkBuilt(label: string, records: CreatureRecord[], indices: number[], carriedIndex: number): void {
  [...cases, carried].forEach((c, k) => {
    const r = records[k < cases.length ? indices[k] : carriedIndex];
    const got = fields(r);
    console.log(`  ${label}: ${c.name.padEnd(52)} ${show(c.set)}  ->  ${show(got)}`);
    check(JSON.stringify(got) === JSON.stringify(c.want), `${label}: ${c.name} gives ${show(c.want)}`);
  });
}

{
  const { data, indices, carriedIndex } = builtWorld();
  CheckMonsters(new DungeonState(data), monsterDesc, (line) => console.warn(line));
  checkBuilt('CheckMonsters', data.databases.creatures.records, indices, carriedIndex);
}
{
  const { data, indices, carriedIndex } = builtWorld();
  const game = newGame(data, stockGraphics());
  checkBuilt('new Game', game.ctx.dungeon.getData().databases.creatures.records as CreatureRecord[], indices, carriedIndex);
}

// CheckCelltypes on a cell of type 7: open floor, the low five bits kept.
{
  const data = new DungeonLoader().loadFromArray(new Uint8Array(readFileSync(resolve(DUNGEON))));
  data.maps[0].cellFlags[0][0] = (7 << 5) | 0x0b;
  data.maps[1].cellFlags[2][3] = (6 << 5) | 0x0b;
  CheckCelltypes(data);
  const a = data.maps[0].cellFlags[0][0];
  const b = data.maps[1].cellFlags[2][3];
  console.log(`\nCheckCelltypes: type 7 cell 0xeb -> 0x${a.toString(16)}, type 6 cell 0xcb -> 0x${b.toString(16)}`);
  check(a === 0x2b, 'CheckCelltypes: a type-7 cell becomes open floor with its low five bits');
  check(b === 0xcb, 'CheckCelltypes: a false wall is left alone');
}

finish();
