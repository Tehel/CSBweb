/**
 * Prove the button flash: `FlashButton`, the VBL that inverts its rectangle, and
 * `WaitForButtonFlash`, which has the next VBL put it back.
 *
 * - `_FlashButton` stores the rectangle, sets `d.FlashButnActive` and waits a VBL
 *   (doc/CSBwin-src/CSBCode.cpp:7713-7730). The VBL clears `d.FlashButnActive`, toggles
 *   `d.Word11776` and inverts the rectangle (`:1028-1038`). The port's pass does not stop
 *   for the VBL: the rectangle is inverted at once, before the rest of the pass.
 * - `WaitForButtonFlash` sets `d.FlashButnActive` again while `d.Word11776` is set
 *   (`:8561-8601`), so the next VBL puts the rectangle back. The main loop calls it at
 *   `tag000730`, after the tick's `DrawViewport` (`:638`, `:655`), and on a pass without a
 *   tick (`:763`). So the tick after a move draws the arrow inverted, and the next VBL puts
 *   it back: one frame of flash.
 * - `_TurnParty` flashes `(0xea, 0x0105, 0x7d, 0x91)` for a turn left and `(0x123, 0x13e,
 *   0x7d, 0x91)` for a turn right (`:7896-7903`); `HandleMouseEvents` flashes the step
 *   arrow `d.MoveButn18496[button - 3]` that `MoveParty` returns (`Mouse.cpp:1556-1567`,
 *   `CSBCode.cpp:8137-8139`), even a step a wall refuses, which brings no tick (`:8310-8314`).
 * - `CastMagic` calls `WaitForButtonFlash` first (`Magic.cpp:939`).
 * - `vblFlashButn` flips bit plane 2 over the rectangle, corners included (`VBL.cpp:60-122`),
 *   which is bit 2 of the pixel's index (`WinScreen.cpp:314-330`).
 *
 * Run: `npx tsx tools/dump-button-flash.ts [level]`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { OBJECT_ID_EOF, Position, RoomType } from '../src/core/types';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { addCharacterDefaults } from '../src/engine/AddCharacter';
import { makeAddCharacterAttributes } from '../src/engine/attributes';
import { emptyPossessions, MovementAction, type Champion } from '../src/engine/gameTypes';
import { flashButton, waitForButtonFlash } from '../src/engine/LoopState';
import { createPaletteIndexViewportBuffer, vblFlashButn } from '../src/renderer/csbwin/CanvasBlitter';
import type { Rect } from '../src/renderer/csbwin/UITables';
import { newGame } from './lib/game';
import { check, finish } from './lib/check';

const TURN_LEFT: Rect = { x1: 0xea, x2: 0x0105, y1: 0x7d, y2: 0x91 };
const TURN_RIGHT: Rect = { x1: 0x123, x2: 0x13e, y1: 0x7d, y2: 0x91 };

const show = (r: Rect | null): string => (r ? `(${r.x1}-${r.x2}, ${r.y1}-${r.y2})` : 'none');
const same = (a: Rect | null, b: Rect): boolean =>
  a !== null && a.x1 === b.x1 && a.x2 === b.x2 && a.y1 === b.y1 && a.y2 === b.y2;

async function main(): Promise<void> {
  const loader = new DungeonLoader();
  await loader.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/dungeon.dat'))));
  const data = loader.getData();
  if (!data) throw new Error('dungeon.dat did not load');
  const graphics = new GraphicsLoader();
  graphics.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/graphics.dat'))));

  const level = Number(process.argv[2] ?? 1);
  const game = newGame(data, graphics);
  game.setRandomSeed(0x12345678);
  game.party.state.position = new Position(0, 0, level);
  game.monsterSystem.loadPartyLevel(level);
  const loop = game.ctx.loop;

  // ---- vblFlashButn: plane 2, corners included ------------------------------------
  const buffer = createPaletteIndexViewportBuffer(320, 200, 0x0b);
  vblFlashButn(buffer, TURN_LEFT);
  const at = (x: number, y: number): number => buffer.pixels[y * 320 + x]!;
  console.log(`vblFlashButn over index 11: corners ${at(234, 125)}/${at(261, 145)}, ` +
    `outside ${at(233, 125)}/${at(262, 145)}/${at(234, 124)}/${at(261, 146)}`);
  check(at(234, 125) === 0x0f && at(261, 145) === 0x0f && at(248, 135) === 0x0f,
    'vblFlashButn should flip bit 2 of every pixel in the rectangle, corners included');
  check(at(233, 125) === 0x0b && at(262, 145) === 0x0b && at(234, 124) === 0x0b && at(261, 146) === 0x0b,
    'vblFlashButn should leave every pixel outside the rectangle alone');

  // ---- the step arrows' rectangles -------------------------------------------------
  const moveButtons = game.ctx.tables.moveButtons;
  console.log(`d.MoveButn18496: ${moveButtons.map(show).join(' ')}`);
  check(moveButtons.length === 4 && moveButtons.every((b) => b.x1 >= 192 && b.x1 < b.x2 && b.y1 < b.y2),
    'the four step arrows should be rectangles right of x = 192');

  // An open cell with an open, monster-free cell in front. The party is empty, so a step
  // costs no stamina and sets no delay.
  const dungeon = game.dungeonState;
  const map = dungeon.getMap(level);
  if (!map) throw new Error(`level ${level} does not exist`);
  const { width, height } = map.descriptor;
  const open = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < width && y < height &&
    ((dungeon.getCellFlag(new Position(x, y, level)) >> 5) & 0x7) === RoomType.OPEN &&
    dungeon.findFirstMonster(new Position(x, y, level)) === OBJECT_ID_EOF;
  const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;
  let scene: { x: number; y: number; dir: number } | null = null;
  for (let x = 0; x < width && !scene; x++) {
    for (let y = 0; y < height && !scene; y++) {
      if (!open(x, y)) continue;
      for (let dir = 0; dir < 4; dir++) {
        if (open(x + DIRS[dir]![0], y + DIRS[dir]![1])) { scene = { x, y, dir }; break; }
      }
    }
  }
  if (!scene) throw new Error(`level ${level} has no open cell with an open neighbour`);
  const party = game.party.state;
  party.champions = [];
  game.setMouseEventHandlers({ button: () => {}, unclick: () => {} });

  type Internals = { lastTickTime: number; lastInputTime: number };
  const internals = game as unknown as Internals;
  let t = Date.now() + 60_000;
  /** One VBL; `tickDue` makes a game tick run in it, after the queue. */
  const frame = (tickDue = false): void => {
    t += 17;
    internals.lastTickTime = tickDue ? t - 1000 : t;
    game.runFrame(t);
  };
  let drawnInTick: Rect | null | undefined;
  game.onTick(() => { drawnInTick = game.flashedButton(); });
  const reset = (): void => {
    game.discardAllInput();
    party.position = new Position(scene!.x, scene!.y, level);
    game.party.setFacing(scene!.dir);
    party.partyMoveDisableTimer = 0;
    party.word11712 = 0;
    internals.lastInputTime = 0;
    frame();
    frame();
    game.takeFlashChanged();
    drawnInTick = undefined;
  };
  frame(true);
  frame(true);

  /**
   * Queue `enqueue`, then three VBLs: the move's (whose tick it brings on at once), the
   * next, and one more. What the tick drew, and what stands inverted after each.
   */
  const flashOf = (what: string, enqueue: () => void): { tick: Rect | null | undefined; after: Array<Rect | null>; changed: boolean[]; active: boolean } => {
    reset();
    enqueue();
    frame();
    const active = loop.flashButnActive;
    const after = [game.flashedButton()];
    const changed = [game.takeFlashChanged()];
    for (let i = 0; i < 2; i++) {
      frame();
      after.push(game.flashedButton());
      changed.push(game.takeFlashChanged());
    }
    console.log(`${what}: the tick drew ${show(drawnInTick ?? null)}; inverted after each VBL ` +
      `${after.map(show).join(', ')}; redraw due ${changed.join('/')}`);
    return { tick: drawnInTick, after, changed, active };
  };

  // ---- a turn, from a key ----------------------------------------------------------
  const left = flashOf('turn left', () => game.enqueueMovement(MovementAction.TURN_LEFT));
  check(same(left.tick ?? null, TURN_LEFT), 'the tick after a turn left should draw its arrow inverted');
  check(same(left.after[0]!, TURN_LEFT) && left.active,
    'after the turn\'s pass the arrow should stand inverted, its put-back asked of the next VBL (tag000730)');
  check(left.after[1] === null && left.after[2] === null, 'the next VBL should put the arrow back, and it should stay back');
  check(left.changed[0]! && left.changed[1]! && !left.changed[2]!, 'the inversion and the put-back should each ask for a redraw');
  const right = flashOf('turn right', () => game.enqueueMovement(MovementAction.TURN_RIGHT));
  check(same(right.tick ?? null, TURN_RIGHT) && right.after[1] === null, 'a turn right should flash its own arrow for one frame');

  // ---- a step, from a click on the arrow ---------------------------------------------
  const from = { x: scene.x, y: scene.y };
  const step = flashOf('step forward', () => game.onMouseClick(3, moveButtons[0]!.x1 + 1, moveButtons[0]!.y1 + 1));
  check(party.position.x !== from.x || party.position.y !== from.y, 'the step should have been taken');
  check(same(step.tick ?? null, moveButtons[0]!) && step.after[1] === null,
    'a step forward should flash d.MoveButn18496[0] in its tick, and the next VBL put it back');
  // Next to the map's edge, some of these run into a wall: the step is refused, with
  // `d.clockTick = 0` and no tick (`CSBCode.cpp:8310-8314`), but `MoveParty` has its
  // button by then (`:8139`), and the pass's `WaitForButtonFlash` (`:763`) asks for the
  // put-back as the tick's would.
  let refused = 0;
  for (const [num, action] of [[4, MovementAction.STRAFE_RIGHT], [5, MovementAction.MOVE_BACKWARD], [6, MovementAction.STRAFE_LEFT]] as const) {
    const flash = flashOf(`button ${num}`, () => game.enqueueMovement(action));
    const moved = party.position.x !== scene.x || party.position.y !== scene.y;
    if (!moved) refused++;
    check(same(flash.after[0]!, moveButtons[num - 3]!) && flash.after[1] === null,
      `button ${num} should flash d.MoveButn18496[${num - 3}] for one frame, ${moved ? 'taken' : 'refused'}`);
  }
  check(refused > 0, 'the scene should have a refused step, to cover the flash without a tick');

  // ---- a pass without a tick puts it back too (:763) -----------------------------
  reset();
  flashButton(game.ctx, TURN_RIGHT.x1, TURN_RIGHT.x2, TURN_RIGHT.y1, TURN_RIGHT.y2);
  const standing = same(game.flashedButton(), TURN_RIGHT) && !loop.flashButnActive;
  frame();
  const askedWithoutTick = loop.flashButnActive && same(game.flashedButton(), TURN_RIGHT);
  frame();
  const backWithoutTick = game.flashedButton() === null;
  console.log(`flash, then passes without a tick: standing ${standing}, put-back asked ${askedWithoutTick}, back ${backWithoutTick}`);
  check(standing, 'FlashButton should invert its rectangle before it returns, with nothing left pending');
  check(askedWithoutTick && backWithoutTick, 'a pass without a tick should ask for the put-back, and the next VBL make it');

  // ---- a second flash waits out the first ------------------------------------------
  reset();
  flashButton(game.ctx, TURN_LEFT.x1, TURN_LEFT.x2, TURN_LEFT.y1, TURN_LEFT.y2);
  waitForButtonFlash(game.ctx);
  flashButton(game.ctx, TURN_RIGHT.x1, TURN_RIGHT.x2, TURN_RIGHT.y1, TURN_RIGHT.y2);
  const second = game.flashedButton();
  console.log(`flash, wait, flash again: inverted ${show(second)}, pending ${loop.flashButnActive}`);
  check(same(second, TURN_RIGHT) && !loop.flashButnActive,
    'a flash after a put-back was asked should wait it out, then invert its own rectangle');
  frame();
  frame();

  // ---- CastMagic waits for the flash first ------------------------------------------
  reset();
  const caster: Champion = {
    ...addCharacterDefaults(),
    name: 'HERO',
    attributes: {
      health: 200, maxHealth: 200, stamina: 100, maxStamina: 100, mana: 50, maxMana: 50,
      stats: makeAddCharacterAttributes([60, 60, 50, 50, 50, 20, 20]),
      experience: 0, fighter: 0, ninja: 0, priest: 0, wizard: 0,
    },
    alive: true, incantation: [], food: 1500, water: 1500,
    skills: [],
    possessions: emptyPossessions(),
    partyPosition: 0,
  };
  party.champions = [caster];
  flashButton(game.ctx, TURN_LEFT.x1, TURN_LEFT.x2, TURN_LEFT.y1, TURN_LEFT.y2);
  game.castSpellFromUi(0);
  console.log(`CastMagic with a flash standing: put-back asked ${loop.flashButnActive}`);
  check(loop.flashButnActive, 'CastMagic should ask for the put-back of a standing flash (Magic.cpp:939)');

  finish();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
