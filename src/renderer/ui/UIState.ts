/**
 * Shared state for the DM user interface.
 *
 * CSBWin keeps this in globals that `Mouse.cpp`, `CSBUI.cpp`, `Character.cpp` and
 * `Magic.cpp` all reach into. `GameScreen` owns the single instance and the UI
 * modules take it as their first argument, which keeps each of them a thin, greppable
 * translation of its C++ counterpart instead of another method on a god object.
 */
import type { GraphicsLoader } from '../../data/GraphicsLoader';
import type { OpenedSave, SaveEntry } from '../../data/saves';
import type { ImportAnswer, ImportResult, ImportedFile } from '../../engine/GameSaves';
import type { GameContext } from '../../engine/GameContext';
import { createInterfaceState } from '../../engine/InterfaceState';
import type { PartyState } from '../../engine/gameTypes';
import type { InterpreterContext } from '../bytecode/BytecodeInterpreter';
import type { IndexedBitmap, createPaletteIndexViewportBuffer } from '../csbwin/CanvasBlitter';
import type { KeyXlate, UIButton, UITables } from '../../data/tables/UITables';
import type { ObjectTables } from '../../data/tables/ObjectTables';
import type { FontData } from '../csbwin/TextRenderer';
import type { ImageFormat } from '../../core/imageDecoder';
import type { ObjectID } from '../../core/types';
import type { ItemDescriptionLine } from './Objects';
import type { HintSquare } from '../intro/HintOracle';
import type { HintOracleFiles } from './HintOracleButton';
import type { ReincarnateState } from './ReIncarnate';
import type { SaveMenuState } from './SaveMenu';
import type { SettingsDialogState, SettingsTab } from './SettingsDialog';
import type { MapDialogState } from './MapDialog';
import type { ChampionDialogState } from './ChampionDialog';
import type { Settings } from '../../settings/Settings';
import type { Fullscreen } from '../../lib/fullscreen';
import type { Dialog } from './Dialog';
import type { KeyboardLayoutMap } from './KeyLabels';

export enum UIMode {
  Adventure = 'adventure',
  Sleeping = 'sleeping',
  Frozen = 'frozen',
}

export type ScreenIndexBuffer = ReturnType<typeof createPaletteIndexViewportBuffer>;

/** `DescribeObject`'s eye panel for one object, as its viewing filter left it. */
export interface DescribedObject {
  objectId: ObjectID;
  /** A scroll's: the scroll to draw, the one the filter named or the one described. */
  scrollId: ObjectID;
  /** Anything else's: the lines under the name. */
  lines: ItemDescriptionLine[];
  /** Anything else's: whether a viewing filter rewrote those lines, which hides the item's properties. */
  rewritten: boolean;
}

export interface UIState {
  /* ---- data sources ---- */
  readonly graphicsLoader: GraphicsLoader;
  /**
   * The game's `GameContext`, CSBWin's `d.`: the dungeon, the party, and the systems the
   * interface calls as the C++ calls the engine (`ctx.systems.characterStats` for the
   * load and weight figures the engine acts on, so both come out of the same code).
   */
  readonly ctx: GameContext;
  /** The viewport's interpreter state, `ViewportRenderer.context`: what the view last drew. */
  context: InterpreterContext;
  /** `d.LogicalScreenBase`, the whole screen as palette indices. */
  screenIndexBuffer: ScreenIndexBuffer;
  readonly uiTables: UITables;
  readonly objectTables: ObjectTables;
  readonly fontData: FontData;
  /** The game's party, `ctx.party.state`. */
  readonly partyState: PartyState;
  /**
   * `ctx.party.generation` when the screen last composed (`GameScreen.syncParty`), or
   * read a game in play (`savedGameRead`): another value is another game.
   */
  partyGeneration: number;
  uiMode: UIMode;
  /**
   * The mode button 147 froze, which button 148 puts back with its lists and key tables:
   * CSBWin's `d.Pointer18982` / `Pointer18986` / `pKeyXlate18974` / `pKeyXlate18978`
   * (`doc/CSBwin-src/Mouse.cpp:1887-1890`, `:1905-1908`).
   */
  modeBeforeFreeze: UIMode;
  /**
   * `TAG02076e` has run and `TAG0207cc` has not: the movement-arrow, magic and weapon-ready
   * areas stay shaded (`doc/CSBwin-src/Character.cpp:5143-5157`) until `TAG0207cc` redraws
   * them (`CSBCode.cpp:10058-10090`). CSBWin draws these once and the screen holds them;
   * this port redraws every frame, so it keeps the state.
   */
  shadedByTag02076e: boolean;
  /**
   * `SetCursorShape(0)`, the arrow, is the cursor: `TAG02076e` set it
   * (`doc/CSBwin-src/Character.cpp:5158`), and nothing has set the cursor from the hand
   * since. `TAG002572` does (`CSBCode.cpp:2059-2080`): `TAG0207cc`'s (`:10089`) and
   * `RemoveObjectFromHand`'s (`Mouse.cpp:637`), and so does `ObjectToCursor`'s
   * `CreateObjectCursor` (`CSBCode.cpp:6923-6930`). An object moved in a Hall of Champions
   * candidate's inventory is therefore on the cursor, under the shading (`tag002572`).
   */
  arrowCursorShape: boolean;

  /* ---- interaction state ---- */
  /**
   * The Reincarnate name-entry screen while it is up, `null` otherwise
   * (`src/renderer/ui/ReIncarnate.ts`). Non-null means modal: every click and every
   * key goes to that module, which is how `keyboardMode = 2` behaves in CSBWin.
   */
  reincarnate: ReincarnateState | null;
  /**
   * The dialog up over the game, or `null` (`src/renderer/ui/Dialog.ts`). Non-null means
   * modal in the same sense `_WaitForMenuSelect` is: the host routes every click and
   * every key to it and consults no other button list
   * (`doc/CSBWIN_MENU_REFERENCE.md` -> "The modal loop").
   */
  dialog: Dialog | null;
  /** The save/load screen's state while it is the dialog (`src/renderer/ui/SaveMenu.ts`). */
  saveMenu: SaveMenuState | null;
  /** The settings dialog's state while it is the dialog (`src/renderer/ui/SettingsDialog.ts`). */
  settingsDialog: SettingsDialogState | null;
  /**
   * Where the settings dialog was when it last closed, its tab and KEYS' list scrolled:
   * where it opens again, for the page's life and kept nowhere (`openSettingsDialog`).
   */
  settingsDialogLast: { readonly tab: SettingsTab; readonly scrollTop: number };
  /** The map dialog's state while it is the dialog (`src/renderer/ui/MapDialog.ts`). */
  mapDialog: MapDialogState | null;
  /** The champion dialog's state while it is the dialog (`src/renderer/ui/ChampionDialog.ts`). */
  championDialog: ChampionDialogState | null;
  /**
   * `DiskMenuNeeded` (`doc/CSBwin-src/Data.h:159`). The disk icon's handler cannot open
   * the menu itself — CSBWin because that would recurse into `HandleMouseEvents`
   * (`doc/CSBwin-src/Mouse.cpp:1851-1858`), this port because the click is being drained
   * from the mouse queue — so it raises the flag and the caller acts on it.
   */
  diskMenuNeeded: boolean;
  /**
   * The Hint Oracle's files, where the data set has them: then the inventory's close box
   * is the Oracle's button (`src/renderer/ui/HintOracleButton.ts`).
   */
  hintOracle: HintOracleFiles | null;
  /** The Oracle's button was clicked: `diskMenuNeeded`'s twin, acted on by the same caller. */
  hintOracleNeeded: boolean;
  /**
   * The player put the party to sleep, button 145, or woke it, button 146: the
   * Sleepsave is due (`onSleepSave`), acted on by `diskMenuNeeded`'s caller once the
   * click is drained. A blow that wakes the party raises nothing. The port's own.
   */
  sleepSaveNeeded: boolean;
  /** The Oracle is up: it has the screen, and the interface draws nothing until it closes. */
  hintOracleUp: boolean;
  /**
   * What `_ClickOnEye`'s `DescribeObject(d.objectInHand, 1)` drew at the press
   * (`doc/CSBwin-src/Viewport.cpp:7287-7293`), kept for the composes until the release.
   * CSBWin draws that panel once, so its viewing filter runs once a press
   * (`doc/CSBwin-src/Character.cpp:3469-3544`, `:3741-3789`). Null with the eye released,
   * an empty hand or a chest in it. Made by `describeObject` (`ui/Inventory.ts`).
   */
  describedObject: DescribedObject | null;
  /**
   * What `TAG0189d4`'s `DescribeObject(objD7, 0)` drew for the scroll in the weapon hand
   * of the champion whose inventory is open (`doc/CSBwin-src/Character.cpp:3866-3914`),
   * kept for the composes until it runs again: at the inventory's opening, at the eye's
   * release and at a `DrawCharacterState` with `CHARFLAG_chestOrScroll`. Null with
   * anything else in the hand. Made by `tag0189d4` (`ui/Inventory.ts`).
   */
  weaponHandScroll: DescribedObject | null;
  hoverPoint: { x: number; y: number } | null;
  /**
   * `d.Word23144` — the marching order being changed: 0, or one more than the position,
   * relative to the party's facing, of the square a champion was picked up from
   * (`TAG0025a6`, `doc/CSBwin-src/CSBCode.cpp:2082`).
   */
  word23144: number;
  /**
   * `d.Word23118`, the pointer's hide count: `STHideCursor` raises it and takes the
   * pointer off as it leaves 0, `STShowCursor` lowers it and asks for the pointer back as
   * it returns to 0 (`doc/CSBwin-src/Mouse.cpp:1957-2002`); `drawCursorItem` draws none
   * while it is above 0. CSBWin's other pairs hide and show within one call, which the
   * port's composes never see; only the held eye and mouth hold it from the press to the
   * release (`stHideCursor`).
   */
  word23118: number;
  /**
   * `d.Pointer23178` and `d.Pointer23182` (`doc/CSBwin-src/CSBCode.cpp:1979-1980`), the
   * 32x16 cursor `TAG0025a6` makes of the square it picks up, for the palette above the
   * split and the one below it.
   */
  pointer23178: IndexedBitmap | null;
  pointer23182: IndexedBitmap | null;
  /**
   * The extra of `DEBT.md` H: an object in hand shown in its own colours over the dungeon
   * view, where CSBWin shows its colour-4 silhouette. On by default; one of the player's settings
   * (`src/settings/Settings.ts`) once the settings dialog has a place for it.
   */
  colouredObjectCursor: boolean;
  /**
   * Where that extra drew the object this frame, for the screen to show through the
   * interface palette rather than the viewport's; `null` when it drew none.
   */
  objectCursorFootprint: { x: number; y: number; bitmap: IndexedBitmap } | null;

  /* ---- the attack menu (doc/CSBwin-src/Character.cpp) ---- */
  /**
   * What the option list's last `DrawLegalAttackTypes` drew: its `numAttackOption`, which
   * chose the backdrop, and the three names, the action name filter's included.
   */
  attackOptionCount: number;
  attackOptionNames: string[];
  /**
   * The ordinal `TAG01b1c0` cleared (`doc/CSBwin-src/Character.cpp:4904-4922`), whose menu
   * is still on CSBWin's screen: nothing draws over it until the panel's next
   * `DrawLegalAttackTypes` or `FlashAttackDamage`, which set it back to 0.
   */
  closedAttackMenuOrdinal: number;
  /** The damage figure on the panel (0 for none), and when its flash ends. See `ui/Attack.ts`. */
  attackFlashValue: number;
  attackFlashUntilMs: number;
  /**
   * The damage `DisplayCharacterDamage` blitted into each champion's box
   * (`doc/CSBwin-src/CSBCode.cpp:7180-7230`), still on CSBWin's screen, or null: the HP
   * lost, and whether it went over the portrait of an open inventory (graphic 16) or
   * over the name (graphic 15). `TAG011366` draws over it. See `ui/Character.ts`.
   */
  characterDamage: ({ damage: number; inventoryOpen: boolean } | null)[];
  openChestIconIndex: number | null;
  mouthChewStartMs: number | null;
  mouthChewEndMs: number;
  mouthChewFrameHandle: number | null;
  primaryButtons: UIButton[] | null;   // graphic231 -> buttons17196
  secondaryButtons: UIButton[] | null; // graphic231 -> buttons17304
  /** `d.pKeyXlate2` / `d.pKeyXlate1`, the key tables `TAG0196da` searches, in that order. */
  keyXlate2: KeyXlate[] | null;        // graphic231 -> Byte18400
  keyXlate1: KeyXlate[] | null;        // graphic231 -> Byte18428

  /* ---- bitmap caches ---- */
  graphicCache: Map<string, IndexedBitmap>;
  cursorArrowBitmap: IndexedBitmap | null;
  cursorHandBitmap: IndexedBitmap | null;
  portraitSheet: IndexedBitmap | null | undefined;
  portraitCache: Map<number, IndexedBitmap>;
  /**
   * `CHARDESC.portrait` unpacked, keyed by the champion's own pixel array — champions
   * loaded from a genuine CSBWin save carry their picture rather than a graphic-26
   * index, and it must not be rebuilt on every frame.
   */
  championPortraitCache: WeakMap<object, IndexedBitmap>;

  /* ---- hooks out to the page ---- */
  /**
   * The name-entry screen has been answered and the engine has finished Reincarnate
   * (`HallOfChampions.reincarnateNamed`, `doc/CSBwin-src/Code13ea4.cpp:167-172`): the
   * page redraws the view the screen covered.
   */
  readonly onReincarnated: () => void;
  /** The saves the save/load screen lists, newest first (`GameSaves.list`). */
  readonly onListSaves: () => Promise<SaveEntry[]>;
  /** Every data set's saves, newest first: the entrance's RISE lists them (`GameSaves.listEverySet`). */
  readonly onListEverySave: () => Promise<SaveEntry[]>;
  /**
   * RISE's LOAD: a new adventure made from a listed save, stored and opened, to be
   * restored as any opened save is (`GameSaves.makeNewAdventure`), its DM champions
   * with the utility disk's portraits when `newFaces` (RISE's NEW FACE). Throws the
   * utility's refusal, which goes to `onRestoreFailed`.
   */
  readonly onMakeNewAdventure: (source: SaveEntry, newFaces?: boolean) => Promise<OpenedSave>;
  /**
   * Whether the data set has the utility disk's portraits (`UTILITY_PORTRAITS_FILE`,
   * `src/data/UtilityPortraits.ts`): RISE's dialog has its NEW FACE toggle only then.
   */
  readonly onHasNewFaces: () => Promise<boolean>;
  /** A listed save out of the store (`GameSaves.open`). */
  readonly onReadSave: (entry: SaveEntry) => Promise<OpenedSave>;
  /**
   * Build a save and write it to the store, over the listed save `over`, as a new row
   * for `null`, or over F5's slot for `'quick'`; resolves to the row it was written as
   * (`GameSaves.save`, `src/engine/GameSaves.ts`). A hook because serializing the world
   * is the engine's business, not the UI's.
   */
  readonly onSaveGame: (over: SaveEntry | 'quick' | null) => Promise<SaveEntry>;
  /**
   * Whether the running game is CSB's prison, where a save asks "BEGIN THE ADVENTURE?"
   * (`GameSaves.inPrison`).
   */
  readonly isPrison: () => boolean;
  /**
   * Hand the player a listed save's file, the bare `.dat` out of the store: the page
   * downloads it (`downloadSaveFile`, `src/data/saves/downloadSaveFile.ts`).
   */
  readonly onExportSave: (entry: SaveEntry) => Promise<void>;
  /** Delete a listed save from the store (`GameSaves.remove`, `src/engine/GameSaves.ts`). */
  readonly onDeleteSave: (entry: SaveEntry) => Promise<void>;
  /**
   * Take a file dropped on the save/load screen into the store, a slightly different
   * dungeon's once the player has `answer`ed; resolves to the row it was stored as, or to
   * why it was not (`GameSaves.importSave`, `src/engine/GameSaves.ts`). Throws with a
   * short message on a file that does not read.
   */
  readonly onImportSave: (file: ImportedFile, answer: ImportAnswer | null) => Promise<ImportResult>;
  /** Restore an opened save into the running game. Throws with a short message on refusal. */
  readonly onRestoreSave: (save: OpenedSave) => void;
  /**
   * The load-only chooser's `onRestoreSave` threw: `_ReadEntireGame`'s read failed, and
   * its caller goes to `tag01efee` (`src/renderer/intro/BootSequence.ts`). Or RISE's
   * `onMakeNewAdventure` did, and the entrance shows why.
   */
  readonly onRestoreFailed: (error: unknown) => void;
  /**
   * Run the Hint Oracle on `square`, then `closeHintOracle` (`GameScreen.closeHintOracle`):
   * the page builds the screen it runs on (`runHintOracle`, `src/renderer/intro/BootSequence.ts`).
   */
  readonly onOpenHintOracle: (square: HintSquare) => void;
  /**
   * Write the playthrough's Sleepsave (`GameSaves.sleepSave`, `src/engine/GameSaves.ts`),
   * as `sleepSaveNeeded` asks. Silent, and awaited by nobody.
   */
  readonly onSleepSave: () => void;
  /**
   * Leave the game for the welcome page, as the settings dialog's EXIT does once the
   * player has answered: the page opens itself without `?dungeon=` (`welcomePageQuery`,
   * `src/ui/welcomePage.ts`).
   */
  readonly onExit: () => void;
  /**
   * The player's settings (`src/settings/Settings.ts`), which the settings dialog reads
   * and changes: the page applies a change as its every listener is told.
   */
  readonly settings: Settings;
  /** Whether the browser can show the CRT effect: it gives WebGL (`src/lib/crt.ts`). */
  readonly isCrtAvailable: () => boolean;
  /**
   * The page in fullscreen (`src/lib/fullscreen.ts`): DISPLAY's FULLSCREEN turns it over,
   * and is inert where the browser cannot.
   */
  readonly fullscreen: Fullscreen;
  /**
   * What the player's keyboard prints on each key, as the browser gives it
   * (`navigator.keyboard.getLayoutMap()`), or `null` where it does not: the KEYS tab's
   * labels (`KeyLabels.ts`).
   */
  readonly keyboardLayout: () => KeyboardLayoutMap | null;
  /**
   * Move the party to the square `(x, y)` of map `map`, or `null` where the page does not
   * let a press held on the map dialog do it: only a page opened with `?dev` does.
   */
  readonly onTeleport: ((map: number, x: number, y: number) => void) | null;

  /* ---- back into the renderer ---- */
  getGraphicBitmap(graphicNum: number, format?: ImageFormat): IndexedBitmap | null;
  /** Re-blit the last rendered frame; used by animations that run off the game clock. */
  renderLastFrame(): void;
}

/** The fields of `UIState` that a game in play sets, and a restart clears. */
type PlayState = Pick<UIState,
  | 'uiMode' | 'modeBeforeFreeze' | 'shadedByTag02076e' | 'arrowCursorShape' | 'reincarnate' | 'diskMenuNeeded' | 'hintOracleNeeded' | 'sleepSaveNeeded'
  | 'describedObject' | 'weaponHandScroll' | 'word23144' | 'word23118' | 'pointer23178' | 'pointer23182'
  | 'attackOptionCount' | 'attackOptionNames' | 'closedAttackMenuOrdinal' | 'attackFlashValue' | 'attackFlashUntilMs'
  | 'characterDamage'
  | 'openChestIconIndex'>;

/**
 * The screen's share of `d` as a game begins: `d.Initialize()` zeroes the whole of `d`
 * (`doc/CSBwin-src/CSBCode.cpp:333-340`), and `TAG021028` sets the adventure's lists
 * (`:10597-10614`). The share the engine reads too is `ctx.interface`'s
 * (`createInterfaceState`).
 */
function initialPlayState(): PlayState {
  return {
    uiMode: UIMode.Adventure,
    modeBeforeFreeze: UIMode.Adventure,
    shadedByTag02076e: false,
    arrowCursorShape: false,
    reincarnate: null,
    diskMenuNeeded: false,
    hintOracleNeeded: false,
    sleepSaveNeeded: false,
    describedObject: null,
    weaponHandScroll: null,
    word23144: 0,
    word23118: 0,
    pointer23178: null,
    pointer23182: null,
    attackOptionCount: 0,
    attackOptionNames: ['', '', ''],
    closedAttackMenuOrdinal: 0,
    attackFlashValue: 0,
    attackFlashUntilMs: 0,
    characterDamage: [null, null, null, null],
    openChestIconIndex: null,
  };
}

/**
 * A restarted game's `d.Initialize()` and `TAG021028` (`doc/CSBwin-src/Code1f9e6.cpp:309`,
 * `:318`), the screen's half and `ctx.interface`: no open chest, attack menu,
 * marching-order drag or sleep left over from the lost game. The caller sets the button
 * lists for `uiMode`.
 */
export function initializePlayState(ui: UIState): void {
  Object.assign(ui, initialPlayState());
  Object.assign(ui.ctx.interface, createInterfaceState());
}

/**
 * A saved game read in play (`GameHost.savedGameRead`), which only the port has: CSBWin
 * reads a game only after `d.Initialize()` (`doc/CSBwin-src/CSBCode.cpp:333-340`), so the
 * screen's share of `d` is a new game's, as `initialPlayState` leaves it, and the party
 * is the one read. `ctx.interface` is the engine's to reset (`initializeGameContext`). The
 * caller sets the button lists.
 */
export function savedGameRead(ui: UIState): void {
  Object.assign(ui, initialPlayState());
  ui.partyGeneration = ui.ctx.party.generation;
}

/** What the interface reads, all of it there before the first frame. */
type UISources = Pick<UIState,
  | 'graphicsLoader' | 'ctx' | 'context' | 'screenIndexBuffer' | 'uiTables' | 'objectTables'
  | 'fontData' | 'graphicCache'>;

/** What the interface asks of the screen and of the page. */
export type UIHooks = Pick<UIState,
  | 'getGraphicBitmap' | 'renderLastFrame'
  | 'onReincarnated' | 'onListSaves' | 'onListEverySave' | 'onReadSave' | 'onMakeNewAdventure' | 'onHasNewFaces' | 'onSaveGame' | 'isPrison' | 'onExportSave' | 'onDeleteSave' | 'onImportSave' | 'onRestoreSave' | 'onRestoreFailed' | 'onOpenHintOracle' | 'onSleepSave' | 'onExit'
  | 'settings' | 'isCrtAvailable' | 'fullscreen' | 'keyboardLayout' | 'onTeleport'>;

export function createUIState(sources: UISources, hooks: UIHooks): UIState {
  return {
    ...sources,
    get partyState() { return this.ctx.party.state; },
    partyGeneration: sources.ctx.party.generation,
    ...initialPlayState(),
    dialog: null,
    saveMenu: null,
    settingsDialog: null,
    settingsDialogLast: { tab: 'game', scrollTop: 0 },
    mapDialog: null,
    championDialog: null,
    hintOracle: null,
    hintOracleUp: false,
    hoverPoint: null,
    mouthChewStartMs: null,
    mouthChewEndMs: 0,
    mouthChewFrameHandle: null,
    primaryButtons: null,
    secondaryButtons: null,
    keyXlate2: null,
    keyXlate1: null,

    colouredObjectCursor: true,
    objectCursorFootprint: null,
    cursorArrowBitmap: null,
    cursorHandBitmap: null,
    portraitSheet: undefined,
    portraitCache: new Map(),
    championPortraitCache: new WeakMap(),

    ...hooks,
  };
}

/**
 * `TAG002572` (`doc/CSBwin-src/CSBCode.cpp:2059-2080`): the cursor set from the hand, the
 * hand or the arrow for an empty one, the object's cursor for a full one. The port draws
 * those from the hand every frame (`drawCursorItem`), so what is left of it is the end of
 * the arrow `TAG02076e`'s `SetCursorShape(0)` put up. `RemoveObjectFromHand` calls it
 * (`Mouse.cpp:637`), and `ObjectToCursor`'s `CreateObjectCursor` has the same effect
 * (`CSBCode.cpp:6923-6930`, `:2005-2013`).
 */
export function tag002572(ui: UIState): void {
  ui.arrowCursorShape = false;
}

/**
 * `STHideCursor` (`doc/CSBwin-src/Mouse.cpp:1978-2002`): `_ClickOnEye`'s `HC47`
 * (`doc/CSBwin-src/Viewport.cpp:7282`) and `_FeedCharacter`'s `HC5`
 * (`doc/CSBwin-src/Character.cpp:4071`), until the release's `stShowCursor`.
 */
export function stHideCursor(ui: UIState): void {
  ui.word23118++;
}

/** `STShowCursor` (`doc/CSBwin-src/Mouse.cpp:1957-1972`). */
export function stShowCursor(ui: UIState): void {
  ui.word23118--;
}

/** CSBWin drives animation off the VBL counter; the browser gives us a wall clock. */
export function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}
