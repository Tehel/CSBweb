/**
 * Prove a closing door does not pass through what is standing under it.
 *
 * `ProcessTT_1` (`doc/CSBwin-src/Timer.cpp:1289-1357`) has two arms that were both
 * missing, so a door used to close straight through the party and through monsters:
 *
 * - **the party arm** springs the door fully open again, calls
 *   `DamageAllCharacters(5, 4, 2)`, and queues `soundDOOROPENING` *only* if somebody
 *   was actually hurt. It is gated on `d.NumCharacter > 0` and on `D4W != 0`.
 * - **the monster arm** damages the group, pokes the survivors with `TT_M3`, steps
 *   the door back **up** one, and queues sound 4. Its gate is `D4W >= D1W`, where
 *   `D1W` is the monster's `VerticalSize()` for an up-down door and 1 for a sideways
 *   one — and an immaterial monster is skipped entirely.
 *
 * The nesting is the part worth checking rather than assuming: `D4W != 0` guards the
 * party arm alone, so a fully open up-down door still crushes a `VerticalSize() == 0`
 * monster. Two of the 27 monster types in the shipped data are that size, so the case
 * is reachable and the loose reading is wrong in play, not just on paper.
 *
 * What to look for: the door state going *up* each time the monster is hit, never
 * reaching 0 while the monster lives, and the party losing health rather than the
 * door quietly finishing its descent.
 *
 * Run: `npx tsx tools/dump-door-crush.ts [level]`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { OBJECT_ID_EOF, Position, RoomType } from '../src/core/types';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { Game } from '../src/engine/Game';
import { makeAddCharacterAttributes } from '../src/engine/attributes';
import type { Champion } from '../src/engine/gameTypes';
import { TimerFunction } from '../src/engine/TimerQueue';
import { MonsterType } from '../src/engine/monsterTypes';
import { monsterNonMaterial, monsterVerticalSize } from '../src/renderer/csbwin/ObjectTables';
import { extractObjectTables } from '../src/renderer/csbwin/ObjectTables';
import { extractViewportTables } from '../src/renderer/csbwin/ViewportTables';
import { extractUITables } from '../src/renderer/csbwin/UITables';
import { check, finish } from './lib/check';

function champion(i: number): Champion {
  return {
    name: `HERO${i}`,
    attributes: {
      health: 200, maxHealth: 200, stamina: 100, maxStamina: 100, mana: 50, maxMana: 50,
      stats: makeAddCharacterAttributes([60, 60, 50, 50, 50, 20, 20]),
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
      monsterAttackSounds: objectTables.monsterAttackSounds,
      uByte590: uiTables.graphic232.uByte590,
      byte586: uiTables.graphic232.byte586,
      clothingArmour: objectTables.clothingArmour,
      clothingFlags: objectTables.clothingFlags,
      byte1412: uiTables.graphic232.byte1412,
      experienceForAttacking: uiTables.graphic230.experienceForAttacking,
      skillNumber: uiTables.graphic230.skillNumber,
      byte20046: uiTables.graphic230.byte20046,
      byte20002: uiTables.graphic230.byte20002,
      byte19958: uiTables.graphic230.byte19958,
      byte19914: uiTables.graphic230.byte19914,
      byte20090: uiTables.graphic230.byte20090,
      attackNames: uiTables.graphic230.attackNames,
    },
  );
  game.setRandomSeed(0x12345678);
  game.party.state.position = new Position(0, 0, level);
  game.monsterSystem.loadPartyLevel(level);

  const dungeon = game.dungeonState;
  const map = dungeon.getMap(level);
  if (!map) throw new Error(`level ${level} does not exist`);
  const { width, height } = map.descriptor;

  const doorStateAt = (x: number, y: number): number => dungeon.getCellFlag(new Position(x, y, level)) & 0x7;
  const setDoorStateAt = (x: number, y: number, state: number): void => {
    const flag = map.cellFlags[x][y];
    const next = (flag & 0xf8) | (state & 0x7);
    map.cellFlags[x][y] = next;
    map.tiles[x][y].cellFlag = next;
    map.tiles[x][y].attributes = next & 0x0f;
  };

  // A real door on this level, with an open neighbour to walk the party in from.
  let door: { x: number; y: number } | null = null;
  for (let x = 0; x < width && !door; x++) {
    for (let y = 0; y < height && !door; y++) {
      if (((dungeon.getCellFlag(new Position(x, y, level)) >> 5) & 0x7) === RoomType.DOOR) door = { x, y };
    }
  }
  if (!door) throw new Error(`no door on level ${level}`);

  const doorRn = dungeon.findFirstDoor(new Position(door.x, door.y, level));
  const doorRecord = doorRn === OBJECT_ID_EOF ? null : dungeon.getDoorRecordByIndex(doorRn & 0x3ff);
  console.log(`level ${level}: door at (${door.x},${door.y}), mode=${doorRecord?.vertical ? 'up-down' : 'sideways'}\n`);

  // A closing door is CSBWin's `TT_1` — `TimerFunction.TT_DOOR_STEP` here — with
  // `uByte9 = 1` (CLEAR, the door comes down). `processDoorStep` re-queues it each
  // step, so it is seeded once and then the clock is turned.
  const startClosing = (): void => {
    game.timerQueue.addTimer({
      index: 0,
      function: TimerFunction.TT_DOOR_STEP,
      time: game.state.tickCount + 1,
      level,
      uByte5: 0,
      uByte6: door!.x,
      uByte7: door!.y,
      uByte8: 0,
      uByte9: 1,
      sequence: 0,
      timerWord8: 0,
      timerWord6: 0,
    });
  };

  const tick = (): void => {
    game.state.tickCount++;
    game.timerSystem.processTimers(game.state.tickCount);
  };

  const rows: string[][] = [];

  // ---- Case 1: the door closes on nothing, and reaches shut ---------------
  setDoorStateAt(door.x, door.y, 0);
  game.party.state.champions = [];
  game.party.state.position = new Position(0, 0, level);
  startClosing();
  for (let i = 0; i < 8; i++) tick();
  const emptyClose = doorStateAt(door.x, door.y);
  rows.push(['empty cell', '—', String(emptyClose)]);

  // ---- Case 2: the door closes on the party -------------------------------
  setDoorStateAt(door.x, door.y, 0);
  game.party.state.champions = [champion(0), champion(1)];
  game.party.state.position = new Position(door.x, door.y, level);
  const hpBefore = game.party.state.champions.map((c) => c.attributes.health);
  startClosing();
  for (let i = 0; i < 8; i++) tick();
  const partyClose = doorStateAt(door.x, door.y);
  const hpAfter = game.party.state.champions.map((c) => c.attributes.health);
  const hpLost = hpBefore.reduce((a, h, i) => a + (h - hpAfter[i]), 0);
  rows.push(['party under it', String(hpLost), String(partyClose)]);

  console.log(['case', 'party HP lost', 'door state after 8 ticks'].join('\t'));
  for (const row of rows) console.log(row.join('\t'));
  console.log('');

  // ---- Case 3: the door closes on a monster -------------------------------
  // Take a real group and put it under the door, which is what a monster walking
  // into a doorway does.
  game.party.state.champions = [];
  game.party.state.position = new Position(0, 0, level);
  setDoorStateAt(door.x, door.y, 0);

  let moved: { rn: number; type: number } | null = null;
  for (let x = 0; x < width && !moved; x++) {
    for (let y = 0; y < height && !moved; y++) {
      const rn = game.dungeonState.findFirstMonster(new Position(x, y, level));
      if (rn === OBJECT_ID_EOF) continue;
      const rec = dungeon.getCreatureRecord(rn);
      if (!rec) continue;
      const desc = objectTables.monsterDesc[rec.creatureType];
      if (!desc || monsterNonMaterial(desc)) continue;
      const result = game.monsterSystem.moveMonster(rn, x, y, door.x, door.y, level);
      if (result.removed) continue;
      moved = { rn, type: rec.creatureType };
    }
  }
  if (!moved) throw new Error(`could not move a material monster onto the door on level ${level}`);

  const creature = dungeon.getCreatureRecord(
    game.dungeonState.findFirstMonster(new Position(door.x, door.y, level)),
  );
  const desc = objectTables.monsterDesc[moved.type];
  const vSize = monsterVerticalSize(desc);
  const hpTotal = (): number => (creature ? creature.hp.reduce((a, h) => a + h, 0) : 0);

  console.log(
    `${MonsterType[moved.type]} under the door: verticalSize=${vSize}, ` +
      `gate needs doorState >= ${doorRecord?.vertical ? vSize : 1}`,
  );

  const states: number[] = [];
  const hpTrace: number[] = [hpTotal()];
  startClosing();
  for (let i = 0; i < 10; i++) {
    tick();
    states.push(doorStateAt(door.x, door.y));
    hpTrace.push(hpTotal());
    if (game.dungeonState.findFirstMonster(new Position(door.x, door.y, level)) === OBJECT_ID_EOF) break;
  }
  console.log(`  door state per tick: ${states.join(' ')}`);
  console.log(`  group HP per tick:   ${hpTrace.join(' ')}`);
  const stillThere = game.dungeonState.findFirstMonster(new Position(door.x, door.y, level)) !== OBJECT_ID_EOF;
  console.log(`  monster still under the door: ${stillThere}`);
  console.log('');

  // ---- Assertions ---------------------------------------------------------

  // Vacuity guard: without a blocker the door must actually shut, or "the door did
  // not shut" below would prove nothing.
  check(emptyClose === 4, `a door closing on an empty cell should reach state 4 (got ${emptyClose})`);

  check(hpLost > 0, 'the party should be hurt by a door closing on them');
  check(partyClose !== 4, 'the door should never finish closing while the party stands under it');

  check(hpTrace[hpTrace.length - 1] < hpTrace[0], 'the group should lose hit points to the door');
  check(
    states.every((state) => state !== 4),
    `the door should never reach fully shut over a monster (states ${states.join(' ')})`,
  );
  // The rebound is the specific behaviour the playtest reported missing: the door
  // does not merely stall, it goes back up.
  check(
    states.some((state, i) => i > 0 && state < states[i - 1]),
    `the door should step back *up* after a crush, not just stall (states ${states.join(' ')})`,
  );

  finish();
}

main();
