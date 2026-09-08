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
import { MovementAction } from '../src/engine/gameTypes';
import type { Champion, MovementResult } from '../src/engine/gameTypes';
import { SoundIndex } from '../src/core/constants';
import { MonsterType } from '../src/engine/monsterTypes';
import { TimerFunction } from '../src/engine/TimerQueue';
import { extractObjectTables } from '../src/renderer/csbwin/ObjectTables';
import { extractViewportTables } from '../src/renderer/csbwin/ViewportTables';
import { extractUITables } from '../src/renderer/csbwin/UITables';
import { check, finish } from './lib/check';

/** A plain champion — the party only has to exist for `d.NumCharacter != 0`. */
function champion(i: number): Champion {
  return {
    name: `HERO${i}`,
    attributes: {
      health: 200, maxHealth: 200, stamina: 100, maxStamina: 100, mana: 50, maxMana: 50,
      luck: 60, strength: 60, dexterity: 50, wisdom: 50, vitality: 50, antiMagic: 20, antiFire: 20,
      experience: 0, fighter: 0, ninja: 0, priest: 0, wizard: 0,
    },
    alive: true, incantation: [], food: 1500, water: 1500,
    skills: [], weaponHand: null, shieldHand: null, quiver: null,
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
    game.monsterSystem.findFirstMonsterAt(new Position(x, y, level)) !== OBJECT_ID_EOF;

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
  const monsterRn = game.monsterSystem.findFirstMonsterAt(new Position(scene.mx, scene.my, level));
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
    game.party.state.lastMoveTime = 0;
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
    game.party.state.lastMoveTime = 0;
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
        const rn = game.monsterSystem.findFirstMonsterAt(new Position(x, y, level));
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
