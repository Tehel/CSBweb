/**
 * The dungeon image's arithmetic, which the reader (`DungeonLoader`), a save's read
 * (`readSaveFile`), the writer (`CsbwinDungeonImageWriter`) and `Chaos` share: how
 * large each database's record is, and where each section of an image sits.
 */
import { readU16BE, readU32LE } from '../core/bytes';
import { DUNGEON_HEADER_SIZE, MAP_DESCRIPTOR_SIZE } from '../core/constants';
import { DBType } from '../core/types';
import { EXPOOL_RECORD_SIZE } from './CsbwinExpool';

/** The shape of an image's records, which its Extended Features block declares. */
export interface DatabaseShape {
  /** ACTUATOR records are 10 bytes, not 8 (`MakeBigActuators`). */
  bigActuators?: boolean;
  /** SCROLL records are 6 bytes with an RN text reference, not 4 with a 10-bit index. */
  newScrolls?: boolean;
}

/**
 * `dbEntrySizes` (`doc/CSBwin-src/data.cpp:395-413`): the size of a record of database
 * `db` in an image of the shape `shape`, whatever else the file holds. CSBWin's table holds the *big* actuator, and
 * `ReadDatabases` takes 2 from it for an image without big actuators
 * (`doc/CSBwin-src/SaveGame.cpp:2783-2787`); the new scroll is 2 bytes longer from
 * extended-features version 'B' (`:2401-2412`).
 */
export function dbEntrySize(db: number, shape: DatabaseShape): number {
  if (db === DBType.ACTUATOR && shape.bigActuators) return 10;
  if (db === DBType.SCROLL && shape.newScrolls) return 6;
  return RECORD_SIZES[db] ?? 0;
}

/** `sizeof (DB0)` to `sizeof (DB15)`; DB11, EXPOOL's, is 256 (`doc/CSBwin-src/CSB.h:1283-1291`). */
const RECORD_SIZES = [4, 6, 4, 8, 16, 4, 4, 4, 4, 8, 4, EXPOOL_RECORD_SIZE, 0, 0, 8, 4];

/**
 * Where each section of the dungeon image sits, relative to `startOffset`.
 *
 * The image is blocks 7-14 of the save (`doc/CSBWIN_SAVEGAME_REFERENCE.md`), written
 * plain by `WriteAndChecksum` and read back plain by `ReadDatabases` — a save is
 * loaded with `d.gameState == GAMESTATE_ResumeSavedGame`, which skips that function's
 * compression preamble (`doc/CSBwin-src/SaveGame.cpp:2557-2586`).
 *
 * Two record sizes are not the `dungeon.dat` ones, which is what made this arithmetic
 * fail for years' worth of guesses:
 *
 * - **ACTUATOR is 2 bytes larger** unless the file predates big actuators.
 *   `ReadDatabases` spells it as a subtraction from the *big* size —
 *   `if ((D6W==dbACTUATOR) & !bigActuators) D4W -= 2;`
 *   (`doc/CSBwin-src/SaveGame.cpp:2783-2787`) — so `dbEntrySizes[dbACTUATOR]` is the
 *   big one and the small one is the special case.
 * - **SCROLL is 2 bytes larger** from extended-features version `'B'` on.
 *   `readScrollDatabase` branches to `readNewScrollDatabase` at `>= 'B'`, and its own
 *   comment says why: "The old version had a 10-bit index into the text database. The
 *   new version has an RN reference to the text."
 *   (`doc/CSBwin-src/SaveGame.cpp:2401-2412`).
 *
 * And the indirect-text block is **little-endian** — both the index and the
 * `sizeOfCompressedText` word after it — while every other word in the image is
 * big-endian. It is a PC-era addition whose swap helper is a no-op on the shipping
 * build, exactly like the Extended Features header.
 */
export interface DungeonImageLayout {
  numMaps: number;
  totalColumns: number;
  objectListSize: number;
  objectCounts: number[];
  recordSizes: number[];
  /** All absolute file offsets. */
  columnIndex: number;
  objectList: number;
  text: number;
  databases: number[];
  cellFlags: number;
}

export function computeDungeonImageLayout(
  data: Uint8Array,
  startOffset: number,
  options: { indirectText: boolean } & DatabaseShape,
): DungeonImageLayout | null {
  if (startOffset + DUNGEON_HEADER_SIZE > data.length) return null;

  const numMaps = data[startOffset + 4] ?? 0;
  // `ReadDatabases` reads `16 * NumLevel()` bytes of descriptors, whatever the byte says
  // (`doc/CSBwin-src/SaveGame.cpp:2623-2639`): Conflux 3.5 has 64 levels, and an image of
  // none has none, which a caller that needs a level refuses.
  const textDataSize = readU16BE(data, startOffset + 6);
  const objectListSize = readU16BE(data, startOffset + 10);

  const objectCounts: number[] = [];
  for (let i = 0; i < 16; i++) objectCounts.push(readU16BE(data, startOffset + 12 + i * 2));

  const recordSizes = Array.from({ length: 16 }, (_, db) => dbEntrySize(db, options));

  let totalColumns = 0;
  for (let i = 0; i < numMaps; i++) {
    const offset = startOffset + DUNGEON_HEADER_SIZE + i * MAP_DESCRIPTOR_SIZE;
    if (offset + MAP_DESCRIPTOR_SIZE > data.length) return null;
    totalColumns += ((readU16BE(data, offset + 8) >> 6) & 0x1f) + 1;
  }

  const columnIndex = startOffset + DUNGEON_HEADER_SIZE + numMaps * MAP_DESCRIPTOR_SIZE;
  const objectList = columnIndex + totalColumns * 2;
  const text = objectList + objectListSize * 2;

  let databaseStart: number;
  if (options.indirectText) {
    // `NumWordsInTextArray` is repurposed by `ConvertToIndirectText`, which assigns it
    // the index length (`doc/CSBwin-src/SaveGame.cpp:2484`), so in a save it counts
    // index entries, not text words.
    const sizeOffset = text + textDataSize * 4;
    if (sizeOffset + 4 > data.length) return null;
    const compressedSize = readU32LE(data, sizeOffset);
    databaseStart = sizeOffset + 4 + compressedSize * 2;
  } else {
    databaseStart = text + textDataSize * 2;
  }

  const databases: number[] = [];
  let cursor = databaseStart;
  for (let db = 0; db < 16; db++) {
    databases.push(cursor);
    cursor += objectCounts[db]! * (recordSizes[db] ?? 0);
  }
  if (cursor > data.length) return null;

  return {
    numMaps, totalColumns, objectListSize, objectCounts, recordSizes,
    columnIndex, objectList, text, databases, cellFlags: cursor,
  };
}
