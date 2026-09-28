/**
 * Shared state for the DM user interface.
 *
 * CSBWin keeps this in globals that `Mouse.cpp`, `CSBUI.cpp`, `Character.cpp` and
 * `Magic.cpp` all reach into. `GameScreen` owns the single instance and the UI
 * modules take it as their first argument, which keeps each of them a thin, greppable
 * translation of its C++ counterpart instead of another method on a god object.
 */
import type { GraphicsLoader } from '../../data/GraphicsLoader';
import type { DungeonState } from '../../engine/DungeonState';
import type { PartyState } from '../../engine/gameTypes';
import type { FeedParameters } from '../../engine/Feeding';
import type { ViewingFilterOptions, ViewingFilterResult } from '../../engine/DsaSystem';
import type { InterpreterContext } from '../bytecode/BytecodeInterpreter';
import type { IndexedBitmap, createPaletteIndexViewportBuffer } from '../csbwin/CanvasBlitter';
import type { KeyXlate, Rect, UIButton, UITables } from '../csbwin/UITables';
import type { ObjectTables } from '../csbwin/ObjectTables';
import type { CharacterStats } from '../../engine/CharacterStats';
import type { FontData } from '../csbwin/TextRenderer';
import type { ImageFormat } from '../../core/imageDecoder';
import { OBJECT_ID_NULL, type ObjectID, type Position } from '../../core/types';
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

export type ObjectMoveHandler = (
  position: Position,
  object: ObjectID,
  place: boolean,
  unchangedRoom: boolean,
  facing: number,
) => void;

export interface UIState {
  /* ---- data sources ---- */
  readonly graphicsLoader: GraphicsLoader;
  readonly dungeonState: DungeonState;
  context: InterpreterContext | null;
  screenIndexBuffer: ScreenIndexBuffer | null;
  uiTables: UITables | null;
  objectTables: ObjectTables | null;
  /**
   * `GetObjectWeight` / `MaxLoad` and friends (`src/engine/CharacterStats.ts`). The UI
   * shows the load figure the engine's `Quickness` and `DetermineThrowingDistance` act
   * on, so both must come out of the same code — there used to be two implementations.
   * Set once the object tables are extracted.
   */
  characterStats: CharacterStats | null;
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
  /** The damage figure being flashed, and when the flash ends. See `ui/Attack.ts`. */
  attackFlashValue: number;
  attackFlashUntilMs: number;
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
  /** `QueueSound(ordinal, mapX, mapY, deltaTime)`, the engine's `SoundQueue`. */
  queueSound?: (ordinal: number, mapX: number, mapY: number, deltaTime: number) => void;
  onObjectMove?: ObjectMoveHandler;
  onSpellCast?: (chIdx: number) => number | void;
  /** `Attack(chIdx, attackType)` — into `engine/AttackSystem`. */
  onChampionAttack?: (chIdx: number, attackType: number) => number;
  /**
   * Whether a script holds the loop (`Game.isRunningScript`): the pass that started it is
   * suspended inside it, as CSBWin's is inside a `RESTARTABLE` sequence.
   */
  isRunningScript?: () => boolean;
  /** `d.attackDamageToDisplay`, read and cleared. */
  onConsumeAttackDamage?: () => number;
  /**
   * Apply a `FEEDPARAMETERS` block to a champion — the engine half of
   * `_FeedCharacter` (`doc/CSBwin-src/Character.cpp:4348`). Returns whether anything
   * was applied. A hook because it reaches `KillCharacter`, `CurePoison`,
   * `AdjustStamina` and the `TT_72` timer, none of which the UI owns.
   */
  applyFeeding?: (chIdx: number, fp: FeedParameters) => boolean;
  /**
   * `RemoveCharacterPossession` / `AddCharacterPossession`
   * (`doc/CSBwin-src/Character.cpp:1822`, `:1936`), for the inventory click. Hooks
   * because the pair lights torches and the party, opens scrolls and moves the stats,
   * all of it the engine's (`CharacterSystem`).
   */
  onRemoveCharacterPossession?: (chIdx: number, slot: number) => ObjectID;
  onAddCharacterPossession?: (chIdx: number, object: ObjectID, slot: number) => void;
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
  viewingFilter?: (options: ViewingFilterOptions) => ViewingFilterResult | null;
  /**
   * Stop and restart the clock around a modal menu. CSBWin needs no such hook: its menu
   * loop simply never returns to the main loop, and `d.Time++` lives there
   * (`doc/CSBwin-src/CSBCode.cpp:660`). This port's loop keeps running, so the pause is
   * explicit.
   */
  onSetPaused?: (paused: boolean) => void;
  /** Button 145 — `Game.sleep`, after the inventory has been hidden. */
  onSleep?: () => void;
  /** `d.clockTick = value` from a handler the mouse queue runs — `Game.setClockTick`. */
  setClockTick?: (value: number) => void;
  /** Button 146 — `Game.wakeUp` (`doc/CSBwin-src/CSBCode.cpp:7047`). */
  onWakeUp?: () => void;
  /** `WaitForButtonFlash` (`doc/CSBwin-src/CSBCode.cpp:8561`) — the engine's `waitForButtonFlash`. */
  waitForButtonFlash?: () => void;
  /** The button rectangle a flash has inverted, or `null` — `Game.flashedButton`. */
  flashedButton?: () => Rect | null;
  /** Button 147, the engine's half of the freeze — `Game.freeze`. */
  onFreeze?: () => void;
  /** Button 148, the engine's half of the thaw — `Game.thaw`. */
  onThaw?: () => void;
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
  | 'word20250' | 'word20252' | 'attackFlashValue' | 'attackFlashUntilMs'
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
    attackFlashValue: 0,
    attackFlashUntilMs: 0,
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
  dungeonState: DungeonState,
  hooks: Pick<UIState, 'getGraphicBitmap' | 'renderLastFrame'>,
): UIState {
  return {
    graphicsLoader,
    dungeonState,
    context: null,
    screenIndexBuffer: null,
    uiTables: null,
    objectTables: null,
    characterStats: null,
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
