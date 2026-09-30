/**
 * Changing the marching order: `TAG0025a6` (`doc/CSBwin-src/CSBCode.cpp:2053`), which the
 * four squares of the top view of positions, buttons 125-128, reach
 * (`doc/CSBwin-src/Mouse.cpp:1586-1597`).
 *
 * A click on a champion's square picks them up: the square turns black and becomes the
 * cursor, over a black shadow two pixels down and right. A second click puts them down,
 * facing the party's way, and whoever stood there takes the square they left. The pointer
 * leaving the top view lets go (`CSBCode.cpp:938-945`).
 *
 * What to look for: each row is a click, with the four champions' positions and facings
 * after it. The two that swap swap, and only the one put down turns to face the party's
 * way.
 *
 * Run: `npx tsx tools/dump-marching-order.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Direction, Position } from '../src/core/types';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { DungeonState } from '../src/engine/DungeonState';
import { Party } from '../src/engine/Party';
import { assignPresetHeroPossessions, createChampionFromPreset } from '../src/engine/AddCharacter';
import type { AddCharacterTables } from '../src/engine/AddCharacter';
import type { PartyState } from '../src/engine/gameTypes';
import { createPaletteIndexViewportBuffer, type IndexedBitmap } from '../src/renderer/csbwin/CanvasBlitter';
import { extractObjectTables } from '../src/data/tables/ObjectTables';
import { loadFontData } from '../src/renderer/csbwin/TextRenderer';
import { extractUITables } from '../src/data/tables/UITables';
import { extractViewportTables } from '../src/data/tables/ViewportTables';
import { createUIState, type UIState } from '../src/renderer/ui/UIState';
import { drawPartyStatus, drawPositionSquare } from '../src/renderer/ui/Character';
import { SCREEN_HEIGHT, SCREEN_WIDTH } from '../src/renderer/ViewportGraphics';
import { check, finish } from './lib/check';

/** `ui/Mouse` reaches the debug chrome through `@/ui`; see `dump-hand-owner.ts`. */
async function importMouse(): Promise<typeof import('../src/renderer/ui/Mouse')> {
  const g = globalThis as Record<string, unknown>;
  if (!g.document) g.document = { getElementById: () => null, addEventListener: () => {} };
  if (!g.window) g.window = g;
  return import('../src/renderer/ui/Mouse');
}

function positions(party: PartyState): string {
  return party.champions.map((c) => `${c.partyPosition}/${c.facing}`).join(' ');
}

async function main(): Promise<void> {
  const loader = new DungeonLoader();
  await loader.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/dungeon.dat'))));
  const data = loader.getData();
  if (!data) throw new Error('dungeon.dat did not load');
  const graphics = new GraphicsLoader();
  graphics.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/graphics.dat'))));
  const uiTables = extractUITables(graphics);
  const viewportTables = extractViewportTables(graphics);
  const objectTables = extractObjectTables(graphics, viewportTables.wallRectanglesOffset);
  const addTables: AddCharacterTables = {
    carryLocation: uiTables.graphic232.carryLocation,
    objDescCarryMask: objectTables.objDescCarryMask,
  };
  const g232 = uiTables.graphic232;

  // Three of the Hall of Champions' heroes, at positions 0, 1 and 2, all facing west
  // while the party faces north, so a champion put down visibly turns.
  const party = new Party(new Position(1, 1, 0), Direction.NORTH);
  const heroes = data.presetHeroes ?? [];
  for (let i = 0; i < 3; i++) {
    const champion = createChampionFromPreset(heroes[i], i, assignPresetHeroPossessions(heroes[i].inventory, addTables));
    champion.facing = Direction.WEST;
    party.addChampion(champion);
  }
  const state = party.state;

  const bitmaps = new Map<number, IndexedBitmap>();
  const ui: UIState = createUIState(graphics, new DungeonState(data), {
    getGraphicBitmap: (n: number) => {
      let bitmap = bitmaps.get(n);
      if (!bitmap) {
        const image = graphics.getImage(n);
        bitmap = { width: image.width, height: image.height, pixels: Uint8Array.from(image.pixels) };
        bitmaps.set(n, bitmap);
      }
      return bitmap;
    },
    renderLastFrame: () => {},
  });
  ui.uiTables = uiTables;
  ui.partyState = state;
  ui.fontData = loadFontData(graphics);
  ui.screenIndexBuffer = createPaletteIndexViewportBuffer(SCREEN_WIDTH, SCREEN_HEIGHT, 0);

  const mouse = await importMouse();
  mouse.updateButtonLists(ui);

  // ---- The four squares are buttons 125-128 of `Buttons17196`, in `wRectPos1454`'s
  //      order, for the left button (mask 2, `src/ui/events.ts`).
  for (let i = 0; i < 4; i++) {
    const r = g232.wRectPos1454[i];
    const id = mouse.searchMouseButtons(ui, (r.x1 + r.x2) >> 1, (r.y1 + r.y2) >> 1, 2);
    check(id === 125 + i, `square ${i} should be button ${125 + i}, got ${id}`);
  }

  console.log(['click', 'word23144', 'positions/facings'].join('\t'));
  const click = (what: string, square: number): void => {
    mouse.handleMouseButton(ui, 125 + square, 0, 0);
    console.log([what, ui.word23144, positions(state)].join('\t'));
  };

  // ---- An empty square picks nobody up (`CSBCode.cpp:2063-2064`).
  click('empty square 3', 3);
  check(ui.word23144 === 0, 'an empty square should pick nobody up');

  // ---- Pick up champion 0: the cursor is the square over its shadow (`:2069-2107`).
  click('pick up square 0', 0);
  check(ui.word23144 === 1, 'picking up square 0 should set d.Word23144 to 1');
  const square = createPaletteIndexViewportBuffer(19, 14);
  drawPositionSquare(ui, square, { x1: 0, y1: 0, x2: 18, y2: 13 }, 0, state.champions[0], state.facing);
  const at = (b: IndexedBitmap, x: number, y: number): number => b.pixels[y * b.width + x];
  const inSquare = (x: number, y: number): number => (x <= 18 && y <= 13 ? at(square, x, y) : 0);
  let bad23178 = 0;
  let bad23182 = 0;
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 32; x++) {
      const own = inSquare(x, y);
      const shadow = x >= 2 && y >= 2 && inSquare(x - 2, y - 2) !== 0;
      const want23178 = own !== 0 ? own : shadow ? 0 : 12;
      const want23182 = own !== 0 ? 4 : shadow ? 0 : 12;
      if (at(ui.pointer23178!, x, y) !== want23178) bad23178++;
      if (at(ui.pointer23182!, x, y) !== want23182) bad23182++;
    }
  }
  check(bad23178 === 0, `d.Pointer23178 should be the square over a black shadow (${bad23178} pixels off)`);
  check(bad23182 === 0, `d.Pointer23182 should be the square's colour-4 silhouette over it (${bad23182} pixels off)`);

  // ---- While in hand, the square is black (`:2108-2111`), and the cursor is drawn 9
  //      pixels left of and 7 above the pointer; in the dungeon view the rows on screen
  //      row 29 and below come from `d.Pointer23182` (`:2325-2386`).
  drawPartyStatus(ui);
  const r0 = g232.wRectPos1454[0];
  const screen = ui.screenIndexBuffer!;
  let lit = 0;
  for (let y = r0.y1; y <= r0.y2; y++) for (let x = r0.x1; x <= r0.x2; x++) if (screen.pixels[y * 320 + x] !== 0) lit++;
  check(lit === 0, `the square a champion was picked up from should be black (${lit} pixels lit)`);
  ui.hoverPoint = { x: 290, y: 26 };
  screen.pixels.fill(1);
  mouse.drawCursorItem(ui, true);
  let badCursor = 0;
  for (let row = 0; row < 16; row++) {
    for (let col = 0; col <= 20; col++) {
      const src = 19 + row >= 29 ? ui.pointer23182! : ui.pointer23178!;
      const p = at(src, col, row);
      const want = p === 12 ? 1 : p;
      if (screen.pixels[(19 + row) * 320 + 281 + col] !== want) badCursor++;
    }
  }
  check(badCursor === 0, `the cursor should sit at (281, 19), split at row 29 (${badCursor} pixels off)`);
  screen.pixels.fill(1);
  mouse.drawCursorItem(ui, false);
  check(screen.pixels[(19 + 12) * 320 + 281 + 5] === (at(ui.pointer23178!, 5, 12) === 12 ? 1 : at(ui.pointer23178!, 5, 12)),
    'with the inventory open the cursor should be d.Pointer23178 throughout');

  // ---- The pointer moving inside the top view keeps them; leaving it lets go.
  mouse.marchingOrderPointerMoved(ui, 274, 28);
  check(ui.word23144 === 1, 'the pointer at (274, 28) is still inside the top view');
  mouse.marchingOrderPointerMoved(ui, 273, 10);
  console.log(['pointer left', ui.word23144, positions(state)].join('\t'));
  check(ui.word23144 === 0, 'the pointer leaving the top view should let go');
  check(state.champions[0].partyPosition === 0 && state.champions[0].facing === Direction.WEST,
    'letting go should move and turn nobody');

  // ---- Put down on another champion's square: the two swap, and only the one put down
  //      turns to face the party's way (`:2118-2150`).
  click('pick up square 0', 0);
  click('put down on square 1', 1);
  check(state.champions[0].partyPosition === 1 && state.champions[1].partyPosition === 0,
    'champions 0 and 1 should have swapped squares');
  check(state.champions[0].facing === state.facing, 'the champion put down should face the party\'s way');
  check(state.champions[1].facing === Direction.WEST, 'the champion displaced should keep their facing');

  // ---- Put down on an empty square: a plain move.
  click('pick up square 2', 2);
  click('put down on square 3', 3);
  check(state.champions[2].partyPosition === 3, 'champion 2 should have moved to the empty square');

  // ---- Put down where picked up: only the facing changes.
  click('pick up square 3', 3);
  click('put down on square 3', 3);
  check(state.champions[2].partyPosition === 3 && state.champions[2].facing === state.facing,
    'put down on their own square, champion 2 should only turn');

  // ---- Squares count from the party's facing: facing east, square 0 is position 1.
  state.facing = Direction.EAST;
  click('east: pick up square 0', 0);
  click('east: put down on square 3', 3);
  check(state.champions[0].partyPosition === 0 && state.champions[1].partyPosition === 1,
    'facing east, square 0 is position 1 (champion 0) and square 3 is position 0 (champion 1)');
  state.facing = Direction.NORTH;

  // ---- A champion who dies in hand stays in hand: `KillCharacter` clears d.Word23244,
  //      not d.Word23144 (`Character.cpp:2653-2658`). Put down, they are -1, and only the
  //      champion on the target square moves.
  click('pick up square 1', 1);
  const dying = state.champions[1];
  check(dying.partyPosition === 1, 'champion 1 should be the one on square 1');
  dying.attributes.health = 0;
  click('dead, put down on square 0', 0);
  check(ui.word23144 === 0, 'putting down a dead champion should still empty the hand');
  check(dying.partyPosition === 1, 'the dead champion should stay where they died');
  check(state.champions[0].partyPosition === 1, 'the champion on square 0 should have moved to square 1');

  // ---- The top view has a square for a living champion only: the dead champion 1 and
  //      the empty fourth box have none (`Character.cpp:1308`, `:2664-2667`), so the dead
  //      champion does not paint over champion 0, who shares their square. The screen is
  //      cleared first, as `GameScreen.presentViewport` does.
  screen.pixels.fill(0);
  drawPartyStatus(ui);
  const byte1386 = g232.byte1386;
  const squares: string[] = [];
  for (let sq = 0; sq < 4; sq++) {
    const r = g232.wRectPos1454[sq];
    const counts = [0, 0, 0, 0];
    let lit = 0;
    for (let y = r.y1; y <= r.y2; y++) {
      for (let x = r.x1; x <= r.x2; x++) {
        const p = screen.pixels[y * 320 + x];
        if (p !== 0) lit++;
        for (let c = 0; c < 4; c++) if (p === byte1386[c]) counts[c]++;
      }
    }
    const owner = state.champions.findIndex((c) => c.attributes.health !== 0 && c.partyPosition === sq);
    squares.push(`${sq}:${owner < 0 ? '-' : owner}/${lit}`);
    if (owner < 0) {
      check(lit === 0, `square ${sq} has no living champion and should be black (${lit} pixels lit)`);
    } else {
      check(counts[owner] > 0, `square ${sq} should carry champion ${owner}'s colour ${byte1386[owner]}`);
      for (let c = 0; c < 4; c++) {
        if (c !== owner) check(counts[c] === 0, `square ${sq} should carry no colour of box ${c} (${counts[c]} pixels)`);
      }
    }
  }
  console.log(['top view', 'square:owner/lit', squares.join(' ')].join('\t'));

  // ---- The fourth box, with nobody in it, stays black: `DrawAllCharacterState` draws
  //      boxes 0..d.NumCharacter-1 only (`CSBCode.cpp:6831-6834`), and a box emptied is
  //      filled with colour 0 (`:6641-6649`, `Character.cpp:5387-5398`).
  let emptyLit = 0;
  for (let y = 0; y <= 28; y++) for (let x = 69 * 3; x <= 69 * 3 + 66; x++) if (screen.pixels[y * 320 + x] !== 0) emptyLit++;
  console.log(['empty box 3', 'lit', emptyLit].join('\t'));
  check(emptyLit === 0, `the box of a champion not in the party should be black (${emptyLit} pixels lit)`);

  // ---- `GameScreen.setPartyState` empties the hand for another game (`CSBCode.cpp:10485`)
  //      — covered by reading; it has no engine to drive here.

  finish();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
