/**
 * The title animation and the dungeon entrance — everything about them the golden frames
 * cannot see.
 *
 * `tools/check-frames.sh` can prove the entrance screen's *pixels* once it is up. What it
 * cannot see, and what each of these could get wrong while still looking plausible:
 *
 * 1. **The rectangle offsets.** Nine `WordRect`s are read out of `graphics.dat` item 0x232
 *    by a parser that walks the whole item field by field; drift by one field and every
 *    rectangle is still a rectangle, just in the wrong place. They are asserted here
 *    against the sizes CSBWin's own `allocateMemory` calls and blit widths demand — the
 *    canary technique. Item 0x232 is 1826 bytes and the rectangles are its last 136, so a
 *    drift anywhere upstream lands here.
 * 2. **The button list.** Dungeon Master's `graphics.dat` stops 48 bytes short of carrying
 *    `d.Buttons16932`, and CSBWin patches in a hardcoded copy. If that fallback were wrong
 *    the entrance would simply not respond to clicks, with nothing on screen to say why.
 * 3. **The synthetic prison level.** A 5x5 cell-flag array with one wrong byte still
 *    renders *a* corridor.
 * 4. **The door-slide arithmetic.** Thirty-one frames of two rectangles walking in
 *    opposite directions, with a sub-word shift carried in a separate buffer index. Off by
 *    one and the doors stop a few pixels short, or the left half vanishes early.
 * 5. **`ShrinkBLT`'s fixed point.** Which source column each of the 48 destination columns
 *    lands on, at eighteen different scales.
 * 6. **The Timer-A mapping.** The two sound pitches the doors use are the argument CSBWin
 *    throws away; this port turns them back into rates, and nothing on screen would show
 *    the mapping had inverted.
 *
 * The compositing in 4 is run for real — `loadAssets`, `drawPrisonDoor` and
 * `openPrisonDoors` against the real `graphics.dat`, into a real buffer — and the result
 * inspected pixel by pixel. Only `drawPrisonInterior` is stubbed, with a flat colour no
 * artwork uses, so "the doorway shows the dungeon" is a checkable claim.
 *
 * Run: `npm test -- --only=dump-intro.ts`
 */
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { ratesDefault } from '../src/audio/soundsIndex';
import { buildSoundCatalog } from '../src/audio/soundsIndex';
import { SoundIndex } from '../src/core/constants';
import { cellHasObjects, getRoomType } from '../src/core/types';
import {
  createPaletteIndexViewportBuffer,
  shrinkBlt,
  type IndexedBitmap,
} from '../src/renderer/csbwin/CanvasBlitter';
import { loadFontData } from '../src/renderer/csbwin/TextRenderer';
import { decodeCursorBitmap, type UITables } from '../src/data/tables/UITables';
import { searchButtonList } from '../src/renderer/ui/HitTest';
import { SCREEN_HEIGHT, SCREEN_WIDTH, VIEWPORT_HEIGHT, VIEWPORT_WIDTH } from '../src/renderer/ViewportGraphics';
import {
  CURSOR_TRANSPARENT,
  createIndexedBitmap,
  fadeToPalette,
  PALETTE_11914,
  timerDataToRateIndex,
  withCursor,
  type IntroHost,
} from '../src/renderer/intro/IntroHost';
import {
  DOOR_SLOT_HEIGHT,
  DOOR_SLOT_WIDTH,
  DOOR_STEPS,
  INTERIOR_SCREEN_Y,
  MISSING_PRISON_DOOR_BUTTONS,
  drawPrisonDoor,
  loadAssets,
  openPrisonDoors,
} from '../src/renderer/intro/PrisonDoor';
import {
  ZOOM_CENTRE_HEIGHT,
  ZOOM_FIRST_HEIGHT,
  ZOOM_FIRST_WIDTH,
  ZOOM_FRAMES,
  ZOOM_HEIGHT_STEP,
  ZOOM_WIDTH_STEP,
} from '../src/renderer/intro/TitleSequence';
import { showTitlePicture, TITLE_PICTURE_HOLD_VBLS } from '../src/renderer/intro/TitlePicture';
import {
  PRISON_LEVEL_INDEX,
  PRISON_LEVEL_SIZE,
  PRISON_PARTY_POSITION,
  createPrisonDungeonState,
  prisonCellFlags,
} from '../src/renderer/intro/PrisonLevel';
import { check, finish } from './lib/check';
import { graphicsTablesOf, stockGraphics } from './lib/game';

/** A palette index no entrance artwork uses, so the stubbed corridor is identifiable. */
const INTERIOR_MARKER = 7;

function loadGraphics(): GraphicsLoader {
  return stockGraphics();
}

function size(rect: { x1: number; x2: number; y1: number; y2: number }): string {
  return `${rect.x2 - rect.x1 + 1}x${rect.y2 - rect.y1 + 1} at (${rect.x1},${rect.y1})`;
}

/* --------------------------------------------------- 1. the rectangle offsets ---- */

/**
 * Each rectangle is checked against something CSBWin states independently of the table:
 * an `allocateMemory` size, a `SrcByteWidth` argument, or the screen geometry.
 */
function checkRectangles(ui: UITables): void {
  const g = ui.graphic232;
  console.log('=== graphics.dat 0x232, the intro rectangles ===');
  for (const [name, rect] of [
    ['Word36  (title "Master" lands)', g.word36],
    ['Word44  ("Master" stashed)', g.word44],
    ['Word52  ("Presents")', g.word52],
    ['Word60  (viewport into the door buffer)', g.word60],
    ['Word68  (left door, sliding)', g.word68],
    ['Word76  (right door, sliding)', g.word76],
    ['Word84  (entrance interior saved)', g.word84],
    ['Word92  (left door, static)', g.word92],
    ['Word100 (right door, static)', g.word100],
  ] as const) {
    console.log(`  ${name.padEnd(40)} ${size(rect)}`);
  }

  // `d.Pointer22920 = allocateMemory(20608,0)` (`doc/CSBwin-src/CSBCode.cpp:9603`) and the
  // copy-out loop runs 161 scanlines of 112+4*2 bytes (`:9554-9565`): 232x161 pixels.
  check(
    g.word84.x1 === 0 && g.word84.x2 === 231 && g.word84.y1 === 0 && g.word84.y2 === 160,
    `Word84 saves 232x161 to match the 20608-byte interior buffer (got ${size(g.word84)})`,
  );

  // `TAG0088b2(d.pViewportBMP, …, d.Word60, 0, 0, 112, 128, -1)` (`:9519`) — 112 bytes per
  // line is 224 pixels, and the viewport is 224x136.
  check(
    g.word60.x2 - g.word60.x1 + 1 === VIEWPORT_WIDTH && g.word60.y2 - g.word60.y1 + 1 === VIEWPORT_HEIGHT,
    `Word60 is the viewport's own ${VIEWPORT_WIDTH}x${VIEWPORT_HEIGHT} (got ${size(g.word60)})`,
  );

  // The two static halves must tile the interior exactly, with no seam and no overlap.
  check(
    g.word92.x1 === 0 && g.word100.x1 === g.word92.x2 + 1 && g.word100.x2 === g.word84.x2,
    `Word92 and Word100 tile 0..${g.word84.x2} (got ${g.word92.x1}..${g.word92.x2} then ${g.word100.x1}..${g.word100.x2})`,
  );
  check(
    g.word92.y1 === INTERIOR_SCREEN_Y && g.word92.y2 === g.word100.y2,
    `both static halves sit at screen row ${INTERIOR_SCREEN_Y} (got ${g.word92.y1} and ${g.word100.y1})`,
  );
  check(
    g.word92.y2 - g.word92.y1 + 1 === DOOR_SLOT_HEIGHT,
    `the static halves are ${DOOR_SLOT_HEIGHT} scanlines, the door bitmaps' own height`,
  );

  // The three title bands are full-screen-width blits out of graphic 1.
  for (const [name, rect] of [['Word36', g.word36], ['Word44', g.word44], ['Word52', g.word52]] as const) {
    check(rect.x1 === 0 && rect.x2 === SCREEN_WIDTH - 1, `${name} spans the full screen width (got ${size(rect)})`);
  }
  // `pGraphic += 9120; // =57 * 160` (`doc/CSBwin-src/CSBCode.cpp:9376`).
  check(g.word44.y2 - g.word44.y1 + 1 === 57, `Word44 is the 57 scanlines CSBWin budgets 9120 bytes for`);
  check(
    g.word36.y2 - g.word36.y1 + 1 === g.word44.y2 - g.word44.y1 + 1,
    'Word36 and Word44 are the same band, stashed and replaced',
  );
  check(g.word36.y2 < SCREEN_HEIGHT, 'the final "Master" band fits on screen');

  // The sliding rectangles must start where the static ones leave the doors.
  check(
    g.word68.x1 === 0 && g.word68.x2 === 100 && g.word76.x1 === 109 && g.word76.x2 === g.word84.x2,
    `the sliding halves start at 0..${g.word68.x2} and ${g.word76.x1}..${g.word76.x2}`,
  );
}

/* -------------------------------------------------------- 2. the button list ---- */

function checkButtons(ui: UITables): void {
  const extracted = ui.graphic231.buttons.buttons16932;
  console.log('\n=== d.Buttons16932 ===');
  console.log(`  extracted from item 0x231: ${extracted.length} entries`);

  // `ASSERT(size == 0x804 || size == 0x7d4)` (`doc/CSBwin-src/CSBCode.cpp:10266`); the
  // short one is missing exactly the four 12-byte buttons.
  check(extracted.length === 0, 'DM\'s item 0x231 is the short 0x7d4 variant, so the table is absent');

  const buttons = extracted.length > 0 ? extracted : MISSING_PRISON_DOOR_BUTTONS;
  for (const b of buttons) {
    if (b.word0 === 0) continue;
    console.log(`  id ${b.word0}\tx ${b.x1}..${b.x2}\ty ${b.y1}..${b.y2}\tmask ${b.button}\t${b.name ?? ''}`);
  }

  check(buttons[0].word0 === 200 && buttons[1].word0 === 201 && buttons[2].word0 === 202,
    'the three ids are 200 (enter), 201 (resume), 202 (the scroll)');
  check(buttons[3].word0 === 0, 'the fourth entry terminates the list');
  for (const b of buttons.slice(0, 3)) {
    check(b.button === 2, `button ${b.word0} is left-click only (got mask ${b.button})`);
  }

  // The two labelled buttons live in the right-hand stone panels, which are `Word12` and
  // `Word20` — an independent statement of where that column is.
  const panelTop = ui.graphic232.word12;
  const panelMid = ui.graphic232.word20;
  check(buttons[0].x1 >= panelTop.x1 && buttons[0].y1 >= panelTop.y1 && buttons[0].y2 <= panelTop.y2,
    'ENTER sits inside the top right-hand panel (Word12)');
  // RESUME overlaps its panel rather than nesting in it: the hot spot starts at y=76 and
  // Word20 at y=77. The engraved label is a pixel taller than the panel rectangle.
  check(buttons[1].x1 >= panelMid.x1 && buttons[1].y2 <= panelMid.y2 && buttons[1].y1 >= panelTop.y2,
    'RESUME sits over the middle right-hand panel (Word20), below the top one');
  check(buttons[2].y2 <= SCREEN_HEIGHT - 1 && buttons[2].y1 > panelMid.y2,
    'the scroll is below both panels, at the bottom of the screen');

  // Hit-testing is half-open on the maxima (`doc/CSBwin-src/CSBCode.cpp:7621-7629`), which
  // `searchButtonList` already implements; pin the three live spots and one dead one.
  check(searchButtonList(buttons, 260, 50, 2) === 200, 'a left click at (260,50) enters the dungeon');
  check(searchButtonList(buttons, 260, 85, 2) === 201, 'a left click at (260,85) resumes');
  check(searchButtonList(buttons, 270, 192, 2) === 202, 'a left click at (270,192) opens the credits');
  check(searchButtonList(buttons, 260, 50, 1) === 0, 'a right click on ENTER does nothing');
  check(searchButtonList(buttons, 100, 100, 2) === 0, 'a click in the doorway does nothing');
}

/* -------------------------------------------------- 3. the synthetic 5x5 level ---- */

function checkPrisonLevel(): void {
  const flags = prisonCellFlags();
  console.log('\n=== the level behind the doors (`_TAG01f5ea`), [x][y], 32 = OPEN ===');
  for (let y = 0; y < PRISON_LEVEL_SIZE; y++) {
    console.log('  ' + Array.from({ length: PRISON_LEVEL_SIZE }, (_, x) => String(flags[x][y]).padStart(3)).join(''));
  }

  let open = 0;
  for (let x = 0; x < PRISON_LEVEL_SIZE; x++) {
    for (let y = 0; y < PRISON_LEVEL_SIZE; y++) if (flags[x][y] === 32) open++;
  }
  check(open === PRISON_LEVEL_SIZE + 1, `six cells are open: column x=2 and (1,2) (got ${open})`);
  for (let y = 0; y < PRISON_LEVEL_SIZE; y++) {
    check(flags[2][y] === 32, `(2,${y}) is open — the corridor the party looks down`);
  }
  check(flags[1][2] === 32, '(1,2) is open — the side opening two cells ahead');
  check(flags[0][0] === 0 && flags[4][4] === 0, 'the corners are solid stone');

  // `DrawViewport(2, 2, 0)` is `(facing, x, y)`.
  check(PRISON_PARTY_POSITION.facing === 2, 'the party faces south (2), down the corridor');
  check(PRISON_PARTY_POSITION.x === 2 && PRISON_PARTY_POSITION.y === 0, 'the party stands at (2,0)');
  check(flags[PRISON_PARTY_POSITION.x][PRISON_PARTY_POSITION.y] === 32, 'the party stands on an open cell');

  const state = createPrisonDungeonState(0x1234);
  const map = state.getMap(PRISON_LEVEL_INDEX);
  check(map !== null, 'the fake DungeonState serves level 255');
  check(state.getMap(0) === null, 'and nothing else — a stray lookup must not silently work');
  check(map!.descriptor.mapGraphicsStyle === 0 && map!.descriptor.floorCeilingStyle === 0,
    'the zeroed LEVELDESC selects wall set 0 and floor/ceiling set 0, which `_GameSetup` loaded');
  check(map!.descriptor.wallGraphicsCount === 0, 'and no wall decorations');
  check(getRoomType(map!.cellFlags[2][0]) === 1 && getRoomType(map!.cellFlags[0][0]) === 0,
    'the cell flags say OPEN at (2,0), STONE at (0,0)');
  let objectAsked = false;
  for (let x = 0; x < PRISON_LEVEL_SIZE; x++) {
    for (let y = 0; y < PRISON_LEVEL_SIZE; y++) if (cellHasObjects(map!.cellFlags[x][y])) objectAsked = true;
  }
  check(!objectAsked, 'no cell claims objects, so the viewport never walks a chain here');
}

/* ------------------------------------------------- 4. the doors, really drawn ---- */

function makeHost(graphics: GraphicsLoader, ui: UITables): IntroHost {
  const screen = createPaletteIndexViewportBuffer(SCREEN_WIDTH, SCREEN_HEIGHT, 0);
  const viewport = createIndexedBitmap(VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
  viewport.pixels.fill(INTERIOR_MARKER);
  const cache = new Map<number, IndexedBitmap>();
  return {
    screen,
    uiTables: ui,
    font: loadFontData(graphics),
    globalPalette: [...PALETTE_11914],
    getGraphic(graphicNum: number): IndexedBitmap {
      let bitmap = cache.get(graphicNum);
      if (!bitmap) {
        const image = graphics.getImage(graphicNum);
        bitmap = { width: image.width, height: image.height, pixels: Uint8Array.from(image.pixels) };
        cache.set(graphicNum, bitmap);
      }
      return bitmap;
    },
    present: () => {},
    vbl: () => Promise.resolve(),
    startSound: () => {},
    drawPrisonInterior: () => viewport,
    nextEvent: () => Promise.resolve({ kind: 'click' as const, x: 0, y: 0, buttons: 2 }),
    takeClick: () => null,
    discardAllInput: () => {},
    mouseSwitches: () => 0,
    keyWaiting: () => true,
    setCursorVisible: () => {},
  };
}

function pixel(host: IntroHost, x: number, y: number): number {
  return host.screen.pixels[y * host.screen.width + x];
}

/** Is this screen region still exactly what `src` has there? */
function regionMatches(host: IntroHost, src: IndexedBitmap, x1: number, x2: number, y1: number, y2: number): boolean {
  for (let y = y1; y <= y2; y++) {
    for (let x = x1; x <= x2; x++) {
      if (pixel(host, x, y) !== src.pixels[y * src.width + x]) return false;
    }
  }
  return true;
}

/** The top of the scroll button, so the check below names a real place on the screen. */
function buttons2Y(ui: UITables): number {
  const extracted = ui.graphic231.buttons.buttons16932;
  const buttons = extracted.length > 0 ? extracted : MISSING_PRISON_DOOR_BUTTONS;
  return buttons[2].y1;
}

async function checkDoors(graphics: GraphicsLoader, ui: UITables): Promise<void> {
  console.log('\n=== the doors ===');
  const host = makeHost(graphics, ui);
  const assets = loadAssets(host);

  check(assets.slots.length === 8, 'eight door buffers, as `(&d.Pointer22952)[0..7]`');
  for (const slot of assets.slots) {
    check(slot.width === DOOR_SLOT_WIDTH && slot.height === DOOR_SLOT_HEIGHT,
      `each is ${DOOR_SLOT_WIDTH}x${DOOR_SLOT_HEIGHT} (10304 bytes)`);
  }
  // Slot n holds the left half shifted left by 4n: slot1's column 0 is slot0's column 4.
  for (let n = 1; n < 4; n++) {
    let same = true;
    for (let y = 0; y < DOOR_SLOT_HEIGHT; y += 17) {
      for (let x = 0; x < 40; x++) {
        if (assets.slots[n].pixels[y * DOOR_SLOT_WIDTH + x] !== assets.slots[0].pixels[y * DOOR_SLOT_WIDTH + x + 4 * n]) same = false;
      }
    }
    check(same, `left-door slot ${n} is the door shifted left by ${4 * n} pixels`);
  }

  await drawPrisonDoor(host, assets);

  const g = ui.graphic232;
  const doorwayY = INTERIOR_SCREEN_Y + 80;
  check(pixel(host, 110, doorwayY) !== INTERIOR_MARKER, 'with the doors shut, the opening shows door, not corridor');
  check(pixel(host, 10, doorwayY) !== INTERIOR_MARKER, 'and so does the far left of the opening');
  // Graphic 4's right-hand column is never covered by anything.
  const entrance = host.getGraphic(4);
  // Word84/Word100 reach x=231, eight columns past the viewport's 224, so the door art and
  // the interior save both cover a sliver of the wall right of the opening. The button
  // panels proper start where that sliver ends.
  check(g.word84.x2 === 231 && g.word100.x2 === 231 && g.word76.x2 === 231,
    'the entrance interior, the static right door and the sliding one all end at x=231');
  const panelLeft = 232;
  const panelIntact = regionMatches(host, entrance, panelLeft, SCREEN_WIDTH - 1, g.word12.y1, g.word20.y2);
  check(panelIntact, `the right-hand stone panels (x >= ${panelLeft}) are graphic 4, untouched`);
  check(assets.viewport !== null, 'the corridor was rendered and kept for the animation');

  // The interior save is the screen under the doors, so it must NOT contain them.
  check(
    assets.interior.pixels[(doorwayY - INTERIOR_SCREEN_Y) * assets.interior.width + 110] === INTERIOR_MARKER,
    'the saved interior holds the corridor, captured before the doors went on',
  );

  await openPrisonDoors(host, assets);

  check(pixel(host, 110, doorwayY) === INTERIOR_MARKER, 'once open, the middle of the opening shows the corridor');
  check(pixel(host, 116, doorwayY) === INTERIOR_MARKER, 'and so does the centre line');
  // 31 frames x 4 pixels = 124, and each half only has to clear its own side of a 232-wide
  // opening, so both are fully off by the end.
  check(DOOR_STEPS * 4 >= g.word68.x2 + 1, `${DOOR_STEPS} frames of 4 pixels clear the left half's ${g.word68.x2 + 1}`);
  check(g.word76.x1 + DOOR_STEPS * 4 > g.word76.x2, 'and push the right half off its own rectangle');
  let openingClear = true;
  for (let y = INTERIOR_SCREEN_Y + 10; y < INTERIOR_SCREEN_Y + 130; y += 7) {
    for (let x = 0; x < VIEWPORT_WIDTH; x += 5) {
      if (pixel(host, x, y) !== INTERIOR_MARKER) openingClear = false;
    }
  }
  check(openingClear, 'the whole viewport is corridor when the animation ends');
  // The right half stops with a three-column sliver still showing, because its rectangle
  // runs out at x=231 while `x1` has only reached 229 — 31 frames is not quite enough to
  // push 123 columns off. The left half is long gone: its `x2` went negative at frame 27.
  const lastLeftX2 = g.word68.x2 - 4 * (DOOR_STEPS - 1);
  check(lastLeftX2 < 0, `the left half is fully off screen before frame ${DOOR_STEPS} (x2 would be ${lastLeftX2})`);
  const lastRightX1 = g.word76.x1 + 4 * (DOOR_STEPS - 1);
  check(lastRightX1 === 229 && lastRightX1 < g.word76.x2,
    `the right half ends at x1=${lastRightX1}, leaving a ${g.word76.x2 - lastRightX1 + 1}-column sliver at the frame edge`);

  check(regionMatches(host, entrance, panelLeft, SCREEN_WIDTH - 1, g.word12.y1, g.word20.y2),
    'and the button panels never moved');
  check(regionMatches(host, entrance, panelLeft, SCREEN_WIDTH - 1, buttons2Y(ui), SCREEN_HEIGHT - 1),
    'nor did the scroll at the bottom of the panel column');
}

/* ------------------------------------------------------------ 5. ShrinkBLT ---- */

function checkShrinkBlt(graphics: GraphicsLoader): void {
  console.log('\n=== the title zoom ===');
  const image = graphics.getImage(1);
  const logo: IndexedBitmap = { width: image.width, height: image.height, pixels: Uint8Array.from(image.pixels) };
  check(logo.width === SCREEN_WIDTH && logo.height === SCREEN_HEIGHT, 'graphic 1 is a full 320x200 screen');

  // At 1:1 the fixed point must be the identity, or every frame is off by a column.
  const identity = shrinkBlt(logo, 320, 80, 320, 80);
  let same = true;
  for (let y = 0; y < 80; y++) {
    for (let x = 0; x < 320; x++) if (identity.pixels[y * 320 + x] !== logo.pixels[y * 320 + x]) same = false;
  }
  check(same, 'ShrinkBLT at 1:1 reproduces the source exactly');

  let width = ZOOM_FIRST_WIDTH;
  let height = ZOOM_FIRST_HEIGHT;
  for (let i = 0; i < ZOOM_FRAMES; i++, width += ZOOM_WIDTH_STEP, height += ZOOM_HEIGHT_STEP) {
    const frame = shrinkBlt(logo, 320, 80, width, height);
    check(frame.width === width && frame.height === height, `zoom frame ${i} is ${width}x${height}`);
    if (i === 0 || i === ZOOM_FRAMES - 1) {
      const left = Math.trunc((SCREEN_WIDTH - width) / 2);
      const top = Math.trunc((ZOOM_CENTRE_HEIGHT - height) / 2);
      console.log(`  frame ${String(i).padStart(2)}: ${width}x${height} at (${left},${top})`);
    }
  }
  check(width - ZOOM_WIDTH_STEP === 320 && height - ZOOM_HEIGHT_STEP === 80,
    'the eighteenth frame is the logo at full size');
  const last = Math.trunc((ZOOM_CENTRE_HEIGHT - 80) / 2);
  check(last === 40, 'and lands at y=40, so it sits above the "Master" band at y=118');

  // A shrunk frame must carry the logo, not empty background: colour 0 everywhere would
  // mean the accumulator walked off the top of the image.
  const small = shrinkBlt(logo, 320, 80, 48, 12);
  check(small.pixels.some((p) => p !== 0), 'the smallest frame is not blank');
}

/* --------------------------------------------------------------- 6. the arrow ---- */

/**
 * The mouse pointer on the entrance screen, which no golden frame can show: the probe
 * dispatches clicks without ever moving the mouse, so `hoverPoint` is null in every capture.
 *
 * The interesting claim is that there is no recolouring anywhere — CSBWin blits `d.Byte1222`
 * as it stands and the screen's palette does the rest, which is why the arrow is white-ish
 * in the dungeon and beige against the entrance's stonework.
 */
function checkCursor(graphics: GraphicsLoader, ui: UITables): void {
  console.log('\n=== the arrow ===');
  const arrow = decodeCursorBitmap(ui.graphic232.cursorArrow);
  check(arrow !== null, 'the arrow decodes from `d.Byte1222`');
  if (!arrow) return;
  check(arrow.width === 16 && arrow.height === 16, 'it is 16x16');

  const used = new Set<number>(Array.from(arrow.pixels));
  console.log('  palette indices used: ' + [...used].sort((a, b) => a - b).join(', '));
  for (let y = 0; y < 6; y++) {
    console.log('  ' + Array.from(arrow.pixels.subarray(y * 16, y * 16 + 16))
      .map((v) => (v === CURSOR_TRANSPARENT ? '.' : v.toString(16))).join(''));
  }
  check(used.has(CURSOR_TRANSPARENT), `colour ${CURSOR_TRANSPARENT} is the transparent one, and the arrow uses it`);
  check(arrow.pixels[0] === 0 && arrow.pixels[1] === 0, 'the tip is the black outline, index 0');
  check(arrow.pixels[16 + 1] === 4, 'and the body is index 4');
  check(used.size === 3, `only three indices: outline, body, transparent (got ${used.size})`);

  // The whole point: index 4 is beige on the entrance and teal in the dungeon.
  const hex = (c: number): string => `0x${c.toString(16).padStart(3, '0')}`;
  const entrance = ui.graphic232.palette360[4];
  const adventure = ui.graphic232.palette552[0][4];
  console.log(`  index 4 is ${hex(entrance)} under Palette360, ${hex(adventure)} under Palette552[0]`);
  check(entrance === 0x654, `the entrance paints the arrow beige (got ${hex(entrance)})`);
  check(adventure !== entrance, 'and the dungeon paints the very same bitmap a different colour');

  // `DrawCursor` + `RemoveCursor`: the cursor must never end up in the picture.
  const host = makeHost(graphics, ui);
  host.screen.pixels.fill(9);
  const before = Uint8Array.from(host.screen.pixels);
  let sawArrow = false;
  withCursor(host.screen, arrow, 40, 40, () => {
    sawArrow = host.screen.pixels[40 * SCREEN_WIDTH + 40] === 0 && host.screen.pixels[41 * SCREEN_WIDTH + 41] === 4;
    check(host.screen.pixels[40 * SCREEN_WIDTH + 43] === 9,
      'a transparent pixel of the arrow leaves the screen showing through');
  });
  check(sawArrow, 'the arrow is on the screen while the frame is being pushed');
  check(host.screen.pixels.every((v, i) => v === before[i]),
    'and every pixel is put back afterwards, so it never becomes part of the picture');

  // Clipping: the arrow at the bottom-right corner must not wrap onto the next row.
  host.screen.pixels.fill(9);
  withCursor(host.screen, arrow, SCREEN_WIDTH - 2, SCREEN_HEIGHT - 2, () => {
    check(host.screen.pixels[(SCREEN_HEIGHT - 2) * SCREEN_WIDTH] === 9,
      'an arrow hanging off the right edge does not wrap to column 0');
  });
}

/* --------------------------------------------------------- 7. the two pitches ---- */

function checkSoundPitches(ui: UITables): void {
  console.log('\n=== StartSound\'s Timer-A argument ===');
  const catalog = buildSoundCatalog(ui.graphic232.sound1772);
  const doorRates = catalog[SoundIndex.DOOR]?.rates ?? ratesDefault;
  const latchRates = catalog[SoundIndex.SWITCH]?.rates ?? ratesDefault;

  // rate = 2457600 / 4 / timerData, the MFP's 1:4 prescaler.
  const rateFor = (timerData: number): number => Math.round(2457600 / 4 / timerData);
  console.log(`  timer 112 -> ${rateFor(112)} Hz, timer 145 -> ${rateFor(145)} Hz`);
  console.log(`  door rates ${doorRates.join(', ')} | latch rates ${latchRates.join(', ')}`);

  check(SoundIndex.SWITCH === 534 && SoundIndex.DOOR === 535,
    'graphics 534 and 535 are the latch and the doors');
  check(Math.abs(rateFor(112) - 5486) <= 1, 'timer 112 is this project\'s default 5486 Hz');
  check(Math.abs(rateFor(145) - 4237) <= 1, 'timer 145 is the door\'s second variant, 4237 Hz');

  check(timerDataToRateIndex(112) === 0, 'the latch (timer 112) uses rate index 0');
  check(timerDataToRateIndex(145) === 1, 'the doors (timer 145) use rate index 1');
  check(doorRates.length > 1 && Math.abs(doorRates[1] - rateFor(145)) <= 1,
    'and the door sound really does carry that second rate');
  check(Math.abs(latchRates[0] - rateFor(112)) <= 1, 'while the latch has only the default');
}

/* -------------------------------------------------------------- the fade ---- */

async function checkFade(): Promise<void> {
  console.log('\n=== _FadeToPalette ===');
  const host = makeHost(loadGraphics(), graphicsTablesOf(loadGraphics()).ui);
  host.globalPalette.fill(0x777);
  await fadeToPalette(host, PALETTE_11914);
  check(host.globalPalette.every((c) => c === 0), 'eight steps take 0x777 all the way to black');

  host.globalPalette.fill(0x000);
  await fadeToPalette(host, new Array(16).fill(0x777));
  check(host.globalPalette.every((c) => c === 0x777), 'and back up again');

  // Eight steps is always enough, because no component can be further than 7 away. That is
  // why CSBWin can use one fixed loop count for "fade to black", "fade up" and "just
  // delay" alike, and why a caller never has to fade twice.
  host.globalPalette[0] = 0x000;
  host.globalPalette[1] = 0x707;
  const target = new Array(16).fill(0x070);
  target[0] = 0x777;
  await fadeToPalette(host, target);
  check(host.globalPalette[0] === 0x777 && host.globalPalette[1] === 0x070,
    'the widest legal jump, 0 to 7 in every component, finishes inside the eight steps');
}

/* ------------------------------------------------------ the title picture ---- */

/**
 * A set's thumbnail in the title's place (`showTitlePicture`): the screen darkened, the
 * picture faded in over eight VBLs, held, faded out over eight, and the screen left black.
 */
async function checkTitlePicture(): Promise<void> {
  console.log('\n=== The thumbnail as the title ===');
  const host = makeHost(loadGraphics(), graphicsTablesOf(loadGraphics()).ui);
  const registers = [0x000, 0x777, 0x700, 0x070, 0x007, 0x770, 0x077, 0x707, 0x123, 0x456, 0x765, 0x321, 0x135, 0x642, 0x214, 0x553];
  const pixels = Uint8Array.from({ length: SCREEN_WIDTH * SCREEN_HEIGHT }, (_, p) => p % 16);
  // Where the picture was at each blank: whether the screen held it, and the registers.
  const seen: { shown: boolean; palette: number[] }[] = [];
  host.vbl = (count: number) => {
    for (let i = 0; i < count; i++) {
      seen.push({ shown: host.screen.pixels.every((pixel, p) => pixel === pixels[p]), palette: host.globalPalette.slice(0, 16) });
    }
    return Promise.resolve();
  };
  host.globalPalette.splice(0, 16, ...registers.map((register) => register ^ 0x777));
  host.screen.pixels.fill(3);
  await showTitlePicture(host, { pixels, registers });

  const black = (palette: number[]): boolean => palette.every((register) => register === 0);
  const same = (palette: number[]): boolean => palette.every((register, i) => register === registers[i]);
  console.log(`${seen.length} VBLs`);
  check(seen.length === 8 + 8 + TITLE_PICTURE_HOLD_VBLS + 8, `8 to darken, 8 to fade in, ${TITLE_PICTURE_HOLD_VBLS} held, 8 to fade out`);
  check(seen.slice(0, 8).every((v) => !v.shown), 'the picture is not put up while the screen darkens');
  check(seen[8].shown && black(seen[8].palette), 'it is put up under black registers');
  check(seen.slice(8).every((v) => v.shown), 'and stays up to the last fade\'s last blank');
  // A blank is seen before the fade's step on it, and a shade is at most seven steps from
  // black, so the eighth blank of the fade-in already sees the picture's registers.
  check(seen.slice(15, 16 + TITLE_PICTURE_HOLD_VBLS + 1).every((v) => same(v.palette)), 'its registers reached in the fade-in, and held');
  check(!same(seen[14].palette), 'not before its seventh step: 0x777 rises a level a blank');
  check(black(host.globalPalette.slice(0, 16)) && host.screen.pixels.every((pixel) => pixel === 0), 'faded out to black, and the screen cleared');
}

async function main(): Promise<void> {
  const graphics = loadGraphics();
  const ui = graphicsTablesOf(graphics).ui;

  checkRectangles(ui);
  checkButtons(ui);
  checkPrisonLevel();
  await checkDoors(graphics, ui);
  checkCursor(graphics, ui);
  checkShrinkBlt(graphics);
  checkSoundPitches(ui);
  await checkFade();
  await checkTitlePicture();

  finish();
}

void main();
