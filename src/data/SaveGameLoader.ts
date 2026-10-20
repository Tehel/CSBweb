/**
 * The block codecs of a CSBWin save, reader and writer: GAMEBLOCK1 and GAMEBLOCK2,
 * `ITEM16`, the characters, the timers and the timer queue, scrambled as
 * `CsbwinSaveStream.ts` does it, and where the dungeon image behind them sits
 * (`loadSaveGameState`, `saveSaveGameState`). Block 0, the Extended Features prefix, is
 * `CsbwinExtendedFeatures.ts`'s.
 */

import type { Item16Record, TimerRecord, DsaIndex } from './dungeonTypes';
import { computeDungeonImageLayout, type DungeonImageLayout } from './DungeonImageLayout';
import {
  BLOCK1_SIZE,
  genChecksum,
  readUnscrambleBlock,
  rescrambleBlock1,
  scramble,
  scrambleAndWrite,
  unscrambleStream,
} from './CsbwinSaveStream';
import type { CsbwinObjectIndex } from './CsbwinObjectIndex';
import { buildExtendedFeaturesPrefix, EF_FLAGS, readExtendedFeatures, simpleEncipher } from './CsbwinExtendedFeatures';
import { buildImageChecksum } from './CsbwinDungeonImageWriter';
import type { ExtendedFeaturesBlock } from './CsbwinExtendedFeatures';
import {
  readI16BE,
  readI32BE,
  readU16BE,
  readU16LE,
  readU32BE,
  readU32LE,
  writeU16BE,
  writeU16LE,
  writeU32BE,
  writeU32LE,
} from '../core/bytes';

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
  maxItem16: number;
  maxTimers: number;
  sequencedTimers: boolean;
  extendedTimers: boolean;
  bigActuators?: boolean;
  /**
   * `EXTENDEDFEATURESBLOCK.flags & ExpandedPortraits`. False for a file with no block,
   * whose mirrors `ExtendPortraits` then cleans (`src/data/CsbwinDungeonConversions.ts`).
   */
  expandedPortraits?: boolean;
  /** `EXTENDEDFEATURESBLOCK.flags & IndirectText` — the text section's shape. */
  indirectText?: boolean;
  /** `EXTENDEDFEATURESBLOCK.version` (offset 36); `'B'` (0x42) and up use new scrolls. */
  version?: number;
  dsaLevelIndex?: number[][];
  dsaIndex?: DsaIndex;
  extendedWallDecorations?: boolean;
  spellFilterLocation?: number;
  /** `EXTENDEDFEATURESBLOCK.hintKey`, absent for a file without a block. */
  hintKey?: Uint8Array;
  /**
   * `gb2.handChar` — the champion index holding the cursor, -1 for nobody.
   * `LoadGame` restores `d.HandChar` from it (`doc/CSBwin-src/SaveGame.cpp:1760`).
   */
  handChar?: number;
  /** `gb2.MagicCaster`, restored on the next line of the same function (`:1761`). */
  magicCaster?: number;
  /**
   * `GAMEBLOCK1` less the five blocks' hashes and checksums, which the writer computes.
   * Present when the block was parsed; `saveSaveGameState` writes `emptyBlock1()` without it.
   */
  block1?: Block1;
  /**
   * The rest of `GAMEBLOCK2`, as `LoadGame` reads it
   * (`doc/CSBwin-src/SaveGame.cpp:1741-1774`). Present when the block was parsed.
   */
  block2?: Block2;
  /**
   * The 512-byte "Extended Features" header, field for field. Present exactly when the
   * file carries a block 0; `saveSaveGameState` writes the whole prefix back when it is.
   */
  extendedFeatures?: ExtendedFeaturesBlock;
  /**
   * The file was enciphered whole (`readExtendedFeatures`' `simpleEncipher`), and read
   * deciphered. `saveSaveGameState` enciphers what it writes by the header's
   * `SimpleEncryption` instead, which CSBWin sets exactly when it enciphers.
   */
  simpleEncipher?: boolean;
  /**
   * The file as `READ` gives it (`readExtendedFeatures`' `data`): deciphered when
   * `simpleEncipher`, else the file as given. The dungeon image is read from it
   * (`loadCsbwinWorld`), so a file is deciphered once. Only a read sets it.
   */
  data?: Uint8Array;
  /**
   * `gameInfo` as the file holds it, without the terminator `ReadGameInfo` appends.
   * Carried verbatim: it is a free-text blob the game only ever shows.
   */
  gameInfo?: Uint8Array;
  /**
   * `ExtendedFeaturesSize` (`doc/CSBwin-src/SaveGame.cpp:1722`) — how many bytes of
   * block 0 precede GAMEBLOCK1, and so where block 1 starts. Zero for a file with no
   * Extended Features prefix at all.
   */
  extendedFeaturesSize?: number;
  /**
   * Byte offset at which the plain, unscrambled dungeon image begins — immediately
   * after the timer queue. `LoadGame` calls `ReadDatabases()` there
   * (`doc/CSBwin-src/SaveGame.cpp:1909`), and because a save is loaded with
   * `d.gameState == GAMESTATE_ResumeSavedGame` that function skips its own
   * extended-features/compression preamble and reads straight on from the current
   * file position (`doc/CSBwin-src/SaveGame.cpp:2557-2558`).
   */
  dungeonImageOffset?: number;
  /** Where every section of the dungeon image sits. Absent if the header did not parse. */
  imageLayout?: DungeonImageLayout;
  /**
   * `ReadDatabases`' `cellflagArraySize` — the last section's length: the Extended
   * Features block's, or, when that is 0, the image header's word 2.
   */
  cellFlagArraySize?: number;
  /**
   * The object indirect index. Every RN in this file — the object list, every record's
   * link, a chest's contents, a monster's possessions, a champion's thirty slots — is a
   * slot number in it rather than a packed RN, so nothing that reads an object out of
   * the file is meaningful without it. The world keeps it as its `RnMaps`
   * (`src/data/CsbwinObjectIndex.ts`).
   */
  objectIndex?: CsbwinObjectIndex;
  /**
   * The raw, unscrambled 3328-byte block 4. It is **not** only the four champions:
   * `CHARDESC[4]` is 3200 bytes and the remaining 128 are party-wide state
   * (`Brightness`, `SeeThruWalls`, the shield timers, `PartyFootprints[24]`,
   * `Invisible`, …), bracketed in `doc/CSBwin-src/Data.h:780-798`. Handed over raw
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

/**
 * `GAMEBLOCK1`'s own fields: the 512 bytes less `Byte740`, which `ScrambleAndWrite`
 * overwrites, and the ten hashes and checksums of blocks 2-6
 * (`doc/CSBwin-src/SaveGame.cpp:61-105`). `SaveGame` fills them from `d.` at
 * `:1083-1089` and `:1097`, and `LoadGame` reads them back at `:1728-1738` and
 * `:2063-2085`.
 *
 * `swapBlock1` byte-swaps `RandomGameID`, the hashes, the checksums, `Word22594` and
 * `Word22592` and nothing else (`:443-461`), so on the little-endian build CSBWin ships
 * as those are big-endian in the file and **`SaveOption` and `totalMoveCount` are
 * little-endian**: every committed save holds `SaveOption` 1 as `01 00`.
 */
export interface Block1 {
  /** `Byte22598` (offset 300): `(i8)d.Word22598`. */
  byte22598: number;
  /** `Byte22596` (301): `ub(d.Word22596)`. 1 marks an Atari DM save to `LoadGame`. */
  byte22596: number;
  /** `SaveOption` (306, little-endian): 1 for "SAVE AND PLAY", 0 for "SAVE AND QUIT" (`:917`). */
  saveOption: number;
  /** `RandomGameID` (308): `d.RandomGameID`, drawn when a new game is read (`:1638-1647`). */
  randomGameID: number;
  /** `totalMoveCount` (322, little-endian): the recorded mouse-queue entries. */
  totalMoveCount: number;
  /** `Word22594` (376). */
  word22594: number;
  /** `Word22592` (378). */
  word22592: number;
  /** `Byte22808[132]` (380), moved as a unit to and from `d.Byte22808`. */
  byte22808: Uint8Array;
}

/** Every field zero, for a caller that has none of them. */
function emptyBlock1(): Block1 {
  return {
    byte22598: 0, byte22596: 0, saveOption: 0, randomGameID: 0, totalMoveCount: 0,
    word22594: 0, word22592: 0, byte22808: new Uint8Array(132),
  };
}

/** The ten words of `GAMEBLOCK1` that open the other five scrambled blocks. */
interface Block1Hashes {
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
 * (`doc/CSBwin-src/SaveGame.cpp:108-134`); what is missing here is missing because
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
  /**
   * `gb2.LastMonsterAttackTime` (offset 32), an `i32`: -200 until a monster first
   * attacks (`doc/CSBwin-src/CSBCode.cpp:363`).
   */
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
function emptyBlock2(): Block2 {
  return {
    time: 0, ranseed: 0, objectInHand: 0, numCharacter: 0,
    partyX: 0, partyY: 0, partyFacing: 0, partyLevel: 0,
    handChar: -1, magicCaster: -1, numTimer: 0, firstAvailTimer: 0,
    maxTimers: 0, item16QueLen: 0, lastMonsterAttackTime: 0, lastPartyMoveTime: 0,
    partyMoveDisableTimer: 0, word11712: 0, word11714: 0, maxItem16: 0, timerSequence: 0,
  };
}

const BLOCK2_SIZE = 128;
const CHARACTER_SIZE = 3328;

/*
 * The save file's own byte order.
 *
 * Every word of GAMEBLOCK1, GAMEBLOCK2, `ITEM16`, the characters and the timers is
 * **big-endian**, inherited from the Atari. CSBWin never says so outright; it says it
 * by reading each word through `LE16()`, which on the little-endian build it ships
 * as is a byte swap (`doc/CSBwin-src/CSBTypes.h:151`). So `Unscramble`'s hash
 * arithmetic runs on `LE16(wordGear(A3))` (`doc/CSBwin-src/CSBCode.cpp:9162-9166`),
 * `ReadUnscrambleBlock` sums `LE16(wordGear(...))` (`:9272-9301`), and `swapBlock2`
 * `BO()`s every field afterwards (`doc/CSBwin-src/SaveGame.cpp:463-486`) — three
 * statements of the same fact.
 *
 * What is *not* big-endian is CSBWin's own additions, written in the PC's native order:
 * the "Extended Features" header (`CsbwinExtendedFeatures.ts`), GAMEBLOCK1's
 * `SaveOption` and `totalMoveCount` (`Block1`), and the indirect-text index
 * (`DungeonImageLayout`). `readU16LE`/`readU32LE` are used here for those, and nothing
 * else.
 */

function parseBlock1Hashes(buf: Uint8Array): Block1Hashes {
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

/** `GAMEBLOCK1`'s own fields, in the byte orders `swapBlock1` leaves them (see `Block1`). */
function parseBlock1(buf: Uint8Array): Block1 {
  return {
    byte22598: buf[300],
    byte22596: buf[301],
    saveOption: readU16LE(buf, 306),
    randomGameID: readU32BE(buf, 308),
    totalMoveCount: readU32LE(buf, 322),
    word22594: readU16BE(buf, 376),
    word22592: readU16BE(buf, 378),
    byte22808: buf.slice(380, 512),
  };
}

/**
 * `GAMEBLOCK2`, read as `LoadGame` reads it (`doc/CSBwin-src/SaveGame.cpp:1741-1774`).
 *
 * `handChar` and `MagicCaster` are stored as `i16` and CSBWin assigns them straight to
 * `d.HandChar` / `d.MagicCaster`, where -1 means "nobody" — so they are sign-extended
 * here rather than read as unsigned. So is `LastMonsterAttackTime`, the one `i32` of the
 * block that goes below zero.
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
    lastMonsterAttackTime: readI32BE(buf, 32),
    lastPartyMoveTime: readU32BE(buf, 36),
    partyMoveDisableTimer: readI16BE(buf, 40),
    word11712: readI16BE(buf, 42),
    word11714: readI16BE(buf, 44),
    maxItem16: readU16BE(buf, 46),
    timerSequence: readU16BE(buf, 48),
  };
}

/**
 * Read the `ITEM16[]` block (CSBWin `CSB.h:2253`).
 *
 * `word0` is the one swapped field: CSBWin byte-swaps it on load with
 * `d.Item16[i].word0 = LE16(d.Item16[i].word0)` (doc/CSBwin-src/SaveGame.cpp:494),
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
 * (`doc/CSBwin-src/SaveGame.cpp:1813-1879`). Both conversions run over the *unswapped*
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
 * (`doc/CSBwin-src/SaveGame.cpp:1820-1825`, `GameTimers::swapTimerQue`,
 * `doc/CSBwin-src/Data.h:1597`). The order is the array of CSBWin's binary heap, which
 * `LoadGame` restores verbatim (`doc/PROVEN_FACTS.md` → "CSBWin's timer queue is a
 * binary heap").
 */
function parseTimerQueue(buf: Uint8Array, maxTimers: number, numTimer: number): number[] {
  const out: number[] = [];
  const live = Math.max(0, Math.min(numTimer, maxTimers));
  for (let i = 0; i < live; i++) out.push(readU16BE(buf, i * 2));
  return out;
}

export function loadSaveGameState(file: Uint8Array): SaveGameState & { data: Uint8Array } {
  const extended = readExtendedFeatures(file);
  const saveData = extended.data;
  let offset = extended.offset;
  const { buf: block1Buf, next: afterBlock1 } = readUnscrambleBlock(saveData, offset);
  offset = afterBlock1;

  const block1 = parseBlock1Hashes(block1Buf);

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

  // A save's image has a level: one that reads as none is not an image.
  const read = computeDungeonImageLayout(saveData, afterTimerQueue, {
    indirectText: extended.indirectText,
    bigActuators: extended.bigActuators ?? false,
    newScrolls: extended.version >= 0x42, // 'B'
  });
  const layout = read && read.numMaps >= 1 ? read : null;

  return {
    item16,
    timers,
    maxItem16: block2.maxItem16,
    maxTimers: block2.maxTimers,
    sequencedTimers,
    extendedTimers,
    bigActuators: extended.bigActuators,
    expandedPortraits: extended.expandedPortraits,
    indirectText: extended.indirectText,
    version: extended.version,
    dsaLevelIndex: extended.dsaLevelIndex,
    dsaIndex: extended.dsaIndex,
    extendedWallDecorations: extended.extendedWallDecorations,
    spellFilterLocation: extended.spellFilterLocation,
    hintKey: extended.header?.hintKey,
    handChar: block2.handChar,
    magicCaster: block2.magicCaster,
    block1: parseBlock1(block1Buf),
    block2,
    characterBlock,
    extendedFeatures: extended.header,
    simpleEncipher: extended.simpleEncipher,
    data: saveData,
    gameInfo: extended.gameInfo,
    extendedFeaturesSize: extended.offset,
    dungeonImageOffset: afterTimerQueue,
    imageLayout: layout ?? undefined,
    // A file with no Extended Features block declares no size, and `ReadDatabases` then
    // takes the image header's `LegacyCellFlagArraySize`, its word 2
    // (`doc/CSBwin-src/SaveGame.cpp:2624-2627`, `CSB.h:2135`): the Atari-era saves.
    cellFlagArraySize: extended.cellFlagArraySize || readU16BE(saveData, afterTimerQueue + 2),
    objectIndex: extended.objectIndex,
    timerQueue,
    timerSequence: block2.timerSequence,
  };
}

/**
 * `GAMEBLOCK2`, packed — the exact inverse of `parseBlock2`.
 *
 * Every offset is `GAMEBLOCK2`'s own (`doc/CSBwin-src/SaveGame.cpp:108-134`) and every
 * field is big-endian, because `SaveGame` runs `swapBlock2` over the struct immediately
 * before it checksums and writes it (`:1115-1120`, `:1158-1165`).
 *
 * Bytes 50-127 are `FILL180`, which `SaveGame` clears before writing (`:1055`), so they
 * are left as the zeros `new Uint8Array` supplies.
 */
function buildBlock2(b: Block2): Uint8Array {
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
    // (`doc/CSBwin-src/SaveGame.cpp:1045-1052`), so a caller that has the counters and
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
    // Every field `parseItem16` reads, `word0` (the group's object RN) and the
    // per-monster state at 4-11 included: the runtime half of a save carries
    // `dungeon.item16` too, but a save with only these blocks must keep its groups.
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

  // Block 4, from `buildCsbwinCharacterBlock` if the caller packed one, and 3328 zero
  // bytes otherwise.
  const character = new Uint8Array(CHARACTER_SIZE);
  if (save.characterBlock) character.set(save.characterBlock.subarray(0, CHARACTER_SIZE));

  // The whole `TIMER`, in the form the header's flags declare. `parseTimers` is the exact inverse; `tools/dump-savegame-blocks.ts` round-trips it.
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
    // (`doc/CSBwin-src/CSB.h:1881-1884`).
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
      // (`doc/CSBwin-src/CSB.h:2074`). They are not zero in a real file: `GameTimers::
      // Allocate` memsets a new slot to 0 (`doc/CSBwin-src/Timer.cpp:678-683`), but
      // `SetTimer` then fills the slot with `memcpy(A0, A1, sizeof(TIMER))` from a
      // stack `TIMER` whose constructor sets every trailing byte to **0xcd**
      // (`doc/CSBwin-src/CSB.h:1868-1879`, `Timer.cpp:1132`). So a slot that has ever
      // held a timer carries 0xcd there and one that never has carries 0 — measured on
      // all eight committed saves, with no third value.
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

  // `SaveGame` memsets the block (`doc/CSBwin-src/SaveGame.cpp:881-882`) and fills it
  // from `d.` (`:1083-1097`); `swapBlock1` then turns the fields it lists big-endian
  // and leaves `SaveOption` and `totalMoveCount` native (see `Block1`).
  const b1 = save.block1 ?? emptyBlock1();
  const block1Plain = new Uint8Array(BLOCK1_SIZE);
  block1Plain[300] = b1.byte22598 & 0xff;
  block1Plain[301] = b1.byte22596 & 0xff;
  writeU16LE(block1Plain, 306, b1.saveOption);
  writeU32BE(block1Plain, 308, b1.randomGameID);
  writeU16BE(block1Plain, 312, block2Hash);
  writeU16BE(block1Plain, 314, item16Hash);
  writeU16BE(block1Plain, 316, characterHash);
  writeU16BE(block1Plain, 318, timersHash);
  writeU16BE(block1Plain, 320, timerQueueHash);
  writeU32LE(block1Plain, 322, b1.totalMoveCount);
  writeU16BE(block1Plain, 344, block2Checksum);
  writeU16BE(block1Plain, 346, item16Checksum);
  writeU16BE(block1Plain, 348, characterChecksum);
  writeU16BE(block1Plain, 350, timersChecksum);
  writeU16BE(block1Plain, 352, timerQueueChecksum);
  writeU16BE(block1Plain, 376, b1.word22594);
  writeU16BE(block1Plain, 378, b1.word22592);
  block1Plain.set(b1.byte22808.subarray(0, 132), 380);

  scrambleAndWrite(block1Plain);

  scramble(block2, block2Hash, BLOCK2_SIZE / 2);
  scramble(item16, item16Hash, item16.length / 2);
  scramble(character, characterHash, CHARACTER_SIZE / 2);
  scramble(timers, timersHash, timers.length / 2);
  scramble(timerQueue, timerQueueHash, timerQueue.length / 2);

  // Block 0: the Extended Features prefix, when the caller has one. `SaveGame` writes
  // it before GAMEBLOCK1 and only for a CSB-era file — a plain Atari-era save has none,
  // and `ReadExtendedFeatures` seeks back and returns 0 for such a file
  // (`doc/CSBwin-src/SaveGame.cpp:944-1023`, `:324-326`).
  const prefix = save.extendedFeatures
    ? buildExtendedFeaturesPrefix({
        header: save.extendedFeatures,
        typeMap: save.objectIndex?.typeMap ?? new Uint8Array(0),
        indexMap: save.objectIndex?.indexMap ?? new Uint16Array(0),
        dsaIndex: save.dsaIndex,
        gameInfo: save.gameInfo,
        dsaLevelIndex: save.dsaLevelIndex,
      })
    : new Uint8Array(0);

  // Blocks 7-14 and then block 15, the one word that closes the file. `WriteAndChecksum`
  // sums the bytes of every section it writes into a `ui16` from zero
  // (`doc/CSBwin-src/SaveGame.cpp:687-706`) and the total goes out big-endian (`:1320`).
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
  // `SaveGame` sets `SimpleEncryption` when it has marked the file enciphered, and every
  // `WRITE` then enciphers by the position in the file, the block included
  // (`doc/CSBwin-src/SaveGame.cpp:939-946`, `:968-971`, `system.cpp:315-329`).
  if (save.extendedFeatures && (save.extendedFeatures.flags & EF_FLAGS.SimpleEncryption) !== 0) {
    return simpleEncipher(out);
  }
  return out;
}

/**
 * A copy of a save file with `randomGameID` for its `d.RandomGameID`, and nothing else
 * of the game changed: `GAMEBLOCK1`'s field (`doc/CSBwin-src/SaveGame.cpp:1085`), and
 * the word of the block's first half that is its checksum (`rescrambleBlock1`). No other
 * block's hash or checksum covers the field, nor does the word that closes the file.
 *
 * Throws on a file whose `GAMEBLOCK1` does not read.
 */
export function stampRandomGameID(saveData: Uint8Array, randomGameID: number): Uint8Array<ArrayBuffer> {
  return restampBlock1(saveData, (buf) => writeU32BE(buf, 308, randomGameID >>> 0));
}

/**
 * Does the file open as a saved game: is there a `GAMEBLOCK1` where `_ReadEntireGame`
 * reads one, past the Extended Features block when the file opens with one, whose
 * second half sums to the fold of its first (`ReadUnscrambleBlock`,
 * `doc/CSBwin-src/CSBCode.cpp:9272-9300`)? It is the first thing CSBWin checks of a save
 * (`SaveGame.cpp:1724-1726`). A file that is no save, a `dungeon.dat`, a `graphics.dat`
 * or any other, passes it only by a 16-bit sum's chance.
 */
export function readsGameBlock1(file: Uint8Array): boolean {
  try {
    const { offset, data } = readExtendedFeatures(file);
    readUnscrambleBlock(data, offset);
    return true;
  } catch {
    return false;
  }
}

/**
 * Does the file hold 0 in all four of `GAMEBLOCK1`'s `Byte22598`, `Byte22596`,
 * `Word22594` and `Word22592`? CSBWin never writes that: `_ReadEntireGame` sets
 * `d.Word22596`, `Word22598`, `Word22594` and `Word22592` to 2, 1, 1 and 13 before either
 * read (`doc/CSBwin-src/SaveGame.cpp:1568-1571`), and a load replaces them only with a
 * file's own (`:2063-2064`, `:2082-2085`). An early build of the port wrote it.
 *
 * Throws on a file whose `GAMEBLOCK1` does not read.
 */
export function holdsNoBlock1Words(file: Uint8Array): boolean {
  const { offset, data } = readExtendedFeatures(file);
  const { buf } = readUnscrambleBlock(data, offset);
  return buf[300] === 0 && buf[301] === 0 && readU16BE(buf, 376) === 0 && readU16BE(buf, 378) === 0;
}

/**
 * A copy of a save file with `_ReadEntireGame`'s 1, 2, 1 and 13 for its `Byte22598`,
 * `Byte22596`, `Word22594` and `Word22592` (`doc/CSBwin-src/SaveGame.cpp:1568-1571`), the
 * four words a game read from a file that holds none would carry, and nothing else of
 * the game changed: the fields, and the word of the block's first half that is its
 * checksum (`rescrambleBlock1`), as `stampRandomGameID`. `swapBlock1` turns the two
 * words big-endian (see `Block1`).
 *
 * Throws on a file whose `GAMEBLOCK1` does not read.
 */
export function stampBlock1Words(saveData: Uint8Array): Uint8Array<ArrayBuffer> {
  return restampBlock1(saveData, (buf) => {
    buf[300] = 1;
    buf[301] = 2;
    writeU16BE(buf, 376, 1);
    writeU16BE(buf, 378, 13);
  });
}

/**
 * A copy of a save file with its `GAMEBLOCK1` unscrambled, edited, and scrambled again;
 * an enciphered file is deciphered for it and enciphered again.
 */
function restampBlock1(file: Uint8Array, edit: (buf: Uint8Array) => void): Uint8Array<ArrayBuffer> {
  const { offset, data, simpleEncipher: enciphered } = readExtendedFeatures(file);
  const { buf } = readUnscrambleBlock(data, offset);
  edit(buf);
  rescrambleBlock1(buf);
  const out = new Uint8Array(data);
  out.set(buf, offset);
  return enciphered ? simpleEncipher(out) : out;
}
