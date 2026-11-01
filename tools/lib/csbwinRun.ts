/**
 * A CSBWin run's `playfile.log` played into a page of the port through its input boundary
 * (`InputBoundary`), as a player's page would have changed the game, and recorded by the
 * port's own recorder (`Recorder`): the runs of `DEBT.md` F24 that play to their end,
 * made recordings of the port's, which its player plays (`RecordingPlayer`) and the site
 * shares (`RecordingPackage`).
 *
 * CSBWin's player puts each entry in the mouse queue at the top of `HandleMouseEvents`
 * once `d.Time` reaches it (doc/CSBwin-src/Mouse.cpp:1493-1505, Recording.cpp:481-503).
 * The port's pass reads the queue at the top of its VBL, before the VBL's tick, so the
 * game between two VBLs is the game that pass sees: each entry due is applied there as the
 * change a page makes, a click at its point where the screen has the entry's button
 * there (`searchMouseButtons`), its key otherwise, and the button-up as the button-up.
 * One entry a pass, as `HandleMouseEvents` takes one but after a button-up
 * (`Mouse.cpp:1659-1666`), and none while the queue still holds one: a step the party
 * cannot make yet waits in the queue as `PLAYFILE::Backspace` puts it back in the file
 * (`Mouse.cpp:1626-1630`). None while gravity moves the party, which reads no entry
 * (`:1482-1491`). The lines that change the game and are no input are the `playfile`
 * change (`applyPlayfileLine`); the Reincarnate screen takes its `0x4444` lines as its
 * keys and its OK (`Code13ea4.cpp:86-108`).
 *
 * Where the port's page differs from CSBWin's playback, its game is the page's: the
 * frozen game's discard and `lastTime`'s one entry a tick hold (`Mouse.cpp:1548-1605`),
 * which a run recorded in play has kept to, and `extraTicks`, which playback turns off
 * (`CSBUI.cpp:985`) and the port keeps on (`MovementSystem.moveParty`): none of the runs
 * draws otherwise for it. Each entry's random is checked as CSBWin's player checks it, so
 * a run that drifts stops there, and says where.
 */
import { digestedFiles } from '../../src/data/DataSetFiles';
import { MOUSE_UNCLICK } from '../../src/engine/MouseQueue';
import { PLAYFILE_LINES } from '../../src/engine/PlayfileLine';
import { carriedStateOf, Recorder, type Recording, type RecordingPoint } from '../../src/engine/Recorder';
import { packageOfEnd, packageOfSave, type RecordingPackage } from '../../src/engine/RecordingPackage';
import { applySaveBytes } from '../../src/engine/SaveGameFile';
import { saveFileOf } from '../../src/engine/GameSaves';
import { searchMouseButtons } from '../../src/renderer/ui/Mouse';
import { readFileSync } from 'node:fs';
import { dataSetNamed, diskFiles } from './dataSets';
import { standPage, type Page } from './playback';
import { readPlayfile, type PlayEntry } from './playfile';

/** A run of CSBWin's that plays to its end, kept in `tools/fixtures/csbwin-runs/<id>/`. */
export interface CsbwinRun {
  /** Its name in CSBWin's movies, and its folder. */
  readonly id: string;
  /** The data set it is played on (`DataSet.id`). */
  readonly dataSet: string;
  /** The CSBWin save its log's first read reads (`0x6669`), in its folder, or `null` for a new game. */
  readonly save: string | null;
  /** Where it ends: the game won, Lord Chaos fused; or its log's end, shared at a save made there. */
  readonly end: 'won' | 'log';
  /** What its package says of it: the run's player, a title and a description. */
  readonly player: string;
  readonly title: string;
  readonly description: string;
  /** When its log was written, its file's date: what the package says it began and ended at. */
  readonly recordedAt: string;
}

/** The runs, in the order the check plays them. */
export const CSBWIN_RUNS: readonly CsbwinRun[] = [
  {
    id: 'DMMovie2615', dataSet: 'dm-atari', save: null, end: 'won', player: 'Anthony Bracegirdle',
    title: 'Race to fusion in 26 min 15 s',
    description: 'Dungeon Master won in 9449 ticks with Halk, Stamm, Leyla and Gothmog. A CSBWin 17.6 recording, DMMovie2615 of CSBWin\'s movies, played back in CSBweb.',
    recordedAt: '2021-04-06',
  },
  {
    id: 'DMMovie2823', dataSet: 'dm-atari', save: null, end: 'won', player: 'Anthony Bracegirdle',
    title: 'Race to fusion in 28 min 23 s',
    description: 'Dungeon Master won in 10217 ticks with Halk, Stamm, Leyla and Gothmog. A CSBWin 17.6 recording, DMMovie2823 of CSBWin\'s movies, played back in CSBweb.',
    recordedAt: '2020-09-20',
  },
  {
    id: 'CSBMovie0640', dataSet: 'csb', save: 'csbgame.dat', end: 'log', player: 'Anthony Bracegirdle',
    title: 'Race to Fulya Pit in 6 min 40 s',
    description: 'Chaos Strikes Back from the prison to Fulya Pit with Buzzzz. A CSBWin 17.6 recording, CSBMovie0640 of CSBWin\'s movies, eleven recordings spliced at the saves made between them, played back in CSBweb.',
    recordedAt: '2021-04-30',
  },
];

/** The folder a run's files are in. */
export function runFolder(run: CsbwinRun): string {
  return `tools/fixtures/csbwin-runs/${run.id}`;
}

/** A run played into the port and recorded. */
export interface RecordedRun {
  readonly page: Page;
  /** Its recording, ended by the game's end or running at the log's end. */
  readonly recording: Recording;
  /** The entries taken, each its random checked. */
  readonly entries: number;
  /** Where its random first differs, or `null` where it plays to its end. */
  readonly drift: string | null;
  /** The game's end, `d.Word11694`, or `null` where it did not end. */
  readonly won: boolean | null;
  /**
   * At the log's end where the game did not end: the recording's point there and the
   * file a save makes there, as the player makes it at a path's end (`SavedAtEnd`).
   */
  readonly saved: { readonly point: RecordingPoint; readonly file: Uint8Array } | null;
}

/** The VBLs a run may go on past its log's last entry for the game to end, the fusion's sequence played out: five minutes. */
const VBLS_TO_END = 5 * 60 * 60;

const hx = (n: number, width = 4): string => n.toString(16).padStart(width, '0');

/** The LCG's draws from `from` to `to`, up to `max`, or `null` (`CsbRandom`). */
function drawsBetween(from: number, to: number, max = 100000): number | null {
  for (let n = 0, s = from >>> 0; n <= max; n++, s = (Math.imul(s, 0xbb40e62d) + 11) >>> 0) if (s === to >>> 0) return n;
  return null;
}

/**
 * `run` played from its folder into a fresh page of its set, `build` naming its
 * recording's build and `dataSet` its set: the run's own, or the id a site gives the same
 * files (`utils/share-csbwin-runs.ts`).
 */
export async function recordRun(run: CsbwinRun, build: string, dataSet = run.dataSet): Promise<RecordedRun> {
  const folder = runFolder(run);
  const set = dataSetNamed(run.dataSet);
  const files = digestedFiles(diskFiles(set));
  const page = await standPage(set, files);
  const { game, screen } = page;
  const { ctx } = game;
  const recorder = new Recorder(game, build, dataSet, () => files.digests(), () => run.id);
  const { items } = readPlayfile(`${folder}/playfile.log`);
  const entries = items.filter((item): item is PlayEntry => 'num' in item);

  // The start: a CSB run's save, read where its log's first read was; or a new game, the
  // log's `0x3333` seed, then `ReadEntireGame`'s two draws for `d.RandomGameID`
  // (doc/CSBwin-src/SaveGame.cpp:1606-1645).
  let at: number;
  if (run.save) {
    const bytes = new Uint8Array(readFileSync(`${folder}/${run.save}`));
    applySaveBytes(game, bytes);
    recorder.begin({ kind: 'save', bytes, carried: carriedStateOf(game) });
    at = entries.findIndex((entry) => entry.num === 0x6669) + 1;
  } else {
    game.readDungeonDat(page.dungeonDat);
    at = entries.findIndex((entry) => entry.num === 0x3333);
    const seed = entries[at++]!;
    ctx.random.setSeed(((seed.x << 16) | (seed.y & 0xffff)) >>> 0);
    const d0 = ctx.random.next() & 0xffff;
    const d1 = ctx.random.next() & 0xffff;
    ctx.state.block1.randomGameID = (d0 * d1) >>> 0;
    recorder.begin({ kind: 'new', random: ctx.random.getSeed(), randomGameID: ctx.state.block1.randomGameID });
  }
  if (at <= 0) throw new Error(`${run.id}: its log holds no start`);

  let taken = 0;
  let lastRandom = ctx.random.getSeed();
  let drift: string | null = null;
  const where = (): string => {
    const { position, facing } = ctx.party.state;
    return `party L${position.z} (${position.x},${position.y}) f${facing}`;
  };

  /**
   * The next entry, if it is due, its random checked as `PLAYFILE::Play` checks it
   * (doc/CSBwin-src/Recording.cpp:481-503): `d.RandomNumber`, or the draws since the
   * entry before. Not the codes that set or skip the stream, nor the start's.
   */
  const due = (): PlayEntry | null => {
    const entry = entries[at];
    if (!entry || entry.time > ctx.state.tickCount) return null;
    const random = ctx.random.getSeed();
    if (entry.time !== 0 && ![0x2222, 0xd7, 0x3333, 0x5555, 0x6668, 0xffff].includes(entry.num)
      && entry.ran !== random && entry.ran !== drawsBetween(lastRandom, random)) {
      drift = `line ${entry.line}: d.Time ${hx(entry.time, 8)} ${hx(entry.x)} ${hx(entry.y)} button ${hx(entry.num)}: recorded ${hx(entry.ran, 8)}, the port's d.RandomNumber ${hx(random, 8)}; ${where()}`;
      return null;
    }
    at++;
    lastRandom = random;
    taken++;
    return entry;
  };

  /** What the page changes before the next VBL, as its pass would take the log's entries. */
  const feed = (): void => {
    const { ui } = screen;
    // The Reincarnate screen reads the log itself (doc/CSBwin-src/Code13ea4.cpp:86-108).
    while (ui.reincarnate) {
      const entry = due();
      if (!entry) return;
      if (entry.num !== 0x4444) throw new Error(`${run.id}: line ${entry.line}, button ${hx(entry.num)} on the Reincarnate screen`);
      if (entry.x !== 0) game.input.apply({ kind: 'reincarnateKey', key: String.fromCharCode(entry.x) });
      else for (let n = 0; n < 3 && ui.reincarnate; n++) game.input.apply({ kind: 'reincarnateClick', x: 206, y: 151 });
    }
    if (ctx.loop.gravityMove || ctx.mouseQueue.count() !== 0) return;
    for (let entry = due(); entry; entry = due()) {
      const { num, x, y } = entry;
      if (num === 0x6668 || num === 0x6669) continue; // a save's or a read's signature, only recorded (Recording.cpp:723-727)
      if (PLAYFILE_LINES.has(num)) {
        game.input.apply({ kind: 'playfile', num, y });
        continue;
      }
      if (num === MOUSE_UNCLICK) {
        game.input.apply({ kind: 'unclick' });
        continue;
      }
      if (num >= 0x2000) throw new Error(`${run.id}: line ${entry.line}, button ${hx(num)}, which the port does not play`);
      const buttons = [1, 2].find((b) => searchMouseButtons(ui, x, y, b) === num);
      game.input.apply(buttons === undefined ? { kind: 'key', num } : { kind: 'click', x, y, buttons });
      return;
    }
  };

  game.start(true);
  let pastLog = 0;
  for (;;) {
    feed();
    if (drift || recorder.recording!.end) break;
    if (at >= entries.length && ctx.mouseQueue.count() === 0 && !screen.ui.reincarnate) {
      if (run.end === 'log' || ++pastLog > VBLS_TO_END) break;
    }
    game.runFrame();
  }
  const recording = recorder.recording!;
  const saved = recording.end ? null : {
    point: recorder.point()!,
    file: saveFileOf(game, ctx.state.paused ? 'stopped' : 'running', (champion) => ctx.host.portraitOf(champion)),
  };
  return { page, recording, entries: taken, drift, won: recording.end?.word11694 ?? null, saved };
}

/**
 * `recorded`'s package, as the site shares `run` (`RecordingPackage`): at the game's end, or
 * at the save made at its log's end, with the run's player, title and description, begun
 * and ended at its log's date.
 */
export function runPackage(run: CsbwinRun, recorded: RecordedRun): RecordingPackage {
  const text = { title: run.title, author: run.player, description: run.description };
  const date = Date.parse(run.recordedAt);
  const times = { recordedAt: date, endedAt: date, playTime: recorded.page.game.playTime() };
  return recorded.saved
    ? packageOfSave([recorded.recording], recorded.saved.point, recorded.saved.file, text, times)
    : packageOfEnd([recorded.recording], text, times);
}
