/**
 * The DSA operations on the dungeon and the program, each run
 * through `DsaSystem.execute` as a program of a test DSA on a genuine save
 * (`csbgame7.dat`).
 *
 * 1. **`&LOC2ABSCOORD`** (`doc/CSBwin-src/DSA.cpp:3253-3269`, `LOCATIONABS::operator =`,
 *    `:320-327`): the level, the column and row plus the level's offsets, the corner.
 * 2. **`&ECF@` and `&ECF!`** (`DSA.cpp:3270-3327`): eight flags of a cell, one bit of each
 *    of a column's eight longwords in the `EXPOOL` record
 *    `(EDT_ExtendedCellFlags << 24) | (l << 5) | x`.
 * 3. **`&MULTIPLIER@`** (`DSA.cpp:3974-3990`): a level's experience multiplier, 1 past the
 *    last level.
 * 4. **`&PARTYDISTANCE`** (`DSA.cpp:4057-4073`): steps on the party's level, minus the
 *    levels between otherwise.
 * 5. **`&J*` and `&G*`** (`DSA.cpp:4737-4767`): a jump and a call to a state and column
 *    taken from the stack.
 * 6. **`&THISDSAID` and `&DSAINFO@`** (`DSA.cpp:4822-4828`, `:2439-2470`): the DSA's own
 *    actuator, and a type-47 actuator's selector, state and parameters, -1 for any other.
 * 7. **`&BITCOUNT`** (`DSA.cpp:4832-4849`).
 * 8. **`&VSET`** (`DSA.cpp:4850-4897`): variables set to a constant or copied, their states
 *    with them.
 * 9. **`&THISCELL` and `&NEIGHBORS`** (`ExamineCell`, `DSA.cpp:2200-2320`).
 *
 * Run: `npx tsx tools/dump-dsa-dungeon.ts`
 */
import { DBType, OBJECT_ID_EOF, Position, RoomType, locationRelToInteger, type ObjectID } from '../src/core/types';
import type { DsaDefinition } from '../src/data/dungeonTypes';
import { StkOp } from '../src/engine/DsaSystem';
import type { Game } from '../src/engine/Game';
import { int, op, report, run, varFetch, varStore } from './lib/dsa';
import { check, finish } from './lib/check';

const STORE = 20; // GLOBALSTORE
const globalStore = (index: number): number => STORE | (index << 6);
const loc = (l: number, x: number, y: number, p = 0): number => locationRelToInteger({ l, x, y, p });
const signed = (v: number): number => v | 0;

/** Every cell of the dungeon whose room type is `type`, with its flag byte. */
function cellsOf(game: Game, type: RoomType): Array<{ at: Position; cf: number }> {
  const dungeon = game.ctx.dungeon;
  const out: Array<{ at: Position; cf: number }> = [];
  for (let z = 0; z < dungeon.getMapCount(); z++) {
    const map = dungeon.getMap(z)!;
    for (let x = 0; x < map.descriptor.width; x++) {
      for (let y = 0; y < map.descriptor.height; y++) {
        const at = new Position(x, y, z);
        const cf = dungeon.getCellFlag(at);
        if (((cf >> 5) & 7) === type) out.push({ at, cf });
      }
    }
  }
  return out;
}

console.log('1. &LOC2ABSCOORD');
{
  const { game, g, at } = run((_g, here) => [
    ...int(loc(here.z, here.x, here.y, 3)), op(StkOp.LOC_TO_ABS_COORD),
    globalStore(3), globalStore(2), globalStore(1), globalStore(0),
    ...int(loc(63, 4, 5, 1)), op(StkOp.LOC_TO_ABS_COORD),
    globalStore(7), globalStore(6), globalStore(5), globalStore(4),
  ]);
  const d = game.ctx.dungeon.getMap(at.z)!.descriptor;
  console.log(`  L${at.z} (${at.x},${at.y}) corner 3 → ${g.slice(0, 4).join(' ')}; offsets ${d.offsetX},${d.offsetY}`);
  check(g[0] === at.z && g[1] === at.x + d.offsetX && g[2] === at.y + d.offsetY && g[3] === 3,
    'the level, the column and row plus the level\'s offsets, the corner');
  console.log(`  L63 (4,5) corner 1 → ${g.slice(4, 8).join(' ')}`);
  check(g.slice(4, 8).join() === '63,4,5,1', 'a level that is not there adds no offset (DEBT.md H)');
}

console.log('2. &ECF@ and &ECF!');
{
  const { game, g, at } = run((_g, here) => [
    ...int(0x1a5), ...int(loc(here.z, here.x, here.y)), op(StkOp.STORE_EX_CELL_FLG),
    ...int(0x5a), ...int(loc(here.z, here.x, 31)), op(StkOp.STORE_EX_CELL_FLG),
    ...int(loc(here.z, here.x, here.y, 2)), op(StkOp.FETCH_EX_CELL_FLG), globalStore(0),
    ...int(loc(here.z, here.x, 31)), op(StkOp.FETCH_EX_CELL_FLG), globalStore(1),
    ...int(loc(here.z, here.x, (here.y + 1) & 31)), op(StkOp.FETCH_EX_CELL_FLG), globalStore(2),
    ...int(loc(here.z, (here.x + 1) & 31, here.y)), op(StkOp.FETCH_EX_CELL_FLG), globalStore(3),
    ...int(0x03), ...int(loc(here.z, here.x, here.y)), op(StkOp.STORE_EX_CELL_FLG),
    ...int(loc(here.z, here.x, here.y)), op(StkOp.FETCH_EX_CELL_FLG), globalStore(4),
    ...int(loc(here.z, here.x, 31)), op(StkOp.FETCH_EX_CELL_FLG), globalStore(5),
  ]);
  console.log(`  ECF@ after ECF! 0x1a5 and 0x5a on row 31: ${g.slice(0, 6).map((v) => `0x${(v >>> 0).toString(16)}`).join(' ')}`);
  check(g[0] === 0xa5, 'ECF! keeps the low eight bits, and ECF@ reads them back, whatever the corner');
  check(g[1] === 0x5a, 'another row of the column keeps its own flags');
  check(g[2] === 0 && g[3] === 0, 'the next row and the next column have none');
  check(g[4] === 0x03 && g[5] === 0x5a, 'a second ECF! replaces the cell\'s flags and leaves the row 31\'s');
  const key = ((2 << 24) | (at.z << 5) | at.x) >>> 0;
  const record = game.ctx.dungeon.locateExpoolRecord(key)!;
  console.log(`  record 0x${key.toString(16)}: ${record.map((w) => (w >>> 0).toString(16)).join(' ')}`);
  const expected = Array.from({ length: 8 }, (_, i) =>
    (((0x03 >> i) & 1 ? 1 << at.y : 0) | ((0x5a >> i) & 1 ? 1 << 31 : 0)) >>> 0);
  check(record.length === 8 && record.every((w, i) => (w >>> 0) === expected[i]),
    'one record of eight longwords for the column, flag i in longword i, a bit a row');
  game.ctx.dungeon.readExpoolRecord(key);
  check(game.ctx.dungeon.locateExpoolRecord(key) === null, 'ECF! read the record out before writing it back: one record');
}

console.log('3. &MULTIPLIER@');
{
  const { game, g } = run((gm) => [
    ...int(0), op(StkOp.MULTIPLIER_FETCH), globalStore(0),
    ...int(gm.ctx.dungeon.getMapCount() - 1), op(StkOp.MULTIPLIER_FETCH), globalStore(1),
    ...int(gm.ctx.dungeon.getMapCount()), op(StkOp.MULTIPLIER_FETCH), globalStore(2),
    ...int(-1), op(StkOp.MULTIPLIER_FETCH), globalStore(3),
  ]);
  const dungeon = game.ctx.dungeon;
  const last = dungeon.getMapCount() - 1;
  console.log(`  level 0 → ${g[0]}, level ${last} → ${g[1]}, level ${last + 1} → ${g[2]}, level -1 → ${g[3]}`);
  check(g[0] === dungeon.getMap(0)!.descriptor.difficulty && g[1] === dungeon.getMap(last)!.descriptor.difficulty,
    'a level\'s experienceMultiplier, word12 bits 12-15');
  check(g[1] !== 0, 'the last level\'s multiplier is not zero, so the read is seen');
  check(g[2] === 1, '1 past the last level');
  check(g[3] === 0, 'a negative level reads before the descriptors: zero (DEBT.md H)');
}

console.log('4. &PARTYDISTANCE');
{
  const { game, g } = run((gm) => {
    const p = gm.ctx.party.state.position;
    return [
      ...int(loc(p.z, p.x, p.y)), op(StkOp.PARTY_DISTANCE), globalStore(0),
      ...int(loc(p.z, (p.x + 3) & 31, (p.y + 30) & 31, 2)), op(StkOp.PARTY_DISTANCE), globalStore(1),
      ...int(loc(p.z + 2, p.x, p.y)), op(StkOp.PARTY_DISTANCE), globalStore(2),
      ...int(loc(0, p.x, p.y)), op(StkOp.PARTY_DISTANCE), globalStore(3),
    ];
  });
  const p = game.ctx.party.state.position;
  const far = Math.abs(p.x - ((p.x + 3) & 31)) + Math.abs(p.y - ((p.y + 30) & 31));
  console.log(`  party L${p.z} (${p.x},${p.y}): ${g.slice(0, 4).map(signed).join(' ')}`);
  check(g[0] === 0 && g[1] === far, 'on the party\'s level, the steps between, whatever the corner');
  check(signed(g[2]!) === -2 && signed(g[3]!) === -p.z, 'on another level, minus the levels between');
  check(p.z > 0, 'the party is below level 0, so the last check is not a zero');
}

/** The test DSA, given `states` programs for its states past 0, as column `col` of each. */
function addStates(game: Game, states: Array<{ col: number; program: number[] }>): DsaDefinition {
  const dsa = game.ctx.dungeon.getData().dsaIndex!.entries[0]!;
  for (const { col, program } of states) {
    dsa.states.push({ actions: [{ column: col, program: Uint16Array.from(program) }] });
  }
  dsa.numStates = dsa.states.length;
  return dsa;
}

console.log('5. &J* and &G*');
{
  const { game, again } = run([
    ...int(1), globalStore(0),
    ...int(2), ...int(1), op(StkOp.JUMP_GEAR),
    ...int(99), globalStore(1),
  ]);
  addStates(game, [
    { col: 2, program: [...int(7), globalStore(2), ...int(3), ...int(2), op(StkOp.GOSUB_GEAR), ...int(9), globalStore(3)] },
    { col: 3, program: [...int(8), globalStore(4)] },
  ]);
  const g = again();
  console.log(`  globals: ${g.slice(0, 5).map((v) => v.toString(16)).join(' ')}`);
  check(g[0] === 1 && g[1] === 0x5a5a, 'J* ends the program at once');
  check(g[2] === 7, 'J* pops the state, then the column: state 1, column 2 runs');
  check(g[4] === 8 && g[3] === 9, 'G* pops the state, then the column, runs state 2 column 3, and comes back');
}

console.log('6. &THISDSAID and &DSAINFO@');
{
  let other: ObjectID = OBJECT_ID_EOF;
  let text: ObjectID = OBJECT_ID_EOF;
  const { game, at, again } = run((gm) => {
    const dungeon = gm.ctx.dungeon;
    const actuators = dungeon.getData().databases.actuators.records;
    const index = actuators.findIndex((r) => (r.word2 & 0x7f) !== 47);
    other = dungeon.rnMaps.rn(DBType.ACTUATOR, index);
    text = dungeon.rnMaps.rn(DBType.TEXT, 0);
    return [
      op(StkOp.THIS_DSA_ID), op(StkOp.DUP), globalStore(0),
      op(StkOp.DSA_INFO_FETCH), globalStore(4), globalStore(3), globalStore(2), globalStore(1),
      ...int(other), op(StkOp.DSA_INFO_FETCH), globalStore(8), globalStore(7), globalStore(6), globalStore(5),
      ...int(text), op(StkOp.DSA_INFO_FETCH), globalStore(12), globalStore(11), globalStore(10), globalStore(9),
      ...int(-1), op(StkOp.DSA_INFO_FETCH), globalStore(16), globalStore(15), globalStore(14), globalStore(13),
    ];
  });
  const dungeon = game.ctx.dungeon;
  const rn = dungeon.findFirstObject(at);
  const rec = dungeon.getActuatorRecord(rn)!;
  // Selector 5, state 3, A 0x2abcd and B 0x31234 through word8's high bits (`data.cpp:1336-1344`).
  rec.word2 = 47 | (5 << 7) | (3 << 12);
  rec.word4 = 0xabcd;
  rec.word6 = 0x1234;
  rec.word8 = 0x02 | (0x03 << 2);
  dungeon.getData().dsaLevelIndex![at.z]![5] = 0;
  const g = again();
  console.log(`  this DSA ${g[0]} (actuator ${rn}): ${g.slice(1, 5).map((v) => signed(v).toString(16)).join(' ')}`);
  check(g[0] === rn, 'THISDSAID is the DSA\'s own actuator');
  check(g[1] === 5 && g[2] === 3 && g[3] === 0x2abcd && g[4] === 0x31234,
    'DSAINFO@ of a DSA: its selector, its state bits, parameters A and B with word8\'s bits');
  console.log(`  actuator ${other} of type ${dungeon.getActuatorRecord(other)!.word2 & 0x7f}, text ${text}, -1: `
    + `${g.slice(5, 17).map(signed).join(' ')}`);
  check(g.slice(5, 17).every((v) => signed(v) === -1), 'four -1 for an actuator of another type, a text and -1');
}

console.log('7. &BITCOUNT');
{
  const { g } = run([
    ...int(0), op(StkOp.BIT_COUNT), globalStore(0),
    ...int(-1), op(StkOp.BIT_COUNT), globalStore(1),
    ...int(0x80000001), op(StkOp.BIT_COUNT), globalStore(2),
    ...int(0x12345678), op(StkOp.BIT_COUNT), globalStore(3),
  ]);
  console.log(`  0, -1, 0x80000001, 0x12345678 → ${g.slice(0, 4).join(' ')}`);
  check(g.slice(0, 4).join() === '0,32,2,13', 'the set bits of all 32');
}

console.log('8. &VSET');
{
  const set = (index: number, value: number): number[] => [...int(value), varStore(index)];
  const vset = (src: number, dst: number, n: number): number[] => [...int(src), ...int(dst), ...int(n), op(StkOp.VSET)];
  const { g } = run([
    ...vset(-7, 10, 3),
    ...vset(105, 20, 2),
    ...set(30, 1), ...set(31, 2), ...set(32, 3), ...vset(30, 31, 3),
    ...set(40, 4), ...vset(-9, 100, 1), ...vset(-9, -1, 1),
    ...vset(-4, 98, 5),
    ...set(97, 11), ...set(99, 13), ...vset(97, 0, 5),
    ...set(50, 5), ...vset(60, 50, 1),
    ...report(10, 4), // globals 0-3: 10..13
    ...[20, 21, 22].flatMap((v, i) => [varFetch(v), globalStore(4 + i)]),
    ...[30, 31, 32, 33].flatMap((v, i) => [varFetch(v), globalStore(7 + i)]),
    ...[40, 97, 98, 99].flatMap((v, i) => [varFetch(v), globalStore(11 + i)]),
    ...[0, 1, 2, 3, 50].flatMap((v, i) => [varFetch(v), globalStore(15 + i)]),
  ]);
  console.log(`  ${g.slice(0, 20).join(' ')}`);
  check(g.slice(0, 4).join() === '7,7,7,0', 'a negative source sets n variables to its negation');
  check(g.slice(4, 7).join() === '5,5,0', 'a source past 99 sets them to it minus 100');
  check(g.slice(7, 11).join() === '1,1,2,3', 'a source from 0 to 99 copies, overlapping as memmove does');
  check(g[11] === 4, 'a destination past 99, or -1 unsigned, sets nothing');
  check(g[13] === 4 && g[14] === 13, 'a count past variable 99 sets up to it (99 set again after)');
  check(g.slice(15, 19).join() === '11,4,13,0', 'a copy from 97 is cut at variable 99: three copied');
  check(g[19] === 0, 'a copy carries the state: a variable never set reads 0');
}

console.log('9. &THISCELL and &NEIGHBORS');
{
  const ROOM_BITS = 0x01ffffff;
  const EMPTY = 0x80000000 | 0;
  const PARTY = 1 << 29;
  const MONSTER = 1 << 30;
  const examine = (subcode: number, where: number, mask: number, global: number): number[] =>
    [...int(where), ...int(mask), op(subcode), globalStore(global)];
  let door = { at: new Position(0, 0, 0), cf: 0 };
  let teleporter = { at: new Position(0, 0, 0), cf: 0 };
  let monster = null as Position | null;
  let party = new Position(0, 0, 0);
  const { game, g, at } = run((gm, here) => {
    const dungeon = gm.ctx.dungeon;
    party = gm.ctx.party.state.position;
    door = cellsOf(gm, RoomType.DOOR).find(({ at: d }) =>
      dungeon.findFirstMonster(d) === OBJECT_ID_EOF && !(d.x === party.x && d.y === party.y && d.z === party.z))!;
    teleporter = cellsOf(gm, RoomType.TELEPORTER).find(({ at: t }) =>
      dungeon.findFirstMonster(t) === OBJECT_ID_EOF
      && dungeon.findFirstObject(t) !== OBJECT_ID_EOF && dungeon.rnMaps.dbType(dungeon.findFirstObject(t)) === DBType.TELEPORTER)!;
    monster = cellsOf(gm, RoomType.OPEN).map((c) => c.at).find((m) => dungeon.findFirstMonster(m) !== OBJECT_ID_EOF) ?? null;
    const doorBit = 1 << ((door.cf & 7) > 5 ? 9 : (door.cf & 7) + 5);
    const scope = dungeon.getTeleporterRecord(dungeon.findFirstObject(teleporter.at))!.scope;
    const teleporterBit = 1 << ([11, 15, 13, 17][scope]! + ((teleporter.cf & 8) !== 0 ? 0 : 1));
    return [
      ...examine(StkOp.THIS_CELL, loc(here.z, here.x, here.y), (1 << 19) | EMPTY, 0),
      ...examine(StkOp.THIS_CELL, loc(here.z, here.x, here.y), (1 << 19) | PARTY | MONSTER, 1),
      ...examine(StkOp.THIS_CELL, loc(here.z, here.x, here.y), ROOM_BITS & ~(1 << 19) | EMPTY, 2),
      ...examine(StkOp.THIS_CELL, loc(party.z, party.x, party.y), ROOM_BITS | PARTY, 3),
      ...examine(StkOp.THIS_CELL, loc(door.at.z, door.at.x, door.at.y), doorBit | EMPTY, 4),
      ...examine(StkOp.THIS_CELL, loc(door.at.z, door.at.x, door.at.y), ROOM_BITS & ~doorBit | EMPTY, 5),
      ...examine(StkOp.THIS_CELL, loc(teleporter.at.z, teleporter.at.x, teleporter.at.y), teleporterBit | EMPTY, 6),
      ...examine(StkOp.THIS_CELL, loc(teleporter.at.z, teleporter.at.x, teleporter.at.y), 0x7f800 & ~teleporterBit | EMPTY, 7),
      ...(monster ? examine(StkOp.THIS_CELL, loc(monster.z, monster.x, monster.y), (1 << 19) | MONSTER, 8) : []),
      ...examine(StkOp.NEIGHBORS, loc(here.z, here.x, here.y), (1 << 1) | (1 << 31), 9),
      ...examine(StkOp.NEIGHBORS, loc(here.z, here.x, here.y), ROOM_BITS & ~(1 << 1) | EMPTY | PARTY | MONSTER, 10),
      ...examine(StkOp.NEIGHBORS, loc(here.z, 0, 0), 1 | (1 << 31), 11),
      ...examine(StkOp.NEIGHBORS, loc(63, 4, 4), 1 | (1 << 31), 12),
    ];
  });
  const dungeon = game.ctx.dungeon;
  const step = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;
  // The room types `ExamineCell` has a case for: all but 7, which matches no mask.
  let stone = 0;
  let other = 0;
  step.forEach(([dx, dy], i) => {
    const n = new Position(at.x + dx, at.y + dy, at.z);
    const type = (dungeon.getCellFlag(n) >> 5) & 7;
    if (!dungeon.isValidLocation({ l: at.z, x: n.x, y: n.y, p: 0 })) other |= 1 << i;
    else if (type === RoomType.STONE) stone |= 1 << i;
    else if (type !== 7) other |= 1 << i;
  });
  console.log(`  open L${at.z} (${at.x},${at.y}), party (${party.x},${party.y}), door ${door.at.x},${door.at.y} cf ${door.cf}, `
    + `teleporter L${teleporter.at.z} (${teleporter.at.x},${teleporter.at.y}) cf ${teleporter.cf}, monster ${monster ? `L${monster.z}` : '-'}`);
  console.log(`  results: ${g.slice(0, 13).join(' ')}`);
  check(g[0] === 1 && g[1] === 0 && g[2] === 0, 'an empty open square is bit 19 and empty, and nothing else');
  check(g[3] === 1, 'the party\'s square has the party on it');
  check(g[4] === 1 && g[5] === 0, 'a door is the one bit of its state');
  check(g[6] === 1 && g[7] === 0, 'a teleporter is the one bit of its scope, and whether it is on');
  check(monster !== null && g[8] === 1, 'a square with a monster on it has bit 30');
  check(g[9] === stone && g[10] === other, `NEIGHBORS: a bit a neighbour, north first, clockwise (stone ${stone}, other ${other})`);
  check(stone !== 0 && other !== 0, 'the test square has neighbours of both kinds');
  check(g[11] === 0b1001, 'off the map is bit 0 and empty: north and west of (0,0)');
  check(g[12] === 0b1111, 'a level that is not there is off the map');
}

finish();
