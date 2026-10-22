/**
 * The viewport overlay's engine half, on Conflux 3.5's
 * `CSBgraphics.dat`: what `&OVERLAY`, `&PALETTE` and `&JITTER` change, the overlay's end,
 * and its travel in a save's Extended Features block. What the screen does with it is
 * `tools/dump-overlay-screen.ts`'s.
 *
 * 1. **`ReadOverlay`** (`doc/CSBwin-src/Bitmaps.cpp:572-630`): overlay 1, a 224x136
 *    bitmap of 256 colours, is its file's pixel bytes and colours, as stored. A missing
 *    one reads nothing, and says "Cannot find overlay" once.
 * 2. **`&OVERLAY`** (`DSA.cpp:2920-2931`, `SelectOverlay`, `Bitmaps.cpp:687-720`): pops
 *    the overlay number, then `p4` to `p1`, reads the overlay and draws it; `p3` is its
 *    end, from `d.Time`. Bit 1 of `p1` mirrors each line, and turned off again mirrors it
 *    back without a read. A missing overlay is not drawn.
 * 3. **The end** (`CSBCode.cpp:685`): the tick after `d.Time` passes `m_p3` puts it down.
 * 4. **`&PALETTE`** (`DSA.cpp:2933-2945`, `SetOverlayPalette`, `Bitmaps.cpp:651-685`):
 *    pops the density, the number and two words it does not read. Density 100 makes the
 *    overlay palette section 1's 512 RGB555 words, each 5-bit intensity widened to 8;
 *    density 50 blends half of it into what was there, rounded; a negative number gives
 *    the identity back (`ClearOverlayPalette`).
 * 5. **`&JITTER`** (`DSA.cpp:4904-4931`): pops `yOverlay`, `xOverlay`, `yGraphic`,
 *    `xGraphic`.
 * 6. **A save** (`SaveGame.cpp:993-1001`, read back at `:425-438`): a game never shown an
 *    overlay writes ordinal 0 and the flag clear; one shown overlay 5 mirrored writes
 *    `OverlayActive`, ordinal 6 and its parameters, its end as a `d.Time`, and a load
 *    selects it again, mirrored, ending at the same `d.Time`. An overlay that has ended is
 *    saved without the flag and comes back up at the load, until the next tick.
 * 7. **`ReadCSBgraphic`'s first failure** (`Graphics.cpp:3247-3255`, `:3280-3289`): a file
 *    that will not open puts the overlay down, at its first failure only; a missing
 *    section first, and it never does.
 *
 * Run: `npm test -- --only=dump-dsa-overlay.ts`
 */
import { readFileSync } from 'node:fs';

import { CSBGraphicsLoader, CSBGraphicType } from '../src/data/CSBGraphicsLoader';
import { EF_EXTENDED_FLAGS } from '../src/data/CsbwinExtendedFeatures';
import { loadSaveGameState } from '../src/data/SaveGameLoader';
import { readU16LE, readU32LE } from '../src/core/bytes';
import { applyCsbwinSave } from '../src/engine/CsbwinSaveGame';
import { StkOp } from '../src/engine/dsa/DsaTypes';
import type { Game } from '../src/engine/Game';
import { Overlay, OVERLAY_HEIGHT, OVERLAY_WIDTH } from '../src/engine/Overlay';
import { identityOverlayPalette } from '../src/engine/OverlayPalette';
import { buildSaveFile } from '../src/engine/SaveGameFile';
import { freshGame, globalStore, int, op, run } from './lib/dsa';
import { newGame, runVbl, stockGraphics, TICK_DUE, stockDungeon } from './lib/game';
import { check, finish } from './lib/check';

const conflux = new CSBGraphicsLoader();
conflux.loadFromArray(new Uint8Array(readFileSync('tools/fixtures/gamefiles/conflux-3.5-b8/CSBgraphics.dat')));
const section1 = conflux.readSection(CSBGraphicType.ViewportOverlay, 1, 0)!;
const PIXELS = 14 + 40 + 4 * 256;
const filePixels = section1.subarray(PIXELS, PIXELS + OVERLAY_WIDTH * OVERLAY_HEIGHT);
const mirrored = (pixels: Uint8Array): Uint8Array => {
  const out = new Uint8Array(pixels.length);
  for (let line = 0; line < OVERLAY_HEIGHT; line++) {
    for (let x = 0; x < OVERLAY_WIDTH; x++) {
      out[line * OVERLAY_WIDTH + x] = pixels[line * OVERLAY_WIDTH + OVERLAY_WIDTH - 1 - x]!;
    }
  }
  return out;
};
const equal = (a: ArrayLike<number> | null, b: ArrayLike<number>): boolean =>
  a !== null && a.length === b.length && Array.prototype.every.call(a, (v: number, i: number) => v === b[i]);
const withConflux = (game: Game): void => { game.ctx.overlay.csbGraphics = conflux; };
/** A program that leaves a sentinel under the operation's operands, then stores it in global 0. */
const balanced = (operands: number[], subcode: number): number[] =>
  [...int(99), ...operands.flatMap((v) => int(v)), op(subcode), globalStore(0)];

console.log('1. ReadOverlay');
{
  const traced: string[] = [];
  const overlay = new Overlay(identityOverlayPalette(), (line) => traced.push(line));
  overlay.csbGraphics = conflux;
  const read = overlay.ReadOverlay(1);
  const colours = Array.from({ length: 256 }, (_, i) => readU32LE(section1, 14 + 40 + 4 * i));
  console.log(`  overlay 1: ${readU32LE(section1, 18)}x${readU32LE(section1, 22)}, read ${read}`);
  check(read && equal(overlay.current.overlay, filePixels) && equal(overlay.current.overlayPalette, colours),
    "overlay 1 is its file's pixel bytes and colours, as stored");
  const missing = [overlay.ReadOverlay(999), overlay.ReadOverlay(998)];
  console.log(`  overlays 999 and 998: read ${missing.join(', ')}, said ${JSON.stringify(traced)}`);
  check(!missing[0] && !missing[1] && traced.length === 1 && traced[0] === 'Cannot find overlay',
    'a missing overlay reads nothing, and says so once');
}

console.log('2. &OVERLAY');
{
  const { game, g } = run(balanced([1, 40, 20, 7, 3], StkOp.OVERLAY), withConflux);
  const o = game.ctx.overlay;
  const time = game.ctx.state.tickCount;
  const c = o.current;
  console.log(`  1, 40, 20, 7, overlay 3 at d.Time ${time}: active ${o.active}, number ${c.overlayNumber},` +
    ` p1-p4 ${c.p1} ${c.p2} ${c.p3} ${c.p4}, sentinel ${g[0]}`);
  check(o.active && c.overlayNumber === 3 && c.p1 === 1 && c.p2 === 40 && c.p3 === time + 20 && c.p4 === 7 && g[0] === 99,
    'pops the number and p4 to p1, draws overlay 3, ending 20 ticks on');

  const shown = run([...[2, 0, 0, 0, 1].flatMap((v) => int(v)), op(StkOp.OVERLAY)], withConflux);
  const pixels = shown.game.ctx.overlay.current.overlay!;
  const isMirrored = equal(pixels, mirrored(filePixels));
  let reads = 0;
  shown.game.ctx.overlay.csbGraphics = {
    readSection: (type, id, min) => { reads++; return conflux.readSection(type, id, min); },
  };
  shown.again();
  // `run`'s second pass reruns the same program: p1 is 2 again, so nothing changes. Then 0.
  shown.game.ctx.overlay.SelectOverlay(1, 0, 0, 0, 0, shown.game.ctx.state.tickCount);
  const back = equal(shown.game.ctx.overlay.current.overlay, filePixels);
  console.log(`  overlay 1 with p1 2: mirrored ${isMirrored}; again, then p1 0: back ${back}, ${reads} reads`);
  check(isMirrored && back && reads === 0, "bit 1 of p1 mirrors each line, and turned off mirrors it back without a read");

  const missing = run([...[0, 0, 0, 0, 999].flatMap((v) => int(v)), op(StkOp.OVERLAY)], (game) => {
    withConflux(game);
    game.ctx.overlay.active = true;
  });
  console.log(`  overlay 999: active ${missing.game.ctx.overlay.active}`);
  check(!missing.game.ctx.overlay.active, 'a missing overlay is not drawn');
}

console.log('3. The end');
{
  const game = freshGame();
  withConflux(game);
  game.ctx.overlay.SelectOverlay(1, 0, 0, 3, 0, game.ctx.state.tickCount);
  const end = game.ctx.overlay.current.p3;
  const seen: string[] = [];
  for (let i = 0; i < 5; i++) {
    runVbl(game, TICK_DUE);
    seen.push(`${game.ctx.state.tickCount}:${game.ctx.overlay.active ? 'up' : 'down'}`);
  }
  console.log(`  ends after ${end}: ${seen.join(' ')}`);
  const downAt = seen.findIndex((s) => s.endsWith('down'));
  check(downAt > 0 && Number(seen[downAt]!.split(':')[0]) === end + 1 && seen.slice(downAt).every((s) => s.endsWith('down')),
    'the tick that takes d.Time past m_p3 puts it down, for good');
}

console.log('4. &PALETTE');
{
  const words = conflux.readSection(CSBGraphicType.OverlayPalette, 1, 1024)!;
  const widen = (word: number, shift: number): number => {
    const i = (shift >= 0 ? word >> shift : word << -shift) & 0xf8;
    return i | (i >> 5);
  };
  const expected = new Uint8Array(1536);
  for (let i = 0; i < 512; i++) {
    const word = readU16LE(words, 2 * i);
    expected[i] = widen(word, 7);
    expected[512 + i] = widen(word, 2);
    expected[1024 + i] = widen(word, -3);
  }
  const identity = identityOverlayPalette();
  const at = expected.findIndex((v, i) => v !== identity[i] && i < 512);
  const full = run(balanced([5, 6, 1, 100], StkOp.PALETTE), withConflux);
  const palette = full.game.ctx.overlayPalette;
  console.log(`  section 1 at 100: entry 0x${at.toString(16)}, word 0x${readU16LE(words, 2 * at).toString(16)},` +
    ` red ${palette[at]}, green ${palette[512 + at]}, blue ${palette[1024 + at]}; sentinel ${full.g[0]}`);
  check(equal(palette, expected) && full.g[0] === 99, "density 100 is the section's words, widened, and four words are popped");

  const half = run([...[0, 0, 1, 50].flatMap((v) => int(v)), op(StkOp.PALETTE)], withConflux);
  const blended = Array.from(identity, (v, i) => Math.trunc((v * 50 + expected[i]! * 50 + 50) / 100));
  console.log(`  at 50 over the identity: red at 0x${at.toString(16)} ${half.game.ctx.overlayPalette[at]} (${identity[at]} and ${expected[at]})`);
  check(equal(half.game.ctx.overlayPalette, blended), 'density 50 blends half of it into what was there, rounded');

  const cleared = run([...[0, 0, -1, 0].flatMap((v) => int(v)), op(StkOp.PALETTE)], (game) => game.ctx.overlayPalette.fill(7));
  check(equal(cleared.game.ctx.overlayPalette, identity), 'a negative number gives the identity back');
}

console.log('5. &JITTER');
{
  const { game, g } = run(balanced([1, 2, 3, 4], StkOp.JITTER));
  const o = game.ctx.overlay;
  console.log(`  1, 2, 3, 4: graphic ${o.xGraphicJitter},${o.yGraphicJitter}, overlay ${o.xOverlayJitter},${o.yOverlayJitter}; sentinel ${g[0]}`);
  check(o.xGraphicJitter === 1 && o.yGraphicJitter === 2 && o.xOverlayJitter === 3 && o.yOverlayJitter === 4 && g[0] === 99,
    'pops yOverlay, xOverlay, yGraphic, xGraphic');
}

console.log('6. A save');
{
  const loadInto = (file: Uint8Array): Game => {
    const game = newGame(stockDungeon(), stockGraphics());
    withConflux(game);
    applyCsbwinSave(game, file);
    return game;
  };
  const efbOf = (file: Uint8Array) => loadSaveGameState(file).extendedFeatures!;

  const none = efbOf(buildSaveFile(freshGame()));
  console.log(`  never shown one: ordinal ${none.overlayOrdinal}, flags 0x${none.extendedFlags.toString(16)}`);
  check(none.overlayOrdinal === 0 && (none.extendedFlags & EF_EXTENDED_FLAGS.OverlayActive) === 0,
    'a game never shown an overlay writes ordinal 0 and the flag clear');

  const game = freshGame();
  withConflux(game);
  game.ctx.state.tickCount = 1000;
  game.ctx.overlay.SelectOverlay(5, 3, 40, 500, 9, game.ctx.state.tickCount);
  const file = buildSaveFile(game);
  const efb = efbOf(file);
  console.log(`  overlay 5 shown: ordinal ${efb.overlayOrdinal}, p1-p4 ${efb.overlayP1} ${efb.overlayP2} ${efb.overlayP3} ${efb.overlayP4},` +
    ` flags 0x${efb.extendedFlags.toString(16)}`);
  check(efb.overlayOrdinal === 6 && efb.overlayP1 === 3 && efb.overlayP2 === 40 && efb.overlayP3 === 1500 && efb.overlayP4 === 9 &&
    (efb.extendedFlags & EF_EXTENDED_FLAGS.OverlayActive) !== 0, 'writes OverlayActive, ordinal 6 and its parameters, the end a d.Time');
  const loaded = loadInto(file);
  const c = loaded.ctx.overlay.current;
  console.log(`  loaded: active ${loaded.ctx.overlay.active}, number ${c.overlayNumber}, p1-p4 ${c.p1} ${c.p2} ${c.p3} ${c.p4}`);
  check(loaded.ctx.overlay.active && c.overlayNumber === 5 && c.p1 === 3 && c.p2 === 40 && c.p3 === 1500 && c.p4 === 9 &&
    equal(c.overlay, game.ctx.overlay.current.overlay!), 'a load selects it again, mirrored, ending at the same d.Time');

  game.ctx.state.tickCount = 2000;
  game.ctx.overlay.expire(game.ctx.state.tickCount);
  const ended = buildSaveFile(game);
  const endedEfb = efbOf(ended);
  const back = loadInto(ended);
  const upAtLoad = back.ctx.overlay.active;
  runVbl(back, TICK_DUE);
  console.log(`  ended: flag ${(endedEfb.extendedFlags & 1) !== 0}; loaded ${upAtLoad ? 'up' : 'down'}, then ${back.ctx.overlay.active ? 'up' : 'down'}` +
    ` at d.Time ${back.ctx.state.tickCount}`);
  check((endedEfb.extendedFlags & EF_EXTENDED_FLAGS.OverlayActive) === 0 && upAtLoad && !back.ctx.overlay.active,
    'an ended overlay is saved without the flag, comes back up at the load, and goes down at the next tick');
}

console.log('7. ReadCSBgraphic\'s first failure');
{
  const closed = (): { loader: CSBGraphicsLoader; said: () => number } => {
    const loader = new CSBGraphicsLoader();
    let n = 0;
    loader.opener = () => false;
    loader.cannotOpen = () => { n++; };
    return { loader, said: () => n };
  };
  const a = closed();
  const overlay = new Overlay(identityOverlayPalette(), () => {});
  overlay.csbGraphics = a.loader;
  overlay.active = true;
  a.loader.cannotOpen = () => { overlay.active = false; };
  overlay.SetOverlayPalette(1, 100);
  const down = !overlay.active;
  overlay.active = true;
  overlay.SetOverlayPalette(1, 100);
  console.log(`  a file that will not open: down at the first read ${down}, at the second ${!overlay.active}`);
  check(down && overlay.active, 'puts the overlay down at its first failure only');

  const b = closed();
  b.loader.loadFromArray(new Uint8Array(readFileSync('tools/fixtures/gamefiles/conflux-3.5-b8/CSBgraphics.dat')));
  b.loader.opener = () => true;
  b.loader.readSection(CSBGraphicType.OverlayPalette, 999, 0);
  b.loader.opener = () => false;
  b.loader.opened = false;
  b.loader.readSection(CSBGraphicType.OverlayPalette, 1, 0);
  console.log(`  a missing section first: cannotOpen called ${b.said()} times`);
  check(b.said() === 0, 'a missing section first, and it never does');
}

finish();
