/**
 * Party management
 *
 * Handles party position, facing, movement, and champion state
 * Based on CSBWin's party management system
 */

import { ui8, Direction, Position } from '../core/types';
import type { PartyState, Champion, MovementResult } from './gameTypes';
import { GAME_TIMING, MovementAction } from './gameTypes';
import { Direction as Dir } from '../core/types';

/**
 * Party class - manages party state and movement
 */
export class Party {
    state: PartyState;

    constructor(initialPosition: Position, initialFacing: Direction) {
        this.state = {
            champions: [],
            position: initialPosition,
            facing: initialFacing,
            magicCasterIndex: -1,
            cursorOwner: -1,
            selectedCharacterIndex: -1,
            objectInHand: null,
            brightness: 0,
            lastMonsterAttackTime: -200,
            moving: false,
            turning: false,
            lastMoveTime: 0,
        };
    }

    /**
     * Add a champion to the party
     */
    addChampion(champion: Champion): boolean {
        if (this.state.champions.length >= 4) {
            return false; // Party full
        }
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
     * Check if enough time has passed since last movement
     *
     * @param action - Movement action
     * @param currentTime - Current timestamp
     * @returns True if movement is allowed
     */
    canMove(action: MovementAction, currentTime: number): boolean {
        const delay = action === MovementAction.TURN_LEFT || action === MovementAction.TURN_RIGHT
            ? GAME_TIMING.TURN_DELAY_MS
            : GAME_TIMING.MOVE_DELAY_MS;

        return currentTime - this.state.lastMoveTime >= delay;
    }

    /**
     * Apply validated movement
     *
     * This should only be called after collision detection has validated the move
     *
     * @param result - Movement result from collision detection
     */
    applyMovement(result: MovementResult): void {
        if (!result.success) {
            return;
        }

        // Update position if moved
        if (result.newPosition) {
            this.state.position = result.newPosition;
            this.state.moving = true;
        }

        // Update facing if turned
        if (result.newFacing !== undefined) {
            this.state.facing = result.newFacing;
            this.state.turning = true;
        }

        // Update last move time
        this.state.lastMoveTime = Date.now();
    }

    /**
     * Reset movement flags (called after animation completes)
     */
    resetMovementFlags(): void {
        this.state.moving = false;
        this.state.turning = false;
    }

    /**
     * Replace full party state (used for save/load).
     */
    setState(state: PartyState): void {
        this.state = {
            champions: state.champions.map((c) => ({
                ...c,
                attributes: c.attributes,
                incantation: c.incantation,
            })),
            position: new Position(state.position.x, state.position.y, state.position.z),
            facing: state.facing,
            magicCasterIndex: state.magicCasterIndex ?? -1,
            cursorOwner: state.cursorOwner ?? -1,
            selectedCharacterIndex: state.selectedCharacterIndex ?? -1,
            objectInHand: state.objectInHand ?? null,
            brightness: state.brightness ?? 0,
            lastMonsterAttackTime: state.lastMonsterAttackTime ?? -200,
            moving: state.moving,
            turning: state.turning,
            lastMoveTime: state.lastMoveTime,
        };
    }

    /**
     * Get a champion by party position
     */
    getChampion(position: ui8): Champion | null {
        return this.state.champions.find(c => c.partyPosition === position) || null;
    }

    /**
     * Check if any champion is alive
     */
    hasLivingChampions(): boolean {
        return this.state.champions.some(c => c.alive);
    }

    /**
     * Get count of living champions
     */
    getLivingCount(): number {
        return this.state.champions.filter(c => c.alive).length;
    }
}
