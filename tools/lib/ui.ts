/**
 * How a tool builds the interface's state: whole, through `GameScreen`'s own factory
 * (`createScreenUI`).
 *
 * `newUIState` hands it the game's tables from `graphics`, a blank 320x200 screen, and
 * no game state, design options or CSB graphics for the viewport (F19), which has drawn
 * no view yet, with the empty picking the screen has before its first frame. A tool replaces
 * the screen, the viewport or the picking afterwards to draw into a buffer of its own or
 * to stage a view. The hooks do nothing unless the tool passes its
 * own; the save/load screen lists no save, and `onReadSave`, `onMakeNewAdventure`,
 * `onSaveGame`, `onExportSave`, `onDeleteSave` and `onImportSave` throw, as there is no store and no world to serialize.
 * The settings are the defaults, kept nowhere, the CRT effect can be shown, and there is
 * no fullscreen. The map
 * dialog moves no party, as on a page opened without `?dev`, and EXIT leaves for nothing.
 *
 * The game's host draws on it what the page's does (`ui/HostDrawing.ts`), after whatever
 * the tool's own host does there, and asks it whether the damage's flash holds and for a
 * portrait the tool's host does not give: the engine does their `d.` work, and a click on
 * the screen goes through it.
 */
import type { GraphicsLoader } from '../../src/data/GraphicsLoader';
import type { GameContext } from '../../src/engine/GameContext';
import { NO_FULLSCREEN } from '../../src/lib/fullscreen';
import { createPaletteIndexViewportBuffer } from '../../src/renderer/csbwin/CanvasBlitter';
import { Settings } from '../../src/settings/Settings';
import { hostDrawing } from '../../src/renderer/ui/HostDrawing';
import type { UIHooks, UIState } from '../../src/renderer/ui/UIState';
import { createScreenUI } from '../../src/renderer/ScreenUI';
import { SCREEN_HEIGHT, SCREEN_WIDTH } from '../../src/renderer/ViewportGraphics';
import { graphicsTablesOf } from './game';

export function newUIState(graphics: GraphicsLoader, ctx: GameContext, hooks: Partial<UIHooks> = {}): UIState {
  const tables = graphicsTablesOf(graphics);
  const getGraphicBitmap = hooks.getGraphicBitmap ?? (() => null);
  const { ui } = createScreenUI({
    graphicsLoader: graphics,
    tables,
    ctx,
    screen: createPaletteIndexViewportBuffer(SCREEN_WIDTH, SCREEN_HEIGHT, 0),
    trace: (line) => console.log(line),
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
    onDeleteSave: () => { throw new Error('no save to delete in this tool'); },
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
  // The tool's own host first, then the drawing over it, as the page's engine does its
  // `d.` work before its host draws.
  const host = ctx.host;
  const own = { ...host };
  const drawing = hostDrawing(() => ui);
  host.showHideInventory = (chIdx) => { own.showHideInventory(chIdx); drawing.showHideInventory(chIdx); };
  host.releaseEyeOrMouth = (eye) => { own.releaseEyeOrMouth(eye); drawing.releaseEyeOrMouth(eye); };
  host.tag02076e = () => { own.tag02076e(); drawing.tag02076e(); };
  host.tag0207cc = () => { own.tag0207cc(); drawing.tag0207cc(); };
  host.savedGameRead = () => { own.savedGameRead(); drawing.savedGameRead(); };
  host.tag01b1c0 = (chIdx) => { own.tag01b1c0(chIdx); drawing.tag01b1c0(chIdx); };
  host.drawLegalAttackTypes = (options) => { own.drawLegalAttackTypes(options); drawing.drawLegalAttackTypes(options); };
  host.flashAttackDamage = (damage) => { own.flashAttackDamage(damage); drawing.flashAttackDamage(damage); };
  host.attackFlashHeld = () => own.attackFlashHeld() || drawing.attackFlashHeld();
  host.displayCharacterDamage = (chIdx, damage) => { own.displayCharacterDamage(chIdx, damage); drawing.displayCharacterDamage(chIdx, damage); };
  host.tag011366 = (chIdx) => { own.tag011366(chIdx); drawing.tag011366(chIdx); };
  host.drawCharacterState = (chIdx, charFlags) => { own.drawCharacterState(chIdx, charFlags); drawing.drawCharacterState(chIdx, charFlags); };
  host.portraitOf = (champion) => own.portraitOf(champion) ?? drawing.portraitOf(champion);
  return ui;
}
