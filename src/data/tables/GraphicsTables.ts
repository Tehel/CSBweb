/**
 * Every table the port reads from `graphics.dat`, extracted once.
 *
 * CSBWin fills its `d.` tables from graphics `0x22e`, `0x22f`, `0x230`, `0x231` and `0x232`
 * once, when the game starts (`doc/CSBwin-src/Data.h`). `main.ts` and `tools/lib/game.ts`
 * call `extractGraphicsTables` once per `graphics.dat`: the engine's `GameTables` is built
 * from the result (`buildGameTables`), and the screen is handed the same object.
 */
import type { GraphicsLoader } from '../GraphicsLoader';
import { extractObjectTables, type ObjectTables } from './ObjectTables';
import { extractUITables, type UITables } from './UITables';
import { extractViewportTables, type ViewportTables } from './ViewportTables';

export interface GraphicsTables {
  /** Graphics `0x230`-`0x232`. */
  readonly ui: UITables;
  /** Graphic `0x22e`'s rectangles. */
  readonly viewport: ViewportTables;
  /** Graphic `0x22f`, and the object half of `0x22e`. */
  readonly objects: ObjectTables;
}

export function extractGraphicsTables(graphics: GraphicsLoader): GraphicsTables {
  const viewport = extractViewportTables(graphics);
  return {
    ui: extractUITables(graphics),
    viewport,
    objects: extractObjectTables(graphics, viewport.wallRectanglesOffset),
  };
}
