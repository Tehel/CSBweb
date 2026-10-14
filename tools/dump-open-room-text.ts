/**
 * A text a timer shows on an open square (`ProcessTT_OPENROOM`,
 * `doc/CSBwin-src/Timer.cpp:1688-1829`).
 *
 * The timer sets, clears or toggles the text's `show` bit. When that shows a hidden text
 * on the party's own square, the text is decoded with `DecodeText(…, 1, 990)` and queued
 * with `QuePrintLines(15, text)` (`:1735-1743`). A `TT_DESSAGE` or a parameter message
 * leaves the texts alone (`:1715-1716`) and reaches no actuator but a DSA (`:1760-1761`).
 *
 * 1. Which hidden texts of `dm-atari/dungeon.dat` stand on an open square, and which
 *    actuators aim at those squares: the one on level 0 at (1, 4), "WELCOME BACK BRAVE
 *    ADVENTURERS.", is shown by the floor actuator under it.
 * 2. On that one: shown with the party there, queued once; shown again, nothing;
 *    hidden and toggled with the party away, nothing; a `TT_DESSAGE`, the bit unchanged.
 * 3. A generator on level 9 at (5, 12) makes a group for a `TT_OPENROOM`, none for a
 *    `TT_DESSAGE`.
 *
 * Run: `npm test -- --only=dump-open-room-text.ts`
 */

import { DBType, OBJECT_ID_EOF, Position, RoomType } from '../src/core/types';
import { ActuatorAction, getActuatorTargetX, getActuatorTargetY, getActuatorType, isActuatorLocalActionOnly } from '../src/data/actuatorHelpers';
import type { Game } from '../src/engine/Game';
import { TimerFunction } from '../src/engine/TimerQueue';
import { check, finish } from './lib/check';
import { newGame, stockGraphics, stockDungeon } from './lib/game';

const queued: Array<{ color: number; text: string }> = [];

function scene(): Game {
  const data = stockDungeon();
  return newGame(data, stockGraphics(), {
    messages: {
      printLinefeed: () => {},
      quePrintLines: (color, text) => { queued.push({ color, text }); },
      printLines: () => {},
      setNewSpeed: () => {},
      resetTime: () => {},
      clockTick: () => {},
      printNextQueued: () => {},
      vblInterrupt: () => {},
      discardText: () => {},
    },
  });
}

function fire(game: Game, at: Position, fn: number, action: number): void {
  game.ctx.timers.addTimer({
    index: 0, function: fn, time: game.ctx.state.tickCount, level: at.z,
    uByte5: 0, uByte6: at.x, uByte7: at.y, uByte8: 0, uByte9: action, sequence: 0,
    timerWord8: 0, timerWord6: 0,
  });
  game.systems.timer.processTimers();
}

console.log('1. Hidden texts on open squares');
const game = scene();
const dungeon = game.ctx.dungeon;
const hidden: Position[] = [];
for (let z = 0; z < dungeon.getData().maps.length; z++) {
  const map = dungeon.getMap(z)!;
  for (let x = 0; x < map.cellFlags.length; x++) {
    for (let y = 0; y < map.cellFlags[x]!.length; y++) {
      const p = new Position(x, y, z);
      if (((map.cellFlags[x]![y]! >> 5) & 7) === RoomType.STONE) continue;
      for (let rn = dungeon.findFirstObject(p); rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) {
        if (dungeon.rnMaps.dbType(rn) === DBType.TEXT && !dungeon.getTextRecord(rn)!.visible) hidden.push(p);
      }
    }
  }
}
for (const p of hidden) {
  const aimers: string[] = [];
  const map = dungeon.getMap(p.z)!;
  for (let x = 0; x < map.cellFlags.length; x++) {
    for (let y = 0; y < map.cellFlags[x]!.length; y++) {
      const q = new Position(x, y, p.z);
      for (let rn = dungeon.findFirstObject(q); rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) {
        if (dungeon.rnMaps.dbType(rn) !== DBType.ACTUATOR) continue;
        const rec = dungeon.getActuatorRecord(rn)!;
        if (getActuatorType(rec) === 0 || isActuatorLocalActionOnly(rec)) continue;
        if (getActuatorTargetX(rec) === p.x && getActuatorTargetY(rec) === p.y) aimers.push(`(${x},${y}) type ${getActuatorType(rec)}`);
      }
    }
  }
  console.log(`  L${p.z} (${p.x},${p.y}): aimed at by ${aimers.join(', ') || 'nothing'}`);
}
check(hidden[0]?.z === 0 && hidden[0].x === 1 && hidden[0].y === 4,
  'the first hidden text on an open square is on level 0 at (1, 4)');

console.log('2. Shown on the party\'s square');
const square = hidden[0]!;
const text = (): boolean => {
  for (let rn = dungeon.findFirstObject(square); rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) {
    if (dungeon.rnMaps.dbType(rn) === DBType.TEXT) return dungeon.getTextRecord(rn)!.visible;
  }
  throw new Error('no text');
};
game.ctx.party.state.position = new Position(square.x, square.y, square.z);
fire(game, square, TimerFunction.TT_DESSAGE, ActuatorAction.SET);
check(!text() && queued.length === 0, 'a TT_DESSAGE leaves the text hidden, and queues nothing');
fire(game, square, TimerFunction.TT_OPENROOM, ActuatorAction.SET);
for (const q of queued) console.log(`  queued (colour ${q.color}): ${JSON.stringify(q.text)}`);
check(text() && queued.length === 1 && queued[0]!.color === 15
  && queued[0]!.text === '\nWELCOME BACK BRAVE ADVENTURERS.',
  'a TT_OPENROOM that shows it queues it once, in colour 15, with its linefeed first');
fire(game, square, TimerFunction.TT_OPENROOM, ActuatorAction.SET);
check(queued.length === 1, 'showing it again queues nothing');
fire(game, square, TimerFunction.TT_OPENROOM, ActuatorAction.CLEAR);
game.ctx.party.state.position = new Position(square.x === 0 ? 1 : 0, square.y, square.z);
fire(game, square, TimerFunction.TT_OPENROOM, ActuatorAction.TOGGLE);
check(text() && queued.length === 1, 'shown with the party elsewhere, it is not queued');

console.log('3. A generator');
const generatorAt = new Position(5, 12, 9);
const groups = (g: Game): number => {
  let n = 0;
  for (let rn = g.ctx.dungeon.findFirstObject(generatorAt); rn !== OBJECT_ID_EOF; rn = g.ctx.dungeon.getDBRecordLink(rn)) {
    if (g.ctx.dungeon.rnMaps.dbType(rn) === DBType.CREATURE) n++;
  }
  return n;
};
for (const [fn, made] of [[TimerFunction.TT_DESSAGE, 0], [TimerFunction.TT_OPENROOM, 1]] as const) {
  const g = scene();
  g.ctx.party.state.position = new Position(1, 3, 3);
  g.systems.monsters.loadPartyLevel(3);
  const before = groups(g);
  fire(g, generatorAt, fn, ActuatorAction.SET);
  console.log(`  function ${fn}: groups ${before} -> ${groups(g)}`);
  check(groups(g) === before + made, `function ${fn} makes ${made} group`);
}

finish();
