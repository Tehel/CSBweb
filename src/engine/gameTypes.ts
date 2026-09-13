/**
 * Game engine types and interfaces
 *
 * Based on CSBWin's game state structures
 * Reference: doc/CSBWIN_ARCHITECTURE.md
 */

import type { ui8, ui16, i16, i32, Direction, Position, ObjectID } from '../core/types';
import type { Attribute } from './attributes';

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

    /**
     * `CHARDESC.Attributes[7]` (`doc/CSBwin-src/CSB.h:2565`), indexed by
     * `AttributeIndex`. Each entry is a (maximum, current, minimum) triple, not a
     * single number: a level gain raises the maximum, a potion the current, a cursed
     * object the minimum, and the stats panel colours a line by comparing the first
     * two. Read and write it through the helpers in `attributes.ts`, which carry
     * CSBWin's byte-wrap and its "above 240 means negative" rule.
     */
    stats: Attribute[];

    // Experience
    experience: ui16;

    // Skills (simplified for MVP)
    fighter: ui8;
    ninja: ui8;
    priest: ui8;
    wizard: ui8;
}

export interface Skill {
    tempAdjust: i16;
    experience: i32;
}

/**
 * Champion (party member)
 */
export interface Champion {
    name: string;
    title?: string;
    attributes: ChampionAttributes;
    alive: boolean;
    portraitGraphic?: ui16;     // Optional portrait index in graphic 26
    /**
     * `CHARDESC.portrait` (`doc/CSBwin-src/CSB.h:2593`) — the champion's own copy of
     * their portrait, 32x29 palette indices, one byte each.
     *
     * CSBWin keeps no index: `AddCharacter` blits the picture into the character record
     * once (`doc/CSBwin-src/Character.cpp:486-508`) and every later draw copies it back
     * out (`CharacterPortraitToStatusBox`, `:4644`). A champion read from a genuine save
     * therefore arrives with pixels and nothing else — an externally supplied portrait
     * is not a cell of graphic 26 at all — so this is what the status box prefers.
     * Champions this engine creates carry `portraitGraphic` instead, because the engine
     * holds no graphics to blit from; the renderer resolves it there.
     */
    portrait?: ui8[];
    facing?: Direction;         // Optional facing for UI indicator
    fingerprint?: ui16;         // CSBWin CHARDESC.fingerPrint (used for bones mapping)
    incantation: number[];     // Magic incantation bytes (ASCII)
    food: i16;                 // Signed food level (CSBWin uses negative for starving)
    water: i16;                // Signed water level (CSBWin uses negative for dehydrated)
    wounds?: ui16;             // Bitmask of wounded body parts (CSBWin "ouches")
    poisonCount?: ui8;         // Poison counter for UI and effects
    /**
     * `CHARDESC.maxRecentDamage` — the largest hit taken since the portrait last
     * showed it. Drives which way the damage flash points
     * (`doc/CSBwin-src/Monster.cpp:1237-1242`).
     */
    maxRecentDamage?: ui8;
    /** `CHARDESC.facing3` — the direction the biggest recent hit came from. */
    damageFromDirection?: ui8;
    /**
     * `CHARDESC.word64` — the temporary defence modifier the champion's *own* attack
     * type imposes while it is in progress, from `Byte20090[attackType]`
     * (`doc/CSBwin-src/Character.cpp:4970`). Mostly negative: swinging leaves you
     * open. Cleared by `EnableCharacterAction`.
     */
    attackStatModifier?: i16;
    /**
     * `CHARDESC.attackType` — the attack currently in progress, or -1
     * (`doc/CSBwin-src/Character.cpp:4973`). `EnableCharacterAction` reads it to know
     * whether to clear the defence penalty and whether to reload a bow.
     */
    attackType?: i16;
    skills: Skill[];           // CSBWin skills92[20]
    actionDisabledUntil?: i32; // Tick when actions re-enable (CSBWin busyTimer)
    busyTimerIndex?: i32;      // Timer index for action disable

    // Inventory slots (simplified for MVP)
    weaponHand: any | null;     // Right hand weapon
    shieldHand: any | null;     // Left hand shield/weapon
    quiver: any | null;         // Quiver slot
    shieldStrength?: ui16;      // Optional shield strength for UI dots
    possessions?: Array<number | null>; // Optional 30-slot possessions (CSBWin CHARDESC possessions[30])

    /**
     * `CHARDESC.charPosition` — which **corner of the cell** the champion stands in,
     * 0-3. It rotates with the party (`doc/CSBwin-src/Code11f52.cpp:4085`), so it is
     * *not* the champion's slot in the four portrait boxes: that is the index into
     * `PartyState.champions`, which never moves. The two happen to agree until the
     * party first turns.
     */
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
    /**
     * `d.PotentialCharacterOrdinal - 1` (`doc/CSBwin-src/Data.h:933`) — the champion
     * standing in a Hall of Champions mirror who has been provisionally added but not
     * confirmed, or -1. They are counted in the party yet skipped by every "find a
     * living champion" search. Nothing sets this yet; Phase 13 step 4 will.
     */
    potentialChampionIndex?: number;
    /**
     * `d.GameIsLost` (`doc/CSBwin-src/Character.cpp:2683`) — set when `KillCharacter`
     * finds no living champion left.
     */
    gameIsLost?: boolean;
    objectInHand?: ObjectID | null; // Object on cursor (CSBWin d.objectInHand)
    partyShield?: ui16;         // Optional party shield strength
    fireShield?: ui16;          // Optional fire shield strength
    spellShield?: ui16;         // Optional spell shield strength
    brightness: i16;            // Global ambient light accumulator (CSBWin d.Brightness)
    invisible?: i16;            // Active invisibility counter
    seeThruWalls?: i16;         // Active see-thru-walls counter
    magicFootprintsActive?: i16; // Active magic footprint counter
    indexOfFirstMagicFootprint?: i16;
    indexOfLastMagicFootprint?: i16;
    numFootprintEnt?: i16;
    lastMonsterAttackTime: i32; // CSBWin d.LastMonsterAttackTime (ticks)
    /**
     * `d.PartySleeping`. A sleeping party neither dodges nor gets lucky, and is woken
     * by any blow that lands (`doc/CSBwin-src/Monster.cpp:4529`).
     *
     * ⏳ Nothing sets this yet — the sleep UI is unported — so it is always false.
     */
    sleeping?: boolean;
    /**
     * `d.freezeLifeTimer` (`doc/CSBwin-src/Data.h:774`). While non-zero every monster
     * that is not `invincible()` is held motionless
     * (`doc/CSBwin-src/Monster.cpp:2996`). Raised by the FREEZE LIFE attack, capped
     * at 200 there and 255 absolutely (`doc/CSBwin-src/Attack.cpp:2062-2067`), and
     * counted down one per game tick (`doc/CSBwin-src/CSBCode.cpp:684`).
     */
    freezeLifeTimer: ui8;

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
    soundId?: number;           // Optional sound effect to play
    soundRateIdx?: number;      // Optional rate index for sound playback
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
