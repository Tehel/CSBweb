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
import { OBJECT_ID_EOF, OBJECT_ID_NULL, Position, RoomType, getRoomType } from '../core/types';
import { SoundIndex } from '../core/constants';
import { div, sw } from '../core/intCast';
import type { GameContext } from './GameContext';
import { TimerFunction } from './TimerQueue';


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
     * `MoveParty` (doc/CSBwin-src/CSBCode.cpp:7944) whole: `move` is its head (the turn,
     * the stairs, the collision, the stamina); this is the tail (`:8310-8349`) — on a
     * step, the missiles in the way, the pits and teleporters, `MoveObject`'s pads and
     * the move delay; on an inhibited step, `DiscardAllInput(); d.clockTick = 0;`.
     * `HandleMouseEvents` (`Game.move`) calls it.
     */
    moveParty(action: MovementAction): MovementResult {
        const result = this.move(action);

        if (result.success) {
            const oldPos = this.party.state.position;
            const oldFacing = this.party.state.facing;
            let resolvedPosition = result.newPosition;
            let resolvedFacing = result.newFacing ?? oldFacing;
            const { timer, worldMove } = this.ctx.systems;

            if (resolvedPosition) {
                timer.checkMoveFromMissile(oldPos, resolvedPosition, null);
                const teleported = worldMove.resolvePartyMove(resolvedPosition, resolvedFacing);
                resolvedPosition = teleported.position;
                resolvedFacing = teleported.facing;
                result.newPosition = resolvedPosition;
                if (resolvedFacing !== (result.newFacing ?? oldFacing)) {
                    result.newFacing = resolvedFacing;
                }
            }
            this.party.applyMovement(result);
            if (result.stepped) this.setPartyMoveDelay();
            if (resolvedPosition) {
                const unchanged = oldPos.x === resolvedPosition.x
                    && oldPos.y === resolvedPosition.y
                    && oldPos.z === resolvedPosition.z;
                const actuators = this.ctx.systems.actuators;
                actuators.triggerObjectMove(oldPos, OBJECT_ID_NULL, false, unchanged, resolvedFacing);
                actuators.triggerObjectMove(resolvedPosition, OBJECT_ID_NULL, true, unchanged, resolvedFacing);
            }
            worldMove.notePartyMoved();
            this.ctx.systems.monsters.loadPartyLevelOnArrival();
            timer.processTimers(this.ctx.state.tickCount);
        } else if (result.inhibited) {
            // `DiscardAllInput(); d.clockTick = 0;` (doc/CSBwin-src/CSBCode.cpp:8310-8314).
            this.ctx.mouseQueue.discardAllInput();
            this.ctx.loop.clockTickCleared = true;
            this.ctx.loop.clockTickSet = false;
        }
        return result;
    }

    /**
     * The tail of `MoveParty`'s step (doc/CSBwin-src/CSBCode.cpp:8326-8349), after
     * `MoveObject` — so a champion a pit just killed no longer counts:
     *
     *   time2move = 1;
     *   for (i = 0; i < d.NumCharacter; i++)
     *     if (pCharacter->HP() != 0) time2move = sw(Larger(time2move, TimeToMove(pCharacter)));
     *   ...d.partyMoveDisableTimer = time2move;   // unless a party-move filter set a delay
     *   d.Word11712 = 0;
     *
     * A stairway is not a step: taking one sets neither.
     */
    private setPartyMoveDelay(): void {
        const party = this.party.state;
        let time2move = 1;
        for (const champ of party.champions) {
            if (champ.attributes.health !== 0) {
                time2move = sw(Math.max(time2move, this.ctx.systems.characterStats.timeToMove(champ)));
            }
        }
        party.partyMoveDisableTimer = time2move;
        party.word11712 = 0;
    }

    /**
     * Handle turning
     */
    private handleTurn(action: MovementAction): MovementResult {
        const position = this.party.state.position;
        const cellFlags = this.dungeon.getCellFlag(position);
        const roomType = (cellFlags >> 5) & 0x7;

        if (roomType === RoomType.STAIRS) {
            return this.traverseStairway(position, (cellFlags & 0x04) !== 0);
        }

        const newFacing = this.party.calculateNewFacing(action);

        return {
            success: true,
            newFacing,
        };
    }

    /**
     * Handle movement with collision detection
     */
    private handleMovement(action: MovementAction): MovementResult {
        const position = this.party.state.position;
        const cellFlagsFrom = this.dungeon.getCellFlag(position);
        const roomTypeFrom = (cellFlagsFrom >> 5) & 0x7;
        // `move` sends only the four moves here, never a turn.
        const relDirection = this.getRelativeDirection(action)!;

        this.chargeStamina();

        if (roomTypeFrom === RoomType.STAIRS && relDirection === 2) {
            return this.traverseStairway(position, (cellFlagsFrom & 0x04) !== 0);
        }

        const newPosition = this.party.calculateNewPosition(action);

        // Off the map, `GetCellFlags` answers a stone cell (doc/CSBwin-src/CSBCode.cpp:4609),
        // so the party bumps the edge of the map as it bumps a wall.
        const dimensions = this.dungeon.getMapDimensions(newPosition.z);
        if (!dimensions) return this.bumpWall(newPosition, relDirection);

        if (newPosition.x < 0 || newPosition.x >= dimensions.width ||
            newPosition.y < 0 || newPosition.y >= dimensions.height) {
            return this.bumpWall(newPosition, relDirection);
        }

        const cellFlagsTo = this.dungeon.getCellFlag(newPosition);
        const roomTypeTo = (cellFlagsTo >> 5) & 0x7;
        if (roomTypeTo === RoomType.STAIRS) {
            return this.traverseStairway(newPosition, (cellFlagsTo & 0x04) !== 0);
        }

        // `D5W` — terrain inhibits the move for stone, a door whose state is not 0, 1 or 5,
        // and a false wall with neither bit 0 nor bit 2 set; every other room type,
        // `EMPTY` (7) included, is entered (doc/CSBwin-src/CSBCode.cpp:8224-8261).
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
        // (doc/CSBwin-src/CSBCode.cpp:8286-8304):
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
        // Down, which refuse outright rather than poking the group (`:8200-8204`) — is
        // unreachable in CSBWin too: only the 3DMaze flags `ThreeDMovements` and
        // `GravityGame` produce those moves, and both are `false` and never assigned
        // (doc/CSBwin-src/data.cpp:239-240).
        if (this.party.state.champions.length !== 0) {
            if (this.dungeon.findFirstMonster(newPosition) !== OBJECT_ID_EOF) {
                // `ProcessTimers29to41(newX, newY, TT_M1, 0)` (doc/CSBwin-src/CSBCode.cpp:8302).
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

        // Movement is valid
        return {
            success: true,
            newPosition,
            stepped: true,
        };
    }

    /**
     * Every step `MoveParty` attempts costs each champion stamina, before the destination
     * decides anything — a step into a wall or a monster as much as a step taken, and the
     * climb out of a stairwell too (doc/CSBwin-src/CSBCode.cpp:8088-8101, `:8129-8135`):
     *
     *   maxLoad = MaxLoad(pCharacter);
     *   D0W = sw((3*pCharacter->load)/maxLoad + 1);
     *   partyMoveData.staminaAdjustment[charIdx] = D0W;
     *   ...CallPartyMoveFilter(&partyMoveData)...
     *   for (charIdx = 0; charIdx < d.NumCharacter; charIdx++)
     *     AdjustStamina(charIdx, partyMoveData.staminaAdjustment[charIdx]);
     *
     * Every champion pays, the dead included (`AdjustStamina` on zero stamina costs a dead
     * champion nothing more). `CallPartyMoveFilter` is a DSA party-move filter, which can
     * rewrite the adjustments or refuse the move; no loaded dungeon defines one (DEBT.md
     * G2). A turn is `TurnParty`, which costs nothing.
     */
    private chargeStamina(): void {
        const champions = this.party.state.champions;
        const staminaAdjustment: number[] = [];
        for (let charIdx = 0; charIdx < champions.length; charIdx++) {
            const champ = champions[charIdx];
            const maxLoad = this.ctx.systems.characterStats.maxLoad(champ);
            staminaAdjustment[charIdx] = sw(div(3 * this.ctx.systems.characterStats.characterLoad(champ), maxLoad) + 1);
        }
        for (let charIdx = 0; charIdx < champions.length; charIdx++) {
            this.ctx.systems.monsterAttack.adjustStamina(charIdx, staminaAdjustment[charIdx]);
        }
    }

    /**
     * `MoveParty`'s inhibited-move arm for terrain — stone, a shut door, a solid false
     * wall (doc/CSBwin-src/CSBCode.cpp:8263-8291):
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
        }
        return {
            success: false,
            blocked: true,
            inhibited: true,
            soundId: k !== 0 ? SoundIndex.WALL_BUMP : undefined,
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

    private traverseStairway(position: Position, isUp: boolean): MovementResult {
        const delta = isUp ? -1 : 1;
        const next = this.dungeon.incrementLevel(position, delta);

        if (!next) {
            return {
                success: false,
                blocked: true,
            };
        }

        const fallbackFacing = this.party.state.facing;
        const newFacing = this.dungeon.getExitStairsDirection(next, fallbackFacing);

        return {
            success: true,
            newPosition: next,
            newFacing,
        };
    }

    /**
     * Execute a validated movement
     *
     * @param action - Movement action
     * @returns True if movement was executed
     */
    executeMovement(action: MovementAction): boolean {
        const result = this.move(action);

        if (!result.success) return false;

        this.party.applyMovement(result);
        return true;
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
