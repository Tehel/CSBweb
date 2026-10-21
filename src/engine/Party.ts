/**
 * Party management
 *
 * Handles party position, facing, movement, and champion state
 * Based on CSBWin's party management system
 */

import { OBJECT_ID_NULL, ui8, Direction, Position } from '../core/types';
import type { PartyState, Champion } from './gameTypes';
import { CHARFLAG_CHEST_OR_SCROLL, CHARFLAG_CURSOR, CHARFLAG_PORTRAIT_CHANGED } from '../core/charDesc';
import { MovementAction } from './gameTypes';
import type { GameContext } from './GameContext';
import { drawCharacterStateEyePanel } from './OpenChest';
import { CHARDESC_SIZE } from '../data/CsbwinSaveInfo';
import { getFromWings, wingsChampion, type WingsPool } from './Wings';

/**
 * A copy of `party` that shares nothing with it: the champions down to their
 * possessions, skills and attributes, the vacant records, the position. Every part is
 * plain data, but for `position`, which is made a `Position` again, so a state that has
 * been through JSON comes back whole.
 */
export function clonePartyState(party: PartyState): PartyState {
    const { position, ...rest } = party;
    return {
        ...structuredClone(rest),
        position: new Position(position.x, position.y, position.z),
    };
}

/** The one initializer of `PartyState`. */
export function initialPartyState(position: Position, facing: Direction): PartyState {
    return {
        champions: [],
        position,
        facing,
        magicCasterIndex: -1,
        // `d.PotentialCharacterOrdinal` 0 — none (doc/CSBwin-src/Data.h:948).
        potentialChampionIndex: -1,
        gameIsLost: false,
        pendingDamage: [0, 0, 0, 0],
        pendingOuches: [0, 0, 0, 0],
        cursorOwner: -1,
        selectedCharacterIndex: -1,
        objectInHand: OBJECT_ID_NULL,
        // `d.PartyShield`, `d.FireShield`, `d.SpellShield` (doc/CSBwin-src/Data.h:785-787).
        partyShield: 0,
        fireShield: 0,
        spellShield: 0,
        brightness: 0,
        invisible: 0,
        seeThruWalls: 0,
        magicFootprintsActive: 0,
        lastMonsterAttackTime: -200,
        freezeLifeTimer: 0,
        partyMoveDisableTimer: 0,
        word11712: 0,
        word11714: 0,
        vacantCharacters: Array.from({ length: 4 }, () => new Uint8Array(CHARDESC_SIZE)),
        sleeping: false,
    };
}

/**
 * Party class - manages party state and movement
 */
export class Party {
    state: PartyState;
    /**
     * How many times `setState` has replaced the state: another party, so another game,
     * loaded or begun. The screen reads it to draw that game afresh (`GameScreen.syncParty`).
     */
    generation = 0;

    constructor(initialPosition: Position, initialFacing: Direction) {
        this.state = initialPartyState(initialPosition, initialFacing);
    }

    /**
     * Add a champion to the party
     */
    addChampion(champion: Champion): boolean {
        if (this.state.champions.length >= 4) {
            return false; // Party full
        }
        // `ClearMemory((ui8 *)pcA3, 800)` (doc/CSBwin-src/Character.cpp:482): the slot's
        // record is the champion's now, and what was left there is gone.
        this.state.vacantCharacters[this.state.champions.length] = new Uint8Array(CHARDESC_SIZE);
        this.state.champions.push(champion);
        return true;
    }

    /**
     * Calculate new facing based on turn action
     *
     * @param action - Movement action (TURN_LEFT or TURN_RIGHT)
     * @returns New facing direction
     */
    calculateNewFacing(action: MovementAction): Direction {
        const { facing } = this.state;

        if (action === MovementAction.TURN_LEFT) {
            // Turn counter-clockwise
            return ((facing + 3) % 4) as Direction;
        } else if (action === MovementAction.TURN_RIGHT) {
            // Turn clockwise
            return ((facing + 1) % 4) as Direction;
        }

        return facing;
    }

    /**
     * Turn the party, rotating every champion with it
     * (`doc/CSBwin-src/Code11f52.cpp:4123`).
     *
     * Both champion fields move by the same delta: `charPosition`, so the champion who
     * was on the party's left is still on its left afterwards, and `facing`, which is
     * what the champion's *own* attacks and the corner marker in their box read.
     * Nothing was rotating either before, so a champion kept attacking in the direction
     * the party faced when they joined.
     *
     * **Every** change of party facing must come through here, not just a turn on the
     * spot: a teleporter's rotation is the same operation, and in CSBWin both are one
     * path because both are `MoveObject`.
     */
    setFacing(newFacing: number): void {
        setPartyFacing(this.state, newFacing);
    }

    /** Replace the whole party state with a copy of `state`, which it shares nothing with. */
    setState(state: PartyState): void {
        this.state = clonePartyState(state);
        this.generation++;
    }

    /**
     * Get a champion by party position
     */
    getChampion(position: ui8): Champion | null {
        return this.state.champions.find(c => c.partyPosition === position) || null;
    }

}

/**
 * `SetHandOwner` (`doc/CSBwin-src/CSBCode.cpp:8477`) — hand champion `chIdx` the mouse
 * cursor, or -1 to leave it unowned.
 *
 * This is not cosmetic: CSBWin gates every inventory click on `d.HandChar != -1`
 * (`doc/CSBwin-src/Mouse.cpp:1739-1745`), and so does this port, so nobody can pick an
 * object up until a champion owns the cursor. CSBWin therefore gives it away as soon as
 * the party has a first champion (`doc/CSBwin-src/Character.cpp:707-711` and
 * `doc/CSBwin-src/CSBCode.cpp:6846-6850`), moves it to a living champion when the owner
 * dies (`doc/CSBwin-src/Character.cpp:2689-2693`), takes it back when the last champion
 * is cancelled out of the mirror (`doc/CSBwin-src/CSBCode.cpp:6700-6703`), and saves and
 * restores it with the game (`doc/CSBwin-src/SaveGame.cpp:1045` and `:1760`).
 *
 * The `load` arithmetic CSBWin does here has no counterpart: this port recomputes a
 * champion's load from its possessions instead of tracking it incrementally
 * (`computeLoadWeight`), and counts the object in hand against whoever owns the cursor.
 *
 * Both champions' names are drawn again in their new colour, `CHARFLAG_cursor` and
 * `DrawCharacterState` (`doc/CSBwin-src/CSBCode.cpp:8488-8494`, `:8509-8510`), which is
 * the host's: the recruit in a mirror, who is given the cursor, is not redrawn (`:8508`).
 */
export function setHandOwner(ctx: GameContext, chIdx: number): void {
    const party = ctx.party.state;
    const current = party.cursorOwner ?? -1;
    if (chIdx === current) return;
    if (chIdx !== -1) {
        const champion = getPartyChampion(party, chIdx);
        if (!champion) return;
        // `if ( (chIdx != -1) && (d.CH16482[chIdx].HP()==0) ) return;` (`doc/CSBwin-src/CSBCode.cpp:8484`).
        if ((champion.attributes?.health ?? 0) === 0) return;
    }
    party.cursorOwner = -1;
    if (current !== -1) drawCharacterState(ctx, current, CHARFLAG_CURSOR);
    if (chIdx === -1) return;
    party.cursorOwner = chIdx;
    // `pcA3->facing = (ui8)d.partyFacing` (doc/CSBwin-src/CSBCode.cpp:8504).
    const champion = getPartyChampion(party, chIdx);
    if (champion) champion.facing = party.facing;
    if (chIdx === party.potentialChampionIndex) return;
    drawCharacterState(ctx, chIdx, CHARFLAG_CURSOR);
}

/**
 * `DrawCharacterState(chIdx)` (`doc/CSBwin-src/Character.cpp:1234`): the host draws
 * `charFlags`, the flags just set, with the champion's `CHARFLAG_CHEST_OR_SCROLL`, which
 * is cleared as `:1519` clears every graphic flag. Nothing set, nothing is drawn (`:1256`).
 * The flag on the champion whose inventory is open fills the eye panel again, whose
 * opening and repacking of the chest are the engine's (`drawCharacterStateEyePanel`,
 * `CharacterSystem.ts`), before the host draws it.
 */
export function drawCharacterState(ctx: GameContext, chIdx: number, charFlags: number): void {
    const party = ctx.party.state;
    const champion = party.champions[chIdx];
    if (champion) {
        charFlags |= champion.charFlags & CHARFLAG_CHEST_OR_SCROLL;
        champion.charFlags &= ~CHARFLAG_CHEST_OR_SCROLL;
    }
    if ((charFlags & CHARFLAG_CHEST_OR_SCROLL) !== 0 && party.selectedCharacterIndex === chIdx) {
        drawCharacterStateEyePanel(ctx);
    }
    if (charFlags !== 0) ctx.host.drawCharacterState(chIdx, charFlags);
}

/**
 * `DrawAllCharacterState` (`doc/CSBwin-src/CSBCode.cpp:6885-6895`), for the flags the
 * champions hold.
 */
export function drawAllCharacterState(ctx: GameContext): void {
    for (let i = 0; i < ctx.party.state.champions.length; i++) drawCharacterState(ctx, i, 0);
}

/**
 * `MarkAllPortraitsChanged` (`doc/CSBwin-src/CSBCode.cpp:6335`): `CHARFLAG_portraitChanged`
 * on every champion and `DrawAllCharacterState`, which a party shield, a spell shield or
 * a fire shield changing calls for, the dots around each box being theirs.
 */
export function markAllPortraitsChanged(ctx: GameContext): void {
    for (let i = 0; i < ctx.party.state.champions.length; i++) {
        drawCharacterState(ctx, i, CHARFLAG_PORTRAIT_CHANGED);
    }
}

/**
 * `d.CH16482[chIdx]` — CSBWin indexes its champion array by **party slot**, which is
 * the champion's box in the top bar and never moves.
 *
 * Not `partyPosition`: that is `CHARDESC.charPosition`, the corner of the cell the
 * champion stands in, and `setPartyFacing` rotates it, so after the party turned it
 * would name whichever champion had drifted into the corner rather than the one in the
 * box. Every consumer of `cursorOwner` and `magicCasterIndex` reads them as list indices
 * (`party.champions[chIdx]`), and so does CSBWin, so the list index is the one true
 * meaning.
 *
 * Exported because the UI needs the same lookup: every click that names a champion —
 * a portrait box, an inventory slot, a magic tab — names a *box*, and CSBWin resolves
 * it as `d.CH16482[chIdx]` (`doc/CSBwin-src/CSBCode.cpp:7015`).
 */
export function getPartyChampion(party: PartyState, chIdx: number): Champion | null {
    if (chIdx < 0) return null;
    return party.champions[chIdx] ?? null;
}

/**
 * The first champion of the party with `fingerprint`'s low word, or -1: the party half of
 * `CHARDESC::CopyCharacter` (`doc/CSBwin-src/Character.cpp:5264-5276`), and the loop
 * `ProcessTT_ViAltar` and `&CHARNAME@` spell out (`Timer.cpp:2752-2755`,
 * `DSA.cpp:3216-3223`).
 */
export function findChampionByFingerprint(party: PartyState, fingerprint: number): number {
    const wanted = fingerprint & 0xffff;
    for (let i = 0; i < party.champions.length; i++) {
        const champion = party.champions[i];
        if (!champion) continue;
        if ((champion.fingerprint & 0xffff) === wanted) return i;
    }
    return -1;
}

/**
 * `CHARDESC::CopyCharacter` (`doc/CSBwin-src/Character.cpp:5264-5276`): the first champion
 * of the party with `fingerprint`'s low word, else a copy of the one in the wings
 * (`GetFromWings`, testing only), else null. The party's is the champion itself.
 */
export function copyCharacter(party: PartyState, pool: WingsPool, fingerprint: number): Champion | null {
    const chIdx = findChampionByFingerprint(party, fingerprint);
    if (chIdx !== -1) return party.champions[chIdx]!;
    const character = getFromWings(pool, fingerprint, true);
    return character ? wingsChampion(character) : null;
}

/**
 * `SelectMagicCaster` (`doc/CSBwin-src/Magic.cpp:719-743`) — move the magic tab to
 * another champion.
 *
 * Only the state half is ported; the rest of CSBWin's function redraws the rune
 * controls and caches the panel's pixels. The two guards are the whole logic: the
 * call is a no-op if that champion already holds the tab, and a dead champion can
 * never take it (`chIdx == -1`, which clears it, is always allowed).
 */
export function selectMagicCaster(party: PartyState, chIdx: number): void {
    if (chIdx === (party.magicCasterIndex ?? -1)) return;
    if (chIdx !== -1) {
        const champion = getPartyChampion(party, chIdx);
        if (!champion) return;
        if ((champion.attributes?.health ?? 0) === 0) return;
    }
    party.magicCasterIndex = chIdx;
}

/**
 * Turn the party, rotating every champion with it
 * (`doc/CSBwin-src/Code11f52.cpp:4123`).
 *
 * Both champion fields move by the same delta: `charPosition`, so the champion who was
 * on the party's left is still on its left afterwards, and `facing`, which is what the
 * champion's *own* attacks and the corner marker in their box read. Nothing was rotating
 * either before, so a champion kept attacking in the direction the party faced when they
 * joined.
 *
 * **Every** change of party facing must come through here, not just a turn on the spot:
 * a teleporter's rotation and a pit shuffle are the same operation, and in CSBWin all
 * three are one path because all three are `MoveObject`.
 *
 * A free function rather than only a method, because `TimerSystem` reaches the party
 * through `PartyState` and has no `Party` to call.
 */
export function setPartyFacing(party: PartyState, newFacing: number): void {
    const facing = (newFacing & 3) as Direction;
    const delta = (facing - party.facing + 4) & 3;
    party.facing = facing;
    if (delta === 0) return;
    for (const champion of party.champions) {
        if (!champion) continue;
        champion.partyPosition = (champion.partyPosition + delta) & 3;
        champion.facing = ((champion.facing + delta) & 3) as Direction;
    }
}

