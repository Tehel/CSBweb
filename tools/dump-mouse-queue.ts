/**
 * Prove that clicks and keys share CSBWin's one mouse queue, and that `HandleMouseEvents`
 * handles one entry of it per tick whatever the entry is.
 *
 * - `MOUSEQLEN` is 8: `Data.h:1513` leaves `#define NoKeyQue` commented out, so the
 *   3 at `:1515` is dead and the 8 at `:1517` is live (doc/CSBwin-src/Data.h:1513-1518).
 * - A key is queued unless 7 entries wait — `TAG0196da` refuses it when
 *   `MouseQEnd + 2 == MouseQStart` (doc/CSBwin-src/CSBCode.cpp:8439-8443).
 * - A click is queued only while fewer than `MOUSEQLEN-2` wait, leaving room for its
 *   button-up (`OnMouseClick`, `CSBCode.cpp:7626-7630`); the button-up, `0xadd`, while
 *   fewer than `MOUSEQLEN-1` wait (`OnMouseUnClick`, `:7581-7600`).
 * - `HandleMouseEvents` takes the head only if `lastTime` allows (`Mouse.cpp:1468-1476`),
 *   leaves a held step at the head, blocking everything behind it (`:1485-1498`), and
 *   stamps `lastTime` for every button it handles, a click as much as a turn — but not
 *   for the button-up, which returns `result |= 1` so the next entry follows in the same
 *   pass (`:1523-1549`), the main loop calling it again while that bit is set
 *   (`CSBCode.cpp:746-761`).
 * - The on-screen arrows are buttons 1-6 (`buttons17304`); `HandleMouseEvents` sends
 *   1-2 to `TurnParty` and 3-6 to `MoveParty` (`Mouse.cpp:1550-1570`).
 * - `DiscardAllInput` empties the queue, clicks included (`CSBCode.cpp:7532-7544`).
 * - While the eye or the mouth is pressed, every button after 81 — the disk icon, 140,
 *   among them — is swallowed (`Mouse.cpp:1679-1680`), until the button-up.
 * - A viewport click on a door button, or on a wall switch that fires, sets
 *   `d.clockTick = 1`, so a tick runs in the frame of the click. A touch of the wall that
 *   fires nothing sets it to 0, and a tick that was due waits a frame. A cell ahead off
 *   the map leaves it alone (`Mouse.cpp:784-788`, `:1078`).
 *
 * Run: `npx tsx tools/dump-mouse-queue.ts [level]`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DBType, OBJECT_ID_EOF, Position, RoomType, decodeObjectID } from '../src/core/types';
import { ActuatorAction, getActuatorAction, getActuatorType } from '../src/data/actuatorHelpers';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { makeAddCharacterAttributes } from '../src/engine/attributes';
import { MovementAction } from '../src/engine/gameTypes';
import type { Champion } from '../src/engine/gameTypes';
import { createUIState } from '../src/renderer/ui/UIState';
import { extractUITables } from '../src/renderer/csbwin/UITables';
import { TimerFunction } from '../src/engine/TimerQueue';
import { newGame } from './lib/game';
import { check, finish } from './lib/check';
import { emptyPossessions } from '../src/engine/gameTypes';
import { addCharacterDefaults } from '../src/engine/AddCharacter';

/** As in `tools/dump-hand-owner.ts`: `ui/Mouse` reaches `@/ui`, which touches `document`. */
async function importMouse(): Promise<typeof import('../src/renderer/ui/Mouse')> {
  const g = globalThis as Record<string, unknown>;
  if (!g.document) g.document = { getElementById: () => null, addEventListener: () => {} };
  if (!g.window) g.window = g;
  return import('../src/renderer/ui/Mouse');
}

/** A plain champion: the disk icon wants a party, the eye a champion to look through. */
function champion(): Champion {
  return {
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
}

async function main(): Promise<void> {
  const loader = new DungeonLoader();
  await loader.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/dungeon.dat'))));
  const data = loader.getData();
  if (!data) throw new Error('dungeon.dat did not load');

  const graphics = new GraphicsLoader();
  graphics.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/graphics.dat'))));
  const uiTables = extractUITables(graphics);

  const level = Number(process.argv[2] ?? 1);
  const game = newGame(data, graphics);
  game.setRandomSeed(0x12345678);
  game.party.state.position = new Position(0, 0, level);
  game.monsterSystem.loadPartyLevel(level);

  // An open cell with an open, monster-free cell in front: the arrow step needs
  // somewhere to go. The party is empty, so the step costs no stamina and sets no delay.
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
        if (open(x + DIRS[dir][0], y + DIRS[dir][1])) { scene = { x, y, dir }; break; }
      }
    }
  }
  if (!scene) throw new Error(`level ${level} has no open cell with an open neighbour`);
  const party = game.party.state;
  party.champions = [];

  // What the UI's dispatcher would have been handed, and when.
  const handled: Array<{ num: number; x: number; y: number; frame: number }> = [];
  let unclicks = 0;
  let frameNo = 0;
  game.setMouseEventHandlers({
    button: (num, x, y) => handled.push({ num, x, y, frame: frameNo }),
    unclick: () => { unclicks++; },
  });

  type Internals = { lastTickTime: number; lastInputTime: number };
  const internals = game as unknown as Internals;
  let t = Date.now() + 60_000;
  /** One VBL; `tickDue` makes a game tick run in it, after the queue. */
  const frame = (tickDue = false): void => {
    t += 17;
    frameNo++;
    internals.lastTickTime = tickDue ? t - 1000 : t;
    game.runFrame(t);
  };
  const reset = (): void => {
    game.discardAllInput();
    party.position = new Position(scene!.x, scene!.y, level);
    game.party.setFacing(scene!.dir);
    party.partyMoveDisableTimer = 0;
    party.word11712 = 0;
    internals.lastInputTime = 0;
    handled.length = 0;
    unclicks = 0;
  };
  const NUM_INVENTORY = 83;
  // `lastTime == 0` means "nothing handled yet" and disables the gate, so a click at
  // `d.Time` 0 would stamp nothing. Start the clock.
  frame(true);
  frame(true);

  // ---- 1: seven keys wait, the eighth is refused ---------------------------------
  reset();
  const keys = Array.from({ length: 8 }, () => game.enqueueMovement(MovementAction.TURN_LEFT));
  console.log(`keys: ${keys.map((k) => (k ? 'in' : 'refused')).join(', ')}`);
  check(keys.slice(0, 7).every(Boolean) && !keys[7],
    `seven keys should queue and the eighth be refused (MOUSEQLEN 8) (${keys.join('/')})`);

  // ---- 2: a click needs room for its button-up -----------------------------------
  reset();
  for (let i = 0; i < 5; i++) game.enqueueMovement(MovementAction.TURN_LEFT);
  const clickWithFive = game.onMouseClick(NUM_INVENTORY, 10, 50);
  const countAfterFirst = game.queuedInputCount();
  const clickWithSix = game.onMouseClick(NUM_INVENTORY, 10, 50);
  game.onMouseUnClick();
  const countAfterUp = game.queuedInputCount();
  game.onMouseUnClick();
  const countAfterSecondUp = game.queuedInputCount();
  console.log(`click with 5 waiting: ${clickWithFive}, with 6: ${clickWithSix}; ` +
    `button-ups take the queue ${countAfterFirst} -> ${countAfterUp} -> ${countAfterSecondUp}`);
  check(clickWithFive && countAfterFirst === 6, 'a click should queue while five entries wait');
  check(!clickWithSix, 'a click should be refused while six entries wait (MOUSEQLEN-2)');
  check(countAfterUp === 7, 'a button-up should queue while six entries wait');
  check(countAfterSecondUp === 7, 'a button-up should be refused while seven entries wait (MOUSEQLEN-1)');

  // ---- 3: a click takes the tick, and the turn behind it waits ---------------------
  reset();
  game.onMouseClick(NUM_INVENTORY, 12, 60);
  game.enqueueMovement(MovementAction.TURN_LEFT);
  const facing0 = party.facing;
  frame();
  const clickFrame = handled.length === 1 ? handled[0] : null;
  const turnedWithClick = party.facing !== facing0;
  frame(true); // the tick comes after the queue: still the click's tick
  const turnedInClickTick = party.facing !== facing0;
  frame();
  const turnedNextTick = party.facing !== facing0;
  console.log(`click then turn: click handled ${clickFrame ? `as ${clickFrame.num} at ${clickFrame.x},${clickFrame.y}` : 'no'}; ` +
    `turned with it ${turnedWithClick}, in its tick ${turnedInClickTick}, next tick ${turnedNextTick}`);
  check(clickFrame?.num === NUM_INVENTORY && clickFrame.x === 12 && clickFrame.y === 60,
    'the click should reach the UI dispatcher with its button and point');
  check(!turnedWithClick && !turnedInClickTick, 'a click should stamp lastTime: the turn behind it waits for the next tick');
  check(turnedNextTick, 'the turn should run in the next tick');

  // ---- 4: the button-up stamps nothing and lets the next entry through -------------
  reset();
  game.onMouseUnClick();
  game.enqueueMovement(MovementAction.TURN_LEFT);
  const facing1 = party.facing;
  frame();
  console.log(`button-up then turn in one frame: unclicks ${unclicks}, turned ${party.facing !== facing1}`);
  check(unclicks === 1 && party.facing !== facing1, 'a button-up and the turn behind it should both run in one pass');

  // ---- 5: the on-screen arrows ---------------------------------------------------
  reset();
  const from = party.position;
  game.onMouseClick(3, 270, 130);
  frame();
  const stepped = party.position.x !== from.x || party.position.y !== from.y;
  const facing2 = party.facing;
  game.onMouseClick(1, 240, 130);
  frame(true);
  frame();
  const turnedLeft = party.facing === ((facing2 + 3) & 3);
  console.log(`arrow 3: ${from.x},${from.y} -> ${party.position.x},${party.position.y}; arrow 1 turned left ${turnedLeft}; ` +
    `UI dispatcher saw ${handled.length}`);
  check(stepped, 'button 3 (the forward arrow) should move the party');
  check(turnedLeft, 'button 1 (the turn-left arrow) should turn the party left');
  check(handled.length === 0, 'the arrows are HandleMouseEvents\' own; the UI dispatcher should not see them');

  // ---- 6: a held step blocks the click behind it ----------------------------------
  reset();
  party.partyMoveDisableTimer = 2;
  game.enqueueMovement(MovementAction.MOVE_FORWARD);
  game.onMouseClick(NUM_INVENTORY, 10, 50);
  frame();
  const blockedCount = game.queuedInputCount();
  const blockedHandled = handled.length;
  frame(true);
  frame(true); // the delay has run out after two ticks
  frame();
  const stepFirst = handled.length === 0;
  frame(true);
  frame();
  console.log(`held step, click behind: queue ${blockedCount}, handled ${blockedHandled}; ` +
    `after the delay the step went first ${stepFirst}, then the click ${handled.length === 1}`);
  check(blockedCount === 2 && blockedHandled === 0, 'a held step should stay at the head and hold the click behind it');
  check(stepFirst && handled.length === 1, 'the step should go when the delay runs out, and the click a tick later');

  // ---- 7: DiscardAllInput drops a click -------------------------------------------
  reset();
  game.onMouseClick(NUM_INVENTORY, 10, 50);
  game.discardAllInput();
  frame();
  console.log(`click then DiscardAllInput: handled ${handled.length}, queue ${game.queuedInputCount()}`);
  check(handled.length === 0 && game.queuedInputCount() === 0, 'DiscardAllInput should drop a queued click');

  // ---- 8: the disk icon waits for the eye to be let go ----------------------------
  // `if (d.PressingEye!=0) {lastTime=d.Time; RETURN_int(result);};` sits after button 81
  // and before 140 (doc/CSBwin-src/Mouse.cpp:1679-1680). Through the real dispatcher.
  const { handleMouseButton, handleMouseUnclick } = await importMouse();
  const ui = createUIState(graphics, dungeon, { getGraphicBitmap: () => null, renderLastFrame: () => {} });
  ui.uiTables = uiTables;
  ui.partyState = party;
  game.setMouseEventHandlers({
    button: (num, x, y) => handleMouseButton(ui, num, x, y),
    unclick: () => handleMouseUnclick(ui),
  });
  const diskAfter = (withButtonUp: boolean): boolean => {
    reset();
    party.champions = [champion()];
    party.selectedCharacterIndex = 0;
    ui.pressingEye = false;
    ui.diskMenuNeeded = false;
    game.onMouseClick(71, 20, 50);
    if (withButtonUp) game.onMouseUnClick();
    game.onMouseClick(140, 178, 40);
    for (let i = 0; i < 3; i++) { frame(true); frame(); }
    return ui.diskMenuNeeded;
  };
  const diskWhilePressing = diskAfter(false);
  const diskAfterRelease = diskAfter(true);
  console.log(`disk icon behind an eye press: ${diskWhilePressing ? 'menu' : 'swallowed'}; ` +
    `behind its button-up: ${diskAfterRelease ? 'menu' : 'swallowed'}`);
  check(!diskWhilePressing, 'the disk icon should do nothing while the eye is pressed');
  check(diskAfterRelease, 'the disk icon should ask for the menu once the eye is let go');
  party.champions = [];
  party.selectedCharacterIndex = -1;

  // ---- 9: a click that works something makes a tick due -----------------------------
  // The main loop runs a tick after `HandleMouseEvents` whenever `d.clockTick` is set
  // (doc/CSBwin-src/CSBCode.cpp:763-764). The door button sets it to 1 before queueing its
  // `TT_DOOR` for `d.Time+1` (Mouse.cpp:1078-1085), so the door moves in the frame of the
  // click. `TouchWallF1` sets it to what `TouchWall` returns (`:788`): 1 when a switch
  // fired, 0 when nothing did, which puts off a tick that was due. A cell ahead off the
  // map leaves it alone (`:784-787`).
  const inMap = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < width && y < height;
  const stone = (x: number, y: number): boolean =>
    inMap(x, y) && ((dungeon.getCellFlag(new Position(x, y, level)) >> 5) & 0x7) === RoomType.STONE;
  let doorScene: { x: number; y: number; dir: number; door: Position } | null = null;
  let switchScene: { x: number; y: number; dir: number } | null = null;
  let bareScene: { x: number; y: number; dir: number } | null = null;
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      const at = new Position(x, y, level);
      const cellFlag = dungeon.getCellFlag(at);
      if (((cellFlag >> 5) & 0x7) === RoomType.DOOR && !doorScene) {
        const doorRN = dungeon.findFirstDoor(at);
        if (doorRN === OBJECT_ID_EOF || !dungeon.getDoorRecordByIndex(decodeObjectID(doorRN).index)?.hasButton) continue;
        for (let dir = 0; dir < 4 && !doorScene; dir++) {
          // The button is on the faces the door is seen across (`MouseSystem.handleDoorSwitchClick`).
          if (((cellFlag & 0x8) >> 3) === (dir & 1)) continue;
          const px = x - DIRS[dir][0], py = y - DIRS[dir][1];
          if (inMap(px, py)) doorScene = { x: px, y: py, dir, door: at };
        }
      }
      if (!stone(x, y)) continue;
      let objects = 0;
      for (let rn = dungeon.findFirstObject(at); rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) {
        objects++;
        const { category, position: side } = decodeObjectID(rn);
        const rec = category === DBType.ACTUATOR ? dungeon.getActuatorRecord(rn) : null;
        if (!rec || switchScene || getActuatorType(rec) !== 1) continue;
        if (getActuatorAction(rec) === ActuatorAction.CONSTPRESSURE) continue;
        const px = x + DIRS[side][0], py = y + DIRS[side][1];
        if (inMap(px, py) && !stone(px, py)) switchScene = { x: px, y: py, dir: (side + 2) & 3 };
      }
      for (let side = 0; side < 4 && objects === 0 && !bareScene; side++) {
        const px = x + DIRS[side][0], py = y + DIRS[side][1];
        if (inMap(px, py) && !stone(px, py)) bareScene = { x: px, y: py, dir: (side + 2) & 3 };
      }
    }
  }
  if (!doorScene || !switchScene || !bareScene) throw new Error(`level ${level} lacks a door button, a wall switch or a bare wall`);

  let viewportArm: 'door' | 'wall' = 'wall';
  game.setMouseEventHandlers({
    button: (num) => {
      if (num !== 80) return;
      if (viewportArm === 'door') game.handleDoorSwitchClick();
      else game.handleWallClick();
    },
    unclick: () => {},
  });
  /** One VBL on the real clock: a tick runs once 250 ms have passed, or `d.clockTick` says so. */
  const vbl = (): void => {
    t += 17;
    frameNo++;
    game.runFrame(t);
  };
  /**
   * Stand at `at`, facing `dir`, just after a tick, and click the viewport: the frames from
   * the click to the first tick after it that leaves `done()` true, the click's own frame
   * counting 1.
   */
  const framesUntil = (at: { x: number; y: number; dir: number }, arm: 'door' | 'wall', done = (): boolean => true): number => {
    reset();
    party.position = new Position(at.x, at.y, level);
    game.party.setFacing(at.dir);
    viewportArm = arm;
    frame(true);
    const ticksAtClick = game.ctx.state.tickCount;
    game.onMouseClick(80, 100, 100);
    for (let n = 1; n <= 30; n++) {
      vbl();
      if (game.ctx.state.tickCount !== ticksAtClick && done()) return n;
    }
    return -1;
  };
  const doorTimerQueued = (): boolean => game.ctx.timers.getTimers().some((timer) =>
    timer.function === TimerFunction.TT_DOOR && timer.uByte6 === doorScene!.door.x && timer.uByte7 === doorScene!.door.y);
  const doorFrames = framesUntil(doorScene, 'door', () => !doorTimerQueued());
  console.log(`door button at (${doorScene.door.x},${doorScene.door.y}): its TT_DOOR fired ${doorFrames} frame(s) from the click`);
  check(doorFrames === 1, "the door button's TT_DOOR fires in the frame of the click (d.clockTick = 1)");

  const switchFrames = framesUntil(switchScene, 'wall');
  console.log(`wall switch touched from (${switchScene.x},${switchScene.y}) facing ${switchScene.dir}: ` +
    `the next tick ran ${switchFrames} frame(s) from the click`);
  check(switchFrames === 1, 'a wall switch that fired brings the tick on in the frame of the click');

  /** A tick is due by the clock; does it run in the frame that handles a wall click? */
  const tickDueRunsAfterTouch = (at: { x: number; y: number; dir: number }): boolean => {
    reset();
    party.position = new Position(at.x, at.y, level);
    game.party.setFacing(at.dir);
    viewportArm = 'wall';
    frame(true);
    game.onMouseClick(80, 100, 100);
    const before = game.ctx.state.tickCount;
    frame(true);
    return game.ctx.state.tickCount !== before;
  };
  const bareTicked = tickDueRunsAfterTouch(bareScene);
  const offMapTicked = tickDueRunsAfterTouch({ x: 0, y: 0, dir: 3 });
  console.log(`a tick due at the click: after a bare wall at (${bareScene.x},${bareScene.y}) facing ${bareScene.dir} ` +
    `${bareTicked ? 'ran' : 'waited'}; after a touch off the map ${offMapTicked ? 'ran' : 'waited'}`);
  check(!bareTicked, 'a touch that fired nothing puts off the tick that was due (d.clockTick = 0)');
  check(offMapTicked, 'a touch of a cell off the map leaves d.clockTick alone');

  finish();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
