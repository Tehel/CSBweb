/**
 * A page of a data set without the DOM, wired as the page's `construct` wires one
 * (`src/main.ts`): the engine, its screen over a stand-in canvas, the page's input path,
 * and its saves over a store in memory, its loop on a clock its owner moves
 * (`ManualClock`). It plays a recording's path headless: the tools' (`tools/lib/playback.ts`)
 * and the page's own, which cuts a path at a save (`src/engine/RecordingCut.ts`). Its
 * screen is drawn only at the tick's `DrawViewport`, which a click in the viewport is
 * resolved through: what the page composes besides takes nothing from the game
 * (`tools/checks/replay.ts`, point 2).
 *
 * **Nothing in this file touches the DOM.**
 */
import { CsbRandom } from '../core/random';
import { loadGameFiles, type DataSetFiles } from '../data/DataSetFiles';
import type { DataSet } from '../data/DataSets';
import { emptyDungeonData } from '../data/DungeonLoader';
import { sortSaveEntries, type SaveEntry, type SaveStore } from '../data/saves';
import { extractGraphicsTables } from '../data/tables/GraphicsTables';
import { csbGraphicsOpener } from '../engine/FileSignatures';
import { Game } from '../engine/Game';
import { GameSaves } from '../engine/GameSaves';
import { buildGameTables } from '../engine/GameTables';
import { ManualClock } from '../engine/ManualClock';
import type { CutPage } from '../engine/RecordingCut';
import { NO_FULLSCREEN } from '../lib/fullscreen';
import { Settings, applyToGame } from '../settings/Settings';
import { GameInput } from './GameInput';
import { GameScreen, type KeptView } from './GameScreen';
import { Presenter } from './Presenter';
import { ScrollingText } from './csbwin/ScrollingText';
import { hostDrawing } from './ui/HostDrawing';
import { openReincarnateScreen } from './ui/ReIncarnate';
import { askBeginAdventure } from './ui/SaveMenu';
import { UIMode } from './ui/UIState';

/** A page of `set` without the DOM, wired as `construct` wires one, its loop on `clock`. */
export interface StandInPage {
  readonly game: Game;
  readonly screen: GameScreen;
  readonly messages: ScrollingText;
  readonly clock: ManualClock;
  /** The set's `dungeon.dat`, which a new game reads. */
  readonly dungeonDat: Uint8Array;
}

/**
 * A fresh page of `set`, whose files `files` reads: the engine, its screen over a stand-in
 * canvas, the page's input path and its saves over a store in memory. A frame that
 * throws, CSBWin's `die`, throws.
 */
export async function standInPage(set: DataSet, files: DataSetFiles): Promise<StandInPage> {
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
    keptView: () => screen?.keptView() ?? null,
    setKeptView: (view) => screen?.setKeptView(view as KeptView),
    championJoined: () => saves.championJoined(),
    die: (error) => { throw error; },
    drawViewport: renderView,
  });
  loaded.csbGraphicsLoader.opener = csbGraphicsOpener(game.ctx);
  game.ctx.sounds.csbGraphics = loaded.csbGraphicsLoader;
  game.ctx.overlay.csbGraphics = loaded.csbGraphicsLoader;
  loaded.csbGraphicsLoader.cannotOpen = () => { game.ctx.overlay.active = false; };
  const saves = new GameSaves(game, set, files, memorySaves(), {
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

  return { game, screen, messages, clock, dungeonDat };
}

/** `page` as a cut plays a path in it (`CutPage`): its clock moved by its owner. */
export function cutPageOf(page: StandInPage): CutPage {
  return { game: page.game, dungeonDat: page.dungeonDat, advance: (ms) => page.clock.advance(ms) };
}

/**
 * A save store in memory, for the page's saves: a recording played back writes none
 * (`doc/RECORDING.md` → "The port's player"), but the disk menu it opens lists them.
 */
function memorySaves(): SaveStore {
  const files = new Map<string, Uint8Array>();
  const entries = new Map<string, SaveEntry>();
  return {
    list: async (dataSet) => sortSaveEntries([...entries.values()].filter((entry) => dataSet === null || entry.dataSet === dataSet)),
    read: async (id) => {
      const bytes = files.get(id);
      if (!bytes) throw new Error(`no save ${id}`);
      return bytes;
    },
    write: async (entry, bytes) => {
      files.set(entry.id, bytes);
      entries.set(entry.id, entry);
    },
    markUsed: async (id, usedAt) => {
      const held = entries.get(id);
      if (held) entries.set(id, { ...held, usedAt });
    },
    remove: async (id) => {
      files.delete(id);
      entries.delete(id);
    },
  };
}
