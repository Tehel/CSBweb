/**
 * A recording's path played back without the DOM, over any data set's files, as the page
 * plays `?recording=` (`playRecording`, `src/main.ts`): the engine, its screen over a
 * stand-in canvas, the page's input path and its saves over a store in memory, wired as
 * `construct` wires them, then the player (`RecordingPlayer`) and the loop on a clock the
 * tool moves (`ManualClock`), a span under a held clock run at once. The screen is drawn
 * only at the tick's `DrawViewport`, which a click in the viewport is resolved through,
 * as `tools/checks/replay.ts`'s replayed page draws it: what the page composes besides
 * takes nothing from the game (`replay.ts`, point 2), which also proves that this plays a
 * package as its own page does (point 10).
 *
 * What the replay tool (`utils/replay-recordings.ts`) plays a shared recording with. A
 * play may be restarted as the viewer's RESTART restarts it (`Restart`).
 */
import { VBL_FREQUENCY } from '../../src/core/constants';
import { CsbRandom } from '../../src/core/random';
import { loadGameFiles, type DataSetFiles } from '../../src/data/DataSetFiles';
import type { DataSet } from '../../src/data/DataSets';
import { emptyDungeonData } from '../../src/data/DungeonLoader';
import { extractGraphicsTables } from '../../src/data/tables/GraphicsTables';
import { csbGraphicsOpener } from '../../src/engine/FileSignatures';
import { Game } from '../../src/engine/Game';
import { GameSaves } from '../../src/engine/GameSaves';
import { buildGameTables } from '../../src/engine/GameTables';
import type { Recording, RecordingPoint } from '../../src/engine/Recorder';
import { RecordingPlayer, type Drift, type SavedAtEnd } from '../../src/engine/RecordingPlayer';
import { NO_FULLSCREEN } from '../../src/lib/fullscreen';
import { GameInput } from '../../src/renderer/GameInput';
import { GameScreen } from '../../src/renderer/GameScreen';
import { Presenter } from '../../src/renderer/Presenter';
import { ScrollingText } from '../../src/renderer/csbwin/ScrollingText';
import { hostDrawing } from '../../src/renderer/ui/HostDrawing';
import { rewindPage, type Pace } from '../../src/renderer/ui/RecordingStrip';
import { openReincarnateScreen } from '../../src/renderer/ui/ReIncarnate';
import { askBeginAdventure } from '../../src/renderer/ui/SaveMenu';
import { UIMode } from '../../src/renderer/ui/UIState';
import { Settings, applyToGame } from '../../src/settings/Settings';
import { ManualClock } from './clock';
import { memoryStore } from './saves';

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
}

/**
 * RESTART, as the viewer's strip does it (`playRecording`, `src/main.ts`): the first play
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
 * save's point ends at; `restart`, a RESTART in it. A frame that throws, CSBWin's `die`,
 * throws.
 */
export async function playPath(
  set: DataSet, files: DataSetFiles, path: readonly Recording[], savedAtEnd: SavedAtEnd | null = null, restart: Restart | null = null,
): Promise<Played> {
  const loaded = await loadGameFiles(set, files);
  const dungeonDat = await files.read('dungeon.dat');
  if (!dungeonDat) throw new Error(`Cannot open dungeon file '${files.where('dungeon.dat')}'`);
  const graphicsTables = extractGraphicsTables(loaded.graphicsLoader);
  const tables = buildGameTables(graphicsTables);
  const clock = new ManualClock();
  const messages = new ScrollingText(tables.byte1830);
  let screen: GameScreen | null = null;
  const drawing = hostDrawing(() => screen?.ui ?? null);
  const renderView = (): void => {
    if (!screen || game.mainLoopHasReturned()) return;
    const party = game.ctx.party;
    screen.syncParty();
    screen.drawViewport(party.state.position, party.state.facing, game.ctx.state.word1868);
  };
  const game = new Game(emptyDungeonData(), tables, {
    messages,
    clock,
    sleepChanged: (sleeping) => {
      screen?.setUIMode(sleeping ? UIMode.Sleeping : UIMode.Adventure);
      messages.setPartySleeping(sleeping);
    },
    openReincarnateScreen: (chIdx) => { if (screen) openReincarnateScreen(screen.ui, chIdx); },
    ...drawing,
    championJoined: () => saves.championJoined(),
    die: (error) => { throw error; },
    drawViewport: renderView,
  });
  loaded.csbGraphicsLoader.opener = csbGraphicsOpener(game.ctx);
  game.ctx.sounds.csbGraphics = loaded.csbGraphicsLoader;
  game.ctx.overlay.csbGraphics = loaded.csbGraphicsLoader;
  loaded.csbGraphicsLoader.cannotOpen = () => { game.ctx.overlay.active = false; };
  const saves = new GameSaves(game, set, files, memoryStore(), {
    portraitOf: drawing.portraitOf,
    askBeginAdventure: (source) => { if (screen) askBeginAdventure(screen.ui, source); },
  }, () => {}, new CsbRandom());
  const settings = new Settings(null);
  const presenter = new Presenter(() => screen?.animationFrame(game.mainLoopHasReturned()));
  const image = { width: 320, height: 200, data: new Uint8ClampedArray(320 * 200 * 4) };
  const canvas = { getContext: () => ({ createImageData: () => image, putImageData: () => {} }) };
  const unasked = (what: string) => () => { throw new Error(`a recording played back asks for no ${what}`); };
  screen = new GameScreen(canvas as unknown as ConstructorParameters<typeof GameScreen>[0], {
    graphicsLoader: loaded.graphicsLoader,
    tables: graphicsTables,
    ctx: game.ctx,
    csbGraphicsLoader: loaded.csbGraphicsLoader,
    messages,
    hintOracle: loaded.hintOracle,
  }, {
    onReincarnated: () => {},
    onListSaves: () => saves.list(),
    onListEverySave: () => saves.listEverySet(),
    onReadSave: (entry) => saves.open(entry),
    onMakeNewAdventure: unasked('new adventure'),
    onHasNewFaces: async () => false,
    onSaveGame: (over) => saves.save('stopped', over ?? 'new'),
    isPrison: () => saves.inPrison(),
    onExportSave: unasked('export'),
    onDeleteSave: (entry) => saves.remove(entry),
    onImportSave: unasked('import'),
    onRestoreSave: (save) => saves.read(save),
    onRestoreFailed: (error) => { throw error; },
    onOpenHintOracle: unasked('Hint Oracle'),
    onSleepSave: () => { void saves.sleepSave(); },
    onExit: () => {},
    settings,
    isCrtAvailable: () => false,
    fullscreen: NO_FULLSCREEN,
    keyboardLayout: () => null,
    onTeleport: null,
  }, presenter, () => {});
  new GameInput({
    game,
    screen,
    refreshScreen: () => {},
    onQuickSave: () => { void saves.quickSave(); },
    onQuickLoad: () => { void saves.quickLoad(); },
    onDevLevel: null,
  }).install();
  settings.subscribe((values) => applyToGame(game, values));
  game.onTick(() => {
    const { selectedCharacterIndex, sleeping } = game.ctx.party.state;
    if (selectedCharacterIndex < 0 && !sleeping) renderView();
  });
  game.ctx.rules.dmRulesDesignOption = set.dmRules;

  let player!: RecordingPlayer;
  const play = (): void => {
    player = new RecordingPlayer(game, path, dungeonDat, savedAtEnd);
    player.onEnd(() => game.stop());
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
  if (!restart) {
    run();
    return { drift: player.drift, point: player.point, joins: player.joins, game, restarted: null };
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
  return {
    drift: player.drift, point: player.point, joins: player.joins, game,
    restarted: { ms: clock.time - from - 1000, vbls: player.vbls, pausedVbls },
  };
}
