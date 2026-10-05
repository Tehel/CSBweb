/**
 * A monster's alternate graphics: the `CSBgraphics.dat` section that `DrawMonster` draws a
 * group from in place of `graphics.dat`'s pictures of its type
 * (`doc/CSBwin-src/Code51a4.cpp:963-1125`).
 *
 * A group's `alternateGraphics()`, 0 to 7, picks one. The dungeon may map a type's four on
 * a level to sections of its choosing (`AltGraphicMapping`); otherwise graphic `n` of
 * type `mt` is section `3 * mt + n - 1`, and 0 is the type's own pictures.
 */
import { readU16LE, readU32LE } from '../core/bytes';
import { CSBGraphicType, type CSBGraphicsLoader } from './CSBGraphicsLoader';
import { altMonGraphicsKey, Expool, type ExpoolDatabase } from './CsbwinExpool';
import type { CreatureRecord } from './dungeonTypes';
import type { MonsterDesc } from './tables/MonsterDesc';
import type { MonsterGraphicDesc } from './tables/ObjectTables';

/** `NUM_DERIVED_GRAPHIC`, and the length of `ALTMONGRAPH.graphicOffsets`. */
export const NUM_DERIVED_GRAPHIC = 10;
/** `sizeof(MONSTERDESC)`, packed (`doc/CSBwin-src/CSB.h:18`, `:2256-2363`). */
const MONSTERDESC_SIZE = 26;
/** `sizeof(ITEM12)` (`doc/CSBwin-src/CSB.h:2155-2169`). */
const ITEM12_SIZE = 12;
/** `sizeof(ITEM110)`: eleven relative cells of five positions (`doc/CSBwin-src/CSB.h:2375-2383`). */
const ITEM110_SIZE = 110;
/** `ALTMONGRAPH.graphic`'s offset: the three tables and `graphicOffsets`. */
export const ALTMONGRAPH_GRAPHIC = MONSTERDESC_SIZE + ITEM12_SIZE + ITEM110_SIZE + 4 * NUM_DERIVED_GRAPHIC;
/** `sizeof(ALTMONGRAPH)`, `graphic[4]` included: `ReadCSBgraphic`'s minimum. */
const ALTMONGRAPH_SIZE = ALTMONGRAPH_GRAPHIC + 4;
/** `altMonCache`'s row: a type's 4 alternate graphics. */
const ALTMONCACHE_GRAPHICS = 4;

/**
 * `ALTMONGRAPH` (`doc/CSBwin-src/Code51a4.cpp:967-979`): a section as CSBWin reads it into
 * memory, so in the native order of the PC that wrote it, little-endian, where
 * `graphics.dat`'s tables are swapped from big-endian as they are read.
 */
export interface AltMonGraph {
  /** `monsterDesc`. `DrawMonster` reads only its `word4`. */
  monsterDesc: MonsterDesc;
  /** `item12`, the type's `d.Item6414` entry. */
  item12: MonsterGraphicDesc;
  /** `item110.s[11]`: per relative cell, five `MonsterXYonScreen` pairs. */
  item110: { x: number; y: number }[][];
  /** Each graphic's offset in `graphic`, -1 for none. */
  graphicOffsets: number[];
  /** `graphic`: the section from its byte 188 to its end. */
  graphic: Uint8Array;
}

/** `MONSTERDESC` read little-endian, unswapped and unchecked, as the section holds it. */
function readMonsterDesc(raw: Uint8Array, at: number): MonsterDesc {
  return {
    type: raw[at],
    attackSound: raw[at + 1],
    word2: readU16LE(raw, at + 2),
    word4: readU16LE(raw, at + 4),
    movementTicks06: raw[at + 6],
    attackTicks07: raw[at + 7],
    defense08: raw[at + 8],
    baseHealth09: raw[at + 9],
    attack10: raw[at + 10],
    poisonAttack11: raw[at + 11],
    dexterity12: raw[at + 12],
    unused13: raw[at + 13],
    word14: readU16LE(raw, at + 14),
    word16: readU16LE(raw, at + 16),
    word18: readU16LE(raw, at + 18),
    word20: readU16LE(raw, at + 20),
    uByte22: [raw[at + 22], raw[at + 23], raw[at + 24], raw[at + 25]],
  };
}

/** `ITEM12`, its two words little-endian. */
function readItem12(raw: Uint8Array, at: number): MonsterGraphicDesc {
  return {
    word0: readU16LE(raw, at),
    word2: readU16LE(raw, at + 2),
    frontRearByteWidth: raw[at + 4],
    frontRearHeight: raw[at + 5],
    sideByteWidth: raw[at + 6],
    sideHeight: raw[at + 7],
    attackByteWidth: raw[at + 8],
    attackHeight: raw[at + 9],
    uByte10: raw[at + 10],
    uByte11: raw[at + 11],
  };
}

/** `ITEM110`: eleven `ITEM110s`, each five x, y byte pairs. */
function readItem110(raw: Uint8Array, at: number): { x: number; y: number }[][] {
  const cells: { x: number; y: number }[][] = [];
  for (let cell = 0; cell < 11; cell++) {
    const pairs: { x: number; y: number }[] = [];
    for (let p = 0; p < 5; p++) pairs.push({ x: raw[at + 10 * cell + 2 * p], y: raw[at + 10 * cell + 2 * p + 1] });
    cells.push(pairs);
  }
  return cells;
}

/**
 * `ReadCSBgraphic(CGT_AlternateMonsterGraphic, id, sizeof(ALTMONGRAPH), …)` taken as an
 * `ALTMONGRAPH`, with its size, `actualSize`; null where it returns `NULL`.
 */
export function readAltMonGraph(csbGraphics: Pick<CSBGraphicsLoader, 'readSection'>, id: number): { graphic: AltMonGraph; size: number } | null {
  const raw = csbGraphics.readSection(CSBGraphicType.AlternateMonsterGraphic, id, ALTMONGRAPH_SIZE);
  if (!raw) return null;
  const offsets = MONSTERDESC_SIZE + ITEM12_SIZE + ITEM110_SIZE;
  const graphicOffsets: number[] = [];
  for (let i = 0; i < NUM_DERIVED_GRAPHIC; i++) graphicOffsets.push(readU32LE(raw, offsets + 4 * i) | 0);
  return {
    graphic: {
      monsterDesc: readMonsterDesc(raw, 0),
      item12: readItem12(raw, MONSTERDESC_SIZE),
      item110: readItem110(raw, MONSTERDESC_SIZE + ITEM12_SIZE),
      graphicOffsets,
      graphic: raw.subarray(ALTMONGRAPH_GRAPHIC),
    },
    size: raw.length,
  };
}

/**
 * `AltGraphicMapping(mt, altGraphic)` (`doc/CSBwin-src/Code51a4.cpp:1060-1069`), on
 * `level`, CSBWin's `d.LoadedLevel`: the section the dungeon names for alternate graphic
 * `altGraphic` of type `mt`, -1 when it names none (or no record of four longwords), and
 * -2 for "no alternate graphic". `altGraphic` indexes the four longwords unchecked, so
 * 4 to 7 read on past the record, as CSBWin's pointer does.
 */
export function AltGraphicMapping(db: ExpoolDatabase, level: number, mt: number, altGraphic: number): number {
  const located = new Expool(db).locateAt(altMonGraphicsKey(level, mt), altGraphic);
  if (located === null || located.size !== 4) return -1;
  return located.value | 0;
}

/** `ALTMONCACHE` (`doc/CSBwin-src/Code51a4.cpp:981-1026`), the record's half. */
class AltMonCacheEntry {
  pGraphic: AltMonGraph | null = null;
  /** -1 until searched; 0 with no `pGraphic` once a search found nothing. */
  size = -1;
  /** The section `pGraphic` is, or -1. */
  graphicID = -1;

  /** `ALTMONCACHE::Clear`. */
  Clear(): void {
    this.pGraphic = null;
    this.size = -1;
    this.graphicID = -1;
  }
}

/**
 * `altMonCache[27][4]` and `GetAlternateGraphicsRecord` (`doc/CSBwin-src/Code51a4.cpp:1029`,
 * `:1071-1110`). A slot remembers a search that found nothing (`size` 0) and keeps
 * answering `NULL` for it, even for another section, since only a slot holding a graphic
 * is cleared when its section changes. `CleanupAltMonCache` empties every slot.
 *
 * The slots are CSBWin's array of 27 by 4, row by row, which a type's `alternateGraphics()`
 * of 4 to 7 reaches past its row into the next type's: graphic 4 of type 5 is the slot of
 * graphic 0 of type 6. Past the array's 108 slots, where CSBWin writes into whatever
 * follows it, each slot is a cache of its own.
 */
export class AltMonCache {
  private readonly slots = new Map<number, AltMonCacheEntry>();

  private slot(mt: number, altGraphic: number): AltMonCacheEntry {
    const index = ALTMONCACHE_GRAPHICS * mt + altGraphic;
    let entry = this.slots.get(index);
    if (!entry) {
      entry = new AltMonCacheEntry();
      this.slots.set(index, entry);
    }
    return entry;
  }

  /** `CleanupAltMonCache` (`doc/CSBwin-src/Code51a4.cpp:1032-1042`). */
  CleanupAltMonCache(): void {
    for (const entry of this.slots.values()) entry.Clear();
  }

  /**
   * `GetAlternateGraphicsRecord(pMonster)` on `level`, `d.LoadedLevel`: the group's
   * alternate graphic, or null to draw its type's own.
   */
  GetAlternateGraphicsRecord(
    csbGraphics: Pick<CSBGraphicsLoader, 'readSection'> | null | undefined,
    db: ExpoolDatabase,
    level: number,
    pMonster: Pick<CreatureRecord, 'creatureType' | 'alternateGraphics'>,
  ): AltMonGraph | null {
    const mt = pMonster.creatureType;
    const altGraphic = pMonster.alternateGraphics;
    let id = AltGraphicMapping(db, level, mt, altGraphic);
    if (id === -2) return null;
    if (id < 0) {
      id = 3 * mt + altGraphic - 1;
      if (altGraphic === 0) return null;
    }
    const entry = this.slot(mt, altGraphic);
    if (entry.graphicID >= 0 && entry.graphicID !== id) entry.Clear();
    let pGraphic = entry.pGraphic;
    if (pGraphic === null) {
      if (entry.size === 0) return null;
      // A data set without the file reads nothing, as `ReadCSBgraphic` with none open.
      const read = csbGraphics ? readAltMonGraph(csbGraphics, id) : null;
      entry.size = 0;
      if (read === null) return null;
      entry.size = read.size;
      pGraphic = read.graphic;
      entry.pGraphic = pGraphic;
      entry.graphicID = id;
    }
    return pGraphic;
  }
}
