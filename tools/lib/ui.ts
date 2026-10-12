/**
 * How a tool builds the interface's state: whole, as `GameScreen` builds it.
 *
 * `newUIState` hands `createUIState` the game's tables and font from `graphics`, a blank
 * 320x200 screen, and the interpreter context of a `ViewportRenderer` over `ctx` that has
 * drawn no view yet (no room summary, no object buttons: what the screen has before its
 * first frame). A tool replaces the screen or the context afterwards to draw into a
 * buffer of its own or to stage a view. The hooks do nothing unless the tool passes its
 * own; the save/load screen lists no save, and `onReadSave`, `onMakeNewAdventure`,
 * `onSaveGame`, `onExportSave` and `onImportSave` throw, as there is no store and no world to serialize.
 * The settings are the defaults, kept nowhere, the CRT effect can be shown, and there is
 * no fullscreen. The map
 * dialog moves no party, as on a page opened without `?dev`, and EXIT leaves for nothing.
 */
import type { GraphicsLoader } from '../../src/data/GraphicsLoader';
import type { GameContext } from '../../src/engine/GameContext';
import { NO_FULLSCREEN } from '../../src/lib/fullscreen';
import { createPaletteIndexViewportBuffer, type IndexedBitmap } from '../../src/renderer/csbwin/CanvasBlitter';
import { loadFontData } from '../../src/renderer/csbwin/TextRenderer';
import { Settings } from '../../src/settings/Settings';
import { createUIState, type UIHooks, type UIState } from '../../src/renderer/ui/UIState';
import { SCREEN_HEIGHT, SCREEN_WIDTH } from '../../src/renderer/ViewportGraphics';
import { ViewportRenderer } from '../../src/renderer/ViewportRenderer';
import { graphicsTablesOf } from './game';

export function newUIState(graphics: GraphicsLoader, ctx: GameContext, hooks: Partial<UIHooks> = {}): UIState {
  const tables = graphicsTablesOf(graphics);
  const getGraphicBitmap = hooks.getGraphicBitmap ?? (() => null);
  const graphicCache = new Map<string, IndexedBitmap>();
  const viewport = new ViewportRenderer({
    graphicsLoader: graphics,
    dungeonState: ctx.dungeon,
    footprints: ctx.footprints,
    viewportTables: tables.viewport,
    objectTables: tables.objects,
    palette552: tables.ui.graphic232.palette552,
    graphicCache,
    getGraphicBitmap: (graphicNum) => getGraphicBitmap(graphicNum),
  });
  return createUIState({
    graphicsLoader: graphics,
    ctx,
    context: viewport.context,
    screenIndexBuffer: createPaletteIndexViewportBuffer(SCREEN_WIDTH, SCREEN_HEIGHT, 0),
    uiTables: tables.ui,
    objectTables: tables.objects,
    fontData: loadFontData(graphics),
    graphicCache,
  }, {
    renderLastFrame: () => {},
    onReincarnated: () => {},
    onListSaves: async () => [],
    onListEverySave: async () => [],
    onReadSave: () => { throw new Error('no save to read in this tool'); },
    onMakeNewAdventure: () => { throw new Error('no save to make an adventure from in this tool'); },
    onHasNewFaces: async () => false,
    onSaveGame: () => { throw new Error('no world to save in this tool'); },
    isPrison: () => false,
    onExportSave: () => { throw new Error('no save to export in this tool'); },
    onImportSave: () => { throw new Error('no store to import into in this tool'); },
    onRestoreSave: () => {},
    onRestoreFailed: () => {},
    onOpenHintOracle: () => {},
    onSleepSave: () => {},
    onExit: () => {},
    settings: new Settings(null),
    isCrtAvailable: () => true,
    fullscreen: NO_FULLSCREEN,
    keyboardLayout: () => null,
    onTeleport: null,
    ...hooks,
    getGraphicBitmap,
  });
}
