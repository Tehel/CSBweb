/**
 * The Amiga 2.2 program, `tools/fixtures/gamefiles/amiga-2.2/dm`: its hunks, and where in
 * them the tables the `dm-amiga` set takes sit (`doc/AMIGA_DISK_REFERENCE.md` → "`dm`, the
 * program"). `tools/checks/amiga-disk.ts` proves every offset against ReDMCSB's A22E source.
 *
 * `dm` is an AmigaDOS load file: a `HUNK_HEADER` (0x3f3) giving the hunks' count and their
 * sizes in memory, then each hunk, a `HUNK_CODE` (0x3e9) or `HUNK_DATA` (0x3ea) with its
 * stored longs, or a `HUNK_BSS` (0x3eb) with only its size, followed by its relocations
 * (`HUNK_RELOC32`, 0x3ec, and `HUNK_SYMBOL`, 0x3f0) and a `HUNK_END` (0x3f2). A hunk's
 * memory past its stored longs is zero. Everything is a big-endian long.
 *
 * Usage:
 *
 *   import { DM, DM_TABLES, dmHunks, dmTable } from './lib/amigaDm';
 *   dmTable(readFileSync(DM), 'sounds')   // the 34 SOUND_DATA, 272 bytes
 */

export const DM = 'tools/fixtures/gamefiles/amiga-2.2/dm';

const HUNK_HEADER = 0x3f3;
const HUNK_CODE = 0x3e9;
const HUNK_DATA = 0x3ea;
const HUNK_BSS = 0x3eb;
const HUNK_RELOC32 = 0x3ec;
const HUNK_SYMBOL = 0x3f0;
const HUNK_END = 0x3f2;

/** A hunk: its type, its size in memory, and where its stored bytes are in the file. */
export interface Hunk {
  type: 'code' | 'data' | 'bss';
  memorySize: number;
  fileOffset: number;
  storedSize: number;
}

/** `dm`'s hunks, in their order. */
export function dmHunks(dm: Uint8Array): Hunk[] {
  const view = new DataView(dm.buffer, dm.byteOffset, dm.byteLength);
  let at = 0;
  const long = (): number => { const value = view.getUint32(at); at += 4; return value; };
  if (long() !== HUNK_HEADER) throw new Error('not an AmigaDOS load file (no HUNK_HEADER)');
  while (long() !== 0) at += view.getUint32(at - 4) * 4;
  long();
  const first = long();
  const last = long();
  const hunks: Hunk[] = [];
  for (let h = first; h <= last; h++) hunks.push({ type: 'bss', memorySize: (long() & 0x3fffffff) * 4, fileOffset: 0, storedSize: 0 });
  for (const hunk of hunks) {
    for (;;) {
      const type = long() & 0x3fffffff;
      if (type === HUNK_CODE || type === HUNK_DATA) {
        hunk.type = type === HUNK_CODE ? 'code' : 'data';
        hunk.storedSize = long() * 4;
        hunk.fileOffset = at;
        at += hunk.storedSize;
      } else if (type === HUNK_BSS) {
        long();
      } else if (type === HUNK_RELOC32) {
        for (let count = long(); count !== 0; count = long()) at += 4 + count * 4;
      } else if (type === HUNK_SYMBOL) {
        for (let count = long(); count !== 0; count = long()) at += count * 4 + 4;
      } else if (type === HUNK_END) {
        break;
      } else {
        throw new Error(`hunk type 0x${type.toString(16)} at file byte ${at - 4}`);
      }
    }
  }
  if (at !== dm.length) throw new Error(`the hunks end at ${at}, the file at ${dm.length}`);
  return hunks;
}

/** The hunk that holds every table below: the program's one data hunk. */
export const DM_DATA_HUNK = 1;

/** The tables, by their offset in the data hunk and their size: ReDMCSB's names, A22E's branches. */
export const DM_TABLES = {
  /** `G0019_aui_Graphic562_Palette_Credits[16]`, words, 0x0RGB at 4 bits a channel. */
  creditsPalette: { offset: 2784, size: 16 * 2 },
  /** `G0020_aui_Graphic562_Palette_Entrance[16]`, words, 0x0RGB at 4 bits a channel. */
  entrancePalette: { offset: 2816, size: 16 * 2 },
  /** `G0021_aaui_Graphic562_Palette_DungeonView[6][16]`, words, 0x0RGB at 4 bits a channel. */
  dungeonViewPalettes: { offset: 2848, size: 6 * 16 * 2 },
  /** `G0060_as_Graphic562_Sounds[34]`, `SOUND_DATA`: a word and six bytes. */
  sounds: { offset: 3738, size: 34 * 8 },
  /** `G0243_as_Graphic559_CreatureInfo[27]`, `CREATURE_INFO`, 26 bytes. */
  creatureInfo: { offset: 5818, size: 27 * 26 },
  /** `G0244_auc_Graphic559_CreatureAttackSounds[11]`, bytes. */
  creatureAttackSounds: { offset: 6520, size: 11 },
  /** `G0205_aaauc_Graphic558_WallOrnamentCoordinateSets[8][13][6]`: X1, X2, Y1, Y2, ByteWidth, Height. */
  wallOrnamentCoordinateSets: { offset: 8934, size: 8 * 13 * 6 },
  /** `G0220_as_Graphic558_CreatureReplacementColorSets[13]`: six words 0x0RGB at 4 bits, then the D2 and D3 bytes. */
  creatureReplacementColorSets: { offset: 11134, size: 13 * 14 },
  /** `G1028_aauc_DistanceToSoundVolume[25][25]`, bytes. */
  distanceToSoundVolume: { offset: 11974, size: 25 * 25 },
} as const;

/** A table's bytes, read from `dm`. */
export function dmTable(dm: Uint8Array, name: keyof typeof DM_TABLES): Uint8Array {
  const hunk = dmHunks(dm)[DM_DATA_HUNK]!;
  const { offset, size } = DM_TABLES[name];
  if (hunk.type !== 'data' || offset + size > hunk.storedSize) throw new Error(`${name} is not in the data hunk's stored bytes`);
  return dm.subarray(hunk.fileOffset + offset, hunk.fileOffset + offset + size);
}
