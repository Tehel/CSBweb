/**
 * The DSA operations on missiles, spells and clouds (the objects family),
 * each run through `DsaSystem.execute` as a program of a test DSA on a genuine save
 * (`csbgame7.dat`).
 *
 * 1. **`&THROW`** is `ThrowMissile` (`doc/CSBwin-src/DSA.cpp:4559-4583`,
 *    `Timer.cpp:2016-2078`): one of the eight spells flies as itself, from the launch
 *    corner, with its range, damage, direction and decay in the missile and its timer; a
 *    type of 0 takes the first object of the object location's corner out of its square
 *    and throws it; any other type throws nothing.
 * 2. **`&MISSILEINFO@` and `&MISSILEINFO!`** (`DSA.cpp:2796-2852`) read and write a
 *    missile's contents, range, damage and its timer's direction; a slot that is no
 *    missile reads -1 four times, and `&MISSILEINFO!` on an invalid slot pops only it.
 * 3. **`&CREATECLOUD`** (`DSA.cpp:2741-2788`): types 0, 3, 4, 7 and 40 make a spell's
 *    cloud, with its `TT_25`; 50 a Fluxcage, with its `TT_24`; any other nothing.
 * 4. **`&CAST` and `&FILTEREDCAST`** are `DSACastSpell` (`Magic.cpp:1408-1418`): the
 *    fourteen DSA parameters are the spell's, and the second runs them through the spell
 *    filter first, on a parameter array of its own, so the program's are as it left them.
 *
 * Run: `npm test -- --only=dump-dsa-missiles.ts`
 */
import { DBType, OBJECT_ID_EOF, Position, locationRelToInteger, type ObjectID } from '../src/core/types';
import { RN_FIREBALL, RN_LIGHTNING } from '../src/core/spellRn';
import type { DungeonData } from '../src/data/dungeonTypes';
import { StkOp } from '../src/engine/DsaSystem';
import type { Game } from '../src/engine/Game';
import { TimerFunction } from '../src/engine/TimerQueue';
import { decodeMissileTimerWord8 } from '../src/engine/missileHelpers';
import { globalStore, int, op, run, varStore } from './lib/dsa';
import { check, finish } from './lib/check';

const locr = (at: Position, p: number): number => locationRelToInteger({ l: at.z, x: at.x, y: at.y, p });

function objectsAt(game: Game, at: Position): ObjectID[] {
  const out: ObjectID[] = [];
  const dungeon = game.ctx.dungeon;
  for (let rn = dungeon.findFirstObject(at); rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) out.push(rn);
  return out;
}

function missilesAt(game: Game, at: Position): ObjectID[] {
  return objectsAt(game, at).filter((rn) => game.ctx.dungeon.rnMaps.dbType(rn) === DBType.MISSILE);
}

function describeMissile(game: Game, rn: ObjectID): string {
  const m = game.ctx.dungeon.getMissileRecord(rn)!;
  const timer = game.ctx.timers.getTimer(m.timerIndex)!;
  const w8 = decodeMissileTimerWord8(timer.timerWord8);
  return `${m.projectileObject.toString(16)} at corner ${game.ctx.dungeon.rnMaps.pos(rn)}, range ${m.rangeRemaining}, `
    + `damage ${m.damageRemaining}, timer ${timer.function} at ${timer.time}, direction ${w8.dir}, `
    + `decay ${w8.deltaEnergy}`;
}

/* ---------------------------------------------- 1. &THROW ---------------------- */
{
  const throwOp = (type: number, objectLocation: number, launch: number, direction: number, range: number,
    damage: number, delta: number): number[] => [
    ...int(type), ...int(objectLocation), ...int(launch), ...int(direction), ...int(range), ...int(damage),
    ...int(delta), op(StkOp.THROW),
  ];
  const spell = run((_, at) => throwOp(RN_FIREBALL, 0, locr(at, 2), 1, 300, 30, 2));
  const thrown = missilesAt(spell.game, spell.at);
  console.log(`1a. &THROW of a fireball: ${thrown.map((rn) => describeMissile(spell.game, rn)).join('; ')}`);
  const m = thrown.length === 1 ? spell.game.ctx.dungeon.getMissileRecord(thrown[0]!) : null;
  const timer = m ? spell.game.ctx.timers.getTimer(m.timerIndex) : null;
  check(m?.projectileObject === RN_FIREBALL && spell.game.ctx.dungeon.rnMaps.pos(thrown[0]!) === 2,
    'a fireball flies from the launch corner');
  check(m?.rangeRemaining === 44 && m.damageRemaining === 30, 'its range and damage are cut to their bytes');
  check(timer?.function === TimerFunction.TT_MISSILE0 && timer.time === spell.game.ctx.state.tickCount + 1
    && decodeMissileTimerWord8(timer.timerWord8).dir === 1 && decodeMissileTimerWord8(timer.timerWord8).deltaEnergy === 2,
    'its TT_Missile0 is next tick\'s, with the direction and the decay');

  const others = [1, 0xff85, 0xff90].map((type) => {
    const r = run((_, at) => throwOp(type, 0, locr(at, 0), 0, 10, 10, 0));
    return missilesAt(r.game, r.at).length;
  });
  console.log(`1b. &THROW of 1, 0xff85, 0xff90: ${others.join(', ')} missiles`);
  check(others.every((n) => n === 0), 'a type that is neither 0 nor one of the eight spells throws nothing');

  // An object of the party's level, its square and its corner.
  let source: { at: Position; rn: ObjectID } | null = null;
  const probe = run([]);
  const map = probe.game.ctx.dungeon.getMap(probe.at.z)!;
  for (let x = 0; x < map.descriptor.width && !source; x++) {
    for (let y = 0; y < map.descriptor.height && !source; y++) {
      const p = new Position(x, y, probe.at.z);
      const rn = objectsAt(probe.game, p).find((o) => {
        const t = probe.game.ctx.dungeon.rnMaps.dbType(o);
        return t > DBType.CREATURE && t <= DBType.MISC;
      });
      if (rn !== undefined) source = { at: p, rn };
    }
  }
  const src = source!;
  const corner = probe.game.ctx.dungeon.rnMaps.pos(src.rn);
  const object = run((_, at) => throwOp(0, locr(src.at, corner), locr(at, 1), 3, 20, 10, 1));
  const flying = missilesAt(object.game, object.at);
  const left = objectsAt(object.game, src.at).includes(src.rn);
  console.log(`1c. &THROW of ${src.rn} from (${src.at.x},${src.at.y}) corner ${corner}: `
    + `${flying.map((rn) => describeMissile(object.game, rn)).join('; ')}; still in its square: ${left}`);
  check(flying.length === 1 && object.game.ctx.dungeon.getMissileRecord(flying[0]!)!.projectileObject === src.rn && !left,
    'a type of 0 takes the object out of its square and throws it');
  const wrongCorner = run((_, at) => throwOp(0, locr(src.at, (corner + 1) & 3), locr(at, 1), 3, 20, 10, 1));
  console.log(`1d. the same from corner ${(corner + 1) & 3}: ${missilesAt(wrongCorner.game, wrongCorner.at).length} missiles`);
  check(missilesAt(wrongCorner.game, wrongCorner.at).length === 0, 'only an object of the corner named is thrown');
}

/* ---------------------------------- 2. &MISSILEINFO@ and &MISSILEINFO! ---------- */
{
  let missile = OBJECT_ID_EOF as ObjectID;
  let weapon = OBJECT_ID_EOF as ObjectID;
  const { g, game } = run(() => [
    ...int(missile), op(StkOp.MISSILE_INFO_FETCH), globalStore(3), globalStore(2), globalStore(1), globalStore(0),
    ...int(300), ...int(5), ...int(7), ...int(missile), op(StkOp.MISSILE_INFO_STORE),
    ...int(missile), op(StkOp.MISSILE_INFO_FETCH), globalStore(7), globalStore(6), globalStore(5), globalStore(4),
    ...int(9), ...int(0), op(StkOp.MISSILE_INFO_STORE), globalStore(8),
    ...int(4242), ...int(1), ...int(2), ...int(3), ...int(weapon), op(StkOp.MISSILE_INFO_STORE), globalStore(9),
    ...int(weapon), op(StkOp.MISSILE_INFO_FETCH), globalStore(13), globalStore(12), globalStore(11), globalStore(10),
    ...int(0), op(StkOp.MISSILE_INFO_FETCH), globalStore(17), globalStore(16), globalStore(15), globalStore(14),
  ], (game, at) => {
    game.ctx.systems.magic.launchMissile(RN_LIGHTNING, at.x, at.y, at.z, 1, 2, 77, 66, 3, game.ctx.state.tickCount, false);
    missile = missilesAt(game, at)[0]!;
    weapon = game.ctx.party.state.champions[0]!.possessions[1]!;
  });
  console.log(`2. &MISSILEINFO@ of ${missile}: ${g.slice(0, 4).join(' ')}; after &MISSILEINFO! 300 5 7: `
    + `${g.slice(4, 8).join(' ')} (${describeMissile(game, missile)}); &MISSILEINFO! on slot 0 leaves ${g[8]}, on a `
    + `weapon ${g[9]}; &MISSILEINFO@ of a weapon ${g.slice(10, 14).join(' ')}, of slot 0 ${g.slice(14, 18).join(' ')}`);
  check(g.slice(0, 4).join() === `${RN_LIGHTNING},77,66,2`, 'contents, range, damage and direction');
  check(g.slice(4, 8).join() === `${RN_LIGHTNING},44,5,3`, 'range and damage cut to their bytes, the direction to its two bits');
  check(decodeMissileTimerWord8(game.ctx.timers.getTimer(game.ctx.dungeon.getMissileRecord(missile)!.timerIndex)!.timerWord8)
    .deltaEnergy === 3, 'the timer\'s other bits are untouched');
  check(g[8] === 9 && g[9] === 4242, 'an invalid slot pops only itself, a valid one that is no missile all four');
  check(g.slice(10, 18).every((v) => v === -1), 'a slot that is no missile reads -1 four times');
}

/* ---------------------------------------------- 3. &CREATECLOUD ----------------- */
{
  const cloud = (type: number, size: number, p: number) => (_: Game, at: Position): number[] =>
    [...int(locr(at, p)), ...int(type), ...int(size), op(StkOp.CREATE_CLOUD)];
  const describe = (game: Game, at: Position): string[] => objectsAt(game, at)
    .filter((rn) => game.ctx.dungeon.rnMaps.dbType(rn) === DBType.CLOUD)
    .map((rn) => {
      const c = game.ctx.dungeon.getCloudRecord(rn)!;
      const timers = game.ctx.timers.getTimers().filter((t) => t.uByte6 === at.x && t.uByte7 === at.y && t.level === at.z)
        .map((t) => t.function);
      return `type ${c.cloudType} size ${c.value} corner ${c.bit7 ? 'centre' : game.ctx.dungeon.rnMaps.pos(rn)} `
        + `timers ${timers.join(',')}`;
    });
  const poison = run(cloud(7, 100, 3));
  const cage = run(cloud(50, 0, 1));
  const illegal = run(cloud(1, 100, 0));
  console.log(`3. &CREATECLOUD 7: ${describe(poison.game, poison.at).join('; ')}; 50: `
    + `${describe(cage.game, cage.at).join('; ')}; 1: ${describe(illegal.game, illegal.at).length} clouds`);
  check(describe(poison.game, poison.at).join() === `type 7 size 100 corner 3 timers ${TimerFunction.TT_25}`,
    'a poison cloud in its corner, with its TT_25');
  check(describe(cage.game, cage.at).join() === `type 50 size 0 corner centre timers ${TimerFunction.TT_24}`,
    'a Fluxcage in the centre, with its TT_24');
  check(describe(illegal.game, illegal.at).length === 0, 'a type with no spell makes nothing');
}

/* ---------------------------------- 4. &CAST and &FILTEREDCAST ------------------ */
{
  // LO FUL IR, a fireball, by champion `ch`, every other parameter -1.
  const params = (ch: number): number[] => {
    const words = [0, 1440, ch, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1];
    return [...words.flatMap((w, i) => [...int(w), varStore(i)]), ...int(14), ...int(0), op(StkOp.PARAM_STORE)];
  };
  const fireballs = (game: Game): number => {
    const p = game.ctx.party.state.position;
    return missilesAt(game, new Position(p.x, p.y, p.z))
      .filter((rn) => game.ctx.dungeon.getMissileRecord(rn)!.projectileObject === RN_FIREBALL).length;
  };
  const casts = [0, 1, 2, 3].map((ch) => fireballs(run([...params(ch), op(StkOp.CAST)]).game));
  console.log(`4a. &CAST of LO FUL IR by each champion: ${casts.join(' ')} fireballs`);
  const caster = casts.findIndex((n) => n === 1);
  check(caster >= 0, 'a champion casts the fireball the parameters name');

  const filter = {
    // The spell filter's column 0: its count, and the action made 1, "abort, no message".
    program: [op(StkOp.NUM_PARAM), globalStore(0), ...int(1), varStore(0), ...int(1), ...int(0), op(StkOp.PARAM_STORE)],
    place: (game: Game, location: number) => {
      const data: DungeonData = game.ctx.dungeon.getData();
      data.spellFilterLocation = (0x80000000 | location) >>> 0;
    },
  };
  const filtered = run([...params(caster), op(StkOp.FILTERED_CAST)], undefined, undefined, filter);
  const unfiltered = run([...params(caster), op(StkOp.CAST)], undefined, undefined, filter);
  const dsa = filtered.game.systems.dsa;
  console.log(`4b. with a spell filter that aborts: &FILTEREDCAST ${fireballs(filtered.game)} fireballs, the filter's `
    + `count ${filtered.g[0]}, the program's action and caster after it ${dsa.getParameter(0)} ${dsa.getParameter(2)}; `
    + `&CAST ${fireballs(unfiltered.game)} fireballs, the filter's count ${unfiltered.g[0].toString(16)}`);
  check(fireballs(filtered.game) === 0 && filtered.g[0] === 14, '&FILTEREDCAST runs the spell filter, on fourteen parameters');
  check(dsa.getParameter(0) === 0 && dsa.getParameter(2) === caster, 'and the program has its own parameters back');
  check(fireballs(unfiltered.game) === 1 && unfiltered.g[0] === 0x5a5a, '&CAST does not run it');
}

finish();
