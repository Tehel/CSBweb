/**
 * The dungeon entrance — `_TAG01f746`, `doc/CSBwin-src/CSBCode.cpp:9577` — with the screen
 * it draws (`_TAG01f5ea`, `:9667`), the door-opening animation (`_OpenPrisonDoors`,
 * `:9485`) and the credits scroll behind the hidden button (`_TAG01f928`, `:9753`).
 *
 * The screen is `graphics.dat` item 4, a full 320x200 painting of the prison front with the
 * two labels and the little scroll already engraved into it — none of that is text drawn at
 * runtime. What is *not* painted is the corridor behind the doors: `_TAG01f5ea` stands up a
 * synthetic 5x5 level, puts an imaginary party at (2,0) facing south and runs the real
 * viewport renderer, then blits the two door halves over the opening. So the view through
 * the doors is the dungeon renderer, and when the doors slide apart you are looking at a
 * genuinely drawn corridor.
 *
 * Three buttons, from `d.Buttons16932` (`:9592`): 200 enters, 201 resumes a saved game,
 * 202 is the scroll. Full spec, geometry and citations:
 * `doc/CSBWIN_TITLE_SCREEN_REFERENCE.md`. A data set with a `mini.dat` has a fourth, the
 * port's own: RISE (`RISE_BUTTON`).
 */
import { tag0088b2Index, type IndexedBitmap } from '../csbwin/CanvasBlitter';
import type { UIButton } from '../../data/tables/UITables';
import { searchButtonList } from '../ui/HitTest';
import { SCREEN_HEIGHT, SCREEN_WIDTH, VIEWPORT_X, VIEWPORT_Y } from '../ViewportGraphics';
import {
  PALETTE_11914,
  createIndexedBitmap,
  fadeToPalette,
  timerDataToRateIndex,
  type IntroHost,
} from './IntroHost';

/* ------------------------------------------------------------------- constants ---- */

/** `graphics.dat` items, named as `Data.h:255-277` names the pointers they load into. */
const GRAPHIC_DOOR_LEFT = 2;    // d.Pointer22952[0] — 128x161
const GRAPHIC_DOOR_RIGHT = 3;   // d.Pointer22952[4] — 128x161
const GRAPHIC_ENTRANCE = 4;     // d.Pointer22956 — "Prison entrance minus door"
const GRAPHIC_CREDITS = 5;      // d.Pointer22960 — the scroll
const GRAPHIC_SOUND_LATCH = 534;// d.Pointer22968 — the click as the doors unlock
const GRAPHIC_SOUND_DOORS = 535;// d.Pointer22964 — the grind as they slide

/** `StartSound(…, 112, 1)` (`:9658`) and `StartSound(…, 145, 1)` (`:9509`). */
const TIMER_DATA_LATCH = 112;
const TIMER_DATA_DOORS = 145;

/** `d.gameState` (`doc/CSBwin-src/CSB.h:39-42`). */
const GAMESTATE_RESUME_SAVED_GAME = 0;
const GAMESTATE_ENTER_PRISON = 1;
const GAMESTATE_AT_PRISON_DOOR = 99;
const GAMESTATE_202 = 202;
/** The port's own, for RISE: no `d.gameState` of CSBWin's. */
const GAMESTATE_RISE = 203;

/** The eight 128x161 door buffers `_TAG01f746` pre-shifts (`:9596-9639`). */
export const DOOR_SLOT_WIDTH = 128;
export const DOOR_SLOT_HEIGHT = 161;
/** `d.Pointer22920` / `d.Pointer22916`, 20608 bytes = 256x161 at one byte per pixel. */
const INTERIOR_WIDTH = 256;
const INTERIOR_HEIGHT = 161;
/** The `Word84` save starts at screen row 30, and the animation writes back to the same. */
export const INTERIOR_SCREEN_Y = 30;
/** Only 232 of the 256 columns ever reach the screen — the `112 + 4*2` bytes at `:9557`. */
export const INTERIOR_VISIBLE_WIDTH = 232;
/** `for (D7W = 1; D7W != 32; D7W++)` (`:9503`). */
export const DOOR_STEPS = 31;
/** `for (i=0; i<6; i++) { CheckSoundQueue(); wvbl(_1_); }` (`:9550`). */
const DOOR_STEP_VBLS = 6;
/** `VBLDelay(_3_, 20)` between the latch click and the doors moving (`:9659`). */
const LATCH_TO_DOORS_VBLS = 20;

/**
 * `d.Buttons16932`, hard-coded because Dungeon Master's `graphics.dat` does not carry it.
 *
 * `ReadTablesFromGraphicsFile` asserts item 0x231 is 0x804 or 0x7d4 bytes and, when it is
 * the short one, overwrites the list with these four entries
 * (`doc/CSBwin-src/CSBCode.cpp:10259-10281`). DM's is the short one, and CSB's the long one,
 * whose four are these, word for word (`tools/checks/data-sets.ts`).
 */
export const MISSING_PRISON_DOOR_BUTTONS: UIButton[] = [
  { word0: 0x00c8, x1: 0x00f4, x2: 0x012a, y1: 0x002d, y2: 0x003a, button: 0x0002, name: 'enter' },
  { word0: 0x00c9, x1: 0x00f4, x2: 0x012a, y1: 0x004c, y2: 0x005d, button: 0x0002, name: 'resume' },
  { word0: 0x00ca, x1: 0x00f8, x2: 0x0125, y1: 0x00bb, y2: 0x00c7, button: 0x0002, name: 'credits' },
  { word0: 0, x1: 0, x2: 0, y1: 0, y2: 0, button: 0, name: 'end' },
];

/** What the player chose. `_GameSetup` reads it as `d.gameState` (`:10750-10765`). */
export type PrisonDoorChoice = 'enter' | 'resume' | 'rise';

/* ------------------------------------------------------------------- RISE ---- */

/**
 * RISE, the port's own button: CSBWin's UTILITY → "MAKE NEW ADVENTURE" on the entrance
 * (`doc/SAVES.md` → "RISE makes a save of its own", `src/engine/Chaos.ts`), shown only by a data set with a `mini.dat`, so
 * Dungeon Master's entrance is CSBWin's.
 *
 * It is carved from the entrance itself: RESUME's gem, the R, I and S of PRISON and the E
 * of RESUME, each copied without the panel's bare stone around it (`PANEL_STONE`), onto
 * the bare rock below the two labels. Its letters stand to its gem as RESUME's do, and so
 * does its rectangle, so it is clicked as the other two are. Positions in graphic 4 of
 * CSB's `graphics.dat` (`tools/checks/rise.ts`).
 */
export const RISE_BUTTON_ID = 0x00cb;
/** Colour index 10, the stone the labels are carved in. */
const PANEL_STONE = 10;
/** RESUME's gem: a 14x14 diamond whose top left corner is here. */
export const RISE_GEM_SOURCE = { x: 243, y: 78 };
export const RISE_GEM_SIZE = 14;
/** The letters' 7x8 cells: PRISON's R, I and S, and RESUME's first E. */
export const RISE_LETTER_SOURCES = [{ x: 269, y: 48 }, { x: 277, y: 48 }, { x: 285, y: 48 }, { x: 269, y: 81 }];
export const RISE_LETTER_WIDTH = 7;
export const RISE_LETTER_HEIGHT = 8;
/** A label's letters from its gem's corner, and from one another: RESUME's. */
const RISE_LETTER_DX = 18;
const RISE_LETTER_DY = 3;
const RISE_LETTER_PITCH = 8;
/** Where RISE's gem goes: the corner of the bare rock between RESUME and the scroll. */
export const RISE_AT = { x: 246, y: 165 };

/** RESUME's rectangle (`MISSING_PRISON_DOOR_BUTTONS[1]`) about its gem, about RISE's. */
export const RISE_BUTTON: UIButton = {
  word0: RISE_BUTTON_ID,
  x1: RISE_AT.x + (0x00f4 - RISE_GEM_SOURCE.x),
  x2: RISE_AT.x + (0x012a - RISE_GEM_SOURCE.x),
  y1: RISE_AT.y + (0x004c - RISE_GEM_SOURCE.y),
  y2: RISE_AT.y + (0x005d - RISE_GEM_SOURCE.y),
  button: 0x0002,
  name: 'rise',
};

/** Whether (x, y) of the gem's 14x14 square is inside its diamond, the square's corners not. */
function inGem(x: number, y: number): boolean {
  const half = (RISE_GEM_SIZE - 1) / 2;
  return Math.abs(x - half) + Math.abs(y - half) <= half + 0.5;
}

/** Copy the carving of `source`'s w x h at (sx, sy) to (dx, dy) of `target`, the bare stone left out. */
function carve(
  source: IndexedBitmap, target: IndexedBitmap,
  sx: number, sy: number, dx: number, dy: number, w: number, h: number,
  keep: (x: number, y: number) => boolean = () => true,
): void {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!keep(x, y)) continue;
      const pixel = source.pixels[(sy + y) * source.width + sx + x]!;
      if (pixel !== PANEL_STONE) target.pixels[(dy + y) * target.width + dx + x] = pixel;
    }
  }
}

/** The entrance with RISE carved into a copy of it. */
export function carveRise(entrance: IndexedBitmap): IndexedBitmap {
  const carved = createIndexedBitmap(entrance.width, entrance.height);
  carved.pixels.set(entrance.pixels);
  carve(entrance, carved, RISE_GEM_SOURCE.x, RISE_GEM_SOURCE.y, RISE_AT.x, RISE_AT.y, RISE_GEM_SIZE, RISE_GEM_SIZE, inGem);
  RISE_LETTER_SOURCES.forEach((letter, i) => {
    carve(entrance, carved, letter.x, letter.y,
      RISE_AT.x + RISE_LETTER_DX + i * RISE_LETTER_PITCH, RISE_AT.y + RISE_LETTER_DY,
      RISE_LETTER_WIDTH, RISE_LETTER_HEIGHT);
  });
  return carved;
}

/** The entrance's buttons with RISE among them, before the list's end. */
export function withRiseButton(buttons: UIButton[]): UIButton[] {
  const end = buttons.findIndex((button) => button.word0 === 0);
  const at = end < 0 ? buttons.length : end;
  return [...buttons.slice(0, at), RISE_BUTTON, ...buttons.slice(at)];
}

/* --------------------------------------------------------------------- drawing ---- */

/** The eight pre-shifted door halves, plus the pristine interior behind them. */
interface PrisonDoorAssets {
  /** `d.Pointer22952[0..7]`: 0..3 the left half at 0/4/8/12 px, 4..7 the right half. */
  slots: IndexedBitmap[];
  entrance: IndexedBitmap;
  credits: IndexedBitmap;
  /** `d.Pointer22920` — the composed entrance with the corridor, before the doors. */
  interior: IndexedBitmap;
  /** `d.pViewportBMP` — the 224x136 corridor on its own. */
  viewport: IndexedBitmap | null;
}

/**
 * `:9596-9639`. The eight buffers exist so the animation only ever blits whole 16-pixel
 * words: the `D7W & 3` slot supplies the sub-word shift and the source x offset supplies
 * the rest.
 */
export function loadAssets(host: IntroHost, rise = false): PrisonDoorAssets {
  const doorLeft = host.getGraphic(GRAPHIC_DOOR_LEFT);
  const doorRight = host.getGraphic(GRAPHIC_DOOR_RIGHT);
  const slots: IndexedBitmap[] = [];
  for (let i = 0; i < 8; i++) slots.push(createIndexedBitmap(DOOR_SLOT_WIDTH, DOOR_SLOT_HEIGHT));
  slots[0] = doorLeft;
  slots[4] = doorRight;

  const dstPos = { x1: 0, x2: 100, y1: 0, y2: 160 };
  for (let i = 1; i < 4; i++) {
    tag0088b2Index(doorLeft, slots[i]!, { ...dstPos, srcX: i * 4, srcY: 0, srcStride: DOOR_SLOT_WIDTH }, -1);
    dstPos.x2 -= 4;
  }
  dstPos.x2 = 127;
  for (let i = 5; i < 8; i++) {
    dstPos.x1 += 4;
    tag0088b2Index(doorRight, slots[i]!, { ...dstPos, srcX: 0, srcY: 0, srcStride: DOOR_SLOT_WIDTH }, -1);
  }

  return {
    slots,
    entrance: rise ? carveRise(host.getGraphic(GRAPHIC_ENTRANCE)) : host.getGraphic(GRAPHIC_ENTRANCE),
    credits: host.getGraphic(GRAPHIC_CREDITS),
    interior: createIndexedBitmap(INTERIOR_WIDTH, INTERIOR_HEIGHT),
    viewport: null,
  };
}

/**
 * `_TAG01f5ea` (`:9667`) — fade out, paint the entrance, draw the corridor through it,
 * shut the doors over the opening, fade in.
 *
 * The corridor is the expensive half and it is what makes this screen worth porting
 * faithfully: `d.partyLevel = 255` with a 5x5 cell-flag array is all the state the real
 * `DrawViewport` needs, so the doorway shows the same renderer the game uses.
 */
export async function drawPrisonDoor(host: IntroHost, assets: PrisonDoorAssets): Promise<void> {
  const rects = host.uiTables.graphic232;

  await fadeToPalette(host, PALETTE_11914);

  // "Entrance to prison without door." (`:9704`)
  tag0088b2Index(assets.entrance, host.screen, { x1: 0, x2: SCREEN_WIDTH - 1, y1: 0, y2: SCREEN_HEIGHT - 1, srcX: 0, srcY: 0, srcStride: assets.entrance.width }, -1);

  // `DrawViewport(2, 2, 0)` and the VBL copy `MarkViewportUpdated(0)` forces (`:9705`,
  // `doc/CSBwin-src/Viewport.cpp:7176`).
  const viewport = host.drawPrisonInterior();
  assets.viewport = viewport;
  tag0088b2Index(viewport, host.screen, { x1: VIEWPORT_X, x2: VIEWPORT_X + viewport.width - 1, y1: VIEWPORT_Y, y2: VIEWPORT_Y + viewport.height - 1, srcX: 0, srcY: 0, srcStride: viewport.width }, -1);

  // "Save interior prison entrance" (`:9710`) — screen rows 30..190 into the 256-wide
  // working buffer the door animation restores from every frame.
  tag0088b2Index(host.screen, assets.interior, { ...rects.word84, srcX: 0, srcY: INTERIOR_SCREEN_Y, srcStride: host.screen.width }, -1);

  // The two halves, shut. (`:9721`, `:9725`)
  tag0088b2Index(assets.slots[0]!, host.screen, { ...rects.word92, srcX: 0, srcY: 0, srcStride: DOOR_SLOT_WIDTH }, -1);
  tag0088b2Index(assets.slots[4]!, host.screen, { ...rects.word100, srcX: 0, srcY: 0, srcStride: DOOR_SLOT_WIDTH }, -1);

  await fadeToPalette(host, rects.palette360);
}

/**
 * `_TAG01f928` (`:9753`) — the scroll at the bottom right. A still picture and a wait.
 *
 * CSBWin's wait is `do { wvbl(); if (--LOCAL_2 == 0) break; if (d.MouseSwitches) break; }
 * while (UI_CONSTAT()==0)`, where `LOCAL_2` is a function-static initialised to zero and
 * never reset — so the counter runs 65535 vertical blanks (about eighteen minutes) the
 * first time and picks up where it left off on any later visit. That is almost certainly
 * an artifact of the coroutine rewrite rather than the 68000 original, and it is
 * unreachable in practice: the exit is a click or a key. This port waits for the input and
 * does not keep the counter.
 */
async function showCreditsScroll(host: IntroHost, assets: PrisonDoorAssets): Promise<void> {
  const rects = host.uiTables.graphic232;
  host.setCursorVisible(false);         // `STHideCursor(HC34)` (`:9762`)
  await fadeToPalette(host, PALETTE_11914);
  tag0088b2Index(assets.credits, host.screen, { x1: 0, x2: SCREEN_WIDTH - 1, y1: 0, y2: SCREEN_HEIGHT - 1, srcX: 0, srcY: 0, srcStride: assets.credits.width }, -1);
  await fadeToPalette(host, rects.palette328);
  await host.nextEvent();
}

/**
 * `_OpenPrisonDoors` (`:9485`) — thirty-one frames, six vertical blanks each, the doors
 * sliding four pixels apart per frame and the grind restarting every third one.
 *
 * Each frame is composed in a 256-pixel-wide working buffer: the pristine interior, then
 * the live viewport over it, then the two door halves, then 232 columns of it are copied
 * to the screen at row 30. The right-hand stone panel with the buttons is never touched.
 */
export async function openPrisonDoors(host: IntroHost, assets: PrisonDoorAssets): Promise<void> {
  const rects = host.uiTables.graphic232;
  const work = createIndexedBitmap(INTERIOR_WIDTH, INTERIOR_HEIGHT);

  // CSBWin walks `d.Word68` and `d.Word76` in place and never puts them back — they are
  // only restored by the next `ReadTablesFromGraphicsFile`. Local copies here: the doors
  // open exactly once per run, so the two are equivalent, and a table the parser owns has
  // no business being edited.
  const leftRect = { ...rects.word68 };
  const rightRect = { ...rects.word76 };

  for (let step = 1; step <= DOOR_STEPS; step++) {
    if (step % 3 === 1) {
      host.startSound(GRAPHIC_SOUND_DOORS, timerDataToRateIndex(TIMER_DATA_DOORS));
    }

    work.pixels.set(assets.interior.pixels);       // `MemMove(22920 -> 22916)` (`:9515`)
    if (assets.viewport) {
      tag0088b2Index(assets.viewport, work, { ...rects.word60, srcX: 0, srcY: 0, srcStride: assets.viewport.width }, -1);
    }

    if (leftRect.x2 >= 0) {
      tag0088b2Index(assets.slots[step & 3]!, work, { ...leftRect, srcX: (step & 0xfc) * 4, srcY: 0, srcStride: DOOR_SLOT_WIDTH }, -1);
      leftRect.x2 -= 4;
    }
    // The right half's slot and source offset cancel each other out — slot `n+4` holds the
    // door shifted right by `4n` and the read starts `4n` in — so all of its motion comes
    // from `x1` walking right. Transcribed rather than simplified, to stay greppable.
    tag0088b2Index(assets.slots[(step & 3) + 4]!, work, { ...rightRect, srcX: (step & 3) * 4, srcY: 0, srcStride: DOOR_SLOT_WIDTH }, -1);
    rightRect.x1 += 4;

    await host.vbl(DOOR_STEP_VBLS);

    tag0088b2Index(work, host.screen, {
      x1: 0,
      x2: INTERIOR_VISIBLE_WIDTH - 1,
      y1: INTERIOR_SCREEN_Y,
      y2: INTERIOR_SCREEN_Y + INTERIOR_HEIGHT - 1,
      srcX: 0,
      srcY: 0,
      srcStride: INTERIOR_WIDTH,
    }, -1);
    host.present();
  }
}

/* ----------------------------------------------------------------- the screen ---- */

/**
 * Run the entrance screen until the player enters, resumes or rises, and
 * `readEntireGame` has read the game that choice names. With `rise`, the entrance has
 * RISE (`RISE_BUTTON`).
 *
 * `_TAG01f746`'s two nested loops: the inner one polls the mouse while `d.gameState` is
 * `GAMESTATE_AtPrisonDoor`, the outer one redraws the whole screen whenever the credits
 * scroll set `GAMESTATE_202` on its way out. The latch click and the twenty-blank pause
 * happen either way; the doors only open on a fresh game (`:9661`).
 *
 * `DiskMenuNeeded` is not ported here. CSBWin checks it in this loop (`:9654`) so the disk
 * icon can raise the save menu from the entrance, but that flag can only be set by button
 * 140, which is not in `d.Buttons16932` and additionally demands `d.NumCharacter > 0`
 * (`doc/CSBwin-src/Mouse.cpp:1852-1867`). It is unreachable from this screen.
 */
export async function showPrisonDoor(
  host: IntroHost,
  buttons: UIButton[],
  readEntireGame: (choice: PrisonDoorChoice) => Promise<boolean>,
  rise = false,
): Promise<PrisonDoorChoice> {
  const assets = loadAssets(host, rise);
  const list = rise ? withRiseButton(buttons) : buttons;
  let gameState = GAMESTATE_AT_PRISON_DOOR;

  do {
    await drawPrisonDoor(host, assets);
    host.setCursorVisible(true);        // `STShowCursor(HC50)` (`:9643`)
    host.discardAllInput();
    gameState = GAMESTATE_AT_PRISON_DOOR;

    while (gameState === GAMESTATE_AT_PRISON_DOOR) {
      const event = await host.nextEvent();
      if (event.kind !== 'click') continue;
      const id = searchButtonList(list, event.x, event.y, event.buttons);
      // `doc/CSBwin-src/Mouse.cpp:1913-1930`.
      if (id === 200) gameState = GAMESTATE_ENTER_PRISON;
      else if (id === 201) gameState = GAMESTATE_RESUME_SAVED_GAME;
      else if (id === RISE_BUTTON_ID) gameState = GAMESTATE_RISE;
      else if (id === 202) {
        await showCreditsScroll(host, assets);
        gameState = GAMESTATE_202;
      }
    }
  } while (gameState === GAMESTATE_202);

  host.startSound(GRAPHIC_SOUND_LATCH, timerDataToRateIndex(TIMER_DATA_LATCH));
  await host.vbl(LATCH_TO_DOORS_VBLS);
  host.setCursorVisible(false);         // `STHideCursor(HC33)` (`:9660`)

  // RISE goes on as RESUME does: it ends in a save read, through the doors still shut.
  const choice: PrisonDoorChoice = gameState === GAMESTATE_RESUME_SAVED_GAME ? 'resume'
    : gameState === GAMESTATE_RISE ? 'rise' : 'enter';
  if (choice === 'enter') await openPrisonDoors(host, assets);

  // `_GameSetup`'s `for (;;) { ReadEntireGame(); if (i16Result == 1) break; TAG01f746(); }`
  // (`:10758-10765`): `dungeon.dat` or the chosen save. A read that fails, or a load
  // that is cancelled, puts the entrance back up.
  if (await readEntireGame(choice)) return choice;
  return showPrisonDoor(host, buttons, readEntireGame, rise);
}
