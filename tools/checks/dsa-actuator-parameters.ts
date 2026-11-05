/**
 * A DSA actuator's parameters A and B, whose bits 16-17 are in the big actuator's `word8`.
 * `DB3::swap` turns `word2`, `word4` and `word6` into the host's order but leaves `word8`
 * as the file has it (`doc/CSBwin-src/data.cpp:1321-1327`), so the little-endian CSBWin
 * reads its two bytes swapped, and `DB3::ParameterA`/`ParameterB` take their bits from
 * that (`:1338-1358`). The record keeps the file's word read big-endian (`csbwinWord8`).
 *
 * 1. **Conflux's wave DSA at 3(7,26)** (`conflux-3.5`'s `dungeon.dat`, as in the run of
 *    `DEBT.md` F24 "Conflux's partial game"): an actuator of `word4` 0x0d9b and `word8`
 *    0x2300 holds 0x30d9b in parameter A, 3(12,27) corner 3, the square its messages go
 *    to; read big-endian, corner 0, which parted the port from the run at line 125.
 * 2. **`LOAD` and `STORE` of A and B** (`EX_LOAD`, `doc/CSBwin-src/DSA.cpp:1150-1185`,
 *    `EX_STORE`, `:1318-1387`), through the DSA machine at the engine's level, and at
 *    level 5, before it, where `actuatorWord8BigEndian` reads the word as it is. A store
 *    keeps the other bits of `word8`.
 *
 * Run: `npm test -- --only=dsa-actuator-parameters.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DBType, OBJECT_ID_EOF, Position, locationRelFromInteger } from '../../src/core/types';
import { DungeonLoader } from '../../src/data/DungeonLoader';
import { csbwinWord8, getActuatorParameterA, getActuatorParameterB, getActuatorType } from '../../src/data/actuatorHelpers';
import type { ActuatorRecord } from '../../src/data/dungeonTypes';
import { behaviourAt } from '../../src/engine/Behaviour';
import { DungeonState, NO_GAME } from '../../src/engine/DungeonState';
import { globalStore, int, run } from '../lib/dsa';
import { check, finish } from '../lib/check';

/** `DSACMD_LOAD` and `DSACMD_STORE` (`DsaMachine.ts`'s `DsaCommand`), `where` in bits 6-10: 0 is A, 1 is B. */
const LOAD = 6;
const STORE = 13;
const hex = (n: number): string => `0x${n.toString(16)}`;

/* ------------------------------- 1. Conflux's wave DSA ------------------------- */
{
  const data = new DungeonLoader().loadDungeonDat(
    new Uint8Array(readFileSync(resolve('tools/fixtures/gamefiles/conflux-3.5-b8/dungeon.dat'))));
  const dungeon = new DungeonState(data, NO_GAME);
  const records: ActuatorRecord[] = [];
  for (let rn = dungeon.findFirstObject(new Position(7, 26, 3)); rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) {
    if (dungeon.rnMaps.dbType(rn) !== DBType.ACTUATOR) continue;
    const rec = dungeon.getActuatorRecord(rn);
    if (rec && getActuatorType(rec) === 47 && rec.word4 === 0x0d9b) records.push(rec);
  }
  const rec = records[0];
  check(records.length === 1 && rec !== undefined, "3(7,26) holds one DSA actuator of word4 0x0d9b");
  if (rec) {
    const a = getActuatorParameterA(rec);
    const at = locationRelFromInteger(a);
    console.log(`1. 3(7,26)'s actuator: word8 ${hex(rec.word8 ?? 0)}, CSBWin's ${hex(csbwinWord8(rec.word8 ?? 0))}; `
      + `parameter A ${hex(a)}, ${at.l}(${at.x},${at.y}) corner ${at.p}; read big-endian ${hex(getActuatorParameterA(rec, true))}`);
    check(rec.word8 === 0x2300, "the record keeps the file's word8 read big-endian, 0x2300");
    check(a === 0x30d9b && at.l === 3 && at.x === 12 && at.y === 27 && at.p === 3,
      'parameter A is 0x30d9b, 3(12,27) corner 3, from CSBWin\'s word8 0x0023');
    check(getActuatorParameterA(rec, true) === 0x0d9b, 'read big-endian, it was 0x0d9b, corner 0');
  }
  const dsas = data.databases.actuators.records.filter((r) => getActuatorType(r) === 47);
  const parted = dsas.filter((r) => getActuatorParameterA(r) !== getActuatorParameterA(r, true)
    || getActuatorParameterB(r) !== getActuatorParameterB(r, true));
  console.log(`   of Conflux's ${dsas.length} DSA actuators, ${parted.length} have a parameter the two readings part on`);
  check(parted.length > 0, 'the readings part on more than the one actuator');
}

/* ------------------------------- 2. LOAD and STORE ------------------------------ */
{
  // CSBWin's word8 0x0027: A's bits 3, B's 1, and bit 5 for the store to keep.
  const program = [
    LOAD, globalStore(0), LOAD | (1 << 6), globalStore(1),
    ...int(0x2abcd), STORE, ...int(0x1ffff), STORE | (1 << 6),
  ];
  const at = (level: number | null): { g: number[]; rec: ActuatorRecord } => {
    const { game, again } = run([]);
    const records = game.ctx.dungeon.getData().databases.actuators.records;
    const rec = records[records.length - 1]!;
    Object.assign(rec, { word4: 0x0d9b, word6: 0x03e7, word8: 0x2700 });
    if (level !== null) game.ctx.behaviour = behaviourAt(level);
    const dsa = game.ctx.dungeon.getData().dsaIndex!.entries[0]!;
    dsa.states[0]!.actions[0]!.program = Uint16Array.from(program);
    return { g: again(), rec };
  };
  const now = at(null);
  console.log(`2. word8 0x2700: A ${hex(now.g[0]!)}, B ${hex(now.g[1]!)}; after storing 0x2abcd and 0x1ffff, `
    + `word4 ${hex(now.rec.word4)} word6 ${hex(now.rec.word6)} word8 ${hex(now.rec.word8 ?? 0)}`);
  check(now.g[0] === 0x30d9b && now.g[1] === 0x103e7, "A and B take their bits from CSBWin's word8, 0x0027");
  check(now.rec.word4 === 0xabcd && now.rec.word6 === 0xffff && now.rec.word8 === 0x2600,
    "the stores write CSBWin's word8 0x0026, its bit 5 kept, which the file holds as 0x2600");
  const old = at(5);
  console.log(`   at level 5: A ${hex(old.g[0]!)}, B ${hex(old.g[1]!)}; word8 after the stores ${hex(old.rec.word8 ?? 0)}`);
  check(old.g[0] === 0x0d9b && old.g[1] === 0x03e7 && old.rec.word8 === 0x2706,
    'level 5 reads and writes the word as it stands (actuatorWord8BigEndian)');
}

finish();
