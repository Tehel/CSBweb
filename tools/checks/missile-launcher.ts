/**
 * A wall's spell launcher gives its missiles the step energy it holds, CSB 2.1's
 * `CHANGE8_01` (`doc/ReDMCSB-src/TIMELINE.C:1122-1130`): `Local.Multiple >> 8`, bits 12-15
 * of `word6` (`M048_STEP_ENERGY`, `DEFS.H:1304`), where every DM release and CSB 2.0 pass
 * 0, ReDMCSB's `BUG0_21`, and so does CSBWin (`doc/CSBwin-src/Timer.cpp:1993`, `:2005`).
 * The port plays 2.1's on every set (`DEBT.md` H).
 *
 * Each launcher of type 8 or 10 of Chaos Strikes Back's game (the `csb` set's
 * `csbgame2.dat`) that holds a step energy is fired by a `TT_STONEROOM` at its corner, as an actuator's target fires it,
 * and its missiles are read: their range is the kinetic energy, and their timer's decay
 * the step energy. Then the clock runs until the first missile moves, and unless it
 * struck something at once (one launcher's square has a monster in front), its range has
 * lost that much.
 *
 * Run: `npm test -- --only=missile-launcher.ts`
 */
import { readFileSync } from 'node:fs';

import { DBType, OBJECT_ID_EOF, Position, type ObjectID } from '../../src/core/types';
import { getActuatorType } from '../../src/data/actuatorHelpers';
import type { Game } from '../../src/engine/Game';
import { TimerFunction } from '../../src/engine/TimerQueue';
import { decodeMissileTimerWord8 } from '../../src/engine/missileHelpers';
import { freshGame } from '../lib/dsa';
import { check, finish } from '../lib/check';

interface Launcher { at: Position; corner: number; type: number; kinetic: number; step: number }

function launchersWithAStep(game: Game): Launcher[] {
  const dungeon = game.ctx.dungeon;
  const out: Launcher[] = [];
  for (let z = 0, map = dungeon.getMap(0); map; map = dungeon.getMap(++z)) {
    for (let x = 0; x < map.descriptor.width; x++) {
      for (let y = 0; y < map.descriptor.height; y++) {
        const at = new Position(x, y, z);
        if ((dungeon.getCellFlag(at) >> 5) !== 0) continue;
        for (let rn = dungeon.findFirstObject(at); rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) {
          if (dungeon.rnMaps.dbType(rn) !== DBType.ACTUATOR) continue;
          const rec = dungeon.getActuatorRecord(rn)!;
          const type = getActuatorType(rec);
          const step = (rec.word6 >> 12) & 0xf;
          if ((type === 8 || type === 10) && step !== 0) {
            out.push({ at, corner: dungeon.rnMaps.pos(rn), type, kinetic: (rec.word6 >> 4) & 0xff, step });
          }
        }
      }
    }
  }
  return out;
}

function missilesAt(game: Game, at: Position): ObjectID[] {
  const dungeon = game.ctx.dungeon;
  const out: ObjectID[] = [];
  for (let rn = dungeon.findFirstObject(at); rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) {
    if (dungeon.rnMaps.dbType(rn) === DBType.MISSILE) out.push(rn);
  }
  return out;
}

const CSB = new Uint8Array(readFileSync('tools/fixtures/gamefiles/csb/csbgame2.dat'));
const launchers = launchersWithAStep(freshGame(CSB));
console.log(`csbgame2.dat: ${launchers.length} spell launchers with a step energy`);
check(launchers.length > 0, 'the save holds a spell launcher with a step energy');

for (const launcher of launchers) {
  const game = freshGame(CSB);
  const { at, corner } = launcher;
  const front = new Position(at.x + game.ctx.tables.deltaX[corner]!, at.y + game.ctx.tables.deltaY[corner]!, at.z);
  const before = new Set(missilesAt(game, front));
  game.ctx.timers.createTimer({
    function: TimerFunction.TT_STONEROOM, time: game.ctx.state.tickCount, level: at.z,
    uByte6: at.x, uByte7: at.y, uByte8: corner, uByte9: 0,
  });
  game.gameTick();
  const read = missilesAt(game, front).filter((rn) => !before.has(rn)).map((rn) => {
    const missile = game.ctx.dungeon.getMissileRecord(rn)!;
    const timer = game.ctx.timers.getTimer(missile.timerIndex)!;
    return { rn, range: missile.rangeRemaining, decay: decodeMissileTimerWord8(timer.timerWord8).deltaEnergy };
  });
  const name = `type ${launcher.type} at ${at.z}(${at.x},${at.y}) corner ${corner}, kinetic ${launcher.kinetic}, step ${launcher.step}`;
  console.log(`  ${name}: ${read.map((m) => `range ${m.range} decay ${m.decay}`).join('; ') || 'nothing launched'}`);
  const count = launcher.type === 10 ? 2 : 1;
  check(read.length === count, `${name}: launches ${count === 2 ? 'two missiles' : 'one missile'}`);
  check(read.every((m) => m.range === launcher.kinetic), `${name}: its missiles' range is its kinetic energy`);
  check(read.every((m) => m.decay === launcher.step), `${name}: their timers' decay is its step energy`);

  const first = read[0];
  if (!first) continue;
  const missile = game.ctx.dungeon.getMissileRecord(first.rn)!;
  const flying = (): Position | null => {
    const timer = game.ctx.timers.getTimer(missile.timerIndex);
    if (!timer || timer.object !== first.rn) return null;
    const { x, y } = decodeMissileTimerWord8(timer.timerWord8);
    const square = new Position(x, y, timer.level);
    return missilesAt(game, square).includes(first.rn) ? square : null;
  };
  for (let i = 0; i < 4 && flying() !== null && missile.rangeRemaining === first.range; i++) game.gameTick();
  const square = flying();
  if (square === null) {
    console.log('    it struck something on its first move');
    continue;
  }
  console.log(`    after its first move: range ${missile.rangeRemaining}, at ${square.z}(${square.x},${square.y})`);
  check(missile.rangeRemaining === first.range - launcher.step, `${name}: a move costs its missile the step energy`);
}

finish();
