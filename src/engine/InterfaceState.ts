/**
 * The interface's `d.` fields that the engine reads too: the held eye and mouth, what the
 * open inventory's eye panel shows, the open chest, and the attack menu. CSBWin keeps them
 * in `d` beside the rest of the game; they live on the context (`ctx.interface`), as the
 * loop's flags do (`LoopState.ts`), so the engine and the screen read the same ones. None
 * is saved, in CSBWin or here. What only the screen draws from (bitmaps, the chew's and
 * the flash's times, the option names drawn) stays in `UIState`.
 */
import { OBJECT_ID_NULL, type ObjectID } from '../core/types';

export interface InterfaceState {
  /**
   * `d.PressingEye`: the eye of the open inventory held down, from the press to its
   * `QuitPressingEye` (`doc/CSBwin-src/CSBCode.cpp:7458`).
   */
  pressingEye: boolean;
  /**
   * `d.PressingMouth`: the mouth pressed with an empty hand while the eye panel showed a
   * chest, a scroll or the Resurrect menu (`doc/CSBwin-src/Character.cpp:4058-4075`).
   * Food and water are drawn over it until the release (`drawInventoryScreen`).
   */
  pressingMouth: boolean;
  /**
   * `d.DisplayResurrectChestOrScroll` (`doc/CSBwin-src/Character.cpp:3855`) — what the
   * eye panel is currently showing, which is also what a click in it means: 5 the
   * Resurrect/Reincarnate/Cancel menu, 4 an open chest, 0 anything else. Written by
   * `TAG0189d4`'s port in `drawInventoryScreen`, read by `tag01a6ea`.
   */
  displayResurrectChestOrScroll: number;
  /** `d.objOpenChest`: the chest whose objects `openChestContents` holds, or null. */
  openChestId: ObjectID | null;
  /** `d.rnChestContents[8]` — the open chest's objects, `RNnul` in an empty slot. */
  openChestContents: ObjectID[];

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
}

/** Eight empty chest slots, each `RNnul`. */
export function emptyChestContents(): ObjectID[] {
  return new Array<ObjectID>(8).fill(OBJECT_ID_NULL);
}

/**
 * The fields as a game begins: `d.Initialize()` zeroes the whole of `d`
 * (`doc/CSBwin-src/CSBCode.cpp:333-340`), and `TAG021028` sets `d.Word20252`
 * (`:10608`), so the panel starts showing the four attack buttons.
 */
export function createInterfaceState(): InterfaceState {
  return {
    pressingEye: false,
    pressingMouth: false,
    displayResurrectChestOrScroll: 0,
    openChestId: null,
    openChestContents: emptyChestContents(),
    attackingCharacterOrdinal: 0,
    possibleAttackTypes: Int8Array.from([-1, -1, -1, -1]),
    byte20256: new Uint8Array(4),
    word20248: 0,
    word20250: 0,
    word20252: 1,
  };
}
