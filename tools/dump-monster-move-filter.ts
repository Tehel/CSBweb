/**
 * The monster move filter before a group's turn (`doc/CSBwin-src/Monster.cpp:3319-3365`),
 * which `ProcessTimers29to41` runs once it has cleared `monsterMoveInhibit`, with a DSA at
 * its location, against a genuine save (`csbgame7.dat`): a group on the party's level takes
 * its turn as a `TT_MONSTER_Bgroup` timer.
 *
 * 0. **Conflux's level keys are read**: its `EXPOOL` names a location for level 29's own
 *    filter, keyed with `(level + 1) << 8` (`MONSTERMOVEFILTERCACHE::GetLocation`,
 *    `:3092-3093`), beside the dungeon's.
 * 1. **The DSA runs before the turn**, on parameters of its own, a count of 7: the level,
 *    the group's square, the group, and the party's level and square (`:3348-3355`), with
 *    `monsterMoveFilterActive` set, so `&MONL&D` reads them (`DSA.cpp:4769-4791`), and
 *    cleared after. The caller's parameters are as they were.
 * 2. **Only the first type-47 actuator at the location runs** (`Monster.cpp:3120`).
 * 3. **`&MONBLK` survives into the turn**: the turn cleared `monsterMoveInhibit` before
 *    the filter, not after (`:3314-3317`).
 * 4. **When it runs** (`:3320-3327`): never for a reaction (`TT_M1`), only within
 *    `maxDistance` of the party, squared distances compared, and with `partyLevelOnly`
 *    set only on the party's level.
 * 5. **A level's own record comes first**, the dungeon's is the fallback, and a level
 *    whose record names a square without a DSA has no filter (`:3083-3166`).
 * 6. **The location is looked up once per level** (`:3083`), and kept.
 * 7. **The post-move filter** (`ProcessPostMonsterMoveFilter`, `:3173-3237`), which every
 *    `return` of the turn runs: the same DSA's column 1, its timer function 1, on the
 *    variables the pre-move filter left, with a count of 9: where the group ended, the
 *    group, the party's level and square, and the turn's two words of flags. Only after
 *    a pre-move filter that ran.
 * 8. **`finalLocr` follows the group** through the turn's `MMRECORD`: a step puts it on
 *    the new square and sets `MonMove_differentCell` (`:3181-3187`); a group the turn's
 *    `InitialChecks` kills (`Monster.cpp:2799-2839`) is nowhere, level -1
 *    (`RemoveObjectFromRoom`, `CSBCode.cpp:5250-5253`); a step onto a level that refuses
 *    the group also sets `MoveObject_NotAllowedOnLevel` (`Code11f52.cpp:3187-3191`).
 * 9. **The turn's flags**, the 53 `Setflg`s of `ProcessTimers29to41` and its helpers
 *    (`MONSTEREVENTS`, `CSB.h:2874-2927`), as the post-move filter sees them: the exact
 *    set of a turn whose path is staged, and what any of the group's ordinary turns
 *    implies of its flags. `IC29to41_damageMonsterFailed` is never set: CSBWin tests a
 *    flag nothing sets (`Monster.cpp:2839-2840`).
 *
 * Run: `npx tsx tools/dump-monster-move-filter.ts`
 */
import { readFileSync } from 'node:fs';

import { DBType, Position, locationRelFromInteger, locationRelToInteger, type ObjectID } from '../src/core/types';
import type { DungeonData } from '../src/data/dungeonTypes';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { StkOp } from '../src/engine/DsaSystem';
import type { Game } from '../src/engine/Game';
import { MonsterEvents } from '../src/engine/MmRecord';
import { TimerFunction } from '../src/engine/TimerQueue';
import { StateOfFear } from '../src/engine/monsterTypes';
import { SMS_ATTACKING } from '../src/data/dungeonTypes';
import { UNSET, globalStore, int, op, varFetch, varStore, withFilterDsas, type FilterDsa } from './lib/dsa';
import { check, finish } from './lib/check';

/** `ESL_MONSTERMOVEFILTER` (`doc/CSBwin-src/CSB.h:1540`), and its keys. */
const ESL_MONSTERMOVEFILTER = 2;
const DUNGEON_KEY = (3 << 24) | ESL_MONSTERMOVEFILTER;
const levelKey = (level: number): number => (DUNGEON_KEY | ((level + 1) << 8)) >>> 0;
/** A record: the location, `partyLevelOnly` in bit 18 and `maxDistance` in bits 19-23. */
const record = (locr: number, maxDistance: number, partyLevelOnly = 0): number =>
  (locr & 0x3ffff) | (partyLevelOnly << 18) | (maxDistance << 19);

/** The parameter count, the seven parameters, and `&MONL&D`'s two variables, into globals 0-9. */
const REPORT = [
  op(StkOp.NUM_PARAM), globalStore(0),
  ...int(7), ...int(20), op(StkOp.PARAM_FETCH),
  ...Array.from({ length: 7 }, (_, i) => [varFetch(20 + i), globalStore(1 + i)]).flat(),
  ...int(10), op(StkOp.MON_LAND_D), varFetch(10), globalStore(8), varFetch(11), globalStore(9),
];

/** The first group on the party's level: its RN and square. */
function group(game: Game): { rn: ObjectID; at: Position } {
  const dungeon = game.ctx.dungeon;
  const z = game.ctx.party.state.position.z;
  for (const slot of dungeon.getItem16Pool()) {
    if (slot.word0 < 0) continue;
    return { rn: dungeon.rnMaps.rn(DBType.CREATURE, slot.word0), at: new Position(slot.uByte10, slot.uByte11, z) };
  }
  throw new Error('no group on the party\'s level');
}

/** A game whose filter square holds `programs`, its location given by `records(locr)`. */
function filterGame(programs: FilterDsa[], records: (locr: number) => Record<number, number>): { game: Game; locr: number } {
  const game = withFilterDsas(ESL_MONSTERMOVEFILTER, programs);
  const data: DungeonData = game.ctx.dungeon.getData();
  const locr = data.specialLocations![(3 << 24) | ESL_MONSTERMOVEFILTER]!;
  data.specialLocations = records(locr);
  return { game, locr };
}

/** The group at `at`'s turn, as `timerFunction`; the globals after it. */
function turn(game: Game, timerFunction: number = TimerFunction.TT_MONSTER_BGROUP, at = group(game).at): number[] {
  game.ctx.systems.monsterAI.processTimers29to41({
    mapX: at.x, mapY: at.y, level: at.z, timerFunction, timeUntilAlternateUpdate: 0,
  });
  return game.systems.dsa.getGlobalVariables();
}

/** Whether a turn ran the DSA: it stores 1 into global 0. */
const MARK = [...int(1), globalStore(0)];
const ran = (g: number[]): boolean => g[0] === 1;

/* ------------------------------- 0. Conflux ------------------------------------ */
{
  const conflux = new DungeonLoader().loadDungeonDat(new Uint8Array(readFileSync('static/gamefiles/conflux-3.5-b8/dungeon.dat')));
  const locations = conflux.specialLocations ?? {};
  const describe = (value: number | undefined): string => {
    if (value === undefined) return 'none';
    const l = locationRelFromInteger(value & 0x3ffff);
    return `${l.l}(${l.x},${l.y}) partyLevelOnly ${(value >>> 18) & 1} maxDistance ${(value >>> 19) & 0x1f}`;
  };
  const levels = Object.keys(locations).map(Number).filter((k) => (k & 0xff0000ff) === DUNGEON_KEY && k !== DUNGEON_KEY)
    .map((k) => ((k >>> 8) & 0xff) - 1);
  console.log(`0. Conflux: the dungeon's filter ${describe(locations[DUNGEON_KEY])}; levels with their own: ${levels.join(', ')}, `
    + `level 29's ${describe(locations[levelKey(29)])}`);
  check(locations[DUNGEON_KEY] !== undefined && levels.join() === '29', 'Conflux has the dungeon\'s record, and level 29\'s own');
}

/* ------------------------------- 1. the parameters ----------------------------- */
{
  const { game } = filterGame([REPORT], (locr) => ({ [DUNGEON_KEY]: record(locr, 31) }));
  const dsa = game.systems.dsa;
  dsa.setParameters(3, [7, 8, 9]);
  const { rn, at } = group(game);
  const party = game.ctx.party.state.position;
  const g = turn(game);
  console.log(`1. the group ${rn} at ${at.z}(${at.x},${at.y}), the party at ${party.z}(${party.x},${party.y}): `
    + `the DSA saw ${g[0]} parameters [${g.slice(1, 8).join(', ')}], &MONL&D ${g[8]} ${g[9]}`);
  check(g[0] === 7, 'a count of 7');
  check(g.slice(1, 8).join() === [at.z, at.x, at.y, rn, party.z, party.x, party.y].join(),
    'the level, the group\'s square, the group, the party\'s level and square');
  const distance = Math.abs(at.x - party.x) + Math.abs(at.y - party.y);
  check(g[8] === 1024 * at.z + 32 * at.x + at.y && g[9] === distance - 1,
    '&MONL&D works in the filter: the group\'s location, and its distance to the party less one');
  check(!dsa.monsterMoveFilterActive, 'monsterMoveFilterActive is cleared after the filter');
  check([0, 1, 2].map((i) => dsa.getParameter(i)).join() === '7,8,9', 'the caller\'s parameters are as they were');
}

/* ------------------------------- 2. only the first DSA ------------------------- */
{
  const { game } = filterGame([MARK, [...int(2), globalStore(1)]], (locr) => ({ [DUNGEON_KEY]: record(locr, 31) }));
  const g = turn(game);
  console.log(`2. two DSAs at the location: globals 0 and 1 ${g[0]} ${g[1] === UNSET ? 'unset' : g[1]}`);
  check(ran(g) && g[1] === UNSET, 'only the first runs');
}

/* ------------------------------- 3. &MONBLK ------------------------------------ */
{
  const { game } = filterGame([[...int(0b0101), op(StkOp.MON_BLK)]], (locr) => ({ [DUNGEON_KEY]: record(locr, 31) }));
  const ai = game.ctx.systems.monsterAI;
  turn(game);
  const after = Array.from(ai.monsterMoveInhibit).join(' ');
  turn(game, TimerFunction.TT_M1);
  const reaction = Array.from(ai.monsterMoveInhibit).join(' ');
  console.log(`3. &MONBLK 5 in the filter: monsterMoveInhibit after the turn ${after}; after a reaction, which runs no filter, ${reaction}`);
  check(after === '1 0 4 0', 'the turn keeps what the filter blocked, north and south');
  check(reaction === '0 0 0 0', 'the next turn clears it first');
}

/* ------------------------------- 4. when it runs ------------------------------- */
{
  const at = (() => group(withFilterDsas(ESL_MONSTERMOVEFILTER, [MARK])).at)();
  const runs = (maxDistance: number, partyLevelOnly: number, set: (game: Game) => void, timerFunction?: number): boolean => {
    const { game } = filterGame([MARK], (locr) => ({ [DUNGEON_KEY]: record(locr, maxDistance, partyLevelOnly) }));
    const { at: square } = group(game);
    set(game);
    return ran(turn(game, timerFunction, square));
  };
  // The party three squares east and four south of the group: 25 squared.
  const away = (game: Game): void => {
    const p = game.ctx.party.state.position;
    p.x = at.x + 3;
    p.y = at.y + 4;
  };
  const elsewhere = (game: Game): void => {
    away(game);
    game.ctx.party.state.position.z = at.z + 1;
  };
  const cases: Array<[string, boolean, boolean]> = [
    ['a reaction (TT_M1)', runs(31, 0, away, TimerFunction.TT_M1), false],
    ['the party at distance 5, maxDistance 5', runs(5, 0, away), true],
    ['the party at distance 5, maxDistance 4', runs(4, 0, away), false],
    ['the party on another level, partyLevelOnly 0', runs(5, 0, elsewhere), true],
    ['the party on another level, partyLevelOnly 1', runs(5, 1, elsewhere), false],
    ['the party on the level, partyLevelOnly 1', runs(5, 1, away), true],
  ];
  for (const [what, got, want] of cases) {
    console.log(`4. ${what}: ${got ? 'runs' : 'does not run'}`);
    check(got === want, `${what}: the filter ${want ? 'runs' : 'does not run'}`);
  }
}

/* ------------------------------- 5. a level's own record ----------------------- */
{
  const z = (() => group(withFilterDsas(ESL_MONSTERMOVEFILTER, [MARK])).at.z)();
  // The party's square, on which no type-47 actuator stands: DM has none.
  const bare = (game: Game): number => {
    const p = game.ctx.party.state.position;
    return locationRelToInteger({ l: p.z, x: p.x, y: p.y, p: 0 });
  };
  const cases: Array<[string, (game: Game, locr: number) => Record<number, number>, boolean]> = [
    ['the level\'s own record alone', (_, locr) => ({ [levelKey(z)]: record(locr, 31) }), true],
    ['another level\'s record alone', (_, locr) => ({ [levelKey(z + 1)]: record(locr, 31) }), false],
    ['the level\'s own naming a bare square, the dungeon\'s the DSA\'s',
      (game, locr) => ({ [levelKey(z)]: record(bare(game), 31), [DUNGEON_KEY]: record(locr, 31) }), false],
    ['the level\'s own with maxDistance 0, the dungeon\'s with 31',
      (_, locr) => ({ [levelKey(z)]: record(locr, 0), [DUNGEON_KEY]: record(locr, 31) }), false],
  ];
  for (const [what, records, want] of cases) {
    const game = withFilterDsas(ESL_MONSTERMOVEFILTER, [MARK]);
    const data: DungeonData = game.ctx.dungeon.getData();
    const locr = data.specialLocations![DUNGEON_KEY]!;
    data.specialLocations = records(game, locr);
    const got = ran(turn(game));
    console.log(`5. ${what}: ${got ? 'runs' : 'does not run'}`);
    check(got === want, `${what}: the filter ${want ? 'runs' : 'does not run'}`);
  }
}

/* ------------------------------- 6. looked up once ----------------------------- */
{
  const { game } = filterGame([MARK], (locr) => ({ [DUNGEON_KEY]: record(locr, 31) }));
  const first = ran(turn(game));
  const data: DungeonData = game.ctx.dungeon.getData();
  data.specialLocations = {};
  game.systems.dsa.setGlobalVariables(new Array<number>(100).fill(UNSET));
  const second = ran(turn(game));
  console.log(`6. a turn, then the record removed, then a turn: ${first ? 'runs' : 'does not run'}, ${second ? 'runs' : 'does not run'}`);
  check(first && second, 'the location the first turn found is the one the level keeps');
}

/* ------------------------------- 7. the post-move filter ---------------------- */
/** The post-move column: its count into global 10, its nine parameters into 11-19, variable 50 into 20. */
const POST = [
  op(StkOp.NUM_PARAM), globalStore(10),
  ...int(9), ...int(20), op(StkOp.PARAM_FETCH),
  ...Array.from({ length: 9 }, (_, i) => [varFetch(20 + i), globalStore(11 + i)]).flat(),
  varFetch(50), globalStore(20),
];
/** The pre-move column: its count into global 0, and 42 into variable 50. */
const PRE = [op(StkOp.NUM_PARAM), globalStore(0), ...int(42), varStore(50)];
/** What the post-move filter saw, from the globals. */
interface Post { count: number; final: number[]; group: number; party: number[]; flgs: number[]; variable: number }
const post = (g: number[]): Post => ({
  count: g[10]!, final: g.slice(11, 14), group: g[14]!, party: g.slice(15, 18), flgs: [g[18]! >>> 0, g[19]! >>> 0], variable: g[20]!,
});
const bit = (f: MonsterEvents): [number, number] => [f >>> 5, 1 << (f & 31)];
const flagged = (p: Post, f: MonsterEvents): boolean => (p.flgs[bit(f)[0]]! & bit(f)[1]) !== 0;

/** A game with both columns at a location reaching the whole level. */
function postGame(maxDistance = 31): Game {
  return filterGame([{ columns: [PRE, POST] }], (locr) => ({ [DUNGEON_KEY]: record(locr, maxDistance) })).game;
}
/** Where `rn` is on the party's level now, or null. */
function where(game: Game, rn: ObjectID): Position | null {
  const z = game.ctx.party.state.position.z;
  const map = game.ctx.dungeon.getMap(z)!;
  for (let x = 0; x < map.descriptor.width; x++) {
    for (let y = 0; y < map.descriptor.height; y++) {
      if (game.ctx.dungeon.findFirstMonster(new Position(x, y, z)) === rn) return new Position(x, y, z);
    }
  }
  return null;
}
/** Turns of the group `rn`, ten ticks apart, until `stop` holds of what the post-move filter saw. */
function turnsUntil(game: Game, rn: ObjectID, stop: (p: Post, from: Position) => boolean): { p: Post; from: Position } | null {
  for (let i = 0; i < 40; i++) {
    const from = where(game, rn);
    if (!from) return null;
    game.ctx.state.tickCount += 10;
    game.systems.dsa.setGlobalVariables(new Array<number>(100).fill(UNSET));
    const p = post(turn(game, TimerFunction.TT_MONSTER_BGROUP, from));
    if (stop(p, from)) return { p, from };
  }
  return null;
}

{
  const game = postGame();
  const dsa = game.systems.dsa;
  dsa.setParameters(3, [7, 8, 9]);
  const { rn, at } = group(game);
  const party = game.ctx.party.state.position;
  const g = turn(game);
  const p = post(g);
  console.log(`7. a turn of the group ${rn} at ${at.z}(${at.x},${at.y}): the pre-move column saw ${g[0]} parameters; `
    + `the post-move filter saw ${p.count} parameters, final [${p.final.join(', ')}], group ${p.group}, `
    + `party [${p.party.join(', ')}], flags ${p.flgs.join(' ')}, variable 50 ${p.variable}`);
  check(g[0] === 7, 'the pre-move filter runs column 0, and the post-move filter does not');
  check(p.count === 9, 'the post-move filter runs column 1, with a count of 9');
  check(p.final.join() === [at.z, at.x, at.y].join() && where(game, rn)?.toString() === at.toString(),
    'the group stayed: finalLocr is its square');
  check(p.group === rn && p.party.join() === [party.z, party.x, party.y].join(), 'the group, the party\'s level and square');
  check(!flagged(p, MonsterEvents.MonMove_differentCell), 'no MonMove_differentCell');
  check(p.variable === 42, 'the post-move filter has the variables the pre-move filter left (one DSAVARS)');
  check(!dsa.monsterMoveFilterActive, 'monsterMoveFilterActive is cleared after it');
  check([0, 1, 2].map((i) => dsa.getParameter(i)).join() === '7,8,9', 'the caller\'s parameters are as they were');

  const reaction = postGame();
  const g1 = turn(reaction, TimerFunction.TT_M1);
  const far = postGame(0);
  const { at: farAt } = group(far);
  far.ctx.party.state.position.x = farAt.x + 1;
  const g2 = turn(far);
  console.log(`7. a reaction: post-move count ${g1[10] === UNSET ? 'unset' : g1[10]}; `
    + `a turn beyond maxDistance: ${g2[10] === UNSET ? 'unset' : g2[10]}`);
  check(g1[10] === UNSET && g2[10] === UNSET, 'no pre-move filter, no post-move filter');
}

/* ------------------------------- 8. finalLocr ---------------------------------- */
{
  const game = postGame();
  const { rn } = group(game);
  const moved = turnsUntil(game, rn, (p, from) => p.final.join() !== [from.z, from.x, from.y].join());
  const now = where(game, rn);
  console.log(`8. the turn that moved the group from ${moved?.from.x},${moved?.from.y}: final [${moved?.p.final.join(', ')}], `
    + `it is at ${now?.x},${now?.y}; flags ${moved?.p.flgs.join(' ')}`);
  check(moved !== null && now !== null && moved.p.final.join() === [now.z, now.x, now.y].join(),
    'a step: finalLocr is the square the group now stands on');
  check(moved !== null && flagged(moved.p, MonsterEvents.MonMove_differentCell)
    && !flagged(moved.p, MonsterEvents.MoveObject_NotAllowedOnLevel), 'MonMove_differentCell, and only it of the two');
}
{
  const game = postGame();
  const { rn } = group(game);
  const monster = game.ctx.dungeon.getCreatureRecord(rn)!;
  monster.hp[0] = 0;
  const p = post(turn(game));
  console.log(`8. a one-member group at 0 HP: final [${p.final.join(', ')}], flags ${p.flgs.join(' ')}, `
    + `the group ${where(game, rn) ? 'still there' : 'gone'}`);
  check((monster.numMonM1 & 3) === 0, 'the group has one member');
  check(p.final.join() === '-1,0,0' && where(game, rn) === null, 'InitialChecks deletes it: finalLocr is nowhere, level -1');
  check(flagged(p, MonsterEvents.MonMove_differentCell), 'MonMove_differentCell');
}
{
  const game = postGame();
  const { rn } = group(game);
  const map = game.ctx.dungeon.getMap(game.ctx.party.state.position.z)!;
  const allowed = map.monsterTypes;
  map.monsterTypes = [];
  const refused = turnsUntil(game, rn, (p) => p.final[0] === -1);
  map.monsterTypes = allowed;
  console.log(`8. the level refusing the group: final [${refused?.p.final.join(', ')}], flags ${refused?.p.flgs.join(' ')}, `
    + `the group ${where(game, rn) ? 'still there' : 'gone'}`);
  check(refused !== null && refused.p.final.join() === '-1,0,0' && where(game, rn) === null,
    'a step the level refuses deletes the group: finalLocr is nowhere');
  check(refused !== null && flagged(refused.p, MonsterEvents.MoveObject_NotAllowedOnLevel)
    && flagged(refused.p, MonsterEvents.MonMove_differentCell), 'MoveObject_NotAllowedOnLevel and MonMove_differentCell');
}

/* ------------------------------- 9. the turn's flags --------------------------- */
/** The names of the flags the post-move filter saw, sorted. */
const flagNames = (p: Post): string[] =>
  Object.values(MonsterEvents).filter((v): v is MonsterEvents => typeof v === 'number' && flagged(p, v))
    .map((v) => MonsterEvents[v]).sort();
const names = (...fs: MonsterEvents[]): string[] => fs.map((f) => MonsterEvents[f]).sort();
const E = MonsterEvents;

/** A turn of the party level's group as `timerFunction`, after `stage`; the flags it set. */
function stagedTurn(timerFunction: number, stage: (game: Game, rn: ObjectID, at: Position) => void): string[] {
  const game = postGame();
  const { rn, at } = group(game);
  stage(game, rn, at);
  const p = post(turn(game, timerFunction, at));
  return p.count === 9 ? flagNames(p) : ['(no post-move filter)'];
}
const record16 = (game: Game, rn: ObjectID) => {
  const monster = game.ctx.dungeon.getCreatureRecord(rn)!;
  return { monster, slot: game.ctx.dungeon.getAttachedItem16(monster)! };
};
/** The party three squares south of the group, every member facing north. */
const southOfFacingNorth = (game: Game, rn: ObjectID, at: Position): void => {
  const p = game.ctx.party.state.position;
  p.x = at.x;
  p.y = at.y + 3;
  record16(game, rn).slot.facings = 0;
};
const withFear = (fear: StateOfFear) => (game: Game, rn: ObjectID): void => {
  record16(game, rn).monster.fear = fear;
};

const exact: Array<[string, string[], string[]]> = [
  ['TT_31, fear 0, member 0 facing away from the party', stagedTurn(TimerFunction.TT_31, southOfFacingNorth),
    names(E.IC29to41_exitFalse, E.TT29to41_TT31, E.TT29to41_fear5or6, E.MDF6TI_turnMonsterTowardParty)],
  ['TT_30, fear 5', stagedTurn(TimerFunction.TT_30, withFear(StateOfFear.StateOfFear5)),
    names(E.IC29to41_exitFalse, E.TT29to41_TT30, E.TT29to41_fear5or6doNothing)],
  ['TT_MONSTER_B0, fear 0, member 0 attacking', stagedTurn(TimerFunction.TT_MONSTER_B0, (game, rn) => {
    record16(game, rn).slot.singleMonsterStatus[0] |= SMS_ATTACKING;
  }), names(E.IC29to41_exitFalse, E.TT29to41_TTnot37, E.TT29to41_attacking)],
  ['TT_MONSTER_B1 of a one-member group, fear 0', stagedTurn(TimerFunction.TT_MONSTER_B1, () => {}),
    names(E.IC29to41_exitFalse, E.TT29to41_TTnot37, E.TT29to41_notAttacking)],
  ['TT_MONSTER_B1 off the party\'s level', stagedTurn(TimerFunction.TT_MONSTER_B1, (game) => {
    game.ctx.party.state.position.z += 1;
  }), names(E.IC29to41_Not32_33_37_38)],
  ['FREEZE LIFE', stagedTurn(TimerFunction.TT_MONSTER_BGROUP, (game) => {
    game.ctx.party.state.freezeLifeTimer = 10;
  }), names(E.IC29to41_doNothing)],
  ['a one-member group at 0 HP', stagedTurn(TimerFunction.TT_MONSTER_BGROUP, (game, rn) => {
    record16(game, rn).monster.hp[0] = 0;
  }), names(E.IC29to41_atLeastOneMemberAlreadyDead, E.IC29to41_damageMonsterSucceeded, E.MonMove_differentCell)],
];
for (const [what, got, want] of exact) {
  console.log(`9. ${what}: ${got.join(' ')}`);
  check(got.join() === want.join(), `${what}: ${want.join(' ')}`);
}

{
  // An A timer, fear 2, the party out of reach: whether the group sees it is the board's.
  const got = stagedTurn(TimerFunction.TT_MONSTER_A0, (game, rn, at) => {
    withFear(StateOfFear.StateOfFear2)(game, rn);
    const p = game.ctx.party.state.position;
    p.x = at.x + 3;
    p.y = at.y + 4;
  });
  const seen = got.includes('TT29to41_blocked');
  const want = names(E.IC29to41_exitFalse, E.TT29to41_TTmonsterA3, E.TT29to41_w30w32GretaterThan3,
    ...(seen ? [E.TT29to41_blocked, E.TT29to41_fearNot5or6] : []));
  console.log(`9. TT_MONSTER_A0, fear 2, the party 3 east and 4 south: ${got.join(' ')}`);
  check(got.join() === want.join(), `an A timer out of reach: ${want.join(' ')}`);
}
{
  // Off the party's level, the leader's turn is a random step, or none. CSBWin's "failed"
  // is `MoveObject` answering 0, the group on its new square; "succeeded" is any other
  // answer, the group gone, teleported or off the level (`Monster.cpp:2912-2933`).
  const got = stagedTurn(TimerFunction.TT_MONSTER_BGROUP, (game) => {
    game.ctx.party.state.position.z += 1;
  });
  const ways = [
    names(E.IC29to41_randomMoveSucceeded),
    names(E.IC29to41_randomMoveSucceeded, E.MonMove_differentCell),
    names(E.IC29to41_randomMoveFailed, E.IC29to41_doNothing, E.MonMove_differentCell),
    names(E.IC29to41_doNothing),
  ].map((w) => w.join());
  console.log(`9. TT_MONSTER_Bgroup off the party's level: ${got.join(' ')}`);
  check(ways.includes(got.join()), 'off the party\'s level: a step MoveObject answers with 1, an ordinary step, or none');
}
{
  // TT_29 tries the four directions, and TT_30's flag for that path is not set.
  const got = stagedTurn(TimerFunction.TT_29, () => {});
  console.log(`9. TT_29: ${got.join(' ')}`);
  check(got.includes('TT29to41_TT29') && got.includes('IC29to41_exitFalse') && !got.includes('TT29to41_TT30TryDirectionsD5toD4')
    && got.some((n) => n.startsWith('T524_')), 'TT_29: Try_Directions_D5_To_D4, without TT_30\'s flag');
}
{
  // The group's ordinary turns: what each flag implies of the others.
  const game = postGame();
  const { rn } = group(game);
  const seen = new Set<string>();
  const broken = new Set<string>();
  const implies = (got: string[], a: MonsterEvents, b: MonsterEvents): void => {
    if (got.includes(MonsterEvents[a]) && !got.includes(MonsterEvents[b])) broken.add(`${MonsterEvents[a]} without ${MonsterEvents[b]}`);
  };
  turnsUntil(game, rn, (p) => {
    const got = flagNames(p);
    got.forEach((n) => seen.add(n));
    if (!got.includes('IC29to41_exitFalse')) broken.add('a turn without IC29to41_exitFalse');
    for (const sf of [E.SF_greaterThanSmellingDistance, E.SF_timeFuncMinusThree, E.SF_TurnMonstersAsGroup]) {
      implies(got, sf, E.PIAF_standardFinish);
    }
    implies(got, E.SF_return, E.SF_greaterThanSmellingDistance);
    implies(got, E.SF_IncrementTime, E.SF_TurnMonstersAsGroup);
    implies(got, E.SF_TurnMonstersAsGroup, E.TMAG_turnMonsterGroup);
    implies(got, E.T524_moveFailed, E.MonMove_differentCell);
    implies(got, E.T524_moveSucceeded, E.T524_possibleMove);
    implies(got, E.T524_moveFailed, E.T524_possibleMove);
    return false;
  });
  console.log(`9. forty turns of the group: flags seen ${[...seen].sort().join(' ')}`);
  check(broken.size === 0, `each turn's flags hold together${broken.size ? `: ${[...broken].join('; ')}` : ''}`);
  check(!seen.has('TMAG_tunrMonsterGroup') && !seen.has('IC29to41_atLeastOneMemberAlreadDead') && !seen.has('IC29to41_damageMonsterFailed'),
    'the three flags nothing sets are never set');
}

finish();
