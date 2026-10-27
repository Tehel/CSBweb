/**
 * A CSBWin save file, read and written: its sixteen blocks as the file holds them
 * (`SaveFileBlocks`), and what each says (`SaveFile`). `readSaveFile` unscrambles and
 * checksums blocks 1 to 6, as `CsbwinSaveStream.ts` does it, and finds the dungeon image
 * behind them; `writeSaveFile` writes the blocks back, and the codecs of each block
 * (`encodeBlock2`, …) make them. Block 0, the Extended Features prefix, is
 * `CsbwinExtendedFeatures.ts`'s to read and build, and the image's records
 * `DatabaseCodecs.ts`'s.
 */

import type { Item16Record, TimerRecord } from './dungeonTypes';
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
import { EF_FLAGS, readExtendedFeatures, simpleEncipher, type ExtendedFeaturesRead } from './CsbwinExtendedFeatures';
import { buildImageChecksum } from './CsbwinDungeonImageWriter';
import {
  readI16BE,
  readI32BE,
  readU16BE,
  readU16LE,
  readU32BE,
  readU32LE,
  readU8,
  writeU16BE,
  writeU16LE,
  writeU32BE,
  writeU32LE,
} from '../core/bytes';

/**
 * A save file's blocks as the file holds them, each plain: unscrambled, deciphered, with
 * no hash, checksum or fold filled in. They are what `writeSaveFile` writes, whole, and
 * what a read gives back (`SaveFile.blocks`), so a file read and written again is the
 * file. A field is changed by encoding its block again (`encodeBlock2`, …), or by
 * writing its bytes, as `Chaos.cpp` does.
 */
export interface SaveFileBlocks {
  /**
   * Block 0, the Extended Features prefix: the 512-byte header, the object maps, the
   * DSAs, the game information and the DSA level index (`buildExtendedFeaturesPrefix`).
   * Empty for a file with none, an Atari-era save. Its `SimpleEncryption` flag
   * enciphers the whole file as it is written.
   */
  block0: Uint8Array;
  /**
   * `GAMEBLOCK1`, 512 bytes (`encodeBlock1`). The five hashes at 312 are the ones the
   * other five blocks are scrambled with; the writer fills the five checksums at 344
   * and the fold of the first half.
   */
  block1: Uint8Array;
  /** `GAMEBLOCK2`, 128 bytes (`encodeBlock2`). */
  block2: Uint8Array;
  /** `gb2.MaxITEM16` `ITEM16`s, 16 bytes each (`encodeItem16`). */
  item16: Uint8Array;
  /**
   * Block 4, 3328 bytes. It is **not** only the four champions: `CHARDESC[4]` is 3200
   * bytes and the remaining 128 are party-wide state (`Brightness`, `SeeThruWalls`, the
   * shield timers, `PartyFootprints[24]`, `Invisible`, …), bracketed in
   * `doc/CSBwin-src/Data.h:780-798`. `src/data/CsbwinCharacters.ts` unpacks it and packs
   * it.
   */
  characters: Uint8Array;
  /** `gb2.MaxTimers` `TIMER`s, in the form block 0's flags declare (`encodeTimers`). */
  timers: Uint8Array;
  /** `gb2.MaxTimers` words, the first `gb2.NumTimer` of them live (`encodeTimerQueue`). */
  timerQueue: Uint8Array;
  /**
   * Blocks 7-14, the dungeon image, as `buildDungeonImage`
   * (`src/data/CsbwinDungeonImageWriter.ts`) builds it; the writer closes the file with
   * its sum, block 15. Empty, the file is the blocks 0-6 prefix.
   *
   * Every RN in it is a slot of the object indirect index whose maps block 0 carries,
   * so the two are one numbering.
   */
  image: Uint8Array;
}

/**
 * A save file read (`readSaveFile`): its blocks, and what each says.
 *
 * Every field is the file's: none is a default, and none says what another already
 * does. Every RN in the file — the object list, every record's link, a chest's
 * contents, a monster's possessions, a champion's thirty slots, `ObjectInHand` — is a
 * slot number of the object indirect index (`extended.objectIndex`) rather than a packed
 * RN, so nothing that reads an object out of the file is meaningful without it. The
 * world keeps it as its `RnMaps` (`src/data/CsbwinObjectIndex.ts`).
 */
export interface SaveFile {
  blocks: SaveFileBlocks;
  /**
   * Block 0 read, `readExtendedFeatures`' result: its header (`header`, absent for a file
   * with none), the flags that shape the other blocks, the object index, the DSAs, the
   * game information, `offset`, which is `ExtendedFeaturesSize`
   * (`doc/CSBwin-src/SaveGame.cpp:1722`), and `data`, the file as `READ` gives it:
   * deciphered when `simpleEncipher`, else the file as given. The other blocks are read
   * from `data`, so a file is deciphered once.
   */
  extended: ExtendedFeaturesRead;
  block1: Block1;
  block2: Block2;
  item16: Item16Record[];
  /** The timer table, in the 16-byte form whatever form the file is in (`parseTimers`). */
  timers: TimerRecord[];
  /**
   * The live timer queue: `gb2.NumTimer` indices into `timers`, in the order of CSBWin's
   * heap (`GameTimers::TimerQueue`), not their firing order.
   */
  timerQueue: number[];
  /**
   * Where in `extended.data` the plain dungeon image begins — immediately after the
   * timer queue. `LoadGame` calls `ReadDatabases()` there
   * (`doc/CSBwin-src/SaveGame.cpp:1909`), and because a save is loaded with
   * `d.gameState == GAMESTATE_ResumeSavedGame` that function skips its own
   * extended-features/compression preamble and reads straight on from the current
   * file position (`doc/CSBwin-src/SaveGame.cpp:2557-2558`).
   */
  imageOffset: number;
  /** Where every section of the dungeon image sits; `null` if its header does not read. */
  imageLayout: DungeonImageLayout | null;
  /**
   * `ReadDatabases`' `cellflagArraySize` — the last section's length: the Extended
   * Features block's, or, when that is 0, the image header's word 2.
   */
  cellFlagArraySize: number;
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
    byte22598: readU8(buf, 300),
    byte22596: readU8(buf, 301),
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
 * `word0` is the one word: CSBWin reads it on load as
 * `d.Item16[i].word0 = LE16(d.Item16[i].word0)` (doc/CSBwin-src/SaveGame.cpp:494), and
 * `LE16` is a byte swap on the little-endian build (`doc/CSBwin-src/CSBTypes.h:151`),
 * so it is big-endian in the file, like every word of a save's blocks; the rest of the
 * record is plain bytes.
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

/** A timer's size in the file, by block 0's flags: `TIMER`'s three forms. */
function timerSizeOf(extended: ExtendedFeaturesRead): number {
  return extended.extendedTimers ? 16 : extended.sequencedTimers ? 12 : 10;
}

/**
 * A save file read, as `LoadGame` reads blocks 0 to 6
 * (`doc/CSBwin-src/SaveGame.cpp:1722-1825`), and where the dungeon image behind them
 * sits. Throws when a block does not unscramble or fails its checksum; an image that
 * does not read is the caller's to refuse (`imageLayout`).
 */
export function readSaveFile(file: Uint8Array): SaveFile {
  const extended = readExtendedFeatures(file);
  const saveData = extended.data;
  let offset = extended.offset;
  const { buf: block1Buf, next: afterBlock1 } = readUnscrambleBlock(saveData, offset);
  offset = afterBlock1;

  const hashes = parseBlock1Hashes(block1Buf);

  const { buf: block2Buf, next: afterBlock2 } = unscrambleStream(
    saveData,
    offset,
    BLOCK2_SIZE,
    hashes.block2Hash,
    hashes.block2Checksum
  );
  offset = afterBlock2;

  const block2 = parseBlock2(block2Buf);

  let item16Buf: Uint8Array = new Uint8Array(0);
  if (block2.maxItem16 > 0) {
    const { buf, next } = unscrambleStream(
      saveData,
      offset,
      block2.maxItem16 * 16,
      hashes.item16Hash,
      hashes.item16Checksum
    );
    offset = next;
    item16Buf = buf;
  }

  const { buf: characterBlock, next: afterCharacters } = unscrambleStream(
    saveData,
    offset,
    CHARACTER_SIZE,
    hashes.characterHash,
    hashes.characterChecksum
  );
  offset = afterCharacters;

  const timerSize = timerSizeOf(extended);

  const { buf: timersBuf, next: afterTimers } = unscrambleStream(
    saveData,
    offset,
    block2.maxTimers * timerSize,
    hashes.timersHash,
    hashes.timersChecksum
  );
  offset = afterTimers;

  const { buf: timerQueueBuf, next: afterTimerQueue } = unscrambleStream(
    saveData,
    offset,
    block2.maxTimers * 2,
    hashes.timerQueueHash,
    hashes.timerQueueChecksum
  );

  // A save's image has a level: one that reads as none is not an image.
  const read = computeDungeonImageLayout(saveData, afterTimerQueue, {
    indirectText: extended.indirectText,
    bigActuators: extended.bigActuators,
    newScrolls: extended.version >= 0x42, // 'B'
  });
  const layout = read && read.numMaps >= 1 ? read : null;
  // A file with no Extended Features block declares no size, and `ReadDatabases` then
  // takes the image header's `LegacyCellFlagArraySize`, its word 2
  // (`doc/CSBwin-src/SaveGame.cpp:2624-2627`, `CSB.h:2135`): the Atari-era saves.
  const cellFlagArraySize = extended.cellFlagArraySize || readU16BE(saveData, afterTimerQueue + 2);
  // The image runs to the end of its cell flags, and the word after it closes the file;
  // without a layout, to the end of the file.
  const imageEnd = layout ? Math.min(layout.cellFlags + cellFlagArraySize, saveData.length) : saveData.length;

  return {
    blocks: {
      block0: saveData.slice(0, extended.offset),
      block1: block1Buf,
      block2: block2Buf,
      item16: item16Buf,
      characters: characterBlock,
      timers: timersBuf,
      timerQueue: timerQueueBuf,
      image: saveData.slice(afterTimerQueue, Math.max(afterTimerQueue, imageEnd)),
    },
    extended,
    block1: parseBlock1(block1Buf),
    block2,
    item16: parseItem16(item16Buf, block2.maxItem16),
    timers: parseTimers(timersBuf, block2.maxTimers, timerSize),
    timerQueue: parseTimerQueue(timerQueueBuf, block2.maxTimers, block2.numTimer),
    imageOffset: afterTimerQueue,
    imageLayout: layout,
    cellFlagArraySize,
  };
}

/**
 * `GAMEBLOCK1`, packed — the inverse of `parseBlock1`. `SaveGame` memsets the block
 * (`doc/CSBwin-src/SaveGame.cpp:881-882`) and fills it from `d.` (`:1083-1097`), the five
 * hashes 0; `swapBlock1` then turns the fields it lists big-endian and leaves
 * `SaveOption` and `totalMoveCount` native (see `Block1`).
 */
export function encodeBlock1(b1: Block1): Uint8Array {
  const block1Plain = new Uint8Array(BLOCK1_SIZE);
  block1Plain[300] = b1.byte22598 & 0xff;
  block1Plain[301] = b1.byte22596 & 0xff;
  writeU16LE(block1Plain, 306, b1.saveOption);
  writeU32BE(block1Plain, 308, b1.randomGameID);
  writeU32LE(block1Plain, 322, b1.totalMoveCount);
  writeU16BE(block1Plain, 376, b1.word22594);
  writeU16BE(block1Plain, 378, b1.word22592);
  block1Plain.set(b1.byte22808.subarray(0, 132), 380);
  return block1Plain;
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
export function encodeBlock2(b: Block2): Uint8Array {
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

/** The `ITEM16`s, packed — the exact inverse of `parseItem16`. */
export function encodeItem16(records: readonly Item16Record[]): Uint8Array {
  const item16 = new Uint8Array(records.length * 16);
  records.forEach((rec, i) => {
    const base = i * 16;
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
  });
  return item16;
}

/**
 * The whole `TIMER` table, in the form `timerSize` names: 16 bytes when block 0
 * declares `ExtendedTimers`, 12 for `SequencedTimers` alone, 10 for neither.
 * `parseTimers` is the exact inverse; `tools/checks/savegame-blocks.ts` round-trips it.
 * `timerQueue` says which slots are live, for `unused13` alone.
 */
export function encodeTimers(records: readonly TimerRecord[], timerSize: 10 | 12 | 16, timerQueue: readonly number[]): Uint8Array {
  const extendedTimers = timerSize === 16;
  const timers = new Uint8Array(records.length * timerSize);
  // Which slots hold a live timer: `TIMER_SEARCH::FindNextTimer` walks the queue, so a
  // slot is live exactly when the queue names it.
  const liveSlots = new Set(timerQueue);
  records.forEach((rec, i) => {
    const base = i * timerSize;
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
      // (`doc/CSBwin-src/CSB.h:1868-1879`, `Timer.cpp:1133`). So a slot that has ever
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
  });
  return timers;
}

/** The timer queue, `maxTimers` words of which the queue fills the first — the inverse of `parseTimerQueue`. */
export function encodeTimerQueue(timerQueue: readonly number[], maxTimers: number): Uint8Array {
  const out = new Uint8Array(maxTimers * 2);
  for (let i = 0; i < Math.min(timerQueue.length, maxTimers); i++) {
    writeU16BE(out, i * 2, timerQueue[i]! & 0xffff);
  }
  return out;
}

/**
 * The file of `blocks`, as `SaveGame` writes it (`doc/CSBwin-src/SaveGame.cpp:1083-1320`).
 *
 * Each of blocks 2 to 6 is checksummed with the hash `GAMEBLOCK1` holds for it
 * (`GenChecksum`), the checksum written into `GAMEBLOCK1`, which is folded and scrambled
 * (`ScrambleAndWrite`), and each block scrambled with its hash (`WriteScrambled`). Block 0
 * goes before them, the image after, and the word that closes the file after that.
 */
export function writeSaveFile(blocks: SaveFileBlocks): Uint8Array {
  const block1 = blocks.block1.slice();
  const streams = [blocks.block2, blocks.item16, blocks.characters, blocks.timers, blocks.timerQueue]
    .map((block) => block.slice());
  // The five hashes at 312 and the five checksums at 344, block by block.
  const hashes = streams.map((_, i) => readU16BE(block1, 312 + 2 * i));
  streams.forEach((block, i) => {
    writeU16BE(block1, 344 + 2 * i, genChecksum(block, hashes[i]!, block.length / 2));
  });

  scrambleAndWrite(block1);
  streams.forEach((block, i) => scramble(block, hashes[i]!, block.length / 2));

  // Blocks 7-14 and then block 15, the one word that closes the file. `WriteAndChecksum`
  // sums the bytes of every section it writes into a `ui16` from zero
  // (`doc/CSBwin-src/SaveGame.cpp:687-706`) and the total goes out big-endian (`:1320`).
  const image = blocks.image;
  const checksum = image.length > 0 ? buildImageChecksum(image) : new Uint8Array(0);

  // Block 0 is written before GAMEBLOCK1, and only for a CSB-era file — a plain
  // Atari-era save has none, and `ReadExtendedFeatures` seeks back and returns 0 for
  // such a file (`doc/CSBwin-src/SaveGame.cpp:944-1023`, `:324-326`).
  const parts = [blocks.block0, block1, ...streams, image, checksum];
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  // `SaveGame` sets `SimpleEncryption` when it has marked the file enciphered, and every
  // `WRITE` then enciphers by the position in the file, the block included
  // (`doc/CSBwin-src/SaveGame.cpp:939-946`, `:968-971`, `system.cpp:315-329`).
  if (blocks.block0.length > 37 && ((blocks.block0[37] ?? 0) & EF_FLAGS.SimpleEncryption) !== 0) {
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
