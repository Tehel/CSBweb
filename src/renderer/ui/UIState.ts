/**
 * Shared state for the DM user interface.
 *
 * CSBWin keeps this in globals that `Mouse.cpp`, `CSBUI.cpp`, `Character.cpp` and
 * `Magic.cpp` all reach into. `GameScreen` owns the single instance and the UI
 * modules take it as their first argument, which keeps each of them a thin, greppable
 * translation of its C++ counterpart instead of another method on a god object.
 */
import type { GraphicsLoader } from '../../data/GraphicsLoader';
import type { GameContext } from '../../engine/GameContext';
import type { PartyState } from '../../engine/gameTypes';
import type { InterpreterContext } from '../bytecode/BytecodeInterpreter';
import type { IndexedBitmap, createPaletteIndexViewportBuffer } from '../csbwin/CanvasBlitter';
import type { KeyXlate, UIButton, UITables } from '../../data/tables/UITables';
import type { ObjectTables } from '../../data/tables/ObjectTables';
import type { FontData } from '../csbwin/TextRenderer';
import type { ImageFormat } from '../../core/imageDecoder';
import { OBJECT_ID_NULL, type ObjectID } from '../../core/types';
import type { ReincarnateState } from './ReIncarnate';
import type { SaveMenuState } from './SaveMenu';

/** Eight empty chest slots, each `RNnul`. */
export function emptyChestContents(): ObjectID[] {
  return new Array<ObjectID>(8).fill(OBJECT_ID_NULL);
}

export enum UIMode {
  Adventure = 'adventure',
  Sleeping = 'sleeping',
  Frozen = 'frozen',
}

export type ScreenIndexBuffer = ReturnType<typeof createPaletteIndexViewportBuffer>;

export interface UIState {
  /* ---- data sources ---- */
  readonly graphicsLoader: GraphicsLoader;
  /**
   * The game's `GameContext`, CSBWin's `d.`: the dungeon, the party, and the systems the
   * interface calls as the C++ calls the engine (`ctx.systems.characterStats` for the
   * load and weight figures the engine acts on, so both come out of the same code).
   */
  readonly ctx: GameContext;
  context: InterpreterContext | null;
  screenIndexBuffer: ScreenIndexBuffer | null;
  uiTables: UITables | null;
  objectTables: ObjectTables | null;
  fontData: FontData | null;
  partyState: PartyState | null;
  uiMode: UIMode;
  /**
   * The mode button 147 froze, which button 148 puts back with its lists and key tables:
   * CSBWin's `d.Pointer18982` / `Pointer18986` / `pKeyXlate18974` / `pKeyXlate18978`
   * (`doc/CSBwin-src/Mouse.cpp:1748-1751`, `:1766-1769`).
   */
  modeBeforeFreeze: UIMode;
  /**
   * `TAG02076e` has run and `TAG0207cc` has not: the movement-arrow, magic and weapon-ready
   * areas stay shaded, and `SetCursorShape(0)` keeps the arrow cursor
   * (`doc/CSBwin-src/Character.cpp:5118-5133`) until `TAG0207cc` redraws the areas and
   * its `TAG002572` sets the cursor from the hand again (`CSBCode.cpp:9934-9966`). CSBWin
   * draws these once and the screen holds them; this port redraws every frame, so it
   * keeps the state.
   */
  shadedByTag02076e: boolean;

  /* ---- interaction state ---- */
  /**
   * The Reincarnate name-entry screen while it is up, `null` otherwise
   * (`src/renderer/ui/ReIncarnate.ts`). Non-null means modal: every click and every
   * key goes to that module, which is how `keyboardMode = 2` behaves in CSBWin.
   */
  reincarnate: ReincarnateState | null;
  /**
   * The save/load screen while it is up (`src/renderer/ui/SaveMenu.ts`). Non-null means
   * modal in the same sense `_WaitForMenuSelect` is: the host routes every click and
   * every key to that module and consults no other button list
   * (`doc/CSBWIN_MENU_REFERENCE.md` -> "The modal loop").
   */
  saveMenu: SaveMenuState | null;
  /**
   * `DiskMenuNeeded` (`doc/CSBwin-src/Data.h:159`). The disk icon's handler cannot open
   * the menu itself — CSBWin because that would recurse into `HandleMouseEvents`
   * (`doc/CSBwin-src/Mouse.cpp:1712-1719`), this port because the click is being drained
   * from the mouse queue — so it raises the flag and the caller acts on it.
   */
  diskMenuNeeded: boolean;
  pressingEye: boolean;
  hoverPoint: { x: number; y: number } | null;
  /**
   * `d.Word23144` — the marching order being changed: 0, or one more than the position,
   * relative to the party's facing, of the square a champion was picked up from
   * (`TAG0025a6`, `doc/CSBwin-src/CSBCode.cpp:2053`).
   */
  word23144: number;
  /**
   * `d.Pointer23178` and `d.Pointer23182` (`doc/CSBwin-src/CSBCode.cpp:1950-1951`), the
   * 32x16 cursor `TAG0025a6` makes of the square it picks up, for the palette above the
   * split and the one below it.
   */
  pointer23178: IndexedBitmap | null;
  pointer23182: IndexedBitmap | null;
  /**
   * The extra of `DEBT.md` H: an object in hand shown in its own colours over the dungeon
   * view, where CSBWin shows its colour-4 silhouette. On by default; a `UISettings` toggle
   * once the port has a settings menu.
   */
  colouredObjectCursor: boolean;
  /**
   * Where that extra drew the object this frame, for the screen to show through the
   * interface palette rather than the viewport's; `null` when it drew none.
   */
  objectCursorFootprint: { x: number; y: number; bitmap: IndexedBitmap } | null;

  /* ---- the attack menu (doc/CSBwin-src/Character.cpp) ---- */
  /** `d.AttackingCharacterOrdinal` — 1-based champion with the menu open, 0 for none. */
  attackingCharacterOrdinal: number;
  /** `d.PossibleAttackTypes[4]` — the offered `ATTACKTYPE`s; -1 marks an empty slot. */
  possibleAttackTypes: Int8Array;
  /** `d.Byte20256[4]` — the mastery each option demanded, for the panel's dots. */
  byte20256: Uint8Array;
  /** `d.Word20248` — how many of `possibleAttackTypes` are real. */
  word20248: number;
  /** `d.Word20250` — the panel owes a redraw. */
  word20250: number;
  /** `d.Word20252` — 1 shows the four attack buttons, 0 the option list. */
  word20252: number;
  /**
   * The ordinal `TAG01b1c0` cleared (`doc/CSBwin-src/Character.cpp:4887-4897`), whose menu
   * is still on CSBWin's screen: nothing draws over it until the panel's next
   * `DrawLegalAttackTypes` or `FlashAttackDamage`, which set it back to 0.
   */
  closedAttackMenuOrdinal: number;
  /** The damage figure on the panel (0 for none), and when its flash ends. See `ui/Attack.ts`. */
  attackFlashValue: number;
  attackFlashUntilMs: number;
  /**
   * The damage `DisplayCharacterDamage` blitted into each champion's box
   * (`doc/CSBwin-src/CSBCode.cpp:7121-7171`), still on CSBWin's screen, or null: the HP
   * lost, and whether it went over the portrait of an open inventory (graphic 16) or
   * over the name (graphic 15). `TAG011366` draws over it. See `ui/Character.ts`.
   */
  characterDamage: ({ damage: number; inventoryOpen: boolean } | null)[];
  /**
   * `d.DisplayResurrectChestOrScroll` (`doc/CSBwin-src/Character.cpp:3838`) — what the
   * eye panel is currently showing, which is also what a click in it means: 5 the
   * Resurrect/Reincarnate/Cancel menu, 4 an open chest, 0 anything else. Written by
   * `TAG0189d4`'s port in `drawInventoryScreen`, read by `tag01a6ea`.
   */
  displayResurrectChestOrScroll: number;
  openChestId: ObjectID | null;
  /** `d.rnChestContents[8]` — the open chest's objects, `RNnul` in an empty slot. */
  openChestContents: ObjectID[];
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

  /* ---- hooks out to the engine / host ---- */
  onSpellCast?: (chIdx: number) => number | void;
  /** `Attack(chIdx, attackType)` — into `engine/AttackSystem`. */
  onChampionAttack?: (chIdx: number, attackType: number) => number;
  /** `d.attackDamageToDisplay`, read and cleared. */
  onConsumeAttackDamage?: () => number;
  /**
   * `_ResurrectReincarnateCancel(button)` (`doc/CSBwin-src/CSBCode.cpp:6615`) — a
   * button on the Hall of Champions menu. A hook because confirming reaches the
   * dungeon's object chains and the mirror's actuators, none of which the UI owns.
   */
  onResurrectReincarnateCancel?: (button: number) => void;
  /**
   * The name-entry screen has been answered (`doc/CSBwin-src/Code13ea4.cpp:155-160`).
   * A hook because everything `_ResurrectReincarnateCancel` does *after* `ReIncarnate`
   * returns — the skill wipe, the penalties, the twelve random points, the message —
   * belongs to the engine.
   */
  onReincarnateNamed?: (chIdx: number, name: string, title: string) => void;
  /**
   * Build the bytes of a new save and the row it will be listed as
   * (`src/engine/SaveGamePayload.ts`). A hook because serializing the world is the
   * engine's business, not the UI's.
   */
  onCreateSave?: () => { meta: { name: string; savedAt: number; level: number; champions: string[] }; bytes: Uint8Array };
  /** The save `onCreateSave` built is written: `Game.saveWritten`. */
  onSaveWritten?: () => void;
  /** Restore a save's bytes into the running game. Throws with a short message on refusal. */
  onRestoreSave?: (bytes: Uint8Array) => void;
  /**
   * The load-only chooser's `onRestoreSave` threw: `_ReadEntireGame`'s read failed, and
   * its caller goes to `tag01efee` (`src/renderer/intro/BootSequence.ts`).
   */
  onRestoreFailed?: (error: unknown) => void;

  /* ---- back into the renderer ---- */
  getGraphicBitmap(graphicNum: number, format?: ImageFormat): IndexedBitmap | null;
  /** Re-blit the last rendered frame; used by animations that run off the game clock. */
  renderLastFrame(): void;
}

/** The fields of `UIState` that a game in play sets, and a restart clears. */
type PlayState = Pick<UIState,
  | 'uiMode' | 'modeBeforeFreeze' | 'shadedByTag02076e' | 'reincarnate' | 'diskMenuNeeded'
  | 'pressingEye' | 'word23144' | 'pointer23178' | 'pointer23182'
  | 'attackingCharacterOrdinal' | 'possibleAttackTypes' | 'byte20256' | 'word20248'
  | 'word20250' | 'word20252' | 'closedAttackMenuOrdinal' | 'attackFlashValue' | 'attackFlashUntilMs'
  | 'characterDamage'
  | 'displayResurrectChestOrScroll' | 'openChestId' | 'openChestContents' | 'openChestIconIndex'>;

/**
 * The screen's share of `d` as a game begins: `d.Initialize()` zeroes the whole of `d`
 * (`doc/CSBwin-src/CSBCode.cpp:323-330`), and `TAG021028` sets the adventure's lists and
 * `d.Word20252` (`:10473-10490`).
 */
function initialPlayState(): PlayState {
  return {
    uiMode: UIMode.Adventure,
    modeBeforeFreeze: UIMode.Adventure,
    shadedByTag02076e: false,
    reincarnate: null,
    diskMenuNeeded: false,
    pressingEye: false,
    word23144: 0,
    pointer23178: null,
    pointer23182: null,
    attackingCharacterOrdinal: 0,
    possibleAttackTypes: Int8Array.from([-1, -1, -1, -1]),
    byte20256: new Uint8Array(4),
    word20248: 0,
    word20250: 0,
    // The panel starts showing the four attack buttons.
    word20252: 1,
    closedAttackMenuOrdinal: 0,
    attackFlashValue: 0,
    attackFlashUntilMs: 0,
    characterDamage: [null, null, null, null],
    displayResurrectChestOrScroll: 0,
    openChestId: null,
    openChestContents: emptyChestContents(),
    openChestIconIndex: null,
  };
}

/**
 * A restarted game's `d.Initialize()` and `TAG021028` (`doc/CSBwin-src/Code1f9e6.cpp:309`,
 * `:318`), the screen's half: no open chest, attack menu, marching-order drag or
 * sleep left over from the lost game. The caller sets the button lists for `uiMode`.
 */
export function initializePlayState(ui: UIState): void {
  Object.assign(ui, initialPlayState());
}

export function createUIState(
  graphicsLoader: GraphicsLoader,
  ctx: GameContext,
  hooks: Pick<UIState, 'getGraphicBitmap' | 'renderLastFrame'>,
): UIState {
  return {
    graphicsLoader,
    ctx,
    context: null,
    screenIndexBuffer: null,
    uiTables: null,
    objectTables: null,
    fontData: null,
    partyState: null,
    ...initialPlayState(),
    saveMenu: null,
    hoverPoint: null,
    mouthChewStartMs: null,
    mouthChewEndMs: 0,
    mouthChewFrameHandle: null,
    primaryButtons: null,
    secondaryButtons: null,
    keyXlate2: null,
    keyXlate1: null,

    graphicCache: new Map(),
    colouredObjectCursor: true,
    objectCursorFootprint: null,
    cursorArrowBitmap: null,
    cursorHandBitmap: null,
    portraitSheet: undefined,
    portraitCache: new Map(),
    championPortraitCache: new WeakMap(),

    getGraphicBitmap: hooks.getGraphicBitmap,
    renderLastFrame: hooks.renderLastFrame,
  };
}

/** CSBWin drives animation off the VBL counter; the browser gives us a wall clock. */
export function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}
