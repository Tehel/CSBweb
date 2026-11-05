/**
 * A new game's read draws from the stream it begins with, `d.RandomNumber` as
 * `_ReadEntireGame` starts (`Game.readNewGame`): `d.RandomGameID` first
 * (doc/CSBwin-src/SaveGame.cpp:1637-1645), then the groups of the party's level, as
 * `LoadPartyLevel` loads it (`ProcessMonstersOnLevel`). That stream is what CSBWin's
 * record writes in its `0x3333` line and its playback sets before the draws
 * (`:1605-1636`), and what a recording of the port's keeps (`RecordingStart`'s `seed`).
 *
 * Conflux 3.5 (`conflux-3.5`) is the set: its level 0 has groups, whose `ITEM16`s the read
 * draws for. On Dungeon Master's, the Hall of Champions has none, so the read draws for
 * nothing but the playthrough, and a read seeded after it plays the same.
 *
 * 1. Read from a seed, the read keeps it, draws `d.RandomGameID` from its first two draws,
 *    and draws on for level 0's groups (the canary: this set exercises the order).
 * 2. Two reads from one seed leave the same groups and stream; from another, other groups.
 * 3. A recording's new start, played by `RecordingPlayer`, leaves the groups, the timers,
 *    the stream and the playthrough the recorded read left, its stream its own; a start
 *    made before the seed was kept does not.
 *
 * Run: `npm test -- --only=checks/new-game-seed.ts`
 */
import { CsbRandom } from '../../src/core/random';
import type { Game } from '../../src/engine/Game';
import { NO_EXTRAS, type RulesOptions } from '../../src/engine/GameContext';
import type { Recording, RecordingStart } from '../../src/engine/Recorder';
import { RecordingPlayer } from '../../src/engine/RecordingPlayer';
import { standInPage } from '../../src/renderer/StandInPage';
import { check, finish } from '../lib/check';
import { dataSetNamed, diskFiles } from '../lib/dataSets';

const SET = dataSetNamed('conflux-3.5');
const FILES = diskFiles(SET);
const SEED = 0x00004c63;
const OTHER_SEED = 0x2545f491;

const RULES: RulesOptions = {
  dmRules: true, dmRulesDesignOption: false, invisibleMonsters: false, drawAsSize4Monsters: false,
  simpleEncipher: false, supressDSAWarningOption: false, bGravityGame: false, bThreeDMovements: false,
};

/** What a new game's read leaves that its draws decide. */
interface ReadState { groups: string; timers: string; random: number; randomGameID: number }

function readState(game: Game): ReadState {
  const { ctx } = game;
  return {
    groups: JSON.stringify(ctx.dungeon.getData().item16 ?? []),
    timers: JSON.stringify(ctx.timers.getTimers().map((timer) => [timer.time, timer.function, timer.level])),
    random: ctx.random.getSeed(),
    randomGameID: ctx.state.block1.randomGameID,
  };
}

/** A new game of the set read on a fresh page, from `seed` where given. */
async function readNew(seed?: number): Promise<Game> {
  const page = await standInPage(SET, FILES);
  page.game.readDungeonDat(page.dungeonDat, seed);
  return page.game;
}

/** The draws from `from` to `to` along the stream, or null past `max`. */
function drawsBetween(from: number, to: number, max = 100000): number | null {
  const random = new CsbRandom(from);
  for (let n = 0; n <= max; n++, random.next()) if (random.getSeed() === to) return n;
  return null;
}

console.log('1. A read from a seed');
{
  const game = await readNew(SEED);
  const state = readState(game);
  const random = new CsbRandom(SEED);
  const d0 = random.next() & 0xffff;
  const d1 = random.next() & 0xffff;
  const afterId = random.getSeed();
  const groupDraws = drawsBetween(afterId, state.random);
  console.log(`  seed ${SEED.toString(16)}: d.RandomGameID ${state.randomGameID.toString(16)}, then ${groupDraws} draws to ${state.random.toString(16)}`);
  check(game.newGameSeed === SEED, 'the read keeps the seed it began from');
  check(state.randomGameID === (d0 * d1) >>> 0, 'd.RandomGameID is the product of its first two draws\' low words');
  check(groupDraws !== null && groupDraws > 0, `then it draws on, ${groupDraws} times, for level 0's groups (the canary: the set has some)`);
}

console.log('2. The seed decides the groups');
{
  const a = readState(await readNew(SEED));
  const b = readState(await readNew(SEED));
  const other = readState(await readNew(OTHER_SEED));
  check(a.groups === b.groups && a.random === b.random, `two reads from ${SEED.toString(16)} leave the same groups and stream`);
  check(a.groups !== other.groups, `a read from ${OTHER_SEED.toString(16)} leaves other groups`);
}

console.log('3. A recording\'s new start played');
{
  const recorded = await readNew();
  const seed = recorded.newGameSeed;
  const want = readState(recorded);
  check(seed !== null, `a read from a stream of its own keeps the seed it drew (${seed?.toString(16)})`);
  const played = async (start: RecordingStart): Promise<ReadState> => {
    const page = await standInPage(SET, FILES);
    const root: Recording = {
      id: 'root', build: 'check', level: 0, profile: null, files: null, dataSet: SET.id, start, parent: null,
      rules: RULES, extras: NO_EXTRAS, changes: [], vbls: 0, ended: true, end: null,
    };
    new RecordingPlayer(page.game, [root], page.dungeonDat, null).start();
    return readState(page.game);
  };
  const start = { kind: 'new', random: want.random, randomGameID: want.randomGameID } as const;
  const got = await played({ ...start, seed: seed! });
  check(got.groups === want.groups && got.timers === want.timers, 'the played start leaves the groups and the timers the recorded read left');
  check(got.random === want.random && got.randomGameID === want.randomGameID, 'and its stream and playthrough');
  const unseeded = await played(start);
  check(unseeded.groups !== want.groups, 'a start without its seed, of a recording made before it was kept, leaves other groups');
}

finish();
