/**
 * `CHARDESC`'s values (`doc/CSBwin-src/CSB.h:2516-2653`): its flags, and its thirty
 * possessions read and made. The champion itself is `Champion` (`src/engine/gameTypes.ts`);
 * a save's reader, below the engine, writes and reads these too (`CsbwinCharacters`).
 */
import { OBJECT_ID_NULL, type ObjectID } from './types';

/**
 * `CHARDESC.possessions[30]` (`doc/CSBwin-src/CSB.h:2638`). CSBWin indexes it with bare
 * numbers, and so does ported code; these name only the slots CSBWin's own comments
 * name, for the port's code that is not a transcription.
 */
const POSSESSION_COUNT = 30;
/** "Weapon hand = 1" (`doc/CSBwin-src/Attack.cpp:1669`); slot 0 is the "non-weapon hand" (`Character.cpp:3079`). */
export const SLOT_WEAPON_HAND = 1;

/**
 * Thirty empty slots. An empty slot holds `RNnul`, as in CSBWin
 * (`doc/CSBwin-src/Character.cpp:2917`) and in the save file — never `null`.
 */
export function emptyPossessions(): ObjectID[] {
    return new Array<ObjectID>(POSSESSION_COUNT).fill(OBJECT_ID_NULL);
}

/**
 * `CHARDESC::Possession(slot)` (`doc/CSBwin-src/CSB.h:2640`): what the slot holds,
 * `RNnul` when it is empty. CSBWin reads the array unchecked; a slot outside the thirty
 * reads `RNnul` here.
 */
export function getChampionPossession(champion: { readonly possessions: readonly ObjectID[] }, slot: number): ObjectID {
    return champion.possessions[slot] ?? OBJECT_ID_NULL;
}

/**
 * `CHARFLAG_attackDisable` (`doc/CSBwin-src/CSB.h:2519`) — the champion is busy.
 * `DisableCharacterAction` sets it when the champion has no busy timer yet
 * (`Magic.cpp:531-534`), `EnableCharacterAction` clears it (`Timer.cpp:2646`), and it
 * shades the attack hand (`Character.cpp:4892`).
 */
export const CHARFLAG_ATTACK_DISABLE = 0x0008;
/** `CHARFLAG_male` — `AddCharacter` ORs it in for an 'M' hero (`Character.cpp:597`). */
export const CHARFLAG_MALE = 0x10;
/**
 * `CHARFLAG_cursor` (`doc/CSBwin-src/CSB.h:2521`): `DrawCharacterState` draws the
 * champion's name again, over the box's name rectangle when their inventory is closed
 * (`doc/CSBwin-src/Character.cpp:1315-1361`).
 */
export const CHARFLAG_CURSOR = 0x0080;
/**
 * `CHARFLAG_portraitChanged` (`doc/CSBwin-src/CSB.h:2530`): `DrawCharacterState` fills
 * the champion's whole box and draws it afresh (`doc/CSBwin-src/Character.cpp:1260-1312`).
 */
export const CHARFLAG_PORTRAIT_CHANGED = 0x1000;
/**
 * `CHARFLAG_chestOrScroll` (`doc/CSBwin-src/CSB.h:2528`): with the champion's inventory
 * open, `DrawCharacterState` fills the eye panel again (`doc/CSBwin-src/Character.cpp:1483-1502`).
 * The one redraw flag the engine keeps in `charFlags`, as CSBWin does, because what sets
 * it is not what draws it: `drawCharacterState` (`Party.ts`) hands it to the host and
 * clears it.
 */
export const CHARFLAG_CHEST_OR_SCROLL = 0x0800;
