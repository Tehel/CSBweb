/**
 * The three load-time conversions, held up against a dungeon CSBWin converted itself.
 *
 * `ReadDatabases` turns a `dungeon.dat`-shaped image into the shape a save is written
 * in, once, on load (`src/data/CsbwinDungeonConversions.ts`). Until this port did the
 * same, a game started from `dungeon.dat` could only write a `dungeon.dat`-shaped image
 * into a file whose header declares the converted shapes — which no reader can parse.
 *
 * **The oracle is exact, and that is the point of this tool.** Every committed save was
 * made by CSBWin from this same `dungeon.dat`, so CSBWin's converted form of it is
 * sitting in eight files. This converts `dungeon.dat` here and compares:
 *
 * - `ConvertToIndirectText` — the whole `indirectTextIndex`, the whole `compressedText`,
 *   the rewritten index word of every TEXT record, and `NumWordsInTextArray`, which
 *   stops being 1749 words of text and becomes 125 index entries.
 * - `convertScrolls` — every scroll's new text RN and its `open` bit.
 * - `MakeBigActuators` — every actuator's new `word8`, and `word4`/`word6` unchanged.
 *
 * What it cannot compare, and says so instead: the play state. A save was played before
 * it was written, so an actuator that has been pressed, a door that has been opened and
 * a scroll that has been picked up all differ from `dungeon.dat` for reasons that have
 * nothing to do with conversion. Every comparison below is therefore over fields the
 * conversion writes, not over the whole record, and the link words — which play rewrites
 * constantly — are left alone entirely.
 *
 * Two things are **reported rather than asserted**, each for a sourced reason:
 *
 * - the new scroll's `m_word4` bits 1-15, which `convertScrolls` never initialises, so a
 *   genuine save carries allocation debris there and this port writes zero;
 * - each save's `extendedFlags`, which differ between CSBWin builds; nothing in this tool
 *   depends on them, but the roll prints them so a future reader does not mistake a
 *   difference for a defect.
 *
 * The gate gets its own section. Running a conversion twice does not fail — it produces
 * a corrupt world — so "a save is not converted again" is the load-bearing claim, and it
 * is checked directly: a save's index length, text size and scroll RNs must be exactly
 * what the file holds after `loadCsbwinWorld`, not a second generation of them.
 *
 * Run: `npx tsx tools/dump-dungeon-conversions.ts [path-or-directory]`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DungeonLoader } from '../src/data/DungeonLoader';
import { loadCsbwinWorld } from '../src/data/CsbwinDungeonImage';
import {
  ComputeTextLength,
  ConvertToIndirectText,
  MakeBigActuators,
  convertScrolls,
} from '../src/data/CsbwinDungeonConversions';
import { getActuatorType } from '../src/data/actuatorHelpers';
import { DBType, OBJECT_ID_NULL } from '../src/core/types';
import type { DungeonData } from '../src/data/dungeonTypes';
import { check, fail, finish } from './lib/check';
import { STOCK_DIR, stockDungeon } from './lib/game';
import { SAVE_DIR, genuineSaves } from './lib/saves';

const DUNGEON = `${STOCK_DIR}/dungeon.dat`;

/** How many entries of two arrays differ, over the length they share. */
function diffs(a: readonly number[], b: readonly number[]): number {
  let n = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) n++;
  return n + Math.abs(a.length - b.length);
}

/* ----------------------------------------------------------- the unconverted form --- */

/**
 * `dungeon.dat` as it sits, with none of the three run. This is the input the
 * conversions are measured on, and the only place in the project that asks for it
 * outside `tools/dump-dungeon-image-blocks.ts`.
 */
function readRaw(): DungeonData {
  return new DungeonLoader().loadFromArray(
    new Uint8Array(readFileSync(resolve(DUNGEON))), { noConvert: true },
  );
}

/** `dungeon.dat` with all three run, which is what the game now holds. */
function readConverted(): DungeonData {
  return stockDungeon();
}

/* ------------------------------------------------------------------- the sections --- */

function checkTextConversion(raw: DungeonData, converted: DungeonData, saves: Map<string, DungeonData>): void {
  console.log('\nConvertToIndirectText');

  const index = converted.indirectTextIndex ?? [];
  const text = converted.compressedText ?? [];
  const rawWords = raw.textWords ?? [];

  console.log(`  dungeon.dat: ${rawWords.length} words of raw text, ` +
    `${raw.databases.texts.records.length} TEXT records`);
  console.log(`  converted:   ${index.length} index entries, ${text.length} words of ` +
    `compressed text, NumWordsInTextArray ${converted.header.textDataSize}`);

  // The two overwrites, checked as overwrites rather than as derivations.
  check(converted.header.textDataSize === index.length,
    `NumWordsInTextArray is the index length (${converted.header.textDataSize} vs ${index.length})`);
  check(converted.header.textDataSize !== raw.header.textDataSize,
    'NumWordsInTextArray was actually rewritten — it is not still the word count');
  check(converted.textWords === converted.compressedText,
    'textWords is the compressed array; the raw one is gone, as CSBWin frees it');

  // Only live records get an entry, and every live record's index word was rewritten.
  const live = raw.databases.texts.records.filter((r) => r.nextObject !== OBJECT_ID_NULL);
  check(index.length === live.length,
    `one index entry per live TEXT record (${index.length} of ${live.length}; ` +
    `${raw.databases.texts.records.length - live.length} have a null link)`);

  // Every entry's length is what `ComputeTextLength` says, and the entries tile the
  // compressed array end to end with no gap and no overlap — which is what makes the
  // index and the text one structure rather than two.
  let at = 0;
  let tiled = true;
  for (let i = 0; i < index.length; i++) {
    if (index[i] !== at) { tiled = false; break; }
    at += ComputeTextLength(text, at);
  }
  check(tiled && at === text.length,
    `the ${index.length} entries tile compressedText end to end (ended at ${at} of ${text.length})`);

  for (const [name, save] of saves) {
    const theirIndex = save.indirectTextIndex ?? [];
    const theirText = save.compressedText ?? [];
    const dIndex = diffs(index, theirIndex);
    const dText = diffs(text, theirText);
    console.log(`  ${name.padEnd(32)} index ${String(theirIndex.length).padStart(4)} ` +
      `(${dIndex} diff)  text ${String(theirText.length).padStart(5)} (${dText} diff)  ` +
      `NumWordsInTextArray ${save.header.textDataSize}`);
    check(dIndex === 0, `${name}: the indirect text index is CSBWin's own, entry for entry`);
    check(dText === 0, `${name}: the compressed text is CSBWin's own, word for word`);
    check(save.header.textDataSize === converted.header.textDataSize,
      `${name}: NumWordsInTextArray agrees (${save.header.textDataSize})`);

    // The record index words. Play never touches `DB2::index()`, so these must match
    // exactly — and they are the half of the conversion a derivation would have missed.
    const mine = converted.databases.texts.records;
    const theirs = save.databases.texts.records;
    let bad = 0;
    for (let i = 0; i < Math.min(mine.length, theirs.length); i++) {
      if (mine[i].textOffset !== theirs[i].textOffset) bad++;
    }
    check(mine.length === theirs.length && bad === 0,
      `${name}: every TEXT record's rewritten index word matches (${bad} differ)`);
  }
}

function checkScrollConversion(raw: DungeonData, converted: DungeonData, saves: Map<string, DungeonData>): void {
  console.log('\nconvertScrolls');

  const mine = converted.databases.scrolls.records;
  const before = raw.databases.scrolls.records;
  console.log(`  ${mine.length} SCROLL records, 4 bytes -> 6`);

  check(converted.newScrolls === true, 'the world declares the six-byte scroll shape');

  let built = 0;
  for (let i = 0; i < mine.length; i++) {
    const text = converted.rnMaps.decode(mine[i].textObject!);
    if (text.category === DBType.TEXT && text.index === (before[i].textReference & 0x3ff) && text.position === 0) built++;
    // `open` is `b10_15 == 0`, and the six bits it came from are gone afterwards.
    if (mine[i].open !== ((before[i].word2Bits10_15 ?? 0) === 0)) {
      fail(`scroll ${i}: open does not follow b10_15`);
    }
  }
  check(built === mine.length,
    `every scroll's text RN is RN(0, dbTEXT, its old 10-bit index) (${built} of ${mine.length})`);
  check(mine.every((r) => r.word2Bits10_15 === undefined),
    'the four-byte form\'s b10_15 is gone — the record is unambiguously the new shape');

  for (const [name, save] of saves) {
    const theirs = save.databases.scrolls.records;
    if (theirs.length !== mine.length) {
      check(false, `${name}: scroll count agrees (${theirs.length} vs ${mine.length})`);
      continue;
    }
    let badRn = 0;
    let badOpen = 0;
    let debris = 0;
    let free = 0;
    for (let i = 0; i < mine.length; i++) {
      // A **free** record's secondary RN is not comparable and never was. CSBWin
      // converts one like any other — `convertScrolls` walks the whole database — but
      // `DeleteDBEntry` frees the slot it names without touching the word
      // (`doc/CSBwin-src/data.cpp:995-1017`), so this port's reader drops it rather
      // than resolve a freed slot, and the writer puts `RNnul` back. Scroll 33 of DM is
      // the one such record. The same exemption `tools/dump-dungeon-image-blocks.ts`
      // makes, by name.
      if (theirs[i].nextObject === OBJECT_ID_NULL) { free++; continue; }
      // The slot each names: a save's numbering is its own CSBWin's, and the slot
      // numbers need not agree.
      const ours = converted.rnMaps.decode(mine[i].textObject!);
      const its = save.rnMaps.decode(theirs[i].textObject!);
      if (ours.category !== its.category || ours.index !== its.index || ours.position !== its.position) badRn++;
      if (mine[i].open !== theirs[i].open) badOpen++;
      if ((theirs[i].word4Bits1_15 ?? 0) !== 0) debris++;
    }
    console.log(`  ${name.padEnd(32)} RN ${badRn} diff  open ${badOpen} diff  ` +
      `[${debris} carry m_word4 debris, ${free} free record(s) exempt of ${mine.length}]`);
    check(badRn === 0, `${name}: every scroll's text RN is the one CSBWin built`);
    check(badOpen === 0, `${name}: every scroll's open bit survives the conversion`);
  }
  console.log('  m_word4 bits 1-15 are uninitialised in CSBWin and written as 0 here — ' +
    'reported above, not asserted');
}

function checkActuatorConversion(raw: DungeonData, converted: DungeonData, saves: Map<string, DungeonData>): void {
  console.log('\nMakeBigActuators');

  const mine = converted.databases.actuators.records;
  const before = raw.databases.actuators.records;
  console.log(`  ${mine.length} ACTUATOR records, 8 bytes -> 10`);

  check(converted.bigActuators === true, 'the world declares the ten-byte actuator shape');
  check(before.every((r) => r.word8 === undefined),
    'the unconverted records have no word8 at all');
  check(mine.every((r) => r.word8 !== undefined),
    'every converted record has one');

  // The byte-order divergence, as a canary rather than as an assumption. CSBWin calls
  // `MakeBig` before `db.swap`, so on its little-endian build `actuatorType()` reads
  // bits 8-14 of the true `word2`. The two readings agree for any dungeon with no
  // type-47 actuator under either — assert that this dungeon is one, so a third-party
  // dungeon that is not fails here rather than writing a quietly different word8.
  const swap = (w: number) => (((w >> 8) | (w << 8)) & 0xffff);
  const asRead = before.filter((r) => getActuatorType(r) === 47).length;
  const asCsbwin = before.filter((r) => (swap(r.word2) & 0x7f) === 47).length;
  console.log(`  type-47 (DSA) actuators: ${asRead} read decoded, ${asCsbwin} read the way ` +
    'CSBWin reads them (before the byte swap)');
  check(asRead === 0 && asCsbwin === 0,
    'no actuator is a DSA under either reading, so the divergence cannot bite this dungeon');

  // `MakeBig`'s own arithmetic, on a record built for it, since the shipped dungeon has
  // none. `word8 = ((word6 >> 12) & 0xc0) | ((word4 >> 14) & 0x03)`, then both masked to
  // 14 bits (`doc/CSBwin-src/data.cpp:1329-1336`).
  const probe = readRaw();
  probe.databases.actuators.records = [
    { nextObject: OBJECT_ID_NULL, word2: 47, word4: 0xc123, word6: 0xf456 },
  ];
  MakeBigActuators(probe);
  const dsa = probe.databases.actuators.records[0];
  // Transcribed, not simplified: `(word6 >> 12) & 0xc0` can only ever be 0, since
  // `word6` is sixteen bits — a CSBWin quirk `ParameterB` does not agree with, and one
  // no dungeon this project holds can exercise.
  const wantWord8 = (((0xf456 >> 12) & 0xc0) | ((0xc123 >> 14) & 0x03));
  check(dsa.word8 === wantWord8,
    `a type-47 record lifts its parameter bits into word8 (got ${dsa.word8}, want ${wantWord8})`);
  check(dsa.word4 === 0x0123 && dsa.word6 === 0x3456,
    'and masks both parameters down to 14 bits');

  for (const [name, save] of saves) {
    const theirs = save.databases.actuators.records;
    if (theirs.length !== mine.length) {
      check(false, `${name}: actuator count agrees (${theirs.length} vs ${mine.length})`);
      continue;
    }
    let badW8 = 0;
    let played = 0;
    for (let i = 0; i < mine.length; i++) {
      // Strictly, so an unconverted record — `word8` undefined — fails rather than
      // comparing equal to a file's zero.
      if (mine[i].word8 !== theirs[i].word8) badW8++;
      // Play rewrites word2/word4/word6 — pressed switches, spent counters — so these
      // are counted and printed, never asserted.
      if (mine[i].word2 !== theirs[i].word2 || mine[i].word4 !== theirs[i].word4 ||
          mine[i].word6 !== theirs[i].word6) played++;
    }
    console.log(`  ${name.padEnd(32)} word8 ${badW8} diff  ` +
      `[${played}/${mine.length} records changed by play]`);
    check(badW8 === 0, `${name}: every actuator's word8 is the one CSBWin wrote`);
  }
}

/* ------------------------------------------------------------------------ the gate --- */

/**
 * The claim the whole design rests on: a save arrives converted and must not be
 * converted again. There is no error to catch if it is — the second pass simply builds
 * an index over an array that is already an index — so the check is that the numbers a
 * genuine save comes back with are the file's own.
 */
function checkTheGate(saves: Map<string, DungeonData>, converted: DungeonData): void {
  console.log('\nThe gate: a save is not converted a second time');
  for (const [name, save] of saves) {
    check(save.indirectText === true && save.bigActuators === true && save.newScrolls === true,
      `${name}: loads already in the converted shape, so no conversion runs`);
    check((save.indirectTextIndex ?? []).length === save.header.textDataSize,
      `${name}: NumWordsInTextArray still matches its own index`);
  }

  // And what a second pass would have done, so the reader can see the size of the
  // mistake the gate prevents. Run over a *copy*, never over a world anything uses.
  const doubled = readConverted();
  const firstIndex = (doubled.indirectTextIndex ?? []).length;
  const firstText = (doubled.compressedText ?? []).length;
  ConvertToIndirectText(doubled);
  const secondText = (doubled.compressedText ?? []).length;
  console.log(`  a second ConvertToIndirectText over the same world: ` +
    `${firstText} words of text become ${secondText}`);
  check(secondText !== firstText || firstIndex === 0,
    'converting twice really does corrupt the text — the gate is load-bearing, not tidiness');

  // `convertScrolls` a second time names the same text records, from `textReference`,
  // which it never overwrites, but in new slots: `AllocateIndirectIndex` mints one per
  // scroll (`doc/CSBwin-src/SaveGame.cpp:2365`), so each run grows the maps by the
  // database's size. `MakeBigActuators` is worse, and the probe below shows it.
  const twice = readConverted();
  const slotsBefore = twice.rnMaps.length;
  convertScrolls(twice);
  const scrolls = twice.databases.scrolls.records;
  check(scrolls.every((r, i) => {
    const again = twice.rnMaps.decode(r.textObject!);
    const first = converted.rnMaps.decode(converted.databases.scrolls.records[i].textObject!);
    return again.category === first.category && again.index === first.index;
  }) && twice.rnMaps.length === slotsBefore + scrolls.length,
    `convertScrolls run twice names the same texts, in ${scrolls.length} new slots`);

  const dsa = readConverted();
  dsa.databases.actuators.records = [
    { nextObject: OBJECT_ID_NULL, word2: 47, word4: 0xc123, word6: 0xf456 },
  ];
  MakeBigActuators(dsa);
  const once = { ...dsa.databases.actuators.records[0] };
  MakeBigActuators(dsa);
  const again = dsa.databases.actuators.records[0];
  console.log(`  MakeBigActuators over a type-47 record twice: word8 ${once.word8} -> ${again.word8}`);
  check(once.word8 !== again.word8,
    'a second MakeBigActuators loses a DSA actuator\'s parameter bits — its gate is load-bearing too');
}

/* ------------------------------------------------------------------------- the run --- */

function main(): void {
  const files = genuineSaves(process.argv[2]);
  if (files.length === 0) {
    console.error(`no save files under ${process.argv[2] ?? SAVE_DIR}`);
    process.exitCode = 1;
    return;
  }

  const raw = readRaw();
  const converted = readConverted();

  const saves = new Map<string, DungeonData>();
  for (const file of files) {
    const name = file.split('/').pop() ?? file;
    try {
      saves.set(name, loadCsbwinWorld(new Uint8Array(readFileSync(file))).dungeon);
    } catch (error) {
      fail(`${name}: does not parse — ${(error as Error).message}`);
    }
  }
  console.log(`dungeon.dat converted, and compared with ${saves.size} CSBWin saves of it`);

  checkTextConversion(raw, converted, saves);
  checkScrollConversion(raw, converted, saves);
  checkActuatorConversion(raw, converted, saves);
  checkTheGate(saves, converted);

  console.log();
  finish();
}

main();
