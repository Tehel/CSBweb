/**
 * The loop's one clock: VBLs, and a tick every `d.Speed` of them.
 *
 * - The VBL handler adds one to `d.vblCount` and raises `d.clockTick` once it has reached
 *   `d.Speed` (doc/CSBwin-src/CSBCode.cpp:1075-1087); the top of a tick zeroes the count
 *   (`:627`). `d.Speed` is 15 at `SPEED_NORMAL` (`CSBwin.cpp:181`), 0 while the party
 *   sleeps (`Mouse.cpp:1836`). So awake a tick comes every fifteenth VBL, asleep on every
 *   VBL, and `WakeUp`'s `d.clockTick = 1` (`CSBCode.cpp:7109`) brings one on at once.
 * - The handler runs on every VBL: frozen, the tick due waits (`:775`) and runs in the
 *   first pass after the thaw; held in a script's `VBLDelay`, the count goes on, and the
 *   pass the script held ticks in the VBL the script ends (`:757-775`).
 * - `_MainLoop` goes straight to `tag000698`, the top of a tick (`:596-611`): a started
 *   game ticks in its first VBL, and so does one restarted after the credits
 *   (`Game.resumeMainLoop`, `:11555-11562`) or read in play, which only the port has. The
 *   count starts from that tick.
 * - The page paces VBLs from the wall clock (`Game.gameLoop`): a call runs as many as the
 *   time since the last holds, up to a second's worth, so a timer held to one call a
 *   second, as a background tab's is, keeps the game at its pace, and a longer gap is not
 *   made up. The tool's games run on a clock it moves itself (`GameHost.clock`), so none
 *   of this waits on, or is upset by, the machine's load.
 *
 * Run: `npm test -- --only=vbl-clock.ts`
 */
import type { Game } from '../../src/engine/Game';
import { freeze, thaw, VBL_PER_TICK, type LoopScript } from '../../src/engine/LoopState';
import { wakeUp } from '../../src/engine/MouseSystem';
import { ManualClock } from '../lib/clock';
import { newGame, stockGraphics, stockDungeon } from '../lib/game';
import { check, finish } from '../lib/check';

function freshGame(clock = new ManualClock()): { game: Game; ticks: () => number; vbls: () => number } {
  const data = stockDungeon();
  const game = newGame(data, stockGraphics(), { clock });
  game.setRandomSeed(0x12345678);
  let ticks = 0;
  let vbls = 0;
  game.onTick(() => { ticks++; });
  game.onFrame(() => { vbls++; });
  return { game, ticks: () => ticks, vbls: () => vbls };
}

/** The VBLs, from 1, in which the next `count` VBLs ran a tick. */
function tickingVbls(game: Game, ticks: () => number, count: number): number[] {
  const at: number[] = [];
  for (let n = 1; n <= count; n++) {
    const before = ticks();
    game.runFrame();
    if (ticks() !== before) at.push(n);
  }
  return at;
}

function checkTheCount(): void {
  console.log('=== a tick every d.Speed VBLs (CSBCode.cpp:627, :1075-1087) ===');
  const { game, ticks } = freshGame();
  const awake = tickingVbls(game, ticks, 60);
  console.log(`awake, 60 VBLs from the start: ticks in VBLs ${awake.join(' ')}`);
  check(awake.join() === '15,30,45,60', `a tick on every ${VBL_PER_TICK}th VBL`);

  game.ctx.party.state.sleeping = true;
  const asleep = tickingVbls(game, ticks, 5);
  console.log(`asleep, 5 VBLs: ticks in VBLs ${asleep.join(' ')}`);
  check(asleep.join() === '1,2,3,4,5', 'asleep, d.Speed is 0: a tick on every VBL');

  game.runFrame();
  wakeUp(game.ctx);
  const woken = tickingVbls(game, ticks, 20);
  console.log(`woken: ticks in VBLs ${woken.join(' ')}`);
  check(woken.join() === '1,16', "WakeUp's d.clockTick = 1 ticks in the next pass, then every 15th VBL again");
}

function checkHeldTicks(): void {
  console.log('');
  console.log('=== the count runs on, frozen and in a script (CSBCode.cpp:775, :1147-1157) ===');
  const { game, ticks } = freshGame();
  tickingVbls(game, ticks, 15);
  freeze(game.ctx);
  const frozen = tickingVbls(game, ticks, 40);
  console.log(`frozen, 40 VBLs: ${frozen.length} ticks, d.vblCount ${game.ctx.loop.vblCount}, d.clockTick ${game.ctx.loop.clockTick}`);
  check(frozen.length === 0 && game.ctx.loop.vblCount === 40 && game.ctx.loop.clockTick,
    'frozen, the VBLs are counted, the tick falls due, and none runs');
  thaw(game.ctx);
  const thawed = tickingVbls(game, ticks, 16);
  console.log(`thawed: ticks in VBLs ${thawed.join(' ')}`);
  check(thawed.join() === '1,16', 'the due tick runs in the first pass after the thaw, and the count starts again');

  let resumed = 0;
  function* wait(): LoopScript {
    yield 30;
    resumed++;
  }
  game.runScript(wait());
  const held = tickingVbls(game, ticks, 30);
  console.log(`held in a 30-VBL VBLDelay: ticks in VBLs ${held.join(' ')}, d.vblCount ${game.ctx.loop.vblCount}, resumed ${resumed}`);
  check(held.join() === '30' && resumed === 1 && !game.isRunningScript() && game.ctx.loop.vblCount === 0,
    'the script holds the loop for its 30 VBLs, which are counted: the pass it held ticks in the last, as the script ends');
  const after = tickingVbls(game, ticks, 15);
  console.log(`after the script: ticks in VBLs ${after.join(' ')}`);
  check(after.join() === '15', 'and the count starts again from that tick');
}

function checkTheFirstTick(): void {
  console.log('');
  console.log('=== MainLoop opens with a tick (CSBCode.cpp:596-611) ===');
  const started = freshGame();
  started.game.start();
  started.game.stop();
  const first = tickingVbls(started.game, started.ticks, 20);
  console.log(`started: ticks in VBLs ${first.join(' ')}`);
  check(first.join() === '1,16', "a started game's first pass ticks, and the next tick is 15 VBLs on");

  const restarted = freshGame();
  tickingVbls(restarted.game, restarted.ticks, 22);
  restarted.game.resumeMainLoop();
  const again = tickingVbls(restarted.game, restarted.ticks, 20);
  console.log(`restarted 7 VBLs after a tick: ticks in VBLs ${again.join(' ')}`);
  check(again.join() === '1,16', 'MainLoop called again after the credits opens with a tick too');

  const read = freshGame();
  tickingVbls(read.game, read.ticks, 22);
  read.game.applyRuntimeSaveState(read.game.getRuntimeSaveState());
  const loaded = tickingVbls(read.game, read.ticks, 20);
  console.log(`a game read 7 VBLs after a tick: ticks in VBLs ${loaded.join(' ')}`);
  check(loaded.join() === '1,16', 'a game read in play ticks in the next pass, as the MainLoop that follows a read does');
}

function checkThePace(): void {
  console.log('');
  console.log('=== the page paces VBLs from the wall clock (Game.gameLoop) ===');
  const clock = new ManualClock();
  const { game, ticks, vbls } = freshGame(clock);
  /** `ms` on, whole milliseconds as `Date.now` gives them, then the timer's call: the VBLs and ticks it ran, and the delay it asked for next. */
  const call = (ms: number): { vbls: number; ticks: number; delay: number } => {
    const [v, t] = [vbls(), ticks()];
    clock.advance(ms);
    return { vbls: vbls() - v, ticks: ticks() - t, delay: clock.pending!.ms };
  };
  game.start();
  check(clock.pending !== null && vbls() === 0 && ticks() === 0, 'start runs no VBL, and asks for a call');

  const steady = [5, 30, 16, 17, 1, 40, 12, 20, 25, 2].map(call);
  const steadyVbls = steady.reduce((sum, c) => sum + c.vbls, 0);
  console.log(`calls 1..40 ms apart, 168 ms in all: VBLs ${steady.map((c) => c.vbls).join(' ')} (${steadyVbls})`);
  check(steadyVbls === 10, 'a timer that fires early or late runs the VBLs the time holds: 168 ms is 10');
  check(steady.every((c) => c.delay >= 0 && c.delay <= 1000 / 60), 'and asks to be called when the next one is due');

  const second = call(1000);
  console.log(`a call a second later (a background tab): ${second.vbls} VBLs, ${second.ticks} ticks`);
  check(second.vbls === 60 && second.ticks === 4, 'a call a second after the last runs 60 VBLs, 4 ticks');

  const gap = call(10_000);
  const next = call(17);
  console.log(`a call 10 s later: ${gap.vbls} VBLs; the next, a VBL on: ${next.vbls}`);
  check(gap.vbls === 60, 'a longer gap runs a second of VBLs, no more');
  check(next.vbls === 1, 'and the rest is not made up afterwards');

  game.stop();
  check(clock.pending === null, 'stop cancels the call');
}

checkTheCount();
checkHeldTicks();
checkTheFirstTick();
checkThePace();
finish();
