/**
 * The DSA's `&ADD` and `&DEL` on a square go through the world `MoveObject`
 * (`doc/CSBwin-src/Code11f52.cpp:2831`): `&DEL` lifts with `MoveObject(obj, x, y, -1, 0)`
 * (`DSA.cpp:1700-1704`), `&ADD` sets the copy down with `MoveObject(newObj, -1, 0, x, y)`
 * and then `newObj.pos(p)` (`:2055-2059`), each on the square's level. Run through
 * `DsaSystem` on `csbgame7.dat`:
 *
 * 1. a copy added on an open pit falls to the level below, in the corner its mask names;
 * 2. a copy added on an active teleporter is carried on to its destination;
 * 3. a copy added on the party's square presses its pads with `unchangedRoom` true
 *    (`Code11f52.cpp:3458-3473`), once it is in the cell; `&DEL` takes it off with
 *    `unchangedRoom` true too (`:3314-3328`);
 * 4. a group added on the party's level gets an ITEM16 and its first AI timers
 *    (`:3410`, `:3439`);
 * 5. `CopyItem` copies no group while the ITEM16 pool is full and the DSA runs on the
 *    party's level (`DSA.cpp:1866-1868`): `&OBJECTID` then reads `RNeof`. Off the
 *    party's level it does.
 *
 * Run: `npm test -- --only=dsa-add-delete.ts`
 */
import {
  DBType, OBJECT_ID_EOF, OBJECT_ID_NULL, Position, RoomType, locationRelToInteger, type ObjectID,
} from '../../src/core/types';
import type { Game } from '../../src/engine/Game';
import { TimerFunction } from '../../src/engine/TimerQueue';
import { StkOp } from '../../src/engine/dsa/DsaTypes';
import { freshGame, globalStore, int, op, run } from '../lib/dsa';
import { check, finish } from '../lib/check';

const base = freshGame();
const weapon = base.ctx.party.state.champions[0]!.possessions[12]!;
check(base.ctx.dungeon.rnMaps.dbType(weapon) === DBType.WEAPON, 'the first champion holds a weapon in slot 12');

const locr = (p: Position): number => locationRelToInteger({ l: p.z, x: p.x, y: p.y, p: 0 });
/** `&ADD` of `obj` at `p`, in a corner of `mask`, and the copy's ID into global 0. */
const add = (obj: number, p: Position | number, mask: number): number[] =>
  [...int(mask), ...int(typeof p === 'number' ? p : locr(p)), ...int(obj), op(StkOp.ADD), op(StkOp.OBJECT_ID), globalStore(0)];

const roomType = (game: Game, p: Position): number => (game.ctx.dungeon.getCellFlag(p) >> 5) & 7;
const holding = (game: Game, p: Position, rn: number): boolean => {
  const dungeon = game.ctx.dungeon;
  for (let r = dungeon.findFirstObject(p); r !== OBJECT_ID_EOF; r = dungeon.getDBRecordLink(r)) {
    if (r === rn) return true;
  }
  return false;
};
const findSquare = (game: Game, pred: (p: Position) => boolean): Position | null => {
  const dungeon = game.ctx.dungeon;
  for (let z = 0; z < dungeon.getMapCount(); z++) {
    const map = dungeon.getMap(z);
    if (!map) continue;
    for (let x = 0; x < map.descriptor.width; x++) {
      for (let y = 0; y < map.descriptor.height; y++) {
        const p = new Position(x, y, z);
        if (pred(p)) return p;
      }
    }
  }
  return null;
};

interface Press { at: Position; object: ObjectID; place: boolean; unchangedRoom: boolean; inCell: boolean }
/** Every `PlaceOrRemoveObjectInRoom` of `game`'s from now on. */
const spyPads = (game: Game): Press[] => {
  const presses: Press[] = [];
  const actuators = game.ctx.systems.actuators;
  const original = actuators.triggerObjectMove.bind(actuators);
  actuators.triggerObjectMove = (position, object, place, unchangedRoom, facing) => {
    presses.push({ at: position, object, place, unchangedRoom, inCell: holding(game, position, object) });
    return original(position, object, place, unchangedRoom, facing);
  };
  return presses;
};

/* ------------------------------------------------------------- 1. a pit ---- */
{
  const dungeon = base.ctx.dungeon;
  const pit = findSquare(base, (p) => {
    const flag = dungeon.getCellFlag(p);
    return roomType(base, p) === RoomType.PIT && (flag & 0x08) !== 0 && (flag & 0x01) === 0
      && dungeon.incrementLevel(p, 1) !== null;
  });
  if (!pit) throw new Error('no open pit');
  const below = dungeon.incrementLevel(pit, 1)!;
  const { game, g } = run(add(weapon, pit, 1 << 2));
  const copy = g[0]! as ObjectID;
  console.log(`1. &ADD of weapon ${weapon} on the pit (${pit.x},${pit.y}) L${pit.z}: copy ${copy}, on the pit `
    + `${holding(game, pit, copy)}, below (${below.x},${below.y}) L${below.z} ${holding(game, below, copy)}, `
    + `corner ${game.ctx.dungeon.rnMaps.pos(copy)}`);
  check(copy !== weapon && game.ctx.dungeon.rnMaps.dbType(copy) === DBType.WEAPON, 'the weapon is copied');
  check(!holding(game, pit, copy) && holding(game, below, copy), 'the copy falls down the open pit');
  check(game.ctx.dungeon.rnMaps.pos(copy) === 2, 'and lies in the corner its mask names');
}

/* ------------------------------------------------------ 2. a teleporter ---- */
{
  const dungeon = base.ctx.dungeon;
  let dest: Position | null = null;
  const tele = findSquare(base, (p) => {
    if (roomType(base, p) !== RoomType.TELEPORTER || (dungeon.getCellFlag(p) & 0x08) === 0) return false;
    let t: ObjectID | null = null;
    for (let r = dungeon.findFirstObject(p); r !== OBJECT_ID_EOF; r = dungeon.getDBRecordLink(r)) {
      if (dungeon.rnMaps.dbType(r) === DBType.TELEPORTER) t = r;
    }
    const rec = t !== null ? dungeon.getTeleporterRecord(t) : null;
    if (!rec || (rec.scope & 3) === 1) return false;
    const level = findSquare(base, (q) => q.x === 0 && q.y === 0 && dungeon.getMap(q.z)?.descriptor.level === (rec.destMap & 0xff));
    if (!level) return false;
    dest = new Position(rec.destX & 0x1f, rec.destY & 0x1f, level.z);
    return roomType(base, dest) !== RoomType.TELEPORTER && roomType(base, dest) !== RoomType.PIT
      && !(dest.x === p.x && dest.y === p.y && dest.z === p.z);
  });
  if (!tele || !dest) throw new Error('no active item teleporter');
  const to: Position = dest;
  const { game, g } = run(add(weapon, tele, 1));
  const copy = g[0]! as ObjectID;
  console.log(`2. &ADD on the teleporter (${tele.x},${tele.y}) L${tele.z}, to (${to.x},${to.y}) L${to.z}: `
    + `on the teleporter ${holding(game, tele, copy)}, at its destination ${holding(game, to, copy)}`);
  check(!holding(game, tele, copy) && holding(game, to, copy), "the copy is carried on to the teleporter's destination");
}

/* ------------------------------------------------- 3. the party's square ---- */
{
  let presses: Press[] = [];
  const party = base.ctx.party.state.position;
  const here = new Position(party.x, party.y, party.z);
  const { game, g } = run(add(weapon, here, 1 << 3), (game) => { presses = spyPads(game); });
  const copy = g[0]! as ObjectID;
  const placed = presses.filter((p) => p.object === copy);
  console.log(`3. &ADD on the party's square (${here.x},${here.y}) L${here.z}: copy ${copy} in corner `
    + `${game.ctx.dungeon.rnMaps.pos(copy)}, pads ${placed.map((p) => `place ${p.place} unchanged ${p.unchangedRoom} in the cell ${p.inCell}`).join('; ')}`);
  check(holding(game, here, copy) && game.ctx.dungeon.rnMaps.pos(copy) === 3, 'the copy lies on the party\'s square, in corner 3');
  check(placed.length === 1 && placed[0]!.place && placed[0]!.unchangedRoom,
    'its pads are pressed with unchangedRoom true: the party stands there');
  check(placed.length === 1 && placed[0]!.inCell, 'once the copy is in the cell');

  const both = run([...add(weapon, here, 1), op(StkOp.OBJECT_ID), ...int(locr(here)), op(StkOp.DEL)],
    (game) => { presses = spyPads(game); });
  const gone = both.g[0]! as ObjectID;
  const lifted = presses.filter((p) => p.object === gone && !p.place);
  console.log(`   &ADD then &DEL of copy ${gone} there: in the cell ${holding(both.game, here, gone)}, `
    + `pads ${lifted.map((p) => `place ${p.place} unchanged ${p.unchangedRoom} in the cell ${p.inCell}`).join('; ')}`);
  check(!holding(both.game, here, gone), '&DEL takes the copy off the square');
  check(lifted.length === 1 && lifted[0]!.unchangedRoom && !lifted[0]!.inCell,
    'and releases its pads with unchangedRoom true, once it is out of the cell');
}

/* ------------------------------------- 4-5. a group on the party's level ---- */
{
  const dungeon = base.ctx.dungeon;
  const z = base.ctx.party.state.position.z;
  const creatures = dungeon.getData().databases.creatures.records;
  const index = creatures.findIndex((r) => r.nextObject !== OBJECT_ID_NULL
    && dungeon.monsterAllowedOnLevel(r.creatureType, z));
  if (index < 0) throw new Error(`no group of a type allowed on level ${z}`);
  const group = dungeon.rnMaps.rn(DBType.CREATURE, index);
  const aiTimersAt = (game: Game, p: Position): number => game.ctx.timers.getTimers().filter((t) =>
    t.function >= TimerFunction.TT_FIRST_MONSTER_AI && t.function <= TimerFunction.TT_LAST_MONSTER_AI
    && t.uByte6 === p.x && t.uByte7 === p.y && t.level === p.z).length;
  const groupAt = (game: Game, p: Position): ObjectID | null => {
    const rn = game.ctx.dungeon.findFirstMonster(p);
    return rn === OBJECT_ID_EOF ? null : rn;
  };

  const { game, g, at } = run((_game, at) => add(group, at, 1));
  const copy = g[0]! as ObjectID;
  const record = game.ctx.dungeon.getCreatureRecord(copy);
  const pool = game.ctx.dungeon.getItem16Pool().length;
  console.log(`4. &ADD of group ${group} on the party's level at (${at.x},${at.y}) L${at.z}: copy ${copy}, `
    + `groupIndex ${record?.groupIndex} of a pool of ${pool}, AI timers there ${aiTimersAt(game, at)}`);
  check(groupAt(game, at) === copy, 'the group is copied onto the square');
  check(record !== null && record.groupIndex < pool, 'the copy gets an ITEM16');
  check(aiTimersAt(game, at) > 0, 'and its first AI timers');

  /** The ITEM16 pool full: more slots in use than it has. */
  const fillPool = (game: Game): void => {
    (game.systems.monsters as unknown as { item16QueLen: number }).item16QueLen = 1000;
  };
  const full = run((_game, at) => add(group, at, 1), fillPool);
  console.log(`5. the same with the ITEM16 pool full: &OBJECTID ${full.g[0]}, a group there ${groupAt(full.game, full.at)}`);
  check(full.g[0] === OBJECT_ID_EOF && groupAt(full.game, full.at) === null,
    'CopyItem copies no group while the pool is full and the DSA runs on the party\'s level');
  const away = run((_game, at) => add(group, at, 1), (game) => {
    fillPool(game);
    const party = game.ctx.party.state.position;
    party.z = (party.z + 1) % game.ctx.dungeon.getMapCount();
  });
  const awayCopy = away.g[0]! as ObjectID;
  console.log(`   with the party on level ${away.game.ctx.party.state.position.z} instead: &OBJECTID ${awayCopy}, `
    + `a group there ${groupAt(away.game, away.at)}, groupIndex ${away.game.ctx.dungeon.getCreatureRecord(awayCopy)?.groupIndex}`);
  check(awayCopy !== OBJECT_ID_EOF && groupAt(away.game, away.at) === awayCopy,
    'off the party\'s level it copies the group');
}

finish();
