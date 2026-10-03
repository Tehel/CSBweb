/**
 * Game engine types and interfaces
 *
 * Based on CSBWin's game state structures
 * Reference: doc/CSBWIN_ARCHITECTURE.md
 */

import { OBJECT_ID_NULL, type i8, type ui8, type ui16, type ui32, type i16, type i32, type Direction, type Position, type ObjectID } from '../core/types';
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

/**
 * `CHARDESC::Possession(slot)` (`doc/CSBwin-src/CSB.h:2581`): what the slot holds,
 * `RNnul` when it is empty. CSBWin reads the array unchecked; a slot outside the thirty
 * reads `RNnul` here.
 */
export function getChampionPossession(champion: Champion, slot: number): ObjectID {
    return champion.possessions[slot] ?? OBJECT_ID_NULL;
}

/**
 * `CHARFLAG_attackDisable` (`doc/CSBwin-src/CSB.h:2460`) — the champion is busy.
 * `DisableCharacterAction` sets it when the champion has no busy timer yet
 * (`Magic.cpp:528-531`), `EnableCharacterAction` clears it (`Timer.cpp:2646`), and it
 * shades the attack hand (`Character.cpp:4875`).
 */
export const CHARFLAG_ATTACK_DISABLE = 0x0008;
/** `CHARFLAG_male` — `AddCharacter` ORs it in for an 'M' hero (`Character.cpp:596`). */
export const CHARFLAG_MALE = 0x10;
/**
 * `CHARFLAG_cursor` (`doc/CSBwin-src/CSB.h:2462`): `DrawCharacterState` draws the
 * champion's name again, over the box's name rectangle when their inventory is closed
 * (`doc/CSBwin-src/Character.cpp:1310-1356`).
 */
export const CHARFLAG_CURSOR = 0x0080;
/**
 * `CHARFLAG_portraitChanged` (`doc/CSBwin-src/CSB.h:2471`): `DrawCharacterState` fills
 * the champion's whole box and draws it afresh (`doc/CSBwin-src/Character.cpp:1255-1307`).
 */
export const CHARFLAG_PORTRAIT_CHANGED = 0x1000;
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
    title: string;
    attributes: ChampionAttributes;
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
    facing: Direction;          // CHARDESC.facing
    fingerprint: ui16;          // CSBWin CHARDESC.fingerPrint (used for bones mapping)
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
     * `CHARDESC.charFlags` (`doc/CSBwin-src/CSB.h:2457-2481`). Bit 3 is
     * `CHARFLAG_attackDisable`, the champion's busy state (`CHARFLAG_ATTACK_DISABLE`),
     * and bit 4 `CHARFLAG_male`. 0xff80 are redraw flags CSBWin sets as the game runs
     * and saves as they stand; this port redraws every frame and keeps none of them
     * here, so it carries whatever the file or `AddCharacter` gave it. The two whose
     * redraw goes over something a frame cannot work out again are handed to the host
     * instead (`CHARFLAG_CURSOR`, `CHARFLAG_PORTRAIT_CHANGED`).
     */
    charFlags: i16;
    /**
     * `CHARDESC.timerIndex` — the timer that erases the damage readout over the
     * champion's name or portrait (`doc/CSBwin-src/CSBCode.cpp:7172-7202`), a `TT_12`,
     * or -1. `MonsterAttack.displayCharacterDamage` arms it, `tag011366` clears it.
     */
    timerIndex: i16;
    /** `CHARDESC.talents` — a `ui32` `AddCharacter` zeroes (`Character.cpp:510`). */
    talents: ui32;
    /** `CHARDESC.causeOfDamage` — `enum COD`, what last hurt the champion. */
    causeOfDamage: ui16;
    /** `CHARDESC.monsterCausingDamage` — which monster it was. */
    monsterCausingDamage: ui16;
    /**
     * `CHARDESC.load` — tenths of a kilogram, which CSBWin keeps incrementally at each
     * of its eight possession writers. This port re-sums it instead
     * (`CharacterStats.characterLoad`), so the field only carries what a save said.
     */
    load: ui16;
    incantation: number[];     // Magic incantation bytes (ASCII)
    food: i16;                 // Signed food level (CSBWin uses negative for starving)
    water: i16;                // Signed water level (CSBWin uses negative for dehydrated)
    wounds: ui16;              // Bitmask of wounded body parts (CSBWin "ouches")
    poisonCount: ui8;          // Poison counter for UI and effects
    /**
     * `CHARDESC.maxRecentDamage` — the largest hit taken since the portrait last
     * showed it. Drives which way the damage flash points
     * (`doc/CSBwin-src/Monster.cpp:1237-1242`).
     */
    maxRecentDamage: ui8;
    /** `CHARDESC.facing3` — the direction the biggest recent hit came from. */
    damageFromDirection: ui8;
    /**
     * `CHARDESC.word64` — the temporary defence modifier the champion's *own* attack
     * type imposes while it is in progress, from `Byte20090[attackType]`
     * (`doc/CSBwin-src/Character.cpp:4970`). Mostly negative: swinging leaves you
     * open. Cleared by `EnableCharacterAction`.
     */
    attackStatModifier: i16;
    /**
     * `CHARDESC.attackType` — the attack currently in progress, or -1
     * (`doc/CSBwin-src/Character.cpp:4973`). `EnableCharacterAction` reads it to know
     * whether to clear the defence penalty and whether to reload a bow.
     */
    attackType: i16;
    skills: Skill[];           // CSBWin skills92[20]
    /**
     * `CHARDESC.busyTimer` — the `TT_11` that frees the busy champion, or -1. The busy
     * state itself is `CHARFLAG_attackDisable` in `charFlags`.
     */
    busyTimerIndex: i32;

    shieldStrength: ui16;       // CHARDESC.shieldStrength
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
     * living champion" search.
     */
    potentialChampionIndex: number;
    /**
     * `d.GameIsLost` (`doc/CSBwin-src/Character.cpp:2680`) — set when `KillCharacter`
     * finds no living champion left. The tick's timers still run, then `MainLoop` returns
     * (`Game.gameTick`).
     */
    gameIsLost: boolean;
    /**
     * `d.PendingDamage[4]` (`doc/CSBwin-src/Data.h:762`): what `DamageCharacter` has dealt
     * each champion since the tick's `DisplayCharacterDamage`, which takes it off the HP.
     * Not in a CSBWin save.
     */
    pendingDamage: number[];
    /**
     * `d.PendingOuches[4]` (`doc/CSBwin-src/Data.h:761`): the wounds `DamageCharacter`
     * has marked, OR-ed into `ouches` by the tick's `DisplayCharacterDamage`. Not in a CSBWin
     * save.
     */
    pendingOuches: number[];
    /** `d.objectInHand` — the object on the cursor, `RNnul` when there is none. */
    objectInHand: ObjectID;
    /**
     * `d.PartyShield`, `d.FireShield` and `d.SpellShield` (`doc/CSBwin-src/Data.h:770-772`):
     * what the spells running have added. Signed, and below zero once a timer has taken
     * back more than was there; `DamageCharacter` uses the value as it stands.
     */
    partyShield: i16;
    fireShield: i16;
    spellShield: i16;
    brightness: i16;            // Global ambient light accumulator (CSBWin d.Brightness)
    /**
     * `d.Invisible` and `d.SeeThruWalls` (`doc/CSBwin-src/Data.h:783`, `:768`): the spells
     * still running. Each is a counter read as "not zero", and its timer takes one off
     * with no floor.
     */
    invisible: i8;
    seeThruWalls: i8;
    /**
     * `d.MagicFootprintsActive`: the YA BRO ROS timers still running. The trail it
     * marks, and the range's two indices, are `PartyFootprints`'s.
     */
    magicFootprintsActive: i8;
    lastMonsterAttackTime: i32; // CSBWin d.LastMonsterAttackTime (ticks)
    /**
     * `d.PartySleeping` — set by the sleep icon, button 145, and cleared by `WakeUp`
     * (`MouseSystem.sleep` / `LoopState.wakeUp`, doc/CSBwin-src/Mouse.cpp:1683-1714). While it is
     * set a tick runs every VBL, masteries read 1, quickness halves and the regeneration
     * doubles; a monster's blow wakes the party (`Monster.cpp:4531`). Never saved.
     */
    sleeping: boolean;
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
    /**
     * `d.CH16482[d.NumCharacter..3]` (`doc/CSBwin-src/Data.h:766`): the records in the
     * slots no champion fills, indexed by slot. `AddCharacter` clears a slot before it
     * fills it (`doc/CSBwin-src/Character.cpp:481`), so a champion's own slot holds the
     * zero record here, and `&CHPOSS` is the one reader of the others
     * (`doc/CSBwin-src/DSA.cpp:3345-3347`). A save writes all four records.
     */
    vacantCharacters: VacantCharacter[];
}

/**
 * One of `PartyState.vacantCharacters`. Either the 800 bytes CSBWin holds in the slot —
 * zeros after `DBank::Initialize`'s `memset` at every start
 * (`doc/CSBwin-src/CSBCode.cpp:323-330`), so the possessions read RN 0, not `RNnul`; a
 * save's own after a load, which reads all four records (`SaveGame.cpp:1676`) — or the
 * champion a Cancel in the Hall of Champions leaves there, since
 * `_ResurrectReincarnateCancel` only takes one off `d.NumCharacter`
 * (`CSBCode.cpp:6629-6640`).
 */
export type VacantCharacter = Uint8Array | Champion;

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
}

/**
 * Complete game state
 */
export interface GameState {
    dungeon: DungeonData;       // Dungeon data (maps, objects, etc.)

    paused: boolean;            // The save menu holds the clock (`openSaveMenu`)
    tickCount: ui16;            // Number of game ticks elapsed

    /**
     * `d.Word11694` — set when the game is won (`doc/CSBwin-src/Data.h:927`). While set,
     * invincible monsters stop taking their turns entirely
     * (`doc/CSBwin-src/Monster.cpp:2966-2971`), which is what freezes Lord Chaos after
     * the fusion.
     */
    gameWon: boolean;
    /**
     * `d.Word1868`, set only by `_FusionSequence` once the Grey Lord stands in Lord Chaos's
     * place (`doc/CSBwin-src/Attack.cpp:2367`). While set, `DrawRoomObjects` draws no
     * Fluxcage's shimmer (`Code51a4.cpp:2774`). Not in a save: the credits follow.
     */
    word1868: boolean;
    /**
     * `d.CurrentPalette` — the viewport light-level palette index, 0 (brightest) to 5.
     * `SelectPaletteForLightLevel` sets it where the light changes
     * (`src/engine/LightLevel.ts`); the screen draws the view with that palette, and the
     * monster AI shortens a monster's sight by half of it (`doc/CSBwin-src/Monster.cpp:577-581`).
     */
    currentPalette: number;
    /** The `d.` fields `GAMEBLOCK1` carries, and `totalMoveCount`. */
    block1: Block1State;
}

/**
 * What a save's `GAMEBLOCK1` holds of the game, besides the other blocks' checksums
 * (`doc/CSBwin-src/SaveGame.cpp:1058-1072`). Nothing in play reads any of it: `LoadGame`
 * refuses a save whose `RandomGameID` is not the dead party's, a test no path reaches
 * (`doc/PROVEN_FACTS.md` → "RESTART THIS GAME" clears `d` before the chooser), and
 * CSBWin shows `totalMoveCount` in a debug message. It is here so a save carries it on.
 */
export interface Block1State {
    /** `d.RandomGameID`: two draws of the stream when a new game is read (`SaveGame.cpp:1523-1532`). */
    randomGameID: number;
    /** `d.Word22592`, 13 for `dungeon.dat` (`SaveGame.cpp:1470`). */
    word22592: number;
    /** `d.Word22594`, 1 (`:1469`). */
    word22594: number;
    /** `d.Word22596`, 2 (`:1467`); a save with 1 here is an Atari DM save to `LoadGame`. */
    word22596: number;
    /** `d.Word22598`, 1 (`:1468`). */
    word22598: number;
    /** `d.Byte22808[132]`: zero, and only a loaded save's own otherwise (`:1611`). */
    byte22808: number[];
    /**
     * CSBWin's global `totalMoveCount` (`doc/CSBwin-src/data.cpp:253`): every mouse-queue
     * entry `RECORDFILE::Record` sees below 0x2000, bar its no-op
     * (`doc/CSBwin-src/Recording.cpp:1011-1019`). Not `d.`'s, so a new game keeps it.
     */
    totalMoveCount: number;
}
