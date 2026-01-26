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
import type { ActuatorSystem } from './ActuatorSystem';
import { OBJECT_ID_NULL, Position, RoomType } from '../core/types';
import { SoundIndex } from '../core/constants';

/**
 * MovementSystem - handles movement validation and collision detection
 */
export class MovementSystem {
    private party: Party;
    private dungeon: DungeonState;
    private actuators?: ActuatorSystem;

    constructor(party: Party, dungeon: DungeonState, actuators?: ActuatorSystem) {
        this.party = party;
        this.dungeon = dungeon;
        this.actuators = actuators;
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
                message: 'Invalid map',
                soundId: SoundIndex.WALL_BUMP,
            };
        }

        if (newPosition.x < 0 || newPosition.x >= dimensions.width ||
            newPosition.y < 0 || newPosition.y >= dimensions.height) {
            return {
                success: false,
                blocked: true,
                message: 'The edge of the dungeon blocks your path',
                soundId: SoundIndex.WALL_BUMP,
            };
        }

        // Check if new position is walkable
        if (!this.dungeon.isWalkable(newPosition)) {
            // Get wall type for better message
            const tile = this.dungeon.getTile(newPosition);
            let message = 'A wall blocks your path';

            if (tile) {
                if (this.dungeon.isWall(newPosition)) {
                    message = 'A wall blocks your path';
                } else if (this.dungeon.isDoor(newPosition)) {
                    message = 'A closed door blocks your path';
                }
            }

            return {
                success: false,
                blocked: true,
                message,
                soundId: SoundIndex.WALL_BUMP,
            };
        }

        // Check for special tiles
        const special = this.checkSpecialTiles(newPosition);

        const cellFlagsTo = this.dungeon.getCellFlag(newPosition);
        const roomTypeTo = (cellFlagsTo >> 5) & 0x7;
        if (roomTypeTo === RoomType.STAIRS) {
            return this.traverseStairway(newPosition, (cellFlagsTo & 0x04) !== 0);
        }

        const facing = this.party.state.facing;
        if (this.actuators) {
            this.actuators.triggerObjectMove(position, OBJECT_ID_NULL, false, false, facing);
            this.actuators.triggerObjectMove(newPosition, OBJECT_ID_NULL, true, false, facing);
        }

        // Movement is valid
        return {
            success: true,
            newPosition,
            message: special?.message,
            soundId: special?.soundId,
        };
    }

    /**
     * Check for special tiles (pits, teleporters, etc.)
     *
     * Returns a message if there's something special about this tile
     */
    private checkSpecialTiles(position: Position): { message?: string; soundId?: number } | undefined {
        if (this.dungeon.isPit(position)) return { message: 'You step into a pit!' };
        if (this.dungeon.isTeleporter(position)) {
            return { message: 'You feel a strange sensation...', soundId: SoundIndex.TELEPORT };
        }

        if (this.dungeon.isStairs(position)) return { message: 'You find stairs' };

        // Check for objects
        if (this.dungeon.hasObjects(position)) {
            // Could return info about objects here
        }

        return undefined;
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
                message: 'The stairway does not lead anywhere',
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

        if (result.success) {
            this.party.applyMovement(result);

            // Log message if any
            if (result.message) {
                console.log(result.message);
            }

            return true;
        } else {
            // Log blocked message
            if (result.message) {
                console.log(result.message);
            }

            return false;
        }
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
