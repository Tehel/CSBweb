/**
 * What the pre-game screens need from the machine underneath them.
 *
 * CSBWin's title animation, dungeon entrance and credits scroll all run *before* there is
 * a party, a level or a main loop: `_AskWhatToDo` (`doc/CSBwin-src/CSBCode.cpp:11338`)
 * calls `_DisplayChaosStrikesBack`, then `_StartCSB` -> `_ShowPrisonDoor` -> `_GameSetup`
 * -> `_TAG01f746`. They talk to the Atari hardware directly — the logical screen base, the
 * shifter's sixteen colour registers, the VBL counter, the sound chip — and nothing else.
 *
 * This interface is that hardware. `ViewportRenderer` implements it (`introHost()`), the
 * three modules in this directory are the ports, and neither knows about the other's
 * internals. Full spec and citations: `doc/CSBWIN_TITLE_SCREEN_REFERENCE.md`.
 *
 * Everything here is `async` because CSBWin's screens are `RESTARTABLE` coroutines that
 * yield on `wvbl()`. An `await host.vbl(n)` is the same suspension point as a `RESTART(n)`
 * label, and it keeps the order of operations identical to the C++.
 */
import type { IndexedBitmap, PaletteIndexViewportBuffer } from '../csbwin/CanvasBlitter';
import type { UITables } from '../csbwin/UITables';

/** One item off the input queue. `buttons` is CSBWin's mask: 2 = left, 1 = right. */
export interface IntroEvent {
  kind: 'click' | 'key';
  x: number;
  y: number;
  buttons: number;
}

export interface IntroHost {
  /** `d.LogicalScreenBase` — the whole 320x200 screen as palette indices. */
  readonly screen: PaletteIndexViewportBuffer;
  /** The `graphics.dat` tables; these screens want the 0x232 rectangles and palettes. */
  readonly uiTables: UITables;
  /**
   * The shifter's sixteen colour registers (`globalPalette` in `_FadeToPalette`,
   * `doc/CSBwin-src/Graphics.cpp:1609`). Mutated in place by `fadeToPalette`; `present`
   * reads it.
   */
  readonly globalPalette: number[];
  /** `ReadAndExpandGraphic(n, …)` — one `graphics.dat` item, one byte per pixel. */
  getGraphic(graphicNum: number): IndexedBitmap;
  /** Push `screen` to the canvas through `globalPalette`. */
  present(): void;
  /** `wvbl()` / `VBLDelay(n)` — wait `count` vertical blanks at 60 Hz. */
  vbl(count: number): Promise<void>;
  /** `StartSound(graphic, timerData, 1)`; see `timerDataToRateIndex`. */
  startSound(graphicNum: number, rateIdx: number): void;
  /**
   * `DrawViewport(2, 2, 0)` over the synthetic 5x5 level `_TAG01f5ea` builds
   * (`doc/CSBwin-src/CSBCode.cpp:9556-9576`). Returns `d.pViewportBMP`: the 224x136
   * dungeon interior seen through the prison doorway.
   */
  drawPrisonInterior(): IndexedBitmap;
  /** The next click or keypress. Modal, the way `d.PrimaryButtonList` is modal. */
  nextEvent(): Promise<IntroEvent>;
  /** `DiscardAllInput()`. */
  discardAllInput(): void;
  /**
   * `STShowCursor` / `STHideCursor` (`doc/CSBwin-src/Mouse.cpp:1818`, `:1839`).
   *
   * CSBWin's cursor is drawn by the VBL handler over whatever the screen already holds and
   * lifted again before the next frame, so it is never part of the picture. `present` here
   * does the same: it composites the arrow, pushes the frame, and puts back what was
   * underneath.
   */
  setCursorVisible(visible: boolean): void;
}

/**
 * `d.Palette11914` (`doc/CSBwin-src/Data.h:868`). Nothing in the whole CSBWin tree ever
 * writes it — the only references are its declaration and five `FadeToPalette` reads — and
 * `d` is a zero-initialised global, so "fade to `Palette11914`" means **fade to black**.
 */
export const PALETTE_11914: readonly number[] = new Array(16).fill(0);

/**
 * `DrawCursor` and `RemoveCursor` in one (`doc/CSBwin-src/CSBCode.cpp:2399`, `:2198`).
 *
 * The arrow's hot spot is its top-left corner — `d.Word23156` and `d.Word23158`, the two
 * offsets `CreateCursorBitmap` subtracts, are both 0 for the arrow and only become 8 for the
 * object cursor (`CSBCode.cpp:2260`, `:2094`). Colour 12 is transparent.
 */
export function withCursor(
  screen: PaletteIndexViewportBuffer,
  cursor: IndexedBitmap | null,
  x: number,
  y: number,
  present: () => void,
): void {
  if (!cursor) { present(); return; }
  const saved: { index: number; value: number }[] = [];
  for (let row = 0; row < cursor.height; row++) {
    const dy = y + row;
    if (dy < 0 || dy >= screen.height) continue;
    for (let col = 0; col < cursor.width; col++) {
      const dx = x + col;
      if (dx < 0 || dx >= screen.width) continue;
      const value = cursor.pixels[row * cursor.width + col] & 0x0f;
      if (value === CURSOR_TRANSPARENT) continue;
      const index = dy * screen.width + dx;
      saved.push({ index, value: screen.pixels[index] });
      screen.pixels[index] = value;
    }
  }
  present();
  for (const { index, value } of saved) screen.pixels[index] = value;
}

/** `Flood(d.CursorBitmap, 12, …)` (`doc/CSBwin-src/CSBCode.cpp:2276`). */
export const CURSOR_TRANSPARENT = 12;

/** A blank off-screen buffer, the shape `allocateMemory` + `TAG0088b2` expect. */
export function createIndexedBitmap(width: number, height: number): IndexedBitmap {
  return { width, height, pixels: new Uint8Array(width * height) };
}

/**
 * `_FadeToPalette` (`doc/CSBwin-src/Graphics.cpp:1601`).
 *
 * Eight vertical blanks, and on each one every colour register steps at most one unit
 * closer to the target in each of its three 3-bit components. Always exactly eight steps,
 * so a large jump does not finish — which is deliberate: the callers that want a hard cut
 * set the target and call it twice, and the ones that want "just delay"
 * (`doc/CSBwin-src/CSBCode.cpp:9342`) pass a palette that is already current.
 */
export async function fadeToPalette(host: IntroHost, target: readonly number[]): Promise<void> {
  const palette = host.globalPalette;
  for (let step = 0; step < 8; step++) {
    await host.vbl(1);
    for (let i = 0; i < 16; i++) {
      let current = palette[i] ?? 0;
      const want = target[i] ?? 0;
      if ((current & 0x007) > (want & 0x007)) current -= 0x001;
      else if ((current & 0x007) < (want & 0x007)) current += 0x001;
      if ((current & 0x070) > (want & 0x070)) current -= 0x010;
      else if ((current & 0x070) < (want & 0x070)) current += 0x010;
      if ((current & 0x700) > (want & 0x700)) current -= 0x100;
      else if ((current & 0x700) < (want & 0x700)) current += 0x100;
      palette[i] = current;
    }
    host.present();
  }
}

/**
 * The Atari ST's Timer-A data value, which is what CSBWin's `StartSound` calls its second
 * argument, turned into an index into this port's per-sound rate list.
 *
 * CSBWin **drops** that argument — `StartSound(ui8*, i32 /*timerData*\/, i32 highVolume)`
 * (`doc/CSBwin-src/Sound.cpp:647`) and then hard-codes 6000 Hz in `SoundDecode`
 * (`doc/CSBwin-src/Sound.cpp:293`). This port does not, because the rate is audible: the
 * prison door grinds open at timer 145 and the latch clicks at timer 112
 * (`doc/CSBwin-src/CSBCode.cpp:9399`, `:9536`).
 *
 * The two numbers reduce to the rates this project already ships. With the MFP's 1:4
 * prescaler the sample rate is `2457600 / 4 / timerData`, so 112 -> 5485.7 Hz and
 * 145 -> 4237.2 Hz — which are, to the Hertz, `ratesDefault[0]` and the door's second
 * variant in `src/audio/soundsIndex.ts`. See `doc/PROVEN_FACTS.md` -> "Audio sample rates".
 */
export function timerDataToRateIndex(timerData: number): number {
  return timerData === 145 ? 1 : 0;
}
