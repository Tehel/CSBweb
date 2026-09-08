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
import { OBJECT_ID_EOF, Position, RoomType } from '../core/types';
import type { ObjectID } from '../core/types';
import { SoundIndex } from '../core/constants';

/**
 * What `MoveParty` needs from the monster system.
 *
 * Optional so that a `MovementSystem` built without monsters (some `tools/`) keeps
 * working; when it is absent the monster block below is simply not reached, which is
 * the behaviour this file had before the block existed.
 */
export interface MovementHooks {
    /** `FindFirstMonster(newX, newY)` (doc/CSBwin-src/CSBCode.cpp:8290). */
    findFirstMonster(position: Position): ObjectID;
    /** `ProcessTimers29to41(newX, newY, TT_M1, 0)` (doc/CSBwin-src/CSBCode.cpp:8302). */
    activateMonster(position: Position): void;
}

/**
 * MovementSystem - handles movement validation and collision detection
 */
export class MovementSystem {
    private party: Party;
    private dungeon: DungeonState;
    private hooks?: MovementHooks;

    constructor(party: Party, dungeon: DungeonState, hooks?: MovementHooks) {
        this.party = party;
        this.dungeon = dungeon;
        this.hooks = hooks;
    }

    /**
     * Attempt to move the party
     *
     * @param action - Movement action
     * @returns Movement result
     */
    move(action: MovementAction): MovementResult {
        // Check timing - can we move yet?
        const currentTime = Date.now();
        if (!this.party.canMove(action, currentTime)) return { success: false };

        // Handle turns (no collision detection needed)
        if (action === MovementAction.TURN_LEFT || action === MovementAction.TURN_RIGHT) {
            return this.handleTurn(action);
        }

        // Handle movement (requires collision detection)
        return this.handleMovement(action);
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
        const relDirection = this.getRelativeDirection(action);

        if (roomTypeFrom === RoomType.STAIRS && relDirection === 2) {
            return this.traverseStairway(position, (cellFlagsFrom & 0x04) !== 0);
        }

        const newPosition = this.party.calculateNewPosition(action);

        // Check if new position is within map bounds
        const dimensions = this.dungeon.getMapDimensions(newPosition.z);
        if (!dimensions) {
            return {
                success: false,
                blocked: true,
                soundId: SoundIndex.WALL_BUMP,
            };
        }

        if (newPosition.x < 0 || newPosition.x >= dimensions.width ||
            newPosition.y < 0 || newPosition.y >= dimensions.height) {
            return {
                success: false,
                blocked: true,
                soundId: SoundIndex.WALL_BUMP,
            };
        }

        // Check if new position is walkable.
        // CSBWin answers a blocked move with a sound only — there is no message
        // (`doc/CSBwin-src/Movement.cpp`, `doc/CSBwin-src/Mouse.cpp`).
        if (!this.dungeon.isWalkable(newPosition)) {
            return {
                success: false,
                blocked: true,
                soundId: SoundIndex.WALL_BUMP,
            };
        }

        const cellFlagsTo = this.dungeon.getCellFlag(newPosition);
        const roomTypeTo = (cellFlagsTo >> 5) & 0x7;
        if (roomTypeTo === RoomType.STAIRS) {
            return this.traverseStairway(newPosition, (cellFlagsTo & 0x04) !== 0);
        }

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
        // - blocking is *silent*. The wall bump queues sound 18; this queues nothing.
        //   It pokes the group instead, so the monster gets a turn out of being bumped
        //   into. `TT_M1` is CSBWin's "monster attacked, or the party bumped into it".
        //
        // Every `MovementAction` that reaches here is one of CSBWin's relative
        // directions 0-3 (see `getRelativeDirection`), so the `direction <= 3` test is
        // always true at this point. CSBWin's `direction > 3` arm — the Move Up /
        // Move Down buttons, which refuse outright rather than poking the group
        // (`:8200-8204`) — has no entry point here yet; see PLAN.md.
        if (this.hooks && this.party.state.champions.length !== 0) {
            if (this.hooks.findFirstMonster(newPosition) !== OBJECT_ID_EOF) {
                this.hooks.activateMonster(newPosition);
                return {
                    success: false,
                    blocked: true,
                };
            }
        }

        // Movement is valid
        return {
            success: true,
            newPosition,
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
        const tile = this.dungeon.getTile(position);
        const tileType = tile ? `Type: ${tile.roomType}` : 'Unknown';

        return `Position: (${position.x}, ${position.y}) Map: ${position.z} Facing: ${dirNames[facing]} ${tileType}`;
    }
}
