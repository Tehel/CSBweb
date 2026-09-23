/**
 * `&DEL` in a DSA defers its deletes to the end of the run (`doc/CSBwin-src/DSA.cpp`).
 *
 *  1. `EX_DEL` does not free anything: `DSADBANK::DeleteObject` (`:157-163`) pushes the
 *     record on `m_objectDeleteList` through its own link, so the record is still
 *     allocated for the rest of the run. The port called `deleteDBEntry` at once.
 *  2. `ConsumateDeletes` (`:178-191`), after `PutState` (`:5483`), frees the lot and
 *     reports whether the DSA's own actuator was among it; `ProcessDSATimer6` returns
 *     that (`:5486`), and the timer walks that ran it stop walking the cell's chain
 *     (`Timer.cpp:1433`, `:1757`, `:2230`). The port always returned false.
 *  3. A scroll takes its text with it, the text condemned first (`DSA.cpp:1715-1722`).
 *
 * No dungeon this project loads defines a DSA, so the tool builds one: a single state
 * whose column-0 program is `LOAD objId, LOAD location, &DEL`.
 *
 * Run: `npx tsx tools/dump-dsa-delete.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  DBType, encodeObjectID, locationRelToInteger, OBJECT_ID_EOF, OBJECT_ID_NULL, Position, RoomType, type ObjectID,
} from '../src/core/types';
import type { DungeonData } from '../src/data/dungeonTypes';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { Game } from '../src/engine/Game';
import type { TimerEntry } from '../src/engine/TimerQueue';
import { extractObjectTables } from '../src/renderer/csbwin/ObjectTables';
import { extractUITables } from '../src/renderer/csbwin/UITables';
import { extractViewportTables } from '../src/renderer/csbwin/ViewportTables';
import { check, finish } from './lib/check';

const OP_LOAD = 6;
const OP_AMPERSAND = 11;
const LOAD_U16 = 27;
const LOAD_U32 = 30;
const STK_DEL = 9;

/** `LOAD objId, LOAD location, &DEL` — delete `objId` from the square at `location`. */
function delProgram(objId: number, location: number): Uint16Array {
  return Uint16Array.from([
    OP_LOAD | (LOAD_U16 << 6), objId & 0xffff,
    OP_LOAD | (LOAD_U32 << 6), location & 0xffff, (location >>> 16) & 0xffff,
    OP_AMPERSAND | (STK_DEL << 6),
  ]);
}

async function main(): Promise<void> {
  const graphics = new GraphicsLoader();
  graphics.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/graphics.dat'))));
  const viewportTables = extractViewportTables(graphics);
  const objectTables = extractObjectTables(graphics, viewportTables.wallRectanglesOffset);
  const uiTables = extractUITables(graphics);

  const makeGame = async (): Promise<Game> => {
    const loader = new DungeonLoader();
    await loader.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/dungeon.dat'))));
    const data = loader.getData();
    if (!data) throw new Error('dungeon.dat did not load');
    const game = new Game(
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
        monsterAttackSounds: objectTables.monsterAttackSounds,
        uByte590: uiTables.graphic232.uByte590,
        byte586: uiTables.graphic232.byte586,
        clothingArmour: objectTables.clothingArmour,
        clothingFlags: objectTables.clothingFlags,
        byte1412: uiTables.graphic232.byte1412,
      experienceForAttacking: uiTables.graphic230.experienceForAttacking,
      skillNumber: uiTables.graphic230.skillNumber,
      byte20046: uiTables.graphic230.byte20046,
      byte20002: uiTables.graphic230.byte20002,
      byte19958: uiTables.graphic230.byte19958,
      byte19914: uiTables.graphic230.byte19914,
      byte20090: uiTables.graphic230.byte20090,
      attackNames: uiTables.graphic230.attackNames,
      },
    );
    // Fixed seed, so the numbers below repeat run to run. This used to sit *after* a
    // `return new Game(...)` — dead code, so every run of this tool was unseeded
    // despite the comment. `tsc` never saw it because `tools/` was outside the
    // type gate; it is inside it now.
    game.setRandomSeed(0x12345678);
    return game;
  };

  /** An empty open square on the start level that is not the start square. */
  const emptySquare = (game: Game): Position => {
    const dungeon = game.dungeonState;
    const start = dungeon.getStartPosition();
    const map = dungeon.getMap(start.z);
    if (!map) throw new Error('no start level');
    for (let x = 0; x < map.descriptor.width; x++) {
      for (let y = 0; y < map.descriptor.height; y++) {
        const p = new Position(x, y, start.z);
        if (x === start.x && y === start.y) continue;
        if (((dungeon.getCellFlag(p) >> 5) & 7) !== RoomType.OPEN) continue;
        if (dungeon.findFirstObject(p) !== OBJECT_ID_EOF) continue;
        return p;
      }
    }
    throw new Error('no empty open square');
  };

  /** A new type-47 actuator whose DSA is `selector`, in corner 0 of `at`. */
  const addDsaActuator = (game: Game, at: Position, selector: number): ObjectID => {
    const data: DungeonData = game.dungeonState.getData();
    data.databases.actuators.records.push({ nextObject: OBJECT_ID_EOF, word2: 47 | (selector << 7), word4: 0, word6: 0 });
    const rn = encodeObjectID(0, DBType.ACTUATOR, data.databases.actuators.records.length - 1) as ObjectID;
    game.dungeonState.addObjectToCell(at, rn);
    return rn;
  };

  /** A copy of weapon 0, in corner 1 of `at`. */
  const addWeapon = (game: Game, at: Position): ObjectID => {
    const data: DungeonData = game.dungeonState.getData();
    data.databases.weapons.records.push({ ...data.databases.weapons.records[0], nextObject: OBJECT_ID_EOF });
    const rn = encodeObjectID(1, DBType.WEAPON, data.databases.weapons.records.length - 1) as ObjectID;
    game.dungeonState.addObjectToCell(at, rn);
    return rn;
  };

  /** Install DSA 0 on `at`'s level, selector 0, running `programs` in turn as one state. */
  const installDsa = (game: Game, at: Position, program: Uint16Array): void => {
    const data: DungeonData = game.dungeonState.getData();
    data.dsaIndex = { entries: [{
      description: 'test', state: 0, localState: 1, groupId: 0, numStates: 1, firstDisplayedState: 0,
      states: [{ actions: [{ column: 0, program }] }],
    }] };
    data.dsaLevelIndex = [];
    data.dsaLevelIndex[at.z] = [0];
  };

  const link = (game: Game, rn: ObjectID): number => game.dungeonState.getDBRecordLink(rn);
  const inCell = (game: Game, at: Position): ObjectID[] => {
    const out: ObjectID[] = [];
    for (let rn = game.dungeonState.findFirstObject(at); rn !== OBJECT_ID_EOF; rn = game.dungeonState.getDBRecordLink(rn)) out.push(rn);
    return out;
  };

  /**
   * Run the actuator's DSA as `ProcessDSATimer5` would, recording each condemned
   * record's link as `&DEL` leaves it — still inside the run.
   */
  const run = (game: Game, slave: ObjectID, at: Position, watch: ObjectID[]): { result: boolean; midRun: number[] } => {
    const dsa = (game as any).dsaSystem;
    const midRun: number[] = [];
    const original = dsa.executeAmpersand.bind(dsa);
    dsa.executeAmpersand = (subcode: number, bank: unknown): void => {
      original(subcode, bank);
      if (subcode === STK_DEL) for (const rn of watch) midRun.push(link(game, rn));
    };
    const timer = { uByte5: 0, uByte6: at.x, uByte7: at.y, uByte8: 0, uByte9: 0, level: at.z, time: 0 } as TimerEntry;
    const result = dsa.processTimer5(slave, timer, at);
    dsa.executeAmpersand = original;
    return { result, midRun };
  };

  /* --------------------------------------- 1-2. a DSA deletes a weapon ---------- */
  {
    const game = await makeGame();
    const at = emptySquare(game);
    const slave = addDsaActuator(game, at, 0);
    const weapon = addWeapon(game, at);
    const loc = locationRelToInteger({ l: at.z, x: at.x, y: at.y, p: 0 });
    installDsa(game, at, delProgram(weapon, loc));
    const { result, midRun } = run(game, slave, at, [weapon]);
    console.log(`1. delete weapon ${weapon.toString(16)}: returned ${result}, link during the run ${midRun.map((v) => v.toString(16)).join(',')}, `
      + `after ${link(game, weapon).toString(16)}; cell now ${inCell(game, at).map((v) => v.toString(16)).join(',')}`);
    check(midRun.length === 1 && midRun[0] !== OBJECT_ID_NULL, '&DEL leaves the record allocated until the run ends (DeleteObject only chains it)');
    check(link(game, weapon) === OBJECT_ID_NULL, 'ConsumateDeletes frees it after the run');
    check(inCell(game, at).length === 1 && inCell(game, at)[0] === slave, 'the weapon is gone from the square and the actuator stays');
    check(result === false, 'a DSA that did not delete its own actuator returns false');
  }

  /* --------------------------------------- 2. a DSA deletes itself -------------- */
  {
    const game = await makeGame();
    const at = emptySquare(game);
    const slave = addDsaActuator(game, at, 0);
    const loc = locationRelToInteger({ l: at.z, x: at.x, y: at.y, p: 0 });
    installDsa(game, at, delProgram(slave, loc));
    const { result, midRun } = run(game, slave, at, [slave]);
    console.log(`2. the DSA deletes its own actuator ${slave.toString(16)}: returned ${result}, link during the run ${midRun.map((v) => v.toString(16)).join(',')}, after ${link(game, slave).toString(16)}`);
    check(result === true, 'ProcessDSATimer6 returns deletedSlave, so the timer walk stops');
    check(midRun.length === 1 && midRun[0] !== OBJECT_ID_NULL, 'the slave is still allocated while its own program runs');
    check(link(game, slave) === OBJECT_ID_NULL, 'and freed once it has finished');
  }

  /* --------------------------------------- 3. two deletes in one run ------------ */
  {
    const game = await makeGame();
    const at = emptySquare(game);
    const slave = addDsaActuator(game, at, 0);
    const w1 = addWeapon(game, at);
    const w2 = addWeapon(game, at);
    const loc = locationRelToInteger({ l: at.z, x: at.x, y: at.y, p: 0 });
    const p1 = delProgram(w1, loc);
    const p2 = delProgram(w2, loc);
    const both = new Uint16Array(p1.length + p2.length);
    both.set(p1);
    both.set(p2, p1.length);
    installDsa(game, at, both);
    const { midRun } = run(game, slave, at, [w1, w2]);
    console.log(`3. two deletes: [w1, w2] links after each &DEL ${midRun.map((v) => v.toString(16)).join(',')}; after the run ${link(game, w1).toString(16)}, ${link(game, w2).toString(16)}`);
    check(midRun.length === 4 && midRun[2] === OBJECT_ID_EOF && midRun[3] === w1,
      'the delete list runs through the records\' links: w2 -> w1 -> RNeof');
    check(link(game, w1) === OBJECT_ID_NULL && link(game, w2) === OBJECT_ID_NULL, 'both are freed after the run');
  }

  finish();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
