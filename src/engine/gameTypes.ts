/**
 * Game engine types and interfaces
 *
 * Based on CSBWin's game state structures
 * Reference: doc/CSBWIN_ARCHITECTURE.md
 */

import type { ui8, ui16, Direction, Position } from '../core/types';
import type { DungeonData } from '../data/dungeonTypes';

/**
 * Champion attributes (stats)
 */
export interface ChampionAttributes {
    health: ui16;           // Current health
    maxHealth: ui16;        // Maximum health
    stamina: ui16;          // Current stamina
    maxStamina: ui16;       // Maximum stamina
    mana: ui16;             // Current mana
    maxMana: ui16;          // Maximum mana

    // Base attributes
    luck: ui8;
    strength: ui8;
    dexterity: ui8;
    wisdom: ui8;
    vitality: ui8;
    antiMagic: ui8;
    antiFire: ui8;

    // Experience
    experience: ui16;

    // Skills (simplified for MVP)
    fighter: ui8;
    ninja: ui8;
    priest: ui8;
    wizard: ui8;
}

/**
 * Champion (party member)
 */
export interface Champion {
    name: string;
    attributes: ChampionAttributes;
    alive: boolean;
    portraitGraphic?: ui16;     // Optional portrait graphic index
    facing?: Direction;         // Optional facing for UI indicator
    incantation?: number[];     // Magic incantation bytes (ASCII)
    incantationIndex?: number;  // Next rune index (0-3)

    // Inventory slots (simplified for MVP)
    weaponHand: any | null;     // Right hand weapon
    shieldHand: any | null;     // Left hand shield/weapon
    quiver: any | null;         // Quiver slot

    // Position in party (0-3: front-left, front-right, back-left, back-right)
    partyPosition: ui8;
}

/**
 * Party state
 */
export interface PartyState {
    champions: Champion[];      // Up to 4 champions
    position: Position;      // Current map position (x, y, z)
    facing: Direction;          // Current facing direction
    magicCasterIndex: number;   // -1 = none

    // Movement state
    moving: boolean;            // Is party currently moving?
    turning: boolean;           // Is party currently turning?

    // Timing
    lastMoveTime: number;       // Timestamp of last move (for throttling)
}

/**
 * Game timing constants (from CSBWin)
 */
export const GAME_TIMING = {
    VBL_FREQUENCY: 60,          // 60 Hz VBL timer
    TICKS_PER_SECOND: 4,        // ~4 game ticks per second
    MOVE_DELAY_MS: 250,         // Minimum ms between moves
    TURN_DELAY_MS: 200,         // Minimum ms between turns
} as const;

/**
 * Movement action types
 */
export enum MovementAction {
    MOVE_FORWARD = 0,
    MOVE_BACKWARD = 1,
    STRAFE_LEFT = 2,
    STRAFE_RIGHT = 3,
    TURN_LEFT = 4,
    TURN_RIGHT = 5,
}

/**
 * Movement result
 */
export interface MovementResult {
    success: boolean;           // Did the movement succeed?
    newPosition?: Position;  // New position (if moved)
    newFacing?: Direction;      // New facing (if turned)
    blocked?: boolean;          // Was movement blocked by wall?
    message?: string;           // Optional message (e.g., "A wall blocks your path")
}

/**
 * Complete game state
 */
export interface GameState {
    dungeon: DungeonData;       // Dungeon data (maps, objects, etc.)
    party: PartyState;          // Party state

    // Game status
    running: boolean;           // Is game running?
    paused: boolean;            // Is game paused?

    // Timing
    startTime: number;          // Game start timestamp
    currentTime: number;        // Current timestamp
    tickCount: ui16;            // Number of game ticks elapsed
}
