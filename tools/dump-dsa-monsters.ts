/**
 * The DSA operations on monsters (the monsters family), each run through
 * `DsaSystem.execute` as a program of a test DSA on a genuine save (`csbgame7.dat`), on
 * its groups of levels 5 and 7, off the party's level and, with the party moved there, on
 * it.
 *
 * 1. **`&MONSTER@` and `&MONSTER!`** (`doc/CSBwin-src/DSA.cpp:3993-4127`): the count, type,
 *    hit points, flags and alternate graphics of a group into variables, the flags each
 *    through its gated `DB4` accessor, so all four read 0 on a dungeon without the design
 *    options; and the hit points, flags and graphics written back, as far as `num`
 *    reaches, all four hit points for a `num` of 0 or 1.
 * 2. **`&MONPOSS`** (`DSA.cpp:3359-3389`): a group's possessions by index, -1 past the
 *    last, 0xffff for a slot that is no group.
 * 3. **`&DELMON`** is `DeleteMonsterInGroup` (`Monster.cpp:4613-4752`): a member leaves
 *    the group, its hit points, corners, facings, status and `TT_MONSTER` timers closing
 *    up over it; a group of one, or an index past its last member, is left alone.
 * 4. **`&INSMON`** is `InsertMonsterInGroup` (`Monster.cpp:4755-4833`): a copy of member 0
 *    in the first free corner of the mask, with its hit points and a copy of its
 *    `TT_MONSTER_A0`, and the record's facing written as the whole facing byte; nothing
 *    for a full group, a corner already held, or a group as wide as its square.
 * 5. **`&MONBLK`** (`DSA.cpp:4626-4639`) sets `monsterMoveInhibit`, the four directions
 *    `PossibleMove` refuses.
 * 6. **`&MONL&D`** (`DSA.cpp:4769-4791`) does nothing, not even pop, outside the monster
 *    move filter; in it, the group's location and distance from the filter's parameters.
 *
 * Run: `npm test -- --only=dump-dsa-monsters.ts`
 */
import { DBType, OBJECT_ID_EOF, Position, locationRelToInteger, type ObjectID } from '../src/core/types';
import { StkOp } from '../src/engine/DsaSystem';
import type { Game } from '../src/engine/Game';
import { TimerFunction } from '../src/engine/TimerQueue';
import { globalStore, int, op, report, run, varFetch, varStore } from './lib/dsa';
import { check, finish } from './lib/check';

const locr = (at: Position, p = 0): number => locationRelToInteger({ l: at.z, x: at.x, y: at.y, p });

/** A group of `csbgame7.dat`: level 7's three type-10s, its two type-8s, level 5's four type-12s. */
const THREE = new Position(5, 9, 7);
const TWO = new Position(9, 11, 7);
const FOUR = new Position(27, 13, 5);
/** Level 8's pair of type 4 (horizontal size 1), and level 6's type 9 (size 2), alone. */
const WIDE_PAIR = new Position(25, 2, 8);
const WHOLE_SQUARE = new Position(10, 14, 6);

const groupAt = (game: Game, at: Position): ObjectID => game.ctx.dungeon.findFirstMonster(at);
const record = (game: Game, at: Position) => game.ctx.dungeon.getCreatureRecord(groupAt(game, at))!;

function describe(game: Game, at: Position): string {
  const m = record(game, at);
  const onParty = at.z === game.ctx.party.state.position.z;
  const item16 = onParty ? game.ctx.dungeon.getAttachedItem16(m) : null;
  const n = m.numMonM1 + 1;
  const timers = game.ctx.timers.getTimers()
    .filter((t) => t.level === at.z && t.uByte6 === at.x && t.uByte7 === at.y)
    .map((t) => t.function).sort((a, b) => a - b);
  return `n ${n} hp ${m.hp.slice(0, n).join('/')} positions ${(item16 ? item16.positions : m.groupIndex).toString(2)} `
    + `facings ${item16 ? item16.facings.toString(2) : m.facing} `
    + (item16 ? `status ${item16.singleMonsterStatus.join('/')} ` : '') + `timers ${timers.join(',')}`;
}

/** The party moved onto `level`, which `loadPartyLevel` gives its groups' `ITEM16`s. */
function partyOnto(game: Game, level: number): void {
  const party = game.ctx.party.state;
  party.position = new Position(party.position.x, party.position.y, level);
  game.ctx.systems.monsters.loadPartyLevelIfChanged();
}

function addTimer(game: Game, at: Position, fn: number): void {
  game.ctx.timers.addTimer({
    index: 0, time: game.ctx.state.tickCount + 50, level: at.z, function: fn, uByte5: 0, uByte6: at.x, uByte7: at.y,
    uByte8: 0, uByte9: 0, sequence: 0, timerWord8: 0, timerWord6: 0,
  });
}

/* ------------------------------------------ 1. &MONSTER@ and &MONSTER! ---------- */
{
  const fetch = (id: () => number, num = 8): () => number[] => () => [...int(id()), ...int(0), ...int(num),
    op(StkOp.MONSTER_FETCH), ...report(0, 8)];
  let rn = OBJECT_ID_EOF as ObjectID;
  const four = run(fetch(() => rn), (game) => {
    rn = groupAt(game, FOUR);
    const m = record(game, FOUR);
    m.invisible = m.drawAsSize4 = m.unique = m.poisoned = true;
    m.alternateGraphics = 3;
  });
  console.log(`1a. &MONSTER@ of level 5's four, every flag bit set: ${four.g.slice(0, 8).join(' ')}`);
  check(four.g.slice(0, 8).join() === '4,12,45,45,40,41,0,3',
    'count, type, hit points and alternate graphics; the four flags read 0 without the design options');

  const store = (num: number, values: number[]): () => number[] => () => [
    ...values.flatMap((v, i) => [...int(v), varStore(i)]), ...int(rn), ...int(0), ...int(num), op(StkOp.MONSTER_STORE),
    ...int(rn), ...int(0), ...int(8), op(StkOp.MONSTER_FETCH), ...report(0, 8),
  ];
  const values = [9, 9, 1, 2, 70000, 4, 15, 13];
  const all = run(store(8, values), (game) => { rn = groupAt(game, FOUR); });
  const m = record(all.game, FOUR);
  console.log(`1b. &MONSTER! of 9 9 1 2 70000 4 15 13, num 8: hp ${m.hp.join('/')}, invisible ${m.invisible}, size 4 `
    + `${m.drawAsSize4}, unique ${m.unique}, poisoned ${m.poisoned}, graphics ${m.alternateGraphics}; read back `
    + `${all.g.slice(0, 8).join(' ')}`);
  check(m.hp.join() === '1,2,4464,4' && m.alternateGraphics === 5, 'the hit points cut to a word, the graphics to three bits');
  check(m.invisible && m.drawAsSize4 && m.unique && m.poisoned, 'the four flag bits are written whatever the options');
  check(all.g[0] === 4 && all.g[1] === 12, 'the count and the type are not written');

  const hp = (num: number): string => {
    const r = run(store(num, values), (game) => { rn = groupAt(game, FOUR); });
    return record(r.game, FOUR).hp.join('/');
  };
  const byNum = [0, 1, 2, 3, 5].map((num) => `${num}: ${hp(num)}`);
  console.log(`1c. the hit points &MONSTER! writes by num, ${byNum.join(', ')}`);
  check(byNum.join() === '0: 1/2/4464/4,1: 1/2/4464/4,2: 45/45/40/41,3: 1/45/40/41,5: 1/2/4464/41',
    'num - 2 is unsigned: 0 and 1 write all four, 2 none, then one more a word');

  const weapon = run(fetch(() => rn), (game) => { rn = game.ctx.party.state.champions[0]!.possessions[1]!; });
  const invalid = run(fetch(() => 0xffff));
  const short = run(() => [...[77, 77, 77, 77].flatMap((v, i) => [...int(v), varStore(i)]),
    ...fetch(() => rn, 2)()], (game) => { rn = groupAt(game, FOUR); });
  console.log(`1d. &MONSTER@ of a weapon: ${weapon.g.slice(0, 8).join(' ')}; of slot 0xffff: `
    + `${invalid.g.slice(0, 8).join(' ')}; with num 2 over 77s: ${short.g.slice(0, 4).join(' ')}`);
  check(weapon.g.slice(0, 8).join() === '0,-1,0,0,0,0,0,0' && invalid.g.slice(0, 8).join() === '0,-1,0,0,0,0,0,0',
    'a slot that is no group reads zeros and -1 for the type');
  check(short.g.slice(0, 4).join() === '4,12,77,77', 'num caps the variables written');
}

/* ---------------------------------------------- 2. &MONPOSS --------------------- */
{
  let rn = OBJECT_ID_EOF as ObjectID;
  let carried: ObjectID[] = [];
  const poss = (id: () => number, index: number): number[] => [...int(id()), ...int(index), op(StkOp.MON_POSS)];
  const { g } = run(() => [
    ...poss(() => rn, 0), globalStore(0), ...poss(() => rn, 1), globalStore(1), ...poss(() => rn, 2), globalStore(2),
    ...poss(() => rn, -1), globalStore(3), ...poss(() => carried[0]!, 0), globalStore(4),
    ...poss(() => 0xffff, 0), globalStore(5),
  ], (game) => {
    // Two objects off a square of the party's level, into level 7's three's possessions.
    const dungeon = game.ctx.dungeon;
    const z = game.ctx.party.state.position.z;
    const map = dungeon.getMap(z)!;
    for (let x = 0; x < map.descriptor.width && carried.length < 2; x++) {
      for (let y = 0; y < map.descriptor.height && carried.length < 2; y++) {
        const p = new Position(x, y, z);
        for (let o = dungeon.findFirstObject(p); o !== OBJECT_ID_EOF && carried.length < 2;) {
          const next = dungeon.getDBRecordLink(o);
          if (dungeon.rnMaps.dbType(o) === DBType.WEAPON) {
            dungeon.removeObjectFromCell(p, o);
            carried.push(o);
          }
          o = next;
        }
      }
    }
    rn = groupAt(game, THREE);
    record(game, THREE).possession = carried[0]!;
    dungeon.setDBRecordLink(carried[0]!, carried[1]!);
    dungeon.setDBRecordLink(carried[1]!, OBJECT_ID_EOF);
  });
  console.log(`2. &MONPOSS of a group carrying ${carried.join(', ')}, indices 0, 1, 2, -1: ${g.slice(0, 4).join(' ')}; `
    + `of a weapon ${g[4]}, of slot 0xffff ${g[5]}`);
  check(g.slice(0, 4).join() === `${carried[0]},${carried[1]},-1,-1`, 'the possessions by index, -1 past the last');
  check(g[4] === 0xffff && g[5] === 0xffff, 'a slot that is no group pushes RNnul\'s integer, 0xffff');
}

/* ---------------------------------------------- 3. &DELMON ---------------------- */
{
  const del = (at: Position, index: number) => (): number[] => [...int(locr(at)), ...int(index), op(StkOp.DEL_MON)];
  const before = run([]);
  console.log(`3a. level 7's three: ${describe(before.game, THREE)}`);
  const off = run(del(THREE, 1), (game) => {
    record(game, THREE).fear = 6;
    [TimerFunction.TT_MONSTER_A0, TimerFunction.TT_MONSTER_A1, TimerFunction.TT_MONSTER_A2]
      .forEach((fn) => addTimer(game, THREE, fn));
  });
  console.log(`    &DELMON of member 1, in fear 6 with timers A0 A1 A2: ${describe(off.game, THREE)}`);
  check(describe(off.game, THREE) === `n 2 hp 102/107 positions 10 facings 3 timers ${TimerFunction.TT_MONSTER_A0},`
    + `${TimerFunction.TT_MONSTER_A1},${TimerFunction.TT_MONSTER_BGROUP}`,
  'member 2 takes member 1\'s place, its hit points, corner and timer with it, and member 1\'s timer goes');

  const past = run(del(THREE, 3));
  const single = run(del(WHOLE_SQUARE, 0));
  console.log(`3b. &DELMON of member 3 of three: ${describe(past.game, THREE)}; of a group of one: `
    + `${describe(single.game, WHOLE_SQUARE)}`);
  check(describe(past.game, THREE) === describe(before.game, THREE), 'an index past the last member leaves the group');
  check(record(single.game, WHOLE_SQUARE).numMonM1 === 0, 'a group of one is left');

  let status = '';
  const on = run(del(THREE, 0), (game) => {
    partyOnto(game, THREE.z);
    const item16 = game.ctx.dungeon.getAttachedItem16(record(game, THREE))!;
    item16.singleMonsterStatus[0] = 0x11;
    item16.singleMonsterStatus[1] = 0x22;
    item16.singleMonsterStatus[2] = 0x33;
    status = describe(game, THREE);
  });
  console.log(`3c. on the party's level, ${status}; after &DELMON of member 0: ${describe(on.game, THREE)}`);
  const item16 = on.game.ctx.dungeon.getAttachedItem16(record(on.game, THREE))!;
  check(record(on.game, THREE).hp.slice(0, 2).join() === '99,107' && item16.positions === 0b0001
    && item16.singleMonsterStatus.slice(0, 2).join() === '34,51',
  'on the party\'s level the ITEM16\'s corners and status close up too');
}

/* ---------------------------------------------- 4. &INSMON ---------------------- */
{
  const ins = (at: Position, mask: number) => (): number[] => [...int(locr(at)), ...int(mask), op(StkOp.INS_MON)];
  const off = run(ins(THREE, 0x0f), (game) => addTimer(game, THREE, TimerFunction.TT_MONSTER_A0));
  console.log(`4a. &INSMON into level 7's three, mask 15, with a TT_MONSTER_A0: ${describe(off.game, THREE)}`);
  check(describe(off.game, THREE) === `n 4 hp 102/99/107/102 positions 11000110 facings 3 timers `
    + `${TimerFunction.TT_MONSTER_A0},${TimerFunction.TT_MONSTER_A3},${TimerFunction.TT_MONSTER_BGROUP}`,
  'a copy of member 0 in the free corner 3, with member 0\'s hit points and its timer renumbered');

  const held = run(ins(THREE, 0b0111));
  const full = run(ins(FOUR, 0x0f));
  const widePair = run(ins(WIDE_PAIR, 0x0f));
  const wholeSquare = run(ins(WHOLE_SQUARE, 0x0f));
  const n = (r: { game: Game }, at: Position): number => record(r.game, at).numMonM1 + 1;
  console.log(`4b. &INSMON with only held corners: ${n(held, THREE)}; into four: ${n(full, FOUR)}; into a pair of `
    + `size 1: ${n(widePair, WIDE_PAIR)}; into a size-2 one: ${n(wholeSquare, WHOLE_SQUARE)}`);
  check(n(held, THREE) === 3 && n(full, FOUR) === 4 && n(widePair, WIDE_PAIR) === 2 && n(wholeSquare, WHOLE_SQUARE) === 1,
    'no member joins a full group, through held corners, or a group as wide as its square');

  let before = '';
  let facing = 0;
  const on = run(ins(TWO, 0x0f), (game) => {
    partyOnto(game, TWO.z);
    const m = record(game, TWO);
    const item16 = game.ctx.dungeon.getAttachedItem16(m)!;
    item16.facings = 0b0101;
    item16.singleMonsterStatus[2] = 0x44;
    m.facing = facing = 2;
    before = describe(game, TWO);
  });
  console.log(`4c. on the party's level, ${before}, the record facing ${facing}; after &INSMON: ${describe(on.game, TWO)}`);
  const item16 = on.game.ctx.dungeon.getAttachedItem16(record(on.game, TWO))!;
  check(item16.facings === 0b100010, 'the record\'s facing, for member 0 and the new one, is the whole facing byte');
  check(item16.singleMonsterStatus[2] === 0x44, 'the new member\'s status is the slot\'s, not member 0\'s');
}

/* ---------------------------------------------- 5. &MONBLK ---------------------- */
{
  const { game } = run([...int(0b1010), op(StkOp.MON_BLK)]);
  const inhibit = Array.from(game.ctx.systems.monsterAI.monsterMoveInhibit);
  console.log(`5. &MONBLK 10: monsterMoveInhibit ${inhibit.join(' ')}`);
  check(inhibit.join() === '0,2,0,8', 'east and west are inhibited, each by its own bit');
}

/* ---------------------------------------------- 6. &MONL&D ---------------------- */
{
  const program = [...int(4242), ...int(10), op(StkOp.MON_LAND_D), globalStore(0),
    ...int(555), ...int(99), op(StkOp.MON_LAND_D), globalStore(3),
    varFetch(10), globalStore(1), varFetch(11), globalStore(2)];
  const outside = run(program);
  const inside = run(program, (game) => {
    game.systems.dsa.monsterMoveFilterActive = true;
    // The filter's parameters: the group's level, x and y, its slot, the party's level, x and y.
    game.systems.dsa.setParameters(7, [7, 5, 9, 1687, 7, 8, 12]);
  });
  console.log(`6. &MONL&D outside the move filter: tops of stack ${outside.g[0]} ${outside.g[3]}, variables 10 and 11 `
    + `${outside.g[1]} ${outside.g[2]}; inside it: tops of stack ${inside.g[0]} ${inside.g[3]}, variables `
    + `${inside.g[1]} ${inside.g[2]}`);
  check(outside.g[0] === 10 && outside.g[3] === 99 && outside.g[1] === 0 && outside.g[2] === 0,
    'outside the filter it pops nothing and writes nothing');
  check(inside.g[0] === 4242 && inside.g[3] === 555, 'inside it pops its index, and an index past 98 writes nothing');
  check(inside.g[1] === 1024 * 7 + 32 * 5 + 9 && inside.g[2] === 5, '1024 * level + 32 * x + y, and the distance less one');
}

finish();
