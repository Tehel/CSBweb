/**
 * The champion portraits in the status boxes, for a party that came out of a genuine
 * CSBWin save.
 *
 * `CHARDESC` carries the **picture**, not an index to one: `AddCharacter` blits a cell
 * of basic graphic 26 into the character record once
 * (`doc/CSBwin-src/Character.cpp:487-509`), and every later draw copies those 464 bytes
 * back out with `CharacterPortraitToStatusBox` (`:4661`). A champion restored from a
 * save therefore has pixels and no index at all, where a champion this engine created
 * carries the port's `portraitGraphic` until a save writes the pixels.
 *
 * **Why this is a tool and not a golden frame.** The frames capture a party this port
 * injected, never one read from `csbgame*.dat`, so they cover only the index path; the
 * bug lived entirely in the other one. And `tools/dump-csbwin-load.ts` proves the
 * *decode* (every champion in every committed save is a cell of graphic 26, pixel for
 * pixel) but stops at the engine — it never asks whether anything reaches the screen.
 *
 * So this draws the real status bar into a real 320x200 index buffer and reads the
 * portrait rectangle back out of it, both ways round:
 *
 *   - a party loaded from a CSBWin save must show its `CHARDESC` pixels;
 *   - a champion carrying only `portraitGraphic` must still show that cell of graphic
 *     26, because that is the path every champion created in play takes;
 *   - and one whose `charID` is past 23 shows `CSBgraphics.dat`'s portrait
 *     (`GetExternalPortraitAddress`, `doc/CSBwin-src/Bitmaps.cpp:540`), or CSBWin's
 *     error portrait without one.
 *
 * The canary for `ImportBitmap`'s decode (bottom-up rows, high nibble first, nibbles
 * as palette indices): seven of the portrait sections of both `CSBgraphics.dat` files
 * here are cells of CSB's graphic 26, and must decode to them pixel for pixel.
 *
 * Run: `npm test -- --only=dump-portraits.ts [save]`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { ImageFormat } from '../src/core/imageDecoder';
import { Direction, Position } from '../src/core/types';
import { CSBGraphicsLoader, ERROR_PORTRAIT, getExternalPortraitAddress } from '../src/data/CSBGraphicsLoader';
import { loadCsbwinWorld } from '../src/data/CsbwinDungeonImage';
import {
  PORTRAIT_HEIGHT,
  PORTRAIT_WIDTH,
  readCsbwinCharacter,
  writePortrait,
} from '../src/data/CsbwinCharacters';
import { CHARDESC_SIZE } from '../src/data/CsbwinSaveInfo';
import { buildCsbwinRuntimeState } from '../src/engine/CsbwinSaveGame';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { Party } from '../src/engine/Party';
import type { Champion } from '../src/engine/gameTypes';
import { IndexedBitmap, createPaletteIndexViewportBuffer } from '../src/renderer/csbwin/CanvasBlitter';
import { drawPartyStatus, getPortraitBitmap } from '../src/renderer/ui/Character';
import { type UIState } from '../src/renderer/ui/UIState';
import { check, finish } from './lib/check';
import { newGame, stockDungeon, stockGraphics } from './lib/game';
import { newUIState } from './lib/ui';

const DEFAULT_SAVE = 'tools/fixtures/csbgame7.dat';
const CSB_GRAPHICS = 'static/gamefiles/csb/graphics.dat';
/** The two `CSBgraphics.dat` here, with how many portrait sections each holds. */
const CSB_GRAPHICS_FILES: [string, number][] = [
  ['static/gamefiles/conflux-3.5-b8/CSBgraphics.dat', 156],
  ['tools/fixtures/csbgraphics/CSBgraphics.dat', 197],
];
/** Portrait section → the cell of CSB's graphic 26 it is a copy of, in both files. */
const CSB_CELL_COPIES = '44=14 46=12 47=8 49=4 50=7 146=23 148=22';
/** One of Conflux's heroes' portraits, which are 274, 275 and 276. */
const CONFLUX_HERO_PORTRAIT = 274;

const SCREEN_W = 320;
const SCREEN_H = 200;

/**
 * Where champion `chIdx`'s portrait lands: `chIdx*69+7` by 0, 32 wide and 29 tall
 * (`CharacterPortraitToStatusBox`, `doc/CSBwin-src/Character.cpp:4665-4668`).
 */
function portraitOrigin(chIdx: number): { x: number; y: number } {
  return { x: chIdx * 69 + 7, y: 0 };
}

/** The 32x29 block actually on screen for champion `chIdx`. */
function portraitOnScreen(pixels: Uint8Array, chIdx: number): number[] {
  const { x, y } = portraitOrigin(chIdx);
  const out: number[] = [];
  for (let row = 0; row < PORTRAIT_HEIGHT; row++) {
    for (let col = 0; col < PORTRAIT_WIDTH; col++) out.push(pixels[(y + row) * SCREEN_W + x + col] ?? 0);
  }
  return out;
}

function main(): void {
  const savePath = process.argv[2] ?? DEFAULT_SAVE;

  const graphics = stockGraphics();
  const data = stockDungeon();

  const cache = new Map<string, IndexedBitmap>();
  const ui: UIState = newUIState(graphics, newGame(data, graphics).ctx, {
    // The real one, off `graphics.dat`: the fallback path has to find graphic 26.
    getGraphicBitmap: (graphicNum: number, format: ImageFormat = ImageFormat.IMG1) => {
      const key = `${graphicNum}-${format}`;
      const hit = cache.get(key);
      if (hit) return hit;
      try {
        const decoded = graphics.getImage(graphicNum, format);
        const bmp: IndexedBitmap = {
          width: decoded.width,
          height: decoded.height,
          pixels: decoded.pixels instanceof Uint8Array
            ? decoded.pixels
            : Uint8Array.from(decoded.pixels as ArrayLike<number>),
        };
        cache.set(key, bmp);
        return bmp;
      } catch {
        return null;
      }
    },
  });

  /** Draw the whole status bar with `chIdx`'s inventory open, and hand back the screen. */
  function render(champions: Champion[], chIdx: number): Uint8Array {
    const party = new Party(new Position(1, 1, 0), Direction.NORTH);
    for (const champion of champions) party.addChampion(champion);
    // `inventoryOpen = ((chIdx+1) == d.SelectedCharacterOrdinal)` (`:1258`) — the
    // portrait goes to the status box only for the champion whose inventory is open.
    party.state.selectedCharacterIndex = chIdx;
    ui.ctx.party.state = party.state;
    const buffer = createPaletteIndexViewportBuffer(SCREEN_W, SCREEN_H, 0);
    ui.screenIndexBuffer = buffer;
    drawPartyStatus(ui);
    return buffer.pixels;
  }

  /* ---- 1. the party out of a real CSBWin save -------------------------------- */

  const world = loadCsbwinWorld(new Uint8Array(readFileSync(resolve(savePath))));
  const loaded = buildCsbwinRuntimeState(world).party.champions;
  check(loaded.length > 0, `${savePath} should carry champions`);

  console.log(`=== ${savePath.split('/').pop()} — portraits out of CHARDESC ===`);
  console.log(['champion', 'pixels', 'colours', 'on screen'].join('\t'));
  for (let chIdx = 0; chIdx < loaded.length; chIdx++) {
    const champion = loaded[chIdx];
    const want = champion.portrait ?? [];
    check(
      want.length === PORTRAIT_WIDTH * PORTRAIT_HEIGHT,
      `${champion.name}: restored with a 32x29 portrait`,
    );
    check(
      champion.portraitGraphic === undefined,
      `${champion.name}: and with no graphic-26 index, which CHARDESC does not carry`,
    );
    const got = portraitOnScreen(render(loaded, chIdx), chIdx);
    const colours = new Set(want).size;
    const same = want.length > 0 && got.every((v, i) => v === want[i]);
    console.log([champion.name, want.length, colours, same ? 'matches' : 'WRONG'].join('\t'));
    check(same, `${champion.name}: the status box shows the portrait CHARDESC carries`);
    // The vacuity guard: an all-background block would "match" a portrait this port
    // failed to read, and that is exactly the bug this tool exists for.
    check(colours > 2, `${champion.name}: the portrait is a picture, not a flat block`);
  }

  /* ---- 2. and the path every champion created in play takes ------------------ */

  console.log('\n=== the portraitGraphic fallback, for champions this port creates ===');
  const withIndex: Champion = {
    ...loaded[0],
    name: 'INDEXED',
    portrait: undefined,
    portraitGraphic: 7,
  };
  const cell = getPortraitBitmap(ui, 7);
  check(cell !== null, 'graphic 26 yields cell 7');
  const drawn = portraitOnScreen(render([withIndex], 0), 0);
  const matchesCell = cell !== null && drawn.every((v, i) => v === cell.pixels[i]);
  console.log(`cell 7 drawn from the sheet: ${matchesCell ? 'matches' : 'WRONG'}`);
  check(matchesCell, 'a champion carrying only portraitGraphic still draws its sheet cell');
  check(
    new Set(drawn).size > 2,
    'and that cell is a picture too',
  );

  // And the save writer's side of the same path. `CHARDESC` holds bitplanes, so a
  // champion created in play — who carries the index — has their portrait resolved
  // here and packed by `writePortrait`; `ViewportRenderer.portraitPixelsFor` is this
  // lookup plus an `Array.from`. Pack the pixels and read them back.
  const packed = new Uint8Array(CHARDESC_SIZE);
  writePortrait(packed, 0, cell ? Array.from(cell.pixels) : undefined);
  const unpacked = readCsbwinCharacter(packed, 0).champion.portrait ?? [];
  check(
    cell !== null && unpacked.length === cell.pixels.length &&
      unpacked.every((v, i) => v === cell.pixels[i]),
    'the cell packs into CHARDESC bitplanes and reads back unchanged',
  );

  /* ---- 3. a charID past 23: CSBgraphics.dat's portraits ----------------------- */

  console.log('\n=== external portraits, charID > 23 ===');
  const csbSheet = graphicsSheetCells(CSB_GRAPHICS);
  let conflux: CSBGraphicsLoader | null = null;
  for (const [path, sections] of CSB_GRAPHICS_FILES) {
    const csbGraphics = new CSBGraphicsLoader();
    csbGraphics.loadFromArray(new Uint8Array(readFileSync(resolve(path))));
    conflux ??= csbGraphics;
    let read = 0;
    let sized = 0;
    const copies: string[] = [];
    for (let index = 0; index < 1000; index++) {
      const bitmap = csbGraphics.importBitmap(index);
      if (!bitmap) continue;
      read++;
      if (bitmap.width === PORTRAIT_WIDTH && bitmap.height === PORTRAIT_HEIGHT) sized++;
      const cell = csbSheet.indexOf(Array.from(bitmap.pixels).join(','));
      if (cell >= 0) copies.push(`${index}=${cell}`);
    }
    console.log(`${path}: ${read} portraits, ${sized} of them 32x29; cells of CSB's graphic 26: ${copies.join(' ')}`);
    check(read === sections && sized === sections, `${path}: all ${sections} portrait sections read, at 32x29`);
    check(copies.join(' ') === CSB_CELL_COPIES, `${path}: the sections that copy CSB's graphic 26 decode to its cells`);
  }
  if (!conflux) throw new Error('no CSBgraphics.dat');

  console.log('the error portrait:');
  for (let y = 0; y < ERROR_PORTRAIT.height; y++) {
    let line = '';
    for (let x = 0; x < ERROR_PORTRAIT.width; x++) line += ERROR_PORTRAIT.pixels[y * ERROR_PORTRAIT.width + x] === 2 ? '.' : '#';
    console.log(`  ${line}`);
  }
  const errorColours = new Set(ERROR_PORTRAIT.pixels);
  check(
    errorColours.size === 2 && errorColours.has(0) && errorColours.has(2),
    'the error portrait is colour 0 on colour 2, as `errorPortraitBitmap`\'s planes give',
  );
  check(getExternalPortraitAddress(null, CONFLUX_HERO_PORTRAIT) === ERROR_PORTRAIT,
    'without CSBgraphics.dat, a portrait past 23 is the error portrait');
  check(getExternalPortraitAddress(conflux, 999) === ERROR_PORTRAIT,
    'and so is a portrait section the file does not hold');

  const external = getExternalPortraitAddress(conflux, CONFLUX_HERO_PORTRAIT);
  check(external !== ERROR_PORTRAIT && new Set(external.pixels).size > 2,
    `Conflux's portrait ${CONFLUX_HERO_PORTRAIT} is a picture`);
  check(
    conflux.importBitmap(CONFLUX_HERO_PORTRAIT)?.pixels.every((v, i) => v === external.pixels[i]) === true,
    'GetExternalPortraitAddress gives ImportBitmap\'s picture',
  );
  check(getExternalPortraitAddress(conflux, CONFLUX_HERO_PORTRAIT) === external, 'and caches it by index');

  const hero: Champion = { ...withIndex, name: 'EXTERNAL', portraitGraphic: CONFLUX_HERO_PORTRAIT };
  const noFile = portraitOnScreen(render([hero], 0), 0);
  check(noFile.every((v, i) => v === ERROR_PORTRAIT.pixels[i]),
    'a champion with charID past 23 and no CSBgraphics.dat shows the error portrait');
  ui.context.csbGraphics = conflux;
  const onScreen = portraitOnScreen(render([hero], 0), 0);
  const shown = onScreen.every((v, i) => v === external.pixels[i]);
  console.log(`portrait ${CONFLUX_HERO_PORTRAIT} in the status box: ${shown ? 'matches' : 'WRONG'}`);
  check(shown, `a champion with charID ${CONFLUX_HERO_PORTRAIT} shows Conflux's portrait in the status box`);

  finish();
}

/** The 24 cells of `graphicsPath`'s graphic 26, each as its pixels joined. */
function graphicsSheetCells(graphicsPath: string): string[] {
  const graphics = new GraphicsLoader();
  graphics.loadFromArray(new Uint8Array(readFileSync(resolve(graphicsPath))));
  const sheet = graphics.getImage(26, ImageFormat.IMG1);
  const cells: string[] = [];
  for (let cell = 0; cell < 24; cell++) {
    const pixels: number[] = [];
    for (let y = 0; y < PORTRAIT_HEIGHT; y++) {
      for (let x = 0; x < PORTRAIT_WIDTH; x++) {
        pixels.push(sheet.pixels[(29 * (cell >> 3) + y) * sheet.width + ((cell & 7) << 5) + x] ?? 0);
      }
    }
    cells.push(pixels.join(','));
  }
  return cells;
}

main();
