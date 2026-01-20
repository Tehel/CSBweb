/**
 * Party management
 *
 * Handles party position, facing, movement, and champion state
 * Based on CSBWin's party management system
 */

import type { ui8, Direction, Coordinates } from '../core/types';
import type { PartyState, Champion, MovementResult } from './gameTypes';
import { GAME_TIMING, MovementAction } from './gameTypes';
import { Direction as Dir } from '../core/types';

/**
 * Party class - manages party state and movement
 */
export class Party {
    private state: PartyState;

    constructor(
        initialPosition: Coordinates,
        initialFacing: Direction,
        mapIndex: ui8 = 0
    ) {
        this.state = {
            champions: [],
            position: { ...initialPosition },
            mapIndex,
            facing: initialFacing,
            magicCasterIndex: -1,
            moving: false,
            turning: false,
            lastMoveTime: 0,
        };
    }

    /**
     * Get current party state
     */
    getState(): Readonly<PartyState> {
        return this.state;
    }

    /**
     * Get current position
     */
    getPosition(): Readonly<Coordinates> {
        return this.state.position;
    }

    /**
     * Get current facing direction
     */
    getFacing(): Direction {
        return this.state.facing;
    }

    /**
     * Get current map index
     */
    getMapIndex(): ui8 {
        return this.state.mapIndex;
    }

    /**
     * Get champions
     */
    getChampions(): ReadonlyArray<Champion> {
        return this.state.champions;
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
    calculateNewPosition(action: MovementAction): Coordinates {
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

        return { x: newX, y: newY };
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
            this.state.position = { ...result.newPosition };
            this.state.moving = true;
        }

        if (result.newMapIndex !== undefined) {
            this.state.mapIndex = result.newMapIndex;
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
     * Set party position (for teleports, etc.)
     */
    setPosition(position: Coordinates, mapIndex?: ui8): void {
        this.state.position = { ...position };
        if (mapIndex !== undefined) {
            this.state.mapIndex = mapIndex;
        }
    }

    /**
     * Set party facing
     */
    setFacing(facing: Direction): void {
        this.state.facing = facing;
    }

    /**
     * Replace full party state (used for save/load).
     */
    setState(state: PartyState): void {
        this.state = {
            champions: state.champions.map((c) => ({
                ...c,
                attributes: { ...c.attributes },
                incantation: c.incantation ? [...c.incantation] : undefined,
            })),
            position: { ...state.position },
            mapIndex: state.mapIndex,
            facing: state.facing,
            magicCasterIndex: state.magicCasterIndex ?? -1,
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
