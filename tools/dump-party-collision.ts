/**
 * Prove the party cannot walk through a monster.
 *
 * `MoveParty` treats a monster in the destination cell exactly as it treats a wall —
 * it sets the same inhibit flag (`doc/CSBwin-src/CSBCode.cpp:8286-8304`) — but the
 * two are not otherwise alike, and the differences are what this checks:
 *
 * - the wall bump queues sound 18; the monster bump is **silent**;
 * - the monster bump calls `ProcessTimers29to41(x, y, TT_M1, 0)`, so being walked
 *   into gives the group a turn. The wall does not.
 * - `FindFirstMonster` does not test `NonMaterial()`, so an immaterial monster blocks
 *   the party even though it does not stop a closing door.
 * - the whole block is gated on `d.NumCharacter != 0`.
 * - a wall bump hurts up to two champions on the wall side, and the sound is queued only
 *   if one of them was hurt (`:8263-8291`).
 * - either bump discards all queued input and postpones a due tick by a frame
 *   (`:8310-8314`).
 * - every attempted step costs each champion `3 * load / MaxLoad + 1` stamina, bump or
 *   not (`:8088-8101`, `:8129-8135`); a turn costs nothing.
 * - a step sets a move delay, in ticks, from the slowest living champion's `TimeToMove`;
 *   a throw locks steps in its direction for 4 ticks; one turn or step per tick
 *   (`:8326-8349`, `Mouse.cpp:1468-1496`).
 *
 * None of that is visible in `tools/check-frames.sh` — the party either arrives in a
 * cell or does not, and until this was ported it always arrived.
 *
 * Run: `npx tsx tools/dump-party-collision.ts [level]`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DBType, decodeObjectID, OBJECT_ID_EOF, Position, RoomType } from '../src/core/types';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { Game } from '../src/engine/Game';
import { makeAddCharacterAttributes } from '../src/engine/attributes';
import { MovementAction } from '../src/engine/gameTypes';
import type { Champion, MovementResult } from '../src/engine/gameTypes';
import { SoundIndex } from '../src/core/constants';
import { MonsterType } from '../src/engine/monsterTypes';
import { TimerFunction } from '../src/engine/TimerQueue';
import { extractObjectTables } from '../src/renderer/csbwin/ObjectTables';
import { extractViewportTables } from '../src/renderer/csbwin/ViewportTables';
import { extractUITables } from '../src/renderer/csbwin/UITables';
import { sw } from '../src/core/intCast';
import { check, finish } from './lib/check';

/** A plain champion — the party only has to exist for `d.NumCharacter != 0`. */
function champion(i: number): Champion {
  return {
    name: `HERO${i}`,
    attributes: {
      health: 200, maxHealth: 200, stamina: 100, maxStamina: 100, mana: 50, maxMana: 50,
      stats: makeAddCharacterAttributes([60, 60, 50, 50, 50, 20, 20]),
      experience: 0, fighter: 0, ninja: 0, priest: 0, wizard: 0,
    },
    alive: true, incantation: [], food: 1500, water: 1500,
    skills: [],
    possessions: new Array(30).fill(null),
    partyPosition: i,
  };
}

async function main(): Promise<void> {
  const loader = new DungeonLoader();
  await loader.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/dungeon.dat'))));
  const data = loader.getData();
  if (!data) throw new Error('dungeon.dat did not load');

  const graphics = new GraphicsLoader();
  graphics.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/graphics.dat'))));
  const viewportTables = extractViewportTables(graphics);
  const objectTables = extractObjectTables(graphics, viewportTables.wallRectanglesOffset);
  const uiTables = extractUITables(graphics);

  const level = Number(process.argv[2] ?? 2);
  const game = new Game(
    data,
    {
      roomTimerFunctions: uiTables.graphic232.byte1596,
      monsterDesc: objectTables.monsterDesc,
      objDescObjectType: objectTables.objDescObjectType,
      weaponDesc: objectTables.weaponDesc,
      weaponWeights: objectTables.weaponWeights,
      clothingWeights: objectTables.clothingWeights,
      miscWeights: objectTables.miscWeights,
    },
    {
      monsterDesc: objectTables.monsterDesc,
      word1074: uiTables.graphic232.word1074,
      soundTable: uiTables.graphic232.soundTable,
      doorCharacteristics: objectTables.doorCharacteristics,
      monsterDroppings: objectTables.monsterDroppings,
      facingReplication: objectTables.facingReplication,
      // `GetCharacterToDamage` picks the wall-bump victims through `Byte586`; without it
      // `determineAttackOrder` falls back to a placeholder order.
      byte586: uiTables.graphic232.byte586,
      clothingArmour: objectTables.clothingArmour,
      clothingFlags: objectTables.clothingFlags,
    },
  );
  game.setRandomSeed(0x12345678);
  game.party.state.position = new Position(0, 0, level);
  game.monsterSystem.loadPartyLevel(level);

  const dungeon = game.dungeonState;
  const map = dungeon.getMap(level);
  if (!map) throw new Error(`level ${level} does not exist`);
  const { width, height } = map.descriptor;

  const roomTypeAt = (x: number, y: number): number =>
    (dungeon.getCellFlag(new Position(x, y, level)) >> 5) & 0x7;
  const monsterAt = (x: number, y: number): boolean =>
    game.dungeonState.findFirstMonster(new Position(x, y, level)) !== OBJECT_ID_EOF;

  // Find a monster with an open, monster-free neighbour: the party stands on the
  // neighbour and walks into the monster. Real dungeon geometry throughout.
  let scene: { px: number; py: number; mx: number; my: number } | null = null;
  const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;
  for (let x = 0; x < width && !scene; x++) {
    for (let y = 0; y < height && !scene; y++) {
      if (!monsterAt(x, y)) continue;
      for (const [dx, dy] of DIRS) {
        const px = x + dx;
        const py = y + dy;
        if (px < 0 || py < 0 || px >= width || py >= height) continue;
        if (roomTypeAt(px, py) !== RoomType.OPEN) continue;
        if (monsterAt(px, py)) continue;
        scene = { px, py, mx: x, my: y };
        break;
      }
    }
  }
  if (!scene) throw new Error(`no monster with a free open neighbour on level ${level}`);

  // Face the monster. `facing` 0=N 1=E 2=S 3=W, matching `UpdateXY`.
  const dx = scene.mx - scene.px;
  const dy = scene.my - scene.py;
  const facing = dy === -1 ? 0 : dx === 1 ? 1 : dy === 1 ? 2 : 3;
  const monsterRn = game.dungeonState.findFirstMonster(new Position(scene.mx, scene.my, level));
  const creature = dungeon.getCreatureRecord(monsterRn)!;

  console.log(
    `level ${level}: party at (${scene.px},${scene.py}) facing ${facing}, ` +
      `${MonsterType[creature.creatureType]} at (${scene.mx},${scene.my})\n`,
  );

  // `Game.move` does not play the bump sound — it puts a `soundId` on the
  // `MovementResult` and `main.ts` plays it (`src/main.ts:385`). So the sound has to
  // be read off the result, not off a sound hook; the first draft of this tool
  // counted hook calls and saw silence for the wall too.
  let lastResult: MovementResult | undefined;
  game.onMove((_success, result) => {
    lastResult = result;
  });
  const soundOfLastMove = (): number | undefined => lastResult?.soundId;

  const stand = (): void => {
    game.party.state.position = new Position(scene!.px, scene!.py, level);
    game.party.setFacing(facing);
  };

  const rows: string[][] = [];
  const attempt = (label: string): { moved: boolean; soundId: number | undefined } => {
    stand();
    lastResult = undefined;
    const moved = game.move(MovementAction.MOVE_FORWARD);
    const pos = game.party.state.position;
    const soundId = soundOfLastMove();
    rows.push([label, moved ? 'moved' : 'blocked', `(${pos.x},${pos.y})`, String(soundId ?? 'none')]);
    return { moved, soundId };
  };

  // ---- Case 1: no champions — CSBWin's `d.NumCharacter != 0` gate is off ----
  game.party.state.champions = [];
  const empty = attempt('no champions (gate off)');

  // ---- Case 2: a real party walks into the monster ------------------------
  game.party.state.champions = [champion(0)];
  const blocked = attempt('party vs monster');

  // ---- Case 3: the same party walks into a wall, for contrast -------------
  // A wall bump is *not* silent, which is how we know case 2's silence is real
  // rather than the sound hook never having been wired.
  let wall: { px: number; py: number; facing: number } | null = null;
  for (let x = 0; x < width && !wall; x++) {
    for (let y = 0; y < height && !wall; y++) {
      if (roomTypeAt(x, y) !== RoomType.OPEN) continue;
      for (let dir = 0; dir < 4; dir++) {
        const [wdx, wdy] = DIRS[dir];
        const nx = x + wdx;
        const ny = y + wdy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        if (roomTypeAt(nx, ny) !== RoomType.STONE) continue;
        wall = { px: x, py: y, facing: dir };
        break;
      }
    }
  }
  let wallResult: { moved: boolean; soundId: number | undefined } = { moved: true, soundId: undefined };
  if (wall) {
    game.party.state.position = new Position(wall.px, wall.py, level);
    game.party.setFacing(wall.facing);
    lastResult = undefined;
    const moved = game.move(MovementAction.MOVE_FORWARD);
    const pos = game.party.state.position;
    wallResult = { moved, soundId: soundOfLastMove() };
    rows.push(['party vs wall', moved ? 'moved' : 'blocked', `(${pos.x},${pos.y})`, String(wallResult.soundId ?? 'none')]);
  }

  console.log(['case', 'outcome', 'ended at', 'sound'].join('\t'));
  for (const row of rows) console.log(row.join('\t'));
  console.log('');

  // ---- Case 4: the bump gives the group a turn ----------------------------
  // `ProcessTimers29to41(..., TT_M1, 0)` is the whole reason a bump is not a no-op:
  // `InitialChecks` turns `TT_M1` into a `TT_31` timer one tick out
  // (`doc/CSBwin-src/Monster.cpp:3026-3055`), and CSB.h names that timer
  // `TT_31 = 31, // When Party ran into monster` — this mechanism and no other.
  //
  // One timer per bump is correct, not a leak: `SetTimer`'s duplicate suppression
  // only covers `TT_MAP_FIRST..TT_MAP_LAST` (5..10) plus `TT_1`/`TT_DOOR`/
  // `TT_BASH_DOOR` (`doc/CSBwin-src/Timer.cpp:1011-1052`), and 31 is outside it. The
  // clock is frozen here so they pile up visibly; in play each fires on the next tick.
  game.party.state.champions = [champion(0)];
  const untouchedRn = (() => {
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        if (x === scene.mx && y === scene.my) continue;
        const rn = game.dungeonState.findFirstMonster(new Position(x, y, level));
        if (rn !== OBJECT_ID_EOF) return rn;
      }
    }
    return OBJECT_ID_EOF;
  })();

  const aiTimersFor = (x: number, y: number): string =>
    game.timerQueue
      .getTimers()
      .filter(
        (t) =>
          t.function >= TimerFunction.TT_FIRST_MONSTER_AI &&
          t.function <= TimerFunction.TT_LAST_MONSTER_AI &&
          t.uByte6 === x &&
          t.uByte7 === y,
      )
      .map((t) => `${t.function}@${t.time}`)
      .sort()
      .join(',');

  const timersBeforeBump = aiTimersFor(scene.mx, scene.my);
  let bumps = 0;
  const originalFear = creature.fear;
  const untouched = untouchedRn !== OBJECT_ID_EOF ? dungeon.getCreatureRecord(untouchedRn) : null;
  const untouchedFearBefore = untouched?.fear ?? -1;
  for (let i = 0; i < 20; i++) {
    stand();
    if (game.move(MovementAction.MOVE_FORWARD)) break;
    bumps++;
  }
  const timersAfterBump = aiTimersFor(scene.mx, scene.my);
  console.log(
    `bumped ${bumps}x: fear ${originalFear} -> ${creature.fear}` +
      (untouched ? `, untouched group ${untouchedFearBefore} -> ${untouched.fear}` : ''),
  );
  console.log(`  AI timers before: ${timersBeforeBump || '(none)'}`);
  console.log(`  AI timers after:  ${timersAfterBump || '(none)'}`);
  console.log('');

  // ---- Case 5: a wall bump hurts the champions on the wall side -----------
  // `MoveParty`'s inhibited-move arm (doc/CSBwin-src/CSBCode.cpp:8263-8291): the side of
  // the new cell being crossed is `direction + partyFacing + 2`, and
  // `GetCharacterToDamage` on that corner and the next picks up to two champions for
  // `DamageCharacter(ch, 1, 24, 2)`. Sound 18 is queued only if one of them was hurt.
  // With `P4 == 2` and no armour a blow of 1 comes out as `1 * (130 - 0) >> 6 = 2`
  // (`Character.cpp:2780-2789`), on the legs and feet (mask 24).
  let wallHurt: { front: number[]; back: number[]; soundId: number | undefined; moved: boolean } | null = null;
  let emptyWall: { moved: boolean; soundId: number | undefined } | null = null;
  if (wall) {
    const standAtWall = (): void => {
      game.party.state.position = new Position(wall!.px, wall!.py, level);
      game.party.setFacing(wall!.facing);
      lastResult = undefined;
    };
    game.party.state.champions = [champion(0), champion(1), champion(2), champion(3)];
    standAtWall();
    const moved = game.move(MovementAction.MOVE_FORWARD);
    // Corners are absolute, 0=NW 1=NE 2=SE 3=SW, so the two facing the wall are
    // `facing` and `facing + 1`.
    const frontCorners = [wall.facing & 3, (wall.facing + 1) & 3];
    const lost = (c: Champion): number => 200 - c.attributes.health;
    const champs = game.party.state.champions;
    wallHurt = {
      front: champs.filter((c) => frontCorners.includes(c.partyPosition)).map(lost),
      back: champs.filter((c) => !frontCorners.includes(c.partyPosition)).map(lost),
      soundId: soundOfLastMove(),
      moved,
    };
    console.log(
      `wall bump, party of four facing ${wall.facing}: front lost ${wallHurt.front.join('/')}, ` +
        `back lost ${wallHurt.back.join('/')}, sound ${wallHurt.soundId ?? 'none'}`,
    );

    // The sound is `if (k != 0)` — nobody hurt, no sound. An empty party is the
    // simplest way there: `d.NumCharacter == 0` skips the damage entirely.
    game.party.state.champions = [];
    standAtWall();
    emptyWall = { moved: game.move(MovementAction.MOVE_FORWARD), soundId: soundOfLastMove() };
    console.log(`wall bump, no champions: ${emptyWall.moved ? 'moved' : 'blocked'}, sound ${emptyWall.soundId ?? 'none'}`);
    console.log('');
  }

  // ---- Case 6: an inhibited move discards all input and postpones the tick --
  // `if (D5W != 0) { DiscardAllInput(); d.clockTick = 0; }`
  // (doc/CSBwin-src/CSBCode.cpp:8310-8314), for a wall and for a monster alike.
  // `DiscardAllInput` empties the key queue and the mouse queue (`:7532`); the port's
  // one input queue is `Game`'s mouse queue. `d.clockTick = 0` cancels a tick that was due:
  // the VBL sets it again on the next VBL, since `vblCount` is still `>= d.Speed`
  // (`:1066-1077`), so the tick runs one frame later.
  type Internals = { lastTickTime: number; lastInputTime: number; newPartyLevel: boolean };
  const internals = game as unknown as Internals;
  const T0 = Date.now() + 60_000;
  let discard: {
    wallQueue: number; tickHeld: boolean; tickNextFrame: boolean; facingKept: boolean;
    monsterQueue: number; turnQueue: number;
  } | null = null;
  if (wall) {
    const queueAt = (px: number, py: number, dir: number, actions: MovementAction[]): void => {
      game.party.state.position = new Position(px, py, level);
      game.party.setFacing(dir);
      // The headless equivalent of waiting out the last step's delay (case 8).
      game.party.state.partyMoveDisableTimer = 0;
      internals.lastInputTime = 0;
      game.discardAllInput();
      for (const a of actions) game.enqueueMovement(a);
    };
    game.party.state.champions = [champion(0), champion(1), champion(2), champion(3)];

    // The monster first, with no tick due, so that it is still where the scene found it.
    queueAt(scene.px, scene.py, facing, [MovementAction.MOVE_FORWARD, MovementAction.TURN_LEFT]);
    internals.lastTickTime = T0 - 20_000;
    game.runFrame(T0 - 20_000);
    const monsterQueue = game.queuedInputCount();

    queueAt(wall.px, wall.py, wall.facing, [MovementAction.MOVE_FORWARD, MovementAction.TURN_LEFT]);
    internals.lastTickTime = T0 - 1000; // a tick is due this frame
    const ticks0 = game.state.tickCount;
    game.runFrame(T0);
    const wallQueue = game.queuedInputCount();
    const tickHeld = game.state.tickCount === ticks0;
    game.runFrame(T0 + 17);
    const tickNextFrame = game.state.tickCount === ticks0 + 1;
    game.runFrame(T0 + 5_000);
    game.runFrame(T0 + 10_000);
    const facingKept = game.party.state.facing === wall.facing;

    // Control: a move that is not inhibited leaves the rest of the queue alone.
    queueAt(wall.px, wall.py, wall.facing, [MovementAction.TURN_LEFT, MovementAction.TURN_LEFT]);
    game.runFrame(T0 + 30_000);
    const turnQueue = game.queuedInputCount();

    discard = { wallQueue, tickHeld, tickNextFrame, facingKept, monsterQueue, turnQueue };
    console.log(
      `queued input after a wall bump: ${wallQueue}, after a monster bump: ${monsterQueue}, ` +
        `after a turn: ${turnQueue}; due tick held ${tickHeld}, ran next frame ${tickNextFrame}`,
    );
    console.log('');
  }

  // ---- Case 7: every attempted step costs stamina --------------------------
  // `sw((3*load)/MaxLoad + 1)` for each champion, charged after the party-move filter and
  // before the destination is looked at (doc/CSBwin-src/CSBCode.cpp:8088-8101,
  // `:8129-8135`), so a bump pays as much as a step. A turn is `TurnParty`: free.
  // `AdjustStamina` turns whatever overshoots zero into `DamageCharacter(ch, over/2, 0, 0)`.
  let stamina: {
    bump: number[]; turn: number[]; loaded: number; loadedCost: number; exhaustedHp: number; exhaustedSt: number;
  } | null = null;
  if (wall) {
    const standAtWall = (): void => {
      game.party.state.position = new Position(wall!.px, wall!.py, level);
      game.party.setFacing(wall!.facing);
    };
    game.party.state.champions = [champion(0), champion(1), champion(2), champion(3)];
    const champs = game.party.state.champions;
    const st = (): number[] => champs.map((c) => c.attributes.stamina);
    standAtWall();
    game.move(MovementAction.MOVE_FORWARD);
    const bump = st().map((s) => 100 - s);
    const beforeTurn = st();
    game.move(MovementAction.TURN_LEFT);
    const turn = st().map((s, i) => beforeTurn[i] - s);

    // A load makes the formula non-trivial: 3 * 400 / MaxLoad + 1.
    const stats = game.characterStats;
    const realLoad = stats.characterLoad.bind(stats);
    const back = champs.findIndex((c) => ![wall!.facing & 3, (wall!.facing + 1) & 3].includes(c.partyPosition));
    const laden = champs.findIndex((_c, i) => i !== back);
    stats.characterLoad = (c: Champion) => (c === champs[laden] ? 400 : c === champs[back] ? 2000 : 0);
    for (const c of champs) c.attributes.stamina = 100;
    champs[back].attributes.stamina = 1;
    // After the stamina is set: `MaxLoad` is stamina-adjusted, so the tired champion's is lower.
    const loadedCost = sw(Math.trunc((3 * 400) / stats.maxLoad(champs[laden])) + 1);
    const exhaustCost = sw(Math.trunc((3 * 2000) / stats.maxLoad(champs[back])) + 1);
    standAtWall();
    game.move(MovementAction.MOVE_FORWARD);
    stats.characterLoad = realLoad;
    stamina = {
      bump, turn, loaded: 100 - champs[laden].attributes.stamina, loadedCost,
      // The back-row champion is not hurt by the bump, so all the HP lost is exhaustion.
      exhaustedHp: 200 - champs[back].attributes.health,
      exhaustedSt: champs[back].attributes.stamina,
    };
    console.log(
      `stamina: a bump cost ${bump.join('/')}, a turn ${turn.join('/')}; ` +
        `load 400 cost ${stamina.loaded} (formula ${loadedCost}); ` +
        `stamina 1 against a cost of ${exhaustCost}: stamina ${stamina.exhaustedSt}, lost ${stamina.exhaustedHp} HP`,
    );
    console.log('');
    check(bump.every((n) => n === 1), `an unladen champion should pay 1 stamina for a bump (${bump.join('/')})`);
    check(turn.every((n) => n === 0), `a turn should cost no stamina (${turn.join('/')})`);
    check(stamina.loaded === loadedCost, `a load of 400 should cost 3*400/MaxLoad+1 = ${loadedCost} (paid ${stamina.loaded})`);
    check(stamina.exhaustedSt === 0, 'stamina should bottom out at 0');
    check(
      stamina.exhaustedHp === Math.trunc((exhaustCost - 1) / 2),
      `the overshoot should come off health at half rate: ${Math.trunc((exhaustCost - 1) / 2)} (lost ${stamina.exhaustedHp})`,
    );
  }

  // ---- Case 8: the move delay is counted in ticks ---------------------------
  // A step sets `d.partyMoveDisableTimer` to the slowest living champion's `TimeToMove`
  // (doc/CSBwin-src/CSBCode.cpp:8326-8347), each tick counts it down (`:689-692`), and
  // `HandleMouseEvents` holds a queued *step* while it is non-zero, or while a throw's
  // `d.Word11712` lock is on and the step heads in direction `d.Word11714`
  // (Mouse.cpp:1482-1496). Any turn or step also waits for the next tick
  // (`d.Time < lastTime + 1`, `:1468-1476`). A turn ignores the move delay.
  {
    const open = (x: number, y: number): boolean =>
      x >= 0 && y >= 0 && x < width && y < height && roomTypeAt(x, y) === RoomType.OPEN &&
      (dungeon.getCellFlag(new Position(x, y, level)) & 0x10) === 0 && !monsterAt(x, y);
    let run: { x: number; y: number; dir: number } | null = null;
    for (let x = 0; x < width && !run; x++) {
      for (let y = 0; y < height && !run; y++) {
        for (let dir = 0; dir < 4 && !run; dir++) {
          const [ddx, ddy] = DIRS[dir];
          if (open(x, y) && open(x + ddx, y + ddy) && open(x + 2 * ddx, y + 2 * ddy)) run = { x, y, dir };
        }
      }
    }
    check(run !== null, 'the level should have three open, empty cells in a row');
    if (run) {
      const party = game.party.state;
      party.champions = [champion(0), champion(1), champion(2), champion(3)];
      party.position = new Position(run.x, run.y, level);
      game.party.setFacing(run.dir);
      party.partyMoveDisableTimer = 0;
      party.word11712 = 0;
      internals.lastInputTime = 0;
      game.discardAllInput();
      let t = T0 + 100_000;
      const frame = (tickDue: boolean): void => {
        t += 17;
        internals.lastTickTime = tickDue ? t - 1000 : t;
        game.runFrame(t);
      };
      const stepsFrom = (): number => Math.abs(party.position.x - run!.x) + Math.abs(party.position.y - run!.y);

      game.enqueueMovement(MovementAction.MOVE_FORWARD);
      game.enqueueMovement(MovementAction.MOVE_FORWARD);
      frame(false);
      const firstStep = stepsFrom();
      const delayAfterStep = party.partyMoveDisableTimer;
      const ticks0 = game.state.tickCount;
      frame(false);
      const heldSameTick = stepsFrom();
      let frames = 0;
      while (stepsFrom() < 2 && frames < 40) {
        frame(frames % 2 === 1);
        frames++;
      }
      const ticksToSecond = game.state.tickCount - ticks0;

      // A turn waits for the next tick, but not for the move delay.
      game.enqueueMovement(MovementAction.TURN_LEFT);
      frame(false);
      const turnedSameTick = party.facing !== run.dir;
      frame(true);
      frame(false);
      const turnedUnderDelay = party.facing !== run.dir && party.partyMoveDisableTimer !== 0;

      // The throw lock holds a step in the thrown direction and lets others through.
      game.discardAllInput();
      party.partyMoveDisableTimer = 0;
      party.word11712 = 4;
      party.word11714 = party.facing;
      game.enqueueMovement(MovementAction.MOVE_FORWARD);
      frame(true);
      frame(false);
      const lockHeld = game.queuedInputCount() === 1;
      game.discardAllInput();
      game.enqueueMovement(MovementAction.MOVE_BACKWARD);
      frame(true);
      frame(false);
      const otherWayPassed = game.queuedInputCount() === 0;
      party.word11712 = 0;
      game.discardAllInput();

      // `TimeToMove` (CSBCode.cpp:7003) and the slowest-living rule.
      const stats = game.characterStats;
      const realLoad = stats.characterLoad.bind(stats);
      const c0 = party.champions[0];
      const max = stats.maxLoad(c0);
      const ttm = (load: number, wounds = 0): number => {
        stats.characterLoad = () => load;
        c0.wounds = wounds;
        const v = stats.timeToMove(c0);
        c0.wounds = 0;
        return v;
      };
      const table = {
        empty: ttm(0), laden: ttm(Math.trunc((max * 6) / 8)), over: ttm(Math.trunc((max * 3) / 2)),
        emptyFoot: ttm(0, 32), overFoot: ttm(Math.trunc((max * 3) / 2), 32),
      };
      const overExpected = sw(4 + Math.trunc(((4 * (Math.trunc((max * 3) / 2) - max)) & 0xffff) / max));
      // Champion 1 laden, champion 2 overloaded but dead: the delay is champion 1's.
      stats.characterLoad = (c: Champion) =>
        c === party.champions[1] ? Math.trunc((max * 6) / 8) : c === party.champions[2] ? max * 2 : 0;
      party.champions[2].attributes.health = 0;
      party.position = new Position(run.x, run.y, level);
      game.party.setFacing(run.dir);
      game.move(MovementAction.MOVE_FORWARD);
      const slowestLiving = party.partyMoveDisableTimer;
      stats.characterLoad = realLoad;

      console.log(
        `move delay: first step ${firstStep}, delay ${delayAfterStep}, second step held in the same tick ` +
          `${heldSameTick === 1}, taken after ${ticksToSecond} tick(s); a turn in the same tick ${turnedSameTick}, ` +
          `under the delay ${turnedUnderDelay}; throw lock held ${lockHeld}, the other way passed ${otherWayPassed}`,
      );
      console.log(`TimeToMove: ${JSON.stringify(table)} (over expected ${overExpected}); slowest living ${slowestLiving}`);
      console.log('');

      check(firstStep === 1, 'the first queued step should be taken at once');
      check(delayAfterStep === 2, `an unladen party's step should set a delay of 2 ticks (${delayAfterStep})`);
      check(heldSameTick === 1, 'the second step should be held while the delay runs');
      check(ticksToSecond === 2, `the second step should come 2 ticks after the first (${ticksToSecond})`);
      check(!turnedSameTick, 'a turn should wait for the next tick (one event per tick)');
      check(turnedUnderDelay, 'a turn should not wait for the move delay');
      check(lockHeld, "a step in the thrown direction should be held while d.Word11712 is set");
      check(otherWayPassed, 'a step the other way should not be held by the throw lock');
      check(table.empty === 2 && table.laden === 3 && table.over === overExpected,
        `TimeToMove should be 2 unladen, 3 past 5/8 of MaxLoad, ${overExpected} overloaded (${JSON.stringify(table)})`);
      check(table.emptyFoot === 3 && table.overFoot === overExpected + 2,
        'a wounded foot should add 1, or 2 when overloaded');
      check(slowestLiving === 3, `the delay should be the slowest *living* champion's (${slowestLiving})`);
    }
  }

  // ---- Case 9: seven moves wait, not eight --------------------------------
  // `TAG0196da` puts a key into the mouse queue only if `MouseQEnd + 2 != MouseQStart`
  // (doc/CSBwin-src/CSBCode.cpp:8439-8443), and `MOUSEQLEN` is 8 (Data.h:1517 — the 3 on
  // `:1515` is behind `NoKeyQue`, which `:1513` leaves undefined). The clicks that share
  // the queue are `tools/dump-mouse-queue.ts`'.
  {
    game.discardAllInput();
    const accepted = Array.from({ length: 8 }, () => game.enqueueMovement(MovementAction.TURN_LEFT));
    console.log(`queue depth: ${accepted.map((a) => (a ? 'in' : 'refused')).join(', ')}`);
    console.log('');
    check(accepted.slice(0, 7).every(Boolean) && !accepted[7], `seven moves should queue and an eighth be refused (${accepted.join('/')})`);
    game.discardAllInput();
  }

  // ---- Case 10: a level change discards all input, at the next tick ---------
  // CSBWin sets `d.newPartyLevel` when the party changes level and, at the top of the
  // next tick, `LoadPartyLevel(...); MoveObject(...); d.newPartyLevel = -1;
  // DiscardAllInput();` (doc/CSBwin-src/CSBCode.cpp:615-623). A turn queued behind a step
  // onto the stairs is therefore lost.
  {
    let stairs: { px: number; py: number; dir: number } | null = null;
    for (let x = 0; x < width && !stairs; x++) {
      for (let y = 0; y < height && !stairs; y++) {
        if (roomTypeAt(x, y) !== RoomType.OPEN || monsterAt(x, y)) continue;
        for (let dir = 0; dir < 4; dir++) {
          const [ddx, ddy] = DIRS[dir];
          const nx = x + ddx;
          const ny = y + ddy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          if (roomTypeAt(nx, ny) === RoomType.STAIRS) { stairs = { px: x, py: y, dir }; break; }
        }
      }
    }
    check(stairs !== null, 'the level should have an open cell beside a stairway');
    if (stairs) {
      const party = game.party.state;
      party.champions = [champion(0), champion(1), champion(2), champion(3)];
      party.position = new Position(stairs.px, stairs.py, level);
      game.party.setFacing(stairs.dir);
      game.monsterSystem.loadPartyLevel(level);
      party.partyMoveDisableTimer = 0;
      internals.lastInputTime = 0;
      game.discardAllInput();
      game.enqueueMovement(MovementAction.MOVE_FORWARD);
      game.enqueueMovement(MovementAction.TURN_LEFT);
      let t = T0 + 200_000;
      const frame = (tickDue: boolean): void => {
        t += 17;
        internals.lastTickTime = tickDue ? t - 1000 : t;
        game.runFrame(t);
      };
      frame(false);
      const newLevel = party.position.z;
      const queuedAfterStairs = game.queuedInputCount();
      frame(true);
      const queuedAfterTick = game.queuedInputCount();
      const facingAfter = party.facing;
      for (let i = 0; i < 6; i++) frame(i % 2 === 0);
      const turned = party.facing !== facingAfter;
      console.log(
        `stairs: level ${level} -> ${newLevel}; queued after the step ${queuedAfterStairs}, ` +
          `after the next tick ${queuedAfterTick}; the queued turn ran ${turned}`,
      );
      console.log('');
      check(newLevel !== level, 'the step onto the stairs should change level');
      check(queuedAfterStairs === 1, 'the turn should still be queued until the next tick');
      check(queuedAfterTick === 0 && !turned, 'the next tick should discard the queued turn (DiscardAllInput)');
      game.party.state.position = new Position(scene.px, scene.py, level);
      game.monsterSystem.loadPartyLevel(level);
    }
  }

  // ---- Case 11: room type 7 is entered -------------------------------------
  // `MoveParty` inhibits a move only into stone, a shut door or a solid false wall
  // (doc/CSBwin-src/CSBCode.cpp:8224-8261); any other room type is walked into. No
  // dungeon or save this port loads has a type-7 cell, so the case makes one.
  {
    let spot: { px: number; py: number; dir: number } | null = null;
    for (let x = 0; x < width && !spot; x++) {
      for (let y = 0; y < height && !spot; y++) {
        if (roomTypeAt(x, y) !== RoomType.OPEN || monsterAt(x, y)) continue;
        for (let dir = 0; dir < 4; dir++) {
          const [ddx, ddy] = DIRS[dir];
          const nx = x + ddx;
          const ny = y + ddy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          if (roomTypeAt(nx, ny) === RoomType.OPEN && !monsterAt(nx, ny)) { spot = { px: x, py: y, dir }; break; }
        }
      }
    }
    check(spot !== null, 'the level should have two open cells side by side');
    if (spot) {
      const [ddx, ddy] = DIRS[spot.dir];
      // The cell is stored twice — `cellFlags` and `tiles` (DEBT.md D5) — so both change.
      const [tx, ty] = [spot.px + ddx, spot.py + ddy];
      const cells = map.cellFlags;
      const saved = cells[tx][ty];
      const savedTile = map.tiles[tx][ty];
      cells[tx][ty] = (RoomType.EMPTY << 5) | (saved & 0x1f);
      map.tiles[tx][ty] = { ...savedTile, cellFlag: cells[tx][ty], roomType: RoomType.EMPTY };
      game.party.state.champions = [champion(0), champion(1), champion(2), champion(3)];
      game.party.state.position = new Position(spot.px, spot.py, level);
      game.party.setFacing(spot.dir);
      const entered = game.move(MovementAction.MOVE_FORWARD);
      cells[tx][ty] = saved;
      map.tiles[tx][ty] = savedTile;
      console.log(`room type 7: ${entered ? 'entered' : 'refused'}`);
      console.log('');
      check(entered, 'a room-type-7 cell should be walked into, as CSBWin does');
    }
  }

  // ---- Case 12: a level change inside ProcessTimers is loaded in the same tick
  // The main loop runs `ProcessTimers()` and then `if (d.newPartyLevel != -1) goto
  // tag0006a4;` (doc/CSBwin-src/CSBCode.cpp:635): a pit a timer opens under the party has
  // the new level loaded, the input discarded and `ProcessTimers` run again, all before
  // the tick ends (`:615-635`). A turn queued before the pit opened is lost, and never
  // runs on the new level.
  {
    let pit: { x: number; y: number } | null = null;
    for (let x = 0; x < width && !pit; x++) {
      for (let y = 0; y < height && !pit; y++) {
        if (roomTypeAt(x, y) !== RoomType.PIT || monsterAt(x, y)) continue;
        if (dungeon.incrementLevel(new Position(x, y, level), 1)) pit = { x, y };
      }
    }
    check(pit !== null, 'the level should have a pit with a level under it');
    if (pit) {
      const cells = map.cellFlags;
      const saved = cells[pit.x][pit.y];
      const savedTile = map.tiles[pit.x][pit.y];
      const setCell = (v: number): void => {
        cells[pit.x][pit.y] = v;
        map.tiles[pit.x][pit.y] = { ...savedTile, cellFlag: v };
      };
      setCell(saved & 0xf7); // closed: the party stands on it
      const party = game.party.state;
      party.champions = [champion(0), champion(1), champion(2), champion(3)];
      party.position = new Position(pit.x, pit.y, level);
      game.monsterSystem.loadPartyLevel(level);
      party.partyMoveDisableTimer = 0;
      internals.lastInputTime = 0;
      game.discardAllInput();
      internals.newPartyLevel = false;
      // An event was handled this tick, so the turn waits for the next one
      // (`Mouse.cpp:1468-1476`) — past the tick in which the pit opens.
      internals.lastInputTime = game.state.tickCount;
      game.enqueueMovement(MovementAction.TURN_LEFT);
      const facingBefore = party.facing;
      // `TT_PIT` with `uByte9 = 0` (set: open), due at the next tick.
      game.timerQueue.addTimer({
        index: 0, function: TimerFunction.TT_PIT, time: game.state.tickCount + 1, level,
        uByte5: 0, uByte6: pit.x, uByte7: pit.y, uByte8: 0, uByte9: 0,
        sequence: 0, timerWord8: 0, timerWord6: 0,
      });
      let t = T0 + 400_000;
      const frame = (tickDue: boolean): void => {
        t += 17;
        internals.lastTickTime = tickDue ? t - 1000 : t;
        game.runFrame(t);
      };
      frame(true);
      const newLevel = party.position.z;
      const queuedAfterTick = game.queuedInputCount();
      const loadedAfterTick = game.monsterSystem.needsLevelReload() ? 'not yet' : 'loaded';
      const owedAfterTick = internals.newPartyLevel;
      frame(false);
      const turned = party.facing !== facingBefore;
      console.log(
        `pit timer at (${pit.x},${pit.y}): level ${level} -> ${newLevel}; after the tick the level is ` +
          `${loadedAfterTick}, ${queuedAfterTick} move(s) queued; the queued turn ran ${turned}`,
      );
      console.log('');
      check(newLevel !== level, 'the pit timer should drop the party a level');
      check(loadedAfterTick === 'loaded' && !owedAfterTick, 'the new level should be loaded in the tick the timer ran (CSBCode.cpp:635)');
      check(queuedAfterTick === 0, 'the queued turn should be discarded in that same tick');
      check(!turned, 'the queued turn should never run on the new level');
      setCell(saved);
      map.tiles[pit.x][pit.y] = savedTile;
      game.party.state.position = new Position(scene.px, scene.py, level);
      game.monsterSystem.loadPartyLevel(level);
    }
  }

  // ---- Assertions ---------------------------------------------------------

  check(decodeObjectID(monsterRn).category === DBType.CREATURE, 'the scene should have found a real creature');
  check(roomTypeAt(scene.mx, scene.my) !== RoomType.STONE, 'the monster should not be standing in stone');

  // The vacuity guard: without the `d.NumCharacter != 0` gate the block would fire
  // for everyone, and case 2 would pass for the wrong reason.
  check(empty.moved, 'a party with no champions should walk into the monster (CSBWin gates on d.NumCharacter)');

  check(!blocked.moved, 'a real party should be blocked by the monster');
  check(blocked.soundId === undefined, 'the monster bump should be silent — CSBWin queues no sound for it');
  if (wall) {
    check(!wallResult.moved, 'the party should be blocked by the wall');
    check(wallResult.soundId === SoundIndex.WALL_BUMP, 'the wall bump should carry a sound, unlike the monster bump');
  }
  check(bumps === 20, 'twenty bumps should all be refused — the party never gets through');

  if (wallHurt && emptyWall) {
    check(!wallHurt.moved, 'the party of four should be blocked by the wall');
    check(
      wallHurt.front.length === 2 && wallHurt.front.every((n) => n === 2),
      `both champions on the wall side should lose 2 HP to the bump (lost ${wallHurt.front.join('/')})`,
    );
    check(wallHurt.back.every((n) => n === 0), `the back row should be unhurt (lost ${wallHurt.back.join('/')})`);
    check(wallHurt.soundId === SoundIndex.WALL_BUMP, 'a bump that hurt someone should queue sound 18');
    check(!emptyWall.moved, 'an empty party should still be stopped by the wall');
    check(emptyWall.soundId === undefined, 'a bump that hurt nobody should be silent — CSBWin gates the sound on k != 0');
  } else {
    check(false, 'the level should have an open cell beside a wall');
  }
  if (discard) {
    check(discard.wallQueue === 0, `a wall bump should discard the queued moves (${discard.wallQueue} left)`);
    check(discard.facingKept, 'the turns queued behind a wall bump should never run');
    check(discard.monsterQueue === 0, `a monster bump should discard the queued moves (${discard.monsterQueue} left)`);
    check(discard.turnQueue === 1, `a turn should leave the next queued move in place (${discard.turnQueue} left)`);
    check(discard.tickHeld, 'the bump should postpone the tick that was due (d.clockTick = 0)');
    check(discard.tickNextFrame, 'the postponed tick should run on the next frame');
  }

  // The bump must actually reach the AI. Counting the TT_31 timers it left is the
  // direct evidence that `ProcessTimers29to41(x, y, TT_M1, 0)` ran, once per bump.
  const tt31Before = timersBeforeBump.split(',').filter((t) => t.startsWith('31@')).length;
  const tt31After = timersAfterBump.split(',').filter((t) => t.startsWith('31@')).length;
  check(
    tt31After - tt31Before === bumps,
    `each bump should leave one TT_31 "party ran into monster" timer (${tt31Before} -> ${tt31After} over ${bumps})`,
  );

  finish();
}

main();
