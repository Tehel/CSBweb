/**
 * An object picked up from a floor pad (`TAG01a148`, `doc/CSBwin-src/Mouse.cpp:799-842`):
 * its `MoveObject(objD4, D6W, D5W, -1, 0)` (`:837`) removes the object through
 * `PlaceOrRemoveObjectInRoom` with `unchangedRoom` = "the party stands there"
 * (`Code11f52.cpp:3311-3329`), and a pad of type 1 ignores a move with `unchangedRoom`
 * (`:3773`).
 *
 * 1. **From the party's own square**: the pad stays down, no action queued. At level 5,
 *    before the fix, the port lifted it (`pickUpLiftsPad`): Conflux's partial game
 *    (`DEBT.md` F24) opened the pit at 1(20,18) that the pad at 1(21,18) holds shut.
 * 2. **From the square ahead**: the party is not there, and the pad is lifted, at both
 *    levels.
 * 3. **The extra `gatherThrownWeapons`**, which takes a weapon off the party's square as
 *    a pick-up by hand does: the pad stays down; at level 5 it was lifted.
 *
 * The pad is a real one from `dungeon.dat`, the first actuator of type 1 alone on an open
 * square with an open neighbour, made to act at every press and release
 * (`CONSTPRESSURE`), so that whatever passes its tests queues an action.
 *
 * Run: `npm test -- --only=pick-up-pad.ts`
 */
import { DBType, OBJECT_ID_EOF, OBJECT_ID_NULL, Position, RoomType, type ObjectID } from '../../src/core/types';
import { ActuatorAction, getActuatorType } from '../../src/data/actuatorHelpers';
import { behaviourAt } from '../../src/engine/Behaviour';
import type { Game } from '../../src/engine/Game';
import { NO_EXTRAS } from '../../src/engine/GameContext';
import { gatherThrownWeapons, tagThrownWeapon } from '../../src/engine/ThrownWeapons';
import { VIEWPORT_Y } from '../../src/renderer/ViewportGraphics';
import { tryPickViewportObject } from '../../src/renderer/ui/ViewportPicking';
import { check, finish } from '../lib/check';
import { testChampion } from '../lib/champion';
import { stockGame, stockGraphics } from '../lib/game';
import { wrapMember } from '../lib/standIn';
import { newUIState } from '../lib/ui';

const DELTAS: ReadonlyArray<readonly [number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const WEAPON_DAGGER = 8;

/** A type-1 floor pad alone on its open square, made `CONSTPRESSURE`, and the open square beside it on side `side`. */
function findPad(game: Game): { pad: Position; beside: Position; side: number } {
  const dungeon = game.ctx.dungeon;
  const roomType = (p: Position): number => (dungeon.getCellFlag(p) >> 5) & 7;
  for (let z = 0; z < dungeon.getMapCount(); z++) {
    const map = dungeon.getMap(z)!;
    for (let x = 1; x < map.descriptor.width - 1; x++) {
      for (let y = 1; y < map.descriptor.height - 1; y++) {
        const pad = new Position(x, y, z);
        if (roomType(pad) !== RoomType.OPEN) continue;
        const first = dungeon.findFirstObject(pad);
        if (first === OBJECT_ID_EOF || dungeon.getDBRecordLink(first) !== OBJECT_ID_EOF) continue;
        if (dungeon.rnMaps.dbType(first) !== DBType.ACTUATOR) continue;
        const rec = dungeon.getActuatorRecord(first)!;
        if (getActuatorType(rec) !== 1) continue;
        for (let side = 0; side < 4; side++) {
          const beside = new Position(x + DELTAS[side]![0], y + DELTAS[side]![1], z);
          if (roomType(beside) !== RoomType.OPEN || dungeon.findFirstObject(beside) !== OBJECT_ID_EOF) continue;
          rec.word4 = (rec.word4 & ~0x18) | (ActuatorAction.CONSTPRESSURE << 3);
          return { pad, beside, side };
        }
      }
    }
  }
  throw new Error('no lone type-1 floor pad with an open square beside it');
}

/** A new misc record, not in any cell. */
function misc(game: Game): ObjectID {
  const data = game.ctx.dungeon.getData();
  data.databases.misc.records.push({ nextObject: OBJECT_ID_EOF, specialState: 0, important: false, miscType: 0 });
  return game.ctx.dungeon.rnMaps.rn(DBType.MISC, data.databases.misc.records.length - 1);
}

/** Every action a pad queues (`QueueSwitchAction`). */
function spy(game: Game): { count: number } {
  const queued = { count: 0 };
  wrapMember(game.systems.actuators, 'queueSwitchAction', (real) => (...args) => {
    queued.count++;
    return real(...args);
  });
  return queued;
}

/**
 * The party on the pad, or beside it facing it (`ahead`), an object on the pad at the
 * corner a viewport button shows, picked up by a click on that button: whether it came
 * into the hand, and the actions the pad queued.
 */
function pickUp(level: number | null, ahead: boolean): { picked: boolean; queued: number } {
  const game = stockGame();
  if (level !== null) game.ctx.behaviour = behaviourAt(level);
  const { pad, beside, side } = findPad(game);
  const party = game.ctx.party.state;
  // On the pad facing any way, or beside it facing it: `side` is the pad's side to it,
  // so the party beside faces the opposite way.
  party.position = ahead ? beside : pad;
  game.ctx.party.setFacing(ahead ? (side + 2) & 3 : 0);
  game.systems.monsters.loadPartyLevelIfChanged();
  // Button 0 is the party's square's near corner, button 2 the square ahead's
  // (`relativeLocation`, the corner `(facing + button) & 3`).
  const button = ahead ? 2 : 0;
  const lying = game.ctx.dungeon.rnMaps.setPos(misc(game), (party.facing + button) & 3);
  game.ctx.dungeon.addObjectToCell(pad, lying);
  party.cursorOwner = 0;
  party.objectInHand = OBJECT_ID_NULL;
  const ui = newUIState(stockGraphics(), game.ctx);
  const hit = { x1: 10, x2: 20, y1: 10, y2: 20 };
  const none = { x1: 255, x2: 0, y1: 0, y2: 0 };
  ui.picking.viewportObjectButtons = [0, 1, 2, 3, 4, 5].map((b) => b === button ? hit : none);
  ui.picking.viewportObjectRNs = [0, 1, 2, 3, 4].map((b) => b === button ? lying : OBJECT_ID_EOF);
  const queued = spy(game);
  const picked = tryPickViewportObject(ui, 15, 15 + VIEWPORT_Y) && party.objectInHand === lying;
  return { picked, queued: queued.count };
}

/* -------------------------------------------- 1-2. by hand, at the feet and ahead ---- */
for (const ahead of [false, true]) {
  const now = pickUp(null, ahead);
  const before = pickUp(5, ahead);
  const where = ahead ? 'the square ahead' : "the party's own square";
  console.log(`from ${where}: picked ${now.picked}, ${now.queued} action(s) queued; at level 5, ${before.queued}`);
  const n = ahead ? 2 : 1;
  check(now.picked && before.picked, `${n}. the object is picked up from ${where}`);
  if (ahead) {
    check(now.queued === 1 && before.queued === 1, '2. the pad ahead, the party not on it, is lifted at both levels');
  } else {
    check(now.queued === 0, '1. the pad under the party stays down');
    check(before.queued === 1, '1. at level 5 it was lifted (pickUpLiftsPad)');
  }
}

/* ------------------------------------------------- 3. the extra gathering it in ---- */
function gather(level: number | null): { gathered: boolean; queued: number } {
  const game = stockGame();
  if (level !== null) game.ctx.behaviour = behaviourAt(level);
  const { pad } = findPad(game);
  game.systems.hallOfChampions.addChampion(testChampion(0, { name: 'THROWER' }));
  game.ctx.extras = { ...NO_EXTRAS, gatherThrownWeapons: true };
  game.ctx.party.state.position = pad;
  game.systems.monsters.loadPartyLevelIfChanged();
  const dagger = game.ctx.dungeon.findEmptyDBEntry('weapons', {
    nextObject: OBJECT_ID_EOF, weaponType: WEAPON_DAGGER, charges: 0, litTorch: false,
    important: false, cursed: false, poisoned: false, broken: false,
  });
  if (dagger === null) throw new Error('no weapon record free');
  game.ctx.dungeon.addObjectToCell(pad, dagger);
  tagThrownWeapon(game.ctx, dagger, 0, 1);
  const queued = spy(game);
  gatherThrownWeapons(game.ctx, pad);
  const gathered = game.ctx.dungeon.getDBRecordLink(game.ctx.dungeon.findFirstObject(pad)) === OBJECT_ID_EOF;
  return { gathered, queued: queued.count };
}
{
  const now = gather(null);
  const before = gather(5);
  console.log(`gathered on the pad: ${now.gathered}, ${now.queued} action(s) queued; at level 5, ${before.queued}`);
  check(now.gathered && before.gathered, '3. the extra takes the dagger off the pad');
  check(now.queued === 0, '3. the pad under the party stays down');
  check(before.queued === 1, '3. at level 5 it was lifted (pickUpLiftsPad)');
}

finish();
