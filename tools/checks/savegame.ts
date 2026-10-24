/**
 * Prove the runtime state (`RuntimeSave.ts`) carries the world, not just the party.
 *
 * Every game read is restored through it, a save's and a new game's. A state that held
 * the party, the tick count, the `ITEM16` pool, the timers and the missile records, and
 * nothing else, would drop every mutation to the *dungeon*: doors closed again, objects
 * the party had moved back in their `dungeon.dat` cells, fired actuators re-armed,
 * wounded creatures whole. The party would keep its inventory throughout, so a door
 * opened with a consumed key would be unopenable for good.
 *
 * None of that is visible to `tools/check-frames.sh`, and none of it is visible in a
 * single session either. So this tool builds two independent worlds from the real
 * `dungeon.dat`: it mutates one, snapshots it, and restores that snapshot into the
 * other.
 *
 * What to look for: every "restored" column matching the "mutated" column, and the
 * "fresh" column *differing* from both. That last one is the point — a fresh world
 * whose door is already open would make the whole test vacuous.
 *
 * Run: `npm test -- --only=savegame.ts [level]`
 */
import { DBType, OBJECT_ID_EOF, Position, RoomType } from '../../src/core/types';
import type { ObjectID } from '../../src/core/types';
import type { DsaDefinition, DungeonData } from '../../src/data/dungeonTypes';
import { Game } from '../../src/engine/Game';
import { DUNGEON_DATA_SOURCES, type FieldSource } from '../../src/engine/DungeonSnapshot';
import { getActuatorValue, setActuatorValue } from '../../src/data/actuatorHelpers';
import { stockGame } from '../lib/game';
import { check, finish } from '../lib/check';

/**
 * A whole independent world. Two of these is the whole trick: a quick-load happens
 * in a process that reloaded `dungeon.dat` from scratch, so a snapshot that only
 * round-trips within one live `Game` would prove nothing.
 */
async function loadWorld(): Promise<Game> {
  return stockGame();
}

function roomTypeAt(game: Game, x: number, y: number, level: number): number {
  return (game.ctx.dungeon.getCellFlag(new Position(x, y, level)) >> 5) & 0x7;
}

function doorStateAt(game: Game, x: number, y: number, level: number): number {
  return game.ctx.dungeon.getCellFlag(new Position(x, y, level)) & 0x7;
}

function objectsAt(game: Game, x: number, y: number, level: number): ObjectID[] {
  const out: ObjectID[] = [];
  const pos = new Position(x, y, level);
  for (let rn = game.ctx.dungeon.findFirstObject(pos); rn !== OBJECT_ID_EOF; rn = game.ctx.dungeon.getDBRecordLink(rn)) {
    out.push(rn);
    if (out.length > 64) break; // a corrupted chain must not hang the tool
  }
  return out;
}

/** `DUNGEON_DATA_SOURCES`, as the walk below reads it. */
type SourceTable = { readonly [field: string]: FieldSource | SourceTable };
const SOURCES = DUNGEON_DATA_SOURCES as SourceTable;

/** JSON with `expool`'s bytes spelled out, so two worlds compare whole. */
function json(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => (v instanceof Uint8Array ? Array.from(v) : v));
}

interface SourceWalk {
  /** Leaf values compared, by source. */
  compared: Record<FieldSource, number>;
  /** A field of the world that the table does not place. */
  unplaced: string[];
  /** A `loaded` field that play wrote, or that the restore did not leave as loaded. */
  written: string[];
  /** A `snapshot` field that did not come back. */
  lost: string[];
}

/**
 * Walk the source table over three worlds at once: the one that was played and saved,
 * a fresh one, and the fresh one after the save was restored into it. A `snapshot` field
 * has to come back as played; a `loaded` one has to be the same in all three.
 * `runtimeSave` fields are `tools/checks/save-roundtrip.ts`'s: a load re-derives the
 * `ITEM16` pool, so they are not expected to come back unchanged.
 */
function walkSources(table: SourceTable, played: any, fresh: any, restored: any, path: string, walk: SourceWalk): void {
  for (const field of Object.keys(played ?? {})) {
    if (!(field in table)) walk.unplaced.push(`${path}${field}`);
  }
  for (const [field, source] of Object.entries(table)) {
    const at = `${path}${field}`;
    const [p, f, r] = [played?.[field], fresh?.[field], restored?.[field]];
    if (typeof source === 'string') {
      walk.compared[source]++;
      if (source === 'snapshot' && json(r) !== json(p)) walk.lost.push(at);
      if (source === 'loaded' && (json(p) !== json(f) || json(r) !== json(f))) walk.written.push(at);
    } else if (Array.isArray(p)) {
      const n = Math.max(p.length, f?.length ?? 0, r?.length ?? 0);
      for (let i = 0; i < n; i++) walkSources(source, p[i], f?.[i], r?.[i], `${at}[${i}].`, walk);
    } else {
      walkSources(source, p, f, r, `${at}.`, walk);
    }
  }
}

/** The world without its `runtimeSave` fields: what one load of a save has to reproduce. */
function withoutRuntimeSave(table: SourceTable, value: any): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((each) => withoutRuntimeSave(table, each));
  const out: Record<string, unknown> = {};
  for (const [field, source] of Object.entries(table)) {
    if (source === 'runtimeSave') continue;
    out[field] = typeof source === 'string' ? value[field] : withoutRuntimeSave(source, value[field]);
  }
  return out;
}

async function main(): Promise<void> {
  const level = Number(process.argv[2] ?? 1);

  const played = await loadWorld();
  played.ctx.party.state.position = new Position(0, 0, level);
  played.systems.monsters.loadPartyLevel(level);
  const playedData = played.ctx.dungeon.getData();

  const map = played.ctx.dungeon.getMap(level);
  if (!map) throw new Error(`level ${level} does not exist`);
  const { width, height } = map.descriptor;

  // ---- Pick the things to mutate, all from the real dungeon ---------------

  // A closed door, which the tool opens by hand.
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
        const { category } = played.ctx.dungeon.rnMaps.decode(rn);
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

  // An OPEN cell with *no* objects at all, in a column that holds none of the cells
  // above. Dropping something here is the mutation that grows `objectList` by one and
  // so shifts `columnIndex` for every later column — the case the moved object above
  // cannot produce, because a remove-then-add inside one column cancels its own shift.
  let emptyCell: { x: number; y: number } | null = null;
  for (let x = 0; x < width && !emptyCell; x++) {
    if (x === carry.fromX || x === carry.toX) continue;
    for (let y = 0; y < height && !emptyCell; y++) {
      if (roomTypeAt(played, x, y, level) !== RoomType.OPEN) continue;
      if (played.ctx.dungeon.hasObjects(new Position(x, y, level))) continue;
      emptyCell = { x, y };
    }
  }
  if (!emptyCell) throw new Error(`no empty open cell on level ${level}`);

  // An actuator, whose counter play can change.
  const actuator = playedData.databases.actuators.records[0];
  if (!actuator) throw new Error('no actuator records');

  // A creature, whose hit points play can change.
  const creature = playedData.databases.creatures.records.find((rec) => rec.hp.length > 0);
  if (!creature) throw new Error('no creature records');

  // ---- Mutate the played world -------------------------------------------

  // Its state, the flag's low three bits, from 0 to 4 at once: no timer, no sound.
  map.cellFlags[door.x]![door.y] = (map.cellFlags[door.x]![door.y]! & 0xf8) | 4;
  const doorOpened = doorStateAt(played, door.x, door.y, level);

  played.ctx.dungeon.removeObjectFromCell(new Position(carry.fromX, carry.fromY, level), carry.rn);
  played.ctx.dungeon.addObjectToCell(new Position(carry.toX, carry.toY, level), carry.rn);

  const actuatorBefore = getActuatorValue(actuator);
  setActuatorValue(actuator, (actuatorBefore + 7) & 0x1ff);
  const actuatorAfter = getActuatorValue(actuator);

  const creatureHpBefore = creature.hp[0];
  creature.hp[0] = (creatureHpBefore + 13) & 0xffff;
  const creatureHpAfter = creature.hp[0];

  // Growth: with no free record left, `FindEmptyDBEntry` appends, so the record
  // arrays get longer during play and the snapshot has to follow.
  const miscCountBefore = playedData.databases.misc.records.length;
  playedData.databases.misc.records.push({
    nextObject: OBJECT_ID_EOF,
    specialState: 0,
    important: false,
    miscType: 33, // misc_ScreamerSlice — a value a fresh dungeon.dat will not have here
  });
  // Every engine append goes through `DungeonState.findEmptyDBEntry`, which keeps
  // `count` and the header's `objectCounts` equal to the records. The first draft of
  // this tool pushed without `count` and the whole-world check below duly failed: the
  // tool had built a state the game cannot reach.
  playedData.databases.misc.count++;
  playedData.header.objectCounts[DBType.MISC] = playedData.databases.misc.records.length;
  const droppedRn = played.ctx.dungeon.rnMaps.rn(DBType.MISC, miscCountBefore);
  played.ctx.dungeon.addObjectToCell(new Position(carry.toX, carry.toY, level), droppedRn);

  // The column-index mutation. A second appended record, dropped into a cell that had
  // nothing in it, so `addObjectToCell` takes its insert branch: it splices a new entry
  // into `objectList` and decrements/increments every later `columnIndex` entry
  // (CSBWin does the same, `doc/CSBwin-src/CSBCode.cpp:5276-5289`).
  const loneCountBefore = playedData.databases.misc.records.length;
  playedData.databases.misc.records.push({
    nextObject: OBJECT_ID_EOF,
    specialState: 0,
    important: false,
    miscType: 34,
  });
  playedData.databases.misc.count++;
  const loneRn = played.ctx.dungeon.rnMaps.rn(DBType.MISC, loneCountBefore);
  const columnIndexBefore = [...playedData.columnIndex];
  played.ctx.dungeon.addObjectToCell(new Position(emptyCell.x, emptyCell.y, level), loneRn);
  const columnIndexAfter = [...playedData.columnIndex];
  const columnIndexMoved = columnIndexBefore.some((v, i) => v !== columnIndexAfter[i]);
  const miscCountAfter = playedData.databases.misc.records.length;

  // What a CSBWin load writes and `dungeon.dat` has none of: the Extended Features
  // block's DSA tables and flags, and the special locations. No committed save defines a
  // DSA, so this is the one place a program goes through the snapshot's encoding.
  const CSBWIN_FIELDS = ['dsaLevelIndex', 'dsaIndex', 'specialLocations', 'extendedWallDecorations', 'spellFilterLocation'] as const;
  const dsaLevelIndex = Array.from({ length: 64 }, () => new Array<number>(32).fill(0xffff));
  dsaLevelIndex[level][3] = 7;
  const dsaEntries = new Array<DsaDefinition | null>(256).fill(null);
  dsaEntries[7] = {
    description: 'canary',
    state: 1,
    localState: 2,
    groupId: 3,
    numStates: 2,
    firstDisplayedState: 0,
    states: [null, { actions: [{ column: 0x12345, program: Uint16Array.of(0x0001, 0xabcd, 0xffff) }] }],
  };
  playedData.dsaLevelIndex = dsaLevelIndex;
  playedData.dsaIndex = { entries: dsaEntries };
  playedData.specialLocations = { 5: 0x1234 };
  playedData.extendedWallDecorations = true;
  playedData.spellFilterLocation = 0x80000123;

  // ---- Snapshot, and restore it into a world that never saw any of it ------

  const save = played.getRuntimeSaveState();
  const serialized = JSON.stringify(save);

  const reloaded = await loadWorld();
  reloaded.ctx.party.state.position = new Position(0, 0, level);
  reloaded.systems.monsters.loadPartyLevel(level);
  const reloadedData = reloaded.ctx.dungeon.getData();

  // What the old code produced: a fresh dungeon with the party pasted back in.
  const freshDoor = doorStateAt(reloaded, door.x, door.y, level);
  const freshAtOld = objectsAt(reloaded, carry.fromX, carry.fromY, level).includes(carry.rn);
  const freshAtNew = objectsAt(reloaded, carry.toX, carry.toY, level).includes(carry.rn);
  const freshMiscCount = reloadedData.databases.misc.records.length;
  const freshActuator = getActuatorValue(reloadedData.databases.actuators.records[0]);
  const freshCreatureHp = reloadedData.databases.creatures.records.find((r) => r.hp.length > 0)!.hp[0];
  const freshColumnIndex = [...reloadedData.columnIndex];
  const freshLone = objectsAt(reloaded, emptyCell.x, emptyCell.y, level).length > 0;
  const freshData = JSON.parse(json(reloadedData));
  const freshSerialized = JSON.stringify(reloaded.getRuntimeSaveState());

  reloaded.applyRuntimeSaveState(JSON.parse(serialized));

  const restoredDoor = doorStateAt(reloaded, door.x, door.y, level);
  const restoredAtOld = objectsAt(reloaded, carry.fromX, carry.fromY, level).includes(carry.rn);
  const restoredAtNew = objectsAt(reloaded, carry.toX, carry.toY, level).includes(carry.rn);
  const restoredMiscCount = reloadedData.databases.misc.records.length;
  const restoredActuator = getActuatorValue(reloadedData.databases.actuators.records[0]);
  const restoredCreatureHp = reloadedData.databases.creatures.records.find((r) => r.hp.length > 0)!.hp[0];
  const restoredDropped = objectsAt(reloaded, carry.toX, carry.toY, level).includes(droppedRn);
  const restoredDroppedType = reloadedData.databases.misc.records[miscCountBefore]?.miscType;
  const restoredLone = objectsAt(reloaded, emptyCell.x, emptyCell.y, level).includes(loneRn);
  const restoredProgram = reloadedData.dsaIndex?.entries[7]?.states[1]?.actions[0]?.program;

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
  row(
    `object at empty (${emptyCell.x},${emptyCell.y})`,
    false,
    true,
    freshLone,
    restoredLone,
  );
  row(
    'columnIndex differs from fresh',
    false,
    columnIndexMoved,
    false,
    reloadedData.columnIndex.some((v, i) => v !== freshColumnIndex[i]),
  );
  row(
    'CSBWin fields present',
    CSBWIN_FIELDS.filter((k) => k in freshData).length,
    CSBWIN_FIELDS.filter((k) => k in playedData).length,
    CSBWIN_FIELDS.filter((k) => k in freshData).length,
    CSBWIN_FIELDS.filter((k) => k in reloadedData).length,
  );
  console.log('');

  // ---- Assertions ---------------------------------------------------------

  // The vacuity guard first: if a fresh world already looked like the mutated one,
  // every assertion below would pass against the *old* save code too.
  check(freshDoor === 0, 'a fresh dungeon should have the test door closed');
  check(freshAtOld && !freshAtNew, 'a fresh dungeon should have the test object at its original cell');
  check(freshMiscCount === miscCountBefore, 'a fresh dungeon should not have the dropped record');
  check(freshActuator === actuatorBefore, 'a fresh dungeon should have the original actuator value');
  check(freshCreatureHp === creatureHpBefore, 'a fresh dungeon should have the original creature hit points');
  check(columnIndexMoved, 'dropping into an empty cell should have shifted the column index');

  check(doorOpened !== 0, 'the test door should have opened');
  check(restoredDoor === doorOpened, 'the restored door should be as open as it was saved');
  check(!restoredAtOld, 'the restored object should have left its original cell');
  check(restoredAtNew, 'the restored object should be at the cell it was moved to');
  check(
    !reloaded.ctx.dungeon.hasObjects(new Position(carry.fromX, carry.fromY, level)) ||
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
  check(restoredLone, 'the object dropped into an empty cell should be there after the load');
  check(CSBWIN_FIELDS.every((k) => !(k in freshData)), 'a fresh dungeon should have none of the fields a CSBWin load writes');
  // The walk below compares them whole; this pins the one typed array among them, since
  // a program that came back as a plain array would still run.
  check(
    restoredProgram instanceof Uint16Array && restoredProgram.join(',') === '1,43981,65535',
    'the DSA program should come back as the same Uint16Array',
  );

  // The whole-world check, over every field `DUNGEON_DATA_SOURCES` places. A field that
  // play changes and the table calls `loaded` shows up here even though no case above
  // names it, and so does a `snapshot` field the capture forgot.
  const walk: SourceWalk = { compared: { snapshot: 0, runtimeSave: 0, loaded: 0 }, unplaced: [], written: [], lost: [] };
  walkSources(SOURCES, playedData, freshData, reloadedData, '', walk);
  console.log(`fields compared: ${walk.compared.snapshot} snapshot, ${walk.compared.loaded} loaded ` +
    `(${walk.compared.runtimeSave} runtimeSave left to checks/save-roundtrip)\n`);
  const some = (paths: string[]): string => paths.slice(0, 6).join(', ') + (paths.length > 6 ? ', ...' : '');
  check(walk.unplaced.length === 0, `every field of the world should be placed in DUNGEON_DATA_SOURCES (${some(walk.unplaced)})`);
  check(walk.written.length === 0, `no loaded field should differ between the played, fresh and restored worlds (${some(walk.written)})`);
  check(walk.lost.length === 0, `every snapshot field should round-trip (${some(walk.lost)})`);
  // Pinned because it is what the first draft of this tool got wrong: `Database.count`
  // tracks `records.length` because every engine append maintains it, so the restore
  // recomputing it is equivalent — not a divergence.
  const countsTrackLength = (Object.keys(reloadedData.databases) as Array<keyof typeof reloadedData.databases>)
    .every((key) => reloadedData.databases[key].count === reloadedData.databases[key].records.length);
  check(countsTrackLength, 'every restored database count should equal its record count');

  // ---- Loading twice, with play in between --------------------------------
  //
  // The author's report was not only that a load came back wrong, but that "two loads
  // without save don't even always produce identical result". That is the same defect
  // seen from the other side: a restore that puts `objectList` back but leaves
  // `columnIndex` as play left it makes the result depend on what happened *between*
  // the two loads, so a load is not idempotent. Reproduce it exactly — load, play,
  // load again — and require the two loads to agree.
  const fingerprint = (data: DungeonData): string => json(withoutRuntimeSave(SOURCES, data));

  const afterFirstLoad = fingerprint(reloadedData);

  // Play: drop one more object into a cell that has none, which is what moves
  // `columnIndex` out from under the next load.
  let secondEmpty: { x: number; y: number } | null = null;
  for (let x = 0; x < width && !secondEmpty; x++) {
    for (let y = 0; y < height && !secondEmpty; y++) {
      if (roomTypeAt(reloaded, x, y, level) !== RoomType.OPEN) continue;
      if (reloaded.ctx.dungeon.hasObjects(new Position(x, y, level))) continue;
      secondEmpty = { x, y };
    }
  }
  check(secondEmpty !== null, 'there should be an empty open cell to play into between the two loads');
  if (secondEmpty) {
    const idx = reloadedData.databases.misc.records.length;
    reloadedData.databases.misc.records.push({
      nextObject: OBJECT_ID_EOF,
      specialState: 0,
      important: false,
      miscType: 35,
    });
    reloadedData.databases.misc.count++;
    reloadedData.header.objectCounts[DBType.MISC] = (reloadedData.header.objectCounts[DBType.MISC] + 1) & 0xffff;
    reloaded.ctx.dungeon.addObjectToCell(
      new Position(secondEmpty.x, secondEmpty.y, level),
      reloaded.ctx.dungeon.rnMaps.rn(DBType.MISC, idx),
    );
    check(
      fingerprint(reloadedData) !== afterFirstLoad,
      'the play between the two loads should actually have changed the world',
    );
  }

  reloaded.applyRuntimeSaveState(JSON.parse(serialized));
  check(
    fingerprint(reloadedData) === afterFirstLoad,
    'loading the same save twice, with play in between, should give the same world both times',
  );

  // ---- A save of a world that has none of the CSBWin fields ---------------
  //
  // Its snapshot says so, and the restore removes them. Otherwise quick-loading a game
  // begun on `dungeon.dat` after a CSBWin load would keep that save's DSA tables.
  reloaded.applyRuntimeSaveState(JSON.parse(freshSerialized));
  check(
    CSBWIN_FIELDS.every((k) => !(k in reloadedData)),
    `restoring a save of a world without the CSBWin fields should remove them (${CSBWIN_FIELDS.filter((k) => k in reloadedData).join(', ')})`,
  );

  finish();
}

main();
