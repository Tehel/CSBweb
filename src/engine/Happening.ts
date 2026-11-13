/**
 * What the engine tells its host happened (`GameHost.observe`), for the achievements
 * (`doc/ACHIEVEMENTS.md` → "Watching the engine"). Not CSBWin's. A happening is built
 * only where `GameHost.observing` is set, and telling one changes nothing: no state is
 * written, no random number drawn, no path through the code taken another way.
 *
 * A blow is told around the call that deals it (`blow`, then `BLOW_END`), so that what
 * it hurts or kills inside is known by its cause. Blows nest: a missile's explosion is a
 * blow inside the missile's, and a blow that names no side of its own (`party` left out,
 * no missile nor cloud) takes the side of the blow around it.
 */
import type { ObjectID } from '../core/types';

/** What dealt a blow. */
export type BlowCause =
  | 'melee' | 'missile' | 'explosion' | 'cloud' | 'door' | 'pit' | 'wall' | 'monster'
  | 'poison' | 'starvation' | 'thirst' | 'fatigue' | 'potion' | 'fusion' | 'landing';

/** A blow begins: the damage dealt until its `BLOW_END` is its. */
export interface Blow {
  readonly k: 'blow';
  readonly by: BlowCause;
  /** The champion who struck, a party slot. */
  readonly champion?: number;
  /** The object swung or thrown, or the bomb exploding. */
  readonly item?: ObjectID;
  /** Whether the party struck; left out, the missile's, the cloud's or the blow around it says. */
  readonly party?: boolean;
  /** The missile that struck, whose launch says who threw it. */
  readonly missile?: ObjectID;
  /** The cloud that struck, which took its side from the blow it was made in. */
  readonly cloud?: ObjectID;
}

/**
 * Why a cast failed, as `SpellErrorMsg` says it (`doc/CSBwin-src/Magic.cpp:1007`): the
 * runes make no spell, the champion's skill fell short, no empty flask was in hand.
 */
export type CastFailure = 'meaningless' | 'practice' | 'flask';

export type Happening =
  | Blow
  | { readonly k: 'blow-end' }
  /** `DamageMonster` dealt `damage` to a member of a group, one a blow can hurt. */
  | { readonly k: 'monster-hit'; readonly type: number; readonly damage: number }
  /**
   * A member of the group on square `x`, `y` of `level` died: in `DamageMonster`, in the
   * group the party landed on, or Lord Chaos fused. `possession` is the first of the
   * objects the group carries, `RNeof` for none, which its record links to the rest.
   */
  | {
    readonly k: 'monster-died'; readonly type: number; readonly alternateGraphics: number; readonly level: number;
    readonly x: number; readonly y: number; readonly possession: ObjectID;
  }
  /** `DamageCharacter` dealt `damage` to the champion in slot `chIdx`, pending till the tick. */
  | { readonly k: 'champion-hurt'; readonly chIdx: number; readonly damage: number }
  /** `KillCharacter`. */
  | { readonly k: 'champion-died'; readonly chIdx: number }
  /** A missile was launched, by the champion in slot `launcher`, or -1 by anything else. */
  | { readonly k: 'missile'; readonly missile: ObjectID; readonly launcher: number }
  /** A cloud was made, inside the blow that made it, if any. */
  | { readonly k: 'cloud'; readonly cloud: ObjectID }
  /** A champion ate or drank `nameIndex` (`RN::NameIndex`), or drank at a fountain (-1). */
  | { readonly k: 'meal'; readonly chIdx: number; readonly nameIndex: number; readonly eat: boolean }
  /**
   * A champion cast the runes `runes` (the game's codes, 96 and up) from the panel, and
   * why it failed where `SpellErrorMsg` said so.
   */
  | { readonly k: 'cast'; readonly chIdx: number; readonly runes: readonly number[]; readonly ok: boolean; readonly failure?: CastFailure }
  /** An object was put in a worn place: possession slot `slot`, 2 to 5 or 10, the neck. */
  | { readonly k: 'wear'; readonly chIdx: number; readonly slot: number; readonly object: ObjectID }
  /** A champion joined for good, RESURRECT or REINCARNATE (`GameHost.championJoined`). */
  | { readonly k: 'joined'; readonly chIdx: number; readonly reincarnated: boolean }
  /**
   * `StealFromCharacter` took `object` from the champion in slot `chIdx` into the
   * possessions of a group of type `type` (`doc/CSBwin-src/Monster.cpp:258-269`).
   */
  | { readonly k: 'theft'; readonly chIdx: number; readonly object: ObjectID; readonly type: number }
  /**
   * A type 16 actuator put the object in hand, `given`, on its square, and gave the hand the
   * object that was there, `taken` (`doc/CSBwin-src/Mouse.cpp:473-512`).
   */
  | { readonly k: 'swap'; readonly given: ObjectID; readonly taken: ObjectID }
  /**
   * An actuator on square `x`, `y` of `level` fired, as it calls `QueueSwitchAction`: a
   * wall touched (`TouchWall`, `doc/CSBwin-src/Mouse.cpp:291`), a pad or an alcove
   * pressed or released (`PressurePadOrAlcove`, `doc/CSBwin-src/Code11f52.cpp:3720`), a
   * counter or a combination a message reached (`ProcessTT_STONEROOM`,
   * `doc/CSBwin-src/Timer.cpp:2165`). `item` is the object that fired it: at a wall the
   * object in hand, `hand` true, `RNnul` for an empty hand; on a pad or in an alcove the
   * object put or taken, `RNnul` for the party; for a counter or a combination `RNnul`.
   */
  | { readonly k: 'trigger'; readonly level: number; readonly x: number; readonly y: number; readonly item: ObjectID; readonly hand: boolean }
  /** The party lay down to sleep: the sleep icon, button 145 (`MouseSystem.sleep`). */
  | { readonly k: 'sleep' }
  /** The Hint Oracle's button, which opens the Oracle (`ui.hintOracleNeeded`, `src/renderer/ui/Mouse.ts`). */
  | { readonly k: 'oracle' }
  /** A VBL of the player's time has run (`Game.playTime`): not a frozen game's, nor the save menu's. */
  | { readonly k: 'vbl' }
  /** The main loop's tick has ended. */
  | { readonly k: 'tick' }
  /** `MainLoop` returned: the game is over. */
  | { readonly k: 'ended'; readonly won: boolean }
  /** A new game was read from `dungeon.dat`. */
  | { readonly k: 'new-game' }
  /** A save's file was made (`saveFileOf`). */
  | { readonly k: 'saved'; readonly file: Uint8Array }
  /** A save's file was read (`applySaveBytes`). */
  | { readonly k: 'read'; readonly file: Uint8Array };

/** A blow's end: one object, so that telling it builds nothing. */
export const BLOW_END: Happening = { k: 'blow-end' };

/** The party lying down to sleep, one object as `BLOW_END` is. */
export const SLEEP: Happening = { k: 'sleep' };

/** The Hint Oracle asked, one object as `BLOW_END` is. */
export const ORACLE: Happening = { k: 'oracle' };
