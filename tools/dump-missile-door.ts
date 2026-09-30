/**
 * The door arm of `ProcessMissileEncounter` (`doc/CSBwin-src/Code11f52.cpp:1844-1935`).
 *
 *  1. A Zo spell at a door that is not broken toggles it through a `TT_DOOR` at
 *     `d.Time + 1` if the door has a button, and is spent **either way** (`break`). The
 *     port fell through into the state test, so at an open door the spell flew on.
 *  2. `BITS8_15(d.DoorTOC[doorType]) & 2` marks a door missiles can pass. A cloud
 *     (a spell) passes if it is non-physical (`>= RNDispellMissile`); a thrown object
 *     passes if its range beats `STRandom(128)`, it fits in a pouch
 *     (`ObjDesc.word4 & 0x100`) and it is not a key. The port had no such test: every
 *     missile stopped at every closed door.
 *  3. Otherwise the door takes `HitDoor(x, y, D5W + STRandom() % D5W, false, 0)` with
 *     `D5W = DetermineMagicDamage + 1`, after the missile filter. The port never hit
 *     the door at all.
 *
 * Each case calls the door arm directly on a real closed door, with the door's
 * `DoorTOC` and flags set for the case, and a missile sitting in the door's square.
 *
 * Run: `npx tsx tools/dump-missile-door.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DBType, OBJECT_ID_EOF, OBJECT_ID_NULL, Position, RoomType, decodeObjectID, type ObjectID } from '../src/core/types';
import { OBJNI_FIRST_KEY, OBJNI_LAST_KEY } from '../src/core/objectNameIndex';
import { RN_DISPELL_MISSILE, RN_FIREBALL, RN_ZO_SPELL } from '../src/core/spellRn';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { Game } from '../src/engine/Game';
import { DescIndex } from '../src/engine/objectIndex';
import { TimerFunction } from '../src/engine/TimerQueue';
import { gameTablesOf, graphicsTablesOf } from './lib/game';
import { check, finish } from './lib/check';

const graphics = new GraphicsLoader();
graphics.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/graphics.dat'))));
const objectTables = graphicsTablesOf(graphics).objects;

/** A game whose `d.DoorCharacteristics` are all `doorToc`, so any door has that `DoorTOC`. */
function makeGame(doorToc: number): Game {
  const loader = new DungeonLoader();
  loader.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/dungeon.dat'))));
  const data = loader.getData();
  if (!data) throw new Error('dungeon.dat did not load');
  const game = new Game(data, { ...gameTablesOf(graphics), doorCharacteristics: [doorToc, doorToc, doorToc, doorToc] });
  game.setRandomSeed(0x12345678);
  return game;
}

/** A closed door (state 4) somewhere in the dungeon. */
function findClosedDoor(game: Game): Position {
  const dungeon = game.ctx.dungeon;
  for (let z = 0; z < dungeon.getMapCount(); z++) {
    const map = dungeon.getMap(z);
    if (!map) continue;
    for (let x = 0; x < map.descriptor.width; x++) {
      for (let y = 0; y < map.descriptor.height; y++) {
        const flag = map.cellFlags[x]?.[y] ?? 0;
        if (((flag >> 5) & 7) === RoomType.DOOR && (flag & 7) === 4) return new Position(x, y, z);
      }
    }
  }
  throw new Error('no closed door');
}

/** A floor object matching `want`, lifted off the floor. */
function liftFloorObject(game: Game, want: (rn: ObjectID) => boolean): ObjectID {
  const dungeon = game.ctx.dungeon;
  for (let z = 0; z < dungeon.getMapCount(); z++) {
    const map = dungeon.getMap(z);
    if (!map) continue;
    for (let x = 0; x < map.descriptor.width; x++) {
      for (let y = 0; y < map.descriptor.height; y++) {
        const at = new Position(x, y, z);
        for (let rn = dungeon.findFirstObject(at); rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) {
          if (!want(rn)) continue;
          dungeon.removeObjectFromCell(at, rn);
          return rn;
        }
      }
    }
  }
  throw new Error('no such floor object');
}

const objectType = (game: Game, rn: ObjectID): number => {
  const di = DescIndex(game.ctx.dungeon, rn);
  return di === -1 ? -1 : objectTables.objDescObjectType[di];
};
const fitsPouch = (game: Game, rn: ObjectID): boolean => {
  const di = DescIndex(game.ctx.dungeon, rn);
  return di !== -1 && (objectTables.objDescCarryMask[di] & 0x100) !== 0;
};
const isKey = (game: Game, rn: ObjectID): boolean =>
  decodeObjectID(rn).category === DBType.MISC && objectType(game, rn) >= OBJNI_FIRST_KEY && objectType(game, rn) <= OBJNI_LAST_KEY;

interface Outcome {
  spent: boolean;
  hits: { force: number; explosion: boolean; delay: number }[];
  doorState: number;
  doorTimers: { time: number; action: number }[];
}

/**
 * Put `projectile` in flight inside a closed door's square, with the door set up as
 * given, and run the door arm on it once.
 */
function encounter(
  projectile: ObjectID,
  door: { toc: number; state: number; button?: boolean; chop?: boolean },
  range = 255,
  pick?: (game: Game) => ObjectID,
): Outcome {
  const game = makeGame(door.toc);
  const me = game.systems.missileEncounter as any;
  const at = findClosedDoor(game);
  const map = game.ctx.dungeon.getMap(at.z)!;
  map.cellFlags[at.x][at.y] = (map.cellFlags[at.x][at.y] & 0xf8) | door.state;
  const rn = game.ctx.dungeon.findFirstDoor(at);
  const record = game.ctx.dungeon.getDoorRecordByIndex(decodeObjectID(rn).index)!;
  record.hasButton = door.button ?? false;
  record.destructibleByChop = door.chop ?? true;

  const thrown = pick ? pick(game) : projectile;
  game.ctx.state.tickCount = 100;
  game.systems.magic.launchThrownMissile(thrown, at, 0, 0, range, 100, 1, 99);
  let missileRn: ObjectID | null = null;
  for (let r = game.ctx.dungeon.findFirstObject(at); r !== OBJECT_ID_EOF; r = game.ctx.dungeon.getDBRecordLink(r)) {
    if (decodeObjectID(r).category === DBType.MISSILE) missileRn = r;
  }
  if (missileRn === null) throw new Error('missile not placed');
  const missile = game.ctx.dungeon.getMissileRecord(missileRn)!;
  game.ctx.timers.missileFilterTimer = game.ctx.timers.getTimer(missile.timerIndex);

  const hits: Outcome['hits'] = [];
  const hitDoor = me.hitDoor.bind(me);
  me.hitDoor = (p: Position, force: number, explosion: boolean, delay = 0, time?: number): boolean => {
    hits.push({ force, explosion, delay });
    return hitDoor(p, force, explosion, delay, time);
  };
  const before = new Set(game.ctx.timers.getTimers().map((t) => t.index));
  const spent = me.processMissileEncounter(RoomType.DOOR, at.x, at.y, at.x, at.y, at.z, 0, missileRn);
  const doorTimers = game.ctx.timers.getTimers()
    .filter((t) => !before.has(t.index) && t.function === TimerFunction.TT_DOOR)
    .map((t) => ({ time: t.time, action: t.uByte9 }));
  return { spent, hits, doorState: map.cellFlags[at.x][at.y] & 7, doorTimers };
}

const show = (label: string, o: Outcome): void =>
  console.log(`${label}: ${o.spent ? 'spent' : 'flies on'}, HitDoor ${JSON.stringify(o.hits)}, door state ${o.doorState}, TT_DOOR ${JSON.stringify(o.doorTimers)}`);

const SOLID = 0x0010;       // low byte: strength 16; high byte 0 — nothing passes
const GRATE = 0x0210;       // high byte bit 1 — missiles may pass
const WEAK = 0x0001;        // any blow is enough
const STRONG = 0x00ff;      // no thrown blow is

/* -------------------------------------------------------------- canary -------- */
{
  const toc = Array.from(objectTables.doorCharacteristics, (v) => v & 0xffff);
  console.log(`DoorCharacteristics: ${toc.map((v) => '0x' + v.toString(16)).join(', ')}`);
  check(toc[0] === 0x36e && ((toc[0] >> 8) & 2) !== 0,
    'graphics.dat\'s first door type (0x36e) is one missiles pass — the rule is live in the shipped data');
  check(toc.slice(1).every((v) => ((v >> 8) & 2) === 0), 'and the other three are not');
}

/* ------------------------------------------------------------- 1. Zo ---------- */
{
  const open = encounter(RN_ZO_SPELL, { toc: SOLID, state: 0, button: true });
  show('1a. Zo at an open door with a button', open);
  check(open.doorTimers.length === 1 && open.doorTimers[0].time === 101 && open.doorTimers[0].action === 2,
    'a TT_DOOR toggle at d.Time + 1');
  check(open.spent, 'and the spell is spent, although the door is open');
  const plain = encounter(RN_ZO_SPELL, { toc: SOLID, state: 4, button: false });
  show('1b. Zo at a closed door without one', plain);
  check(plain.doorTimers.length === 0 && plain.spent && plain.hits.length === 0, 'no timer, no blow — just spent');
}

/* ------------------------------------------------------- 2. pass-through ------ */
{
  const dispell = encounter(RN_DISPELL_MISSILE, { toc: GRATE, state: 4 });
  show('2a. dispell at a grate', dispell);
  check(!dispell.spent && dispell.hits.length === 0, 'a non-physical spell passes a door with DoorTOC bit 0x200');
  const fireball = encounter(RN_FIREBALL, { toc: GRATE, state: 4 });
  show('2b. fireball at a grate', fireball);
  check(fireball.spent && fireball.hits.length === 1, 'a fireball (below RNDispellMissile) does not, and hits it');
  const solid = encounter(RN_DISPELL_MISSILE, { toc: SOLID, state: 4 });
  show('2c. dispell at a solid door', solid);
  check(solid.spent, 'without the bit nothing passes');

  const pouch = (game: Game): ObjectID =>
    liftFloorObject(game, (rn) => decodeObjectID(rn).category === DBType.MISC && fitsPouch(game, rn) && !isKey(game, rn));
  const coin = encounter(OBJECT_ID_NULL, { toc: GRATE, state: 4 }, 255, pouch);
  show('2d. a pouch-sized object at a grate, range 255', coin);
  check(!coin.spent, 'a thrown object with range, that fits a pouch and is no key, passes');
  const short = encounter(OBJECT_ID_NULL, { toc: GRATE, state: 4 }, 0, pouch);
  show('2e. the same with range 0', short);
  check(short.spent, 'with no range left it does not');
  const key = encounter(OBJECT_ID_NULL, { toc: GRATE, state: 4 }, 255, (game) => liftFloorObject(game, (rn) => isKey(game, rn) && fitsPouch(game, rn)));
  show('2f. a key at a grate', key);
  check(key.spent, 'a key never passes');
}

/* --------------------------------------------------------- 3. HitDoor --------- */
{
  const weapon = (game: Game): ObjectID => liftFloorObject(game, (rn) => decodeObjectID(rn).category === DBType.WEAPON);
  const bash = encounter(OBJECT_ID_NULL, { toc: WEAK, state: 4, chop: true }, 255, weapon);
  show('3a. a thrown weapon at a solid, choppable door', bash);
  check(bash.hits.length === 1 && !bash.hits[0].explosion && bash.hits[0].delay === 0 && bash.hits[0].force >= 1,
    'HitDoor(x, y, D5W + STRandom() % D5W, false, 0)');
  check(bash.doorState === 5, 'a blow over the door\'s strength breaks it at once');
  const sturdy = encounter(OBJECT_ID_NULL, { toc: WEAK, state: 4, chop: false }, 255, weapon);
  show('3b. the same door, not choppable', sturdy);
  check(sturdy.hits.length === 1 && sturdy.doorState === 4, 'HitDoor is still called, and the door holds');
  const strong = encounter(OBJECT_ID_NULL, { toc: STRONG, state: 4, chop: true }, 255, weapon);
  show('3c. a choppable door of strength 255', strong);
  check(strong.hits.length === 1 && strong.hits[0].force < 255 && strong.doorState === 4, 'a blow under DoorTOC & 0xff leaves it shut');
}

finish();
