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
 * Run: `npm test -- --only=dump-door-crush.ts [level]`
 */
import { OBJECT_ID_EOF, Position, RoomType } from '../src/core/types';
import { TimerFunction } from '../src/engine/TimerQueue';
import { MonsterType } from '../src/engine/monsterTypes';
import { monsterNonMaterial, monsterVerticalSize } from '../src/data/tables/MonsterDesc';
import { graphicsTablesOf, newGame, stockDungeon, stockGraphics } from './lib/game';
import { check, finish } from './lib/check';
import { testChampion } from './lib/champion';

async function main(): Promise<void> {
  const data = stockDungeon();

  const graphics = stockGraphics();
  const objectTables = graphicsTablesOf(graphics).objects;

  const level = Number(process.argv[2] ?? 2);
  const game = newGame(data, graphics);
  game.setRandomSeed(0x12345678);
  game.ctx.party.state.position = new Position(0, 0, level);
  game.systems.monsters.loadPartyLevel(level);

  const dungeon = game.ctx.dungeon;
  const map = dungeon.getMap(level);
  if (!map) throw new Error(`level ${level} does not exist`);
  const { width, height } = map.descriptor;

  const doorStateAt = (x: number, y: number): number => dungeon.getCellFlag(new Position(x, y, level)) & 0x7;
  const setDoorStateAt = (x: number, y: number, state: number): void => {
    const flag = map.cellFlags[x][y];
    const next = (flag & 0xf8) | (state & 0x7);
    map.cellFlags[x][y] = next;
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
  const doorRecord = doorRn === OBJECT_ID_EOF ? null : dungeon.getDoorRecordByIndex(dungeon.rnMaps.idx(doorRn));
  console.log(`level ${level}: door at (${door.x},${door.y}), mode=${doorRecord?.vertical ? 'up-down' : 'sideways'}\n`);

  // A closing door is CSBWin's `TT_1` — `TimerFunction.TT_DOOR_STEP` here — with
  // `uByte9 = 1` (CLEAR, the door comes down). `processDoorStep` re-queues it each
  // step, so it is seeded once, due in the next tick, and then the clock is turned.
  const startClosing = (): void => {
    game.ctx.timers.addTimer({
      index: 0,
      function: TimerFunction.TT_DOOR_STEP,
      time: game.ctx.state.tickCount,
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
    game.systems.timer.processTimers();
    game.systems.monsterAttack.displayCharacterDamage();
    game.ctx.state.tickCount++;
  };

  const rows: string[][] = [];

  // ---- Case 1: the door closes on nothing, and reaches shut ---------------
  setDoorStateAt(door.x, door.y, 0);
  game.ctx.party.state.champions = [];
  game.ctx.party.state.position = new Position(0, 0, level);
  startClosing();
  for (let i = 0; i < 8; i++) tick();
  const emptyClose = doorStateAt(door.x, door.y);
  rows.push(['empty cell', '—', String(emptyClose)]);

  // ---- Case 2: the door closes on the party -------------------------------
  setDoorStateAt(door.x, door.y, 0);
  game.ctx.party.state.champions = [testChampion(0), testChampion(1)];
  game.ctx.party.state.position = new Position(door.x, door.y, level);
  const hpBefore = game.ctx.party.state.champions.map((c) => c.attributes.health);
  startClosing();
  for (let i = 0; i < 8; i++) tick();
  const partyClose = doorStateAt(door.x, door.y);
  const hpAfter = game.ctx.party.state.champions.map((c) => c.attributes.health);
  const hpLost = hpBefore.reduce((a, h, i) => a + (h - hpAfter[i]), 0);
  rows.push(['party under it', String(hpLost), String(partyClose)]);

  console.log(['case', 'party HP lost', 'door state after 8 ticks'].join('\t'));
  for (const row of rows) console.log(row.join('\t'));
  console.log('');

  // ---- Case 3: the door closes on a monster -------------------------------
  // Take a real group and put it under the door, which is what a monster walking
  // into a doorway does.
  game.ctx.party.state.champions = [];
  game.ctx.party.state.position = new Position(0, 0, level);
  setDoorStateAt(door.x, door.y, 0);

  let moved: { rn: number; type: number } | null = null;
  for (let x = 0; x < width && !moved; x++) {
    for (let y = 0; y < height && !moved; y++) {
      const rn = game.ctx.dungeon.findFirstMonster(new Position(x, y, level));
      if (rn === OBJECT_ID_EOF) continue;
      const rec = dungeon.getCreatureRecord(rn);
      if (!rec) continue;
      const desc = objectTables.monsterDesc[rec.creatureType];
      if (!desc || monsterNonMaterial(desc)) continue;
      const result = game.systems.monsters.moveMonster(rn, x, y, door.x, door.y, level);
      if (result.code !== 0) continue;
      moved = { rn, type: rec.creatureType };
    }
  }
  if (!moved) throw new Error(`could not move a material monster onto the door on level ${level}`);

  const creature = dungeon.getCreatureRecord(
    game.ctx.dungeon.findFirstMonster(new Position(door.x, door.y, level)),
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
    if (game.ctx.dungeon.findFirstMonster(new Position(door.x, door.y, level)) === OBJECT_ID_EOF) break;
  }
  console.log(`  door state per tick: ${states.join(' ')}`);
  console.log(`  group HP per tick:   ${hpTrace.join(' ')}`);
  const stillThere = game.ctx.dungeon.findFirstMonster(new Position(door.x, door.y, level)) !== OBJECT_ID_EOF;
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
