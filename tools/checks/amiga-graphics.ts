/**
 * `tools/fixtures/gamefiles/dm-amiga/graphics.dat`, the `dm-amiga` set's, is `dm-atari`'s
 * with what makes it the Amiga's taken from the Amiga 2.2 English disk
 * (`doc/AMIGA_DISK_REFERENCE.md` → "The `dm-amiga` set's `graphics.dat`"):
 *
 * - items 0-562 are `dm-atari`'s, but for the Amiga's credits (5), picture 396, objects'
 *   names (556) and font (557), which take their place, stored as the Amiga stores them,
 *   and items 558 and 562, `dm-atari`'s with `dm`'s tables in place of the Atari's: the
 *   wall ornaments' coordinate sets and the creature replacement colour sets in 558, the
 *   palettes in 562, each colour halved to the Atari's 3 bits a channel;
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
 * holding something; that 558's and 562's tables sit where the port reads them, that
 * every channel of `dm`'s colours is twice the Atari's intensity or 15, and where `dm`'s
 * tables, so halved, differ from the Atari's. Then that the built file is that, that the
 * file on disk is it, and that the set plays: its tables read through the port's own
 * loader, the Amiga's names, palettes and coordinates among them, and a new game on its
 * `dungeon.dat` run for 600 ticks.
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

/**
 * Item `0x22e` and where CSBWin's tables the Amiga's `dm` holds otherwise sit in it:
 * `wallDecorationPosition[8][13]` (`doc/CSBwin-src/Data.h:1175`), A22E's
 * `G0205_aaauc_Graphic558_WallOrnamentCoordinateSets`, and `specialColors[13][7]`
 * (`Data.h:1135`), its `G0220_as_Graphic558_CreatureReplacementColorSets`.
 */
const ITEM_22E = 0x22e;
const COORDINATE_SETS = 2410;
const REPLACEMENT_COLORS = 650;
/** Item `0x232`: `Palette552[6]`, `Palette360` and `Palette328` (`Data.h:1479-1482`), A22E's dungeon view's, entrance's and credits'. */
const ITEM_232 = 0x232;
const DUNGEON_VIEW_PALETTES = 1278;
const ENTRANCE_PALETTE = 1470;
const CREDITS_PALETTE = 1502;
/** The items built from `dm-atari`'s with `dm`'s tables written in. */
const REWRITTEN = [ITEM_22E, ITEM_232];

/** A channel of `dm`'s 4 bits: twice the Atari's intensity, or 15 for 7. */
const atariChannel = (channel: number): boolean => channel % 2 === 0 || channel === 15;
/** A `dm` colour, 0x0RGB at 4 bits a channel, at the Atari's 3: each channel halved. */
const atariColor = (color: number): number => (color >> 1) & 0x777;
const word = (b: Uint8Array, at: number): number => (b[at] << 8) | b[at + 1];
const hex = (color: number): string => `0x${color.toString(16).padStart(3, '0')}`;

/** `count` words of `dm`'s colours at `from`, halved, written into `into` at `at`. */
function putColors(into: Uint8Array, at: number, from: Uint8Array, count: number): void {
  for (let i = 0; i < count; i++) {
    const color = atariColor(word(from, i * 2));
    into[at + i * 2] = color >> 8;
    into[at + i * 2 + 1] = color & 0xff;
  }
}

/** Item `0x22e`, `dm-atari`'s with `dm`'s coordinate sets and replacement colour sets. */
function item22e(atari: Uint8Array, dm: Uint8Array): Uint8Array {
  const item = atari.slice();
  item.set(dmTable(dm, 'wallOrnamentCoordinateSets'), COORDINATE_SETS);
  const sets = dmTable(dm, 'creatureReplacementColorSets');
  for (let i = 0; i < 13; i++) {
    putColors(item, REPLACEMENT_COLORS + i * 14, sets.subarray(i * 14), 6);
    item.set(sets.subarray(i * 14 + 12, i * 14 + 14), REPLACEMENT_COLORS + i * 14 + 12);
  }
  return item;
}

/** Item `0x232`, `dm-atari`'s with `dm`'s eight palettes. */
function item232(atari: Uint8Array, dm: Uint8Array): Uint8Array {
  const item = atari.slice();
  putColors(item, DUNGEON_VIEW_PALETTES, dmTable(dm, 'dungeonViewPalettes'), 6 * 16);
  putColors(item, ENTRANCE_PALETTE, dmTable(dm, 'entrancePalette'), 16);
  putColors(item, CREDITS_PALETTE, dmTable(dm, 'creditsPalette'), 16);
  return item;
}

/** The places where `built` differs from `atari`, `size` bytes at a time from `at`, named by `name`. */
function differences(atari: Uint8Array, built: Uint8Array, at: number, count: number, size: number, name: (i: number) => string): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const a = atari.subarray(at + i * size, at + (i + 1) * size);
    const b = built.subarray(at + i * size, at + (i + 1) * size);
    const show = (v: Uint8Array) => (size === 2 && !name(i).endsWith('D2/D3') ? hex(word(v, 0)) : [...v].join(','));
    if (!same(a, b)) out.push(`${name(i)} ${show(a)} -> ${show(b)}`);
  }
  return out;
}

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

  // dm's colours and coordinates, against the Atari's items 0x22e and 0x232.
  const atariGraphics = new GraphicsLoader();
  atariGraphics.loadFromArray(new Uint8Array(readFileSync(resolve(ATARI))));
  const atariTables = graphicsTablesOf(atariGraphics);
  const atari22e = expand(atari, ITEM_22E);
  const atari232 = expand(atari, ITEM_232);
  const words = (b: Uint8Array, at: number, count: number) => Array.from({ length: count }, (_, i) => word(b, at + i * 2));
  const { palette552, palette360, palette328 } = atariTables.ui.graphic232;
  check(atariTables.objects.wallDecorationRectSets.flat().flatMap((d) => [d.x1, d.x2, d.y1, d.y2, d.widthBytes, d.height]).join() === [...atari22e.subarray(COORDINATE_SETS, COORDINATE_SETS + 624)].join()
    && atariTables.objects.specialColors.flatMap((c) => [...c.paletteEntries, (c.monsterColorMapMedium << 8) | c.monsterColorMapFar]).join() === words(atari22e, REPLACEMENT_COLORS, 13 * 7).join(),
    `item 0x22e: the port reads wallDecorationPosition at ${COORDINATE_SETS}, specialColors at ${REPLACEMENT_COLORS}`);
  check(palette552.flat().join() === words(atari232, DUNGEON_VIEW_PALETTES, 96).join()
    && palette360.join() === words(atari232, ENTRANCE_PALETTE, 16).join() && palette328.join() === words(atari232, CREDITS_PALETTE, 16).join(),
    `item 0x232: the port reads Palette552 at ${DUNGEON_VIEW_PALETTES}, Palette360 at ${ENTRANCE_PALETTE}, Palette328 at ${CREDITS_PALETTE}`);
  const colors = [
    ...words(dmTable(dm, 'dungeonViewPalettes'), 0, 96), ...words(dmTable(dm, 'entrancePalette'), 0, 16), ...words(dmTable(dm, 'creditsPalette'), 0, 16),
    ...[...Array(13).keys()].flatMap((i) => words(dmTable(dm, 'creatureReplacementColorSets'), i * 14, 6)),
  ];
  check(colors.every((c) => c < 0x1000 && [0, 4, 8].every((shift) => atariChannel((c >> shift) & 15))),
    `every channel of dm's ${colors.length} colours is even or 15: twice an Atari intensity, 7 shown as 15`);
  const built22e = item22e(atari22e, dm);
  const built232 = item232(atari232, dm);
  const views = ['D3L', 'D3R', 'D3L front', 'D3C', 'D3R front', 'D2L', 'D2R', 'D2L front', 'D2C', 'D2R front', 'D1L', 'D1R', 'D1C'];
  const ornamentDiffs = differences(atari22e, built22e, COORDINATE_SETS, 8 * 13, 6, (i) => `set ${Math.floor(i / 13)} ${views[i % 13]}`);
  const colorDiffs = differences(atari22e, built22e, REPLACEMENT_COLORS, 13 * 7, 2, (i) => `set ${Math.floor(i / 7)} ${i % 7 === 6 ? 'D2/D3' : `colour ${i % 7}`}`);
  const paletteDiffs = differences(atari232, built232, DUNGEON_VIEW_PALETTES, 8 * 16, 2,
    (i) => `${i < 96 ? `dungeon view ${Math.floor(i / 16)}` : i < 112 ? 'entrance' : 'credits'} slot ${i % 16}`);
  console.log(`dm's coordinate sets against dm-atari's: ${ornamentDiffs.join('; ')}`);
  console.log(`dm's replacement colour sets, halved: ${colorDiffs.join('; ')}`);
  console.log(`dm's palettes, halved: ${paletteDiffs.join('; ')}`);
  check(ornamentDiffs.join('; ') === 'set 5 D2R 147,157,34,56,8,23 -> 148,157,34,56,8,23; set 7 D3L front 0,83,25,75,48,51 -> 0,75,25,75,40,51; '
    + 'set 7 D3C 74,149,25,75,48,51 -> 74,149,25,75,40,51; set 7 D3R front 139,223,25,75,48,51 -> 148,223,25,75,40,51',
    'dm\'s coordinate sets are the Atari\'s but set 5\'s D2R, from x 148, and set 7\'s three D3 front frames, 80 pixels wide at x 0, 74 and 148');
  check(colorDiffs.join('; ') === 'set 9 D2/D3 50,30 -> 50,70; set 10 D2/D3 100,100 -> 100,120',
    'dm\'s replacement colour sets, halved, are the Atari\'s but the D3 colour of sets 9 and 10, 70 and 120 for 30 and 100');
  check(paletteDiffs.length === 10 && paletteDiffs.every((d) => /^dungeon view [1-5] slot (9|10) 0x[0-9a-f]{3} -> 0x000$/.test(d)),
    'dm\'s palettes, halved, are the Atari\'s but slots 9 and 10 of the five darker dungeon view palettes, black');

  // The built file.
  const built: Items = { count: TABLE_ITEM + 1, compressed: [], decompressed: [], data: [] };
  for (let i = 0; i < ATARI_ITEMS; i++) {
    const rewritten = i === ITEM_22E ? built22e : i === ITEM_232 ? built232 : null;
    const from = TAKEN.includes(i) ? amiga : atari;
    built.data.push(rewritten ?? from.data[i]);
    built.decompressed.push(rewritten?.length ?? from.decompressed[i]);
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
  const fromAtari = [...Array(ATARI_ITEMS).keys()].filter((i) => !TAKEN.includes(i) && !REWRITTEN.includes(i));
  check(fromAtari.every((i) => same(reread.data[i], atari.data[i]) && reread.compressed[i] === atari.compressed[i]
    && reread.decompressed[i] === atari.decompressed[i]), `its other ${fromAtari.length} items of 0-562 are dm-atari's, stored as they are there`);
  check(TAKEN.every((i) => same(reread.data[i], amiga.data[i]) && reread.compressed[i] === amiga.decompressed[i]
    && reread.decompressed[i] === amiga.decompressed[i]), `its ${TAKEN.join(', ')} are the Amiga's, stored as is`);
  check(same(reread.data[ITEM_22E], built22e) && same(reread.data[ITEM_232], built232)
    && REWRITTEN.every((i) => reread.compressed[i] === reread.decompressed[i]), `its ${REWRITTEN.join(' and ')} are dm-atari's with dm's tables, stored as is`);
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
  const tables = graphicsTablesOf(graphics);
  const set7 = tables.objects.wallDecorationRectSets[7]!.slice(2, 5).map((d) => `${d.x1}-${d.x2} ${d.widthBytes * 2}`);
  const ornaments7 = [...tables.objects.wallDecorationRectSetIndex.keys()].filter((i) => tables.objects.wallDecorationRectSetIndex[i] === 7);
  console.log(`dm-amiga: coordinate set 7 (ornament ${ornaments7.join(', ')}), D3 front frames ${set7.join(', ')}`);
  check(set7.join() === '0-75 80,74-149 80,148-223 80' && tables.objects.wallDecorationRectSets[5]![6]!.x1 === 148,
    'the port reads dm\'s coordinate sets: set 7\'s D3 front frames, set 5\'s D2R from x 148');
  check(tables.objects.specialColors[9]!.monsterColorMapFar === 70 && tables.objects.specialColors[10]!.monsterColorMapFar === 120
    && tables.objects.specialColors[0]!.paletteEntries[0] === 0x650,
    'the port reads dm\'s replacement colour sets, halved: set 0\'s first 0x650, sets 9\'s and 10\'s D3 colours 70 and 120');
  const p = tables.ui.graphic232;
  check(p.palette552[1]![9] === 0 && p.palette552[5]![10] === 0 && p.palette552[0]![9] === 0x750 && p.palette360[5] === 0x060 && p.palette328[0] === 0x003,
    'the port reads dm\'s palettes, halved: slots 9 and 10 black in the darker five, the entrance and the credits\'');
  const game = newGame(new DungeonLoader().loadDungeonDat(new Uint8Array(readFileSync(resolve(DUNGEON)))), graphics);
  for (let tick = 0; tick < TICKS; tick++) game.gameTick();
  console.log(`dm-amiga: a new game on ${DUNGEON}, ${game.ctx.dungeon.getData().maps.length} levels, run for ${TICKS} ticks`);
  check(true, `a new game on dm-amiga's files runs ${TICKS} ticks`);
  finish();
}

main();
