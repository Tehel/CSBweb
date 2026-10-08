/**
 * Write a whole CSBWin save file — all sixteen blocks — and load it back.
 *
 * Every other tool in this group compares one block with the bytes CSBWin wrote.
 * This one is the other half: it takes a genuine save, parses it
 * completely, **re-serialises the entire file** through `saveSaveGameState` with a
 * dungeon image and a closing checksum, and then hands the result to this port's own
 * reader. If anything the writer emits disagrees with what the reader expects, the file
 * either fails to parse at all — the image closure check in `loadCsbwinWorld` is
 * unforgiving — or comes back as a different world.
 *
 * Every RN goes back out as the slot it was read as, with the file's own object indirect
 * index, so the RN words come back as they were. It is not a whole-file byte comparison:
 * the reader reads a free record's second RN as `RNnul` (`DungeonLoader.readRNOfRecord`),
 * 136 words of `csbgame-early-1hero.dat`, and the closing checksum follows them.
 * `tools/dump-dungeon-image-blocks.ts` and
 * `tools/dump-save-blocks-vs-file.ts` make the byte-for-byte argument block by block;
 * this tool shows that the whole file, written and read again, is the same world.
 *
 * What it does **not** cover: the live path, a file written from a running game
 * (`buildSaveFile`). `tools/dump-live-save-file.ts` and `tools/dump-save-roundtrip.ts` do.
 *
 * Run: `npx tsx tools/dump-save-file-roundtrip.ts [path-or-directory]`
 */
import { readFileSync } from 'node:fs';

import { saveSaveGameState } from '../src/data/SaveGameLoader';
import { loadCsbwinWorld } from '../src/data/CsbwinDungeonImage';
import { buildCsbwinCharacterBlock, readCsbwinParty, readCsbwinPartyTail } from '../src/data/CsbwinCharacters';
import { objectIndexOf } from '../src/data/CsbwinObjectIndex';
import {
  buildDungeonImage,
  buildImageChecksum,
  cellFlagArraySize,
} from '../src/data/CsbwinDungeonImageWriter';
import type { DungeonData, Databases, TimerRecord } from '../src/data/dungeonTypes';
import { check, finish } from './lib/check';
import { genuineSaves } from './lib/saves';

const DATABASE_KEYS: Array<keyof Databases> = [
  'doors', 'teleporters', 'texts', 'actuators', 'creatures', 'weapons', 'clothing',
  'scrolls', 'potions', 'containers', 'misc', 'missiles', 'clouds',
];

/**
 * Build a complete file out of a parsed one. Every RN goes out as the slot it was read
 * as, and block 0 carries the maps the world was read with (`objectIndexOf`).
 */
function rewrite(bytes: Uint8Array): {
  written: Uint8Array; image: Uint8Array; slots: number;
  /** The live timers that carry an object RN, and the object each names. */
  timerObjects: Array<{ slot: number; at: 6 | 8; object: number }>;
} {
  const { dungeon, save } = loadCsbwinWorld(bytes);

  const block = save.characterBlock!;
  const champions = readCsbwinParty(block, 4).map((c) => c.champion);
  const tail = readCsbwinPartyTail(block);

  const image = buildDungeonImage(dungeon, {
    indirectText: save.indirectText ?? false,
    bigActuators: save.bigActuators ?? false,
    newScrolls: (save.version ?? 0) >= 0x42,
  });
  const index = objectIndexOf(dungeon.rnMaps);
  const written = saveSaveGameState({
    ...save,
    objectIndex: index,
    characterBlock: buildCsbwinCharacterBlock(champions, tail),
    dungeonImage: image,
  });
  return {
    written, image, slots: index.length,
    timerObjects: objectCarryingTimers(save.timers ?? [], save.timerQueue ?? []).map(({ slot, at, rn }) => (
      { slot, at, object: rn }
    )),
  };
}

/**
 * The live timers that carry an object reference, and where in the record it sits.
 *
 * `ConvertTimers` switches on the timer function (`doc/CSBwin-src/SaveGame.cpp:2239-2262`):
 * functions 48 and 49 carry `timerObj6` — bytes 6-7 — and are the missile in flight;
 * 24, 25, 60 and 61 carry `timerObj8`, bytes 8-9. Every other function reads those bytes
 * as plain numbers (a map square, an action code) and must not be touched.
 */
function objectCarryingTimers(
  timers: readonly TimerRecord[],
  queue: readonly number[],
): Array<{ slot: number; at: 6 | 8; rn: number }> {
  const live = new Set(queue);
  const out: Array<{ slot: number; at: 6 | 8; rn: number }> = [];
  timers.forEach((timer, slot) => {
    if (!live.has(slot)) return;
    if (timer.function === 48 || timer.function === 49) {
      out.push({ slot, at: 6, rn: timer.timerWord6 & 0xffff });
    } else if ([24, 25, 60, 61].includes(timer.function)) {
      out.push({ slot, at: 8, rn: timer.timerWord8 & 0xffff });
    }
  });
  return out;
}

/** Compare two parsed worlds field by field, counting the mismatches by name. */
function compareWorlds(label: string, before: DungeonData, after: DungeonData): void {
  const h1 = before.header;
  const h2 = after.header;
  check(h1.randomSeed === h2.randomSeed && h1.numMaps === h2.numMaps &&
    h1.objectListSize === h2.objectListSize && h1.textDataSize === h2.textDataSize,
    `${label}: the image header survives the round trip`);
  check(h1.objectCounts.join() === h2.objectCounts.join(),
    `${label}: all sixteen database sizes survive`);

  check(before.objectList.join() === after.objectList.join(),
    `${label}: all ${before.objectList.length} object list entries resolve to the same objects`);
  check(before.columnIndex.join() === after.columnIndex.join(),
    `${label}: the column index survives`);

  let cells = 0;
  before.maps.forEach((map, i) => {
    const other = after.maps[i];
    for (let x = 0; x < map.descriptor.width; x++) {
      for (let y = 0; y < map.descriptor.height; y++) {
        if (map.cellFlags[x][y] !== other.cellFlags[x][y]) cells++;
      }
    }
  });
  check(cells === 0, `${label}: every cell flag of all ${before.maps.length} levels survives (${cells} differ)`);

  for (const key of DATABASE_KEYS) {
    const a = before.databases[key].records;
    const b = after.databases[key].records;
    check(a.length === b.length, `${label}: ${key} still holds ${a.length} records`);
    let wrong = 0;
    for (let i = 0; i < a.length; i++) {
      if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) wrong++;
    }
    check(wrong === 0, `${label}: every ${key} record survives field for field (${wrong} differ)`);
  }

  check((before.indirectTextIndex ?? []).join() === (after.indirectTextIndex ?? []).join(),
    `${label}: the indirect text index survives`);
  check((before.compressedText ?? []).join() === (after.compressedText ?? []).join(),
    `${label}: the compressed text survives`);
  check((before.expool?.length ?? 0) === (after.expool?.length ?? 0) &&
    (before.expool ?? []).every((v, i) => v === after.expool?.[i]),
    `${label}: EXPOOL survives byte for byte (${before.expool?.length ?? 0} bytes)`);
}

function main(): void {
  const saves = genuineSaves(process.argv[2]);
  check(saves.length > 0, 'there should be save files to read');
  let carriedTimers = 0;

  for (const path of saves) {
    const name = path.split('/').pop() ?? path;
    const bytes = new Uint8Array(readFileSync(path));
    const { dungeon: before, save } = loadCsbwinWorld(bytes);

    const { written, image, slots, timerObjects } = rewrite(bytes);
    carriedTimers += timerObjects.length;
    console.log(`${name}  read ${bytes.length} b, wrote ${written.length} b  ` +
      `(image ${image.length} b, index ${slots} slots)`);

    // The Extended Features block declares block 14's length and the reader believes it,
    // so the two must agree or the image will not close.
    check((save.extendedFeatures?.cellFlagArraySize ?? 0) === cellFlagArraySize(before.maps),
      `${name}: the declared cell flag array length is the one we measure`);

    const sum = buildImageChecksum(image);
    check(written[written.length - 2] === sum[0] && written[written.length - 1] === sum[1],
      `${name}: the file ends with the image checksum`);

    // The reader is unforgiving about this one: every section length has to sum to
    // `EOF - 2` or `loadCsbwinWorld` throws rather than parsing on into the wrong bytes.
    const round = loadCsbwinWorld(written);
    check(true, `${name}: the file we wrote parses, image and all`);

    compareWorlds(name, before, round.dungeon);

    /* ---- the party, which is where the possession slots are ---- */

    const theirs = readCsbwinParty(save.characterBlock!, 4);
    const ours = readCsbwinParty(round.save.characterBlock!, 4);
    check(theirs.length === ours.length, `${name}: the party is still ${theirs.length} champions`);
    let slotsWrong = 0;
    theirs.forEach((c, i) => {
      const o = ours[i];
      if (!o) { slotsWrong += 30; return; }
      check(c.champion.name === o.champion.name, `${name}: champion ${i} is still ${c.champion.name}`);
      for (let p = 0; p < 30; p++) {
        if (c.champion.possessions?.[p] !== o.champion.possessions?.[p]) slotsWrong++;
      }
    });
    check(slotsWrong === 0,
      `${name}: all ${theirs.length * 30} possession slots name the same objects (${slotsWrong} differ)`);

    // The object-carrying timers, which are the one RN the reader leaves raw and the
    // writer therefore has to translate by hand. `csbgame-flying-sword.dat` has one.
    for (const { slot, at, object } of timerObjects) {
      const timer = round.save.timers?.[slot];
      const word = at === 6 ? timer?.timerWord6 : timer?.timerWord8;
      check(((word ?? 0) & 0xffff) === object,
        `${name}: timer ${slot} still carries the same flying object`);
    }

    const objectInHand = round.save.block2?.objectInHand;
    const expected = save.block2?.objectInHand;
    check(objectInHand === expected, `${name}: GAMEBLOCK2.ObjectInHand names the same object`);
    check(
      !!round.save.objectIndex && !!save.objectIndex
        && round.save.objectIndex.typeMap.join() === save.objectIndex.typeMap.join()
        && round.save.objectIndex.indexMap.join() === save.objectIndex.indexMap.join(),
      `${name}: the object indirect index survives slot for slot`);
  }

  // The timer translation is only evidence if something exercises it — one save was made
  // to order with a sword in flight for exactly this.
  check(carriedTimers > 0, `an object-carrying timer should be among the saves (${carriedTimers} found)`);

  finish();
}

main();
