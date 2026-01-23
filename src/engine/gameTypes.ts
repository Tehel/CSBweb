/**
 * Game engine types and interfaces
 *
 * Based on CSBWin's game state structures
 * Reference: doc/CSBWIN_ARCHITECTURE.md
 */

import type { ui8, ui16, i16, Direction, Position } from '../core/types';

// Slots 0-12 are the paper-doll equipment positions; 13-29 are backpack slots.
// CSBWin maps these via inventory button ids 8..20 and 21..37 (HandleClothingClick).
export enum PossessionSlot {
    ShieldHand = 0,
    WeaponHand = 1,
    Head = 2,
    Body = 3,
    Legs = 4,
    Feet = 5,
    Pouch1 = 6,
    Pouch2 = 7,
    Quiver = 8,
    Quiver2 = 9,
    Neck = 10,
    Quiver3 = 11,
    Quiver4 = 12,
    Backpack1 = 13,
    Backpack2 = 14,
    Backpack3 = 15,
    Backpack4 = 16,
    Backpack5 = 17,
    Backpack6 = 18,
    Backpack7 = 19,
    Backpack8 = 20,
    Backpack9 = 21,
    Backpack10 = 22,
    Backpack11 = 23,
    Backpack12 = 24,
    Backpack13 = 25,
    Backpack14 = 26,
    Backpack15 = 27,
    Backpack16 = 28,
    Backpack17 = 29,
}
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
    portraitGraphic?: ui16;     // Optional portrait index in graphic 26
    facing?: Direction;         // Optional facing for UI indicator
    incantation: number[];     // Magic incantation bytes (ASCII)
    food: i16;                 // Signed food level (CSBWin uses negative for starving)
    water: i16;                // Signed water level (CSBWin uses negative for dehydrated)
    wounds?: ui16;             // Bitmask of wounded body parts (CSBWin "ouches")
    poisonCount?: ui8;         // Poison counter for UI and effects

    // Inventory slots (simplified for MVP)
    weaponHand: any | null;     // Right hand weapon
    shieldHand: any | null;     // Left hand shield/weapon
    quiver: any | null;         // Quiver slot
    shieldStrength?: ui16;      // Optional shield strength for UI dots
    possessions?: Array<number | null>; // Optional 30-slot possessions (CSBWin CHARDESC possessions[30])

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
    cursorOwner: number;        // -1 = none
    selectedCharacterIndex: number; // -1 = none
    partyShield?: ui16;         // Optional party shield strength
    fireShield?: ui16;          // Optional fire shield strength
    spellShield?: ui16;         // Optional spell shield strength

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
