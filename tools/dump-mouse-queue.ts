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
 * - `totalMoveCount` counts each entry `HandleMouseEvents` takes past the held-step test
 *   (`Mouse.cpp:1506`), below 0x2000 and not the no-op (`Recording.cpp:1011-1019`).
 * - While the eye or the mouth is pressed, every button after 81 — the disk icon, 140,
 *   among them — is swallowed (`Mouse.cpp:1679-1680`), until the button-up.
 * - A viewport click on a door button, or on a wall switch that fires, sets
 *   `d.clockTick = 1`, so a tick runs in the frame of the click. A touch of the wall that
 *   fires nothing sets it to 0, and a tick that was due waits a frame. A cell ahead off
 *   the map leaves it alone (`Mouse.cpp:784-788`, `:1078`).
 * - `ShowHideInventory`, the pick-up and the drop set it to 1 as well (`CSBCode.cpp:7441`,
 *   `Mouse.cpp:840`, `:964`), the eye's press aside; the attack menu and the cast button
 *   set it to what the attack or the cast returned (`Character.cpp:4716-4717`,
 *   `Magic.cpp:564`), and a pass leaves it alone. A turn and a step set it to 1 before
 *   anything else, "Extra Ticks" being on (`CSBCode.cpp:7866-7869`, `:8084-8087`).
 *
 * Run: `npx tsx tools/dump-mouse-queue.ts [level]`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DBType, OBJECT_ID_EOF, OBJECT_ID_NULL, Position, RoomType, type ObjectID } from '../src/core/types';
import { ActuatorAction, getActuatorAction, getActuatorType } from '../src/data/actuatorHelpers';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { makeAddCharacterAttributes } from '../src/engine/attributes';
import { MovementAction } from '../src/engine/gameTypes';
import type { Champion } from '../src/engine/gameTypes';
import type { InterpreterContext } from '../src/renderer/bytecode/BytecodeInterpreter';
import { tryPickViewportObject } from '../src/renderer/ui/ViewportPicking';
import { setHandOwner } from '../src/engine/Party';
import { ensureSkills } from '../src/engine/skills';
import { TimerFunction } from '../src/engine/TimerQueue';
import { graphicsTablesOf, newGame, runVbl, TICK_DUE } from './lib/game';
import { newUIState } from './lib/ui';
import { check, finish } from './lib/check';
import { emptyPossessions } from '../src/engine/gameTypes';
import { addCharacterDefaults } from '../src/engine/AddCharacter';
import { freeze, thaw } from '../src/engine/LoopState';
import { handleMouseButton, handleMouseUnclick } from '../src/renderer/ui/Mouse';

/** A plain champion: the disk icon wants a party, the eye a champion to look through. */
function champion(): Champion {
  return {
    ...addCharacterDefaults(),
    name: 'HERO',
    attributes: {
      health: 200, maxHealth: 200, stamina: 100, maxStamina: 100, mana: 50, maxMana: 50,
      stats: makeAddCharacterAttributes([60, 60, 50, 50, 50, 20, 20]),
    },
    incantation: [], food: 1500, water: 1500,
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
  const uiTables = graphicsTablesOf(graphics).ui;

  const level = Number(process.argv[2] ?? 1);
  const game = newGame(data, graphics);
  game.setRandomSeed(0x12345678);
  game.ctx.party.state.position = new Position(0, 0, level);
  game.systems.monsters.loadPartyLevel(level);

  // An open cell with an open, monster-free cell in front: the arrow step needs
  // somewhere to go. The party is empty, so the step costs no stamina and sets no delay.
  const dungeon = game.ctx.dungeon;
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
  const party = game.ctx.party.state;
  party.champions = [];

  // What the UI's dispatcher would have been handed, and when.
  const handled: Array<{ num: number; x: number; y: number; frame: number }> = [];
  let unclicks = 0;
  let frameNo = 0;
  game.setMouseEventHandlers({
    button: (num, x, y) => handled.push({ num, x, y, frame: frameNo }),
    unclick: () => { unclicks++; },
  });

  type Internals = { lastInputTime: number };
  const internals = game as unknown as Internals;
  /** One VBL; `tickDue` makes a game tick run in it, after the queue. */
  const frame = (tickDue = false): void => {
    frameNo++;
    runVbl(game, tickDue ? TICK_DUE : 1);
  };
  const reset = (): void => {
    game.discardAllInput();
    party.position = new Position(scene!.x, scene!.y, level);
    game.ctx.party.setFacing(scene!.dir);
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
  const countAfterFirst = game.ctx.mouseQueue.count();
  const clickWithSix = game.onMouseClick(NUM_INVENTORY, 10, 50);
  game.onMouseUnClick();
  const countAfterUp = game.ctx.mouseQueue.count();
  game.onMouseUnClick();
  const countAfterSecondUp = game.ctx.mouseQueue.count();
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
  const blockedCount = game.ctx.mouseQueue.count();
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
  console.log(`click then DiscardAllInput: handled ${handled.length}, queue ${game.ctx.mouseQueue.count()}`);
  check(handled.length === 0 && game.ctx.mouseQueue.count() === 0, 'DiscardAllInput should drop a queued click');

  // ---- 7b: totalMoveCount counts what HandleMouseEvents records -------------------
  // `RecordFile_Record(&pMouseQueue[d.MouseQStart])` once an entry is past the held-step
  // test (doc/CSBwin-src/Mouse.cpp:1506), counted when below 0x2000 and not the no-op
  // (`Recording.cpp:1011-1019`). A held step and a frozen game's discard come first.
  reset();
  const moves = (): number => game.ctx.state.block1.totalMoveCount;
  const m0 = moves();
  party.partyMoveDisableTimer = 2;
  game.enqueueMovement(MovementAction.MOVE_FORWARD);
  frame();
  const whileHeld = moves() - m0;
  frame(true);
  frame(true);
  frame();
  const afterStep = moves() - m0;
  frame(true);
  game.onMouseClick(NUM_INVENTORY, 10, 50);
  game.onMouseUnClick();
  frame();
  frame(true); // the click stamped lastTime: its button-up goes in the next tick
  frame();
  const afterClick = moves() - m0;
  frame(true);
  game.onMouseClick(0x64, 0x114, 0x2f);
  frame();
  frame(true);
  game.enqueueKeyButton(0x2000);
  frame();
  const afterIgnored = moves() - m0;
  freeze(game.ctx);
  frame(true);
  game.onMouseClick(NUM_INVENTORY, 10, 50);
  frame();
  const whileFrozen = moves() - m0;
  thaw(game.ctx);
  console.log(`totalMoveCount: held step +${whileHeld}, once it went +${afterStep}, ` +
    `click and button-up +${afterClick}, the no-op and 0x2000 +${afterIgnored}, frozen click +${whileFrozen}`);
  check(whileHeld === 0 && afterStep === 1, 'a held step is counted when it goes, not while it waits');
  check(afterClick === 3, 'a click and its button-up count one each');
  check(afterIgnored === 3, 'button 0x64 at (0x114, 0x2f) and an entry at 0x2000 are not counted');
  check(whileFrozen === 3, 'a click a frozen game discards is not counted');
  reset();

  // ---- 8: the disk icon waits for the eye to be let go ----------------------------
  // `if (d.PressingEye!=0) {lastTime=d.Time; RETURN_int(result);};` sits after button 81
  // and before 140 (doc/CSBwin-src/Mouse.cpp:1679-1680). Through the real dispatcher.
  const ui = newUIState(graphics, game.ctx);
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
  // `TT_DOOR` for `d.Time+1` (Mouse.cpp:1078-1085). A tick runs `ProcessTimers` before its
  // `d.Time++` (`CSBCode.cpp:626`, `:660`), so the tick in the frame of the click passes the
  // door by, and the one after it moves it. `TouchWallF1` sets it to what `TouchWall`
  // returns (`:788`): 1 when a switch fired, 0 when nothing did, which puts off a tick that
  // was due. A cell ahead off the map leaves it alone (`:784-787`).
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
        if (doorRN === OBJECT_ID_EOF || !dungeon.getDoorRecordByIndex(game.ctx.dungeon.rnMaps.idx(doorRN))?.hasButton) continue;
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
        const { category, position: side } = game.ctx.dungeon.rnMaps.decode(rn);
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
      if (viewportArm === 'door') game.systems.mouse.handleDoorSwitchClick();
      else game.systems.mouse.handleWallClick();
    },
    unclick: () => {},
  });
  /** One VBL, the count running on: a tick runs once `d.vblCount` reaches `d.Speed`, or `d.clockTick` says so. */
  const vbl = (): void => {
    frameNo++;
    runVbl(game);
  };
  /**
   * Stand at `at`, facing `dir`, just after a tick, and click the viewport: the frames from
   * the click to the first tick after it that leaves `done()` true, the click's own frame
   * counting 1. `ticksUntilDone` is left holding the ticks that ran meanwhile, that one
   * included, and `firstTickFrame` the frame of the first.
   */
  let ticksUntilDone = 0;
  let firstTickFrame = 0;
  const framesUntil = (at: { x: number; y: number; dir: number }, arm: 'door' | 'wall', done = (): boolean => true): number => {
    reset();
    party.position = new Position(at.x, at.y, level);
    game.ctx.party.setFacing(at.dir);
    viewportArm = arm;
    frame(true);
    const ticksAtClick = game.ctx.state.tickCount;
    game.onMouseClick(80, 100, 100);
    firstTickFrame = 0;
    for (let n = 1; n <= 30; n++) {
      vbl();
      ticksUntilDone = game.ctx.state.tickCount - ticksAtClick;
      if (ticksUntilDone !== 0 && firstTickFrame === 0) firstTickFrame = n;
      if (ticksUntilDone !== 0 && done()) return n;
    }
    return -1;
  };
  const doorTimerQueued = (): boolean => game.ctx.timers.getTimers().some((timer) =>
    timer.function === TimerFunction.TT_DOOR && timer.uByte6 === doorScene!.door.x && timer.uByte7 === doorScene!.door.y);
  const doorFrames = framesUntil(doorScene, 'door', () => !doorTimerQueued());
  console.log(`door button at (${doorScene.door.x},${doorScene.door.y}): a tick ran ${firstTickFrame} frame(s) from the click; ` +
    `its TT_DOOR fired ${doorFrames} frame(s) from it, in tick ${ticksUntilDone}`);
  check(firstTickFrame === 1, 'the door button brings the tick on in the frame of the click (d.clockTick = 1)');
  check(doorFrames > 1 && ticksUntilDone === 2, "its TT_DOOR fires in the tick after that one, not in the click's");

  // A switch answers only a cursor someone owns (`Mouse.cpp:357-360`): a champion's.
  party.champions = [champion()];
  party.cursorOwner = 0;
  const switchFrames = framesUntil(switchScene, 'wall');
  party.champions = [];
  party.cursorOwner = -1;
  console.log(`wall switch touched from (${switchScene.x},${switchScene.y}) facing ${switchScene.dir}: ` +
    `the next tick ran ${switchFrames} frame(s) from the click`);
  check(switchFrames === 1, 'a wall switch that fired brings the tick on in the frame of the click');

  /** A tick is due by the clock; does it run in the frame that handles a wall click? */
  const tickDueRunsAfterTouch = (at: { x: number; y: number; dir: number }): boolean => {
    reset();
    party.position = new Position(at.x, at.y, level);
    game.ctx.party.setFacing(at.dir);
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

  // ---- 10: the other handlers that write d.clockTick -------------------------------
  // `ShowHideInventory` sets it to 1 once past its dead-champion and pressed-eye/mouth
  // returns (doc/CSBwin-src/CSBCode.cpp:7434-7441). The pick-up `TAG01a148` and
  // `DropObject` end with it (Mouse.cpp:840, :964). The attack menu sets it to
  // `ExecuteAttack`'s result, and a pass leaves it alone (Character.cpp:4679-4682,
  // :4716-4717). The cast button sets it to `CastMagic`'s result, `CastSpell`'s with 3
  // made 0 (Magic.cpp:564, :945-956). Each click goes through the queue to the real
  // handler: the UI's dispatcher, or for the viewport `HandleClickInViewport`'s calls
  // (`src/renderer/ui/Mouse.ts`).
  // The engine's `CastMagic` and `Attack`, the UI's calls, wrapped to read their results.
  const { magic, character } = game.systems;
  let castResult = -99;
  const castSpellFromUi = magic.castSpellFromUi.bind(magic);
  magic.castSpellFromUi = (chIdx) => (castResult = castSpellFromUi(chIdx));
  let attackResult = -99;
  const executeAttack = character.executeAttack.bind(character);
  const recordAttack = (chIdx: number, attackType: number): number => (attackResult = executeAttack(chIdx, attackType));
  character.executeAttack = recordAttack;
  const centreOf = (list: Array<{ word0: number; x1: number; y1: number; x2: number; y2: number }> | null, id: number): [number, number] => {
    const b = list?.find((entry) => entry.word0 === id);
    if (!b) throw new Error(`no button ${id} in the list`);
    return [(b.x1 + b.x2) >> 1, (b.y1 + b.y2) >> 1];
  };
  const buttons = uiTables.graphic231.buttons;
  let onClick: () => void = () => {};
  game.setMouseEventHandlers({ button: () => onClick(), unclick: () => {} });
  /** A fresh party of one, at the scene, holding the cursor and the magic tab. */
  const soloParty = (): void => {
    reset();
    party.champions = [champion()];
    setHandOwner(party, 0, game.ctx.host);
    party.magicCasterIndex = 0;
    party.selectedCharacterIndex = -1;
    party.objectInHand = OBJECT_ID_NULL;
    ui.pressingEye = false;
    ui.attackingCharacterOrdinal = 0;
    ui.word20252 = 1;
    game.ctx.loop.clockTick = false;
  };
  /**
   * Just after a tick, queue button `num`, which the UI's `handler` answers unless it is an
   * arrow: the frames to the next tick, the click's own frame counting 1.
   */
  const framesToTick = (handler: () => void, num = 80): number => {
    onClick = handler;
    frame(true);
    const ticksAtClick = game.ctx.state.tickCount;
    game.onMouseClick(num, 100, 100);
    for (let n = 1; n <= 30; n++) {
      vbl();
      if (game.ctx.state.tickCount !== ticksAtClick) return n;
    }
    return -1;
  };
  /** With a tick due by the clock, does it run in the frame that handles the click? */
  const dueTickRuns = (handler: () => void, num = 80): boolean => {
    onClick = handler;
    frame(true);
    game.onMouseClick(num, 100, 100);
    const before = game.ctx.state.tickCount;
    frame(true);
    return game.ctx.state.tickCount !== before;
  };
  /** Some item lying in the level, taken out of its cell for the hand. */
  const looseItem = (): ObjectID => {
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        const at = new Position(x, y, level);
        for (let rn = dungeon.findFirstObject(at); rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) {
          const { category } = game.ctx.dungeon.rnMaps.decode(rn);
          if (category < DBType.WEAPON || category === DBType.MISSILE || category === DBType.CLOUD) continue;
          dungeon.removeObjectFromCell(at, rn);
          return rn;
        }
      }
    }
    throw new Error(`level ${level} has no item to hold`);
  };

  console.log('');
  console.log(['handler', 'result', 'frames to tick', 'due tick runs', 'expected'].join('\t'));
  const row = (what: string, result: string, frames: number, runs: boolean | string, expected: string): void => {
    console.log([what, result, frames, runs, expected].join('\t'));
  };

  soloParty();
  const inventoryFrames = framesToTick(() => handleMouseButton(ui, 7, 0, 0));
  const inventoryOpened = party.selectedCharacterIndex === 0;
  row('ShowHideInventory (button 7)', inventoryOpened ? 'opened' : 'shut', inventoryFrames, '-', 'set');
  check(inventoryOpened && inventoryFrames === 1, 'the inventory button makes a tick due (ShowHideInventory, d.clockTick = 1)');

  const closeFrames = framesToTick(() => handleMouseButton(ui, 11, 0, 0));
  row('ShowHideInventory(4) (button 11)', party.selectedCharacterIndex < 0 ? 'shut' : 'open', closeFrames, '-', 'set');
  check(party.selectedCharacterIndex < 0 && closeFrames === 1, 'so does hiding it');

  soloParty();
  ui.pressingEye = true;
  const eyeFrames = framesToTick(() => handleMouseButton(ui, 7, 0, 0));
  const openedUnderEye = party.selectedCharacterIndex === 0;
  row('button 7, eye pressed', openedUnderEye ? 'opened' : 'refused', eyeFrames, '-', 'untouched');
  check(!openedUnderEye, 'ShowHideInventory returns while the eye is pressed (CSBCode.cpp:7440)');
  check(eyeFrames > 1, 'and leaves d.clockTick alone');

  soloParty();
  party.objectInHand = looseItem();
  const dropFrames = framesToTick(() => game.systems.mouse.dropObjectFromCursor(0));
  const dropped = party.objectInHand === OBJECT_ID_NULL;
  row('DropObject', dropped ? 'dropped' : 'kept', dropFrames, '-', 'set');
  check(dropped && dropFrames === 1, 'a drop makes a tick due (DropObject, d.clockTick = 1)');

  // The dropped object lies on the party's own square, near left: viewport slot 0.
  const onFloor = dungeon.findFirstObject(party.position);
  let floorItem: ObjectID = OBJECT_ID_EOF as ObjectID;
  for (let rn = onFloor; rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) {
    if (game.ctx.dungeon.rnMaps.dbType(rn) >= DBType.WEAPON) floorItem = rn;
  }
  const unset = { x1: 255, y1: 0, x2: 0, y2: 0 };
  const drawnView = ui.context;
  ui.context = {
    viewportObjectButtons: [{ x1: 10, y1: 10, x2: 30, y2: 30 }, unset, unset, unset, unset, unset],
    viewportObjectRNs: [floorItem, OBJECT_ID_EOF, OBJECT_ID_EOF, OBJECT_ID_EOF, OBJECT_ID_EOF],
  } as unknown as InterpreterContext;
  const pickFrames = framesToTick(() => tryPickViewportObject(ui, 20, 20 + 33));
  const picked = party.objectInHand === floorItem;
  row('TAG01a148 (pick-up)', picked ? 'picked up' : 'left', pickFrames, '-', 'set');
  check(picked && pickFrames === 1, 'a pick-up makes a tick due (TAG01a148, d.clockTick = 1)');
  ui.context = drawnView;
  party.objectInHand = OBJECT_ID_NULL;

  // The attack menu of an empty hand, opened on champion 0's button (116).
  const [champX, champY] = centreOf(buttons.buttons17952, 116);
  const [passX, passY] = centreOf(buttons.buttons17892, 112);
  const attackOnce = (measure: 'frames' | 'due', option: [number, number]): number | boolean => {
    soloParty();
    handleMouseButton(ui, 111, champX, champY);
    if (ui.attackingCharacterOrdinal !== 1) throw new Error('the attack menu did not open');
    attackResult = -99;
    const click = (): void => handleMouseButton(ui, 111, option[0], option[1]);
    return measure === 'frames' ? framesToTick(click) : dueTickRuns(click);
  };
  soloParty();
  handleMouseButton(ui, 111, champX, champY);
  const optionCount = ui.word20248;
  const offered = new Set<number>();
  for (let option = 0; option < optionCount; option++) {
    const at = centreOf(buttons.buttons17892, 113 + option);
    const frames = attackOnce('frames', at) as number;
    const result = attackResult;
    const runs = attackOnce('due', at) as boolean;
    offered.add(result);
    row(`ExecuteAttack (option ${option})`, String(result), frames, runs, result !== 0 ? 'set' : 'cleared');
    check(result !== -99, `option ${option} ran an attack`);
    if (result !== 0) check(frames === 1, `an attack that returns ${result} makes a tick due`);
    else check(!runs, 'an attack that returns 0 puts off a tick that was due');
  }
  check(offered.has(0), 'an empty hand at an empty square has an attack that returns 0');
  // Every real attack there returns 0, so the engine's `Attack` is stood in for once by
  // one that lands: the handler hands on what it gets.
  character.executeAttack = () => (attackResult = 1);
  const landedFrames = attackOnce('frames', centreOf(buttons.buttons17892, 113)) as number;
  row('ExecuteAttack (Attack stood in, 1)', String(attackResult), landedFrames, '-', 'set');
  check(attackResult === 1 && landedFrames === 1, 'an attack that returns 1 makes a tick due');
  character.executeAttack = recordAttack;
  const passFrames = attackOnce('frames', [passX, passY]) as number;
  const passDueRuns = attackOnce('due', [passX, passY]) as boolean;
  row('PASS', String(attackResult), passFrames, passDueRuns, 'untouched');
  check(ui.attackingCharacterOrdinal === 0 && attackResult === -99, 'PASS closes the menu and attacks nothing');
  check(passFrames > 1 && passDueRuns, 'and leaves d.clockTick alone');

  // The cast button (108), by a champion with every skill mastered, so no cast fails on
  // the dice: a lone power rune names no spell (0), LO FUL is the torch (1), and LO VI is
  // a potion, which with no flask in hand is `CastSpell`'s 3. `_MagicSelection` is
  // `RESTARTABLE` and holds the pass through its flash (`magicSelectionScript`), three
  // VBLs for a cast, and in the VBL it returns the pass goes on where it stopped: no further entry
  // (the click's `result` is 0), then `if (d.clockTick == 0)` and the tick
  // (CSBCode.cpp:747-765). So a cast's tick runs in the script's last VBL, and so does a
  // tick that was due while a rune's flash held the pass; the click queued behind is taken
  // in the VBL after that tick.
  const [castX, castY] = centreOf(buttons.buttons18060, 108);
  const [runeX, runeY] = centreOf(buttons.buttons18060, 101);
  /**
   * One click on the magic panel at (x, y), with another queued behind it and `d.clockTick`
   * standing at `due` when it is handled. In VBLs from the click, its own counting 1: how
   * long the script `held` the loop, the first tick (`toTick`), and the click behind (`next`).
   */
  const magicClick = (runes: number[], x: number, y: number, due: boolean): { held: number; toTick: number; next: number } => {
    soloParty();
    const caster = party.champions[0]!;
    caster.skills = ensureSkills([]).map((skill) => ({ ...skill, experience: 1 << 24 }));
    caster.incantation = [...runes];
    castResult = -99;
    const seen = { held: -1, toTick: -1, next: -1 };
    let vbls = 0;
    let clicks = 0;
    onClick = () => {
      if (clicks++ === 0) handleMouseButton(ui, 100, x, y);
      else seen.next = vbls;
    };
    frame(true);
    const ticksAtClick = game.ctx.state.tickCount;
    game.onMouseClick(80, 100, 100);
    game.onMouseClick(80, 100, 100);
    game.ctx.loop.clockTick = due;
    while (++vbls <= 30 && (seen.held < 0 || seen.toTick < 0 || seen.next < 0)) {
      vbl();
      if (seen.held < 0 && !game.isRunningScript()) seen.held = vbls;
      if (seen.toTick < 0 && game.ctx.state.tickCount !== ticksAtClick) seen.toTick = vbls;
    }
    return seen;
  };
  const castResults = new Set<number>();
  for (const [name, runes] of [['LO', [0x60]], ['LO FUL', [0x60, 0x69]], ['LO VI', [0x60, 0x67]]] as const) {
    const fromClear = magicClick([...runes], castX, castY, false);
    const fromSet = magicClick([...runes], castX, castY, true);
    const result = castResult;
    const tick = result === 3 ? 0 : result;
    castResults.add(result);
    row(`CastMagic (${name})`, String(result), fromClear.toTick, fromSet.toTick === fromSet.held, tick !== 0 ? 'set' : 'cleared');
    check(result !== -99, `the cast button cast ${name}`);
    check(fromClear.held === 3 && fromSet.held === 3, `the cast of ${name} holds the loop for its flash, three VBLs`);
    if (tick !== 0) {
      check(fromClear.toTick === 3 && fromSet.toTick === 3,
        `a cast of ${name} that returns ${result} makes a tick due, which runs in the VBL _MagicSelection returns`);
      check(fromClear.next === 4, 'and the click queued behind it is taken in the next VBL');
    } else {
      check(fromClear.toTick > 3 && fromSet.toTick > 3, `a cast of ${name} that returns ${result} puts off a tick that was due`);
    }
  }
  check(castResults.has(0) && castResults.has(1) && castResults.has(3), 'the casts return 0, 1 and 3');
  // A rune (101) leaves `d.clockTick` alone (Magic.cpp:566-581).
  const runeFromClear = magicClick([], runeX, runeY, false);
  const runeAdded = party.champions[0]!.incantation.length === 1;
  const runeFromSet = magicClick([], runeX, runeY, true);
  row('_MagicSelection (rune 101)', runeAdded ? 'added' : 'refused', runeFromClear.toTick, runeFromSet.toTick === runeFromSet.held, 'untouched');
  check(runeAdded && runeFromClear.held === 4 && runeFromSet.held === 4,
    "a rune's flash holds the loop four VBLs, the cast's three and its `wvbl`, and the rune is added");
  check(runeFromClear.toTick > 4, 'a rune brings no tick on');
  check(runeFromSet.toTick === 4 && runeFromSet.next === 5,
    'a tick due while the flash held the pass runs in the VBL _MagicSelection returns, and the click behind is taken in the next');

  // `_TurnParty` and `MoveParty` open with `if (extraTicks) d.clockTick = 1;`, and
  // `extraTicks` is on (CSBCode.cpp:7866-7869, :8084-8087, data.cpp:279). A step the
  // terrain refuses then sets it to 0 (:8310-8314).
  soloParty();
  const facingBefore = party.facing;
  const turnFrames = framesToTick(() => {}, 1);
  const turned = party.facing !== facingBefore;
  row('_TurnParty (button 1)', turned ? 'turned' : 'still', turnFrames, '-', 'set');
  check(turned && turnFrames === 1, 'a turn makes a tick due (extraTicks)');
  soloParty();
  const stepFrames = framesToTick(() => {}, 3);
  const steppedOnce = party.position.x !== scene.x || party.position.y !== scene.y;
  row('MoveParty (button 3)', steppedOnce ? 'stepped' : 'still', stepFrames, '-', 'set');
  check(steppedOnce && stepFrames === 1, 'a step makes a tick due (extraTicks)');
  soloParty();
  party.position = new Position(bareScene.x, bareScene.y, level);
  game.ctx.party.setFacing(bareScene.dir);
  const bumpRuns = dueTickRuns(() => {}, 3);
  const bumped = party.position.x === bareScene.x && party.position.y === bareScene.y;
  console.log(['MoveParty into stone', bumped ? 'refused' : 'stepped', '-', bumpRuns, 'cleared'].join('\t'));
  check(bumped && !bumpRuns, 'a step into stone still puts off a tick that was due');
  party.champions = [];
  party.selectedCharacterIndex = -1;

  finish();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
