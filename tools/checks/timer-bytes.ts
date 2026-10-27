/**
 * Prove a timer the port makes is saved with CSBWin's bytes, the ones its maker leaves
 * included.
 *
 * CSBWin fills a new timer on the stack, whose constructor sets bytes 5 to 9 to 0xcd
 * (`doc/CSBwin-src/CSB.h:1868-1879`), sets the fields its maker uses, and copies it into
 * its slot (`SetTimer`, `Timer.cpp:1133`). So a byte a maker does not set is 0xcd in
 * CSBWin's save, and a 0 is there only where the maker writes one. Each case below is
 * one of the port's makers, run on a fresh game, the game saved with `buildSaveFile`
 * and the file read back, and the timer's bytes 5 to 9 held against those its CSBWin
 * maker leaves.
 *
 * And a timer that carries an object carries it in the bytes `timerObj6()` or
 * `timerObj8()` name (`doc/CSBwin-src/CSB.h:2083-2102`): a generator's waiting to come
 * back on, saved, holds its actuator in bytes 8-9, and a game reading the file gets the
 * object back on the timer.
 *
 * Run: `npm test -- --only=timer-bytes.ts`
 */
import { DBType, OBJECT_ID_EOF, Position, type ObjectID } from '../../src/core/types';
import { readSaveFile } from '../../src/data/SaveFile';
import { applyCsbwinSave } from '../../src/engine/CsbwinSaveGame';
import type { Game } from '../../src/engine/Game';
import { buildSaveFile } from '../../src/engine/SaveGameFile';
import { TimerFunction } from '../../src/engine/TimerQueue';
import { stockGame } from '../lib/game';
import { check, finish } from '../lib/check';

const CD = 0xcd;

const hex = (bytes: readonly number[]): string => bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ');

/** The first actuator on the party's level, and its square. */
function firstActuator(game: Game): { rn: ObjectID; at: Position } | null {
  const dungeon = game.ctx.dungeon;
  const z = game.ctx.party.state.position.z;
  const map = dungeon.getMap(z);
  if (!map) return null;
  for (let x = 0; x < map.descriptor.width; x++) {
    for (let y = 0; y < map.descriptor.height; y++) {
      const at = new Position(x, y, z);
      for (let rn = dungeon.findFirstObject(at); rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) {
        if (dungeon.rnMaps.dbType(rn) === DBType.ACTUATOR) return { rn, at };
      }
    }
  }
  return null;
}

function main(): void {
  const game = stockGame();
  const ctx = game.ctx;
  const level = ctx.party.state.position.z;
  const soundByte4 = ctx.sounds['sound1772'][1]?.byte4;

  const cases: Array<{ name: string; fn: number; make: () => void; bytes: number[] }> = [
    {
      // `PoisonCharacter`: the champion, `timerWord6`, and bytes 8-9 left
      // (`doc/CSBwin-src/CSBCode.cpp:7287-7294`).
      name: 'TT_75, poison', fn: TimerFunction.TT_75,
      make: () => game.systems.timer.schedulePoison(2, 0x0105, level),
      bytes: [2, 0x01, 0x05, CD, CD],
    },
    {
      // The Ya potion: the champion and `timerUWord6()` (`Character.cpp:4401-4408`).
      name: 'TT_72, a champion\'s shield', fn: TimerFunction.TT_72,
      make: () => game.systems.timer.scheduleChampionShieldExpiry(1, 7, 100, level),
      bytes: [1, 0, 7, CD, CD],
    },
    {
      // `SetBrightnessTimer`: `timerWord6()` and byte 5 (`Magic.cpp:833-841`).
      name: 'TT_LIGHT', fn: TimerFunction.TT_LIGHT,
      make: () => game.systems.timer.queueBrightnessTimer(-3, ctx.state.tickCount + 10),
      bytes: [0, 0xff, 0xfd, CD, CD],
    },
    {
      // See through walls: byte 5 alone (`Magic.cpp:1290`, `:1315`).
      name: 'TT_73, see through walls', fn: TimerFunction.TT_73,
      make: () => game.systems.magic.queueUtilityTimer(TimerFunction.TT_73, 50),
      bytes: [0, CD, CD, CD, CD],
    },
    {
      // The spell shield: byte 5 and `timerWord6()` (`Attack.cpp:1211-1233`).
      name: 'TT_77, the spell shield', fn: TimerFunction.TT_77,
      make: () => game.systems.magic.queueUtilityTimer(TimerFunction.TT_77, 60, 4),
      bytes: [0, 0, 4, CD, CD],
    },
    {
      // A delayed sound: the entry's `byte4`, `timerWord8()` and the square
      // (`CSBCode.cpp:1868-1874`).
      name: 'TT_20, a delayed sound', fn: TimerFunction.TT_20,
      make: () => ctx.sounds.queueSound(1, 3, 4, 3, level),
      bytes: [soundByte4 ?? -1, 3, 4, 0, 1],
    },
  ];

  for (const c of cases) c.make();
  const save = readSaveFile(buildSaveFile(game));
  console.log(['timer', 'bytes 5-9', 'CSBWin'].join('\t'));
  for (const c of cases) {
    const index = save.timerQueue.find((i) => save.timers[i]?.function === c.fn);
    const t = index === undefined ? undefined : save.timers[index];
    if (!t) { check(false, `${c.name}: the save holds the timer`); continue; }
    const got = [t.uByte5, t.uByte6, t.uByte7, t.uByte8, t.uByte9];
    console.log([c.name, hex(got), hex(c.bytes)].join('\t'));
    check(hex(got) === hex(c.bytes), `${c.name}: bytes 5-9 are CSBWin's (${hex(got)} vs ${hex(c.bytes)})`);
  }

  /* ---- an object across a save ---- */

  const generator = stockGame();
  const found = firstActuator(generator);
  if (!found) {
    check(false, 'the party\'s level has an actuator');
  } else {
    // As `ProcessTT_ReactivateGenerator`'s caller makes it (`Timer.cpp:1814-1822`).
    generator.ctx.timers.createTimer({
      function: TimerFunction.TT_REACTIVATE_GENERATOR, uByte5: 0, uByte6: found.at.x, uByte7: found.at.y,
      time: generator.ctx.state.tickCount + 50, level: found.at.z, object: found.rn,
    });
    const file = buildSaveFile(generator);
    const saved = readSaveFile(file);
    const slot = saved.timerQueue.find((i) => saved.timers[i]?.function === TimerFunction.TT_REACTIVATE_GENERATOR);
    const t = slot === undefined ? undefined : saved.timers[slot];
    const word8 = t === undefined ? -1 : (t.uByte8 << 8) | t.uByte9;
    const next = stockGame();
    applyCsbwinSave(next, file);
    const back = next.ctx.timers.getTimers().find((e) => e.function === TimerFunction.TT_REACTIVATE_GENERATOR);
    console.log(`\nTT_REACTIVATE_GENERATOR on actuator ${found.rn.toString(16)}: bytes 8-9 ${word8.toString(16)}, read back ${back?.object?.toString(16)}`);
    check(word8 === found.rn, "the file's generator timer holds its actuator in bytes 8-9");
    check(back?.object === found.rn, 'and the game reading the file has it on the timer');
  }
  finish();
}

main();
