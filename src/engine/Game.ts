/**
 * Main game class
 *
 * Ties together all game systems and implements game loop
 * Based on CSBWin's VBL-driven game loop
 */

import type {
    ActuatorRecord,
    DatabaseRecord,
    DungeonData,
    Item16Record,
    MissileRecord,
    PresetHero,
    TeleporterRecord,
    TimerRecord,
} from '../data/dungeonTypes';
import type { GameState, Champion, PartyState, MovementResult } from './gameTypes';
import { GAME_TIMING, MovementAction } from './gameTypes';
import { Party, ensureHandOwner, findChampionByFingerprint, selectMagicCaster, setHandOwner } from './Party';
import { applyFeedParameters, type FeedParameters } from './Feeding';
import { DungeonState } from './DungeonState';
import { MovementSystem } from './MovementSystem';
import { applySaveGameState, type SaveGameState } from '../data/SaveGameLoader';
import { ActuatorSystem, type ActuatorTables } from './ActuatorSystem';
import { TimerQueue, TimerFunction } from './TimerQueue';
import { TimerSystem, type TimerTables, type TimerHooks } from './TimerSystem';
import { MonsterSystem, type MonsterSystemHooks } from './MonsterSystem';
import { SoundQueue } from './SoundQueue';
import { PartyFootprints, type FootprintsSnapshot } from './PartyFootprints';
import type { DungeonSnapshot } from './DungeonSnapshot';
import { MonsterPerception } from './MonsterPerception';
import { MonsterDamage, MonsterDamageResult } from './MonsterDamage';
import { MonsterAI } from './MonsterAI';
import { MonsterAttack } from './MonsterAttack';
import { AttackSystem } from './AttackSystem';
import { AttackType } from './monsterTypes';
import { constructPredefinedMissile } from './missileHelpers';
import { DsaSystem, type DsaTables, type ViewingFilterOptions, type ViewingFilterResult } from './DsaSystem';
import { adjustSkills, determineMastery, ensureSkills, AdjustSkillsWhy } from './skills';
import { DBType, decodeObjectID, encodeObjectID, OBJECT_ID_EOF, OBJECT_ID_NULL, Position, RoomType, type ObjectID } from '../core/types';
import { MISC_BONES_OF_HERO, SoundIndex } from '../core/constants';
import { CsbRandom } from '../core/random';

/**
 * Champion wound sounds, in party-position order. CSBWin reaches these as sound
 * ordinals `chIdx + 9` (doc/CSBwin-src/Monster.cpp:4584); ordinals 9-12 resolve
 * through `graphic232.soundTable` to SND items 541-544.
 */
const CHAMP_WOUND_SOUNDS = [
    SoundIndex.CHAMP_WOUND_1,
    SoundIndex.CHAMP_WOUND_2,
    SoundIndex.CHAMP_WOUND_3,
    SoundIndex.CHAMP_WOUND_4,
];
import {
    ActuatorAction,
    PORTRAIT_INACTIVE,
    blocksDisables,
    getActuatorState,
    getActuatorType,
    setActuatorType,
} from '../data/actuatorHelpers';
import { MSG_COLOR_SPELL } from './ActuatorSystem';
import { CharacterStats } from './CharacterStats';
import type { SpellDefinition } from '../data/spellTypes';
import type { SpellParameters } from './magicTypes';
import {
    OBJNI_EMPTY_FLASK,
    OBJNI_TORCH_A,
    OBJNI_TORCH_D,
} from '../core/objectNameIndex';
import {
    AttributeIndex,
    attributeCurrent,
    attributeMaximum,
    attributeMinimum,
    championAttribute,
    setAttributeCurrent,
    setAttributeMaximum,
} from './attributes';
import {
    assignAddCharacterPossessions,
    computeChampionFingerprint,
    createChampionFromPreset,
    findFreeCharPosition,
    type AddCharacterItem,
    type AddCharacterTables,
} from './AddCharacter';
import { DELTA_X, DELTA_Y } from './MonsterPerception';

/**
 * Game event callback types
 */
export type GameEventCallback = (game: Game) => void;
export type MovementCallback = (success: boolean, result?: MovementResult) => void;

interface DropCursorOptions {
    viAltar?: boolean;
}

/**
 * The quick-save payload.
 *
 * Version 2 added `dungeon.snapshot` and the `game` fields below it. Version 1
 * carried only the party, the tick count, the `ITEM16` pool, the timers and the
 * missile records, so restoring one reset the whole world — doors, moved objects,
 * fired actuators — while leaving the party's inventory alone.
 *
 * Version 3 replaced the champions' seven flat attribute numbers with CSBWin's
 * `(maximum, current, minimum)` triples (`ChampionAttributes.stats`).
 *
 * Version 4 is not a change to this structure at all — it is the *binary* half beside
 * it. `SaveGameLoader` used to read and write GAMEBLOCK1/2, `ITEM16` and the timers as
 * little-endian words, a self-consistent format that was not CSBWin's; those blocks are
 * big-endian in the file (`doc/CSBwin-src/CSBCode.cpp:9057`). Fixing that makes every
 * v3 payload unreadable, so the version moves with it.
 *
 * No bump has an upgrade path: `quickLoad` refuses an older save rather than
 * restoring a half-state.
 */
export const RUNTIME_SAVE_VERSION = 4;

export interface RuntimeSaveState {
    version: typeof RUNTIME_SAVE_VERSION;
    savedAt: number;
    party: PartyState;
    game: {
        tickCount: number;
        paused: boolean;
        elapsedTimeMs: number;
        /** `d.RandomNumber`, so a reload continues the same stream. */
        randomSeed: number;
        /** `d.Word11694`. */
        gameWon: boolean;
        /** `d.PartyFootprints` + `d.Byte13220` — the scent trail monsters follow. */
        footprints: FootprintsSnapshot;
        /** The DSA global variables, where a dungeon keeps its puzzle progress. */
        dsaGlobals: number[];
    };
    dungeon: {
        item16?: Item16Record[];
        timers?: TimerRecord[];
        missiles?: MissileRecord[];
        /** Everything play can change: cell flags, object chains, all DB records. */
        snapshot: DungeonSnapshot;
    };
}

/**
 * Game class - main game controller
 */
export class Game {
    state: GameState;
    party: Party;
    dungeonState: DungeonState;
    private movementSystem: MovementSystem;
    private movementQueue: MovementAction[] = [];
    private readonly movementQueueLen = 3; // CSBUI.cpp keyQueueLen
    /** The timer queue. Public like the other subsystems; `tools/` drives it. */
    readonly timerQueue: TimerQueue;
    /**
     * The game's random stream, CSBWin's `d.RandomNumber`. Everything with a
     * game-visible outcome draws from this one instance, in CSBWin's order, so a
     * seeded run is reproducible and an AI trace is comparable with CSBWin's.
     * Rendering must never draw from it — CSBWin keeps a separate `viewportRandom`
     * precisely so drawing "doesn't upset the game"
     * (doc/CSBwin-src/Viewport.cpp:6706).
     */
    /**
     * `d.RandomNumber` (`doc/CSBwin-src/CSBCode.cpp:351`). Seeded from the host on first
     * draw; `setRandomSeed` exists so a verification tool can pin the stream, which is
     * what makes a run repeatable.
     */
    private random = new CsbRandom();
    private actuators: ActuatorSystem;
    /**
     * The timer system. Public like the other subsystems — `tools/` drives
     * `processTimers` directly to turn the clock without a browser.
     */
    readonly timerSystem: TimerSystem;
    /** Monster group lifecycle and movement. Public for the same reason. */
    readonly monsterSystem: MonsterSystem;
    /**
     * The party's footprint trail — `d.PartyFootprints` (doc/CSBwin-src/Data.h:781).
     * Monsters smell it when they cannot see the party, and the Magic Footprints
     * spell draws from it.
     */
    readonly footprints = new PartyFootprints();
    /**
     * Monster sight, smell and step probing (`doc/CSBwin-src/Monster.cpp`).
     * Public because the AI state machine and `tools/dump-monster-perception.ts`
     * both drive it directly.
     */
    readonly monsterPerception: MonsterPerception;
    /**
     * `DamageMonster` and friends. Public because the missile system, the monster AI
     * and (later) champion melee all reach it, and `tools/` drives it directly.
     */
    readonly monsterDamage: MonsterDamage;
    /** The monster AI state machine (`doc/CSBwin-src/Monster.cpp`). */
    readonly monsterAI: MonsterAI;
    /** Monsters hitting the party (`doc/CSBwin-src/Monster.cpp:944`). */
    readonly monsterAttack: MonsterAttack;
    /** The champions' own attacks (`doc/CSBwin-src/Attack.cpp`). */
    readonly attackSystem: AttackSystem;
    /** `d.Byte20090[44]` — the defence penalty each attack type carries while busy. */
    private readonly byte20090: ArrayLike<number> | null;
    /**
     * `d.Word11694` — set when the game is won (`doc/CSBwin-src/Data.h:927`). While
     * set, invincible monsters stop taking their turns entirely
     * (`doc/CSBwin-src/Monster.cpp:2966-2971`), which is what freezes Lord Chaos
     * after the fusion.
     */
    gameWon = false;

    /**
     * `d.CurrentPalette` — the viewport light-level palette index, 0 (brightest) to 5.
     *
     * The renderer computes it and writes it here each frame; the monster AI reads it
     * to shorten sight distance in the dark (`doc/CSBwin-src/Monster.cpp:577-581`).
     * That is the same direction of flow as CSBWin, where the renderer sets the
     * global and `Blocked` reads it.
     */
    currentPalette = 0;

    /** `QueueSound` — sounds named by ordinal, attenuated by distance from the party. */
    readonly sounds: SoundQueue;
    private playSound?: (soundId: number, rateIdx?: number, distance?: number) => void;
    private dsaSystem: DsaSystem;
    private objDescObjectType: ArrayLike<number> | null = null;
    /**
     * `d.ObjDesc[].word4` and `d.CarryLocation[]`, the two tables `AddCharacter` needs
     * to pick a possession slot. Taken from the actuator tables, which already carry
     * both, so there is one copy in the engine.
     */
    private addCharacterTables: AddCharacterTables | null = null;
    /**
     * `reincarnateAttributePenalty` / `reincarnateStatPenalty`
     * (`doc/CSBwin-src/Character.cpp:14`) — CSBWin holds them in file-scope globals that
     * `AddCharacter` fills in while parsing the hero text and
     * `_ResurrectReincarnateCancel` reads back. Same lifetime here.
     */
    private reincarnationSource: PresetHero | null = null;
    /**
     * `GetObjectWeight` / `MaxLoad` / `DetermineThrowingDistance` / `Quickness`
     * (`src/engine/CharacterStats.ts`). Public because the throw path, the armour
     * calculation and `tools/` all reach it.
     */
    readonly characterStats: CharacterStats;
    private spellDefinitions: SpellDefinition[] = [];

    // Game loop
    private running: boolean = false;
    private lastTickTime: number = 0;
    private animationFrameId: number | null = null;

    // Event callbacks
    private onTickCallbacks: GameEventCallback[] = [];
    private onMoveCallbacks: MovementCallback[] = [];

    constructor(
        dungeonData: DungeonData,
        actuatorTables?: ActuatorTables,
        timerTables?: TimerTables,
        dsaTables?: DsaTables,
        timerHooks?: TimerHooks,
        playSound?: (soundId: number, rateIdx?: number, distance?: number) => void,
        monsterHooks?: MonsterSystemHooks,
    ) {
        // Initialize dungeon state
        this.dungeonState = new DungeonState(dungeonData);

        // Initialize party at starting position
        const startPos = this.dungeonState.getStartPosition();
        const startFacing = this.dungeonState.getStartFacing();

        this.party = new Party(startPos, startFacing);

        // Initialize game state
        this.state = {
            dungeon: dungeonData,
            party: this.party.state,
            running: false,
            paused: false,
            startTime: Date.now(),
            currentTime: Date.now(),
            tickCount: 0,
        };

        this.timerQueue = new TimerQueue();
        this.playSound = playSound;
        this.actuators = new ActuatorSystem(
            this.dungeonState,
            () => this.party.state,
            this.timerQueue,
            () => this.state.tickCount,
            this.random,
            actuatorTables,
        );
        this.dsaSystem = new DsaSystem(
            this.dungeonState,
            () => this.state.tickCount,
            this.timerQueue,
            this.random,
            () => this.party.state,
            dsaTables ?? actuatorTables,
            this.actuators,
        );
        this.actuators.setTables({
            adjustSkillsFilter: (params) => this.dsaSystem.processAdjustSkillsFilter(params),
            // A click on a Hall of Champions mirror (`doc/CSBwin-src/Mouse.cpp:513`).
            // Wired here rather than by the host so the tools get it too.
            onAddCharacter: (charID, mirrorCell, wall) => this.addCharacter(charID, mirrorCell, wall),
        });
        this.timerSystem = new TimerSystem(
            this.dungeonState,
            () => this.party.state,
            this.timerQueue,
            this.actuators,
            this.random,
            timerTables,
            {
                onDsaTimer5: (rn, timer, loc) => this.dsaSystem.processTimer5(rn, timer, loc),
                onDsaTimer6: (rn, timer, loc) => this.dsaSystem.processTimer6(rn, timer, loc),
                onDsaTimer7: (rn, timer, loc) => this.dsaSystem.processTimer7(rn, timer, loc),
                onMissileHitParty: (options) => this.applyMissileDamageToParty(options),
                onMissileHitMonster: (options) => this.applyMissileDamageToMonster(options),
                onMonsterAI: (options) => this.monsterAI.processTimers29to41(options),
                onMonsterAbeyance: (timer) => this.monsterSystem.processAbeyanceTimer(timer),
                // The cloud machinery: `ProcessTT_25` needs to hurt whatever is standing
                // in the cloud, and those live in MonsterAttack and MonsterDamage.
                queueSound: (ordinal, mapX, mapY, deltaTime) =>
                    this.sounds.queueSound(ordinal, mapX, mapY, deltaTime),
                damageAllCharacters: (damage, woundMask, kind) =>
                    this.monsterAttack.damageAllCharacters(damage, woundMask, kind),
                damageMonsterGroup: (monster, level, mapX, mapY, damage, noItem16) =>
                    this.monsterDamage.damageMonsterGroup(
                        monster, level, mapX, mapY, damage, true, noItem16 ?? false,
                    ),
                adjustStamina: (chIdx, decrement) => this.monsterAttack.adjustStamina(chIdx, decrement),
                maxLoad: (champ) => this.characterStats.maxLoad(champ),
                characterLoad: (champ) => this.characterStats.characterLoad(champ),
                determinePoisonDamage: (monsterType, damage) =>
                    this.monsterDamage.determinePoisonDamage(monsterType, damage),
                onSpawnMonster: (o) => {
                    this.monsterSystem.createMonster({
                        value: o.type,
                        hitPointMultiplier: o.hitPointMultiplier,
                        numMonM1: o.countMinus1,
                        facing: o.facing,
                        mapX: o.x,
                        mapY: o.y,
                        level: this.party.state.position.z,
                        // CSBWin passes `normallyClosed()` as `invisible` and
                        // `drawAsSize4()` as itself (doc/CSBwin-src/Timer.cpp:1785-1793).
                        invisible: o.normallyClosed,
                        drawAsSize4: o.drawAsSize4,
                    });
                },
                onPartyMoved: () => this.notePartyMoved(),
                onPoisonTick: (chIdx, remaining) => this.monsterAttack.poisonCharacter(chIdx, remaining),
                onEnableCharacterAction: (chIdx, refillSlot) => this.enableCharacterAction(chIdx, refillSlot),
                isGameWon: () => this.gameWon,
                onMissileEncounterFilter: (options) => this.dsaSystem.processMissileEncounterFilter(options),
                playSound: (soundId, rateIdx, distance) => this.playSound?.(soundId, rateIdx, distance),
                ...timerHooks,
            },
        );
        this.sounds = new SoundQueue({
            soundTable: timerTables?.soundTable,
            getPartyPosition: () => this.party.state.position,
            // Only the party's level is ever loaded in this port; CSBWin's
            // `d.LoadedLevel` can differ transiently while it walks another level.
            getLoadedLevel: () => this.party.state.position.z,
            play: playSound,
        });
        this.monsterSystem = new MonsterSystem(
            this.dungeonState,
            () => this.party.state,
            this.timerQueue,
            () => this.state.tickCount,
            this.random,
            { monsterDesc: timerTables?.monsterDesc },
            {
                queueSound: (ordinal, mapX, mapY, deltaTime) =>
                    this.sounds.queueSound(ordinal, mapX, mapY, deltaTime),
                checkMoveFromMissile: (from, to, monsterRn) =>
                    this.timerSystem.checkMonsterMoveFromMissile(from, to, monsterRn),
                resolveMonsterDestination: (destination, monsterRn) =>
                    this.timerSystem.resolveMonsterDestination(destination, monsterRn),
                ...monsterHooks,
            },
        );
        this.monsterDamage = new MonsterDamage(
            this.dungeonState,
            () => this.party.state.position.z,
            this.timerQueue,
            this.random,
            {
                monsterDesc: timerTables?.monsterDesc,
                monsterDroppings: timerTables?.monsterDroppings,
                facingReplication: timerTables?.facingReplication,
            },
            {
                queueSound: (ordinal, mapX, mapY, deltaTime) =>
                    this.sounds.queueSound(ordinal, mapX, mapY, deltaTime),
                createCloud: (projectile, size, position, posInCell) =>
                    this.timerSystem.createDeathCloud(projectile, size, position, posInCell),
                trace: monsterHooks?.trace,
            },
        );
        this.monsterDamage.onItem16Freed = () => this.monsterSystem.noteItem16Freed();
        this.monsterPerception = new MonsterPerception(
            this.dungeonState,
            () => this.party.state.position.z,
            this.random,
            this.footprints,
            () => timerTables?.monsterDesc ?? null,
            () => timerTables?.doorCharacteristics ?? null,
        );
        this.monsterAttack = new MonsterAttack(
            this.dungeonState,
            () => this.party.state,
            () => this.state.tickCount,
            this.random,
            () => this.dungeonState.getMap(this.party.state.position.z)?.descriptor.difficulty ?? 0,
            {
                monsterDesc: timerTables?.monsterDesc,
                monsterAttackSounds: timerTables?.monsterAttackSounds,
                uByte590: timerTables?.uByte590,
                byte586: timerTables?.byte586,
                clothingArmour: timerTables?.clothingArmour,
                clothingFlags: timerTables?.clothingFlags,
                byte1412: timerTables?.byte1412,
            },
            {
                queueSound: (ordinal, mapX, mapY, deltaTime) =>
                    this.sounds.queueSound(ordinal, mapX, mapY, deltaTime),
                launchMissile: (o) => this.timerSystem.launchMonsterMissile(o),
                registerBones: (bones, chIdx) => this.registerChampionBones(bones, chIdx),
                dropAllPossessions: (chIdx) => this.dropAllPossessions(chIdx),
                onChampionDied: (chIdx) => this.onChampionDied(chIdx),
                schedulePoison: (chIdx, remaining) =>
                    this.timerSystem.schedulePoison(chIdx, remaining, this.party.state.position.z),
                cancelPoisonTimers: (chIdx) => this.timerSystem.cancelPoisonTimers(chIdx),
                trace: monsterHooks?.trace,
            },
        );
        this.monsterAI = new MonsterAI({
            dungeon: this.dungeonState,
            getPartyState: () => this.party.state,
            getTime: () => this.state.tickCount,
            random: this.random,
            timers: this.timerQueue,
            monsters: this.monsterSystem,
            damage: this.monsterDamage,
            perception: this.monsterPerception,
            monsterDesc: () => timerTables?.monsterDesc ?? null,
            isGameWon: () => this.gameWon,
            getCurrentPalette: () => this.currentPalette,
            checkMonsterVersusMissiles: (mapX, mapY, position, level) =>
                this.timerSystem.checkMonsterVersusMissiles(mapX, mapY, position, level),
            monsterAttacks: (monsterRn, monster, mapX, mapY, member) =>
                this.monsterAttack.monsterAttacks(monsterRn, monster, mapX, mapY, member, {
                    level: this.party.state.position.z,
                    primaryDirectionToParty: this.monsterAI.primaryDirectionToParty,
                    orthogonalDistanceToParty: this.monsterAI.orthogonalDistanceToParty,
                }),
            trace: monsterHooks?.trace,
        });
        this.dsaSystem.setTeleportPartyHandler((locr) => this.handleDsaTeleportParty(locr));
        this.objDescObjectType = actuatorTables?.objDescObjectType ?? null;
        this.addCharacterTables =
            actuatorTables?.objDescCarryMask && actuatorTables.carryLocation
                ? {
                    objDescCarryMask: actuatorTables.objDescCarryMask,
                    carryLocation: actuatorTables.carryLocation,
                }
                : null;
        this.byte20090 = timerTables?.byte20090 ?? null;

        this.characterStats = new CharacterStats({
            dungeon: this.dungeonState,
            random: this.random,
            tables: {
                weaponDesc: actuatorTables?.weaponDesc,
                weaponWeights: actuatorTables?.weaponWeights,
                clothingWeights: actuatorTables?.clothingWeights,
                miscWeights: actuatorTables?.miscWeights,
            },
            nameIndex: (rn) => this.getBaseObjectNameIndex(rn),
        });
        this.monsterAttack.setCharacterStats(this.characterStats);

        this.attackSystem = new AttackSystem({
            dungeon: this.dungeonState,
            random: this.random,
            getPartyState: () => this.party.state,
            getTime: () => this.state.tickCount,
            tables: {
                monsterDesc: timerTables?.monsterDesc,
                experienceForAttacking: timerTables?.experienceForAttacking,
                skillNumber: timerTables?.skillNumber,
                byte20046: timerTables?.byte20046,
                byte20002: timerTables?.byte20002,
                byte19958: timerTables?.byte19958,
                byte19914: timerTables?.byte19914,
                attackNames: timerTables?.attackNames,
                word1074: timerTables?.word1074,
            },
            monsterDamage: this.monsterDamage,
            monsterAttack: this.monsterAttack,
            monsters: this.monsterSystem,
            dsa: this.dsaSystem,
            characterStats: this.characterStats,
            hooks: {
                queueSound: (ordinal, mapX, mapY, deltaTime) =>
                    this.sounds.queueSound(ordinal, mapX, mapY, deltaTime),
                adjustStamina: (chIdx, decrement) => {
                    const champ = this.party.state.champions[chIdx];
                    if (champ) this.adjustStamina(champ, decrement);
                },
                disableCharacterAction: (chIdx, timeDelay) => this.disableCharacterAction(chIdx, timeDelay),
                hitDoor: (position, force, explosion) => this.timerSystem.hitDoor(position, force, explosion),
                characterThrowsSpell: (chIdx, projectile, range, neededMana) =>
                    this.characterThrowsSpell(chIdx, projectile, range, neededMana),
                launchObject: (chIdx, object, range, damage, decayRate) =>
                    this.launchObject(chIdx, object, range, damage, decayRate),
                removeCharacterPossession: (chIdx, slot) => this.removeCharacterPossession(chIdx, slot),
                magicShield: (chIdx, spellShield, strength, mustHaveMana) => {
                    const champ = this.party.state.champions[chIdx];
                    if (!champ) return 0;
                    return this.applyMagicShield(champ, spellShield, strength, mustHaveMana);
                },
                applyLight: (deltaLight, decayRate, time) => {
                    this.adjustBrightness(deltaLight);
                    this.setBrightnessTimer(decayRate, time);
                },
                openWindow: (duration) => {
                    this.party.state.seeThruWalls = (this.party.state.seeThruWalls ?? 0) + 1;
                    this.queueUtilityTimer(TimerFunction.TT_73, duration, 0);
                },
                createFluxcage: (position) => this.timerSystem.createFluxcage(position, this.state.tickCount),
                throwByCharacter: (options) => this.throwFromWeaponHand(options),
                setBusyTimerRefill: (chIdx, value) => this.setBusyTimerRefill(chIdx, value),
                climbDownIntoPit: (target) => this.climbDownIntoPit(target),
                printMessage: (text) => this.emitSpellMessage(text),
                deleteDBEntry: (rn) => { this.dungeonState.deleteDBEntry(rn); },
                activateMonster: (mapX, mapY, level) => {
                    this.monsterAI.processTimers29to41({
                        mapX, mapY, level,
                        timerFunction: TimerFunction.TT_M1,
                        timeUntilAlternateUpdate: 0,
                    });
                },
                adjustSkills: (chIdx, skillNumber, experience, why) =>
                    this.applySpellSkillGain(chIdx, skillNumber, experience, why),
                nameIndex: (rn) => this.getBaseObjectNameIndex(rn),
                possession: (champ, slot) => this.getChampionPossession(champ, slot),
                trace: monsterHooks?.trace,
            },
        });

        // Initialize movement system
        this.movementSystem = new MovementSystem(this.party, this.dungeonState, {
            findFirstMonster: (position) => this.monsterSystem.findFirstMonsterAt(position),
            activateMonster: (position) => {
                this.monsterAI.processTimers29to41({
                    mapX: position.x,
                    mapY: position.y,
                    level: position.z,
                    timerFunction: TimerFunction.TT_M1,
                    timeUntilAlternateUpdate: 0,
                });
            },
        });

        console.log('Game initialized at position:', startPos, 'facing:', startFacing);
    }

    processViewingFilter(options: ViewingFilterOptions): ViewingFilterResult | null {
        return this.dsaSystem.processViewingFilter(options);
    }

    /** Pin `d.RandomNumber`. For tools and, eventually, save-game restore. */
    setRandomSeed(seed: number): void {
        this.random.setSeed(seed);
    }

    setSpellDefinitions(spells: SpellDefinition[]): void {
        this.spellDefinitions = spells.slice();
    }

    /**
     * Start the game loop
     */
    start(): void {
        if (this.running) {
            return;
        }

        this.running = true;
        this.state.running = true;
        this.state.startTime = Date.now();
        this.lastTickTime = Date.now();

        console.log('Game started');

        // Start game loop
        this.gameLoop();
    }

    /**
     * Stop the game loop
     */
    stop(): void {
        this.running = false;
        this.state.running = false;

        if (this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        console.log('Game stopped');
    }

    /**
     * Pause/unpause the game
     */
    setPaused(paused: boolean): void {
        this.state.paused = paused;
    }

    /**
     * Main game loop (VBL-style at 60Hz)
     */
    private gameLoop = (): void => {
        if (!this.running) {
            return;
        }

        const currentTime = Date.now();
        this.state.currentTime = currentTime;
        this.processMovementQueue(currentTime);

        // Calculate time since last tick
        const timeSinceLastTick = currentTime - this.lastTickTime;
        const tickInterval = 1000 / GAME_TIMING.TICKS_PER_SECOND;

        // Process game ticks
        if (timeSinceLastTick >= tickInterval) {
            if (!this.state.paused) {
                this.gameTick();
            }
            this.lastTickTime = currentTime;
        }

        // Schedule next frame (60 FPS)
        this.animationFrameId = requestAnimationFrame(this.gameLoop);
    };

    /**
     * Process one game tick (~4 times per second)
     */
    private gameTick(): void {
        this.state.tickCount++;

        // Reset movement flags from previous tick
        this.party.resetMovementFlags();

        // Call tick callbacks
        for (const callback of this.onTickCallbacks) {
            callback(this);
        }

        this.monsterSystem.loadPartyLevelIfChanged();
        this.timerSystem.processTimers(this.state.tickCount);
        this.processNinetySecondUpdate();
        this.processTenSecondUpdate();
        // `if (d.freezeLifeTimer != 0) d.freezeLifeTimer--;` — one per game tick
        // (doc/CSBwin-src/CSBCode.cpp:684).
        if (this.party.state.freezeLifeTimer !== 0) this.party.state.freezeLifeTimer--;

        // Update party state in game state
        this.state.party = this.party.state;
    }

    enqueueMovement(action: MovementAction): boolean {
        if (this.movementQueue.length >= this.movementQueueLen) {
            return false;
        }
        this.movementQueue.push(action);
        return true;
    }

    /**
     * Attempt to move the party
     */
    move(action: MovementAction): boolean {
        const result = this.movementSystem.move(action);

        if (result.success) {
            const oldPos = this.party.state.position;
            const oldFacing = this.party.state.facing;
            let resolvedPosition = result.newPosition;
            let resolvedFacing = result.newFacing ?? oldFacing;

            if (resolvedPosition) {
                this.timerSystem.checkMoveFromMissile(oldPos, resolvedPosition, null);
                const teleported = this.timerSystem.resolvePartyMove(resolvedPosition, resolvedFacing);
                resolvedPosition = teleported.position;
                resolvedFacing = teleported.facing;
                result.newPosition = resolvedPosition;
                if (resolvedFacing !== (result.newFacing ?? oldFacing)) {
                    result.newFacing = resolvedFacing;
                }
            }
            this.party.applyMovement(result);
            if (resolvedPosition) {
                const unchanged = oldPos.x === resolvedPosition.x
                    && oldPos.y === resolvedPosition.y
                    && oldPos.z === resolvedPosition.z;
                this.actuators.triggerObjectMove(oldPos, OBJECT_ID_NULL, false, unchanged, resolvedFacing);
                this.actuators.triggerObjectMove(resolvedPosition, OBJECT_ID_NULL, true, unchanged, resolvedFacing);
            }
            this.notePartyMoved();
            this.monsterSystem.loadPartyLevelIfChanged();
            this.timerSystem.processTimers(this.state.tickCount);

            // Update party state in game state
            this.state.party = this.party.state;

            // Notify callbacks
            for (const callback of this.onMoveCallbacks) {
                callback(true, result);
            }

            return true;
        } else {
            // Notify callbacks of failure
            for (const callback of this.onMoveCallbacks) {
                callback(false, result);
            }

            return false;
        }
    }

    private handleDsaTeleportParty(locr: { l: number; x: number; y: number; p: number }): void {
        const party = this.party.state;
        const oldPos = new Position(party.position.x, party.position.y, party.position.z);
        const oldFacing = party.facing & 0x3;
        const pretendTeleporter: TeleporterRecord = {
            nextObject: OBJECT_ID_EOF,
            sound: false,
            scope: 2,
            absoluteRotation: false,
            rotation: locr.p & 0x3,
            destX: locr.x & 0x1f,
            destY: locr.y & 0x1f,
            destMap: locr.l & 0xff,
        };

        this.timerSystem.checkMoveFromMissile(oldPos, oldPos, null);
        const resolved = this.timerSystem.resolvePartyMoveWithTeleporter(oldPos, oldFacing, pretendTeleporter);
        party.position = resolved.position;
        this.party.setFacing(resolved.facing);

        const unchanged = oldPos.x === resolved.position.x
            && oldPos.y === resolved.position.y
            && oldPos.z === resolved.position.z;
        if (!unchanged) this.notePartyMoved();
        this.actuators.triggerObjectMove(oldPos, OBJECT_ID_NULL, false, unchanged, party.facing);
        this.actuators.triggerObjectMove(resolved.position, OBJECT_ID_NULL, true, unchanged, party.facing);
        this.state.party = this.party.state;
    }

    triggerObjectMove(position: Position, object: ObjectID, place: boolean, unchangedRoom: boolean, facing: number): void {
        this.actuators.triggerObjectMove(position, object, place, unchangedRoom, facing);
        this.monsterSystem.loadPartyLevelIfChanged();
        this.timerSystem.processTimers(this.state.tickCount);
    }

    private processMovementQueue(currentTime: number): void {
        if (this.movementQueue.length === 0) return;
        const next = this.movementQueue[0];
        if (!this.party.canMove(next, currentTime)) return;
        this.movementQueue.shift();
        this.move(next);
    }

    /**
     * Add a champion to the party
     */
    addChampion(champion: Champion): boolean {
        this.assignChampionFingerprint(champion);
        if (!this.party.addChampion(champion)) return false;
        // `if (d.NumCharacter == 1) SetHandOwner(0)` — the first champion to join the
        // party gets the cursor (doc/CSBwin-src/Character.cpp:706-710). Every inventory
        // click is gated on someone owning it.
        if (this.party.state.champions.length === 1) {
            setHandOwner(this.party.state, 0);
        }
        return true;
    }

    /**
     * `AddCharacter` (`doc/CSBwin-src/Character.cpp:456`) — a click on a Hall of
     * Champions mirror.
     *
     * `charID` picks the portrait bitmap and nothing else: the name, title, stats and
     * skills come from the `dbTEXT` object lying in the **party's own** cell, and the
     * possessions from the mirror's cell. The champion is only *provisionally* added
     * here — `potentialChampionIndex` marks them, and
     * `resurrectReincarnateCancel` either confirms or undoes it.
     */
    addCharacter(charID: number, mirrorCell: Position, wall: number): boolean {
        const party = this.party.state;
        // `if (d.EmptyHanded == 0) return; if (d.NumCharacter == 4) return;` (`:477-479`)
        if (party.objectInHand !== null && party.objectInHand !== undefined) return false;
        if (party.champions.length >= 4) return false;
        // One mirror at a time: a second click while the menu is up would push a
        // champion that `_ResurrectReincarnateCancel` can no longer reach.
        if ((party.potentialChampionIndex ?? -1) >= 0) return false;

        const hero = this.findHeroForMirror(charID, mirrorCell, wall);
        if (!hero) return false;

        const index = party.champions.length; // LOCAL_2
        const possessions: Array<ObjectID | null> = new Array(30).fill(null);
        const champion = createChampionFromPreset(
            hero,
            findFreeCharPosition(party.champions, party.facing),
            possessions,
        );
        // `pcA3->facing = pcA3->facing3 = d.partyFacing` (`:520`, `:531`) — the corner
        // the champion stands in is chosen above, but they face the way the party does.
        champion.facing = party.facing;
        champion.portraitGraphic = charID;
        champion.fingerprint = computeChampionFingerprint(
            party.champions,
            party.position.z,
            party.position.x,
            party.position.y,
        );
        // `(STRandom() & 0xff) + 1500` twice (`:533-534`).
        champion.food = (this.random.next() & 0xff) + 1500;
        champion.water = (this.random.next() & 0xff) + 1500;
        // `if (pcA3->HP() == 0) return;` (`:703`) — a hero text that failed every
        // validation pass, including the `legalHero` fallback.
        if (champion.attributes.maxHealth === 0) return false;

        if (!this.party.addChampion(champion)) return false;
        // `d.PotentialCharacterOrdinal = LOCAL_2 + 1; d.NumCharacter++;` (`:704-705`).
        party.potentialChampionIndex = index;
        if (party.champions.length === 1) {
            setHandOwner(party, 0);
        }

        this.collectMirrorPossessions(champion, possessions);

        // `ShowHideInventory(LOCAL_2)` (`:792`) — the inventory opens on the new
        // champion, and `potentialChampionIndex` turns its eye panel into the
        // Resurrect/Reincarnate/Cancel menu.
        party.selectedCharacterIndex = index;
        this.state.party = party;
        return true;
    }

    /**
     * `_ResurrectReincarnateCancel` (`doc/CSBwin-src/CSBCode.cpp:6615`). `button` is
     * CSBWin's own id from `Buttons18372`: 160 Resurrect, 161 Reincarnate, 162 Cancel.
     */
    resurrectReincarnateCancel(button: number): boolean {
        const party = this.party.state;
        const index = party.potentialChampionIndex ?? -1;
        if (index < 0) return false;
        // `pcA3 = &d.CH16482[d.NumCharacter-1]` — the potential champion is always last.
        const champion = party.champions[party.champions.length - 1];
        if (!champion) return false;

        party.potentialChampionIndex = -1;

        if (button === 162) {
            // Cancel (`:6629-6658`): hide the inventory and take the champion back out.
            // Their possessions were never removed from the mirror, so they stay there.
            party.selectedCharacterIndex = -1;
            if (party.champions.length === 1) {
                setHandOwner(party, -1);
            }
            party.champions.pop();
            this.state.party = party;
            return true;
        }

        const mirror = this.getMirrorCell();
        // `RemoveObjectFromRoom` for each possession (`:6668-6677`). `AddCharacter` left
        // them linked in the mirror's cell *as well as* on the champion; this is where
        // the room finally lets go of them.
        for (const value of champion.possessions ?? []) {
            if (value === null || value === undefined) continue;
            this.dungeonState.removeObjectFromCell(mirror, value as ObjectID);
        }

        this.disableMirrorActuators(mirror);

        if (button === 161) {
            // `ReIncarnate(_2_, pcA3)` (`:6738`) is the *first* thing this branch does,
            // and in CSBWin it blocks until the player has typed a name. Here it opens
            // a modal screen and returns, so everything after it — the skill wipe, the
            // penalties, the tail below — is deferred to `finishReincarnate`, which the
            // screen calls when it is answered. The champion stays potential-free but
            // still last in the party throughout, which is all the deferred half needs.
            this.openReincarnateScreen?.(party.champions.length - 1);
            return true;
        }

        this.finishResurrectReincarnate(champion, button);
        return true;
    }

    /**
     * `_ResurrectReincarnateCancel` from `ReIncarnate`'s return to the end
     * (`doc/CSBwin-src/CSBCode.cpp:6739-6800`).
     */
    private finishResurrectReincarnate(champion: Champion, button: number): void {
        const party = this.party.state;
        if (button === 161) {
            this.reincarnate(champion);
        }

        // `:6786-6793`
        if (party.champions.length === 1) {
            setHandOwner(party, 0);
            selectMagicCaster(party, 0);
        }

        const messages = this.actuators.getMessages();
        if (messages) {
            const color = this.actuators.getChampionMessageColor(party.champions.length - 1);
            messages.printLinefeed();
            messages.quePrintLines(color, champion.name);
            messages.quePrintLines(color, button === 160 ? ' RESURRECTED' : ' REINCARNATED');
        }

        party.selectedCharacterIndex = -1;
        this.state.party = party;
    }

    /**
     * The name-entry screen has been answered (`doc/CSBwin-src/Code13ea4.cpp:155-160`).
     * The champion takes the typed name and title, and the rest of the Reincarnate
     * branch runs — including the message, which prints the **new** name.
     */
    reincarnateNamed(chIdx: number, name: string, title: string): void {
        const champion = this.party.state.champions[chIdx];
        if (!champion) return;
        champion.name = name;
        champion.title = title;
        this.finishResurrectReincarnate(champion, 161);
    }

    /**
     * Set by the host once the renderer exists: the Reincarnate branch has to raise a
     * screen the engine does not own. Left optional so `tools/` can drive
     * `resurrectReincarnateCancel` with no UI at all — there, Reincarnate stops at the
     * point CSBWin would be waiting for a name, which is exactly where it stops here.
     */
    openReincarnateScreen?: (chIdx: number) => void;

    /**
     * The Reincarnate half of `_ResurrectReincarnateCancel` (`:6739-6784`), everything
     * after `ReIncarnate` has returned a name.
     */
    private reincarnate(champion: Champion): void {
        // `ClearMemory(pcA3->skills92, 120)` — all 20 skills, temporary adjust included.
        for (const skill of champion.skills) {
            skill.experience = 0;
            skill.tempAdjust = 0;
        }
        // `attributes.experience` and the four role levels are this port's own derived
        // mirrors of `skills92[0..3]`, set by `createChampionFromPreset` and currently
        // read by nothing. Zeroed with the skills so they cannot go stale behind the
        // first consumer that picks them up.
        champion.attributes.experience = 0;
        champion.attributes.fighter = 0;
        champion.attributes.ninja = 0;
        champion.attributes.priest = 0;
        champion.attributes.wizard = 0;

        const hero = this.reincarnationSource;
        const attributePenalty = hero?.reincarnateAttributePenalty ?? 2;
        const statPenalty = hero?.reincarnateStatPenalty ?? 8;

        // `DM_rules` is false by default (`doc/CSBwin-src/data.cpp:251`), so both
        // penalties apply. Attributes 1..6 only — Luck (0) is left alone.
        for (let index = 1; index <= 6; index++) {
            const attribute = champion.attributes.stats[index];
            if (!attribute) continue;
            let value = attributeCurrent(attribute);
            value -= Math.trunc((value * attributePenalty) / 16);
            value = Math.max(value, attributeMinimum(attribute));
            setAttributeCurrent(attribute, value);
            setAttributeMaximum(attribute, value);
        }

        const scale = (value: number): number => Math.trunc((value * (16 - statPenalty)) / 16);
        const stats = champion.attributes;
        stats.health = scale(stats.health);
        stats.maxHealth = scale(stats.maxHealth);
        stats.stamina = scale(stats.stamina);
        stats.maxStamina = scale(stats.maxStamina);
        stats.mana = scale(stats.mana);
        stats.maxMana = scale(stats.maxMana);

        // Twelve random attribute points, Current and Maximum together (`:6777-6783`).
        // CSBWin parses a `randomPoints` field out of the hero text and then ignores it
        // here; twelve is hardcoded.
        for (let i = 0; i < 12; i++) {
            const attribute = champion.attributes.stats[(this.random.next() & 0xffff) % 7];
            if (!attribute) continue;
            setAttributeCurrent(attribute, attributeCurrent(attribute) + 1);
            setAttributeMaximum(attribute, attributeMaximum(attribute) + 1);
        }
    }

    /** The cell the party is facing — CSBWin's `mapX/mapY` in both halves of the flow. */
    private getMirrorCell(): Position {
        const party = this.party.state;
        const facing = party.facing & 3;
        return new Position(
            party.position.x + DELTA_X[facing],
            party.position.y + DELTA_Y[facing],
            party.position.z,
        );
    }

    /**
     * `doc/CSBwin-src/Character.cpp:715-790` — every object at the mirror's wall becomes
     * a possession. CSBWin does *not* unlink them from the room here: they stay in the
     * cell until Resurrect or Reincarnate is pressed, which is what makes Cancel a
     * clean undo.
     */
    private collectMirrorPossessions(champion: Champion, possessions: Array<ObjectID | null>): void {
        if (!this.addCharacterTables) return;
        const party = this.party.state;
        const mirror = this.getMirrorCell();
        const wall = (party.facing + 2) & 3;

        const items: AddCharacterItem[] = [];
        for (
            let rn = this.dungeonState.findFirstObject(mirror);
            rn !== OBJECT_ID_EOF && rn !== OBJECT_ID_NULL;
            rn = this.dungeonState.getDBRecordLink(rn)
        ) {
            const decoded = decodeObjectID(rn);
            if (decoded.category <= DBType.ACTUATOR) continue;
            if (decoded.position !== wall) continue;
            items.push({
                rn,
                category: decoded.category,
                record: this.getObjectRecord(rn),
            });
        }

        assignAddCharacterPossessions(items, this.addCharacterTables, possessions);
        champion.weaponHand = possessions[1] ?? null;
        champion.shieldHand = possessions[0] ?? null;
        champion.quiver = possessions[8] ?? null;
    }

    /**
     * `doc/CSBwin-src/CSBCode.cpp:6679-6734` — disable the first *active* portrait
     * actuator on the mirror's wall, then, unless it blocks disables, every actuator
     * on that wall.
     *
     * ⏳ `PortraitTranslateDisable`'s `QueueDSASwitchAction` (`:6540-6612`) is not
     * ported: it fires only when the actuator carries a `DisableMessage`, which is a
     * CSB extension the shipped DM dungeon never uses.
     */
    private disableMirrorActuators(mirror: Position): void {
        const wall = (this.party.state.facing + 2) & 3;
        const actuators: ActuatorRecord[] = [];
        for (
            let rn = this.dungeonState.findFirstObject(mirror);
            rn !== OBJECT_ID_EOF && rn !== OBJECT_ID_NULL;
            rn = this.dungeonState.getDBRecordLink(rn)
        ) {
            const decoded = decodeObjectID(rn);
            if (decoded.category !== DBType.ACTUATOR) continue;
            if (decoded.position !== wall) continue;
            const record = this.dungeonState.getActuatorRecord(rn);
            if (record) actuators.push(record);
        }

        let block = false;
        for (const record of actuators) {
            if (getActuatorType(record) !== 127) continue;
            if ((getActuatorState(record) & PORTRAIT_INACTIVE) !== 0) continue;
            setActuatorType(record, 0);
            if (blocksDisables(record)) block = true;
            break;
        }

        for (const record of actuators) {
            if (block) break;
            if (getActuatorType(record) === 127) {
                block = blocksDisables(record);
            }
            setActuatorType(record, 0);
        }
    }

    /**
     * The hero whose text `AddCharacter` would read. CSBWin takes the first `dbTEXT` in
     * the **party's own** cell; `HeroExtractor` has already decoded every one of them at
     * load time, keyed by the mirror that faces it, so the mirror's cell and wall
     * identify the same text.
     */
    private findHeroForMirror(charID: number, mirrorCell: Position, wall: number): PresetHero | null {
        const heroes = this.state.dungeon.presetHeroes ?? [];
        const exact = heroes.find((hero) =>
            hero.location.map === mirrorCell.z
            && hero.location.x === mirrorCell.x
            && hero.location.y === mirrorCell.y
            && hero.location.wall === wall
        );
        if (exact) {
            this.reincarnationSource = exact;
            return exact;
        }
        const byPortrait = heroes.find((hero) => hero.portraitIndex === charID) ?? null;
        this.reincarnationSource = byPortrait;
        return byPortrait;
    }

    /** The database record behind an object id, for the categories `AddCharacter` sorts on. */
    private getObjectRecord(rn: ObjectID): DatabaseRecord | null {
        switch (decodeObjectID(rn).category) {
            case DBType.WEAPON: return this.dungeonState.getWeaponRecord(rn);
            case DBType.CLOTHING: return this.dungeonState.getClothingRecord(rn);
            case DBType.SCROLL: return this.dungeonState.getScrollRecord(rn);
            case DBType.POTION: return this.dungeonState.getPotionRecord(rn);
            case DBType.CHEST: return this.dungeonState.getContainerRecord(rn);
            case DBType.MISC: return this.dungeonState.getMiscRecord(rn);
            default: return null;
        }
    }

    registerChampionBones(bones: ObjectID, champIndex: number): void {
        const champ = this.party.state.champions[champIndex];
        if (!champ) return;
        this.assignChampionFingerprint(champ);
        const fingerprint = champ.fingerprint ?? 0;
        if (!fingerprint) return;
        this.dungeonState.addChampionBonesRecord(bones, fingerprint);
    }

    private assignChampionFingerprint(champion: Champion): void {
        if (champion.fingerprint !== undefined && champion.fingerprint !== null) return;
        const pos = this.party.state.position;
        champion.fingerprint = computeChampionFingerprint(
            this.party.state.champions,
            pos.z,
            pos.x,
            pos.y,
        );
    }

    private applyMissileDamageToParty(options: {
        damage: number;
        position: PartyState['position'];
    }): boolean {
        const damage = options.damage | 0;
        if (damage <= 0) return false;
        const candidates = this.party.state.champions.filter((c) => c.alive);
        if (candidates.length === 0) return false;
        this.noteMonsterAttack();

        const frontRow = candidates.filter((c) => c.partyPosition === 0 || c.partyPosition === 1);
        const target = (frontRow[0] ?? candidates[0]) ?? null;
        if (!target) return false;

        const current = target.attributes.health | 0;
        const next = Math.max(0, current - damage);
        target.attributes.health = next;
        if (next === 0) target.alive = false;
        // Sound ordinal `chIdx + 9` (doc/CSBwin-src/Monster.cpp:4584), which is
        // soundTable[9..12] = SND items 541-544. The wound sound identifies *which*
        // champion was hurt; it was being picked at random here.
        this.playSound?.(CHAMP_WOUND_SOUNDS[target.partyPosition & 0x3] ?? SoundIndex.CHAMP_WOUND_1);
        return true;
    }

    /**
     * A missile hit a monster. Now routed through the real `DamageMonster`
     * (`doc/CSBwin-src/Code11f52.cpp:1054`) instead of the stand-in that used to live
     * here — so a hit now produces the death cloud, the droppings, the dropped
     * possessions, the survivors' fear reaction and the per-member timer
     * renumbering, none of which the stand-in did.
     *
     * The damaged member is the first with hit points left, which is what the
     * compaction in `DamageMonster` maintains: survivors are always packed down to
     * the low indices.
     */
    private applyMissileDamageToMonster(options: {
        damage: number;
        monster: number;
        position: PartyState['position'];
    }): boolean {
        const damage = options.damage | 0;
        if (damage <= 0) return false;
        const record = this.dungeonState.getCreatureRecord(options.monster);
        if (!record) return false;

        const hp = record.hp ?? [];
        let targetIndex = -1;
        for (let i = 0; i <= (record.numMonM1 & 0x3); i++) {
            if ((hp[i] ?? 0) > 0) {
                targetIndex = i;
                break;
            }
        }
        if (targetIndex === -1) return false;

        const position = options.position;
        const result = this.monsterDamage.damageMonster(
            record,
            targetIndex,
            position.z,
            position.x,
            position.y,
            damage,
            true,
            this.dungeonState.getAttachedItem16(record) === null,
        );
        this.timerSystem.reportMonsterDamageResult(result);
        return result !== MonsterDamageResult.NO_MONSTER_DIED || damage > 0;
    }

    /**
     * Append the party's new square to the footprint trail.
     *
     * CSBWin does this inside `MoveObject` whenever the party is the thing being
     * moved and the party is non-empty (doc/CSBwin-src/Code11f52.cpp:3222-3247), so
     * it fires for every kind of relocation — walking, teleporters, pits, DSAs.
     */
    notePartyMoved(): void {
        if (this.party.state.champions.length === 0) return;
        const position = this.party.state.position;
        this.footprints.recordPartyMove(
            this.state.tickCount,
            position.z,
            position.x,
            position.y,
            (this.party.state.magicFootprintsActive ?? 0) !== 0,
        );
    }

    /**
     * `DropAllPossessions` (`doc/CSBwin-src/Character.cpp:2497`) — everything a dying
     * champion carried falls into the party's cell.
     */
    private dropAllPossessions(chIdx: number): void {
        const champ = this.party.state.champions[chIdx];
        if (!champ) return;
        const slots = champ.possessions;
        if (!slots) return;
        const here = this.party.state.position;
        for (let i = 0; i < slots.length; i++) {
            const value = slots[i];
            if (value === null || value === undefined) continue;
            slots[i] = null;
            const rn = value as ObjectID;
            if (!this.isLikelyObjectRecord(rn)) continue;
            this.dungeonState.addObjectToCell(here, this.setObjectPosition(rn, champ.partyPosition & 0x3));
        }
        champ.weaponHand = null;
        champ.shieldHand = null;
    }

    /**
     * The apply half of `_FeedCharacter` (`doc/CSBwin-src/Character.cpp:4348`), with
     * the engine pieces the UI cannot reach bound in. Returns CSBWin's
     * `fp.performFeeding`, which is what tells the caller the object was consumed.
     */
    applyFeeding(chIdx: number, fp: FeedParameters): boolean {
        const applied = applyFeedParameters(this.party.state, chIdx, fp, {
            curePoison: (idx) => this.monsterAttack.curePoison(idx),
            adjustStamina: (idx, decrement) => this.monsterAttack.adjustStamina(idx, decrement),
            killCharacter: (idx) => this.monsterAttack.killCharacter(idx),
            scheduleShieldExpiry: (idx, amount, duration) =>
                this.timerSystem.scheduleChampionShieldExpiry(
                    idx,
                    amount,
                    duration,
                    this.party.state.position.z,
                ),
            random: () => this.random.next() & 0xffff,
        });
        if (applied) this.state.party = this.party.state;
        return applied;
    }

    /**
     * A champion died. Keeps the derived party state honest.
     *
     * Closing the inventory on a dead champion is CSBWin's `ShowHideInventory(4)`
     * (`doc/CSBwin-src/Character.cpp:2619`). The magic tab is *not* cleared here:
     * `killCharacter` hands it to a living champion through `SelectMagicCaster`, and
     * blanking it afterwards would undo that.
     */
    private onChampionDied(chIdx: number): void {
        const champ = this.party.state.champions[chIdx];
        if (!champ) return;
        if (this.party.state.selectedCharacterIndex === chIdx) {
            this.party.state.selectedCharacterIndex = -1;
        }
        this.state.party = this.party.state;
    }

    private noteMonsterAttack(): void {
        this.party.state.lastMonsterAttackTime = this.state.tickCount | 0;
        this.state.party = this.party.state;
    }

    /**
     * Replace the current party state (debug/testing).
     */
    setPartyState(state: PartyState): void {
        this.party.setState(state);
        ensureHandOwner(this.party.state);
        this.state.party = this.party.state;
        for (const champ of this.party.state.champions) {
            this.assignChampionFingerprint(champ);
        }
    }

    setBrightness(value: number): void {
        this.party.state.brightness = normalizeWord6(value);
        this.state.party = this.party.state;
    }

    adjustBrightness(delta: number): void {
        const current = this.party.state.brightness ?? 0;
        this.party.state.brightness = normalizeWord6(current + delta);
        this.state.party = this.party.state;
    }

    setBrightnessTimer(deltaSteps: number, delayTicks: number): void {
        const time = (this.state.tickCount + delayTicks) >>> 0;
        this.timerSystem.queueBrightnessTimer(deltaSteps, time);
    }

    private processNinetySecondUpdate(): void {
        const decayTicks = GAME_TIMING.TICKS_PER_SECOND * 90;
        if (decayTicks <= 0) return;
        if ((this.state.tickCount % decayTicks) !== 0) return;

        let changed = false;
        for (const champion of this.party.state.champions) {
            if (!champion) continue;
            for (let hand = 0; hand < 2; hand++) {
                const obj = this.getChampionPossession(champion, hand);
                if (!obj) continue;
                if (!this.isLikelyObjectRecord(obj)) continue;
                if (!this.isTorchObject(obj)) continue;
                const weapon = this.dungeonState.getWeaponRecord(obj as ObjectID);
                if (!weapon) continue;
                const charges = weapon.charges & 0x0f;
                if (charges === 0) continue;
                const next = (charges - 1) & 0x0f;
                weapon.charges = next;
                if (next === 0) {
                    weapon.important = false;
                }
                changed = true;
            }
        }

        if (changed) {
            this.state.party = this.party.state;
        }
    }

    private processTenSecondUpdate(): void {
        const updateTicks = GAME_TIMING.TICKS_PER_SECOND * 10;
        if (updateTicks <= 0) return;
        if ((this.state.tickCount % updateTicks) !== 0) return;

        const party = this.party.state;
        const random112 = (this.state.tickCount & 0x40)
            | ((this.state.tickCount & 0x80) >> 2)
            | ((this.state.tickCount & 0x100) >> 4);
        const getObjectNameIndex = (objectId: number): number | null => {
            const value = this.getBaseObjectNameIndex(objectId as ObjectID);
            return value >= 0 ? value : null;
        };

        for (const champ of party.champions) {
            if (!champ || !champ.alive) continue;
            const attrs = champ.attributes;
            const maxMana = attrs.maxMana | 0;
            const mana = attrs.mana | 0;
            if (mana < maxMana) {
                const magicMastery =
                    determineMastery(champ, 3, { getObjectNameIndex })
                    + determineMastery(champ, 2, { getObjectNameIndex });
                const wisdom = championAttribute(champ, AttributeIndex.Wisdom);
                if (random112 >= magicMastery + wisdom) {
                    if (mana > maxMana) {
                        attrs.mana = Math.max(maxMana, mana - 1);
                    }
                } else {
                    let manaAdjust = Math.trunc(maxMana / 40);
                    manaAdjust += 1;
                    const staminaAdjust = manaAdjust * Math.max(7, 16 - magicMastery);
                    this.adjustStamina(champ, staminaAdjust);
                    const deltaMana = Math.min(manaAdjust, maxMana - mana);
                    attrs.mana = mana + deltaMana;
                }
            } else if (mana > maxMana) {
                attrs.mana = Math.max(maxMana, mana - 1);
            }

            const skills = ensureSkills(champ.skills ?? []);
            for (const entry of skills) {
                if (entry.tempAdjust > 0) entry.tempAdjust -= 1;
            }
            champ.skills = skills;
        }
    }

    private adjustStamina(champion: Champion, decrement: number): void {
        const attrs = champion.attributes;
        let newStamina = (attrs.stamina | 0) - (decrement | 0);
        if (newStamina <= 0) {
            const abs = -newStamina;
            attrs.stamina = 0;
            const health = attrs.health | 0;
            const reduced = Math.max(0, health - Math.floor(abs / 2));
            attrs.health = reduced;
            if (reduced === 0) champion.alive = false;
            return;
        }
        const maxStamina = attrs.maxStamina | 0;
        if (newStamina > maxStamina) newStamina = maxStamina;
        attrs.stamina = newStamina;
    }

    private getChampionPossession(champion: Champion, slot: number): ObjectID | null {
        if (champion.possessions && slot >= 0 && slot < champion.possessions.length) {
            const value = champion.possessions[slot];
            if (typeof value === 'number') return value as ObjectID;
        }
        if (slot === 0 && typeof champion.shieldHand === 'number') return champion.shieldHand as ObjectID;
        if (slot === 1 && typeof champion.weaponHand === 'number') return champion.weaponHand as ObjectID;
        return null;
    }

    private castMagic(casterIdx: number): number {
        const party = this.party.state;
        const champion = party.champions[casterIdx];
        if (!champion || champion.alive === false) return 0;
        if (champion.incantation.length === 0) return 0;
        const params = this.fillSpellParameters(casterIdx, champion.incantation, party);
        const filtered = this.dsaSystem.processSpellFilter(params);
        return this.castSpell(casterIdx, filtered ?? params);
    }

    private fillSpellParameters(casterIdx: number, incantation: number[], party: PartyState): SpellParameters {
        let value = 0;
        let multiplier = 1000;
        for (let i = 0; i < 4 && multiplier > 0; i += 1, multiplier = Math.floor(multiplier / 10)) {
            const rune = incantation[i] ?? 0;
            if (rune === 0) break;
            value += (rune - 0x60 - 6 * i + 1) * multiplier;
        }
        return {
            action: 0,
            incantation: value,
            chIdx: casterIdx,
            disableTime: -1,
            missileType: -1,
            locationAbs: this.encodeLocationAbs(party.position),
            facing: party.facing,
            skillRequired: -1,
            spellByte5: -1,
            spellClass: -1,
            unused1: -1,
            unused2: -1,
            unused3: -1,
            unused4: -1,
        };
    }

    private castSpell(chIdx: number, spellParameters: SpellParameters): number {
        let casterIdx = chIdx;
        if (spellParameters.chIdx !== -1) casterIdx = spellParameters.chIdx & 0xffff;
        const champion = this.party.state.champions[casterIdx];
        if (!champion || champion.alive === false) return 0;
        if ((champion.attributes.health | 0) <= 0) return 0;

        if (spellParameters.action !== 0) {
            if (spellParameters.disableTime !== -1) {
                this.disableCharacterAction(casterIdx, spellParameters.disableTime);
            }
            const message = this.getSpellAbortMessage(spellParameters.action, champion);
            if (message !== null) this.emitSpellMessage(message);
            return 0;
        }

        let facing = this.party.state.facing;
        if (spellParameters.facing !== -1) facing = spellParameters.facing;
        if (facing < 0 || facing > 3) return 0;

        let incantation = champion.incantation;
        if (spellParameters.incantation !== -1) {
            incantation = this.decodeIncantationOverride(spellParameters.incantation);
        }

        const spell = this.incantationToSpell(incantation);
        if (!spell) {
            if (spellParameters.disableTime !== -1) {
                this.disableCharacterAction(casterIdx, spellParameters.disableTime);
            }
            this.spellErrorMsg(champion, 1, 0);
            return 0;
        }

        const spellPower = (incantation[0] ?? 0) - 95;
        if (spellPower < 1 || spellPower > 6) return 0;

        let skillRequired = spell.skillRequired;
        if (spellParameters.skillRequired !== -1) skillRequired = spellParameters.skillRequired;

        let spellByte5 = spell.byte5;
        if (spellParameters.spellByte5 !== -1) spellByte5 = spellParameters.spellByte5;

        const required = skillRequired + spellPower;
        const w4 = this.computeSpellExperience(required, spellPower, skillRequired);
        const mastery = determineMastery(champion, spellByte5, {
            getObjectNameIndex: (objectId) => this.getObjectNameIndex(objectId),
        });

        if (mastery < required) {
            const wisdom = championAttribute(champion, AttributeIndex.Wisdom);
            const threshold = Math.min(wisdom + 15, 115);
            const diff = required - mastery;
            for (let i = 0; i < diff; i += 1) {
                if (this.randomInt(128) > threshold) {
                    const gained = w4 >> diff;
                    this.applySpellSkillGain(casterIdx, spellByte5, gained, AdjustSkillsWhy.CastSpell1);
                    this.spellErrorMsg(champion, 0, spellByte5);
                    return 0;
                }
            }
        }

        let spellClass = spell.word6 & 0xf;
        if (spellParameters.spellClass !== -1) spellClass = spellParameters.spellClass;

        const missileType = (spell.word6 >> 4) & 0x3f;
        switch (spellClass) {
            case 1: {
                const flask = this.getFlaskInHand(champion);
                if (!flask) {
                    this.spellErrorMsg(champion, 10, 0);
                    return 3;
                }
                const potion = this.dungeonState.getPotionRecord(flask);
                if (!potion) return 3;
                potion.potionType = (spell.word6 >> 4) & 0x3f;
                potion.power = (40 * spellPower + this.randomInt(16)) & 0xff;
                break;
            }
            case 2: {
                champion.facing = this.party.state.facing;
                let masteryForRange = mastery;
                if (missileType === 4) masteryForRange *= 2;
                const range = this.applyLimits(
                    21,
                    (2 * masteryForRange + 4) * (spellPower + 2),
                    255,
                );
                const { range: adjustedRange, decayRate } = this.adjustSpellMissileRange(
                    range,
                    champion.attributes.maxMana | 0,
                );
                const posInCell = this.computeSpellLaunchPos(champion.partyPosition, facing);
                this.timerSystem.launchThrownMissile(
                    this.spellObjectId(missileType),
                    this.party.state.position,
                    posInCell,
                    facing,
                    adjustedRange,
                    90,
                    decayRate,
                    this.state.tickCount,
                );
                break;
            }
            case 3: {
                let d6 = 4 * (spellPower + 1);
                switch (missileType) {
                    case 0: {
                        let delay = 10000 + (d6 - 8) * 512;
                        d6 = Math.trunc(d6 / 2) - 1;
                        if (d6 < 0) d6 = 0;
                        this.timerSystem.applyBrightnessSteps(d6, 1);
                        this.setBrightnessTimer(-d6, delay);
                        break;
                    }
                    case 5: {
                        let delay = 4000 + 128 * (d6 - 3);
                        d6 = Math.trunc(d6 / 4) + 1;
                        this.timerSystem.applyBrightnessSteps(d6, 1);
                        this.setBrightnessTimer(-d6, delay);
                        break;
                    }
                    case 1: {
                        d6 = Math.trunc(d6 / 4);
                        this.timerSystem.applyBrightnessSteps(d6, -1);
                        this.setBrightnessTimer(d6, 98);
                        break;
                    }
                    case 2: {
                        this.party.state.seeThruWalls = (this.party.state.seeThruWalls ?? 0) + 1;
                        d6 = Math.trunc(d6 / 2);
                        const duration = d6 * d6;
                        this.queueUtilityTimer(TimerFunction.TT_73, duration, 0);
                        break;
                    }
                    case 3: {
                        this.party.state.invisible = (this.party.state.invisible ?? 0) + 1;
                        this.queueUtilityTimer(TimerFunction.TT_71, d6, 0);
                        break;
                    }
                    case 4: {
                        let shieldAdd = d6;
                        if ((this.party.state.partyShield ?? 0) > 50) {
                            shieldAdd = Math.trunc(shieldAdd / 4);
                        }
                        this.party.state.partyShield = (this.party.state.partyShield ?? 0) + shieldAdd;
                        const duration = d6 * d6;
                        this.queueUtilityTimer(TimerFunction.TT_74, duration, shieldAdd);
                        break;
                    }
                    case 6: {
                        this.party.state.magicFootprintsActive = (this.party.state.magicFootprintsActive ?? 0) + 1;
                        const first = this.party.state.numFootprintEnt ?? 0;
                        this.party.state.indexOfFirstMagicFootprint = first;
                        this.party.state.indexOfLastMagicFootprint = spellPower < 3 ? first : 0;
                        const duration = d6 * d6;
                        this.queueUtilityTimer(TimerFunction.TT_79, duration, 0);
                        break;
                    }
                    case 7: {
                        const zokathra = this.createMiscObject(51);
                        if (zokathra) {
                            if (this.setChampionHand(champion, 0, zokathra) || this.setChampionHand(champion, 1, zokathra)) {
                                // placed in hand
                            } else {
                                const placed = this.dungeonState.addObjectToCell(
                                    this.party.state.position,
                                    this.setObjectPosition(zokathra, 0),
                                );
                                if (!placed) this.dungeonState.deleteDBEntry(zokathra);
                            }
                        }
                        break;
                    }
                    case 8: {
                        this.applyMagicShield(champion, false, d6 * d6 + 100, 0);
                        break;
                    }
                    default:
                        break;
                }
                break;
            }
            default:
                break;
        }

        this.applySpellSkillGain(casterIdx, spellByte5, w4, AdjustSkillsWhy.CastSpell2);
        let disableTime = (spell.word6 >> 10) & 0x3f;
        if (spellParameters.disableTime !== -1) disableTime = spellParameters.disableTime;
        this.disableCharacterAction(casterIdx, disableTime);
        // Spell effects are wired in subsequent magic parity steps.
        return 1;
    }

    private incantationToSpell(incantation: number[]): SpellDefinition | null {
        if ((incantation[1] ?? 0) === 0) return null;
        let packed = 0;
        let shift = 24;
        for (let i = 0; i < 4; i++) {
            const value = incantation[i] ?? 0;
            packed |= (value & 0xff) << shift;
            if ((incantation[i + 1] ?? 0) === 0) break;
            shift -= 8;
            if (shift < 0) break;
        }
        for (const spell of this.spellDefinitions) {
            if ((spell.spellId & 0xff000000) !== 0) {
                if ((packed >>> 0) === (spell.spellId >>> 0)) return spell;
            } else if (((packed >>> 0) & 0xffffff) === (spell.spellId >>> 0)) {
                return spell;
            }
        }
        return null;
    }

    private decodeIncantationOverride(value: number): number[] {
        const incantation = new Array<number>(4).fill(0);
        let n = Math.max(0, value | 0);
        for (let i = 3; i >= 0; i -= 1) {
            const digit = n % 10;
            n = Math.floor(n / 10);
            if (digit <= 0) {
                incantation[i] = 0;
            } else {
                incantation[i] = 0x60 + 6 * i + digit - 1;
            }
        }
        return incantation;
    }

    private encodeLocationAbs(position: Position): number {
        return ((position.z & 0x3f) << 10) | ((position.x & 0x1f) << 5) | (position.y & 0x1f);
    }

    private getFlaskInHand(champion: Champion): ObjectID | null {
        for (let slot = 0; slot < 2; slot += 1) {
            const obj = this.getChampionPossession(champion, slot);
            if (!obj) continue;
            if (!this.isLikelyObjectRecord(obj)) continue;
            if (this.getBaseObjectNameIndex(obj) === OBJNI_EMPTY_FLASK) return obj;
        }
        return null;
    }

    private getObjectNameIndex(objectId: number): number | null {
        const value = this.getBaseObjectNameIndex(objectId as ObjectID);
        return value >= 0 ? value : null;
    }

    private applySpellSkillGain(chIdx: number, skillNumber: number, experience: number, why: AdjustSkillsWhy): void {
        if (experience <= 0) return;
        const map = this.dungeonState.getMap(this.party.state.position.z);
        const experienceMultiplier = map?.descriptor.difficulty ?? 0;
        adjustSkills(this.party.state.champions, chIdx, skillNumber, experience, why, {
            time: this.state.tickCount,
            lastMonsterAttackTime: this.party.state.lastMonsterAttackTime,
            random: this.random,
            experienceMultiplier,
            applyAdjustSkillsFilter: (params) => this.dsaSystem.processAdjustSkillsFilter(params),
            onLevelUp: (levelIdx, basicSkill) => this.actuators.notifyLevelUp(levelIdx, basicSkill),
        });
    }

    private computeSpellExperience(required: number, spellPower: number, skillRequired: number): number {
        const rand = this.randomInt(8);
        const term = (spellPower - 1) * skillRequired;
        return rand + 16 * required + 8 * term + required * required;
    }

    private applyLimits(min: number, value: number, max: number): number {
        if (value < min) return min;
        if (value > max) return max;
        return value | 0;
    }

    private adjustSpellMissileRange(range: number, maxMana: number): { range: number; decayRate: number } {
        const manaFactor = Math.min(8, Math.trunc(maxMana / 8));
        let decayRate = 10 - manaFactor;
        let adjusted = range | 0;
        if (adjusted < 4 * decayRate) {
            adjusted += 3;
            decayRate -= 1;
        }
        return { range: adjusted, decayRate };
    }

    private computeSpellLaunchPos(championPos: number, facing: number): number {
        const offset = ((championPos - facing + 1) & 2) >> 1;
        return (offset + facing) & 0x3;
    }

    private spellObjectId(missileType: number): ObjectID {
        return ((0xff80 + (missileType & 0x7f)) & 0xffff) as ObjectID;
    }

    private queueUtilityTimer(functionType: number, duration: number, timerWord6: number): void {
        const party = this.party.state;
        this.timerQueue.createTimer(
            functionType,
            0,
            0,
            0,
            0,
            (this.state.tickCount + Math.max(0, duration | 0)) >>> 0,
            party.position.z,
            undefined,
            0,
            timerWord6,
        );
    }

    private applyMagicShield(champion: Champion, isSpellShield: boolean, strength: number, mustHaveMana: number): number {
        const party = this.party.state;
        let fullStrength = strength | 0;
        // CSBWin's `D6W`: 1 normally, 0 when the champion could not pay the full four
        // mana and got half a shield for whatever was left. `_Attack` reads it to decide
        // whether the cast counts.
        let raised = 1;
        if (mustHaveMana !== 0) {
            const mana = champion.attributes.mana | 0;
            if (mana === 0) return 0;
            if (mana < 4) {
                fullStrength = Math.trunc(fullStrength / 2);
                champion.attributes.mana = 0;
                raised = 0;
            } else {
                champion.attributes.mana = mana - 4;
            }
        }
        let add = Math.trunc(fullStrength / 32);
        if (isSpellShield) {
            if ((party.spellShield ?? 0) > 50) add = Math.trunc(add / 4);
            party.spellShield = (party.spellShield ?? 0) + add;
            this.queueUtilityTimer(TimerFunction.TT_77, fullStrength, add);
        } else {
            if ((party.fireShield ?? 0) > 50) add = Math.trunc(add / 4);
            party.fireShield = (party.fireShield ?? 0) + add;
            this.queueUtilityTimer(TimerFunction.TT_78, fullStrength, add);
        }
        return raised;
    }

    private setChampionHand(champion: Champion, slot: number, obj: ObjectID): boolean {
        const slots = champion.possessions ?? new Array(30).fill(null);
        if (slot < 0 || slot >= slots.length) return false;
        const current = slots[slot];
        if (typeof current === 'number' && current !== OBJECT_ID_NULL && current !== OBJECT_ID_EOF) return false;
        slots[slot] = obj;
        champion.possessions = slots;
        if (slot === 0) champion.shieldHand = obj;
        if (slot === 1) champion.weaponHand = obj;
        return true;
    }

    private setObjectPosition(rn: ObjectID, pos: number): ObjectID {
        const decoded = decodeObjectID(rn);
        return encodeObjectID((pos & 3) as number, decoded.category, decoded.index);
    }

    private createMiscObject(miscType: number): ObjectID | null {
        const data = this.dungeonState.getData();
        const maxIndex = 1023;
        if (data.databases.misc.records.length >= maxIndex + 1) return null;
        data.databases.misc.records.push({
            nextObject: OBJECT_ID_EOF,
            specialState: 0,
            important: false,
            miscType: miscType & 0x7f,
        });
        data.databases.misc.count = (data.databases.misc.count + 1) & 0xffff;
        data.header.objectCounts[DBType.MISC] = (data.header.objectCounts[DBType.MISC] + 1) & 0xffff;
        const newIndex = data.databases.misc.records.length - 1;
        return encodeObjectID(0, DBType.MISC, newIndex);
    }

    private disableCharacterAction(chIdx: number, timeDelay: number): void {
        if (timeDelay <= 0) return;
        const party = this.party.state;
        const champion = party.champions[chIdx];
        if (!champion) return;
        let targetTime = (this.state.tickCount + (timeDelay | 0)) >>> 0;
        const existingIndex = champion.busyTimerIndex ?? -1;
        if (existingIndex >= 0) {
            const existing = this.timerQueue.getTimer(existingIndex);
            if (existing) {
                const existingTime = existing.time >>> 0;
                if (targetTime >= existingTime) {
                    targetTime = (targetTime + ((existingTime - this.state.tickCount) >> 1)) >>> 0;
                } else {
                    targetTime = (existingTime + ((timeDelay | 0) >> 1)) >>> 0;
                }
            }
            this.timerQueue.deleteTimer(existingIndex);
        }
        const entry = this.timerQueue.createTimerWithUByte5(
            TimerFunction.TT_11,
            0,
            0,
            0,
            0,
            targetTime,
            party.position.z,
            chIdx,
        );
        champion.busyTimerIndex = entry.index;
        champion.actionDisabledUntil = entry.time;
    }


    // ------------------------------------------------------------ attacks

    /**
     * `_ExecuteAttack`'s engine half (`doc/CSBwin-src/Character.cpp:4944`): run the
     * attack, and record the type on the champion so `EnableCharacterAction` can undo
     * its defence penalty and refill a bow's quiver when the busy timer expires.
     */
    championAttack(chIdx: number, attackType: number): number {
        const champion = this.party.state.champions[chIdx];
        if (!champion) return 0;
        // `CHARDESC.word64` — the attack's own defence modifier, live until the
        // champion is free again. Mostly negative: swinging leaves you open.
        champion.attackStatModifier = this.attackStatModifier(attackType);
        const result = this.attackSystem.attack(chIdx, attackType);
        champion.attackType = attackType;
        return result;
    }

    /** `d.Byte20090[attackType]`, as a signed byte. */
    private attackStatModifier(attackType: number): number {
        const raw = this.byte20090?.[attackType] ?? 0;
        return (raw << 24) >> 24;
    }

    /** `d.attackDamageToDisplay` — read and cleared by the UI's damage flash. */
    consumeAttackDamageToDisplay(): number {
        const value = this.attackSystem.attackDamageToDisplay;
        this.attackSystem.attackDamageToDisplay = 0;
        return value;
    }

    /**
     * `CharacterThrowsSpell` (`doc/CSBwin-src/Magic.cpp:470`).
     *
     * The decay rate comes from the champion's *maximum* mana, not the current amount,
     * so a naturally powerful caster's bolts keep their damage longer regardless of how
     * drained they are. A spell whose range is short relative to its decay gets three
     * extra cells and one less decay — a small bonus for close-range casting.
     */
    private characterThrowsSpell(chIdx: number, projectile: number, range: number, neededMana: number): number {
        const champion = this.party.state.champions[chIdx];
        if (!champion) return 0;
        if ((champion.attributes.mana | 0) < neededMana) return 0;
        champion.attributes.mana = (champion.attributes.mana | 0) - neededMana;

        let decayRate = 10 - Math.min(8, Math.trunc((champion.attributes.maxMana | 0) / 8));
        let adjustedRange = range;
        if (adjustedRange < 4 * decayRate) {
            adjustedRange += 3;
            decayRate -= 1;
        }
        return this.launchObject(chIdx, projectile as ObjectID, adjustedRange, 90, decayRate);
    }

    /**
     * `LaunchObject` (`doc/CSBwin-src/Magic.cpp:449`) — throw from the champion's own
     * side of the cell, so a bolt cast by the front-right champion leaves on the right.
     */
    private launchObject(
        chIdx: number,
        object: ObjectID,
        range: number,
        damage: number,
        decayRate: number,
    ): number {
        const champion = this.party.state.champions[chIdx];
        if (!champion) return 0;
        const facing = (champion.facing ?? this.party.state.facing) & 3;
        const posInCell = ((((champion.partyPosition - facing + 1) & 2) >> 1) + facing) & 3;
        const projectile = (object & 0xffff) >= 0xff80
            ? constructPredefinedMissile(this.dungeonState.getData(), object & 0xffff)
            : object;
        if (projectile === null) return 0;
        const launched = this.timerSystem.launchThrownMissile(
            projectile,
            this.party.state.position,
            posInCell,
            facing,
            range,
            damage,
            decayRate,
            this.state.tickCount,
        );
        return launched ? 1 : 0;
    }

    /** `RemoveCharacterPossession` (`doc/CSBwin-src/Character.cpp:1093`). */
    private removeCharacterPossession(chIdx: number, slot: number): ObjectID | null {
        const champion = this.party.state.champions[chIdx];
        if (!champion) return null;
        const obj = this.getChampionPossession(champion, slot);
        if (obj === null) return null;
        this.setPossessionDirect(champion, slot, null);
        return obj;
    }

    /**
     * `ThrowByCharacter` with an explicit hand (`doc/CSBwin-src/Mouse.cpp:672`) — the
     * THROW attack, which throws what is in the fighting hand rather than what the
     * cursor is holding. `range`/`damage`/`decayRate` of -1 mean "compute them", which
     * is how the Party Attack Filter can override any of the three.
     */
    private throwFromWeaponHand(options: {
        chIdx: number;
        side: number;
        disableTime: number;
        range: number;
        damage: number;
        decayRate: number;
    }): number {
        const champion = this.party.state.champions[options.chIdx];
        if (!champion) return 0;
        const throwingDistance = this.characterStats.determineThrowingDistance(
            champion, 1, this.party.state.sleeping ?? false,
        );
        const obj = this.removeCharacterPossession(options.chIdx, 1);
        if (obj === null) return 0;
        return this.throwByCharacter(
            options.chIdx, champion, obj, options.side, throwingDistance, options,
        ) ? 1 : 0;
    }

    /** The busy timer's `uByte6`, which decides which slot refills the hand. */
    private setBusyTimerRefill(chIdx: number, value: number): void {
        const champion = this.party.state.champions[chIdx];
        const index = champion?.busyTimerIndex ?? -1;
        if (index < 0) return;
        const timer = this.timerQueue.getTimer(index);
        if (timer) timer.uByte6 = value & 0xff;
    }

    /**
     * `EnableCharacterAction` (`doc/CSBwin-src/Timer.cpp:2638`) — the champion is free
     * again. Two pieces of tidying beyond clearing the flag: the attack's defence
     * penalty goes, and a hand is refilled — the quiver after a shot, or the slot named
     * by the timer's `uByte6` after a throw.
     */
    private enableCharacterAction(chIdx: number, refillSlot: number): void {
        const champion = this.party.state.champions[chIdx];
        if (!champion) return;
        if ((champion.attackType ?? -1) !== -1) champion.attackStatModifier = 0;
        if ((champion.attributes.health | 0) !== 0) {
            // A bow that has just been fired reloads itself from the quiver, then from
            // the three pouch slots, taking the first object of the matching ammunition
            // class (`TAG0153c2`).
            if (champion.attackType === AttackType.atk_SHOOT && this.getChampionPossession(champion, 0) === null) {
                for (const slot of [12, 7, 8, 9]) {
                    if (this.matchingAmmunition(champion, slot)) {
                        const ammo = this.removeCharacterPossession(chIdx, slot);
                        if (ammo !== null) this.setChampionHand(champion, 0, ammo);
                        break;
                    }
                }
            }
        }
        if (refillSlot !== 0) this.refillPossessionSlot(chIdx, refillSlot - 1);
    }

    /**
     * `TAG0153c2` (`doc/CSBwin-src/CSBCode.cpp`) — is what is in `slot` the right
     * ammunition for the launcher in the fighting hand? Weapon classes 16-31 fire
     * class-10 objects (arrows), 32-47 fire class-11 (slingstones).
     */
    private matchingAmmunition(champion: Champion, slot: number): boolean {
        const launcher = this.getChampionPossession(champion, 1);
        if (launcher === null || decodeObjectID(launcher).category !== DBType.WEAPON) return false;
        const launcherDesc = this.characterStats.weaponDescFor(launcher);
        if (!launcherDesc) return false;
        let wanted: number;
        if (launcherDesc.uByte1 >= 16 && launcherDesc.uByte1 <= 31) wanted = 10;
        else if (launcherDesc.uByte1 >= 32 && launcherDesc.uByte1 <= 47) wanted = 11;
        else return false;

        const candidate = this.getChampionPossession(champion, slot);
        if (candidate === null || decodeObjectID(candidate).category !== DBType.WEAPON) return false;
        const desc = this.characterStats.weaponDescFor(candidate);
        return !!desc && desc.uByte1 === wanted;
    }

    /**
     * `TAG0115ee` (`doc/CSBwin-src/CSBCode.cpp:6251`) — put a weapon back into the hand
     * a throw emptied, from the quiver first and then the three pouch slots. Only a
     * weapon: a thrown apple does not come back.
     */
    private refillPossessionSlot(chIdx: number, slot: number): void {
        const champion = this.party.state.champions[chIdx];
        if (!champion) return;
        if (this.getChampionPossession(champion, slot) !== null) return;
        for (const source of [12, 7, 8, 9]) {
            const obj = this.getChampionPossession(champion, source);
            if (obj === null) continue;
            if (decodeObjectID(obj).category !== DBType.WEAPON) continue;
            const moved = this.removeCharacterPossession(chIdx, source);
            if (moved !== null) this.setChampionHand(champion, slot, moved);
            return;
        }
    }

    /**
     * `atk_CLIMBDOWN` (`doc/CSBwin-src/Attack.cpp:2033`) — into the pit deliberately,
     * which means falling all the way down whatever chain of pits is below.
     *
     * CSBWin sets `d.SupressPitDamage` around the move (`Attack.cpp:2031`), so the
     * *first* drop of a controlled descent costs stamina instead of blood. Only the
     * first: the flag is cleared by the fall itself, so a rope onto a stack of pits
     * still hurts for every pit after the one climbed into.
     */
    private climbDownIntoPit(target: Position): void {
        const party = this.party.state;
        const oldPos = new Position(party.position.x, party.position.y, party.position.z);
        const resolved = this.timerSystem.withSupressedPitDamage(() =>
            this.timerSystem.resolvePartyMove(target, party.facing & 0x3),
        );
        this.timerSystem.checkMoveFromMissile(oldPos, resolved.position, null);
        party.position = resolved.position;
        this.party.setFacing(resolved.facing);
        const unchanged = oldPos.x === resolved.position.x
            && oldPos.y === resolved.position.y
            && oldPos.z === resolved.position.z;
        if (!unchanged) this.notePartyMoved();
        this.actuators.triggerObjectMove(oldPos, OBJECT_ID_NULL, false, unchanged, party.facing);
        this.actuators.triggerObjectMove(resolved.position, OBJECT_ID_NULL, true, unchanged, party.facing);
        this.monsterSystem.loadPartyLevelIfChanged();
        this.state.party = this.party.state;
    }

    private getSpellAbortMessage(action: number, champion: Champion): string | null {
        let msg: string | null = null;
        switch (action | 0) {
            case 1:
                msg = '';
                break;
            case 2:
                msg = 'THAT IS A DIFFICULT SPELL.  STUDY IT.';
                break;
            case 3:
                msg = 'THE SPELL FIZZLES.';
                break;
            case 4:
                msg = 'THE SPELL FIZZLES AND DIES.';
                break;
            case 5:
                msg = 'THIS SPELL IS TOO DIFFICULT.';
                break;
            case 6:
                msg = '% NEEDS MORE PRACTICE WITH THIS SPELL.';
                break;
            case 7:
                msg = 'THIS SPELL REQUIRES A COMPONENT.';
                break;
            default:
                msg = null;
                break;
        }
        if (!msg || msg === '') return null;
        return this.substituteSpellName(msg, champion);
    }

    private substituteSpellName(text: string, champion: Champion): string {
        const idx = text.indexOf('%');
        if (idx < 0) return text;
        return `${text.slice(0, idx)}${champion.name}${text.slice(idx + 1)}`;
    }

    /**
     * CSBWin `StandardSpellMessage()` (`doc/CSBwin-src/Magic.cpp:1058`): a linefeed, then the
     * text in colour 4, with '%' replaced by the caster's name. One logical line — the
     * message area word-wraps it.
     */
    private emitSpellMessage(text: string): void {
        const messages = this.actuators.getMessages();
        if (!messages || !text) return;
        messages.printLinefeed();
        messages.quePrintLines(MSG_COLOR_SPELL, text);
    }

    /**
     * CSBWin `SpellErrorMsg()` (`doc/CSBwin-src/Magic.cpp:1004`).
     *
     * Emitted as a linefeed followed by separate fragments, all colour 4. The fragments carry
     * their own leading/trailing spaces and flow onto a single wrapped line — CSBWin never
     * puts a hard newline between the champion name and the message body.
     */
    private spellErrorMsg(champion: Champion, code: number, skillNumber: number): void {
        const messages = this.actuators.getMessages();
        if (!messages) return;

        let base = skillNumber | 0;
        if (base > 3) base = Math.floor((base - 4) / 4);

        messages.printLinefeed();
        messages.quePrintLines(MSG_COLOR_SPELL, champion.name);

        switch (code | 0) {
            case 0: {
                const labels = ['FIGHTER', 'NINJA', 'PRIEST', 'WIZARD'];
                const label = labels[base] ?? 'SKILL';
                messages.quePrintLines(MSG_COLOR_SPELL, ' NEEDS MORE PRACTICE WITH THIS ');
                messages.quePrintLines(MSG_COLOR_SPELL, label);
                messages.quePrintLines(MSG_COLOR_SPELL, ' SPELL.');
                break;
            }
            case 1:
                messages.quePrintLines(MSG_COLOR_SPELL, ' MUMBLES A MEANINGLESS SPELL.');
                break;
            case 10:
                messages.quePrintLines(MSG_COLOR_SPELL, ' NEEDS AN EMPTY FLASK IN HAND FOR POTION.');
                break;
            default:
                messages.quePrintLines(MSG_COLOR_SPELL, ' UNKNOWN SPELL ERROR');
                break;
        }
    }

    private randomInt(maxExclusive: number): number {
        return this.random.below(maxExclusive);
    }

    private isLikelyObjectRecord(value: ObjectID): boolean {
        const { category, index } = decodeObjectID(value);
        switch (category) {
            case DBType.WEAPON:
                return index >= 0 && index < this.dungeonState.getData().databases.weapons.records.length;
            case DBType.CLOTHING:
                return index >= 0 && index < this.dungeonState.getData().databases.clothing.records.length;
            case DBType.SCROLL:
                return index >= 0 && index < this.dungeonState.getData().databases.scrolls.records.length;
            case DBType.POTION:
                return index >= 0 && index < this.dungeonState.getData().databases.potions.records.length;
            case DBType.CHEST:
                return index >= 0 && index < this.dungeonState.getData().databases.containers.records.length;
            case DBType.MISC:
                return index >= 0 && index < this.dungeonState.getData().databases.misc.records.length;
            default:
                return false;
        }
    }


    private isTorchObject(rn: ObjectID): boolean {
        const base = this.getBaseObjectNameIndex(rn);
        return base >= OBJNI_TORCH_A && base <= OBJNI_TORCH_D;
    }

    private getBaseObjectNameIndex(rn: ObjectID): number {
        if (!this.objDescObjectType) return -1;
        const descIndex = this.getObjectDescIndex(rn);
        if (descIndex === null || descIndex < 0 || descIndex >= this.objDescObjectType.length) return -1;
        const value = this.objDescObjectType[descIndex];
        return typeof value === 'number' ? value | 0 : -1;
    }

    private getObjectDescIndex(rn: ObjectID): number | null {
        const { category } = decodeObjectID(rn);
        switch (category) {
            case DBType.SCROLL:
                return 0;
            case DBType.CHEST: {
                const rec = this.dungeonState.getContainerRecord(rn);
                return rec ? 1 + (rec.containerType & 0x7f) : null;
            }
            case DBType.POTION: {
                const rec = this.dungeonState.getPotionRecord(rn);
                return rec ? 2 + (rec.potionType & 0x7f) : null;
            }
            case DBType.WEAPON: {
                const rec = this.dungeonState.getWeaponRecord(rn);
                return rec ? 23 + (rec.weaponType & 0x7f) : null;
            }
            case DBType.CLOTHING: {
                const rec = this.dungeonState.getClothingRecord(rn);
                return rec ? 69 + (rec.clothingType & 0x7f) : null;
            }
            case DBType.MISC: {
                const rec = this.dungeonState.getMiscRecord(rn);
                return rec ? 127 + (rec.miscType & 0x7f) : null;
            }
            default:
                return null;
        }
    }

    /**
     * Register callback for game tick
     */
    onTick(callback: GameEventCallback): void {
        this.onTickCallbacks.push(callback);
    }

    /**
     * Register callback for movement
     */
    onMove(callback: MovementCallback): void {
        this.onMoveCallbacks.push(callback);
    }

    /**
     * Handle a viewport wall click (lever/switch).
     */
    handleWallClick(): boolean {
        const pos = this.party.state.position;
        const facing = this.party.state.facing;
        return this.actuators.triggerWallSwitch(pos, facing);
    }

    /**
     * Handle a door switch click (door button).
     */
    handleDoorSwitchClick(): boolean {
        const party = this.party.state;
        const hand = party.objectInHand;
        if (hand !== null && hand !== undefined && hand !== OBJECT_ID_NULL && hand !== OBJECT_ID_EOF) return false;

        const facing = party.facing & 0x3;
        const pos = party.position;
        const target = facing === 0 ? pos.north : facing === 1 ? pos.east : facing === 2 ? pos.south : pos.west;
        const map = this.dungeonState.getMap(target.z);
        if (!map) return false;
        const cellFlag = map.cellFlags[target.x]?.[target.y];
        if (cellFlag === undefined) return false;
        if (((cellFlag >> 5) & 0x7) !== RoomType.DOOR) return false;

        const nsDoor = (cellFlag & 0x8) >> 3;
        const facingIsNS = facing & 0x1;
        if (nsDoor === facingIsNS) return false;

        const doorRN = this.dungeonState.findFirstDoor(target);
        if (doorRN === OBJECT_ID_EOF) return false;
        const { index } = decodeObjectID(doorRN);
        const door = this.dungeonState.getDoorRecordByIndex(index);
        if (!door || !door.hasButton) return false;

        this.playSound?.(SoundIndex.SWITCH);
        this.timerQueue.createTimer(
            TimerFunction.TT_DOOR,
            target.x,
            target.y,
            0,
            ActuatorAction.TOGGLE,
            this.state.tickCount + 1,
            target.z,
        );
        return true;
    }

    /**
     * Drop the cursor object into the current/front cell, following CSBWin's DropObject positioning rules.
     */
    dropObjectFromCursor(relativePos: number, options?: DropCursorOptions): boolean {
        const party = this.party.state;
        const owner = party.cursorOwner ?? -1;
        if (owner < 0) return false;

        const obj = this.normalizeObjectInHand(party.objectInHand ?? null);
        if (!obj) return false;
        if (!this.isLikelyObjectRecord(obj)) return false;

        let dropPos = relativePos | 0;
        if (dropPos < 0 || dropPos > 4) return false;
        if (dropPos === 4) dropPos = 2;

        const facing = party.facing & 0x3;
        const target =
            dropPos > 1
                ? facing === 0 ? party.position.north
                    : facing === 1 ? party.position.east
                        : facing === 2 ? party.position.south
                            : party.position.west
                : party.position;

        const map = this.dungeonState.getMap(target.z);
        if (!map) return false;
        if (target.x < 0 || target.y < 0 || target.x >= map.descriptor.width || target.y >= map.descriptor.height) return false;

        const decoded = decodeObjectID(obj);
        const newPos = (facing + dropPos) & 0x3;
        const newObj = encodeObjectID(newPos, decoded.category, decoded.index);

        party.objectInHand = null;
        const added = this.dungeonState.addObjectToCell(target, newObj);
        if (!added) party.objectInHand = obj;
        if (added) {
            this.actuators.triggerObjectMove(target, newObj, true, false, facing);
            this.monsterSystem.loadPartyLevelIfChanged();
            this.timerSystem.processTimers(this.state.tickCount);
        }
        if (added && options?.viAltar) {
            this.maybeScheduleViAltar(newObj, target, newPos);
        }
        return added;
    }

    /**
     * Dropping bones into the Vi altar's alcove (`doc/CSBwin-src/Mouse.cpp:894-960`).
     *
     * The two arms are the same pair `ProcessTT_ViAltar` runs on, and the difference
     * between them is the whole point. Bones made by a **death** carry an expool
     * record holding the champion's fingerprint; there `value` is the kind of bones
     * and must be **2** ("a dead champion's", `doc/CSBwin-src/CSB.h:1264`), and the
     * champion is found by fingerprint. Bones placed by the **dungeon** carry no
     * record; there `value` is itself the champion index and there is no `== 2` test
     * at all — which is why this used to demand `value == 2` unconditionally and so
     * ignored every dungeon-authored bones object except one aimed at champion 2.
     *
     * Both arms refuse a champion who is not dead, so the altar cannot be used to
     * resurrect the living.
     */
    private maybeScheduleViAltar(obj: ObjectID, location: Position, posInCell: number): void {
        const misc = this.dungeonState.getMiscRecord(obj);
        if (!misc) return;
        // `objNI_2 == objNI_Bones_a`.
        if ((misc.miscType | 0) !== MISC_BONES_OF_HERO) return;

        const party = this.party.state;
        const fingerprint = this.dungeonState.copyChampionBonesRecord(obj);
        let chIdx: number;
        if (fingerprint !== null) {
            chIdx = findChampionByFingerprint(party, fingerprint);
            if (chIdx === -1) return;
            if ((misc.specialState | 0) !== 2) return;
        } else {
            chIdx = (misc.specialState | 0) & 0x3;
            // `if (chIdx < d.NumCharacter)`.
            if (chIdx >= party.champions.length) return;
        }
        const champion = party.champions[chIdx];
        if (!champion) return;
        if (champion.alive !== false && (champion.attributes?.health ?? 0) !== 0) return;

        this.timerSystem.scheduleViAltar(obj, location, posInCell, this.state.tickCount);
    }

    /**
     * `ThrowObjectInHand` / `TAG01772e` (`doc/CSBwin-src/Mouse.cpp:764`) — throw what
     * the cursor is holding, on behalf of the champion who owns the cursor.
     */
    throwObjectFromCursor(leftOrRight: number): boolean {
        const party = this.party.state;
        const owner = party.cursorOwner ?? -1;
        if (owner < 0) return false;

        const obj = this.normalizeObjectInHand(party.objectInHand ?? null);
        if (!obj) return false;
        if (!this.isLikelyObjectRecord(obj)) return false;

        const champion = party.champions[owner] ?? null;
        if (!champion) return false;

        // CSBWin's `hand < 0` path: the object goes into the fighting hand for exactly
        // as long as it takes to measure the throw, because `DetermineThrowingDistance`
        // reads a *possession*, not a loose object (`doc/CSBwin-src/Mouse.cpp:698-705`).
        const saved = this.getChampionPossession(champion, 1);
        this.setPossessionDirect(champion, 1, obj);
        const throwingDistance = this.characterStats.determineThrowingDistance(
            champion, 1, party.sleeping ?? false,
        );
        this.setPossessionDirect(champion, 1, saved);

        party.objectInHand = null;
        const launched = this.throwByCharacter(owner, champion, obj, leftOrRight, throwingDistance);
        if (!launched) party.objectInHand = obj;
        return launched;
    }

    /**
     * The tail of `ThrowByCharacter` / `TAG017570` (`doc/CSBwin-src/Mouse.cpp:722-756`),
     * from the sound to `LaunchMissile`.
     *
     * The order matters and is not the obvious one: the throw **raises skill 10 before**
     * the mastery that sets its range is read, so a throw that levels the skill flies
     * that little bit further. All three missile statistics come out of one mastery
     * value — range from it plus the throwing distance, damage as `8 * mastery` plus
     * noise, and the decay rate as `11 - mastery` — so a master thrower throws further,
     * harder, and with a projectile that keeps its damage longer.
     *
     * This replaces `estimateThrowRange/Damage/Decay`, three invented formulas built on
     * strength and dexterity that touched neither the object's weight nor the skill.
     */
    private throwByCharacter(
        chIdx: number,
        champion: Champion,
        obj: ObjectID,
        leftOrRight: number,
        throwingDistance: number,
        overrides?: { disableTime: number; range: number; damage: number; decayRate: number },
    ): boolean {
        const party = this.party.state;

        this.sounds.queueSound(16, party.position.x, party.position.y, 1);
        this.adjustStamina(champion, this.throwStaminaCost(obj));
        // A negative disable time means "use the default", which is 4 ticks.
        const disableTime = overrides && overrides.disableTime >= 0 ? overrides.disableTime : 4;
        this.disableCharacterAction(chIdx, disableTime);

        // The experience the throw earns, and `weaponBonus` — the weapon's own
        // contribution to the distance, which doubles as the damage scale below.
        let experience = 8;
        let weaponBonus = 1;
        if (decodeObjectID(obj).category === DBType.WEAPON) {
            experience += 4;
            const desc = this.characterStats.weaponDescFor(obj);
            // Above class 12 are the staves and wands, which gain nothing from a throw.
            if (desc && desc.uByte1 <= 12) {
                weaponBonus = desc.uByte3;
                experience += Math.trunc(weaponBonus / 4);
            }
        }
        this.awardThrowSkill(chIdx, experience);

        const base = throwingDistance + weaponBonus;
        const mastery = determineMastery(champion, 10, {
            partySleeping: party.sleeping ?? false,
            getObjectNameIndex: (objectId: number) => this.getBaseObjectNameIndex(objectId as ObjectID),
        });
        const range = base + this.random.below(16) + Math.trunc(base / 2) + mastery;
        const damage = this.applyLimits(40, 8 * mastery + (this.random.next() & 31), 200);
        const decayRate = Math.max(5, 11 - mastery);

        return this.timerSystem.throwObjectFromHand(
            obj,
            party.position,
            leftOrRight,
            party.facing,
            overrides && overrides.range >= 0 ? overrides.range : range,
            overrides && overrides.damage >= 0 ? overrides.damage : damage,
            overrides && overrides.decayRate >= 0 ? overrides.decayRate : decayRate,
            this.state.tickCount,
        );
    }

    /**
     * `TAG016382` (`doc/CSBwin-src/Mouse.cpp:653`) — the stamina a throw costs, which
     * grows faster than linearly with weight: half the weight, clamped to 1-10, and then
     * half of every remaining 10 units piled on top.
     */
    private throwStaminaCost(obj: ObjectID): number {
        let remaining = Math.trunc(this.characterStats.getObjectWeight(obj) / 2);
        let cost = this.applyLimits(1, remaining, 10);
        while ((remaining -= 10) > 0) {
            cost = cost + Math.trunc(remaining / 2);
        }
        return cost;
    }

    /** Write a possession slot without the UI's placement rules — used for CSBWin's
     * temporary hand swap, where the object is put back immediately. */
    private setPossessionDirect(champion: Champion, slot: number, value: ObjectID | null): void {
        if (champion.possessions && slot >= 0 && slot < champion.possessions.length) {
            champion.possessions[slot] = value;
            return;
        }
        if (slot === 1) champion.weaponHand = value;
        else if (slot === 0) champion.shieldHand = value;
    }


    castSpellFromUi(chIdx: number, incantation: number[], totalManaCost: number): number {
        if (chIdx < 0 || chIdx >= this.party.state.champions.length) return 0;
        if (!incantation || incantation.length === 0) return 0;
        void totalManaCost;
        const champion = this.party.state.champions[chIdx];
        if (!champion || champion.alive === false) return 0;
        champion.incantation = [...incantation];
        const result = this.castMagic(chIdx);
        if (result !== 3) champion.incantation = [];
        return result;
    }

    debugLaunchMissileDelayed(
        projectileObject: ObjectID,
        position: Position,
        posInCell: number,
        direction: number,
        range: number,
        damage: number,
        decayRate: number,
        delayTicks: number,
    ): boolean {
        return this.timerSystem.launchDelayedMissile(
            projectileObject,
            position,
            posInCell,
            direction,
            range,
            damage,
            decayRate,
            this.state.tickCount,
            delayTicks,
        );
    }

    private normalizeObjectInHand(value: ObjectID | null): ObjectID | null {
        if (value === null || value === undefined) return null;
        if (value === OBJECT_ID_EOF || value === OBJECT_ID_NULL) return null;
        return value;
    }

    /** `AdjustSkills(chIdx, 10, experience, ASW_ThrowByCharacter)`. */
    private awardThrowSkill(chIdx: number, experience: number): void {
        if (experience <= 0) return;
        const map = this.dungeonState.getMap(this.party.state.position.z);
        const experienceMultiplier = map?.descriptor.difficulty ?? 0;
        adjustSkills(this.party.state.champions, chIdx, 10, experience, AdjustSkillsWhy.ThrowByCharacter, {
            time: this.state.tickCount,
            lastMonsterAttackTime: this.party.state.lastMonsterAttackTime,
            random: this.random,
            experienceMultiplier,
            applyAdjustSkillsFilter: (params) => this.dsaSystem.processAdjustSkillsFilter(params),
            onLevelUp: (levelIdx, basicSkill) => this.actuators.notifyLevelUp(levelIdx, basicSkill),
        });
    }

    // Get position info for debugging
    getPositionInfo = () => this.movementSystem.getPositionInfo();

    // Get tick count
    getTickCount = () => this.state.tickCount;

    // Get elapsed time in seconds
    getElapsedTime = () => (this.state.currentTime - this.state.startTime) / 1000;

    // Snapshot runtime state for quick-save.
    getRuntimeSaveState(): RuntimeSaveState {
        const item16 = this.state.dungeon.item16
            ? this.state.dungeon.item16.map((r) => ({
                  ...r,
                  singleMonsterStatus: [...r.singleMonsterStatus],
              }))
            : undefined;
        const timers = this.buildTimerRecords();
        const missiles = this.state.dungeon.databases.missiles.records.map((rec) => ({
            nextObject: rec.nextObject,
            projectileObject: rec.projectileObject,
            rangeRemaining: rec.rangeRemaining,
            damageRemaining: rec.damageRemaining,
            timerIndex: rec.timerIndex,
        }));
        return {
            version: RUNTIME_SAVE_VERSION,
            savedAt: Date.now(),
            party: this.party.state,
            game: {
                tickCount: this.state.tickCount,
                paused: this.state.paused,
                elapsedTimeMs: this.state.currentTime - this.state.startTime,
                randomSeed: this.random.getSeed(),
                gameWon: this.gameWon,
                footprints: this.footprints.capture(),
                dsaGlobals: this.dsaSystem.getGlobalVariables(),
            },
            dungeon: {
                item16,
                timers,
                missiles,
                snapshot: this.dungeonState.captureSnapshot(),
            },
        };
    }

    // Restore runtime state from quick-save.
    applyRuntimeSaveState(save: RuntimeSaveState): void {
        this.party.setState(save.party);
        // `d.HandChar = b.gb2.handChar` (doc/CSBwin-src/SaveGame.cpp:1636): the cursor
        // owner is part of the saved state. `setState` carries it, and this repairs the
        // states written before it was ever set.
        ensureHandOwner(this.party.state);
        this.state.party = this.party.state;
        for (const champ of this.party.state.champions) {
            this.assignChampionFingerprint(champ);
        }

        this.state.paused = save.game.paused;
        this.state.tickCount = save.game.tickCount;
        const now = Date.now();
        this.state.currentTime = now;
        this.state.startTime = now - save.game.elapsedTimeMs;
        this.random.setSeed(save.game.randomSeed);
        this.gameWon = save.game.gameWon;
        this.dsaSystem.setGlobalVariables(save.game.dsaGlobals);

        // The world first: cell flags, object chains and every database record. This
        // has to land before the ITEM16/timer restore below, because the monster pool
        // is re-derived from the creature records it puts back.
        this.dungeonState.applySnapshot(save.dungeon.snapshot);

        const item16 = save.dungeon.item16 ?? [];
        const timers = save.dungeon.timers ?? [];
        const missiles = save.dungeon.missiles ?? [];
        const saveGameState: SaveGameState = {
            item16,
            timers,
            missiles,
            maxItem16: item16.length,
            maxTimers: timers.length,
            sequencedTimers: false,
            extendedTimers: false,
        };
        applySaveGameState(this.state.dungeon, saveGameState);
        // The restore replaced the ITEM16 pool wholesale; re-derive which groups are
        // active, as CSBWin does after its own restore
        // (doc/CSBwin-src/SaveGame.cpp:1240-1244).
        this.footprints.restore(save.game.footprints);
        this.monsterSystem.reloadAfterSaveGame();
    }

    private buildTimerRecords(): TimerRecord[] {
        const entries = this.timerQueue.getTimers();
        let maxIndex = -1;
        for (const entry of entries) {
            if (entry.index > maxIndex) maxIndex = entry.index;
        }
        if (maxIndex < 0) return [];
        const records: TimerRecord[] = Array.from({ length: maxIndex + 1 }, () => ({ timerWord8: 0 }));
        for (const entry of entries) {
            records[entry.index] = { timerWord8: entry.timerWord8 & 0xffff };
        }
        return records;
    }
}

function normalizeWord6(value: number): number {
    return (value << 16) >> 16;
}
