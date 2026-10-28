/**
 * The `dm-amiga` set's table item: four of the Amiga program's tables, which the port's
 * `graphics.dat` carries as its item 598 (`doc/AMIGA_DISK_REFERENCE.md` → "The `dm-amiga`
 * set's `graphics.dat`"). A file without it plays the Atari's sounds.
 *
 * Not CSBWin's: the authority is ReDMCSB's A22E branch (`CLAUDE.md`).
 */
import type { GraphicsLoader } from '../GraphicsLoader';
import type { SoundTableEntry } from './UITables';

/** The table item, and its size. */
export const AMIGA_TABLE_ITEM = 598;
const AMIGA_TABLE_SIZE = 935;

/** `M513_SOUND_COUNT` (ReDMCSB `DEFS.H:55-57`). */
export const AMIGA_SOUND_COUNT = 34;

/** `SOUND_DATA` (ReDMCSB `DEFS.H:36-47`), its two unreferenced bytes left out. */
export interface AmigaSoundData {
  /** The item of the port's `graphics.dat` that holds the sound. */
  readonly graphicIndex: number;
  readonly period: number;
  readonly priority: number;
  readonly loudDistance: number;
  readonly softDistance: number;
}

export interface AmigaSoundTables {
  /** `G0060_as_Graphic562_Sounds[34]` (ReDMCSB `DATA.C:1165-1201`). */
  readonly sounds: readonly AmigaSoundData[];
  /** `G1028_aauc_DistanceToSoundVolume[25][25]`, row by row (ReDMCSB `SOUND.C:55-81`). */
  readonly distanceToSoundVolume: Uint8Array;
  /** `G0244_auc_Graphic559_CreatureAttackSounds[11]` (ReDMCSB `DUNGEON.C:503-517`). */
  readonly creatureAttackSounds: Uint8Array;
  /** The 27 creatures' `AttackSoundOrdinal`, `CREATURE_INFO`'s second byte (`DUNGEON.C:439-499`). */
  readonly attackSoundOrdinals: Uint8Array;
}

/** The set's table item, or `null` for a `graphics.dat` that does not carry one. */
export function extractAmigaSoundTables(graphics: GraphicsLoader): AmigaSoundTables | null {
  if (graphics.getItemCount() <= AMIGA_TABLE_ITEM) return null;
  const raw = graphics.getRawGraphic(AMIGA_TABLE_ITEM);
  if (raw.length !== AMIGA_TABLE_SIZE) return null;
  const sounds: AmigaSoundData[] = [];
  for (let i = 0; i < AMIGA_SOUND_COUNT; i++) {
    const at = i * 8;
    sounds.push({
      graphicIndex: (raw[at]! << 8) | raw[at + 1]!,
      period: raw[at + 3]!,
      priority: raw[at + 4]!,
      loudDistance: raw[at + 6]!,
      softDistance: raw[at + 7]!,
    });
  }
  return {
    sounds,
    distanceToSoundVolume: raw.slice(272, 897),
    creatureAttackSounds: raw.slice(897, 908),
    attackSoundOrdinals: raw.slice(908, 935),
  };
}

/**
 * The Amiga sound to play for each of the Atari's SND items, through the ordinals they
 * share: the Atari's `d.sound1772[k]` and the Amiga's `G0060_as_Graphic562_Sounds[k]`, for
 * the 22 ordinals the two tables have (ReDMCSB `DEFS.H:63-98`). Ordinals 5 and 20 name one
 * item in both tables, at one period.
 */
export function amigaSoundsByAtariItem(
  sound1772: readonly SoundTableEntry[],
  amiga: AmigaSoundTables,
): Map<number, AmigaSoundData> {
  const byItem = new Map<number, AmigaSoundData>();
  sound1772.forEach((entry, ordinal) => {
    const sound = amiga.sounds[ordinal];
    if (sound && !byItem.has(entry.word0)) byItem.set(entry.word0, sound);
  });
  return byItem;
}

/** `SOUND_VOLUME` (ReDMCSB `DEFS.H:31-34`): Paula's volume on each channel, 0 to 64. */
export interface SoundVolume {
  readonly left: number;
  readonly right: number;
}

/**
 * `F0505_SOUND_GetVolume` (ReDMCSB `SOUND.C:1871-1919`): the volume of a sound on
 * `(sourceX, sourceY)` heard by a party on `(partyX, partyY)` facing `facing`. The
 * source's offset, turned to the party's facing, is a line (ahead is negative) and a
 * column (right is positive) of `G1028_aauc_DistanceToSoundVolume`, centred on 12; the
 * right channel reads that column, the left its mirror. `null`, not heard, more than 12
 * squares away along either.
 */
export function getVolume(
  tables: AmigaSoundTables,
  partyX: number,
  partyY: number,
  facing: number,
  sourceX: number,
  sourceY: number,
): SoundVolume | null {
  let rightColumn = 0;
  let line = 0;
  switch (facing) {
    case 0: rightColumn = sourceX - partyX; line = sourceY - partyY; break;
    case 1: rightColumn = sourceY - partyY; line = -(sourceX - partyX); break;
    case 2: rightColumn = -(sourceX - partyX); line = -(sourceY - partyY); break;
    case 3: rightColumn = -(sourceY - partyY); line = sourceX - partyX; break;
  }
  if (rightColumn < -12 || rightColumn > 12) return null;
  if (line < -12 || line > 12) return null;
  const row = (line + 12) * 25;
  return {
    right: tables.distanceToSoundVolume[row + rightColumn + 12]!,
    left: tables.distanceToSoundVolume[row - rightColumn + 12]!,
  };
}

/**
 * `F0502_SOUND_CompareVolumes` (ReDMCSB `SOUND.C:227-268`): 1, 0 or -1 as `volume1` is
 * louder, as loud or quieter than `volume2`, each counted by its two channels' sum in
 * three classes: above 25, 15 to 25, below 15.
 */
export function compareVolumes(volume1: SoundVolume, volume2: SoundVolume): number {
  const level = (volume: SoundVolume): number => {
    const total = volume.left + volume.right;
    if (total > 25) return 2;
    return 15 > total ? 0 : 1;
  };
  const level1 = level(volume1);
  const level2 = level(volume2);
  if (level1 > level2) return 1;
  return level1 === level2 ? 0 : -1;
}
