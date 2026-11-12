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
  | 'poison' | 'starvation' | 'thirst' | 'fatigue' | 'potion' | 'fusion';

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

export type Happening =
  | Blow
  | { readonly k: 'blow-end' }
  /** A member of a group died, in `DamageMonster`, or Lord Chaos was fused. */
  | { readonly k: 'monster-died'; readonly type: number; readonly alternateGraphics: number }
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
  /** A champion cast the runes `runes` (the game's codes, 96 and up) from the panel. */
  | { readonly k: 'cast'; readonly chIdx: number; readonly runes: readonly number[]; readonly ok: boolean }
  /** An object was put in a worn place: possession slot `slot`, 2 to 5 or 10, the neck. */
  | { readonly k: 'wear'; readonly chIdx: number; readonly slot: number; readonly object: ObjectID }
  /** A champion joined for good, RESURRECT or REINCARNATE (`GameHost.championJoined`). */
  | { readonly k: 'joined'; readonly chIdx: number; readonly reincarnated: boolean }
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
