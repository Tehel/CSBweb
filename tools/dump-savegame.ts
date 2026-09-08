/**
 * Prove the quick-save carries the world, not just the party.
 *
 * The quick-save used to serialize the party, the tick count, the `ITEM16` pool, the
 * timers and the missile records — and nothing else. Every mutation to the *dungeon*
 * was silently dropped on load: doors closed again, objects the party had moved
 * snapped back to their `dungeon.dat` cells, fired actuators re-armed, wounded
 * creatures came back whole. The party kept its inventory throughout, so a door
 * opened with a consumed key became permanently unopenable and the save was dead.
 *
 * None of that is visible to `tools/check-frames.sh`, and none of it is visible in a
 * single session either — it only shows up across a reload. So this tool builds two
 * independent worlds from the real `dungeon.dat`: it mutates one, snapshots it, and
 * restores that snapshot into the other, which is exactly what a page reload does.
 *
 * What to look for: every "restored" column matching the "mutated" column, and the
 * "fresh" column *differing* from both. That last one is the point — a fresh world
 * whose door is already open would make the whole test vacuous, and the fresh column
 * is what the old code produced after a load.
 *
 * Run: `npx tsx tools/dump-savegame.ts [level]`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DBType, decodeObjectID, encodeObjectID, OBJECT_ID_EOF, Position, RoomType } from '../src/core/types';
import type { ObjectID } from '../src/core/types';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import type { DungeonData } from '../src/data/dungeonTypes';
import { Game } from '../src/engine/Game';
import { getActuatorValue, setActuatorValue } from '../src/data/actuatorHelpers';
import { extractObjectTables } from '../src/renderer/csbwin/ObjectTables';
import { extractViewportTables } from '../src/renderer/csbwin/ViewportTables';
import { extractUITables } from '../src/renderer/csbwin/UITables';
import { check, finish } from './lib/check';

const DUNGEON = 'static/gamefiles/dm-atari/dungeon.dat';
const GRAPHICS = 'static/gamefiles/dm-atari/graphics.dat';

/**
 * A whole independent world. Two of these is the whole trick: a quick-load happens
 * in a process that reloaded `dungeon.dat` from scratch, so a snapshot that only
 * round-trips within one live `Game` would prove nothing.
 */
async function loadWorld(): Promise<Game> {
  const loader = new DungeonLoader();
  await loader.loadFromArray(new Uint8Array(readFileSync(resolve(DUNGEON))));
  const data = loader.getData();
  if (!data) throw new Error('dungeon.dat did not load');

  const graphics = new GraphicsLoader();
  graphics.loadFromArray(new Uint8Array(readFileSync(resolve(GRAPHICS))));
  const viewportTables = extractViewportTables(graphics);
  const objectTables = extractObjectTables(graphics, viewportTables.wallRectanglesOffset);
  const uiTables = extractUITables(graphics);

  return new Game(
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
    },
  );
}

function roomTypeAt(game: Game, x: number, y: number, level: number): number {
  return (game.dungeonState.getCellFlag(new Position(x, y, level)) >> 5) & 0x7;
}

function doorStateAt(game: Game, x: number, y: number, level: number): number {
  return game.dungeonState.getCellFlag(new Position(x, y, level)) & 0x7;
}

function objectsAt(game: Game, x: number, y: number, level: number): ObjectID[] {
  const out: ObjectID[] = [];
  const pos = new Position(x, y, level);
  for (let rn = game.dungeonState.findFirstObject(pos); rn !== OBJECT_ID_EOF; rn = game.dungeonState.getDBRecordLink(rn)) {
    out.push(rn);
    if (out.length > 64) break; // a corrupted chain must not hang the tool
  }
  return out;
}

async function main(): Promise<void> {
  const level = Number(process.argv[2] ?? 1);

  const played = await loadWorld();
  played.party.state.position = new Position(0, 0, level);
  played.monsterSystem.loadPartyLevel(level);
  const playedData = played.dungeonState.getData() as DungeonData;

  const map = played.dungeonState.getMap(level);
  if (!map) throw new Error(`level ${level} does not exist`);
  const { width, height } = map.descriptor;

  // ---- Pick the things to mutate, all from the real dungeon ---------------

  // A closed door. `applyDoorActionAtPosition` with action 2 (TOGGLE) opens it.
  let door: { x: number; y: number } | null = null;
  for (let x = 0; x < width && !door; x++) {
    for (let y = 0; y < height && !door; y++) {
      if (roomTypeAt(played, x, y, level) === RoomType.DOOR && doorStateAt(played, x, y, level) === 0) {
        door = { x, y };
      }
    }
  }
  if (!door) throw new Error(`no closed door on level ${level} — try another level`);

  // A cell holding an object, and an adjacent open cell to move it to.
  let carry: { fromX: number; fromY: number; toX: number; toY: number; rn: ObjectID } | null = null;
  for (let x = 0; x < width && !carry; x++) {
    for (let y = 0; y < height && !carry; y++) {
      if (roomTypeAt(played, x, y, level) !== RoomType.OPEN) continue;
      const here = objectsAt(played, x, y, level).filter((rn) => {
        const { category } = decodeObjectID(rn);
        // Only the object categories a champion can actually pick up and drop.
        return (
          category === DBType.WEAPON ||
          category === DBType.CLOTHING ||
          category === DBType.SCROLL ||
          category === DBType.POTION ||
          category === DBType.MISC
        );
      });
      if (here.length === 0) continue;
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        if (roomTypeAt(played, nx, ny, level) !== RoomType.OPEN) continue;
        carry = { fromX: x, fromY: y, toX: nx, toY: ny, rn: here[0] };
        break;
      }
    }
  }
  if (!carry) throw new Error(`no movable object with an open neighbour on level ${level}`);

  // An actuator, whose counter play can change.
  const actuator = playedData.databases.actuators.records[0];
  if (!actuator) throw new Error('no actuator records');

  // A creature, whose hit points play can change.
  const creature = playedData.databases.creatures.records.find((rec) => rec.hp.length > 0);
  if (!creature) throw new Error('no creature records');

  // ---- Mutate the played world -------------------------------------------

  played.dungeonState.applyDoorActionAtPosition(level, door.x, door.y, 2);
  const doorOpened = doorStateAt(played, door.x, door.y, level);

  played.dungeonState.removeObjectFromCell(new Position(carry.fromX, carry.fromY, level), carry.rn);
  played.dungeonState.addObjectToCell(new Position(carry.toX, carry.toY, level), carry.rn);

  const actuatorBefore = getActuatorValue(actuator);
  setActuatorValue(actuator, (actuatorBefore + 7) & 0x1ff);
  const actuatorAfter = getActuatorValue(actuator);

  const creatureHpBefore = creature.hp[0];
  creature.hp[0] = (creatureHpBefore + 13) & 0xffff;
  const creatureHpAfter = creature.hp[0];

  // Growth: `CreateAndDropObject` appends rather than reusing a freed slot, so the
  // record arrays get longer during play and the snapshot has to follow.
  const miscCountBefore = playedData.databases.misc.records.length;
  playedData.databases.misc.records.push({
    nextObject: OBJECT_ID_EOF,
    specialState: 0,
    important: false,
    miscType: 33, // misc_ScreamerSlice — a value a fresh dungeon.dat will not have here
  });
  // Every engine append site bumps `count` alongside the push — `createBonesRecord`,
  // `findEmptyCreatureEntry`, `Game.createMiscObject`, the `DsaSystem` object copies.
  // The first draft of this tool pushed without it and the whole-world check below
  // duly failed: the tool had built a state the game cannot reach.
  playedData.databases.misc.count++;
  const droppedRn = encodeObjectID(0, DBType.MISC, miscCountBefore) as ObjectID;
  played.dungeonState.addObjectToCell(new Position(carry.toX, carry.toY, level), droppedRn);
  const miscCountAfter = playedData.databases.misc.records.length;

  // ---- Snapshot, and restore it into a world that never saw any of it ------

  const save = played.getRuntimeSaveState();
  const serialized = JSON.stringify(save);

  const reloaded = await loadWorld();
  reloaded.party.state.position = new Position(0, 0, level);
  reloaded.monsterSystem.loadPartyLevel(level);
  const reloadedData = reloaded.dungeonState.getData() as DungeonData;

  // What the old code produced: a fresh dungeon with the party pasted back in.
  const freshDoor = doorStateAt(reloaded, door.x, door.y, level);
  const freshAtOld = objectsAt(reloaded, carry.fromX, carry.fromY, level).includes(carry.rn);
  const freshAtNew = objectsAt(reloaded, carry.toX, carry.toY, level).includes(carry.rn);
  const freshMiscCount = reloadedData.databases.misc.records.length;
  const freshActuator = getActuatorValue(reloadedData.databases.actuators.records[0]);
  const freshCreatureHp = reloadedData.databases.creatures.records.find((r) => r.hp.length > 0)!.hp[0];

  reloaded.applyRuntimeSaveState(JSON.parse(serialized));

  const restoredDoor = doorStateAt(reloaded, door.x, door.y, level);
  const restoredAtOld = objectsAt(reloaded, carry.fromX, carry.fromY, level).includes(carry.rn);
  const restoredAtNew = objectsAt(reloaded, carry.toX, carry.toY, level).includes(carry.rn);
  const restoredMiscCount = reloadedData.databases.misc.records.length;
  const restoredActuator = getActuatorValue(reloadedData.databases.actuators.records[0]);
  const restoredCreatureHp = reloadedData.databases.creatures.records.find((r) => r.hp.length > 0)!.hp[0];
  const restoredDropped = objectsAt(reloaded, carry.toX, carry.toY, level).includes(droppedRn);
  const restoredDroppedType = reloadedData.databases.misc.records[miscCountBefore]?.miscType;

  // ---- Report -------------------------------------------------------------

  console.log(`level ${level}, save payload ${(serialized.length / 1024).toFixed(1)} KiB\n`);
  console.log(['what', 'before', 'mutated', 'fresh', 'restored'].join('\t'));
  const row = (what: string, before: unknown, mutated: unknown, fresh: unknown, restored: unknown): void => {
    console.log([what, before, mutated, fresh, restored].join('\t'));
  };
  row(`door (${door.x},${door.y}) state`, 0, doorOpened, freshDoor, restoredDoor);
  row(`object at (${carry.fromX},${carry.fromY})`, true, false, freshAtOld, restoredAtOld);
  row(`object at (${carry.toX},${carry.toY})`, false, true, freshAtNew, restoredAtNew);
  row('actuator[0] value', actuatorBefore, actuatorAfter, freshActuator, restoredActuator);
  row('creature[?].hp[0]', creatureHpBefore, creatureHpAfter, freshCreatureHp, restoredCreatureHp);
  row('misc record count', miscCountBefore, miscCountAfter, freshMiscCount, restoredMiscCount);
  console.log('');

  // ---- Assertions ---------------------------------------------------------

  // The vacuity guard first: if a fresh world already looked like the mutated one,
  // every assertion below would pass against the *old* save code too.
  check(freshDoor === 0, 'a fresh dungeon should have the test door closed');
  check(freshAtOld && !freshAtNew, 'a fresh dungeon should have the test object at its original cell');
  check(freshMiscCount === miscCountBefore, 'a fresh dungeon should not have the dropped record');
  check(freshActuator === actuatorBefore, 'a fresh dungeon should have the original actuator value');
  check(freshCreatureHp === creatureHpBefore, 'a fresh dungeon should have the original creature hit points');

  check(doorOpened !== 0, 'the test door should have opened');
  check(restoredDoor === doorOpened, 'the restored door should be as open as it was saved');
  check(!restoredAtOld, 'the restored object should have left its original cell');
  check(restoredAtNew, 'the restored object should be at the cell it was moved to');
  check(
    !reloaded.dungeonState.hasObjects(new Position(carry.fromX, carry.fromY, level)) ||
      objectsAt(reloaded, carry.fromX, carry.fromY, level).length > 0,
    "the has-objects bit should agree with the restored cell's chain",
  );
  check(restoredActuator === actuatorAfter, 'the restored actuator counter should carry its play-time value');
  check(restoredCreatureHp === creatureHpAfter, 'the restored creature should carry its play-time hit points');
  check(restoredMiscCount === miscCountAfter, 'the restored misc database should keep the record play appended');
  check(restoredDropped, 'the object dropped during play should still be on the floor after the load');
  // The canary: a value that could only be right if the appended record round-tripped
  // at its own index rather than being confused with a `dungeon.dat` record.
  check(restoredDroppedType === 33, 'the appended record should come back as misc type 33, at its own index');

  // The whole-world check. Anything mutable that the snapshot forgot shows up here
  // even though no case above names it.
  const cellFlagsOf = (data: DungeonData): string =>
    data.maps.map((m) => m.cellFlags.map((col) => col.join(',')).join(';')).join('|');
  check(cellFlagsOf(reloadedData) === cellFlagsOf(playedData), 'every cell flag on every level should round-trip');
  check(
    JSON.stringify(reloadedData.objectList) === JSON.stringify(playedData.objectList),
    'the whole object list should round-trip',
  );
  check(
    JSON.stringify(reloadedData.databases) === JSON.stringify(playedData.databases),
    'every database record should round-trip',
  );
  // Pinned because it is what the first draft of this tool got wrong: `Database.count`
  // tracks `records.length` because every engine append maintains it, so the restore
  // recomputing it is equivalent — not a divergence.
  const countsTrackLength = (Object.keys(reloadedData.databases) as Array<keyof typeof reloadedData.databases>)
    .every((key) => reloadedData.databases[key].count === reloadedData.databases[key].records.length);
  check(countsTrackLength, 'every restored database count should equal its record count');
  // `tiles` is derived from the cell flags, and the engine reads both; a restore that
  // wrote one and not the other would leave the two disagreeing.
  const tilesAgree = reloadedData.maps.every((m) =>
    m.tiles.every((col, x) => col.every((tile, y) => tile.cellFlag === m.cellFlags[x][y])),
  );
  check(tilesAgree, 'the derived tiles should agree with the restored cell flags');

  finish();
}

main();
