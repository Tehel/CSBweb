/**
 * The Hint Oracle's screen, `HintOracleScreen` (`src/renderer/intro/HintOracle.ts`), run
 * headlessly over the retail `hcsb.hct` and `hcsb.dat`, with a host whose VBL returns at
 * once and whose clicks come from a script.
 *
 * 1. **The title list** at level 0 (3,23): CREATURES, THE MAZE and FULYA PIT, with DONE
 *    and their three lines up and no other; first up after the VBLs the load's window and
 *    the build take; each title in item 0's word 0 ink inside a frame of word 6's colour,
 *    DONE's label in word 2's; item 0's slot at word 3; and the `TAG0062a2` remap of each
 *    title line, colour 12 to 9, short of its last line and a half.
 * 2. **The cycle**: slot word 8 stepping through words 36 on, every 21 VBLs.
 * 3. **A hint's pages**: FULYA PIT, three pages, NEXT and LAST offered as `_TAG007fdc_36`
 *    offers them, each page's text inside its rectangle, a pressed button's label flashed
 *    in word 7's ink, and DONE back to the same title list, then closing the Oracle.
 *    A click on no button does nothing, and the right button presses a button too.
 * 4. **No clues**: a level with no records shows `text15024[4]` with DONE alone.
 * 5. **The ninth title**: no square of the retail file has more than seven hints, so the
 *    eight title lines of `s20_16208` are enough (`doc/CSBWIN_HINT_ORACLE_REFERENCE.md`).
 *
 * Run: `npm test -- --only=dump-hint-oracle-screen.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { HINT_ANYWHERE, parseHcsbDat, parseHintOracle } from '../src/data/HintOracleLoader';
import type { Rect } from '../src/data/tables/UITables';
import type { IntroEvent } from '../src/renderer/intro/IntroHost';
import { HINT_BUTTON, HintOracleScreen, hintButtonRect, type HintOracleHost, type HintSquare } from '../src/renderer/intro/HintOracle';
import { SCREEN_HEIGHT, SCREEN_WIDTH } from '../src/renderer/ViewportGraphics';
import { check, finish } from './lib/check';
import { standInOf } from './lib/standIn';

const oracle = parseHintOracle(new Uint8Array(readFileSync(resolve('tools/fixtures/gamefiles/csb/hcsb.hct'))));
const dat = parseHcsbDat(new Uint8Array(readFileSync(resolve('tools/fixtures/gamefiles/csb/hcsb.dat'))));
const seg = dat.segment1;
const { LAST, NEXT, DONE, FIRST_TITLE } = HINT_BUTTON;

/** A colour no Oracle picture uses, for the screen the Oracle opens over. */
const GAME_SCREEN = 15;

/** One step of a script: what to look at while the Oracle waits, and the click it then gets. */
type Step = (o: HintOracleScreen, run: Run) => IntroEvent | null;

interface Run {
  o: HintOracleScreen;
  screen: Uint8Array;
  palette: number[];
  /** The palette's slot word 8 at every VBL spent waiting on the title list. */
  cycle: { vbl: number; colour: number }[];
  /** Whether a flash, word 7's ink in the button pressed, was seen on the screen. */
  flashes: number[];
}

/** Run the Oracle on `square`, answering each wait with the next step's click. */
async function runOracle(square: HintSquare, steps: Step[], waitVbls = 0): Promise<Run> {
  const screen = { width: SCREEN_WIDTH, height: SCREEN_HEIGHT, pixels: new Uint8Array(SCREEN_WIDTH * SCREEN_HEIGHT).fill(GAME_SCREEN) };
  const run = standInOf<Run>({ screen: screen.pixels, palette: new Array(16).fill(0x777), cycle: [], flashes: [] });
  const queue: IntroEvent[] = [];
  let step = 0;
  let waited = 0;
  let pressed: Rect | null = null;
  const host: HintOracleHost = {
    screen,
    globalPalette: run.palette,
    present: () => {},
    vbl: async () => {
      const o = run.o;
      if (pressed && !o.waiting && countIn(run.screen, pressed, seg[7]!) > 0) {
        run.flashes.push(o.vblCount);
        pressed = null;
      }
      if (!o.waiting || queue.length > 0 || step >= steps.length) return;
      if (o.w_4 === 2 && o.numHint10552 > 0 && waited < waitVbls) {
        waited++;
        run.cycle.push({ vbl: o.vblCount, colour: run.palette[seg[8]!]! });
        return;
      }
      const click = steps[step++]!(o, run);
      if (click) queue.push(click);
      const id = click ? buttonAt(click) : 0;
      pressed = id ? hintButtonRect(id) : null;
    },
    takeClick: () => queue.shift() ?? null,
    discardAllInput: () => { queue.length = 0; },
  };
  run.o = new HintOracleScreen(host, oracle, dat, square);
  await run.o.run();
  check(step === steps.length, `the script ran to its end (${step} of ${steps.length} steps)`);
  return run;
}

function buttonAt(click: IntroEvent): number {
  for (const id of [LAST, NEXT, DONE, ...Array.from({ length: 8 }, (_, i) => FIRST_TITLE + i)]) {
    const r = hintButtonRect(id)!;
    if (click.x >= r.x1 && click.x <= r.x2 && click.y >= r.y1 && click.y <= r.y2) return id;
  }
  return 0;
}

const press = (id: number, buttons = 2): IntroEvent => {
  const r = hintButtonRect(id)!;
  return { kind: 'click', x: (r.x1 + r.x2) >> 1, y: (r.y1 + r.y2) >> 1, buttons };
};

function countIn(pixels: Uint8Array, r: Rect, colour: number): number {
  let n = 0;
  for (let y = r.y1; y <= r.y2; y++) for (let x = r.x1; x <= r.x2; x++) if (pixels[y * SCREEN_WIDTH + x] === colour) n++;
  return n;
}

/** Whether every pixel of `colour` on the screen lies inside `r`. */
function onlyIn(pixels: Uint8Array, r: Rect, colour: number): boolean {
  let all = 0;
  for (const p of pixels) if (p === colour) all++;
  return all === countIn(pixels, r, colour);
}

const same = <T>(a: readonly T[], b: readonly T[]): boolean => a.length === b.length && a.every((v, i) => v === b[i]);
const line = (n: number): Rect => hintButtonRect(FIRST_TITLE + n)!;
const titleInk = seg[0]!;
const labelInk = seg[2]!;

/* -------------------------------------------- 1-3. the title list and a hint ---- */

const FULYA = 2;
const fulya = oracle.hints.find((h) => h.title === 'FULYA PIT')!;
check(fulya.pages.length === 3, `FULYA PIT has three pages (got ${fulya.pages.length})`);
const pageRect: Rect = { x1: 34, x2: 285, y1: 31, y2: 164 };

/** The title list as it should be when the Oracle waits on it. */
function titleList(o: HintOracleScreen, screen: Uint8Array, palette: number[], when: string): void {
  check(same(o.titles(), ['CREATURES', 'THE MAZE', 'FULYA PIT']), `${when}: the titles are CREATURES, THE MAZE, FULYA PIT (got ${o.titles().join(', ')})`);
  check(same(o.enabledButtons(), [DONE, 10, 11, 12]), `${when}: DONE and the three lines are up (got ${o.enabledButtons().join(' ')})`);
  for (let n = 0; n < 3; n++) {
    const r = line(n);
    check(countIn(screen, r, titleInk) > 0, `${when}: title ${n + 1} is drawn in word 0's ink`);
    const frame = { x1: r.x1 - 1, x2: r.x2 + 1, y1: r.y1 - 1, y2: r.y1 - 1 };
    check(countIn(screen, frame, seg[6]!) === frame.x2 - frame.x1 + 1, `${when}: title ${n + 1}'s frame, above it, is word 6's colour`);
    // `TAG0062a2`: ShrinkBLT's 240-pixel lines over the copy's 256 remap the first 11
    // lines whole and 64 pixels of the twelfth; the thirteenth keeps its colour 12.
    const remapped = { ...r, y2: r.y1 + 10 };
    check(countIn(screen, remapped, 12) === 0, `${when}: title ${n + 1}'s first eleven lines hold no colour 12`);
    check(countIn(screen, { ...r, y1: r.y1 + 11, y2: r.y1 + 11, x2: r.x1 + 63 }, 12) === 0
      && countIn(screen, { ...r, y1: r.y1 + 11, y2: r.y1 + 11, x1: r.x1 + 64 }, 12) > 0,
      `${when}: title ${n + 1}'s twelfth line is remapped for its first 64 pixels only`);
  }
  check(countIn(screen, line(3), titleInk) === 0, `${when}: the fourth line is empty`);
  check(countIn(screen, hintButtonRect(DONE)!, labelInk) > 0, `${when}: DONE's label is in word 2's ink`);
  check(countIn(screen, hintButtonRect(NEXT)!, labelInk) === 0 && countIn(screen, hintButtonRect(LAST)!, labelInk) === 0,
    `${when}: NEXT and LAST have no label`);
  check(!screen.includes(GAME_SCREEN), `${when}: nothing of the screen the Oracle opened over is left`);
  // Slot word 8 is the cycle's, checked below.
  const want = dat.palette.slice();
  want[seg[0]!] = seg[3]!;
  want[seg[8]!] = palette[seg[8]!]!;
  check(same(palette, want), `${when}: the palette is item 3, slot ${seg[0]} at word 3`);
}

/** A page of FULYA PIT as it should be when the Oracle waits on it. */
function page(o: HintOracleScreen, screen: Uint8Array, n: number, buttons: number[]): void {
  check(o.w_4 === 4 && o.curPage10484 === n, `page ${n} of FULYA PIT is up (screen ${o.w_4}, page ${o.curPage10484})`);
  check(same(o.enabledButtons(), buttons), `page ${n}: buttons ${buttons.join(' ')} are up (got ${o.enabledButtons().join(' ')})`);
  check(countIn(screen, pageRect, titleInk) > 0 && onlyIn(screen, pageRect, titleInk), `page ${n}: its text is drawn, inside x 34-285, y 31-164`);
}

// Three VBLs short of the cycle's first step, the first wait. The load's two fades are 2
// VBLs a step for 7 steps, 28 VBLs. The build: four labels (DONE and the three titles),
// a VBL each; the fades of words 12-13 (2 x 6) and 10-11 (1 x 1); after the swap a VBL,
// the four labels again and the three titles, eight VBLs past the swap, so the wait for
// word 9's 3 takes one more; the fades of words 10-11 and 12-13. 28 + 17 + 9 + 13 = 67.
const FIRST_WAIT_VBL = 28 + (4 + 12 + 1) + (1 + 4 + 3 + 1) + (1 + 12);

async function main(): Promise<void> {
let firstWait = -1;
const run = await runOracle({ level: 0, x: 3, y: 23 }, [
  (o, r) => {
    firstWait = o.vblCount;
    titleList(o, r.screen, r.palette, 'first up');
    return { kind: 'click', x: 5, y: 5, buttons: 2 };
  },
  (o) => {
    check(o.w_4 === 2 && o.waiting, 'a click on no button leaves the title list waiting');
    return press(FIRST_TITLE + FULYA);
  },
  (o, r) => { page(o, r.screen, 1, [DONE, NEXT]); return press(NEXT); },
  (o, r) => { page(o, r.screen, 2, [DONE, NEXT, LAST]); return press(NEXT, 1); },
  (o, r) => { page(o, r.screen, 3, [DONE, LAST]); return press(LAST); },
  (o, r) => { page(o, r.screen, 2, [DONE, NEXT, LAST]); return press(DONE); },
  (o, r) => { titleList(o, r.screen, r.palette, 'back from the pages'); return press(DONE); },
], 70);

check(firstWait === FIRST_WAIT_VBL + 70, `the title list waits from VBL ${FIRST_WAIT_VBL} (then 70 of the cycle; got ${firstWait})`);
// The cycle: `f.Long14110 + 20 < VBLCount`, so a colour every 21 VBLs, from word 36.
// Its first step sets word 36 again, the colour the list was built with, so 70 VBLs
// show three colours.
const changes = run.cycle.filter((c, i) => i > 0 && c.colour !== run.cycle[i - 1]!.colour);
const shown = [run.cycle[0]!.colour, ...changes.map((c) => c.colour)];
check(same(shown, [seg[36]!, seg[37]!, seg[38]!]), `in 70 VBLs the slot shows words 36, 37 and 38 (got ${shown.map((c) => c.toString(16)).join(' ')})`);
check(changes.length === 2 && changes[1]!.vbl - changes[0]!.vbl === 21, 'a step every 21 VBLs');
// Six buttons pressed (FULYA PIT, NEXT twice, LAST, DONE twice); the click on nothing flashes nothing.
check(run.flashes.length === 6, `each of the six buttons pressed flashed in word 7's ink (got ${run.flashes.length})`);

/* ---------------------------------------------------------------- 4. no clues ---- */

const noClues = await runOracle({ level: 10, x: 3, y: 23 }, [
  (o, r) => {
    check(o.numHint10552 === 0, 'level 10 has no hints');
    check(same(o.enabledButtons(), [DONE]), `DONE alone is up (got ${o.enabledButtons().join(' ')})`);
    const box = { x1: 31, x2: 290, y1: 70, y2: 150 };
    check(countIn(r.screen, box, titleInk) > 0 && onlyIn(r.screen, box, titleInk),
      '"There are no clues for this location." is drawn inside text15024[4]\'s rectangle');
    return press(DONE);
  },
]);
check(noClues.o.w_4 === 2, 'DONE on it closes the Oracle');

/* ------------------------------------------------------------- 5. ninth title ---- */

// Level 0 (0,0) is left out: the fifteen all-zero records match it, and it is stone
// (`doc/CSBWIN_HINT_ORACLE_REFERENCE.md` → "A location record").
let most = 0;
let where = '';
for (let level = 0; level < 16; level++) {
  const anywhere = oracle.locations.filter((l) => l.level === level && l.x === HINT_ANYWHERE && l.y === HINT_ANYWHERE).length;
  const squares = new Map<number, number>();
  for (const l of oracle.locations) {
    if (l.level !== level || (l.x === HINT_ANYWHERE && l.y === HINT_ANYWHERE)) continue;
    squares.set(l.x * 256 + l.y, (squares.get(l.x * 256 + l.y) ?? 0) + 1);
  }
  for (const [key, n] of [...squares, [-1, 0] as [number, number]]) {
    if (level === 0 && key === 0) continue;
    if (anywhere + n > most) { most = anywhere + n; where = `level ${level} (${key >> 8},${key & 255})`; }
  }
}
console.log(`most hints on one square: ${most}, ${where}`);
check(most <= 7, 'no square has more than seven hints, so no title needs a ninth line');

finish();
}

main().catch((e: unknown) => { console.error(e); process.exit(1); });
