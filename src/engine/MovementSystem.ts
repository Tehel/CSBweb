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
import { Position, RoomType } from '../core/types';
import { SoundIndex } from '../core/constants';

/**
 * MovementSystem - handles movement validation and collision detection
 */
export class MovementSystem {
    private party: Party;
    private dungeon: DungeonState;

    constructor(party: Party, dungeon: DungeonState) {
        this.party = party;
        this.dungeon = dungeon;
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
