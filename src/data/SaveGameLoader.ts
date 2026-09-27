/**
 * Minimal save-game loader focused on Item16 and timer tables.
 *
 * This follows CSBWin `ReadUnscrambleBlock` and `UnscrambleStream` logic
 * and expects the standard (non-extended-features) save-game layout.
 */

import type { DungeonData, Item16Record, TimerRecord, DsaIndex, DsaDefinition, MissileRecord } from './dungeonTypes';
import { DBType, OBJECT_ID_NULL, type ObjectID } from '../core/types';
import { MakeBigActuators } from './CsbwinDungeonConversions';
import { formChecksum, readObjectIndirectIndex } from './CsbwinObjectIndex';
import type { CsbwinObjectIndex } from './CsbwinObjectIndex';
import {
  EXTENDED_FEATURES_SIZE,
  buildExtendedFeaturesPrefix,
  parseExtendedFeaturesBlock,
} from './CsbwinExtendedFeatures';
import { buildImageChecksum } from './CsbwinDungeonImageWriter';
import type { ExtendedFeaturesBlock } from './CsbwinExtendedFeatures';
import type { PartyState } from '../engine/gameTypes';
import { readI16BE, readU16BE, readU16LE, readU32BE, readU32LE } from '../core/bytes';

export interface SaveGameState {
  item16: Item16Record[];
  timers?: TimerRecord[];
  /**
   * The live timer queue: `gb2.NumTimer` indices into `timers`, in the order of CSBWin's
   * heap (`GameTimers::TimerQueue`), not their firing order. Empty when the file carries
   * none.
   */
  timerQueue?: number[];
  /** `gb2.TimerSequence` — the stamp the next queued timer takes. */
  timerSequence?: number;
  missiles?: MissileRecord[];
  maxItem16: number;
  maxTimers: number;
  sequencedTimers: boolean;
  extendedTimers: boolean;
  bigActuators?: boolean;
  /** `EXTENDEDFEATURESBLOCK.flags & IndirectText` — the text section's shape. */
  indirectText?: boolean;
  /** `EXTENDEDFEATURESBLOCK.version` (offset 36); `'B'` (0x42) and up use new scrolls. */
  version?: number;
  dsaLevelIndex?: number[][];
  dsaIndex?: DsaIndex;
  extendedWallDecorations?: boolean;
  specialLocations?: Record<number, number>;
  spellFilterLocation?: number;
  /**
   * `gb2.handChar` — the champion index holding the cursor, -1 for nobody.
   * `LoadGame` restores `d.HandChar` from it (`doc/CSBwin-src/SaveGame.cpp:1636`).
   */
  handChar?: number;
  /** `gb2.MagicCaster`, restored on the next line of the same function (`:1637`). */
  magicCaster?: number;
  /**
   * The rest of `GAMEBLOCK2`, as `LoadGame` reads it
   * (`doc/CSBwin-src/SaveGame.cpp:1617-1650`). Present when the block was parsed.
   */
  block2?: Block2;
  /**
   * The 512-byte "Extended Features" header, field for field. Present exactly when the
   * file carries a block 0; `saveSaveGameState` writes the whole prefix back when it is.
   */
  extendedFeatures?: ExtendedFeaturesBlock;
  /**
   * `gameInfo` as the file holds it, without the terminator `ReadGameInfo` appends.
   * Carried verbatim: it is a free-text blob the game only ever shows.
   */
  gameInfo?: Uint8Array;
  /**
   * The DSA section verbatim — `WriteDSAs`' output plus its four-byte checksum. Present
   * only when `extendedFeatures.numDSA` is non-zero, which no committed save is.
   */
  dsaBlock?: Uint8Array;
  /**
   * `ExtendedFeaturesSize` (`doc/CSBwin-src/SaveGame.cpp:1597`) — how many bytes of
   * block 0 precede GAMEBLOCK1, and so where block 1 starts. Zero for a file with no
   * Extended Features prefix at all.
   */
  extendedFeaturesSize?: number;
  /**
   * Byte offset at which the plain, unscrambled dungeon image begins — immediately
   * after the timer queue. `LoadGame` calls `ReadDatabases()` there
   * (`doc/CSBwin-src/SaveGame.cpp:1739`), and because a save is loaded with
   * `d.gameState == GAMESTATE_ResumeSavedGame` that function skips its own
   * extended-features/compression preamble and reads straight on from the current
   * file position (`doc/CSBwin-src/SaveGame.cpp:2345-2346`).
   */
  dungeonImageOffset?: number;
  /** Where every section of the dungeon image sits. Absent if the header did not parse. */
  imageLayout?: DungeonImageLayout;
  /** `EXTENDEDFEATURESBLOCK.cellFlagArraySize` — the last section's length. */
  cellFlagArraySize?: number;
  /**
   * The object indirect index. Every RN in this file — the object list, every record's
   * link, a chest's contents, a monster's possessions, a champion's thirty slots — is a
   * slot number in it rather than a packed RN, so nothing that reads an object out of
   * the file is meaningful without it (`src/data/CsbwinObjectIndex.ts`).
   */
  objectIndex?: CsbwinObjectIndex;
  /**
   * The raw, unscrambled 3328-byte block 4. It is **not** only the four champions:
   * `CHARDESC[4]` is 3200 bytes and the remaining 128 are party-wide state
   * (`Brightness`, `SeeThruWalls`, the shield timers, `PartyFootprints[24]`,
   * `Invisible`, …), bracketed in `doc/CSBwin-src/Data.h:765-783`. Handed over raw
   * because it is the unit both halves work in: `src/data/CsbwinCharacters.ts`
   * unpacks it on the way in and packs it on the way out, and `saveSaveGameState`
   * writes whatever is here into block 4 verbatim.
   */
  characterBlock?: Uint8Array;
  /**
   * Blocks 7-14 — the whole dungeon image — already serialised, as
   * `buildDungeonImage` (`src/data/CsbwinDungeonImageWriter.ts`) produces it.
   * `saveSaveGameState` appends it after the timer queue and closes the file with
   * `WriteAndChecksum`'s word; without it the file is the blocks 0-6 prefix.
   *
   * It is handed over ready-made rather than built here because the image needs the
   * whole `DungeonData` and the object indirect index whose maps block 0 carries, and
   * those two have to be the same index — the slot numbers in the image and the slot
   * numbers in the maps are one numbering.
   */
  dungeonImage?: Uint8Array;
}

interface Block1 {
  block2Hash: number;
  item16Hash: number;
  characterHash: number;
  timersHash: number;
  timerQueueHash: number;
  block2Checksum: number;
  item16Checksum: number;
  characterChecksum: number;
  timersChecksum: number;
  timerQueueChecksum: number;
}

/**
 * The fields of `GAMEBLOCK2` this port reads. The block is 128 bytes and every offset
 * in it is spelled out in CSBWin's own struct comments
 * (`doc/CSBwin-src/SaveGame.cpp:107-133`); what is missing here is missing because
 * nothing consumes it yet, not because the layout is unknown.
 */
export interface Block2 {
  /** `gb2.Time` (offset 0) — `d.Time`, the game clock in ticks. */
  time: number;
  /** `gb2.ranseed` (offset 4) — `d.RandomNumber`. */
  ranseed: number;
  /** `gb2.ObjectInHand` (offset 8) — the RN on the cursor, 0 for none. */
  objectInHand: number;
  /** `gb2.numcharacter` (offset 10) — how many champions are in the party. */
  numCharacter: number;
  partyX: number;
  partyY: number;
  partyFacing: number;
  partyLevel: number;
  /** `gb2.handChar` (offset 20) — the champion *index* holding the cursor. */
  handChar: number;
  /** `gb2.MagicCaster` (offset 22) — the champion index whose rune panel is up. */
  magicCaster: number;
  numTimer: number;
  firstAvailTimer: number;
  maxTimers: number;
  item16QueLen: number;
  lastMonsterAttackTime: number;
  lastPartyMoveTime: number;
  /** `gb2.partyMoveDisableTimer` (offset 40) — `PartyState.partyMoveDisableTimer`. */
  partyMoveDisableTimer: number;
  /** `gb2.Word11712` (offset 42) — `PartyState.word11712`, a throw's move lock. */
  word11712: number;
  /** `gb2.Word11714` (offset 44) — `PartyState.word11714`, the direction it locks. */
  word11714: number;
  maxItem16: number;
  timerSequence: number;
}

/** Every field zero, for a caller that has only some of them. */
export function emptyBlock2(): Block2 {
  return {
    time: 0, ranseed: 0, objectInHand: 0, numCharacter: 0,
    partyX: 0, partyY: 0, partyFacing: 0, partyLevel: 0,
    handChar: -1, magicCaster: -1, numTimer: 0, firstAvailTimer: 0,
    maxTimers: 0, item16QueLen: 0, lastMonsterAttackTime: 0, lastPartyMoveTime: 0,
    partyMoveDisableTimer: 0, word11712: 0, word11714: 0, maxItem16: 0, timerSequence: 0,
  };
}

const BLOCK1_SIZE = 512;
const BLOCK2_SIZE = 128;
const CHARACTER_SIZE = 3328;
const EXTENDED_SENTINEL = ' Extended Features ';

/*
 * The save file's own byte order.
 *
 * Every word of GAMEBLOCK1, GAMEBLOCK2, `ITEM16`, the characters and the timers is
 * **big-endian**, inherited from the Atari. CSBWin never says so outright; it says it
 * by reading each word through `LE16()`, which on the little-endian build it ships
 * as is a byte swap (`doc/CSBwin-src/CSBTypes.h:146`). So `Unscramble`'s hash
 * arithmetic runs on `LE16(wordGear(A3))` (`doc/CSBwin-src/CSBCode.cpp:9057-9061`),
 * `ReadUnscrambleBlock` sums `LE16(wordGear(...))` (`:9083-9098`), and `swapBlock2`
 * `BO()`s every field afterwards (`doc/CSBwin-src/SaveGame.cpp:455-478`) — three
 * statements of the same fact.
 *
 * The one part of the file that is *not* big-endian is the CSB "Extended Features"
 * header, which is a PC-era addition written in native order:
 * `SwapExtendedFeaturesBlock` swaps it only `#ifdef _bigEndian`
 * (`doc/CSBwin-src/SaveGame.cpp:275-293`), so on the shipping build it is a no-op and
 * the block stays little-endian. That is why `readU16LE`/`readU32LE` are used here for
 * exactly that block, and nothing else.
 */

const EXPOOL_RECORD_SIZE = 256;
const EXPOOL_WORDS_PER_BLOCK = 64;
const EDT_SPECIAL_LOCATIONS = 3;
const ESL_SPECIAL_LOCATION_MAX = 15;

function writeU16BE(buf: Uint8Array, off: number, value: number): void {
  buf[off] = (value >> 8) & 0xff;
  buf[off + 1] = value & 0xff;
}

function writeU32BE(buf: Uint8Array, off: number, value: number): void {
  buf[off] = (value >>> 24) & 0xff;
  buf[off + 1] = (value >>> 16) & 0xff;
  buf[off + 2] = (value >>> 8) & 0xff;
  buf[off + 3] = value & 0xff;
}

function genChecksum(buf: Uint8Array, initialHash: number, numWords: number): number {
  let result = initialHash & 0xffff;
  let hash = initialHash & 0xffff;
  let count = numWords & 0xffff;
  let off = 0;
  while (count !== 0) {
    const word = readU16BE(buf, off);
    result = (result + word) & 0xffff;
    result = (result + (word ^ hash)) & 0xffff;
    hash = (hash + count) & 0xffff;
    off += 2;
    count = (count - 1) & 0xffff;
  }
  return result & 0xffff;
}

function scramble(buf: Uint8Array, initialHash: number, numWords: number): number {
  let d7 = initialHash & 0xffff;
  let d6 = numWords & 0xffff;
  let d5 = initialHash & 0xffff;
  let off = 0;
  while (d6 !== 0) {
    const plain = readU16BE(buf, off);
    const word = plain ^ d7;
    d5 = (d5 + word) & 0xffff;
    buf[off] = (word >> 8) & 0xff;
    buf[off + 1] = word & 0xff;
    d5 = (d5 + plain) & 0xffff;
    off += 2;
    d7 = (d7 + d6) & 0xffff;
    d6 = (d6 - 1) & 0xffff;
  }
  return d5 & 0xffff;
}

function rc4Simple(buf: Uint8Array, key: Uint8Array): Uint8Array {
  const out = new Uint8Array(buf.length);
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i++) s[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 0xff;
    const tmp = s[i];
    s[i] = s[j];
    s[j] = tmp;
  }
  let i = 0;
  j = 0;
  for (let k = 0; k < buf.length; k++) {
    i = (i + 1) & 0xff;
    j = (j + s[i]) & 0xff;
    const tmp = s[i];
    s[i] = s[j];
    s[j] = tmp;
    const idx = (s[i] + s[j]) & 0xff;
    out[k] = buf[k] ^ s[idx];
  }
  return out;
}

function hasExtendedSentinel(buf: Uint8Array): boolean {
  if (buf.length < EXTENDED_SENTINEL.length) return false;
  for (let i = 0; i < EXTENDED_SENTINEL.length; i++) {
    if (buf[i] !== EXTENDED_SENTINEL.charCodeAt(i)) return false;
  }
  return true;
}

class RcsReader {
  private checksum = 0xffff;
  private offset: number;

  constructor(private data: Uint8Array, startOffset: number) {
    this.offset = startOffset;
  }

  getOffset(): number {
    return this.offset;
  }

  resetChecksum(): void {
    this.checksum = 0xffff;
  }

  finalizeChecksum(): number {
    const out = this.checksum >>> 0;
    this.checksum = 0xffff;
    return out;
  }

  readBytes(count: number): Uint8Array {
    const end = this.offset + count;
    if (end > this.data.length) throw new Error('savegame truncated while reading DSA data');
    const buf = this.data.subarray(this.offset, end);
    for (let i = 0; i < buf.length; i++) {
      // Plain `*` loses precision here (see `BytecodeInterpreter.graphicRandom`'s
      // comment for why): `Math.imul` gives the exact 32-bit-wraparound product
      // `ui32(0xbb40e62d)` means in C.
      this.checksum = (Math.imul(this.checksum, 0xbb40e62d) + 11 + buf[i]) >>> 0;
    }
    this.offset = end;
    return buf;
  }

  readU8(): number {
    return this.readBytes(1)[0] ?? 0;
  }

  readU16(): number {
    const b = this.readBytes(2);
    return (b[0] ?? 0) | ((b[1] ?? 0) << 8);
  }

  readU32(): number {
    const b = this.readBytes(4);
    return ((b[0] ?? 0) | ((b[1] ?? 0) << 8) | ((b[2] ?? 0) << 16) | ((b[3] ?? 0) << 24)) >>> 0;
  }
}

function decodeCString(bytes: Uint8Array): string {
  let end = bytes.length;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0) {
      end = i;
      break;
    }
  }
  let out = '';
  for (let i = 0; i < end; i++) {
    out += String.fromCharCode(bytes[i] ?? 0);
  }
  return out;
}

function readU16Array(bytes: Uint8Array, count: number): number[] {
  const out: number[] = new Array(count);
  let off = 0;
  for (let i = 0; i < count; i++) {
    out[i] = (bytes[off] ?? 0) | ((bytes[off + 1] ?? 0) << 8);
    off += 2;
  }
  return out;
}

function readDsa(rcs: RcsReader): DsaDefinition {
  const description = decodeCString(rcs.readBytes(80));
  const state = rcs.readU16();
  const localState = rcs.readU8();
  const groupId = rcs.readU8();
  const numStates = rcs.readU32();
  const firstDisplayedState = rcs.readU32();
  const numNonEmptyStates = rcs.readU32();
  const states: Array<{ actions: Array<{ column: number; program: Uint16Array }> } | null> =
    Array.from({ length: numStates }, () => null);

  for (let i = 0; i < numNonEmptyStates; i++) {
    const stateNum = rcs.readU32();
    if (stateNum >= numStates) throw new Error('savegame DSA state out of range');
    const numActions = rcs.readU32();
    if (numActions > 12) throw new Error('savegame DSA actions > 12');
    const actions: Array<{ column: number; program: Uint16Array }> = [];
    for (let j = 0; j < numActions; j++) {
      const column = rcs.readU32();
      const numPgmWords = rcs.readU32();
      let program = new Uint16Array();
      if (numPgmWords > 0) {
        const bytes = rcs.readBytes(numPgmWords * 2);
        program = Uint16Array.from(readU16Array(bytes, numPgmWords));
      }
      actions.push({ column, program });
    }
    states[stateNum] = { actions };
  }

  return {
    description,
    state,
    localState,
    groupId,
    numStates,
    firstDisplayedState,
    states,
  };
}

function readExtendedFeatures(data: Uint8Array): {
  offset: number;
  sequencedTimers: boolean;
  extendedTimers: boolean;
  extendedWallDecorations: boolean;
  bigActuators: boolean;
  indirectText: boolean;
  /** `EXTENDEDFEATURESBLOCK.version` (offset 36). `'B'` and up store new-style scrolls. */
  version: number;
  /** `EXTENDEDFEATURESBLOCK.cellFlagArraySize` (offset 48). */
  cellFlagArraySize: number;
  /**
   * The object indirect index, present whenever the block is (`dataMapLength` is 0 in
   * a file written before the feature existed, and then there is nothing to resolve).
   */
  objectIndex?: CsbwinObjectIndex;
  spellFilterLocation?: number;
  dsaLevelIndex?: number[][];
  dsaIndex?: DsaIndex;
  /** The parsed 512-byte header, absent when the file carries no prefix. */
  header?: ExtendedFeaturesBlock;
  /** The game-information bytes, as written. */
  gameInfo?: Uint8Array;
  /** The DSA section verbatim, when there is one. */
  dsaBlock?: Uint8Array;
} {
  if (data.length < EXTENDED_FEATURES_SIZE) {
    return { offset: 0, sequencedTimers: false, extendedTimers: false, extendedWallDecorations: false, bigActuators: false, indirectText: false, version: 0, cellFlagArraySize: 0 };
  }

  let block = data.subarray(0, EXTENDED_FEATURES_SIZE);
  let parsed = block;

  if (!hasExtendedSentinel(block)) {
    const decoded = rc4Simple(block, new Uint8Array([1, 0]));
    if (hasExtendedSentinel(decoded)) {
      parsed = decoded;
    } else {
      return { offset: 0, sequencedTimers: false, extendedTimers: false, extendedWallDecorations: false, bigActuators: false, indirectText: false, version: 0, cellFlagArraySize: 0 };
    }
  }

  // Offsets are `EXTENDEDFEATURESBLOCK` (`doc/CSBwin-src/CSB.h:463-511`), which is a
  // plain naturally-aligned struct: sentinel[20] 0, dataMapLength 20, the three
  // checksums 24/28/32, version 36, flags 37, numDSA 38, editingOptions 40,
  // gameInfoSize 44, cellFlagArraySize 48, graphicsSignature1/2 52/56,
  // spellFilterLocation 60, extendedFlags 64, overlayOrdinal 68.
  const dataMapLength = readU32LE(parsed, 20);
  const typeMapChecksum = readU32LE(parsed, 24);
  const indexMapChecksum = readU32LE(parsed, 28);
  const version = parsed[36] ?? 0;
  const flags = parsed[37] ?? 0;
  const numDSA = readU16LE(parsed, 38);
  // `gameInfoSize` is `ui32` in the struct but the whole chain treats it as signed:
  // the global is `i32` (`doc/CSBwin-src/Data.h:118`), and the writer sets
  // `efb.gameInfoSize = gameInfoSize - 1` whenever `gameInfo != NULL`
  // (`doc/CSBwin-src/SaveGame.cpp:977-978`), so an empty-but-allocated game info
  // writes **-1**. `WriteGameInfo` then returns before writing anything for a
  // non-positive size, so -1 occupies no bytes in the file and must advance nothing.
  // A real save in `static/gamefiles/saves/` does exactly this; read unsigned, the
  // 4294967295 walked the read head off the end of the file.
  const gameInfoSizeRaw = readU32LE(parsed, 44) | 0;
  const gameInfoSize = gameInfoSizeRaw > 0 ? gameInfoSizeRaw : 0;
  const cellFlagArraySize = readU32LE(parsed, 48);
  const spellFilterLocation = readU32LE(parsed, 60);
  const extendedFlags = readU32LE(parsed, 64);

  const sequencedTimers = (extendedFlags & 0x20) !== 0;
  const extendedTimers = (extendedFlags & 0x80) !== 0;
  const extendedWallDecorations = (extendedFlags & 0x10) !== 0;
  const bigActuators = (flags & 0x80) !== 0;
  const indirectText = (flags & 0x08) !== 0;

  // `ReadExtendedFeatures` verifies the block against its own checksum before it
  // believes a single field of it (`doc/CSBwin-src/SaveGame.cpp:344-353`): the stored
  // value is lifted out, the field zeroed, and `FormChecksum` run over all 512 bytes.
  // Worth doing here for the same reason CSBWin does it — the offsets below are only
  // as trustworthy as the block they are read from.
  const checked = parsed.slice();
  const storedChecksum = readU32LE(checked, 32);
  checked[32] = checked[33] = checked[34] = checked[35] = 0;
  if (formChecksum(checked) !== (storedChecksum >>> 0)) {
    throw new Error('extended features block checksum mismatch');
  }

  // The two maps that make every object reference in the file meaningful. See
  // `CsbwinObjectIndex.ts`: an RN in a CSBWin save is a slot number in this index, not
  // the packed `[pos:2][db:4][idx:10]` of `dungeon.dat`.
  const objectIndex =
    dataMapLength > 0
      ? readObjectIndirectIndex(
          data,
          EXTENDED_FEATURES_SIZE,
          dataMapLength,
          typeMapChecksum,
          indexMapChecksum,
        )
      : undefined;

  let offset = EXTENDED_FEATURES_SIZE + dataMapLength + dataMapLength * 2;
  const dsaStart = offset;

  let dsaLevelIndex: number[][] | undefined;
  let dsaIndex: DsaIndex | undefined;
  let dsaBlock: Uint8Array | undefined;

  if (numDSA > 0) {
    const rcs = new RcsReader(data, offset);
    rcs.resetChecksum();
    dsaIndex = { entries: new Array<DsaDefinition | null>(256).fill(null) };
    for (let i = 0; i < numDSA; i++) {
      const dsaNum = rcs.readU32();
      if (dsaNum > 255) throw new Error('savegame DSA number > 255');
      if (dsaIndex.entries[dsaNum]) throw new Error('savegame duplicate DSA');
      dsaIndex.entries[dsaNum] = readDsa(rcs);
    }
    const computed = rcs.finalizeChecksum();
    const fileChecksum = readU32LE(data, rcs.getOffset());
    rcs.readBytes(4);
    if ((computed >>> 0) !== (fileChecksum >>> 0)) {
      throw new Error('savegame DSA checksum mismatch');
    }
    offset = rcs.getOffset();
    // Kept verbatim so the writer can put them back; this port re-serializes no DSA.
    dsaBlock = data.slice(dsaStart, offset);
  }

  const gameInfo = data.slice(offset, offset + gameInfoSize);
  offset += gameInfoSize;

  if ((flags & 0x01) !== 0) {
    dsaLevelIndex = Array.from({ length: 64 }, () => new Array<number>(32).fill(0xffff));
    while (offset + 3 <= data.length) {
      const level = data[offset] ?? 0;
      const selector = data[offset + 1] ?? 0;
      const index = data[offset + 2] ?? 0;
      offset += 3;
      if (level > 63) break;
      if (selector < 32) {
        dsaLevelIndex[level][selector] = index;
      }
    }
  }

  return {
    offset,
    sequencedTimers,
    extendedTimers,
    extendedWallDecorations,
    bigActuators,
    indirectText,
    version,
    cellFlagArraySize,
    objectIndex,
    spellFilterLocation,
    dsaLevelIndex,
    dsaIndex,
    header: parseExtendedFeaturesBlock(parsed),
    gameInfo,
    dsaBlock,
  };
}

/**
 * Where each section of the dungeon image sits, relative to `startOffset`.
 *
 * The image is blocks 7-14 of the save (`doc/CSBWIN_SAVEGAME_REFERENCE.md`), written
 * plain by `WriteAndChecksum` and read back plain by `ReadDatabases` — a save is
 * loaded with `d.gameState == GAMESTATE_ResumeSavedGame`, which skips that function's
 * compression preamble (`doc/CSBwin-src/SaveGame.cpp:2345-2374`).
 *
 * Two record sizes are not the `dungeon.dat` ones, which is what made this arithmetic
 * fail for years' worth of guesses:
 *
 * - **ACTUATOR is 2 bytes larger** unless the file predates big actuators.
 *   `ReadDatabases` spells it as a subtraction from the *big* size —
 *   `if ((D6W==dbACTUATOR) & !bigActuators) D4W -= 2;`
 *   (`doc/CSBwin-src/SaveGame.cpp:2571-2575`) — so `dbEntrySizes[dbACTUATOR]` is the
 *   big one and the small one is the special case.
 * - **SCROLL is 2 bytes larger** from extended-features version `'B'` on.
 *   `readScrollDatabase` branches to `readNewScrollDatabase` at `>= 'B'`, and its own
 *   comment says why: "The old version had a 10-bit index into the text database. The
 *   new version has an RN reference to the text."
 *   (`doc/CSBwin-src/SaveGame.cpp:2189-2200`).
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

function computeDungeonImageLayout(
  data: Uint8Array,
  startOffset: number,
  options: { indirectText: boolean; bigActuators: boolean; newScrolls: boolean },
): DungeonImageLayout | null {
  const HEADER_SIZE = 44;
  const MAP_DESCRIPTOR_SIZE = 16;

  if (startOffset + HEADER_SIZE > data.length) return null;

  const numMaps = data[startOffset + 4] ?? 0;
  if (numMaps < 1 || numMaps > 32) return null;
  const textDataSize = readU16BE(data, startOffset + 6);
  const objectListSize = readU16BE(data, startOffset + 10);

  const objectCounts: number[] = [];
  for (let i = 0; i < 16; i++) objectCounts.push(readU16BE(data, startOffset + 12 + i * 2));

  const recordSizes = [4, 6, 4, 8, 16, 4, 4, 4, 4, 8, 4, EXPOOL_RECORD_SIZE, 0, 0, 8, 4];
  if (options.bigActuators) recordSizes[DBType.ACTUATOR] += 2;
  if (options.newScrolls) recordSizes[DBType.SCROLL] += 2;

  let totalColumns = 0;
  for (let i = 0; i < numMaps; i++) {
    const offset = startOffset + HEADER_SIZE + i * MAP_DESCRIPTOR_SIZE;
    if (offset + MAP_DESCRIPTOR_SIZE > data.length) return null;
    totalColumns += ((readU16BE(data, offset + 8) >> 6) & 0x1f) + 1;
  }

  const columnIndex = startOffset + HEADER_SIZE + numMaps * MAP_DESCRIPTOR_SIZE;
  const objectList = columnIndex + totalColumns * 2;
  const text = objectList + objectListSize * 2;

  let databaseStart: number;
  if (options.indirectText) {
    // `NumWordsInTextArray` is repurposed by `ConvertToIndirectText`, which assigns it
    // the index length (`doc/CSBwin-src/SaveGame.cpp:2272`), so in a save it counts
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
    cursor += objectCounts[db] * (recordSizes[db] ?? 0);
  }
  if (cursor > data.length) return null;

  return {
    numMaps, totalColumns, objectListSize, objectCounts, recordSizes,
    columnIndex, objectList, text, databases, cellFlags: cursor,
  };
}

/** Translate one stored RN, or leave it alone when the file carries no indirect index. */
function resolveRN(objectIndex: CsbwinObjectIndex | undefined, raw: number): ObjectID {
  return objectIndex ? objectIndex.resolve(raw) : raw as ObjectID;
}

function parseSpecialLocationsFromSaveData(
  data: Uint8Array,
  layout: DungeonImageLayout,
): Record<number, number> | null {
  const expoolCount = layout.objectCounts[11] ?? 0;
  if (expoolCount <= 0) return null;
  const expoolStart = layout.databases[11];
  if (expoolStart + expoolCount * EXPOOL_RECORD_SIZE > data.length) return null;

  const expool = new Uint32Array(expoolCount * EXPOOL_WORDS_PER_BLOCK);
  for (let i = 0; i < expool.length; i++) expool[i] = readU32BE(data, expoolStart + i * 4);

  const locations: Record<number, number> = {};
  for (let esl = 0; esl <= ESL_SPECIAL_LOCATION_MAX; esl++) {
    const key = ((EDT_SPECIAL_LOCATIONS << 24) | esl) >>> 0;
    const record = locateExpoolRecord(expool, key);
    if (record !== null) locations[key] = record;
  }
  return Object.keys(locations).length === 0 ? null : locations;
}

function parseMissileRecordsFromSaveData(
  data: Uint8Array,
  layout: DungeonImageLayout,
  objectIndex?: CsbwinObjectIndex,
): MissileRecord[] | null {
  const missileCount = layout.objectCounts[DBType.MISSILE] ?? 0;
  if (missileCount <= 0) return null;
  const start = layout.databases[DBType.MISSILE];
  const size = layout.recordSizes[DBType.MISSILE];
  if (start + missileCount * size > data.length) return null;

  const records: MissileRecord[] = [];
  for (let i = 0; i < missileCount; i++) {
    const base = start + i * size;
    // Both are RNs, so both are indirect-index slot numbers in a save; a missile's
    // flying object may also be a spell literal, which `resolve` passes through.
    // A free record — link `RNnul` — keeps a stale flying object whose slot may have
    // been freed since, so it is dropped rather than resolved, exactly as in
    // `DungeonLoader.readRNOfRecord`. `csbgame3.dat` has one.
    const nextObject = resolveRN(objectIndex, readU16BE(data, base));
    records.push({
      nextObject,
      projectileObject:
        nextObject === OBJECT_ID_NULL
          ? OBJECT_ID_NULL
          : resolveRN(objectIndex, readU16BE(data, base + 2)),
      rangeRemaining: data[base + 4] ?? 0,
      damageRemaining: data[base + 5] ?? 0,
      timerIndex: readU16BE(data, base + 6),
    });
  }
  return records;
}

function locateExpoolRecord(expool: Uint32Array, key: number): number | null {
  const hash = Math.imul(key, 0xbb40e62d) >>> 0;
  let hashi = 32 + (hash >>> 27);
  if ((expool[hashi] & 0x80000000) !== 0) {
    hashi = ((expool[hashi] & 0x7fffffff) + ((hash >>> 21) & 0x3f)) >>> 0;
  }

  let guard = 0;
  while (expool[hashi] !== 0) {
    if (guard++ > expool.length) break;
    const p = expool[hashi] >>> 0;
    if (p + 1 >= expool.length) return null;
    if ((expool[p + 1] >>> 0) === (key >>> 0)) {
      const blockStart = p & 0xffffffc0;
      if (blockStart >= expool.length) return null;
      const size = expool[blockStart] & 0xffff;
      if (size < 3) return null;
      if (p + 2 >= expool.length) return null;
      return expool[p + 2] >>> 0;
    }
    hashi = expool[hashi] >>> 0;
    if (hashi >= expool.length) return null;
  }

  return null;
}
function unscramble(buf: Uint8Array, initialHash: number, numWords: number): number {
  let d7 = initialHash & 0xffff;
  let d6 = numWords & 0xffff;
  let d5 = initialHash & 0xffff;
  let off = 0;
  while (d6 !== 0) {
    const word = readU16BE(buf, off);
    d5 = (d5 + word) & 0xffff;
    const xored = word ^ d7;
    buf[off] = (xored >> 8) & 0xff;
    buf[off + 1] = xored & 0xff;
    d5 = (d5 + xored) & 0xffff;
    off += 2;
    d7 = (d7 + d6) & 0xffff;
    d6 = (d6 - 1) & 0xffff;
  }
  return d5 & 0xffff;
}

function readUnscrambleBlock(data: Uint8Array, offset: number): { buf: Uint8Array; next: number } {
  const end = offset + BLOCK1_SIZE;
  if (end > data.length) throw new Error('savegame block1 truncated');
  const buf = data.slice(offset, end);

  let d6 = 0;
  let pos = 0;
  for (let i = 0; i < 32; i++) {
    d6 = (d6 + readU16BE(buf, pos)) & 0xffff;
    pos += 2;
    d6 ^= readU16BE(buf, pos);
    pos += 2;
    d6 = (d6 - readU16BE(buf, pos)) & 0xffff;
    pos += 2;
    d6 ^= readU16BE(buf, pos);
    pos += 2;
  }

  const hash = readU16BE(buf, 58);
  unscramble(buf.subarray(256), hash, 128);

  let d5 = 0;
  pos = 256;
  for (let i = 0; i < 128; i++) {
    d5 = (d5 + readU16BE(buf, pos)) & 0xffff;
    pos += 2;
  }

  if ((d6 & 0xffff) !== (d5 & 0xffff)) {
    throw new Error('savegame block1 checksum mismatch');
  }

  return { buf, next: end };
}

function unscrambleStream(
  data: Uint8Array,
  offset: number,
  size: number,
  initialHash: number,
  checksum: number
): { buf: Uint8Array; next: number } {
  const end = offset + size;
  if (end > data.length) throw new Error('savegame stream truncated');
  const buf = data.slice(offset, end);
  const computed = unscramble(buf, initialHash, size / 2);
  if (computed !== (checksum & 0xffff)) {
    throw new Error('savegame stream checksum mismatch');
  }
  return { buf, next: end };
}

function parseBlock1(buf: Uint8Array): Block1 {
  return {
    block2Hash: readU16BE(buf, 312),
    item16Hash: readU16BE(buf, 314),
    characterHash: readU16BE(buf, 316),
    timersHash: readU16BE(buf, 318),
    timerQueueHash: readU16BE(buf, 320),
    block2Checksum: readU16BE(buf, 344),
    item16Checksum: readU16BE(buf, 346),
    characterChecksum: readU16BE(buf, 348),
    timersChecksum: readU16BE(buf, 350),
    timerQueueChecksum: readU16BE(buf, 352),
  };
}

/**
 * `GAMEBLOCK2`, read as `LoadGame` reads it (`doc/CSBwin-src/SaveGame.cpp:1617-1650`).
 *
 * `handChar` and `MagicCaster` are stored as `i16` and CSBWin assigns them straight to
 * `d.HandChar` / `d.MagicCaster`, where -1 means "nobody" — so they are sign-extended
 * here rather than read as unsigned.
 */
function parseBlock2(buf: Uint8Array): Block2 {
  return {
    time: readU32BE(buf, 0),
    ranseed: readU32BE(buf, 4),
    objectInHand: readU16BE(buf, 8),
    numCharacter: readI16BE(buf, 10),
    partyX: readI16BE(buf, 12),
    partyY: readI16BE(buf, 14),
    partyFacing: readI16BE(buf, 16),
    partyLevel: readI16BE(buf, 18),
    handChar: readI16BE(buf, 20),
    magicCaster: readI16BE(buf, 22),
    numTimer: readI16BE(buf, 24),
    firstAvailTimer: readI16BE(buf, 26),
    maxTimers: readU16BE(buf, 28),
    item16QueLen: readI16BE(buf, 30),
    lastMonsterAttackTime: readU32BE(buf, 32),
    lastPartyMoveTime: readU32BE(buf, 36),
    partyMoveDisableTimer: readI16BE(buf, 40),
    word11712: readI16BE(buf, 42),
    word11714: readI16BE(buf, 44),
    maxItem16: readU16BE(buf, 46),
    timerSequence: readU16BE(buf, 48),
  };
}

/**
 * Read the `ITEM16[]` block (CSBWin `CSB.h:2190`).
 *
 * `word0` is the one swapped field: CSBWin byte-swaps it on load with
 * `d.Item16[i].word0 = LE16(d.Item16[i].word0)` (doc/CSBwin-src/SaveGame.cpp:486),
 * so it is little-endian in the file while the rest of the record is plain bytes.
 */
function parseItem16(buf: Uint8Array, maxItem16: number): Item16Record[] {
  const out: Item16Record[] = [];
  for (let i = 0; i < maxItem16; i++) {
    const base = i * 16;
    out.push({
      word0: (readU16BE(buf, base + 0) << 16) >> 16,
      facings: buf[base + 2] ?? 0,
      positions: buf[base + 3] ?? 0,
      uByte4: buf[base + 4] ?? 0,
      uByte5: buf[base + 5] ?? 0,
      uByte6: buf[base + 6] ?? 0,
      uByte7: buf[base + 7] ?? 0,
      ubPrevX: buf[base + 8] ?? 0,
      ubPrevY: buf[base + 9] ?? 0,
      uByte10: buf[base + 10] ?? 0,
      uByte11: buf[base + 11] ?? 0,
      singleMonsterStatus: [
        buf[base + 12] ?? 0,
        buf[base + 13] ?? 0,
        buf[base + 14] ?? 0,
        buf[base + 15] ?? 0,
      ],
    });
  }
  return out;
}

/**
 * The timer table, in the 16-byte form, whatever form the file is in.
 *
 * `LoadGame` reads `MaxTimer * timerSize` bytes and then upgrades them in place —
 * `ConvertToSequencedTimers` if the file predates sequenced timers,
 * `ConvertToExtendedTimers` if it predates extended ones
 * (`doc/CSBwin-src/SaveGame.cpp:1687-1723`). Both conversions run over the *unswapped*
 * big-endian bytes and say so in their own comments
 * (`doc/CSBwin-src/Timer.cpp:2878-2919`), which is why `ConvertToExtendedTimers` can
 * pull the level out with `time & 0xff`: on a little-endian host that byte is the
 * big-endian word's *top* byte. Read straight from the file, as here, the same split is
 * `level = value >>> 24`, `time = value & 0xffffff`.
 *
 * Every multi-byte field is big-endian. `swapTimers` switches on the function code to
 * decide whether bytes 6-7 and 8-9 are an RN or a word, but both readings are the same
 * byte order, so both are simply taken.
 */
function parseTimers(buf: Uint8Array, maxTimers: number, timerSize: number): TimerRecord[] {
  const extended = timerSize >= 16;
  const sequenced = timerSize >= 12;
  const out: TimerRecord[] = [];
  for (let i = 0; i < maxTimers; i++) {
    const base = i * timerSize;
    const rawTime = readU32BE(buf, base) >>> 0;
    out.push({
      time: extended ? rawTime : rawTime & 0xffffff,
      level: extended ? (buf[base + 12] ?? 0) : (rawTime >>> 24) & 0xff,
      function: buf[base + 4] ?? 0,
      uByte5: buf[base + 5] ?? 0,
      uByte6: buf[base + 6] ?? 0,
      uByte7: buf[base + 7] ?? 0,
      uByte8: buf[base + 8] ?? 0,
      uByte9: buf[base + 9] ?? 0,
      sequence: sequenced ? readU16BE(buf, base + 10) : 0,
      timerWord8: readU16BE(buf, base + 8),
      timerWord6: readI16BE(buf, base + 6),
    });
  }
  return out;
}

/**
 * The timer *queue*: `MaxTimer` big-endian words, of which the first `NumTimer` are
 * live, each the index of a timer in the table above
 * (`doc/CSBwin-src/SaveGame.cpp:1694-1699`, `GameTimers::swapTimerQue`,
 * `doc/CSBwin-src/Data.h:1582`). The order is the array of CSBWin's binary heap, which
 * `LoadGame` restores verbatim (`doc/PROVEN_FACTS.md` → "CSBWin's timer queue is a
 * binary heap").
 */
function parseTimerQueue(buf: Uint8Array, maxTimers: number, numTimer: number): number[] {
  const out: number[] = [];
  const live = Math.max(0, Math.min(numTimer, maxTimers));
  for (let i = 0; i < live; i++) out.push(readU16BE(buf, i * 2));
  return out;
}

export function loadSaveGameState(saveData: Uint8Array): SaveGameState {
  const extended = readExtendedFeatures(saveData);
  let offset = extended.offset;
  const { buf: block1Buf, next: afterBlock1 } = readUnscrambleBlock(saveData, offset);
  offset = afterBlock1;

  const block1 = parseBlock1(block1Buf);

  const { buf: block2Buf, next: afterBlock2 } = unscrambleStream(
    saveData,
    offset,
    BLOCK2_SIZE,
    block1.block2Hash,
    block1.block2Checksum
  );
  offset = afterBlock2;

  const block2 = parseBlock2(block2Buf);

  let item16: Item16Record[] = [];
  if (block2.maxItem16 > 0) {
    const { buf, next } = unscrambleStream(
      saveData,
      offset,
      block2.maxItem16 * 16,
      block1.item16Hash,
      block1.item16Checksum
    );
    offset = next;
    item16 = parseItem16(buf, block2.maxItem16);
  }

  if (block2.maxItem16 === 0) {
    offset = offset;
  }

  const { buf: characterBlock, next: afterCharacters } = unscrambleStream(
    saveData,
    offset,
    CHARACTER_SIZE,
    block1.characterHash,
    block1.characterChecksum
  );
  offset = afterCharacters;

  const sequencedTimers = extended.sequencedTimers;
  const extendedTimers = extended.extendedTimers;
  const timerSize = extendedTimers ? 16 : sequencedTimers ? 12 : 10;

  const { buf: timersBuf, next: afterTimers } = unscrambleStream(
    saveData,
    offset,
    block2.maxTimers * timerSize,
    block1.timersHash,
    block1.timersChecksum
  );
  offset = afterTimers;

  const timers = parseTimers(timersBuf, block2.maxTimers, timerSize);

  const { buf: timerQueueBuf, next: afterTimerQueue } = unscrambleStream(
    saveData,
    offset,
    block2.maxTimers * 2,
    block1.timerQueueHash,
    block1.timerQueueChecksum
  );

  const timerQueue = parseTimerQueue(timerQueueBuf, block2.maxTimers, block2.numTimer);

  const layout = computeDungeonImageLayout(saveData, afterTimerQueue, {
    indirectText: extended.indirectText,
    bigActuators: extended.bigActuators ?? false,
    newScrolls: extended.version >= 0x42, // 'B'
  });
  const specialLocations = layout ? parseSpecialLocationsFromSaveData(saveData, layout) : null;
  const missiles = layout
    ? parseMissileRecordsFromSaveData(saveData, layout, extended.objectIndex)
    : null;

  return {
    item16,
    timers,
    missiles: missiles ?? undefined,
    maxItem16: block2.maxItem16,
    maxTimers: block2.maxTimers,
    sequencedTimers,
    extendedTimers,
    bigActuators: extended.bigActuators,
    indirectText: extended.indirectText,
    version: extended.version,
    dsaLevelIndex: extended.dsaLevelIndex,
    dsaIndex: extended.dsaIndex,
    extendedWallDecorations: extended.extendedWallDecorations,
    specialLocations: specialLocations ?? undefined,
    spellFilterLocation: extended.spellFilterLocation,
    handChar: block2.handChar,
    magicCaster: block2.magicCaster,
    block2,
    characterBlock,
    extendedFeatures: extended.header,
    gameInfo: extended.gameInfo,
    dsaBlock: extended.dsaBlock,
    extendedFeaturesSize: extended.offset,
    dungeonImageOffset: afterTimerQueue,
    imageLayout: layout ?? undefined,
    cellFlagArraySize: extended.cellFlagArraySize,
    objectIndex: extended.objectIndex,
    timerQueue,
    timerSequence: block2.timerSequence,
  };
}

/**
 * Restore a loaded save into the live world.
 *
 * `party` is optional only because the dungeon half of a load is useful on its own
 * (`tools/` restores worlds with no party at all). When it is given, the two
 * `GAMEBLOCK2` fields CSBWin restores at `doc/CSBwin-src/SaveGame.cpp:1636-1637` are
 * applied to it. CSBWin assigns them **straight** to `d.HandChar` and `d.MagicCaster`
 * rather than going through `SetHandOwner`/`SelectMagicCaster`, so this does too: the
 * setters validate the champion and rewrite their facing, and a load is restoring a
 * state that was already valid, not making a new choice.
 */
export function applySaveGameState(
  dungeon: DungeonData,
  save: SaveGameState,
  party?: PartyState
): void {
  dungeon.item16 = save.item16;
  if (save.timers) {
    dungeon.timerWord8Table = save.timers.map((rec) => rec.timerWord8 & 0xffff);
  }
  if (save.missiles) {
    dungeon.databases.missiles.records = save.missiles.map((rec) => ({
      nextObject: rec.nextObject,
      projectileObject: rec.projectileObject,
      rangeRemaining: rec.rangeRemaining,
      damageRemaining: rec.damageRemaining,
      timerIndex: rec.timerIndex,
    }));
    dungeon.databases.missiles.count = save.missiles.length & 0xffff;
    dungeon.header.objectCounts[DBType.MISSILE] = save.missiles.length & 0xffff;
  }
  if (save.specialLocations) {
    dungeon.specialLocations = save.specialLocations;
  }
  if (save.dsaLevelIndex) {
    dungeon.dsaLevelIndex = save.dsaLevelIndex;
  }
  if (save.dsaIndex) {
    dungeon.dsaIndex = save.dsaIndex;
  }
  if (save.extendedWallDecorations !== undefined) {
    dungeon.extendedWallDecorations = save.extendedWallDecorations;
  }
  // `MakeBigActuators` now runs at load (`src/data/CsbwinDungeonConversions.ts`), so a
  // live world is already ten-byte-shaped and this is the no-op CSBWin's own gate makes
  // it. It stays because a world loaded with `noConvert` is not.
  if (save.bigActuators && !dungeon.bigActuators) {
    MakeBigActuators(dungeon);
  }
  if (save.spellFilterLocation !== undefined) {
    dungeon.spellFilterLocation = save.spellFilterLocation;
  }
  if (party) {
    if (save.handChar !== undefined) party.cursorOwner = save.handChar;
    if (save.magicCaster !== undefined) party.magicCasterIndex = save.magicCaster;
  }
}

/**
 * `GAMEBLOCK2`, packed — the exact inverse of `parseBlock2`.
 *
 * Every offset is `GAMEBLOCK2`'s own (`doc/CSBwin-src/SaveGame.cpp:107-133`) and every
 * field is big-endian, because `SaveGame` runs `swapBlock2` over the struct immediately
 * before it checksums and writes it (`:1102-1104`, `:1117`).
 *
 * Bytes 50-127 are `FILL180`, which `SaveGame` clears before writing (`:1030`), so they
 * are left as the zeros `new Uint8Array` supplies.
 */
export function buildBlock2(b: Block2): Uint8Array {
  const buf = new Uint8Array(BLOCK2_SIZE);
  writeU32BE(buf, 0, b.time >>> 0);
  writeU32BE(buf, 4, b.ranseed >>> 0);
  writeU16BE(buf, 8, b.objectInHand & 0xffff);
  writeU16BE(buf, 10, b.numCharacter & 0xffff);
  writeU16BE(buf, 12, b.partyX & 0xffff);
  writeU16BE(buf, 14, b.partyY & 0xffff);
  writeU16BE(buf, 16, b.partyFacing & 0xffff);
  writeU16BE(buf, 18, b.partyLevel & 0xffff);
  writeU16BE(buf, 20, b.handChar & 0xffff);
  writeU16BE(buf, 22, b.magicCaster & 0xffff);
  writeU16BE(buf, 24, b.numTimer & 0xffff);
  writeU16BE(buf, 26, b.firstAvailTimer & 0xffff);
  writeU16BE(buf, 28, b.maxTimers & 0xffff);
  writeU16BE(buf, 30, b.item16QueLen & 0xffff);
  writeU32BE(buf, 32, b.lastMonsterAttackTime >>> 0);
  writeU32BE(buf, 36, b.lastPartyMoveTime >>> 0);
  writeU16BE(buf, 40, b.partyMoveDisableTimer & 0xffff);
  writeU16BE(buf, 42, b.word11712 & 0xffff);
  writeU16BE(buf, 44, b.word11714 & 0xffff);
  writeU16BE(buf, 46, b.maxItem16 & 0xffff);
  writeU16BE(buf, 48, b.timerSequence & 0xffff);
  return buf;
}

export function saveSaveGameState(save: SaveGameState): Uint8Array {
  const maxItem16 = save.maxItem16;
  const maxTimers = save.maxTimers;
  const sequencedTimers = save.sequencedTimers;
  const extendedTimers = save.extendedTimers;
  const timerSize = extendedTimers ? 16 : sequencedTimers ? 12 : 10;

  const block2 = buildBlock2({
    ...(save.block2 ?? emptyBlock2()),
    // The six the rest of `SaveGameState` carries in their own right. `SaveGame` takes
    // each of them from the live counter rather than from a stored block
    // (`doc/CSBwin-src/SaveGame.cpp:1020-1027`), so a caller that has the counters and
    // no block 2 still gets them right, and a caller that has both agrees with itself.
    numTimer: save.timerQueue?.length ?? save.block2?.numTimer ?? 0,
    maxTimers,
    maxItem16,
    handChar: save.handChar ?? save.block2?.handChar ?? -1,
    magicCaster: save.magicCaster ?? save.block2?.magicCaster ?? -1,
    timerSequence: save.timerSequence ?? save.block2?.timerSequence ?? 0,
  });

  const item16 = new Uint8Array(maxItem16 * 16);
  for (let i = 0; i < maxItem16; i++) {
    const base = i * 16;
    const rec = save.item16[i];
    if (!rec) continue;
    // Every field `parseItem16` reads. This used to write bytes 2, 3 and 12-15 only,
    // so a record's `word0` — the group's object RN — and its whole middle, the
    // per-monster state at 4-11, came back as zero. Nothing noticed because the
    // quick-save's runtime half carries `dungeon.item16` as well and is applied after
    // this one, but a save with only these blocks in it lost the monster groups.
    writeU16BE(item16, base + 0, rec.word0);
    item16[base + 2] = rec.facings & 0xff;
    item16[base + 3] = rec.positions & 0xff;
    item16[base + 4] = rec.uByte4 & 0xff;
    item16[base + 5] = rec.uByte5 & 0xff;
    item16[base + 6] = rec.uByte6 & 0xff;
    item16[base + 7] = rec.uByte7 & 0xff;
    item16[base + 8] = rec.ubPrevX & 0xff;
    item16[base + 9] = rec.ubPrevY & 0xff;
    item16[base + 10] = rec.uByte10 & 0xff;
    item16[base + 11] = rec.uByte11 & 0xff;
    item16[base + 12] = rec.singleMonsterStatus[0] ?? 0;
    item16[base + 13] = rec.singleMonsterStatus[1] ?? 0;
    item16[base + 14] = rec.singleMonsterStatus[2] ?? 0;
    item16[base + 15] = rec.singleMonsterStatus[3] ?? 0;
  }

  // Block 4, from `buildCsbwinCharacterBlock` if the caller packed one. It used to be
  // 3328 zero bytes unconditionally — no champions, no party state at all.
  const character = new Uint8Array(CHARACTER_SIZE);
  if (save.characterBlock) character.set(save.characterBlock.subarray(0, CHARACTER_SIZE));

  // The whole `TIMER`, in the form the header's flags declare. This used to write byte
  // 8-9 and nothing else, so a file this project wrote said when nothing was due.
  // `parseTimers` is the exact inverse; `tools/dump-savegame-blocks.ts` round-trips it.
  const timers = new Uint8Array(maxTimers * timerSize);
  const timerRecords = save.timers ?? [];
  // Which slots hold a live timer: `TIMER_SEARCH::FindNextTimer` walks the queue, so a
  // slot is live exactly when the queue names it. Only used for `unused13` below.
  const liveSlots = new Set(save.timerQueue ?? []);
  for (let i = 0; i < maxTimers; i++) {
    const base = i * timerSize;
    const rec = timerRecords[i];
    if (!rec) continue;
    // In the 16-byte form the time is the whole longword and the level has its own
    // byte; in the shorter forms the level rides in the top byte of the time
    // (`doc/CSBwin-src/CSB.h:1818-1821`).
    const time = extendedTimers
      ? rec.time >>> 0
      : (((rec.level & 0xff) << 24) | (rec.time & 0xffffff)) >>> 0;
    writeU32BE(timers, base, time);
    timers[base + 4] = rec.function & 0xff;
    timers[base + 5] = rec.uByte5 & 0xff;
    timers[base + 6] = rec.uByte6 & 0xff;
    timers[base + 7] = rec.uByte7 & 0xff;
    timers[base + 8] = rec.uByte8 & 0xff;
    timers[base + 9] = rec.uByte9 & 0xff;
    if (timerSize >= 12) writeU16BE(timers, base + 10, rec.sequence & 0xffff);
    if (extendedTimers) {
      timers[base + 12] = rec.level & 0xff;
      // `unused13[3]`, the three padding bytes that round `TIMER` up to 16
      // (`doc/CSBwin-src/CSB.h:2011`). They are not zero in a real file: `GameTimers::
      // Allocate` memsets a new slot to 0 (`doc/CSBwin-src/Timer.cpp:678-683`), but
      // `SetTimer` then fills the slot with `memcpy(A0, A1, sizeof(TIMER))` from a
      // stack `TIMER` whose constructor sets every trailing byte to **0xcd**
      // (`doc/CSBwin-src/CSB.h:1805-1816`, `Timer.cpp:1132`). So a slot that has ever
      // held a timer carries 0xcd there and one that never has carries 0 — measured on
      // all twelve committed 16-byte saves, with no third value.
      //
      // This port keeps no high-water mark of slot use, so it writes 0xcd for a slot
      // that is live *now* and 0 otherwise. Nothing reads the field.
      const pad = liveSlots.has(i) ? 0xcd : 0;
      timers[base + 13] = pad;
      timers[base + 14] = pad;
      timers[base + 15] = pad;
    }
  }

  const timerQueue = new Uint8Array(maxTimers * 2);
  const queueOrder = save.timerQueue ?? [];
  for (let i = 0; i < Math.min(queueOrder.length, maxTimers); i++) {
    writeU16BE(timerQueue, i * 2, queueOrder[i] & 0xffff);
  }

  const block2Hash = 0;
  const item16Hash = 0;
  const characterHash = 0;
  const timersHash = 0;
  const timerQueueHash = 0;

  const block2Checksum = genChecksum(block2, block2Hash, BLOCK2_SIZE / 2);
  const item16Checksum = genChecksum(item16, item16Hash, item16.length / 2);
  const characterChecksum = genChecksum(character, characterHash, CHARACTER_SIZE / 2);
  const timersChecksum = genChecksum(timers, timersHash, timers.length / 2);
  const timerQueueChecksum = genChecksum(timerQueue, timerQueueHash, timerQueue.length / 2);

  const block1Plain = new Uint8Array(BLOCK1_SIZE);
  const wordOffset = 256;
  writeU16BE(block1Plain, wordOffset + 56, block2Hash);
  writeU16BE(block1Plain, wordOffset + 58, item16Hash);
  writeU16BE(block1Plain, wordOffset + 60, characterHash);
  writeU16BE(block1Plain, wordOffset + 62, timersHash);
  writeU16BE(block1Plain, wordOffset + 64, timerQueueHash);
  writeU16BE(block1Plain, wordOffset + 88, block2Checksum);
  writeU16BE(block1Plain, wordOffset + 90, item16Checksum);
  writeU16BE(block1Plain, wordOffset + 92, characterChecksum);
  writeU16BE(block1Plain, wordOffset + 94, timersChecksum);
  writeU16BE(block1Plain, wordOffset + 96, timerQueueChecksum);

  let d6 = 0;
  let pos = 0;
  for (let i = 0; i < 32; i++) {
    d6 = (d6 + readU16BE(block1Plain, pos)) & 0xffff;
    pos += 2;
    d6 ^= readU16BE(block1Plain, pos);
    pos += 2;
    d6 = (d6 - readU16BE(block1Plain, pos)) & 0xffff;
    pos += 2;
    d6 ^= readU16BE(block1Plain, pos);
    pos += 2;
  }

  let sum = 0;
  for (let i = 258; i < BLOCK1_SIZE; i += 2) {
    sum = (sum + readU16BE(block1Plain, i)) & 0xffff;
  }
  writeU16BE(block1Plain, 256, (d6 - sum) & 0xffff);

  const block1Hash = readU16BE(block1Plain, 58);
  scramble(block1Plain.subarray(256), block1Hash, 128);

  scramble(block2, block2Hash, BLOCK2_SIZE / 2);
  scramble(item16, item16Hash, item16.length / 2);
  scramble(character, characterHash, CHARACTER_SIZE / 2);
  scramble(timers, timersHash, timers.length / 2);
  scramble(timerQueue, timerQueueHash, timerQueue.length / 2);

  // Block 0: the Extended Features prefix, when the caller has one. `SaveGame` writes
  // it before GAMEBLOCK1 and only for a CSB-era file — a plain Atari-era save has none,
  // and `ReadExtendedFeatures` seeks back and returns 0 for such a file
  // (`doc/CSBwin-src/SaveGame.cpp:918-998`, `:322-324`).
  const prefix = save.extendedFeatures
    ? buildExtendedFeaturesPrefix({
        header: save.extendedFeatures,
        typeMap: save.objectIndex?.typeMap ?? new Uint8Array(0),
        indexMap: save.objectIndex?.indexMap ?? new Uint16Array(0),
        dsaBlock: save.dsaBlock,
        gameInfo: save.gameInfo,
        dsaLevelIndex: save.dsaLevelIndex,
      })
    : new Uint8Array(0);

  // Blocks 7-14 and then block 15, the one word that closes the file. `WriteAndChecksum`
  // sums the bytes of every section it writes into a `ui16` from zero
  // (`doc/CSBwin-src/SaveGame.cpp:679-698`) and the total goes out big-endian (`:1222`).
  const image = save.dungeonImage ?? new Uint8Array(0);
  const checksum = image.length > 0 ? buildImageChecksum(image) : new Uint8Array(0);

  const totalSize = prefix.length + BLOCK1_SIZE + block2.length + item16.length +
    character.length + timers.length + timerQueue.length + image.length + checksum.length;
  const out = new Uint8Array(totalSize);
  let offset = 0;
  out.set(prefix, offset);
  offset += prefix.length;
  out.set(block1Plain, offset);
  offset += block1Plain.length;
  out.set(block2, offset);
  offset += block2.length;
  out.set(item16, offset);
  offset += item16.length;
  out.set(character, offset);
  offset += character.length;
  out.set(timers, offset);
  offset += timers.length;
  out.set(timerQueue, offset);
  offset += timerQueue.length;
  out.set(image, offset);
  offset += image.length;
  out.set(checksum, offset);
  return out;
}
