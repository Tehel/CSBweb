/**
 * `tools/fixtures/gamefiles/dm-amiga/graphics.dat`, the `dm-amiga` set's, is `dm-atari`'s
 * with what makes it the Amiga's taken from the Amiga 2.2 English disk
 * (`doc/AMIGA_DISK_REFERENCE.md` → "The `dm-amiga` set's `graphics.dat`"):
 *
 * - items 0-562 are `dm-atari`'s, but for the Amiga's credits (5), picture 396, objects'
 *   names (556) and font (557), which take their place, stored as the Amiga stores them;
 * - items 563-585 are the Amiga's 8-bit sounds 533-555, and 586-597 its own sounds 563-574;
 * - item 598 is the port's table item, read from `dm` (`tools/lib/amigaDm.ts`): the 34
 *   `SOUND_DATA` with their `GraphicIndex` moved to the items above, the 25x25 volume
 *   grid, the 11 creature attack sounds and the 27 creatures' `AttackSoundOrdinal`.
 *
 * Its sounds 533-555 stay the Atari's 4-bit ones, so the folder is still one CSBWin plays.
 * This tool proves what the file is made from: the Amiga's 575 items each stored as is;
 * against `dm-atari`'s 563, decompressed, 529 the same and 5, 21, 120, 396 and 533-562
 * differing, with 558-562 empty; the names in 556 in the Atari's slots, two of them
 * renamed; the pictures taken at the Atari's sizes; and every item the 34 sounds name
 * holding something. Then that the built file is that, that the file on disk is it, and
 * that the set plays: its tables read through the port's own loader, the Amiga's names
 * among them, and a new game on its `dungeon.dat` run for 600 ticks.
 *
 * Run: `npm test -- --only=amiga-graphics.ts` (checks), `… --write` (writes the file,
 * the step of `npm run fetch-gamefiles` that makes it).
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { ImageFormat, decodeIMG } from '../../src/core/imageDecoder';
import { DungeonLoader } from '../../src/data/DungeonLoader';
import { GraphicsLoader } from '../../src/data/GraphicsLoader';
import { DM, dmTable } from '../lib/amigaDm';
import { check, finish } from '../lib/check';
import { graphicsTablesOf, newGame } from '../lib/game';
import { type Items, expand, readItems, writeItems } from '../lib/graphicsDat';

const ATARI = 'tools/fixtures/gamefiles/dm-atari/graphics.dat';
const AMIGA = 'tools/fixtures/gamefiles/amiga-2.2/graphics.dat';
const OUTPUT = 'tools/fixtures/gamefiles/dm-amiga/graphics.dat';
const DUNGEON = 'tools/fixtures/gamefiles/dm-amiga/dungeon.dat';
/** The ticks the set's new game is run for. */
const TICKS = 600;

/** The Atari's items, `dm-atari`'s 563. */
const ATARI_ITEMS = 563;
/** The Amiga items that differ from `dm-atari`'s, decompressed (`doc/AMIGA_DISK_REFERENCE.md` → "`graphics.dat`"). */
const DIFFERING = [5, 21, 120, 396, ...Array.from({ length: 30 }, (_, i) => 533 + i)];
/** The Amiga's items that take the Atari's place: the credits, a picture, the objects' names and the font. */
const TAKEN = [5, 396, 556, 557];
/** The pictures among them. */
const PICTURES = [5, 396];
const OBJECT_NAMES = 556;
/** The slots of 556 whose names the Amiga changed. */
const RENAMED: Record<number, [atari: string, amiga: string]> = { 158: ['ANTIVEN POTION', 'BRO POTION'], 159: ['MON POTION', 'MA POTION'] };
/** The Amiga's 8-bit recordings of the Atari's sounds, and its own sounds. */
const AMIGA_SOUNDS = Array.from({ length: 23 }, (_, i) => 533 + i);
const AMIGA_OWN_SOUNDS = Array.from({ length: 12 }, (_, i) => 563 + i);
/** Where each Amiga sound item goes in the built file: 563 on, in that order. */
const APPENDED = [...AMIGA_SOUNDS, ...AMIGA_OWN_SOUNDS];
const builtItem = (amigaItem: number): number => ATARI_ITEMS + APPENDED.indexOf(amigaItem);
/** The table item, the file's last. */
const TABLE_ITEM = ATARI_ITEMS + APPENDED.length;

/** The table item's layout: each table's offset and size (`doc/AMIGA_DISK_REFERENCE.md`). */
const TABLE = {
  sounds: { offset: 0, size: 34 * 8 },
  distanceToSoundVolume: { offset: 272, size: 25 * 25 },
  creatureAttackSounds: { offset: 897, size: 11 },
  attackSoundOrdinals: { offset: 908, size: 27 },
} as const;
const TABLE_SIZE = 935;

const md5 = (b: Uint8Array) => createHash('md5').update(b).digest('hex');
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, k) => v === b[k]);

/** The names of item 556: 7-bit characters, the last of each with its top bit set. */
function objectNames(raw: Uint8Array): string[] {
  const names: string[] = [];
  let current = '';
  for (const value of raw) {
    current += String.fromCharCode(value & 0x7f);
    if (value & 0x80) { names.push(current); current = ''; }
  }
  return names;
}

/** The table item, from `dm`'s tables, its 34 sounds' `GraphicIndex` moved to the built file's items. */
function tableItem(dm: Uint8Array): Uint8Array {
  const item = new Uint8Array(TABLE_SIZE);
  const sounds = dmTable(dm, 'sounds').slice();
  for (let i = 0; i < 34; i++) {
    const index = (sounds[i * 8] << 8) | sounds[i * 8 + 1];
    const moved = builtItem(index);
    sounds[i * 8] = moved >> 8;
    sounds[i * 8 + 1] = moved & 0xff;
  }
  item.set(sounds, TABLE.sounds.offset);
  item.set(dmTable(dm, 'distanceToSoundVolume'), TABLE.distanceToSoundVolume.offset);
  item.set(dmTable(dm, 'creatureAttackSounds'), TABLE.creatureAttackSounds.offset);
  const info = dmTable(dm, 'creatureInfo');
  // CREATURE_INFO's second byte, `AttackSoundOrdinal` (ReDMCSB `DEFS.H:1574-1594`).
  item.set(Array.from({ length: 27 }, (_, i) => info[i * 26 + 1]), TABLE.attackSoundOrdinals.offset);
  return item;
}

function main(): void {
  const atari = readItems(new Uint8Array(readFileSync(resolve(ATARI))));
  const amiga = readItems(new Uint8Array(readFileSync(resolve(AMIGA))));
  const dm = new Uint8Array(readFileSync(resolve(DM)));

  // What the Amiga's file is, against dm-atari's.
  check(atari.count === ATARI_ITEMS && amiga.count === 575, `dm-atari's graphics.dat holds ${ATARI_ITEMS} items, the Amiga's 575`);
  check(amiga.compressed.every((c, i) => c === amiga.decompressed[i]), 'the Amiga stores each of its 575 items as is');
  const differing = [...Array(ATARI_ITEMS).keys()].filter((i) => !same(expand(atari, i), expand(amiga, i)));
  console.log(`items differing from dm-atari's, decompressed: ${differing.join(', ')}`);
  check(differing.join() === DIFFERING.join(), `against dm-atari's, ${ATARI_ITEMS - DIFFERING.length} items are the same, and 5, 21, 120, 396 and 533-562 differ`);
  check([558, 559, 560, 561, 562].every((i) => amiga.decompressed[i] === 0), 'the Amiga\'s 558-562 are empty: its tables are in dm');

  const atariNames = objectNames(expand(atari, OBJECT_NAMES));
  const amigaNames = objectNames(expand(amiga, OBJECT_NAMES));
  const renamed = atariNames.map((_, i) => i).filter((i) => atariNames[i] !== amigaNames[i]);
  console.log(`item ${OBJECT_NAMES}: ${atariNames.length} names to the Amiga's ${amigaNames.length}; renamed: `
    + renamed.map((i) => `${i} ${atariNames[i]} -> ${amigaNames[i]}`).join(', '));
  check(atariNames.length === 199 && amigaNames.length === 199
    && renamed.join() === Object.keys(RENAMED).join() && renamed.every((i) => RENAMED[i].join() === [atariNames[i], amigaNames[i]].join()),
    `item ${OBJECT_NAMES}: the 199 names in the same slots, the Amiga's ANTIVEN and MON POTION BRO and MA POTION`);
  for (const item of PICTURES) {
    const a = decodeIMG(expand(atari, item), ImageFormat.IMG1);
    const b = decodeIMG(expand(amiga, item), ImageFormat.IMG1);
    check(a.width === b.width && a.height === b.height, `picture ${item} is ${b.width}x${b.height} on the Amiga, as on the Atari`);
  }
  check(amiga.decompressed[557] === atari.decompressed[557], 'the font, 557, is 768 bytes in both');

  const sounds = dmTable(dm, 'sounds');
  const named = Array.from({ length: 34 }, (_, i) => (sounds[i * 8] << 8) | sounds[i * 8 + 1]);
  console.log(`the 34 sounds' GraphicIndex in dm: ${named.join(' ')}`);
  check(named.slice(0, 22).every((i) => AMIGA_SOUNDS.includes(i)) && named.slice(22).every((i) => AMIGA_OWN_SOUNDS.includes(i)),
    'sounds 0-21 name the Amiga\'s 533-555, sounds 22-33 its own 563-574');
  check(named.every((i) => amiga.decompressed[i] > 0), 'every item the 34 sounds name holds something');

  // The built file.
  const built: Items = { count: TABLE_ITEM + 1, compressed: [], decompressed: [], data: [] };
  for (let i = 0; i < ATARI_ITEMS; i++) {
    const from = TAKEN.includes(i) ? amiga : atari;
    built.data.push(from.data[i]);
    built.decompressed.push(from.decompressed[i]);
  }
  for (const i of APPENDED) {
    built.data.push(amiga.data[i]);
    built.decompressed.push(amiga.decompressed[i]);
  }
  const table = tableItem(dm);
  built.data.push(table);
  built.decompressed.push(table.length);
  const bytes = writeItems(built);
  const reread = readItems(bytes);

  check(reread.count === 599, 'the built file holds 599 items');
  const fromAtari = [...Array(ATARI_ITEMS).keys()].filter((i) => !TAKEN.includes(i));
  check(fromAtari.every((i) => same(reread.data[i], atari.data[i]) && reread.compressed[i] === atari.compressed[i]
    && reread.decompressed[i] === atari.decompressed[i]), `its other ${fromAtari.length} items of 0-562 are dm-atari's, stored as they are there`);
  check(TAKEN.every((i) => same(reread.data[i], amiga.data[i]) && reread.compressed[i] === amiga.decompressed[i]
    && reread.decompressed[i] === amiga.decompressed[i]), `its ${TAKEN.join(', ')} are the Amiga's, stored as is`);
  check(APPENDED.every((i) => same(expand(reread, builtItem(i)), amiga.data[i])),
    `its 563-${TABLE_ITEM - 1} are the Amiga's 533-555 and 563-574, in that order`);
  const read = expand(reread, TABLE_ITEM);
  const field = (name: keyof typeof TABLE) => read.subarray(TABLE[name].offset, TABLE[name].offset + TABLE[name].size);
  check(read.length === TABLE_SIZE && TABLE.attackSoundOrdinals.offset + TABLE.attackSoundOrdinals.size === TABLE_SIZE,
    `its table item, ${TABLE_ITEM}, is ${TABLE_SIZE} bytes, the four tables end to end`);
  const movedSounds = field('sounds');
  check([...Array(34).keys()].every((i) => {
    const index = (movedSounds[i * 8] << 8) | movedSounds[i * 8 + 1];
    return same(expand(reread, index), amiga.data[named[i]]) && same(movedSounds.subarray(i * 8 + 2, i * 8 + 8), sounds.subarray(i * 8 + 2, i * 8 + 8));
  }), 'each of its 34 sounds names the built item holding the Amiga\'s sound, its other six bytes dm\'s');
  check(same(field('distanceToSoundVolume'), dmTable(dm, 'distanceToSoundVolume'))
    && same(field('creatureAttackSounds'), dmTable(dm, 'creatureAttackSounds')), 'its volume grid and creature attack sounds are dm\'s');
  console.log(`creatures' AttackSoundOrdinal: ${[...field('attackSoundOrdinals')].join(' ')}`);
  check([...field('attackSoundOrdinals')].join(' ') === '4 0 6 0 1 0 3 7 2 10 2 0 11 9 0 5 10 0 11 0 8 3 0 0 1 0 0',
    'its creatures\' AttackSoundOrdinal are CREATURE_INFO\'s second byte (doc/AMIGA_DISK_REFERENCE.md)');
  console.log(`built file: ${bytes.length} bytes, md5 ${md5(bytes)}`);

  if (process.argv.includes('--write')) {
    mkdirSync(dirname(resolve(OUTPUT)), { recursive: true });
    writeFileSync(resolve(OUTPUT), bytes);
    console.log(`wrote ${OUTPUT}`);
  }
  check(same(new Uint8Array(readFileSync(resolve(OUTPUT))), bytes), `${OUTPUT} is the built file`);

  // The set plays.
  const graphics = new GraphicsLoader();
  graphics.loadFromArray(bytes);
  const names = graphicsTablesOf(graphics).objects.objectNames;
  check(names[158] === 'BRO POTION' && names[159] === 'MA POTION', 'the port reads the Amiga\'s names: 158 BRO POTION, 159 MA POTION');
  const game = newGame(new DungeonLoader().loadDungeonDat(new Uint8Array(readFileSync(resolve(DUNGEON)))), graphics);
  for (let tick = 0; tick < TICKS; tick++) game.gameTick();
  console.log(`dm-amiga: a new game on ${DUNGEON}, ${game.ctx.dungeon.getData().maps.length} levels, run for ${TICKS} ticks`);
  check(true, `a new game on dm-amiga's files runs ${TICKS} ticks`);
  finish();
}

main();
