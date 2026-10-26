/**
 * Movement system with collision detection
 *
 * Handles party movement, collision detection, and special tile interactions
 * Based on CSBWin's movement and collision system
 */

import { isAlive } from './rules';
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
import type { PartyMoveData } from './filterParameters';

/** `PARTYMOVE_CONSTANTS` (doc/CSBwin-src/CSB.h:4316-4325): the move types, then the flags. */
export const PM_BEGINTURN = 1;
export const PM_STAIRWAY = 2;
export const PM_ATTEMPTMOVE = 3;
export const PM_INHIBITMOVE = 0x0001;
export const PM_SETDELAY = 0x0002;
export const PM_ADDDELAY = 0x0004;

/**
 * `MoveParty`'s `button` for each of its `direction`s (doc/CSBwin-src/CSBCode.cpp:8091-8093):
 * 3-6 for the steps, `0x1124` down and `0x1125` up.
 */
const MOVE_BUTTON = [3, 4, 5, 6, 0x1124, 0x1125] as const;

/**
 * `MoveParty`'s `if (!gravityMove)` block (doc/CSBwin-src/CSBCode.cpp:8128-8164): the move
 * along `absdir`, 0-3 north, east, south and west, 4 down and 5 up, recorded in
 * `history` (`LoopFlags.moveHistory`).
 *
 *   //       n,e,s,w,u,d
 *   //absdir 0,1,2,3,4,5
 *   //axis   1,0,1,0,2,2
 *   //delta  0,1,1,0,0,1
 *
 * (the comment's u and d are the wrong way round: 4 goes down, `UpdateXY`). Its axis's
 * bit of `[3]` is set for a positive move and cleared for a negative one, and the axis
 * moves to the front of `[0..2]`, one place at a time.
 */
function recordMoveHistory(history: number[], absdir: number): void {
    let axis: number;
    let delta: number;
    if (absdir <= 3) {
        axis = (absdir + 1) & 1;
        delta = ((absdir + 1) & 2) >> 1;
    } else {
        axis = 2;
        delta = (absdir & 1) ^ 1;
    }
    history[3]! |= 1 << axis;
    if (delta === 0) history[3]! ^= 1 << axis;
    if (history[2] === axis) {
        history[2] = history[1]!;
        history[1] = axis;
    }
    if (history[1] === axis) {
        history[1] = history[0]!;
        history[0] = axis;
    }
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
            if (isAlive(champ)) {
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
        const roomType = getRoomType(cellFlags);

        // The party move filter, `PM_BEGINTURN` (doc/CSBwin-src/CSBCode.cpp:7957-7981).
        // `toLocation` faces `(facing + ((direction == 0) ? 1 : -1)) & 3`, and `direction`
        // is never 0, so it is the facing to the left for either turn. On stairs both
        // directions are the stairway's, 3 up and 2 down. CSBWin leaves `delay` and the
        // stamina adjustments unset; they are 0 here.
        const stairDirection = (cellFlags & 4) !== 0 ? 3 : 2;
        const pmd = this.ctx.systems.dsa.filters.partyMoveFilter({
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
            return this.traverseStairway(cellFlags & 0x04, true);
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

        return { success: true };
    }

    /**
     * `MoveParty`'s four steps and its moves down and up (doc/CSBwin-src/CSBCode.cpp:8031-8439).
     * A step's destination and its flags are read before the party move filter, and decide
     * what follows it; a move down or up is stone to the filter, and finds its square after.
     */
    private handleMovement(action: MovementAction): MovementResult {
        const party = this.party.state;
        const position = party.position;
        const cellFlagsFrom = this.dungeon.getCellFlag(position);
        const roomTypeFrom = getRoomType(cellFlagsFrom);
        // `move` sends only the moves here, never a turn. `direction` is `MoveParty`'s:
        // 0-3 a step relative to the facing, 4 down and 5 up (`:8091-8093`).
        const relDirection = this.getRelativeDirection(action)!;
        const startingInStairwell = roomTypeFrom === RoomType.STAIRS;

        // `rtTo` (doc/CSBwin-src/CSBCode.cpp:8102-8125): the stairs themselves for a step
        // back out of a stairwell, else the next square's. Off the map, `GetCellFlags`
        // answers a stone cell (`:4674`), so the party bumps the edge of the map as it
        // bumps a wall. A move down or up is stone, with flags 0, until `UpdateXY` below.
        let newPosition = position;
        let cellFlagsTo = cellFlagsFrom;
        let roomTypeTo: number = RoomType.STAIRS;
        if (!(startingInStairwell && relDirection === 2)) {
            if (relDirection <= 3) {
                const { tables } = this.ctx;
                const to = RelativeXY(tables, party.facing, tables.word18560[relDirection]!, tables.word18568[relDirection]!, position.x, position.y);
                newPosition = new Position(to.x, to.y, position.z);
                cellFlagsTo = this.dungeon.getCellFlag(newPosition);
                roomTypeTo = getRoomType(cellFlagsTo);
            } else {
                cellFlagsTo = 0;
                roomTypeTo = RoomType.STONE;
            }
        }

        // `absdir` (`:8061`, `:8134-8146`): a step's direction plus the facing, and a move
        // down or up's own 4 or 5; but -1 for a gravity step, which leaves the history alone.
        const loop = this.ctx.loop;
        let absDirection = -1;
        if (!loop.gravityMove) {
            absDirection = relDirection <= 3 ? (relDirection + party.facing) & 3 : relDirection;
            recordMoveHistory(loop.moveHistory, absDirection);
        }
        // `if (bGravityGame) { gravityMove = true; nextGravityMoveTime = d.Time + 2; }`
        // (`:8166-8170`): any move starts a slide, even one the filter or a wall refuses.
        if (this.ctx.rules.bGravityGame) {
            loop.gravityMove = true;
            loop.nextGravityMoveTime = this.ctx.state.tickCount + 2;
        }

        // The party move filter, `PM_ATTEMPTMOVE` (doc/CSBwin-src/CSBCode.cpp:8191-8208),
        // whose `toLocation` is the party's square, as `fromLocation` is: `locr` is not
        // moved between the two. `relDirection` is `button`, `MoveParty`'s argument, 3-6
        // (`:8198`), not the 0-3 the struct's comment promises (`CSB.h:4354`).
        const location = partyLocation(position, party.facing);
        const pmd = this.ctx.systems.dsa.filters.partyMoveFilter({
            moveType: PM_ATTEMPTMOVE,
            flags: 0,
            delay: 0,
            staminaAdjustment: this.staminaAdjustments(),
            relDirection: MOVE_BUTTON[relDirection]!,
            absDirection,
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
            return this.traverseStairway(cellFlagsFrom & 0x04, true);
        }

        if (relDirection > 3) return this.moveVertically(relDirection, newPosition);

        if (roomTypeTo === RoomType.STAIRS) {
            // `MoveObject(RN(RNnul), d.partyX, d.partyY, -1, 0)`, then the party stands on
            // the stairs, then `TraverseStairway(cellFlagsTo & 0x04, true)`
            // (doc/CSBwin-src/CSBCode.cpp:8298-8303).
            this.ctx.systems.worldMove.moveParty(party.position.x, party.position.y, -1, 0);
            party.position = newPosition;
            return this.traverseStairway(cellFlagsTo & 0x04, true);
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
        // A move down or up never reaches here (`moveVertically`), so the `direction <= 3`
        // test is always true at this point.
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
            this.ctx.systems.championDamage.adjustStamina(charIdx, staminaAdjustment[charIdx]!);
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
            const local8 = this.ctx.systems.championDamage.getCharacterToDamage(newPosition.x, newPosition.y, direction & 3);
            k = sw(this.ctx.systems.championDamage.damageCharacter(local8, 1, 24, 2));
            const local10 = this.ctx.systems.championDamage.getCharacterToDamage(newPosition.x, newPosition.y, (direction + 1) & 3);
            const local30 = local10 & 0xffff;
            if (local8 !== local30) k |= this.ctx.systems.championDamage.damageCharacter(local10, 1, 24, 2);
            if (k !== 0) this.ctx.sounds.queueSound(18, this.party.state.position.x, this.party.state.position.y, 0, this.party.state.position.z);
        }
        return {
            success: false,
            inhibited: true,
        };
    }

    /**
     * `MoveParty`'s `direction > 3` arm (doc/CSBwin-src/CSBCode.cpp:8255-8291), once the
     * filter has let the move through and the stamina is paid. `UpdateXY` (`:4661-4671`)
     * keeps the party's square and asks `IncrementLevel` for the level below (4) or above
     * (5), shifted by the two levels' offsets; with no such level, the party's own square
     * is stone. Down takes the flags of the square the party stands on, up those of the
     * square above, and only a pit, open or closed, real or fake, lets the party through:
     * anything else is stone (`:8269-8284`).
     *
     * - Through, but a monster on the square: `return result`, `NULL`, and nothing else
     *   (`:8286-8291`): no bump, no poke, the input kept.
     * - Through: `TraverseStairway(direction-4, false)` (`:8307`), the party's facing
     *   kept.
     * - Stone, with champions: the wall bump (`bumpWall`), on the two champions whose side
     *   faces `(direction + d.partyFacing + 2) & 3` and the next, and the input discarded
     *   (`:8309-8401`). `GetCharacterToDamage` hurts no one when the square above or below
     *   is more than a square from the party's x and y (`:6957-6959`).
     * - Stone, with no champion: `if (direction > 3) return result;` (`:8395`).
     */
    private moveVertically(direction: number, partySquare: Position): MovementResult {
        const position = this.party.state.position;
        let newPosition = partySquare;
        let roomTypeTo: number = RoomType.STONE;
        const next = this.dungeon.incrementLevel(position, direction === 4 ? 1 : -1);
        if (next !== null) {
            newPosition = next;
            const cellFlagsTo = this.dungeon.getCellFlag(direction === 5 ? next : position);
            if (getRoomType(cellFlagsTo) === RoomType.PIT) roomTypeTo = RoomType.PIT;
        }
        if (roomTypeTo !== RoomType.STONE) {
            if (this.dungeon.findFirstMonster(newPosition) !== OBJECT_ID_EOF) {
                return { success: false };
            }
            return this.traverseStairway(direction - 4, false);
        }
        if (this.party.state.champions.length === 0) return { success: false };
        return this.bumpWall(newPosition, direction);
    }

    /**
     * `GravityMove` (doc/CSBwin-src/Mouse.cpp:1259-1370): the button of the party's next
     * gravity step, or 0, when it is too soon (`d.Time < nextGravityMoveTime`) or when no
     * axis lets it fall, which ends the slide (`gravityMove = false`). It tries the axes
     * from the least recently moved along, `moveHistory[2]`, to the most, `[0]`, each one
     * square the way the party last moved along it (`:1269-1301`):
     *
     * - the square must be on the map: a vertical axis is the map index above or below,
     *   at the same x and y, not `IncrementLevel`'s (`:1280-1287`);
     * - along the ground, the square must be open floor or a pit; down, the party's own
     *   square must be a pit; up, the square above (`:1288-1310`);
     * - and no monster may stand on it (`:1312`).
     *
     * The step is button 3-6 relative to the party's facing, or `0x1125` up and `0x1124`
     * down (`:1312-1338`, `POST_TRANSLATE_CLICK`).
     */
    gravityMove(): number {
        const loop = this.ctx.loop;
        const party = this.party.state;
        if (this.ctx.state.tickCount < loop.nextGravityMoveTime) return 0;
        const history = loop.moveHistory;
        const numLevels = this.dungeon.getData().maps.length;
        for (let i = 2; i >= 0; i--) {
            const axis = history[i]!;
            const delta = (history[3]! & (1 << axis)) !== 0 ? 1 : -1;
            let level = party.position.z;
            let x = party.position.x;
            let y = party.position.y;
            if (axis === 0) x += delta;
            else if (axis === 1) y += delta;
            else level += delta;
            if (x < 0 || y < 0 || level < 0 || level >= numLevels) continue;
            const descriptor = this.dungeon.getMap(level)!.descriptor;
            if (x > descriptor.width - 1 || y > descriptor.height - 1) continue;
            const roomTypeHere = getRoomType(this.dungeon.getCellFlag(party.position));
            const target = new Position(x, y, level);
            const roomTypeThere = getRoomType(this.dungeon.getCellFlag(target));
            if (axis !== 2) {
                if (roomTypeThere !== RoomType.PIT && roomTypeThere !== RoomType.OPEN) continue;
            } else if (delta === 1) {
                if (roomTypeHere !== RoomType.PIT) continue;
            } else if (roomTypeThere !== RoomType.PIT) {
                continue;
            }
            if (this.dungeon.findFirstMonster(target) !== OBJECT_ID_EOF) continue;
            if (axis === 2) return delta === 1 ? 0x1124 : 0x1125;
            const absdir = axis === 0 ? (delta === 1 ? 1 : 3) : (delta === 1 ? 2 : 0);
            return 3 + ((absdir - party.facing) & 3);
        }
        loop.gravityMove = false;
        return 0;
    }

    private getRelativeDirection(action: MovementAction): number | null {
        switch (action) {
            case MovementAction.MOVE_FORWARD:  return 0;
            case MovementAction.STRAFE_RIGHT:  return 1;
            case MovementAction.MOVE_BACKWARD: return 2;
            case MovementAction.STRAFE_LEFT:   return 3;
            case MovementAction.MOVE_DOWN:     return 4;
            case MovementAction.MOVE_UP:       return 5;
            default: return null;
        }
    }

    /**
     * `TraverseStairway(UpOrDown, setFacing)` (doc/CSBwin-src/CSBCode.cpp:7820-7869), up
     * when `upOrDown` is not 0: from the stairs the party stands on, `cellFlags & 4` and
     * `true`, or a move down or up's `direction - 4`, 0 or 1, and `false`. Once the party
     * move filter has let it through, the party is lifted off its square and put on the
     * one below or above, still on the level it left: the top of the next tick loads the
     * new one and places the party there (`d.newPartyLevel`, `Game.loadNewPartyLevel`).
     * With `setFacing` it faces `ExitStairsDirection`, else the way it did. A filter that
     * refuses a step into the stairs leaves the party on them, lifted off the square it
     * came from and not yet put down.
     *
     * A stairway to no level is a malformed dungeon, where CSBWin would `LoadLevel(-1)`;
     * the party stays where it is. A move down or up has found its level already.
     */
    private traverseStairway(upOrDown: number, setFacing: boolean): MovementResult {
        const stairs = this.party.state.position;
        const facing = this.party.state.facing;
        const next = this.dungeon.incrementLevel(stairs, upOrDown === 0 ? 1 : -1);
        if (!next) {
            return {
                success: false,
            };
        }
        const newFacing = this.dungeon.getExitStairsDirection(next, facing, this.ctx.tables);

        // The party move filter, `PM_STAIRWAY` (doc/CSBwin-src/CSBCode.cpp:7838-7858). Both
        // directions are `UpOrDown + 2`: 2 down and 6 up from the stairs, 2 down and 3 up
        // for a move down or up. `toLocation` faces the way the party does. CSBWin leaves
        // `delay` and the stamina adjustments unset; they are 0 here.
        const direction = upOrDown + 2;
        const pmd = this.ctx.systems.dsa.filters.partyMoveFilter({
            moveType: PM_STAIRWAY,
            flags: 0,
            delay: 0,
            staminaAdjustment: [0, 0, 0, 0],
            relDirection: direction,
            absDirection: direction,
            fromLocation: partyLocation(stairs, facing),
            toLocation: partyLocation(next, facing),
            fromLocationType: getRoomType(this.dungeon.getCellFlag(stairs)),
            toLocationType: RoomType.STAIRS,
        });
        if ((pmd.flags & PM_INHIBITMOVE) !== 0) return { success: false };

        this.ctx.systems.worldMove.moveParty(stairs.x, stairs.y, -1, 0);
        // `d.newPartyLevel = newPartyLevel; d.partyX = sw(x); d.partyY = sw(y);`, then
        // `if (setFacing) SetPartyFacing(newPartyFacing)` (doc/CSBwin-src/CSBCode.cpp:7862-7868).
        this.ctx.loop.newPartyLevel = next.z;
        this.party.state.position = new Position(next.x, next.y, stairs.z);
        if (setFacing) this.party.setFacing(newFacing);

        return {
            success: true,
            newPosition: next,
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
