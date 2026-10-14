/**
 * Movement system with collision detection
 *
 * Handles party movement, collision detection, and special tile interactions
 * Based on CSBWin's movement and collision system
 */

import type { Party } from './Party';
import type { DungeonState } from './DungeonState';
import type { MovementResult } from './gameTypes';
import { MovementAction } from './gameTypes';
import { OBJECT_ID_EOF, OBJECT_ID_NULL, Position, RoomType, getRoomType, locationRelToInteger } from '../core/types';
import { RelativeXY } from './RelativeXY';
import { div, sw } from '../core/intCast';
import type { GameContext } from './GameContext';
import { flashButton, setClockTick } from './LoopState';
import { TimerFunction } from './TimerQueue';

/** `PARTYMOVE_CONSTANTS` (doc/CSBwin-src/CSB.h:4316-4325): the move types, then the flags. */
export const PM_BEGINTURN = 1;
export const PM_STAIRWAY = 2;
export const PM_ATTEMPTMOVE = 3;
export const PM_INHIBITMOVE = 0x0001;
export const PM_SETDELAY = 0x0002;
export const PM_ADDDELAY = 0x0004;

/**
 * `PARTYMOVEDATA` (doc/CSBwin-src/CSB.h:4328-4379), the block the party move filter reads
 * and may rewrite (`CallPartyMoveFilter`, `DsaSystem.partyMoveFilter`). The locations are
 * `LOCATIONREL` integers whose position is the party's facing.
 */
export interface PartyMoveData {
    moveType: number;
    flags: number;
    delay: number;
    /** The stamina each champion pays, -1 past the party. */
    staminaAdjustment: number[];
    relDirection: number;
    absDirection: number;
    fromLocation: number;
    toLocation: number;
    fromLocationType: number;
    toLocationType: number;
}

/** `sizeof(PARTYMOVEDATA) / 4` (doc/CSBwin-src/CSBCode.cpp:7922): its 13 longwords. */
export const PARTY_MOVE_DATA_WORDS = 13;

/**
 * `memcpy(pDSAparameters + 1, pmd, sizeof(*pmd))` (doc/CSBwin-src/CSBCode.cpp:7923): the
 * block as the filter's DSA sees it, a longword per field in the struct's order.
 */
export function partyMoveDataToWords(pmd: PartyMoveData): number[] {
    return [
        pmd.moveType, pmd.flags, pmd.delay, ...pmd.staminaAdjustment,
        pmd.relDirection, pmd.absDirection, pmd.fromLocation, pmd.toLocation,
        pmd.fromLocationType, pmd.toLocationType,
    ].map((word) => word | 0);
}

/**
 * `memcpy(pmd, pDSAparameters + 1, sizeof(*pmd))` (doc/CSBwin-src/CSBCode.cpp:7926): the
 * block back from the filter's DSA, `word(i)` its longword `i`.
 */
export function partyMoveDataFromWords(word: (index: number) => number): PartyMoveData {
    const w = (index: number): number => word(index) | 0;
    return {
        moveType: w(0), flags: w(1), delay: w(2),
        staminaAdjustment: [w(3), w(4), w(5), w(6)],
        relDirection: w(7), absDirection: w(8), fromLocation: w(9), toLocation: w(10),
        fromLocationType: w(11), toLocationType: w(12),
    };
}

/** `locr.Integer()` of the party's `LOCATIONREL`: `position`, with `facing` as its position. */
function partyLocation(position: Position, facing: number): number {
    return locationRelToInteger({ l: position.z, x: position.x, y: position.y, p: facing });
}


/**
 * MovementSystem - handles movement validation and collision detection
 */
export class MovementSystem {
    private readonly party: Party;
    private readonly dungeon: DungeonState;

    constructor(private readonly ctx: GameContext) {
        this.party = ctx.party;
        this.dungeon = ctx.dungeon;
    }

    /**
     * Attempt to move the party
     *
     * @param action - Movement action
     * @returns Movement result
     */
    move(action: MovementAction): MovementResult {
        // No timing gate here: `MoveParty` and `TurnParty` have none. The move delay is
        // `HandleMouseEvents`', and so `Game.handleMouseEvents`'.

        // Handle turns (no collision detection needed)
        if (action === MovementAction.TURN_LEFT || action === MovementAction.TURN_RIGHT) {
            return this.handleTurn(action);
        }

        // Handle movement (requires collision detection)
        return this.handleMovement(action);
    }

    /**
     * `MoveParty` (doc/CSBwin-src/CSBCode.cpp:8031) and `_TurnParty` (`:7941`) whole:
     * `move` makes the turn, the stairs or the step, each through the party's world
     * `MoveObject` (`WorldMove.moveParty`); this adds the `d.clockTick = 1` both open
     * with and, on an inhibited step, `DiscardAllInput(); d.clockTick = 0;`.
     * `HandleMouseEvents` (`Game.move`) calls it.
     */
    moveParty(action: MovementAction): MovementResult {
        // `if (extraTicks) d.clockTick = 1;` (doc/CSBwin-src/CSBCode.cpp:7953-7956,
        // `:8171-8174`), before either can return. `extraTicks` is the "Extra Ticks"
        // option, `true` from the start (`data.cpp:280`) and turned off only to play a
        // recording back (`CSBUI.cpp:985`, `:2186`, `:2227`), so it is always on here.
        setClockTick(this.ctx, 1);
        const result = this.move(action);

        if (result.inhibited) {
            // `DiscardAllInput(); d.clockTick = 0;` (doc/CSBwin-src/CSBCode.cpp:8397-8401).
            this.ctx.mouseQueue.discardAllInput();
            setClockTick(this.ctx, 0);
        }
        return result;
    }

    /**
     * The tail of `MoveParty`'s step (doc/CSBwin-src/CSBCode.cpp:8413-8436), after
     * `MoveObject` — so a champion a pit just killed no longer counts:
     *
     *   time2move = 1;
     *   for (i = 0; i < d.NumCharacter; i++)
     *     if (pCharacter->HP() != 0) time2move = sw(Larger(time2move, TimeToMove(pCharacter)));
     *   if (partyMoveData.flags & PM_ADDDELAY)
     *     d.partyMoveDisableTimer = (i16)(d.partyMoveDisableTimer + partyMoveData.delay);
     *   else if ((partyMoveData.flags & PM_SETDELAY) == 0)
     *     d.partyMoveDisableTimer = time2move;
     *   d.Word11712 = 0;
     *
     * `pmd` is the block the party move filter gave back: a delay it set is already in
     * place (`handleMovement`), and one it adds goes on top of it. A stairway is not a
     * step: taking one sets neither.
     */
    private setPartyMoveDelay(pmd: PartyMoveData): void {
        const party = this.party.state;
        let time2move = 1;
        for (const champ of party.champions) {
            if (champ.attributes.health !== 0) {
                time2move = sw(Math.max(time2move, this.ctx.systems.characterStats.timeToMove(champ)));
            }
        }
        if ((pmd.flags & PM_ADDDELAY) !== 0) {
            party.partyMoveDisableTimer = sw(party.partyMoveDisableTimer + pmd.delay);
        } else if ((pmd.flags & PM_SETDELAY) === 0) {
            party.partyMoveDisableTimer = time2move;
        }
        party.word11712 = 0;
    }

    /**
     * `_TurnParty` (doc/CSBwin-src/CSBCode.cpp:7941-8024). The square's flags are read
     * once, before the party move filter, and decide what follows it.
     */
    private handleTurn(action: MovementAction): MovementResult {
        // `_TurnParty`'s `direction`: 1 for a turn left, 2 for a turn right.
        const direction = action === MovementAction.TURN_LEFT ? 1 : 2;
        const party = this.party.state;
        const cellFlags = this.dungeon.getCellFlag(party.position);
        const roomType = (cellFlags >> 5) & 0x7;

        // The party move filter, `PM_BEGINTURN` (doc/CSBwin-src/CSBCode.cpp:7957-7981).
        // `toLocation` faces `(facing + ((direction == 0) ? 1 : -1)) & 3`, and `direction`
        // is never 0, so it is the facing to the left for either turn. On stairs both
        // directions are the stairway's, 3 up and 2 down. CSBWin leaves `delay` and the
        // stamina adjustments unset; they are 0 here.
        const stairDirection = (cellFlags & 4) !== 0 ? 3 : 2;
        const pmd = this.ctx.systems.dsa.partyMoveFilter({
            moveType: PM_BEGINTURN,
            flags: 0,
            delay: 0,
            staminaAdjustment: [0, 0, 0, 0],
            relDirection: roomType === RoomType.STAIRS ? stairDirection : direction,
            absDirection: roomType === RoomType.STAIRS ? stairDirection : direction,
            fromLocation: partyLocation(party.position, party.facing),
            toLocation: partyLocation(party.position, (party.facing - 1) & 3),
            fromLocationType: roomType,
            toLocationType: roomType,
        });
        if ((pmd.flags & PM_INHIBITMOVE) !== 0) return { success: false, refused: true };

        // `FlashButton(_2_, 0xea, 0x0105, 0x7d, 0x91)` for a turn left, `(_3_, 0x123,
        // 0x13e, 0x7d, 0x91)` for a turn right (doc/CSBwin-src/CSBCode.cpp:7983-7990),
        // once the filter has let the turn through, and before the stairs.
        if (action === MovementAction.TURN_LEFT) flashButton(this.ctx, 0xea, 0x0105, 0x7d, 0x91);
        else flashButton(this.ctx, 0x123, 0x13e, 0x7d, 0x91);

        if (roomType === RoomType.STAIRS) {
            return this.traverseStairway((cellFlags & 0x04) !== 0);
        }

        // `PlaceOrRemoveObjectInRoom(d.partyX, d.partyY, RN(RNnul), true, 0)`, then
        // `SetPartyFacing((d.partyFacing + deltaFacing) & 3)`, then the same with `1`
        // (doc/CSBwin-src/CSBCode.cpp:7999-8021): the pads see the party leave and come
        // back, the room unchanged, facing the new way.
        const position = party.position;
        const actuators = this.ctx.systems.actuators;
        actuators.triggerObjectMove(position, OBJECT_ID_NULL, false, true, this.party.state.facing);
        const newFacing = this.party.calculateNewFacing(action);
        this.party.setFacing(newFacing);
        actuators.triggerObjectMove(position, OBJECT_ID_NULL, true, true, this.party.state.facing);

        return {
            success: true,
            newFacing,
        };
    }

    /**
     * `MoveParty`'s four moves (doc/CSBwin-src/CSBCode.cpp:8031-8439). The destination and
     * its flags are read before the party move filter, and decide what follows it.
     */
    private handleMovement(action: MovementAction): MovementResult {
        const party = this.party.state;
        const position = party.position;
        const cellFlagsFrom = this.dungeon.getCellFlag(position);
        const roomTypeFrom = (cellFlagsFrom >> 5) & 0x7;
        // `move` sends only the four moves here, never a turn.
        const relDirection = this.getRelativeDirection(action)!;
        const startingInStairwell = roomTypeFrom === RoomType.STAIRS;

        // `rtTo` (doc/CSBwin-src/CSBCode.cpp:8102-8125): the stairs themselves for a step
        // back out of a stairwell, else the next square's. Off the map, `GetCellFlags`
        // answers a stone cell (`:4674`), so the party bumps the edge of the map as it
        // bumps a wall.
        let newPosition = position;
        let cellFlagsTo = cellFlagsFrom;
        let roomTypeTo: number = RoomType.STAIRS;
        if (!(startingInStairwell && relDirection === 2)) {
            const { tables } = this.ctx;
            const to = RelativeXY(tables, party.facing, tables.word18560[relDirection]!, tables.word18568[relDirection]!, position.x, position.y);
            newPosition = new Position(to.x, to.y, position.z);
            cellFlagsTo = this.dungeon.getCellFlag(newPosition);
            roomTypeTo = (cellFlagsTo >> 5) & 0x7;
        }

        // The party move filter, `PM_ATTEMPTMOVE` (doc/CSBwin-src/CSBCode.cpp:8191-8208),
        // whose `toLocation` is the party's square, as `fromLocation` is: `locr` is not
        // moved between the two. `relDirection` is `button`, `MoveParty`'s argument, 3-6
        // (`:8198`), not the 0-3 the struct's comment promises (`CSB.h:4354`).
        const location = partyLocation(position, party.facing);
        const pmd = this.ctx.systems.dsa.partyMoveFilter({
            moveType: PM_ATTEMPTMOVE,
            flags: 0,
            delay: 0,
            staminaAdjustment: this.staminaAdjustments(),
            relDirection: relDirection + 3,
            absDirection: (relDirection + party.facing) & 3,
            fromLocation: location,
            toLocation: location,
            fromLocationType: roomTypeFrom,
            toLocationType: roomTypeTo,
        });
        if ((pmd.flags & PM_INHIBITMOVE) !== 0) return { success: false, refused: true };

        // A delay the filter set holds whether or not the party moves
        // (doc/CSBwin-src/CSBCode.cpp:8210-8215).
        if ((pmd.flags & PM_SETDELAY) !== 0 && (pmd.flags & PM_ADDDELAY) === 0) {
            party.partyMoveDisableTimer = sw(pmd.delay);
            party.word11712 = 0;
        }
        this.chargeStamina(pmd.staminaAdjustment);

        if (startingInStairwell && relDirection === 2) {
            return this.traverseStairway((cellFlagsFrom & 0x04) !== 0);
        }

        if (roomTypeTo === RoomType.STAIRS) {
            // `MoveObject(RN(RNnul), d.partyX, d.partyY, -1, 0)`, then the party stands on
            // the stairs, then `TraverseStairway(cellFlagsTo & 0x04, true)`
            // (doc/CSBwin-src/CSBCode.cpp:8298-8303).
            this.ctx.systems.worldMove.moveParty(party.position.x, party.position.y, -1, 0);
            party.position = newPosition;
            return this.traverseStairway((cellFlagsTo & 0x04) !== 0);
        }

        // `D5W` — terrain inhibits the move for stone, a door whose state is not 0, 1 or 5,
        // and a false wall with neither bit 0 nor bit 2 set; every other room type,
        // `EMPTY` (7) included, is entered (doc/CSBwin-src/CSBCode.cpp:8311-8348).
        // CSBWin answers a blocked move with the bump and no message.
        let d5w = false;
        if (roomTypeTo === RoomType.STONE) {
            d5w = true;
        } else if (roomTypeTo === RoomType.DOOR) {
            const doorCondition = cellFlagsTo & 7;
            d5w = doorCondition !== 0 && doorCondition !== 1 && doorCondition !== 5;
        } else if (roomTypeTo === RoomType.FALSEWALL) {
            d5w = (cellFlagsTo & 4) === 0 && (cellFlagsTo & 1) === 0;
        }
        if (d5w) return this.bumpWall(newPosition, relDirection);

        // A monster in the destination cell inhibits the move exactly as a wall does
        // — `MoveParty` sets the same `D5W` flag for both
        // (doc/CSBwin-src/CSBCode.cpp:8373-8391):
        //
        //   if (d.NumCharacter != 0) {
        //     if (D5W != 0) { ...wall-bump damage... }
        //     else {
        //       if (direction <= 3) { objD0 = FindFirstMonster(newX,newY); D5W = objD0 != RNeof; }
        //       if (D5W != 0) ProcessTimers29to41(newX, newY, TT_M1, 0);
        //     }
        //   }
        //
        // Three details are load-bearing and easy to lose:
        //
        // - the check is gated on the party having champions, so an empty party walks
        //   through monsters as CSBWin lets it;
        // - `FindFirstMonster` does not test `NonMaterial()`, unlike the door-crush in
        //   `ProcessTT_1` — even an immaterial monster blocks the party;
        // - blocking is *silent*. The wall bump can queue sound 18; this queues nothing.
        //   It pokes the group instead, so the monster gets a turn out of being bumped
        //   into. `TT_M1` is CSBWin's "monster attacked, or the party bumped into it".
        //
        // Every `MovementAction` that reaches here is one of CSBWin's relative
        // directions 0-3 (see `getRelativeDirection`), so the `direction <= 3` test is
        // always true at this point. CSBWin's `direction > 3` arm — Move Up / Move
        // Down, which refuse outright rather than poking the group (`:8287-8291`) — is
        // unreachable here: only the 3DMaze flags `bThreeDMovements` and `bGravityGame`
        // produce those moves (doc/CSBwin-src/data.cpp:240-241). CSBWin reads them from
        // the dungeon's Extended Features (doc/CSBwin-src/SaveGame.cpp:427-430), as the
        // port does (`ctx.rules.bThreeDMovements`, `bGravityGame`), and 3D2D1D sets both;
        // nothing here produces those moves until `DEBT.md` G30.
        if (this.party.state.champions.length !== 0) {
            if (this.dungeon.findFirstMonster(newPosition) !== OBJECT_ID_EOF) {
                // `ProcessTimers29to41(newX, newY, TT_M1, 0)` (doc/CSBwin-src/CSBCode.cpp:8389).
                this.ctx.systems.monsterAI.processTimers29to41({
                    mapX: newPosition.x,
                    mapY: newPosition.y,
                    level: newPosition.z,
                    timerFunction: TimerFunction.TT_M1,
                    timeUntilAlternateUpdate: 0,
                });
                return {
                    success: false,
                    blocked: true,
                    inhibited: true,
                };
            }
        }

        // `MoveObject(RN(RNnul), -1, 0, newX, newY)` out of a stairwell, else from the
        // party's square (doc/CSBwin-src/CSBCode.cpp:8403-8412), then the move delay.
        this.ctx.systems.worldMove.moveParty(
            startingInStairwell ? -1 : party.position.x, party.position.y, newPosition.x, newPosition.y,
        );
        this.setPartyMoveDelay(pmd);
        return {
            success: true,
            newPosition: this.party.state.position,
            stepped: true,
        };
    }

    /**
     * What every step `MoveParty` attempts costs each champion in stamina, worked out
     * before the destination decides anything (doc/CSBwin-src/CSBCode.cpp:8175-8188):
     *
     *   maxLoad = MaxLoad(pCharacter);
     *   D0W = sw((3*pCharacter->load)/maxLoad + 1);
     *   partyMoveData.staminaAdjustment[charIdx] = D0W;
     *
     * and `(unsigned)-1` for each of the four slots past the party. The party move filter
     * may rewrite them.
     */
    private staminaAdjustments(): number[] {
        const champions = this.party.state.champions;
        const staminaAdjustment: number[] = [];
        for (let charIdx = 0; charIdx < 4; charIdx++) {
            const champ = champions[charIdx];
            if (champ) {
                const maxLoad = this.ctx.systems.characterStats.maxLoad(champ);
                staminaAdjustment[charIdx] = sw(div(3 * this.ctx.systems.characterStats.characterLoad(champ), maxLoad) + 1);
            } else {
                staminaAdjustment[charIdx] = -1;
            }
        }
        return staminaAdjustment;
    }

    /**
     * Once the party move filter has let a step through, each champion pays what it left,
     * a step into a wall or a monster as much as a step taken, and the climb out of a
     * stairwell too (doc/CSBwin-src/CSBCode.cpp:8216-8222):
     *
     *   for (charIdx = 0; charIdx < d.NumCharacter; charIdx++)
     *     AdjustStamina(charIdx, partyMoveData.staminaAdjustment[charIdx]);
     *
     * Every champion pays, the dead included (`AdjustStamina` on zero stamina costs a dead
     * champion nothing more). A turn is `TurnParty`, which costs nothing.
     */
    private chargeStamina(staminaAdjustment: readonly number[]): void {
        const champions = this.party.state.champions;
        for (let charIdx = 0; charIdx < champions.length; charIdx++) {
            this.ctx.systems.monsterAttack.adjustStamina(charIdx, staminaAdjustment[charIdx]!);
        }
    }

    /**
     * `MoveParty`'s inhibited-move arm for terrain — stone, a shut door, a solid false
     * wall (doc/CSBwin-src/CSBCode.cpp:8350-8378):
     *
     *   direction = direction + (d.partyFacing + 2);
     *   LOCAL_8 = GetCharacterToDamage(newX, newY, direction & 3);
     *   k = sw(DamageCharacter(LOCAL_8, 1, 24, 2));
     *   LOCAL_10 = GetCharacterToDamage(newX, newY, (direction+1) & 3);
     *   LOCAL_30 = LOCAL_10;
     *   if (LOCAL_8 != LOCAL_30) k |= DamageCharacter(LOCAL_10, 1, 24, 2);
     *   if (k != 0) QueueSound(18, d.partyX, d.partyY, 0);
     *
     * The corners are the two of the new cell on the party's side, so the champions
     * who walked into the wall are the ones hurt, on the legs and feet (mask 24). The
     * bump is silent when nobody was hurt — an empty party, or a blow armour absorbed.
     * `LOCAL_30` is a `ui16`, so a -1 in both compares unequal and `DamageCharacter(-1)`
     * runs, returning 0; the port keeps the comparison as written.
     */
    private bumpWall(newPosition: Position, relDirection: number): MovementResult {
        let k = 0;
        if (this.party.state.champions.length !== 0) {
            const direction = relDirection + ((this.party.state.facing & 3) + 2);
            const local8 = this.ctx.systems.monsterAttack.getCharacterToDamage(newPosition.x, newPosition.y, direction & 3);
            k = sw(this.ctx.systems.monsterAttack.damageCharacter(local8, 1, 24, 2));
            const local10 = this.ctx.systems.monsterAttack.getCharacterToDamage(newPosition.x, newPosition.y, (direction + 1) & 3);
            const local30 = local10 & 0xffff;
            if (local8 !== local30) k |= this.ctx.systems.monsterAttack.damageCharacter(local10, 1, 24, 2);
            if (k !== 0) this.ctx.sounds.queueSound(18, this.party.state.position.x, this.party.state.position.y, 0, this.party.state.position.z);
        }
        return {
            success: false,
            blocked: true,
            inhibited: true,
        };
    }

    private getRelativeDirection(action: MovementAction): number | null {
        switch (action) {
            case MovementAction.MOVE_FORWARD:  return 0;
            case MovementAction.STRAFE_RIGHT:  return 1;
            case MovementAction.MOVE_BACKWARD: return 2;
            case MovementAction.STRAFE_LEFT:   return 3;
            default: return null;
        }
    }

    /**
     * `TraverseStairway(UpOrDown, true)` (doc/CSBwin-src/CSBCode.cpp:7820-7869) from the
     * stairs the party stands on, up when `isUp`. Once the party move filter has let it
     * through, the party is lifted off the stairs and put on the square below or above
     * facing `ExitStairsDirection`, still on the level it left: the top of the next tick
     * loads the new one and places the party there (`d.newPartyLevel`,
     * `Game.loadNewPartyLevel`). A filter that refuses a step into the stairs leaves the
     * party on them, lifted off the square it came from and not yet put down.
     *
     * A stairway to no level is a malformed dungeon, where CSBWin would `LoadLevel(-1)`;
     * the party stays where it is.
     */
    private traverseStairway(isUp: boolean): MovementResult {
        const stairs = this.party.state.position;
        const facing = this.party.state.facing;
        const next = this.dungeon.incrementLevel(stairs, isUp ? -1 : 1);
        if (!next) {
            return {
                success: false,
                blocked: true,
            };
        }
        const newFacing = this.dungeon.getExitStairsDirection(next, facing, this.ctx.tables);

        // The party move filter, `PM_STAIRWAY` (doc/CSBwin-src/CSBCode.cpp:7838-7858). Both
        // directions are `UpOrDown + 2`, and every caller passes `cellFlags & 4`, so they
        // are 2 down and 6 up. `toLocation` faces the way the party does. CSBWin leaves
        // `delay` and the stamina adjustments unset; they are 0 here.
        const direction = (isUp ? 4 : 0) + 2;
        const pmd = this.ctx.systems.dsa.partyMoveFilter({
            moveType: PM_STAIRWAY,
            flags: 0,
            delay: 0,
            staminaAdjustment: [0, 0, 0, 0],
            relDirection: direction,
            absDirection: direction,
            fromLocation: partyLocation(stairs, facing),
            toLocation: partyLocation(next, facing),
            fromLocationType: (this.dungeon.getCellFlag(stairs) >> 5) & 0x7,
            toLocationType: RoomType.STAIRS,
        });
        if ((pmd.flags & PM_INHIBITMOVE) !== 0) return { success: false };

        this.ctx.systems.worldMove.moveParty(stairs.x, stairs.y, -1, 0);
        // `d.newPartyLevel = newPartyLevel; d.partyX = sw(x); d.partyY = sw(y);`, then
        // `SetPartyFacing(newPartyFacing)` (doc/CSBwin-src/CSBCode.cpp:7862-7868).
        this.ctx.loop.newPartyLevel = next.z;
        this.party.state.position = new Position(next.x, next.y, stairs.z);
        this.party.setFacing(newFacing);

        return {
            success: true,
            newPosition: next,
            newFacing,
        };
    }

    /**
     * Get current position info for debugging
     */
    getPositionInfo(): string {
        const position = this.party.state.position;
        const facing = this.party.state.facing;

        const dirNames = ['North', 'East', 'South', 'West'];
        const map = this.dungeon.getMap(position.z);
        const inBounds = !!map && position.x >= 0 && position.x < map.descriptor.width &&
            position.y >= 0 && position.y < map.descriptor.height;
        const tileType = inBounds ? `Type: ${getRoomType(this.dungeon.getCellFlag(position))}` : 'Unknown';

        return `Position: (${position.x}, ${position.y}) Map: ${position.z} Facing: ${dirNames[facing]} ${tileType}`;
    }
}
