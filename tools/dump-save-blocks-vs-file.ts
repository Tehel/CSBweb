/**
 * Every block the writer emits, held up against the bytes CSBWin wrote.
 *
 * `tools/dump-savegame-blocks.ts` round-trips blocks 1-6 through this port's own reader
 * and writer, which on its own proves nothing — it is the trap that tool was written to
 * document. This is the other argument, the one `tools/dump-character-block.ts` makes
 * for block 4: take a **genuine** save, parse it, write the blocks again from what came
 * out, and compare with the file's own bytes. No bug symmetrical between our reader and
 * our writer can satisfy it, because CSBWin wrote the bytes.
 *
 * The comparison is made on the *scrambled* bytes, straight out of both files, which is
 * legitimate because `SaveGame` writes zero for all five block hashes
 * (`doc/CSBwin-src/SaveGame.cpp:1063-1067`) and so does `saveSaveGameState`: with the
 * same hash the keystream is the same, so equal plaintext is equal ciphertext and a
 * diff is a diff either way.
 *
 * Block 0 is compared too, and it is where the `at` cursor starts: it is variable-length
 * (512 bytes plus three per object-index slot plus the DSAs, the game info and the DSA
 * level index), so getting its length wrong moves every block after it.
 *
 * Three things are **reported and not asserted**, each for a stated reason:
 *
 * - **The bytes of block 1 `SaveGame` never assigns**: `Byte740[256…299]`, `FILL438` and
 *   `Checksum354…374`. `SaveGame` memsets the block before filling it
 *   (`doc/CSBwin-src/SaveGame.cpp:864-865`) and `ScrambleAndWrite` writes only words
 *   0-127 of `Byte740` (`:706-750`), so a CSBWin build of this source writes zeros there
 *   and so does this port. The committed saves agree, and a file some other build wrote
 *   need not. Every field of the block is asserted, bar the checksum words of a block whose
 *   own exempt bytes differ (below) and word 127, which sums them.
 * - **`TIMER.unused13[3]`** in a slot that is *not* live. The three padding bytes hold
 *   0xcd in every slot CSBWin has ever put a timer in and 0 in every slot it has not
 *   (`doc/PROVEN_FACTS.md` → "`TIMER.unused13` is 0xcd in a slot that has been used"),
 *   which is a high-water mark of allocation this port does not keep. A slot that is
 *   live now *is* asserted, padding included.
 * - **The timer queue past `NumTimer`.** CSBWin writes `MaxTimer` words and only the
 *   first `NumTimer` mean anything; the rest are what a longer queue left behind. The
 *   live prefix is asserted.
 *
 * Run: `npx tsx tools/dump-save-blocks-vs-file.ts [path-or-directory]`
 */
import { readFileSync } from 'node:fs';

import { loadSaveGameState, saveSaveGameState } from '../src/data/SaveGameLoader';
import { loadCsbwinWorld } from '../src/data/CsbwinDungeonImage';
import { formChecksum, objectIndexOf, readObjectIndirectIndex } from '../src/data/CsbwinObjectIndex';
import { OBJECT_ID_NULL } from '../src/core/types';
import { check, finish } from './lib/check';
import { genuineSaves } from './lib/saves';

const BLOCK1_SIZE = 512;
const BLOCK2_SIZE = 128;

/** Which `GAMEBLOCK1` field an offset falls in (`doc/CSBwin-src/SaveGame.cpp:60-104`). */
const BLOCK1_FIELDS: Array<[number, number, string]> = [
  [0, 256, 'Byte740 (ScrambleAndWrite)'], [256, 300, 'Byte740 tail'], [300, 301, 'Byte22598'],
  [301, 302, 'Byte22596'], [302, 306, 'FILL438'], [306, 308, 'SaveOption'],
  [308, 312, 'RandomGameID'], [312, 322, 'hashes'], [322, 326, 'totalMoveCount'],
  [326, 344, 'Hash326-342'], [344, 354, 'checksums'], [354, 376, 'Checksum354-374'],
  [376, 378, 'Word22594'], [378, 380, 'Word22592'], [380, 512, 'Byte22808'],
];

function block1Field(offset: number): string {
  return BLOCK1_FIELDS.find(([from, to]) => offset >= from && offset < to)?.[2] ?? `+${offset}`;
}

/** The bytes `SaveGame` never assigns: `Byte740[256…299]`, `FILL438`, `Checksum354…374`. */
function block1Unassigned(offset: number): boolean {
  return (offset >= 256 && offset < 300) || (offset >= 302 && offset < 306) ||
    (offset >= 354 && offset < 376);
}

/**
 * Block 1's words that sum debris: `TimersChecksum` (350) when block 5 differs from the
 * file in exempt bytes, `TimerQueChecksum` (352) when block 6 does, and word 127 (254),
 * `ScrambleAndWrite`'s sum of the second half, when either does.
 */
function block1DebrisSums(offset: number, timers: boolean, queue: boolean): boolean {
  if (offset >= 350 && offset < 352) return timers;
  if (offset >= 352 && offset < 354) return queue;
  if (offset >= 254 && offset < 256) return timers || queue;
  return false;
}
const CHARACTER_SIZE = 3328;

/** Which `GAMEBLOCK2` field an offset falls in (`doc/CSBwin-src/SaveGame.cpp:107-133`). */
const BLOCK2_FIELDS: Array<[number, number, string]> = [
  [0, 4, 'Time'], [4, 8, 'ranseed'], [8, 10, 'ObjectInHand'], [10, 12, 'numcharacter'],
  [12, 14, 'partyx'], [14, 16, 'partyy'], [16, 18, 'partyfacing'], [18, 20, 'partyLevel'],
  [20, 22, 'handChar'], [22, 24, 'MagicCaster'], [24, 26, 'NumTimer'],
  [26, 28, 'FirstAvailTimer'], [28, 30, 'MaxTimers'], [30, 32, 'ITEM16QueLen'],
  [32, 36, 'LastMonsterAttackTime'], [36, 40, 'LastPartyMoveTime'],
  [40, 42, 'partyMoveDisableTimer'], [42, 44, 'Word11712'], [44, 46, 'Word11714'],
  [46, 48, 'MaxITEM16'], [48, 50, 'TimerSequence'], [50, 128, 'FILL180'],
];

function block2Field(offset: number): string {
  return BLOCK2_FIELDS.find(([from, to]) => offset >= from && offset < to)?.[2] ?? `+${offset}`;
}

interface Region {
  name: string;
  size: number;
  /** Name the differing byte, for a diff a human can read. Optional. */
  field?: (within: number) => string;
  /** Assert equality, or merely report it. */
  assert: boolean;
  /** Why it is only reported, when it is. */
  why?: string;
  /** Within an asserted region, the bytes that are reported instead. */
  exempt?: (within: number) => boolean;
  /** Why those bytes are exempt. */
  exemptWhy?: string;
}

/** At most eight fields of a diff, so a failure stays readable. */
function summarize(diffs: Map<string, number>): string {
  const all = [...diffs];
  const shown = all.slice(0, 8).map(([f, n]) => `${f} (${n})`).join(', ');
  return all.length > 8 ? `${shown}, +${all.length - 8} more` : shown;
}

function main(): void {
  const saves = genuineSaves(process.argv[2]);
  check(saves.length > 0, 'there should be save files to read');

  for (const path of saves) {
    const name = path.split('/').pop() ?? path;
    const file = new Uint8Array(readFileSync(path));
    const state = loadSaveGameState(file);
    const written = saveSaveGameState(state);

    // Block 0 is variable-length, so it is compared first and then becomes the origin
    // both files' block 1 is measured from.
    const prefix = state.extendedFeaturesSize ?? 0;
    check(written.length >= prefix, `${name}: the written file carries a block-0 prefix`);
    const timerSize = state.extendedTimers ? 16 : state.sequencedTimers ? 12 : 10;
    const live = new Set(state.timerQueue ?? []);
    const liveWords = (state.timerQueue ?? []).length * 2;
    const dataMapLength = state.objectIndex?.length ?? 0;
    // Whether blocks 5 and 6 differ from the file in their exempt bytes, which block 1's
    // checksums of them sum: a region's own exemption carries over to its checksum.
    const block5At = prefix + BLOCK1_SIZE + BLOCK2_SIZE + 16 * state.maxItem16 + CHARACTER_SIZE;
    const block5Size = timerSize * state.maxTimers;
    const differsAt = (at: number, size: number, exempt: (i: number) => boolean): boolean => {
      for (let i = 0; i < size; i++) {
        if (exempt(i) && written[at + i] !== file[at + i]) return true;
      }
      return false;
    };
    const timerDebris = differsAt(block5At, block5Size,
      (i) => timerSize === 16 && i % 16 >= 13 && !live.has(Math.floor(i / 16)));
    const queueDebris = differsAt(block5At + block5Size, 2 * state.maxTimers, (i) => i >= liveWords);
    const regions: Region[] = [
      {
        name: 'block 0  ext features', size: prefix, assert: true,
        field: (i) =>
          i < 512 ? `header +${i}`
            : i < 512 + dataMapLength ? 'dataTypeMap'
            : i < 512 + dataMapLength * 3 ? 'dataIndexMap'
            : 'DSAs / game info / DSA level index',
      },
      {
        name: 'block 1  GAMEBLOCK1', size: BLOCK1_SIZE, assert: true, field: block1Field,
        exempt: (i) => block1Unassigned(i) || block1DebrisSums(i, timerDebris, queueDebris),
        exemptWhy: 'the bytes SaveGame never assigns, or the sums of blocks 5-6\'s debris',
      },
      { name: 'block 2  GAMEBLOCK2', size: BLOCK2_SIZE, assert: true, field: block2Field },
      { name: 'block 3  ITEM16', size: 16 * state.maxItem16, assert: true },
      { name: 'block 4  characters', size: CHARACTER_SIZE, assert: true },
      {
        name: 'block 5  timers', size: timerSize * state.maxTimers, assert: true,
        field: (i) => `timer ${Math.floor(i / timerSize)} +${i % timerSize}`,
        exempt: (i) =>
          timerSize === 16 && i % 16 >= 13 && !live.has(Math.floor(i / 16)),
        exemptWhy: 'unused13 of a freed slot',
      },
      {
        name: 'block 6  timer queue', size: 2 * state.maxTimers, assert: true,
        exempt: (i) => i >= liveWords,
        exemptWhy: 'the queue past NumTimer',
      },
    ];

    let at = 0;
    const lines: string[] = [];
    for (const region of regions) {
      const mine = written.subarray(at, at + region.size);
      const theirs = file.subarray(at, at + region.size);
      check(mine.length === region.size && theirs.length === region.size,
        `${name}: ${region.name} is ${region.size} bytes in both files`);

      const diffs = new Map<string, number>();
      let exempt = 0;
      for (let i = 0; i < region.size; i++) {
        if (mine[i] === theirs[i]) continue;
        if (region.exempt?.(i)) { exempt++; continue; }
        const field = region.field ? region.field(i) : `+${i}`;
        diffs.set(field, (diffs.get(field) ?? 0) + 1);
      }
      const summary = summarize(diffs);
      const note = exempt > 0 ? ` (${exempt} b differ in ${region.exemptWhy})` : '';
      lines.push(`    ${region.name.padEnd(22)} ${String(region.size).padStart(6)} b  ` +
        (!region.assert ? `differs (expected): ${region.why}`
          : diffs.size === 0 ? `identical${note}`
          : `DIFFERS: ${summary}${note}`));
      if (region.assert) {
        check(diffs.size === 0,
          `${name}: ${region.name} is the file's own bytes${summary ? ` — ${summary}` : ''}`);
      }
      at += region.size;
    }

    console.log(`${name}  (block 0 prefix ${prefix} b, ${dataMapLength} index slots, ` +
      `timer records ${timerSize} b)`);
    for (const line of lines) console.log(line);
  }

  /* ---- block 0's maps, written from a world ---- */

  // A save's world keeps the file's object index as its `RnMaps`, and the writer puts it
  // back (`objectIndexOf`). The canary: write the maps out as the prefix would, read them
  // back through the *reader* with both `FormChecksum`s verified, and compare with the
  // file's. A map written at the wrong width, in the wrong byte order or one slot out
  // fails here.
  console.log('\n=== the object index, written from a world ===');
  console.log(['save', 'file slots', 'written slots', 'references'].join('\t'));
  for (const path of saves) {
    const name = path.split('/').pop() ?? path;
    const { dungeon, save } = loadCsbwinWorld(new Uint8Array(readFileSync(path)));
    const index = objectIndexOf(dungeon.rnMaps);
    const indexBytes = new Uint8Array(index.length * 2);
    for (let i = 0; i < index.length; i++) {
      indexBytes[i * 2] = index.indexMap[i] & 0xff;
      indexBytes[i * 2 + 1] = (index.indexMap[i] >> 8) & 0xff;
    }
    const wire = new Uint8Array(index.length * 3);
    wire.set(index.typeMap, 0);
    wire.set(indexBytes, index.length);
    const reread = readObjectIndirectIndex(
      wire, 0, index.length, formChecksum(index.typeMap), formChecksum(indexBytes),
    );

    // Every reference the world holds — the object list and every live record's links —
    // names a live slot of the maps.
    let references = 0;
    let broken = 0;
    const live = (rn: number): void => {
      references++;
      if (!dungeon.rnMaps.checkIndirectIndex(rn) || reread.indexMap[rn] === 0xffff) broken++;
    };
    for (const rn of dungeon.objectList) {
      if (rn === OBJECT_ID_NULL || rn === 0xfffe) continue;
      live(rn);
    }
    for (const db of Object.values(dungeon.databases)) {
      for (const record of db.records as Array<Record<string, unknown>>) {
        const link = record.nextObject as number | undefined;
        if (link === undefined || link === OBJECT_ID_NULL) continue;
        if (link !== 0xfffe) live(link);
        for (const field of ['containedObject', 'possession', 'projectileObject'] as const) {
          const other = record[field] as number | undefined;
          if (other === undefined || other === OBJECT_ID_NULL || other >= 0xff00) continue;
          live(other);
        }
      }
    }

    console.log([name, save.objectIndex?.length ?? 0, reread.length, references].join('\t'));
    check(references > 1000, `${name}: the world holds references worth checking (${references})`);
    check(broken === 0, `${name}: every reference names a live slot of the maps (${broken} do not)`);
    check(
      !!save.objectIndex && reread.typeMap.join() === save.objectIndex.typeMap.join()
        && reread.indexMap.join() === save.objectIndex.indexMap.join(),
      `${name}: the maps written are the file's, slot for slot`);
  }

  finish();
}

main();
