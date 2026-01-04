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
        if (!this.party.canMove(action, currentTime)) {
            return {
                success: false,
                message: 'Too soon to move again',
            };
        }

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
        const newPosition = this.party.calculateNewPosition(action);
        const mapIndex = this.party.getMapIndex();

        // Check if new position is within map bounds
        const dimensions = this.dungeon.getMapDimensions(mapIndex);
        if (!dimensions) {
            return {
                success: false,
                blocked: true,
                message: 'Invalid map',
            };
        }

        if (newPosition.x < 0 || newPosition.x >= dimensions.width ||
            newPosition.y < 0 || newPosition.y >= dimensions.height) {
            return {
                success: false,
                blocked: true,
                message: 'The edge of the dungeon blocks your path',
            };
        }

        // Check if new position is walkable
        if (!this.dungeon.isWalkable(mapIndex, newPosition.x, newPosition.y)) {
            // Get wall type for better message
            const tile = this.dungeon.getTile(mapIndex, newPosition.x, newPosition.y);
            let message = 'A wall blocks your path';

            if (tile) {
                if (this.dungeon.isWall(mapIndex, newPosition.x, newPosition.y)) {
                    message = 'A wall blocks your path';
                } else if (this.dungeon.isDoor(mapIndex, newPosition.x, newPosition.y)) {
                    message = 'A closed door blocks your path';
                }
            }

            return {
                success: false,
                blocked: true,
                message,
            };
        }

        // Check for special tiles
        const specialMessage = this.checkSpecialTiles(mapIndex, newPosition.x, newPosition.y);

        // Movement is valid
        return {
            success: true,
            newPosition,
            message: specialMessage,
        };
    }

    /**
     * Check for special tiles (pits, teleporters, etc.)
     *
     * Returns a message if there's something special about this tile
     */
    private checkSpecialTiles(mapIndex: number, x: number, y: number): string | undefined {
        if (this.dungeon.isPit(mapIndex, x, y)) {
            return 'You step into a pit!';
        }

        if (this.dungeon.isTeleporter(mapIndex, x, y)) {
            return 'You feel a strange sensation...';
        }

        if (this.dungeon.isStairs(mapIndex, x, y)) {
            return 'You find stairs';
        }

        // Check for objects
        if (this.dungeon.hasObjects(mapIndex, x, y)) {
            // Could return info about objects here
        }

        return undefined;
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
        const position = this.party.getPosition();
        const facing = this.party.getFacing();
        const mapIndex = this.party.getMapIndex();

        const dirNames = ['North', 'East', 'South', 'West'];
        const tile = this.dungeon.getTile(mapIndex, position.x, position.y);
        const tileType = tile ? `Type: ${tile.roomType}` : 'Unknown';

        return `Position: (${position.x}, ${position.y}) Map: ${mapIndex} Facing: ${dirNames[facing]} ${tileType}`;
    }
}
