/**
 * What a damaged or hostile file's counts can do to the readers (`DEBT.md` R → "A file
 * the player drops on the page and a custom dungeon are untrusted"): every count that
 * sizes an allocation or bounds a loop is set absurdly, and the reader must throw, or
 * return what its bound allows, at once, where it would otherwise exhaust the tab's memory
 * or never return.
 *
 * - A DSA's `numStates` sizes its state table (`readDsa`): past 0x10000 the read throws.
 * - `ExpandData`'s expanded size, a compressed `dungeon.dat`'s long at 2, sizes its output.
 * - `LZWexpand` (graphics.dat, the Hint Oracle) follows a dictionary chain that a damaged
 *   stream can close on itself, and `RLEexpand` repeats a byte up to 255 times.
 * - `SNDexpand`'s repeat count is unbounded; the sound is its first word's samples.
 * - A `CSBgraphics.dat` section's `uncompressedSize` sizes `ReadCSBgraphic`'s output, and
 *   its `OVLDECODE` has CSBWin's stack of 1024, past which `EnlargeStack` is
 *   `NotImplemented(0xf864)` (`doc/CSBwin-src/Graphics.cpp:3143-3146`): a cyclic chain
 *   reaches it. An escape that enlarges the table again and again is a few bits each.
 * - A portrait's `(width+1)/2 * height` wraps in CSBWin's `ui32`
 *   (`doc/CSBwin-src/Bitmaps.cpp:356-372`), and a width of 0 leaves a loop of `height`.
 * - A viewport program that jumps to itself never returns (`Interpret`).
 */

import { readFileSync } from 'node:fs';

import { ExpandData, LZWexpand, MAX_EXPANDED_SIZE, RLEexpand, SNDexpand } from '../../src/core/compression';
import { CSBGraphicsLoader, CSBGraphicType } from '../../src/data/CSBGraphicsLoader';
import {
  buildExtendedFeaturesPrefix, EF_FLAGS, readExtendedFeatures, type ExtendedFeaturesBlock,
} from '../../src/data/CsbwinExtendedFeatures';
import { DungeonLoader } from '../../src/data/DungeonLoader';
import { Die } from '../../src/core/Die';
import { BytecodeInterpreter } from '../../src/renderer/bytecode/BytecodeInterpreter';
import { Opcode } from '../../src/renderer/bytecode/Opcodes';
import { check, finish } from '../lib/check';
import { viewportContextOf } from '../lib/viewportContext';

/**
 * What `run` threw, or `null`. A `RangeError` is `null` too: that is V8 refusing an
 * allocation or an array's length, after the memory has gone, which a tab may not survive.
 */
function thrown(run: () => unknown): Error | null {
  try {
    run();
    return null;
  } catch (error) {
    return error instanceof RangeError ? null : error as Error;
  }
}

/** `codes`, `width` bits each, packed from the low bit up: an `LZWexpand` stream. */
function packCodes(codes: number[], width: (i: number) => number): Uint8Array {
  const bits: number[] = [];
  codes.forEach((code, i) => {
    for (let b = 0; b < width(i); b++) bits.push((code >>> b) & 1);
  });
  const out = new Uint8Array(Math.ceil(bits.length / 32) * 4);
  bits.forEach((bit, i) => { out[i >> 3] |= bit << (i & 7); });
  return out;
}

/**
 * `codes`, `width` bits each, as `OVLDECODE::GetBytes` reads them: from the low bit of
 * little-endian longs, a code that runs past a long its high bits in that long's last
 * ones and its low bits at the start of the next.
 */
function packOvlCodes(codes: number[], width: (i: number) => number): Uint8Array {
  const longs: number[] = [0];
  let used = 0;
  codes.forEach((code, i) => {
    const w = width(i);
    const here = Math.min(w, 32 - used);
    const high = Math.floor(code / 2 ** (w - here)) % 2 ** here;
    longs[longs.length - 1] = (longs[longs.length - 1]! + high * 2 ** used) >>> 0;
    used += here;
    if (here < w) {
      longs.push(code % 2 ** (w - here));
      used = w - here;
    }
  });
  const out = new Uint8Array(longs.length * 4);
  longs.forEach((long, i) => new DataView(out.buffer).setUint32(i * 4, long, true));
  return out;
}

/** A `CSBgraphics.dat` of one section, type `type` id 0, `body` its compressed bytes. */
function csbGraphics(type: number, body: Uint8Array, uncompressedSize: number): CSBGraphicsLoader {
  const file = new Uint8Array(12 + 36 + body.length);
  const view = new DataView(file.buffer);
  file.set([...'CSBg'].map((c) => c.charCodeAt(0)));
  view.setUint32(8, 1, true);
  view.setUint32(12, type, true);
  view.setUint32(12 + 8, body.length, true);
  view.setUint32(12 + 12, uncompressedSize, true);
  view.setUint32(12 + 16, 48, true);
  file.set(body, 48);
  const loader = new CSBGraphicsLoader();
  loader.loadFromArray(file);
  return loader;
}

function main(): void {
  console.log('== a DSA\'s states ==');
  const header: ExtendedFeaturesBlock = {
    version: 0x41, flags: EF_FLAGS.LevelDSAInfoPresent, numDSA: 1, editingOptions: 0, gameInfoSize: 0,
    cellFlagArraySize: 0, graphicsSignature1: 0, graphicsSignature2: 0, spellFilterLocation: 0, extendedFlags: 0,
    overlayOrdinal: 0, overlayP1: 0, overlayP2: 0, overlayP3: 0, overlayP4: 0,
    csbGraphicsSignature1: 0, csbGraphicsSignature2: 0, hintKey: new Uint8Array(8),
  };
  const withStates = (numStates: number): Uint8Array => {
    const entries = new Array(256).fill(null);
    entries[0] = { description: 'damaged', state: 0, localState: 0, groupId: 0, numStates, firstDisplayedState: 0, states: [] };
    return buildExtendedFeaturesPrefix({ header, typeMap: new Uint8Array(0), indexMap: new Uint16Array(0), dsaIndex: { entries } });
  };
  const fits = readExtendedFeatures(withStates(0x10000)).dsaIndex?.entries[0];
  console.log(`  0x10000 states: read, ${fits?.states.length} slots`);
  check(fits?.numStates === 0x10000 && fits.states.length === 0x10000, 'a DSA of 0x10000 states reads, every slot empty');
  const huge = thrown(() => readExtendedFeatures(withStates(400_000_000)));
  console.log(`  400,000,000 states: ${huge?.message}`);
  check(huge !== null, 'a DSA of 400,000,000 states throws before its table is allocated');

  console.log('== ExpandData ==');
  const dungeon = new Uint8Array(readFileSync('tools/fixtures/gamefiles/csb/dungeon.dat'));
  check(dungeon[0] === 0x81 && dungeon[1] === 0x04, "CSB's dungeon.dat is compressed");
  const expandHuge = thrown(() => ExpandData(dungeon.subarray(8), 0x40000000));
  console.log(`  an expanded size of 1 GiB: ${expandHuge?.message}`);
  check(expandHuge !== null, 'ExpandData throws for an expanded size past MAX_EXPANDED_SIZE');
  const patched = dungeon.slice();
  new DataView(patched.buffer).setUint32(2, 0x40000000);
  check(thrown(() => new DungeonLoader().loadDungeonDat(patched)) !== null, 'so does loadDungeonDat for a file that says so');

  console.log('== LZWexpand and RLEexpand ==');
  // 'A'; 258, one past the next code, makes 257 = 'A'; 257 makes 258 point at itself;
  // 258 then follows that chain.
  const cyclic = thrown(() => LZWexpand(packCodes([65, 258, 257, 258], () => 9)));
  console.log(`  a chain closed on itself: ${cyclic?.message}`);
  check(cyclic !== null, 'LZWexpand throws on a cyclic dictionary chain');
  const plain = LZWexpand(packCodes([65, 66, 257], () => 9));
  console.log(`  'A', 'B', 257: ${[...plain].join(' ')}`);
  check([...plain].join() === '65,66,65,66', 'a well-formed stream still expands');
  const runs = new Uint8Array(3 * 1000).map((_, i) => [0x41, 0x90, 0xff][i % 3]!);
  check(RLEexpand(runs).length === 255 * 1000, 'RLEexpand within its bound expands every run');
  check(thrown(() => RLEexpand(runs, 1000)) !== null, 'RLEexpand throws past the bound it is given');

  console.log('== SNDexpand ==');
  // 100 samples: a 1, then a repeat of 8^10 - 1 + 3, its count nine nibbles of 0xf and a 7.
  const sound = new Uint8Array([0, 100, 0x10, 0xff, 0xff, 0xff, 0xff, 0xf7]);
  const expanded = SNDexpand(sound);
  console.log(`  a repeat of 2^30 + 2 samples, in a sound of 100: ${expanded.length} samples`);
  check(expanded.length === 100 && expanded.every((s) => s === 17), 'SNDexpand stops at its first word\'s count');

  console.log('== CSBgraphics.dat ==');
  const ovlHuge = thrown(() => csbGraphics(CSBGraphicType.Sound, new Uint8Array(4), 0x40000000)
    .readSection(CSBGraphicType.Sound, 0, 0));
  console.log(`  an uncompressedSize of 1 GiB: ${ovlHuge?.message}`);
  check(ovlHuge !== null, 'ReadCSBgraphic throws for an uncompressedSize past MAX_EXPANDED_SIZE');
  // 256 is past the table: 255 = 0. 256 again, 256 = 256. Then 256 follows that chain.
  const loop = csbGraphics(CSBGraphicType.Sound, packOvlCodes([256, 256, 256], () => 9), 4096);
  const loopError = thrown(() => loop.readSection(CSBGraphicType.Sound, 0, 0));
  console.log(`  a chain closed on itself: ${loopError?.message.split('\n')[0]}`);
  check(loopError instanceof Die && loopError.errorNum === 0xf864, "OVLDECODE's stack overflows into NotImplemented(0xf864)");
  // Each escape, `maxTableLen - 1`, doubles the table and widens the code by a bit; 65,
  // 29 bits wide, then reads as 'A'.
  const escapes = [...Array.from({ length: 20 }, (_, i) => 2 ** (9 + i) - 1), 65];
  const widened = csbGraphics(CSBGraphicType.Sound, packOvlCodes(escapes, (i) => 9 + i), 16);
  const widenedOut = widened.readSection(CSBGraphicType.Sound, 0, 0);
  console.log(`  20 escapes, the table 2^29 entries wide: ${widenedOut?.length} bytes read, the first ${widenedOut?.[0]}`);
  check(widenedOut?.length === 16 && widenedOut[0] === 65,
    'the table is stored as far as it is filled, not as far as it is wide');

  console.log('== a portrait ==');
  const portrait = (width: number, height: number): CSBGraphicsLoader => {
    // Each byte a code of its own, below 256.
    const bmp = new Uint8Array(14 + 40 + 64 + 16);
    const view = new DataView(bmp.buffer);
    view.setUint16(0, 0x4d42, true);
    view.setUint32(14 + 4, width, true);
    view.setUint32(14 + 8, height, true);
    view.setUint16(14 + 14, 4, true);
    return csbGraphics(CSBGraphicType.Portrait, packOvlCodes([...bmp], () => 9), bmp.length);
  };
  const small = portrait(2, 2).importBitmap(0);
  console.log(`  2 x 2: ${small?.width}x${small?.height}`);
  check(small?.width === 2 && small.height === 2, 'a portrait whose pixels are there reads');
  const wrapped = portrait(0x1ffff, 0x10000).importBitmap(0);
  console.log(`  131071 x 65536, whose (width+1)/2*height is 0 in 32 bits: ${wrapped === null ? 'refused' : 'read'}`);
  check(wrapped === null, 'a portrait whose pixel size wraps is refused');
  const start = Date.now();
  const empty = portrait(0, 0xffffffff).importBitmap(0);
  const elapsed = Date.now() - start;
  console.log(`  0 x 4294967295: ${empty?.width}x${empty?.height}, in ${elapsed < 1000 ? 'under a second' : `${elapsed} ms`}`);
  check(empty?.pixels.length === 0 && elapsed < 1000, 'a portrait 0 wide reads at once, with no pixels');

  console.log('== a viewport program ==');
  const interpreter = new BytecodeInterpreter(viewportContextOf({}));
  const hang = thrown(() => interpreter.interpret([Opcode.Jump, 0xfffe], 0, 0));
  console.log(`  a Jump to itself: ${hang?.message.split('\n').join(' ')}`);
  check(hang instanceof Die, 'Interpret ends a program that runs past its step budget in die');

  console.log(`MAX_EXPANDED_SIZE: ${MAX_EXPANDED_SIZE} bytes`);
  finish();
}

main();
