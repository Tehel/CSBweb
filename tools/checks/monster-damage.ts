/**
 * Exercise `DamageMonster` against the real dungeon.
 *
 * The interesting case is not "monster loses HP" — it is one member of a group dying
 * while the others live. CSBWin compacts the survivors down over the dead member,
 * renumbering five parallel things at once: hit points, the packed position byte, the
 * packed facing byte, the per-member status bytes, and the queued per-member AI
 * timers. This drives that path and checks each of them afterwards.
 *
 * It also kills whole groups, to check that the ITEM16 slot comes back, the AI timers
 * go away, the record leaves the cell, and the droppings and possessions land on the
 * floor.
 *
 * Run: `npm test -- --only=monster-damage.ts [level]`
 */
import { CsbRandom } from '../../src/core/random';
import { DBType, OBJECT_ID_EOF, Position } from '../../src/core/types';
import { DungeonState } from '../../src/engine/DungeonState';
import { MonsterSystem } from '../../src/engine/MonsterSystem';
import { MonsterDamage, MonsterDamageResult } from '../../src/engine/MonsterDamage';
import { TimerQueue, TimerFunction } from '../../src/engine/TimerQueue';
import { WorldMove } from '../../src/engine/WorldMove';
import type { MissileEncounter } from '../../src/engine/MissileEncounter';
import type { ActuatorSystem } from '../../src/engine/ActuatorSystem';
import type { DsaSystem } from '../../src/engine/DsaSystem';
import { MonsterType, StateOfFear } from '../../src/engine/monsterTypes';
import type { PartyState } from '../../src/engine/gameTypes';
import { graphicsTablesOf, newContext, stockDungeon, stockGraphics } from '../lib/game';
import { check, finish } from '../lib/check';
import { standInOf } from '../lib/standIn';

function objectsInCell(dungeon: DungeonState, pos: Position): string[] {
  const out: string[] = [];
  for (let rn = dungeon.findFirstObject(pos); rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) {
    out.push(DBType[dungeon.rnMaps.dbType(rn)] ?? String(dungeon.rnMaps.dbType(rn)));
    if (out.length > 40) break;
  }
  return out;
}

async function main(): Promise<void> {
  const data = stockDungeon();

  const graphics = stockGraphics();
  const objectTables = graphicsTablesOf(graphics).objects;

  const dungeon = new DungeonState(data);
  const level = Number(process.argv[2] ?? 3);
  const party = standInOf<PartyState>({ position: new Position(0, 0, level), champions: [], brightness: 0 });
  const timers = new TimerQueue();
  const random = new CsbRandom(0xc0ffee);
  const time = 100;
  const ctx = newContext(data, graphics, { dungeon, timers, random });
  ctx.party.state = party;
  ctx.state.tickCount = time;

  const monsters = new MonsterSystem(ctx);
  monsters.loadPartyLevel(level);

  let clouds = 0;
  const damage = new MonsterDamage(ctx);
  // The two systems under test, and stand-ins for the rest: the death cloud is only
  // counted, no missile waits in the cell a dead group is lifted from, no pad is there,
  // and no delete monster filter runs. What a dead monster leaves goes down through the
  // real `MoveObject`.
  ctx.systems.monsters = monsters;
  ctx.systems.monsterDamage = damage;
  ctx.systems.worldMove = new WorldMove(ctx);
  ctx.systems.missileEncounter = standInOf<MissileEncounter>({
    createDeathCloud: () => { clouds++; },
    checkMonsterMoveFromMissile: () => false,
  });
  ctx.systems.actuators = standInOf<ActuatorSystem>({ triggerObjectMove: () => false });
  ctx.systems.dsa = standInOf<DsaSystem>({ deleteMonsterFilter: () => {} });

  const pool = dungeon.getItem16Pool();
  const active = pool.map((slot, i) => ({ slot, i })).filter((e) => e.slot.word0 >= 0);
  console.log(`level ${level}: ${active.length} group(s)\n`);

  // ---- Case 1: kill one member of a multi-monster group -------------------
  const multi = active.find(({ slot }) => {
    const r = dungeon.getCreatureRecordByIndex(slot.word0);
    return r ? (r.numMonM1 & 3) >= 2 : false;
  });
  if (multi) {
    const rec = dungeon.getCreatureRecordByIndex(multi.slot.word0)!;
    const mx = multi.slot.uByte10, my = multi.slot.uByte11;
    const before = { n: rec.numMonM1, hp: [...rec.hp], pos: multi.slot.positions, fac: multi.slot.facings };
    // Give each member a distinct HP so the compaction is observable.
    for (let i = 0; i <= (rec.numMonM1 & 3); i++) rec.hp[i] = 100 + i * 10;
    // Distinct status bytes too.
    for (let i = 0; i < 4; i++) multi.slot.singleMonsterStatus[i] = 0xa0 + i;
    // Queue a per-member B timer for each, so renumbering is observable.
    for (let i = 0; i <= (rec.numMonM1 & 3); i++) {
      timers.createTimer(TimerFunction.TT_MONSTER_B0 + i, mx, my, 0, 0, time + 10 + i, level);
    }
    // Per-member timers only exist while the group is in fear state 6 — that is the
    // state `MaybeDelTimers_Fear6_TurnIndividuals` creates them in — and CSBWin gates
    // the whole renumbering block on it (doc/CSBwin-src/Code11f52.cpp:1182).
    rec.fear = StateOfFear.StateOfFear6;
    const timersQueued = timers.getTimers().filter(t => t.uByte6 === mx && t.uByte7 === my
      && t.function >= TimerFunction.TT_MONSTER_A0 && t.function <= TimerFunction.TT_MONSTER_B3).length;

    console.log(`Case 1 — kill member 1 of a ${(before.n & 3) + 1}-strong ${MonsterType[rec.creatureType]} at (${mx},${my})`);
    console.log(`  before: numMonM1=${rec.numMonM1} hp=[${rec.hp.slice(0, 4)}] sms=[${multi.slot.singleMonsterStatus.map(v=>v.toString(16))}]`);
    const hpOfMember2 = rec.hp[2];
    const smsOfMember2 = multi.slot.singleMonsterStatus[2];

    const result = damage.damageMonster(rec, 1, level, mx, my, 9999, true, false);
    console.log(`  after:  numMonM1=${rec.numMonM1} hp=[${rec.hp.slice(0, 4)}] sms=[${multi.slot.singleMonsterStatus.map(v=>v.toString(16))}] -> ${MonsterDamageResult[result]}`);

    check(result === MonsterDamageResult.SOME_NOT_ALL_MONSTERS_DIED, 'expected SOME_NOT_ALL_MONSTERS_DIED');
    check(rec.numMonM1 === ((before.n & 3) - 1), 'numMonM1 should drop by one');
    check(rec.hp[1] === hpOfMember2, 'member 2 HP should have compacted down into slot 1');
    check(multi.slot.singleMonsterStatus[1] === smsOfMember2, 'member 2 status should have compacted down into slot 1');

    // Note the `-1` entry in this listing: it is the group timer, TT_MONSTER_BGROUP
    // (37), which falls inside CSBWin's own A0..B3 scan range but yields a member
    // index of -1, so it matches neither `== indexInGroup` nor `> indexInGroup` and
    // is correctly left alone (doc/CSBwin-src/Code11f52.cpp:1190-1198).
    const memberTimers = timers.getTimers()
      .filter(t => t.uByte6 === mx && t.uByte7 === my
        && t.function >= TimerFunction.TT_MONSTER_A0 && t.function <= TimerFunction.TT_MONSTER_B3)
      .map(t => t.function - TimerFunction.TT_MONSTER_B0)
      .sort((a, b) => a - b);
    console.log(`  member timers now: [${memberTimers}] (-1 is the group timer)`);
    check(!memberTimers.includes((before.n & 3)), 'the top member index should no longer have a timer');
    check(memberTimers.length === timersQueued - 1, 'exactly one timer should have been removed');
    check(memberTimers.includes(-1), 'the group timer must survive untouched');
    console.log('');

    // ---- Case 1b: outside fear state 6, timers are left alone ------------
    // Worth pinning explicitly, because it looks like an omission until you find the
    // gate: a group not in state 6 has only a group timer, so there is nothing
    // per-member to renumber.
    const mx2 = multi.slot.uByte10, my2 = multi.slot.uByte11;
    for (const t of [...timers.getTimers()]) {
      if (t.uByte6 === mx2 && t.uByte7 === my2) timers.deleteTimer(t.index);
    }
    for (let i = 0; i <= (rec.numMonM1 & 3); i++) {
      timers.createTimer(TimerFunction.TT_MONSTER_B0 + i, mx2, my2, 0, 0, time + 10 + i, level);
    }
    rec.fear = StateOfFear.StateOfFear0;
    for (let i = 0; i <= (rec.numMonM1 & 3); i++) rec.hp[i] = 100 + i * 10;
    const fnsBefore = timers.getTimers().filter(t => t.uByte6 === mx2 && t.uByte7 === my2)
      .map(t => t.function).sort((a, b) => a - b);
    damage.damageMonster(rec, 0, level, mx2, my2, 9999, true, false);
    const fnsAfter = timers.getTimers().filter(t => t.uByte6 === mx2 && t.uByte7 === my2)
      .map(t => t.function).sort((a, b) => a - b);
    console.log(`Case 1b — same group, fear state 0: timers ${fnsBefore} -> ${fnsAfter}`);
    check(JSON.stringify(fnsBefore) === JSON.stringify(fnsAfter),
      'outside fear state 6 the per-member timers must be untouched');
    console.log('');
  } else {
    console.log('Case 1 skipped: no group of 3+ on this level\n');
  }

  // ---- Case 2: kill a whole group ----------------------------------------
  const solo = active.find(({ slot }) => {
    const r = dungeon.getCreatureRecordByIndex(slot.word0);
    return r ? (r.numMonM1 & 3) === 0 : false;
  });
  if (solo) {
    const rec = dungeon.getCreatureRecordByIndex(solo.slot.word0)!;
    const mx = solo.slot.uByte10, my = solo.slot.uByte11;
    const pos = new Position(mx, my, level);
    const typeName = MonsterType[rec.creatureType];
    const cellBefore = objectsInCell(dungeon, pos);
    const timersBefore = timers.getTimers().filter(t => t.uByte6 === mx && t.uByte7 === my
      && t.function >= TimerFunction.TT_FIRST_MONSTER_AI && t.function <= TimerFunction.TT_LAST_MONSTER_AI).length;
    clouds = 0;

    console.log(`Case 2 — kill a lone ${typeName} at (${mx},${my})`);
    console.log(`  cell before: [${cellBefore}], AI timers: ${timersBefore}`);
    const result = damage.damageMonster(rec, 0, level, mx, my, 9999, true, false);
    const cellAfter = objectsInCell(dungeon, pos);
    const timersAfter = timers.getTimers().filter(t => t.uByte6 === mx && t.uByte7 === my
      && t.function >= TimerFunction.TT_FIRST_MONSTER_AI && t.function <= TimerFunction.TT_LAST_MONSTER_AI).length;
    console.log(`  cell after:  [${cellAfter}], AI timers: ${timersAfter}, death clouds: ${clouds} -> ${MonsterDamageResult[result]}`);

    check(result === MonsterDamageResult.ALL_MONSTERS_DIED, 'expected ALL_MONSTERS_DIED');
    check(!cellAfter.includes('CREATURE'), 'the creature should be gone from the cell');
    check(timersAfter === 0, 'the AI timers should be gone');
    check(clouds === 1, 'exactly one death cloud');
    check(solo.slot.word0 < 0, 'the ITEM16 slot should be free again');
    console.log('');
  }

  // ---- Case 3: invincible monsters take no damage -------------------------
  const invincible = active.find(({ slot }) => {
    const r = dungeon.getCreatureRecordByIndex(slot.word0);
    return r ? [23, 25, 26].includes(r.creatureType) : false;
  });
  if (invincible) {
    const rec = dungeon.getCreatureRecordByIndex(invincible.slot.word0)!;
    const hpBefore = rec.hp[0];
    const result = damage.damageMonster(rec, 0, level, invincible.slot.uByte10, invincible.slot.uByte11, 9999, true, false);
    console.log(`Case 3 — ${MonsterType[rec.creatureType]} is invincible: hp ${hpBefore} -> ${rec.hp[0]}, ${MonsterDamageResult[result]}`);
    check(result === MonsterDamageResult.NO_MONSTER_DIED && rec.hp[0] === hpBefore, 'invincible monster must be unharmed');
    console.log('');
  }

  // ---- Case 4: a monster that leaves droppings ---------------------------
  // The most table-driven path: MonsterDroppings walked to its zero terminator, each
  // word split by range into weapon / clothing / misc.
  const dropper = active.find(({ slot }) => {
    const r = dungeon.getCreatureRecordByIndex(slot.word0);
    if (!r || slot.word0 < 0) return false;
    const d = objectTables.monsterDesc[r.creatureType];
    return d ? (d.word2 & 0x200) !== 0 : false; // leavesDroppings
  });
  if (dropper) {
    const rec = dungeon.getCreatureRecordByIndex(dropper.slot.word0)!;
    const mx = dropper.slot.uByte10, my = dropper.slot.uByte11;
    const pos = new Position(mx, my, level);
    const typeName = MonsterType[rec.creatureType];
    const before = objectsInCell(dungeon, pos);
    // Kill the group outright so DropMonsterRemains runs for every member.
    for (let i = 0; i <= (rec.numMonM1 & 3); i++) rec.hp[i] = 1;
    while ((rec.numMonM1 & 3) > 0) {
      damage.damageMonster(rec, 0, level, mx, my, 9999, true, false);
    }
    damage.damageMonster(rec, 0, level, mx, my, 9999, true, false);
    const after = objectsInCell(dungeon, pos);
    console.log(`Case 4 — ${typeName} leaves droppings at (${mx},${my})`);
    console.log(`  cell before: [${before}]`);
    console.log(`  cell after:  [${after}]`);
    const dropped: string[] = [];
    for (let rn = dungeon.findFirstObject(pos); rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) {
      const { category, index } = ctx.dungeon.rnMaps.decode(rn);
      if (category === DBType.MISC) dropped.push(`misc#${data.databases.misc.records[index]?.miscType}`);
      if (category === DBType.WEAPON) dropped.push(`weapon#${data.databases.weapons.records[index]?.weaponType}`);
      if (category === DBType.CLOTHING) dropped.push(`cloth#${data.databases.clothing.records[index]?.clothingType}`);
      if (dropped.length > 20) break;
    }
    console.log(`  dropped: [${dropped}]`);
    check(after.length > before.length - 1, `${typeName} should have left something behind`);
    check(!after.includes('CREATURE'), 'the creature should be gone');
    console.log('');
  }

  finish();
}

main();
