/**
 * Party management
 *
 * Handles party position, facing, movement, and champion state
 * Based on CSBWin's party management system
 */

import { OBJECT_ID_NULL, ui8, Direction, Position } from '../core/types';
import type { PartyState, Champion } from './gameTypes';
import { CHARFLAG_CHEST_OR_SCROLL, CHARFLAG_CURSOR, CHARFLAG_PORTRAIT_CHANGED, MovementAction } from './gameTypes';
import type { GameHost } from './GameHost';
import { addCharacterDefaults } from './AddCharacter';
import { CHARDESC_SIZE } from '../data/CsbwinSaveInfo';
import { getFromWings, wingsChampion, type WingsPool } from './Wings';
import { Direction as Dir } from '../core/types';

/**
 * The one initializer of `PartyState`. `Party.setState` fills from it any field an older
 * runtime save does not carry.
 */
export function initialPartyState(position: Position, facing: Direction): PartyState {
    return {
        champions: [],
        position,
        facing,
        magicCasterIndex: -1,
        // `d.PotentialCharacterOrdinal` 0 — none (doc/CSBwin-src/Data.h:933).
        potentialChampionIndex: -1,
        gameIsLost: false,
        pendingDamage: [0, 0, 0, 0],
        pendingOuches: [0, 0, 0, 0],
        cursorOwner: -1,
        selectedCharacterIndex: -1,
        objectInHand: OBJECT_ID_NULL,
        // `d.PartyShield`, `d.FireShield`, `d.SpellShield` (doc/CSBwin-src/Data.h:770-772).
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
        // `ClearMemory((ui8 *)pcA3, 800)` (doc/CSBwin-src/Character.cpp:481): the slot's
        // record is the champion's now, and what was left there is gone.
        this.state.vacantCharacters[this.state.champions.length] = new Uint8Array(CHARDESC_SIZE);
        this.state.champions.push(champion);
        return true;
    }

    /**
     * Calculate new position based on movement action
     *
     * @param action - Movement action
     * @returns New coordinates (not validated against map)
     */
    calculateNewPosition(action: MovementAction): Position {
        const { position, facing } = this.state;
        let newX = position.x;
        let newY = position.y;

        switch (action) {
            case MovementAction.MOVE_FORWARD:
                // Move in facing direction
                switch (facing) {
                    case Dir.NORTH: newY--; break;
                    case Dir.EAST: newX++; break;
                    case Dir.SOUTH: newY++; break;
                    case Dir.WEST: newX--; break;
                }
                break;

            case MovementAction.MOVE_BACKWARD:
                // Move opposite to facing direction
                switch (facing) {
                    case Dir.NORTH: newY++; break;
                    case Dir.EAST: newX--; break;
                    case Dir.SOUTH: newY--; break;
                    case Dir.WEST: newX++; break;
                }
                break;

            case MovementAction.STRAFE_LEFT:
                // Move left relative to facing
                switch (facing) {
                    case Dir.NORTH: newX--; break;
                    case Dir.EAST: newY--; break;
                    case Dir.SOUTH: newX++; break;
                    case Dir.WEST: newY++; break;
                }
                break;

            case MovementAction.STRAFE_RIGHT:
                // Move right relative to facing
                switch (facing) {
                    case Dir.NORTH: newX++; break;
                    case Dir.EAST: newY++; break;
                    case Dir.SOUTH: newX--; break;
                    case Dir.WEST: newY--; break;
                }
                break;

            default:
                // Turn actions don't change position
                return position;
        }

        return new Position(newX, newY, position.z);
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
     * (`doc/CSBwin-src/Code11f52.cpp:4085`).
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

    /**
     * Replace full party state (used for save/load). A field an older runtime save does
     * not carry takes `initialPartyState`'s value, so no reader needs a fallback.
     */
    setState(state: PartyState): void {
        this.state = {
            ...initialPartyState(state.position, state.facing),
            ...state,
            champions: state.champions.map((c) => ({ ...addCharacterDefaults(), ...c })),
            position: new Position(state.position.x, state.position.y, state.position.z),
            facing: state.facing,
        };
    }

    /**
     * Get a champion by party position
     */
    getChampion(position: ui8): Champion | null {
        return this.state.champions.find(c => c.partyPosition === position) || null;
    }

}

/**
 * `SetHandOwner` (`doc/CSBwin-src/CSBCode.cpp:8390`) — hand champion `chIdx` the mouse
 * cursor, or -1 to leave it unowned.
 *
 * This is not cosmetic: CSBWin gates every inventory click on `d.HandChar != -1`
 * (`doc/CSBwin-src/Mouse.cpp:1600-1606`), and so does this port, so nobody can pick an
 * object up until a champion owns the cursor. CSBWin therefore gives it away as soon as
 * the party has a first champion (`doc/CSBwin-src/Character.cpp:706-710` and
 * `doc/CSBwin-src/CSBCode.cpp:6787-6791`), moves it to a living champion when the owner
 * dies (`doc/CSBwin-src/Character.cpp:2684-2688`), takes it back when the last champion
 * is cancelled out of the mirror (`doc/CSBwin-src/CSBCode.cpp:6641-6644`), and saves and
 * restores it with the game (`doc/CSBwin-src/SaveGame.cpp:1020` and `:1636`).
 *
 * The `load` arithmetic CSBWin does here has no counterpart: this port recomputes a
 * champion's load from its possessions instead of tracking it incrementally
 * (`computeLoadWeight`), and counts the object in hand against whoever owns the cursor.
 *
 * Both champions' names are drawn again in their new colour, `CHARFLAG_cursor` and
 * `DrawCharacterState` (`doc/CSBwin-src/CSBCode.cpp:8401-8407`, `:8422-8423`), which is
 * the host's: the recruit in a mirror, who is given the cursor, is not redrawn (`:8421`).
 */
export function setHandOwner(party: PartyState, chIdx: number, host: Pick<GameHost, 'drawCharacterState'>): void {
    const current = party.cursorOwner ?? -1;
    if (chIdx === current) return;
    if (chIdx !== -1) {
        const champion = getPartyChampion(party, chIdx);
        if (!champion) return;
        // `if ( (chIdx != -1) && (d.CH16482[chIdx].HP()==0) ) return;` (`doc/CSBwin-src/CSBCode.cpp:8397`).
        if ((champion.attributes?.health ?? 0) === 0) return;
    }
    party.cursorOwner = -1;
    if (current !== -1) drawCharacterState(party, current, CHARFLAG_CURSOR, host);
    if (chIdx === -1) return;
    party.cursorOwner = chIdx;
    // `pcA3->facing = (ui8)d.partyFacing` (doc/CSBwin-src/CSBCode.cpp:8417).
    const champion = getPartyChampion(party, chIdx);
    if (champion) champion.facing = party.facing;
    if (chIdx === party.potentialChampionIndex) return;
    drawCharacterState(party, chIdx, CHARFLAG_CURSOR, host);
}

/**
 * `DrawCharacterState(chIdx)` (`doc/CSBwin-src/Character.cpp:1229`): the host draws
 * `charFlags`, the flags just set, with the champion's `CHARFLAG_CHEST_OR_SCROLL`, which
 * is cleared as `:1514` clears every graphic flag. Nothing set, nothing is drawn (`:1251`).
 */
export function drawCharacterState(
    party: PartyState, chIdx: number, charFlags: number, host: Pick<GameHost, 'drawCharacterState'>,
): void {
    const champion = party.champions[chIdx];
    if (champion) {
        charFlags |= champion.charFlags & CHARFLAG_CHEST_OR_SCROLL;
        champion.charFlags &= ~CHARFLAG_CHEST_OR_SCROLL;
    }
    if (charFlags !== 0) host.drawCharacterState(chIdx, charFlags);
}

/**
 * `DrawAllCharacterState` (`doc/CSBwin-src/CSBCode.cpp:6826-6836`), for the flags the
 * champions hold.
 */
export function drawAllCharacterState(party: PartyState, host: Pick<GameHost, 'drawCharacterState'>): void {
    for (let i = 0; i < party.champions.length; i++) drawCharacterState(party, i, 0, host);
}

/**
 * `MarkAllPortraitsChanged` (`doc/CSBwin-src/CSBCode.cpp:6276`): `CHARFLAG_portraitChanged`
 * on every champion and `DrawAllCharacterState`, which a party shield, a spell shield or
 * a fire shield changing calls for, the dots around each box being theirs.
 */
export function markAllPortraitsChanged(party: PartyState, host: Pick<GameHost, 'drawCharacterState'>): void {
    for (let i = 0; i < party.champions.length; i++) {
        drawCharacterState(party, i, CHARFLAG_PORTRAIT_CHANGED, host);
    }
}

/**
 * Restore CSBWin's invariant that a party with champions always has a cursor owner.
 *
 * `d.HandChar` is set the moment the first champion joins and is only ever -1 while the
 * party is empty, so a restored state that has champions but no owner cannot have come
 * from CSBWin. Quick-saves written before `setHandOwner` existed are exactly that, and
 * without this they load into a party whose inventory cannot be touched.
 */
export function ensureHandOwner(party: PartyState, host: Pick<GameHost, 'drawCharacterState'>): void {
    if ((party.cursorOwner ?? -1) >= 0) return;
    if (party.champions.length === 0) return;
    for (let chIdx = 0; chIdx < 4; chIdx++) {
        const champion = getPartyChampion(party, chIdx);
        if (!champion || (champion.attributes?.health ?? 0) === 0) continue;
        setHandOwner(party, chIdx, host);
        if ((party.cursorOwner ?? -1) >= 0) return;
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
 * it as `d.CH16482[chIdx]` (`doc/CSBwin-src/CSBCode.cpp:6956`).
 */
export function getPartyChampion(party: PartyState, chIdx: number): Champion | null {
    if (chIdx < 0) return null;
    return party.champions[chIdx] ?? null;
}

/**
 * The first champion of the party with `fingerprint`'s low word, or -1: the party half of
 * `CHARDESC::CopyCharacter` (`doc/CSBwin-src/Character.cpp:5239-5251`), and the loop
 * `ProcessTT_ViAltar` and `&CHARNAME@` spell out (`Timer.cpp:2752-2755`,
 * `DSA.cpp:3215-3222`).
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
 * `CHARDESC::CopyCharacter` (`doc/CSBwin-src/Character.cpp:5239-5251`): the first champion
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
 * `SelectMagicCaster` (`doc/CSBwin-src/Magic.cpp:716-740`) — move the magic tab to
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
 * (`doc/CSBwin-src/Code11f52.cpp:4085`).
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

