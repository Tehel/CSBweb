/**
 * The wings: champions who have left the party, each kept in `EXPOOL` as the 800-byte
 * `CHARDESC` they were (`CHARDESC::SaveToWings`, `GetFromWings`, `LocateInWings`,
 * `doc/CSBwin-src/Character.cpp:5174-5261`).
 *
 * A champion is eight records of 25 longwords, record `i` keyed
 * `(EDT_Character << 24) | (i << 16) | fingerPrint`. CSBWin writes the `CHARDESC` as it
 * sits in the little-endian build's memory, which is the file's form with
 * `swapCharacter`'s fields reversed (`doc/CSBwin-src/SaveGame.cpp:498-529`), and a
 * longword of the pool is four of those bytes taken little-endian, as the overlay
 * palette's are (`src/data/CsbwinExpool.ts`). Here a champion in the wings is handed in
 * and out in the file's form, the form `readCsbwinCharacter` and `writeCsbwinCharacter`
 * read and write.
 *
 * Only `SwapCharacter` (`Character.cpp:5497`), a DSA's `&SWAPCHARACTER`, puts a champion
 * in the wings, so the retail game never has one. A save carries them with the pool.
 */
import { readU16LE, readU32LE, writeU32LE } from '../core/bytes';
import { readCsbwinCharacter, swapCharacter } from '../data/CsbwinCharacters';
import { CHARDESC_SIZE } from '../data/CsbwinSaveInfo';
import type { DungeonState } from './DungeonState';
import type { Champion } from './gameTypes';

/** `EDT_Character` (`doc/CSBwin-src/CSB.h:1571`). */
const EDT_CHARACTER = 8;
/** The records of one champion, and the longwords of each. */
const WINGS_RECORDS = 8;
const WINGS_RECORD_LONGWORDS = 25;
/** `fingerPrint`'s offset in a `CHARDESC`, a word `swapCharacter` leaves as it is. */
const FINGERPRINT_OFFSET = 280;

/** What the wings reach of `expool`. A `DungeonState` is one. */
export type WingsPool = Pick<DungeonState, 'readExpoolRecord' | 'writeExpoolRecord' | 'locateExpoolRecord'>;

/** `(EDT_Character << 24) | (i << 16) | fingerprint`, the key of a champion's `i`th record. */
function wingsKey(i: number, fingerprint: number): number {
  return ((EDT_CHARACTER << 24) | (i << 16) | (fingerprint & 0xffff)) >>> 0;
}

/**
 * `CHARDESC::SaveToWings` (`doc/CSBwin-src/Character.cpp:5174-5194`): `character`, an
 * 800-byte `CHARDESC` in the file's form, as the eight records of its own fingerprint,
 * each after a `Read` of its key that takes an older one out.
 */
export function saveToWings(pool: WingsPool, character: Uint8Array): void {
  const memory = character.slice(0, CHARDESC_SIZE);
  swapCharacter(memory);
  const fingerprint = readU16LE(memory, FINGERPRINT_OFFSET);
  for (let i = 0; i < WINGS_RECORDS; i++) {
    const record: number[] = [];
    for (let j = 0; j < WINGS_RECORD_LONGWORDS; j++) record.push(readU32LE(memory, 100 * i + 4 * j));
    pool.readExpoolRecord(wingsKey(i, fingerprint));
    pool.writeExpoolRecord(wingsKey(i, fingerprint), record);
  }
}

/**
 * `CHARDESC::GetFromWings` (`doc/CSBwin-src/Character.cpp:5196-5243`): the champion with
 * `fingerprint`, in the file's form, or null. The records leave the pool (`Read`), or,
 * `testOnly`, stay there (`Locate`). It fails at the first record missing or not 25
 * longwords long, the records before it having left already, and on a record 0 whose
 * `fingerPrint` is not `fingerprint`.
 */
export function getFromWings(pool: WingsPool, fingerprint: number, testOnly: boolean): Uint8Array | null {
  const wanted = fingerprint & 0xffff;
  const memory = new Uint8Array(CHARDESC_SIZE);
  // `pChar->fingerPrint = 0xffff`, which a failed first record leaves.
  memory[FINGERPRINT_OFFSET] = 0xff;
  memory[FINGERPRINT_OFFSET + 1] = 0xff;
  for (let i = 0; i < WINGS_RECORDS; i++) {
    const key = wingsKey(i, wanted);
    const record = testOnly ? pool.locateExpoolRecord(key) : pool.readExpoolRecord(key);
    if (record?.length !== WINGS_RECORD_LONGWORDS) return null;
    for (let j = 0; j < WINGS_RECORD_LONGWORDS; j++) writeU32LE(memory, 100 * i + 4 * j, record[j]!);
  }
  if (readU16LE(memory, FINGERPRINT_OFFSET) !== wanted) return null;
  swapCharacter(memory);
  return memory;
}

/**
 * `CHARDESC::LocateInWings` (`doc/CSBwin-src/Character.cpp:5245-5261`): the first record
 * of the champion with `fingerprint`, its 100 bytes as the little-endian build holds them,
 * or null. They hold the name, which `swapCharacter` does not touch, and CSBWin reads
 * nothing else of them.
 */
export function locateInWings(pool: WingsPool, fingerprint: number): Uint8Array | null {
  const record = pool.locateExpoolRecord(wingsKey(0, fingerprint));
  if (record?.length !== WINGS_RECORD_LONGWORDS) return null;
  const bytes = new Uint8Array(4 * WINGS_RECORD_LONGWORDS);
  for (let j = 0; j < WINGS_RECORD_LONGWORDS; j++) writeU32LE(bytes, 4 * j, record[j]!);
  return bytes;
}

/** A `CHARDESC` in the file's form, read as a champion. */
export function wingsChampion(character: Uint8Array): Champion {
  return readCsbwinCharacter(character, 0).champion;
}

