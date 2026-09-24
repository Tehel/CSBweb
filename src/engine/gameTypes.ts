/**
 * Game engine types and interfaces
 *
 * Based on CSBWin's game state structures
 * Reference: doc/CSBWIN_ARCHITECTURE.md
 */

import { OBJECT_ID_NULL, type ui8, type ui16, type ui32, type i16, type i32, type Direction, type Position, type ObjectID } from '../core/types';
import type { Attribute } from './attributes';

/**
 * `CHARDESC.possessions[30]` (`doc/CSBwin-src/CSB.h:2579`). CSBWin indexes it with bare
 * numbers, and so does ported code; these name only the slots CSBWin's own comments
 * name, for the port's code that is not a transcription.
 */
export const POSSESSION_COUNT = 30;
/** The hand CSBWin calls the "non-weapon hand" (`doc/CSBwin-src/Character.cpp:3074`). */
export const SLOT_SHIELD_HAND = 0;
/** "Weapon hand = 1" (`doc/CSBwin-src/Attack.cpp:1669`). */
export const SLOT_WEAPON_HAND = 1;

/**
 * Thirty empty slots. An empty slot holds `RNnul`, as in CSBWin
 * (`doc/CSBwin-src/Character.cpp:2912`) and in the save file — never `null`.
 */
export function emptyPossessions(): ObjectID[] {
    return new Array<ObjectID>(POSSESSION_COUNT).fill(OBJECT_ID_NULL);
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
    /**
     * `CHARDESC.title` as its 20 raw bytes, kept only when they hold more than `title`
     * does.
     *
     * A title whose first byte was zeroed by `EditCharacterName`'s insert bug still
     * carries its text after that terminator — `\0HE DEVIL` — and CSBWin prints
     * nothing for it, so `title` is the empty string (`doc/PROVEN_FACTS.md` → "A
     * champion's title can lose its first character"). Every champion in the committed
     * saves of the shipped party is in that state. Encoding `title` back would discard
     * the tail, so the save writer prefers these bytes when they are here.
     */
    titleField?: ui8[];
    /**
     * `CHARDESC.incantation[4]` as its raw bytes, kept only when something survives
     * past the terminator — `CastSpell` clears `incantation[0]` and leaves the rest
     * (`doc/CSBwin-src/Magic.cpp:951`), so `00 69 6f 00` is a normal thing for a save
     * to hold. Dead to the game, part of the file; the writer uses it only while it
     * still agrees with `incantation`.
     */
    incantationField?: ui8[];
    /**
     * `CHARDESC.charFlags` (`doc/CSBwin-src/CSB.h:2461-2481`). Bit 4 is
     * `CHARFLAG_male`; 0xff80 are redraw flags CSBWin sets as the game runs and saves
     * as they stand. Nothing in this port reads them yet — they are carried so a save
     * can be written back with the champion's gender intact.
     */
    charFlags?: i16;
    /**
     * `CHARDESC.timerIndex` — the timer that erases the damage readout over the
     * champion's portrait (`doc/CSBwin-src/CSBCode.cpp:7176-7190`), or -1. This port
     * draws that readout without a timer; the field is carried for the save writer.
     */
    timerIndex?: i16;
    /**
     * `CHARDESC.byte33` — how many symbols of the spell being composed have been
     * entered, 0..3, wrapping (`doc/CSBwin-src/CSBCode.cpp:8988`,
     * `doc/CSBwin-src/Magic.cpp:814-816`). It indexes `incantation`, so this port keeps
     * the array's length instead; the field is carried for the save writer, which
     * cannot derive the wrap at four symbols.
     */
    incantationCursor?: ui8;
    /** `CHARDESC.talents` — a `ui32` `AddCharacter` zeroes (`Character.cpp:510`). */
    talents?: ui32;
    /** `CHARDESC.causeOfDamage` — `enum COD`, what last hurt the champion. */
    causeOfDamage?: ui16;
    /** `CHARDESC.monsterCausingDamage` — which monster it was. */
    monsterCausingDamage?: ui16;
    /**
     * `CHARDESC.load` — tenths of a kilogram, which CSBWin keeps incrementally at each
     * of its eight possession writers. This port re-sums it instead
     * (`CharacterStats.characterLoad`), so the field only carries what a save said.
     */
    load?: ui16;
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

    shieldStrength?: ui16;      // Optional shield strength for UI dots
    /**
     * `CHARDESC.possessions[30]`, the hands included — see `SLOT_WEAPON_HAND`. Always
     * thirty entries; an empty slot is `RNnul` (`emptyPossessions`).
     */
    possessions: ObjectID[];

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
    /** `d.objectInHand` — the object on the cursor, `RNnul` when there is none. */
    objectInHand: ObjectID;
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
    /**
     * `d.partyMoveDisableTimer` — the ticks before the party may step again. A step sets
     * it to the slowest living champion's `TimeToMove` (`doc/CSBwin-src/CSBCode.cpp:8326-8347`),
     * each tick counts it down (`:689-692`), and `HandleMouseEvents` holds a queued step
     * while it is non-zero (`doc/CSBwin-src/Mouse.cpp:1482-1491`). Turns ignore it.
     */
    partyMoveDisableTimer: i16;
    /**
     * `d.Word11712` / `d.Word11714` — a throw's move lock: for 4 ticks
     * (`doc/CSBwin-src/Mouse.cpp:753-754`, counted down at `CSBCode.cpp:694-695`) a
     * step heading in direction `word11714` — the facing the object was thrown in — is
     * held, so the party cannot walk into its own missile.
     */
    word11712: i16;
    word11714: i16;

    // Movement state
    moving: boolean;            // Is party currently moving?
    turning: boolean;           // Is party currently turning?
}

/**
 * Game timing constants (from CSBWin)
 */
export const GAME_TIMING = {
    VBL_FREQUENCY: 60,          // 60 Hz VBL timer
    TICKS_PER_SECOND: 4,        // ~4 game ticks per second
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
    /**
     * `MoveParty`'s `D5W != 0`: terrain or a monster refused the move, and
     * `DiscardAllInput(); d.clockTick = 0;` follow (doc/CSBwin-src/CSBCode.cpp:8310-8314).
     */
    inhibited?: boolean;
    /**
     * `MoveParty`'s `D5W == 0` arm: the party stepped into the next cell (not a stairway),
     * so `d.partyMoveDisableTimer` is set once `MoveObject` has run
     * (doc/CSBwin-src/CSBCode.cpp:8315-8349).
     */
    stepped?: boolean;
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
