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
 * Run: `npm test -- --only=timer-bytes.ts`
 */
import { readSaveFile } from '../../src/data/SaveFile';
import { buildSaveFile } from '../../src/engine/SaveGameFile';
import { TimerFunction } from '../../src/engine/TimerQueue';
import { stockGame } from '../lib/game';
import { check, finish } from '../lib/check';

const CD = 0xcd;

const hex = (bytes: readonly number[]): string => bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ');

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
  finish();
}

main();
