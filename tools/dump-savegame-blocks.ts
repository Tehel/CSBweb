/**
 * Prove the binary save blocks are laid out the way CSBWin lays them out.
 *
 * `tools/dump-savegame.ts` covers the runtime state a read restores. It never touches
 * the file: the CSBWin-shaped byte blocks that `SaveGameLoader` writes and reads.
 *
 * Two things are pinned here, and only one of them can be pinned by a round trip.
 *
 * **The fields.** `GAMEBLOCK2` (`doc/CSBwin-src/SaveGame.cpp:107-133`) carries
 * `handChar` at offset 20 and `MagicCaster` at 22, which `LoadGame` assigns straight to
 * `d.HandChar` and `d.MagicCaster` (`:1636-1637`). `parseBlock2` used to read only
 * `maxTimers` and `maxItem16`, so a cursor owner restored from a binary save was
 * whatever `ensureHandOwner` guessed.
 *
 * **The byte order.** This is the part a round trip cannot see. The blocks are
 * big-endian (`doc/CSBwin-src/CSBCode.cpp:9057` reads every word through `LE16`, which
 * is a swap on the little-endian build CSBWin ships as); this port used to read and
 * write them little-endian. Reader and writer agreed, every checksum matched, and
 * `saveSaveGameState` → `loadSaveGameState` round-tripped perfectly — in a format no
 * other program could read. So a round trip proves nothing here, and the canary below
 * is what does the work instead:
 *
 *   `scramble` XORs each word with a keystream derived from the initial hash and the
 *   word index alone — never from the content. So two saves that differ only in one
 *   field produce ciphertext that differs only in that field's own bytes, at its own
 *   offsets. Write `handChar = 2` and `handChar = 3` and the files must differ at
 *   **byte 21** of block 2 and nowhere else in the block; write `2` and `0x0200` and
 *   they must differ at **both** bytes. Under the old little-endian writer the single
 *   byte would be 20, so this distinguishes the two formats without needing a real
 *   CSBWin save file to compare against.
 *
 * What to look for: the "differs at" column naming byte 21 for the low-byte case and
 * bytes 20+21 for the whole-word case.
 *
 * Run: `npx tsx tools/dump-savegame-blocks.ts`
 */
import { loadSaveGameState, saveSaveGameState, type SaveGameState } from '../src/data/SaveGameLoader';
import type { Item16Record, TimerRecord } from '../src/data/dungeonTypes';
import { check, fail, finish } from './lib/check';

/** Where `saveSaveGameState` puts block 2: straight after the 512-byte block 1. */
const BLOCK2_OFFSET = 512;
const BLOCK2_SIZE = 128;

/** `gb2.handChar` / `gb2.MagicCaster`, from CSBWin's own struct comments. */
const HANDCHAR_OFFSET = 20;
const MAGICCASTER_OFFSET = 22;

/**
 * An `ITEM16` entry with every byte distinct, so a field read at the wrong offset
 * cannot accidentally match. `word0` is the one 16-bit field in the record.
 */
function makeItem16(): Item16Record {
  return {
    word0: 0x1234,
    facings: 0x21,
    positions: 0x22,
    uByte4: 0x24,
    uByte5: 0x25,
    uByte6: 0x26,
    uByte7: 0x27,
    ubPrevX: 0x28,
    ubPrevY: 0x29,
    uByte10: 0x2a,
    uByte11: 0x2b,
    singleMonsterStatus: [0x2c, 0x2d, 0x2e, 0x2f],
  };
}

/**
 * A `TIMER` with a distinct value in every field, so that a field written at a
 * neighbour's offset shows up rather than round-tripping by luck. The same trick
 * `makeItem16` uses, and it is what caught the writer emitting bytes 8-9 alone.
 */
function makeTimer(): TimerRecord {
  return {
    time: 0x00123456,
    level: 0x0d,
    function: 49,
    uByte5: 0x51,
    uByte6: 0x52,
    uByte7: 0x53,
    uByte8: 0xbe,
    uByte9: 0xef,
    // Zero because this round trip uses the **10-byte** `TIMER`: our writer emits no
    // Extended Features block yet, so a file it writes declares neither sequenced nor
    // extended timers and has no `m_timerSequence` field to carry. The 16-byte form is
    // exercised against genuine saves by `tools/dump-csbwin-timers.ts`; the level still
    // round-trips here because the short form folds it into the top byte of the time.
    sequence: 0,
    timerWord8: 0xbeef,
    timerWord6: 0x5253,
  };
}

function makeSave(handChar: number, magicCaster: number): SaveGameState {
  return {
    item16: [makeItem16()],
    timers: [makeTimer()],
    timerQueue: [0],
    maxItem16: 1,
    maxTimers: 1,
    sequencedTimers: false,
    extendedTimers: false,
    handChar,
    magicCaster,
  };
}

/** Byte offsets within block 2 at which two serialized saves differ. */
function block2Diff(a: Uint8Array, b: Uint8Array): number[] {
  const out: number[] = [];
  for (let i = 0; i < BLOCK2_SIZE; i++) {
    if (a[BLOCK2_OFFSET + i] !== b[BLOCK2_OFFSET + i]) out.push(i);
  }
  return out;
}

function main(): void {
  // ---- The fields round-trip ----------------------------------------------

  const written = saveSaveGameState(makeSave(2, 3));
  const read = loadSaveGameState(written);

  console.log('field\twritten\tread back');
  const row = (what: string, wrote: unknown, got: unknown): void => {
    console.log([what, wrote, got].join('\t'));
  };
  row('gb2.handChar', 2, read.handChar);
  row('gb2.MagicCaster', 3, read.magicCaster);
  row('gb2.MaxTimers', 1, read.maxTimers);
  row('gb2.MaxITEM16', 1, read.maxItem16);
  row('timers[0].word8', '0xbeef', `0x${(read.timers?.[0]?.timerWord8 ?? 0).toString(16)}`);
  console.log('');

  check(read.handChar === 2, 'gb2.handChar should round-trip');
  check(read.magicCaster === 3, 'gb2.MagicCaster should round-trip');
  check(read.maxTimers === 1, 'gb2.MaxTimers should round-trip');
  check(read.maxItem16 === 1, 'gb2.MaxITEM16 should round-trip');
  // Every `TIMER` field. A save that carries only `timerWord8` cannot say *when*
  // anything fires, which is how doors and fuses used to be lost across a load.
  const wroteTimer = makeTimer();
  const gotTimer = read.timers?.[0];
  if (!gotTimer) {
    fail('the TIMER record should come back at all');
  } else {
    for (const key of Object.keys(wroteTimer) as Array<keyof TimerRecord>) {
      row(`timers[0].${key}`, wroteTimer[key], gotTimer[key]);
      check(wroteTimer[key] === gotTimer[key], `TIMER field ${key} should round-trip`);
    }
  }
  check(
    (read.timerQueue ?? []).join(',') === '0',
    'the timer queue order should round-trip',
  );

  // Every `ITEM16` field, not just the one that first showed the writer was partial.
  // `makeItem16` gives each byte a distinct value, so this also catches a field
  // written at a neighbour's offset.
  const wroteItem = makeItem16();
  const gotItem = read.item16[0];
  if (!gotItem) {
    fail('the ITEM16 record should come back at all');
  } else {
    for (const key of Object.keys(wroteItem) as Array<keyof Item16Record>) {
      const expected = JSON.stringify(wroteItem[key]);
      const actual = JSON.stringify(gotItem[key]);
      row(`item16[0].${key}`, expected, actual);
      check(expected === actual, `ITEM16 field ${key} should round-trip`);
    }
  }

  // `d.HandChar` is -1 for "nobody", and the field is an `i16`: an unsigned read would
  // bring it back as 65535 and every `chIdx >= 0` test downstream would take the wrong
  // arm.
  const empty = loadSaveGameState(saveSaveGameState(makeSave(-1, -1)));
  row('gb2.handChar (none)', -1, empty.handChar);
  check(empty.handChar === -1, 'a handChar of -1 should come back negative, not 0xffff');
  check(empty.magicCaster === -1, 'a MagicCaster of -1 should come back negative, not 0xffff');
  console.log('');

  // ---- The byte-order canary ----------------------------------------------

  const lowByte = block2Diff(written, saveSaveGameState(makeSave(3, 3)));
  const wholeWord = block2Diff(written, saveSaveGameState(makeSave(0x0200, 3)));
  const caster = block2Diff(written, saveSaveGameState(makeSave(2, 4)));

  console.log('change\tdiffers at (byte offsets in block 2)');
  console.log(`handChar 2 -> 3\t${lowByte.join(',')}`);
  console.log(`handChar 2 -> 0x0200\t${wholeWord.join(',')}`);
  console.log(`MagicCaster 3 -> 4\t${caster.join(',')}`);
  console.log('');

  check(
    lowByte.length === 1 && lowByte[0] === HANDCHAR_OFFSET + 1,
    'changing handChar\'s low byte should move byte 21 alone — byte 20 would mean little-endian',
  );
  check(
    wholeWord.length === 2 && wholeWord[0] === HANDCHAR_OFFSET && wholeWord[1] === HANDCHAR_OFFSET + 1,
    'changing handChar\'s whole word should move both of its bytes and no others',
  );
  check(
    caster.length === 1 && caster[0] === MAGICCASTER_OFFSET + 1,
    'MagicCaster should sit two bytes past handChar, big-endian like it',
  );

  finish();
}

main();
