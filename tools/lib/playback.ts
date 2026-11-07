/**
 * A recording's path played back without the DOM, over any data set's files, as the page
 * plays `?recording=` (`playRecording`, `src/main.ts`): a page without the DOM
 * (`standInPage`, `src/renderer/StandInPage.ts`), then the player (`RecordingPlayer`) and
 * the loop on a clock the tool moves (`ManualClock`), a span under a held clock run at once. The screen is drawn
 * only at the tick's `DrawViewport`, which a click in the viewport is resolved through,
 * as `tools/checks/replay.ts`'s replayed page draws it: what the page composes besides
 * takes nothing from the game (`replay.ts`, point 2), which also proves that this plays a
 * package as its own page does (point 10).
 *
 * What the replay tool (`utils/replay-recordings.ts`) plays a shared recording with. A
 * play may be restarted as the viewer's stop restarts it (`Restart`), run at once
 * from its start as the viewer's forward runs it (`'forward'`), or keep checkpoints as the
 * page keeps them (`KeptCheckpoints`), and go back to one (`SeekBack`).
 */
import { VBL_FREQUENCY } from '../../src/core/constants';
import type { DataSetFiles } from '../../src/data/DataSetFiles';
import { KeptCheckpoints, type Checkpoint } from '../../src/engine/Checkpoint';
import type { DataSet } from '../../src/data/DataSets';
import type { Recording, RecordingPoint } from '../../src/engine/Recorder';
import { RecordingPlayer, type Drift, type SavedAtEnd } from '../../src/engine/RecordingPlayer';
import { rewindPage, type Pace } from '../../src/renderer/ui/RecordingStrip';
import { standInPage } from '../../src/renderer/StandInPage';
import type { Game } from '../../src/engine/Game';

/** A VBL of the wall clock, rounded up, as the loop is woken. */
const VBL_MS = Math.ceil(1000 / VBL_FREQUENCY);

/** Where a path played back stopped. */
export interface Played {
  /** The drift that stopped it, or `null` where it played to its end. */
  readonly drift: Drift | null;
  /** Where it stood in the recording it played last (`RecordingPlayer.point`). */
  readonly point: RecordingPoint;
  /** The joins played, each checked. */
  readonly joins: number;
  /** The game, as the path left it. */
  readonly game: Game;
  /**
   * Where the path was played again (`Restart`): the clock's milliseconds and the VBLs
   * run in the play again, its second's pause left out, and the VBLs run in the pause.
   */
  readonly restarted: { readonly ms: number; readonly vbls: number; readonly pausedVbls: number } | null;
  /** The VBLs the player ran, and the path's length (`RecordingPlayer.length`). */
  readonly vbls: number;
  readonly length: number;
  /** Where the path was run at once (`'forward'`): the slices it ran in, the page let run between. */
  readonly slices: number | null;
  /** The checkpoints kept at its end (`Keep`), oldest first; none where it kept none. */
  readonly kept: readonly Checkpoint[];
  /** Where it went back (`SeekBack`). */
  readonly seek: Seeked | null;
}

/** The checkpoints a play keeps (`KeptCheckpoints`): one each `every` VBLs of the path, the latest `most`. */
export interface Keep {
  readonly every: number;
  readonly most: number;
}

/**
 * The viewer's seek back, less the forward to its target: the play stopped once it has
 * run `at` VBLs of the path, the page rewound (`rewindPage`), and the latest checkpoint
 * kept at or before `to` read by a new player (`RecordingPlayer.resume`), or the path
 * played again from its start where none is; then played to its end.
 */
export interface SeekBack {
  readonly at: number;
  readonly to: number;
}

/** Where a play went back (`SeekBack`). */
export interface Seeked {
  /** The checkpoints kept where it stopped, oldest first. */
  readonly before: readonly Checkpoint[];
  /** The checkpoint read, or `null` where the path played again from its start. */
  readonly read: Checkpoint | null;
  /** The checkpoints kept once it was read. */
  readonly after: readonly Checkpoint[];
  /** The game's checkpoint taken at once after the read, before any VBL: what the read landed on. */
  readonly landed: Checkpoint | null;
}

/**
 * The viewer's stop, as its strip does it (`playRecording`, `src/main.ts`), less the pause at the first tick: the first play
 * stopped once it has played `afterMs` of the clock, or at its end, the page rewound
 * (`rewindPage`) and the path played again with a new player at `pace`, paused for a
 * second of the clock once it has played `afterMs` again.
 */
export interface Restart {
  readonly afterMs: number;
  readonly pace: Pace;
}

/**
 * `set`'s files as `files` reads them, each read once: the files a play reads again, for
 * the next play of the same set.
 */
export function keptFiles(files: DataSetFiles): DataSetFiles {
  const read = new Map<string, Promise<Uint8Array | null>>();
  return {
    read(name) {
      let bytes = read.get(name);
      if (!bytes) read.set(name, bytes = files.read(name));
      return bytes;
    },
    where: (name) => files.where(name),
  };
}

/**
 * `path` played from its first recording's start in a fresh page of `set`, whose files
 * `files` reads, to its end or its first drift; `savedAtEnd`, the save a path shared at a
 * save's point ends at; `restart`, a stop in it, `'forward'`, the whole path run at
 * once (`Game.forward`), its slices on the clock's zero-delay calls, or a seek back to a
 * checkpoint `keep` has kept; `keep`, the checkpoints its players keep, as the page's do.
 * A frame that throws, CSBWin's `die`, throws.
 */
export async function playPath(
  set: DataSet, files: DataSetFiles, path: readonly Recording[], savedAtEnd: SavedAtEnd | null = null,
  restart: Restart | 'forward' | SeekBack | null = null, keep: Keep | null = null,
): Promise<Played> {
  const { game, screen, messages, clock, dungeonDat } = await standInPage(set, files);
  const kept = keep ? new KeptCheckpoints(keep.every, keep.most) : null;
  let player!: RecordingPlayer;
  const newPlayer = (): void => {
    player = new RecordingPlayer(game, path, dungeonDat, savedAtEnd, kept);
    player.onEnd(() => game.stop());
  };
  const play = (): void => {
    newPlayer();
    player.start();
    if (player.playing) game.start(true);
  };
  /** The loop run until the player stops, or, given, until `ms` of the clock have passed. */
  const run = (ms = Infinity): void => {
    for (const until = clock.time + ms; player.playing && clock.time < until;) {
      if (!clock.advance(VBL_MS)) throw new Error('the loop stopped while the player plays');
    }
  };
  game.runAtOnceWhile(() => player.held);
  play();
  const ended = (restarted: Played['restarted'], slices: number | null = null, seek: Seeked | null = null): Played => ({
    drift: player.drift, point: player.point, joins: player.joins, game, restarted, vbls: player.vbls, length: player.length, slices,
    kept: [...(kept?.checkpoints ?? [])], seek,
  });
  if (!restart) {
    run();
    return ended(null);
  }
  if (restart === 'forward') {
    let slices = 1;
    game.forward(() => player.playing, () => { throw new Error('the path ran at once ends with the player'); }, () => slices++);
    while (player.playing) {
      if (!clock.advance(0)) throw new Error('the loop stopped while the player plays');
    }
    return ended(null, slices);
  }
  if ('at' in restart) {
    if (!kept) throw new Error('a seek back reads the checkpoints kept');
    while (player.playing && player.vbls < restart.at) {
      if (!clock.advance(VBL_MS)) throw new Error('the loop stopped while the player plays');
    }
    const before = [...kept.checkpoints];
    player.stop();
    rewindPage(game, screen, messages);
    const read = kept.before(restart.to);
    const after = [...kept.checkpoints];
    let landed: Checkpoint | null = null;
    if (read) {
      newPlayer();
      player.resume(read);
      landed = player.checkpoint();
      game.start(true);
    } else {
      play();
    }
    run();
    return ended(null, null, { before, read, after, landed });
  }
  run(restart.afterMs);
  player.stop();
  rewindPage(game, screen, messages);
  game.setPace(restart.pace);
  const from = clock.time;
  play();
  run(restart.afterMs);
  const before = player.vbls;
  game.setPace(0);
  for (const until = clock.time + 1000; clock.time < until;) clock.advance(VBL_MS);
  const pausedVbls = player.vbls - before;
  game.setPace(restart.pace);
  run();
  return ended({ ms: clock.time - from - 1000, vbls: player.vbls, pausedVbls });
}
