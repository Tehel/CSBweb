/**
 * The sound filter, `SoundFilter` (`doc/CSBwin-src/Sound.cpp:675-761`), which `QueueSound`
 * calls once it has chosen the volume (`doc/CSBwin-src/CSBCode.cpp:1906`), run through
 * `SoundQueue.queueSound` with two DSAs on its square, against a genuine save
 * (`csbgame7.dat`).
 *
 * 1. **A dungeon with no filter plays the sound** (`SoundFilter` returns 1).
 * 2. **Every DSA at the location runs**, the second after the first, a filter call apiece
 *    (`Sound.cpp:710-752`), and the sound is theirs: nothing plays (`QueueSound` returns at `CSBCode.cpp:1906`).
 * 3. **The nine parameters** (`Sound.cpp:735-744`): the ordinal plus 1, the volume, the squared
 *    distance, the sound's level, x and y, `gameVolume` and `NoSound` (CSBWin's defaults,
 *    0 and 0), and the distance in hundredths, three integer Newton steps from
 *    `100 * max(dx, dy)`: 141 for a step of (1, 1), 500 for (3, 4), 0 on the party's square.
 * 4. **A sound out of earshot reaches the filter too**, with volume -1 (`CSBCode.cpp:1905-1907`).
 * 5. **A DSA plays the sound if it pleases**, with `&SOUND` (`PlayCustomSound`,
 *    `Sound.cpp:1048-1071`).
 * 6. **A sound queued while the DSAs run plays on** (`filterActive`, `:677-681`): the
 *    filter does not run for it.
 *
 * Run: `npm test -- --only=dump-sound-filter.ts`
 */
import { StkOp } from '../src/engine/dsa/DsaTypes';
import type { Game } from '../src/engine/Game';
import { UNSET, freshGame, globalStore, int, op, varFetch, withFilterDsas } from './lib/dsa';
import { check, finish } from './lib/check';

/** `ESL_SOUNDFILTER` (`doc/CSBwin-src/CSB.h:1546`). */
const ESL_SOUNDFILTER = 8;

/** The filter's parameter count, then its first `n` parameters, into globals `to` on. */
const params = (n: number, to: number): number[] => [
  op(StkOp.NUM_PARAM), globalStore(to),
  ...int(n), ...int(10), op(StkOp.PARAM_FETCH),
  ...Array.from({ length: n }, (_, i) => [varFetch(10 + i), globalStore(to + 1 + i)]).flat(),
];
/** `&SOUND` of `d.sound1772`'s entry `ordinal`, loud. */
const sound = (ordinal: number): number[] => [...int(-ordinal - 1), ...int(1), ...int(0), op(StkOp.SOUND)];

interface Played { id: number; volume: number }

/** A game with the filter's DSAs, `programs`, and every sample the host is asked to play. */
function withFilter(programs: number[][], onPlay: (game: Game) => void = () => {}): { game: Game; played: Played[] } {
  const played: Played[] = [];
  let game: Game | null = null;
  game = withFilterDsas(ESL_SOUNDFILTER, programs, {
    playSound: (id, _rate, volume) => {
      played.push({ id, volume: volume ?? 1 });
      onPlay(game!);
    },
  });
  return { game, played };
}

/** The first ordinal of `d.sound1772` with a sample that is loud at a step of (1, 1). */
function loudOrdinal(game: Game): number {
  const table = game.ctx.tables.sound1772;
  for (let i = 0; i < 22; i++) {
    const e = table[i]!;
    if (e.word0 !== 0 && (e.byte6 & 0xff) >= 2) return i;
  }
  throw new Error('no loud sound');
}

const party = (game: Game): { x: number; y: number; z: number } => game.ctx.party.state.position;
const queue = (game: Game, ordinal: number, dx: number, dy: number): void =>
  game.ctx.sounds.queueSound(ordinal, party(game).x + dx, party(game).y + dy, 0, party(game).z);

/* ------------------------------- 1. no filter ----------------------------------- */
const played0: Played[] = [];
const plain = freshGame(undefined, { playSound: (id, _rate, volume) => played0.push({ id, volume: volume ?? 1 }) });
const ordinal = loudOrdinal(plain);
const entry = plain.ctx.tables.sound1772[ordinal]!;
queue(plain, ordinal, 1, 1);
console.log(`1. sound ${ordinal} (sample ${entry.word0}, loud to ${entry.byte6}, silent from ${entry.byte7}) `
  + `a step of (1, 1) away, no filter: ${JSON.stringify(played0)}`);
check(played0.length === 1 && played0[0]!.id === entry.word0 && played0[0]!.volume === 1, 'with no filter the sound plays, loud');

/* ------------------------------- 2, 3. two DSAs, the parameters ------------------- */
for (const [dx, dy, distance100] of [[1, 1, 141], [3, 4, 500], [0, 0, 0]] as const) {
  const { game, played } = withFilter([params(9, 0), params(9, 20)]);
  queue(game, ordinal, dx, dy);
  const g = game.systems.dsa.getGlobalVariables();
  const p = party(game);
  const volume = dx + dy >= entry.byte7 ? -1 : dx + dy <= entry.byte6 ? 1 : 0;
  const want = [9, ordinal + 1, volume, dx * dx + dy * dy, p.z, p.x + dx, p.y + dy, 0, 0, distance100];
  console.log(`2. a step of (${dx}, ${dy}): the first DSA sees [${g.slice(0, 10).join(', ')}], the second `
    + `${g[20] === UNSET ? 'does not run' : `[${g.slice(20, 30).join(', ')}]`}; ${played.length} played`);
  check(g.slice(0, 10).join() === want.join(), `3. the nine parameters at (${dx}, ${dy}), distance ${distance100} hundredths`);
  check(g.slice(20, 30).join() === want.join(), 'the second DSA at the location runs too, on the same parameters');
  check(played.length === 0, 'the sound is the DSAs\', and nothing plays');
}

/* ------------------------------- 4. out of earshot ------------------------------ */
{
  const { game, played } = withFilter([params(9, 0)]);
  const far = entry.byte7 & 0xff;
  queue(game, ordinal, far, 0);
  const g = game.systems.dsa.getGlobalVariables();
  console.log(`4. a step of (${far}, 0), out of earshot: the DSA sees volume ${g[2]}; ${played.length} played`);
  check(g[2] === -1 && played.length === 0, 'a silent sound reaches the filter, with volume -1');
}

/* ------------------------------- 5. a DSA plays it ------------------------------ */
{
  const { game, played } = withFilter([[...params(9, 0), ...sound(ordinal)], params(9, 20)]);
  queue(game, ordinal, 1, 1);
  console.log(`5. the first DSA plays sound ${ordinal} with &SOUND: ${JSON.stringify(played)}`);
  check(played.length === 1 && played[0]!.id === entry.word0, 'the sound a DSA plays is played, once');
}

/* ------------------------------- 6. a sound queued meanwhile -------------------- */
{
  const other = (ordinal + 1) % 22;
  let nested = false;
  const { game, played } = withFilter([[...params(9, 0), ...sound(ordinal)]], (g) => {
    if (nested) return;
    nested = true;
    queue(g, other, 0, 0);
  });
  queue(game, ordinal, 1, 1);
  const g = game.systems.dsa.getGlobalVariables();
  const want = game.ctx.tables.sound1772[other]!.word0;
  console.log(`6. sound ${other} queued while the DSA runs: played ${JSON.stringify(played)}, the DSA saw ordinal ${g[1] - 1}`);
  check(played.length === 2 && played[1]!.id === want, 'a sound queued while the filter runs plays on');
  check(g[1] === ordinal + 1, 'the filter did not run for it');
}

finish();
