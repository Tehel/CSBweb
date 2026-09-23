/**
 * `SetTimer`'s duplicate-timer rules: which timer survives a clash, with which function,
 * `uByte9` and slot.
 *
 * `GameTimers::SetTimer` (`doc/CSBwin-src/Timer.cpp:1011-1125`) mostly keeps the timer
 * already queued: a map timer (5-10) meeting a map timer at the same time, level and
 * square (and, for a `TT_STONEROOM`, `uByte8`) takes the new `uByte9` and is returned; a
 * `TT_1` meeting a `TT_DOOR` leaves it alone unless its `uByte9` is 2, which becomes
 * `1 - new.uByte9`; a `TT_1` meeting a `TT_1` takes the new `uByte9`. Only a map timer
 * meeting a `TT_1` deletes the old one — flipping the new `uByte9` from it when that is 2
 * — and queues the new. The port used to delete and requeue in every case.
 *
 * Needs no game files: it drives `TimerQueue` directly.
 *
 * Run: `npx tsx tools/dump-timer-dedupe.ts`
 */
import { TimerFunction, TimerQueue, type TimerEntry } from '../src/engine/TimerQueue';
import { check, finish } from './lib/check';

const T = 10;
const LEVEL = 1;
const X = 4;
const Y = 7;

function queue(fn: number, action: number, pos = 0, x = X, time = T): { q: TimerQueue; first: TimerEntry } {
  const q = new TimerQueue();
  q.createTimer(TimerFunction.TT_MISSILE, 0, 0, 0, 0, 99, 0); // a bystander in slot 0
  const first = q.createTimer(fn, x, Y, pos, action, time, LEVEL);
  return { q, first };
}

function describe(q: TimerQueue): string {
  return q.getTimers().map((t) => `[slot ${t.index} fn ${t.function} b9 ${t.uByte9}]`).join(' ');
}

function survivors(q: TimerQueue): TimerEntry[] {
  return q.getTimers().filter((t) => t.function !== TimerFunction.TT_MISSILE);
}

// 1. A map timer meets a map timer: the old one stays — its function, its slot — with the
// new uByte9, and SetTimer hands it back (Timer.cpp:1022-1036).
{
  const { q, first } = queue(TimerFunction.TT_PIT, 0);
  const got = q.createTimer(TimerFunction.TT_TELEPORTER, X, Y, 0, 1, T, LEVEL);
  const s = survivors(q);
  console.log(`1. map meets map: ${describe(q)}`);
  check(s.length === 1, `1: one map timer left (${s.length})`);
  check(s[0]?.function === TimerFunction.TT_PIT, `1: it is the old one's function (${s[0]?.function})`);
  check(s[0]?.index === first.index, `1: in the old one's slot (${s[0]?.index} vs ${first.index})`);
  check(s[0]?.uByte9 === 1, `1: with the new uByte9 (${s[0]?.uByte9})`);
  check(got === s[0], '1: SetTimer returns the old one');
}

// 1b. …but a TT_STONEROOM only clashes on the same uByte8, and another time never does.
{
  const { q } = queue(TimerFunction.TT_STONEROOM, 0, 1);
  q.createTimer(TimerFunction.TT_STONEROOM, X, Y, 2, 1, T, LEVEL);
  q.createTimer(TimerFunction.TT_STONEROOM, X, Y, 1, 1, T + 1, LEVEL);
  check(survivors(q).length === 3, `1b: other corners and other times coexist (${survivors(q).length})`);
}

// 2. A map timer meets a TT_1: the TT_1 goes, the new one is queued, and a new uByte9 of
// 2 is flipped from the old one's (Timer.cpp:1038-1051).
{
  const { q } = queue(TimerFunction.TT_DOOR_STEP, 1);
  q.createTimer(TimerFunction.TT_DOOR, X, Y, 0, 2, T, LEVEL);
  const s = survivors(q);
  console.log(`2. map meets TT_1: ${describe(q)}`);
  check(s.length === 1 && s[0]?.function === TimerFunction.TT_DOOR, `2: only the new TT_DOOR is left (${describe(q)})`);
  check(s[0]?.uByte9 === 0, `2: its uByte9 is 1 - 1 (${s[0]?.uByte9})`);
}

// 3. A TT_1 meets a TT_DOOR whose uByte9 is 2: the TT_DOOR stays, its uByte9 becomes
// 1 - new, and the TT_1 is dropped (Timer.cpp:1073-1085).
{
  const { q, first } = queue(TimerFunction.TT_DOOR, 2);
  const got = q.createTimer(TimerFunction.TT_DOOR_STEP, X, Y, 0, 1, T, LEVEL);
  const s = survivors(q);
  console.log(`3. TT_1 meets TT_DOOR(2): ${describe(q)}`);
  check(s.length === 1 && s[0]?.function === TimerFunction.TT_DOOR, `3: the TT_DOOR is kept, the TT_1 dropped (${describe(q)})`);
  check(s[0]?.index === first.index, `3: in its own slot (${s[0]?.index})`);
  check(s[0]?.uByte9 === 0, `3: its uByte9 is 1 - 1 (${s[0]?.uByte9})`);
  check(got === s[0], '3: SetTimer returns the TT_DOOR');
}

// 3b. …and a TT_DOOR whose uByte9 is not 2 is left exactly as it was.
{
  const { q } = queue(TimerFunction.TT_DOOR, 0);
  q.createTimer(TimerFunction.TT_DOOR_STEP, X, Y, 0, 1, T, LEVEL);
  const s = survivors(q);
  check(s.length === 1 && s[0]?.function === TimerFunction.TT_DOOR && s[0]?.uByte9 === 0,
    `3b: the TT_DOOR is unchanged and the TT_1 dropped (${describe(q)})`);
}

// 4. A TT_1 meets a TT_1: the old one takes the new uByte9 and stays (Timer.cpp:1087-1092).
{
  const { q, first } = queue(TimerFunction.TT_DOOR_STEP, 0);
  q.createTimer(TimerFunction.TT_DOOR_STEP, X, Y, 0, 1, T, LEVEL);
  const s = survivors(q);
  console.log(`4. TT_1 meets TT_1: ${describe(q)}`);
  check(s.length === 1 && s[0]?.index === first.index && s[0]?.uByte9 === 1,
    `4: one TT_1, in the old slot, with the new uByte9 (${describe(q)})`);
}

// 5. A different square is no clash at all.
{
  const { q } = queue(TimerFunction.TT_DOOR, 2, 0, X + 1);
  q.createTimer(TimerFunction.TT_DOOR_STEP, X, Y, 0, 1, T, LEVEL);
  check(survivors(q).length === 2, `5: another square does not clash (${describe(q)})`);
}

// 6. The sequence stamp is SetTimer's `m_timerSequence++` on the slot it inserts into
// (Timer.cpp:1189): a dropped duplicate consumes none, and a timer queued through
// addTimer — as MonsterSystem, MonsterAI and the DSA do — gets a fresh one.
{
  const { q } = queue(TimerFunction.TT_DOOR, 0);
  const before = q.getNextSequence();
  q.createTimer(TimerFunction.TT_DOOR_STEP, X, Y, 0, 1, T, LEVEL); // dropped: clashes with the TT_DOOR
  check(q.getNextSequence() === before, `6: a dropped duplicate consumes no sequence number (${before} -> ${q.getNextSequence()})`);
  const template = { ...q.getTimers()[0]!, index: -1, function: TimerFunction.TT_29, time: 50, sequence: 0 };
  const a = q.addTimer(template);
  const b = q.addTimer({ ...template, uByte6: 9 });
  check(a.sequence === before && b.sequence === before + 1,
    `6: addTimer stamps the next numbers (${a.sequence}, ${b.sequence}; expected ${before}, ${before + 1})`);
}

finish();
