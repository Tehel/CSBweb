/**
 * The interface and the viewport it shows, built together: the one wiring `ScreenComposer` and
 * the tools' `newUIState` (`tools/lib/ui.ts`) share.
 *
 * The `ViewportRenderer` draws the dungeon view over the game's dungeon and the party's
 * trail, and the `UIState` holds that view's buffer, the screen it draws into, the
 * game's `graphics.dat` tables and font, and the graphics cache the two share.
 */

import type { GraphicsLoader } from '../data/GraphicsLoader';
import type { CSBGraphicsLoader } from '../data/CSBGraphicsLoader';
import type { GraphicsTables } from '../data/tables/GraphicsTables';
import type { GameContext } from '../engine/GameContext';
import type { GameState } from '../engine/gameTypes';
import type { MonsterDesignOptions } from '../engine/monsterTypes';
import type { IndexedBitmap } from './csbwin/CanvasBlitter';
import { loadFontData } from './csbwin/TextRenderer';
import { ViewportRenderer } from './ViewportRenderer';
import { createUIState, type ScreenIndexBuffer, type UIHooks, type UIState } from './ui/UIState';
import type { HintOracleFiles } from './ui/HintOracleButton';

/** What the interface and its viewport read. */
export interface ScreenUIDeps {
  graphicsLoader: GraphicsLoader;
  /** The game's one set of `graphics.dat` tables, the one its `GameTables` was built from. */
  tables: GraphicsTables;
  /** The game's `GameContext`, CSBWin's `d.`, which the interface holds as `ui.ctx`. */
  ctx: GameContext;
  /** The 320x200 screen the interface draws into, `d.LogicalScreenBase`. */
  screen: ScreenIndexBuffer;
  csbGraphicsLoader?: CSBGraphicsLoader;
  /** The game's state, whose `tickCount` the viewport reads as `d.Time`: `ctx.state` (F19). */
  gameState?: GameState;
  /** The monster design options the viewport draws by: `ctx.rules` (F19). */
  rules?: MonsterDesignOptions;
  /** The Hint Oracle's files, where the data set has them (`src/renderer/ui/HintOracleButton.ts`). */
  hintOracle?: HintOracleFiles | null;
  /** Where a diagnostic of the drawing goes. */
  trace: (line: string) => void;
}

export function createScreenUI(deps: ScreenUIDeps, hooks: UIHooks): { ui: UIState; viewport: ViewportRenderer } {
  const { graphicsLoader, tables, ctx } = deps;
  const graphicCache = new Map<string, IndexedBitmap>();
  const viewport = new ViewportRenderer({
    graphicsLoader,
    dungeonState: ctx.dungeon,
    footprints: ctx.footprints,
    gameState: deps.gameState,
    rules: deps.rules,
    csbGraphicsLoader: deps.csbGraphicsLoader,
    viewportTables: tables.viewport,
    objectTables: tables.objects,
    palette552: tables.ui.graphic232.palette552,
    graphicCache,
    getGraphicBitmap: (graphicNum) => hooks.getGraphicBitmap(graphicNum),
    trace: deps.trace,
  });
  const ui = createUIState({
    graphicsLoader,
    ctx,
    viewport: viewport.buffer,
    csbGraphics: deps.csbGraphicsLoader,
    screenIndexBuffer: deps.screen,
    uiTables: tables.ui,
    objectTables: viewport.objectTables,
    fontData: loadFontData(graphicsLoader),
    graphicCache,
  }, hooks);
  ui.hintOracle = deps.hintOracle ?? null;
  return { ui, viewport };
}
