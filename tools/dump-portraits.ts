/**
 * The champion portraits in the status boxes, for a party that came out of a genuine
 * CSBWin save.
 *
 * `CHARDESC` carries the **picture**, not an index to one: `AddCharacter` blits a cell
 * of basic graphic 26 into the character record once
 * (`doc/CSBwin-src/Character.cpp:486-508`), and every later draw copies those 464 bytes
 * back out with `CharacterPortraitToStatusBox` (`:4644`). A champion restored from a
 * save therefore has pixels and no index at all — which is why a loaded party used to
 * show four empty boxes while a quick-saved one, whose champions still carried this
 * port's `portraitGraphic`, drew correctly.
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
 *     26, because that is the path every champion created in play takes.
 *
 * Run: `npx tsx tools/dump-portraits.ts [save]`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { ImageFormat } from '../src/core/imageDecoder';
import { Direction, Position } from '../src/core/types';
import { loadCsbwinWorld } from '../src/data/CsbwinDungeonImage';
import {
  PORTRAIT_HEIGHT,
  PORTRAIT_WIDTH,
  readCsbwinCharacter,
  writePortrait,
} from '../src/data/CsbwinCharacters';
import { CHARDESC_SIZE } from '../src/data/CsbwinSaveInfo';
import { buildCsbwinRuntimeState } from '../src/data/CsbwinSaveGame';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { DungeonState } from '../src/engine/DungeonState';
import { Party } from '../src/engine/Party';
import type { Champion } from '../src/engine/gameTypes';
import { IndexedBitmap, createPaletteIndexViewportBuffer } from '../src/renderer/csbwin/CanvasBlitter';
import { loadFontData } from '../src/renderer/csbwin/TextRenderer';
import { extractUITables } from '../src/renderer/csbwin/UITables';
import { drawPartyStatus, getPortraitBitmap } from '../src/renderer/ui/Character';
import { createUIState, type UIState } from '../src/renderer/ui/UIState';
import { check, finish } from './lib/check';

const DUNGEON = 'static/gamefiles/dm-atari/dungeon.dat';
const GRAPHICS = 'static/gamefiles/dm-atari/graphics.dat';
const DEFAULT_SAVE = 'static/gamefiles/saves/csbgame.dat';

const SCREEN_W = 320;
const SCREEN_H = 200;

/**
 * Where champion `chIdx`'s portrait lands: `chIdx*69+7` by 0, 32 wide and 29 tall
 * (`CharacterPortraitToStatusBox`, `doc/CSBwin-src/Character.cpp:4648-4651`).
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

  const graphics = new GraphicsLoader();
  graphics.loadFromArray(new Uint8Array(readFileSync(resolve(GRAPHICS))));
  const data = new DungeonLoader().loadFromArray(new Uint8Array(readFileSync(resolve(DUNGEON))));

  const dungeon = new DungeonState(data);
  const cache = new Map<string, IndexedBitmap>();
  const ui: UIState = createUIState(graphics, dungeon, {
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
    renderLastFrame: () => {},
  });
  ui.uiTables = extractUITables(graphics);
  ui.fontData = loadFontData(graphics);

  /** Draw the whole status bar with `chIdx`'s inventory open, and hand back the screen. */
  function render(champions: Champion[], chIdx: number): Uint8Array {
    const party = new Party(new Position(1, 1, 0), Direction.NORTH);
    for (const champion of champions) party.addChampion(champion);
    // `inventoryOpen = ((chIdx+1) == d.SelectedCharacterOrdinal)` (`:1253`) — the
    // portrait goes to the status box only for the champion whose inventory is open.
    party.state.selectedCharacterIndex = chIdx;
    ui.partyState = party.state;
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

  finish();
}

main();
