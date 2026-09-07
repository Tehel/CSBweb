/**
 * Main game class
 *
 * Ties together all game systems and implements game loop
 * Based on CSBWin's VBL-driven game loop
 */

import type { DungeonData, Item16Record, MissileRecord, TeleporterRecord, TimerRecord } from '../data/dungeonTypes';
import type { GameState, Champion, PartyState, MovementResult } from './gameTypes';
import { GAME_TIMING, MovementAction } from './gameTypes';
import { Party, ensureHandOwner, setHandOwner } from './Party';
import { DungeonState } from './DungeonState';
import { MovementSystem } from './MovementSystem';
import { applySaveGameState, type SaveGameState } from '../data/SaveGameLoader';
import { ActuatorSystem, type ActuatorTables } from './ActuatorSystem';
import { TimerQueue, TimerFunction } from './TimerQueue';
import { TimerSystem, type TimerTables, type TimerHooks } from './TimerSystem';
import { MonsterSystem, type MonsterSystemHooks } from './MonsterSystem';
import { SoundQueue } from './SoundQueue';
import { PartyFootprints } from './PartyFootprints';
import { MonsterPerception } from './MonsterPerception';
import { MonsterDamage, MonsterDamageResult } from './MonsterDamage';
import { MonsterAI } from './MonsterAI';
import { MonsterAttack } from './MonsterAttack';
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
import { ActuatorAction } from '../data/actuatorHelpers';
import { MSG_COLOR_SPELL } from './ActuatorSystem';
import type { SpellDefinition } from '../data/spellTypes';
import type { SpellParameters } from './magicTypes';
import {
    OBJNI_EMPTY_FLASK,
    OBJNI_TORCH_A,
    OBJNI_TORCH_D,
} from '../core/objectNameIndex';

/**
 * Game event callback types
 */
export type GameEventCallback = (game: Game) => void;
export type MovementCallback = (success: boolean, result?: MovementResult) => void;

interface DropCursorOptions {
    viAltar?: boolean;
}

export interface RuntimeSaveState {
    version: 1;
    savedAt: number;
    party: PartyState;
    game: {
        tickCount: number;
        paused: boolean;
        elapsedTimeMs: number;
    };
    dungeon: {
        item16?: Item16Record[];
        timers?: TimerRecord[];
        missiles?: MissileRecord[];
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
    private random = new CsbRandom();
    private actuators: ActuatorSystem;
    private timerSystem: TimerSystem;
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
    private nextChampionFingerprint = 1;
    private objDescObjectType: ArrayLike<number> | null = null;
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

        // Initialize movement system
        this.movementSystem = new MovementSystem(this.party, this.dungeonState);

        console.log('Game initialized at position:', startPos, 'facing:', startFacing);
    }

    processViewingFilter(options: ViewingFilterOptions): ViewingFilterResult | null {
        return this.dsaSystem.processViewingFilter(options);
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
        party.facing = resolved.facing & 0x3;

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

    registerChampionBones(bones: ObjectID, champIndex: number): void {
        const champ = this.party.state.champions[champIndex];
        if (!champ) return;
        this.assignChampionFingerprint(champ);
        const fingerprint = champ.fingerprint ?? 0;
        if (!fingerprint) return;
        this.dungeonState.addChampionBonesRecord(bones, fingerprint);
    }

    private assignChampionFingerprint(champion: Champion): void {
        if (champion.fingerprint !== undefined && champion.fingerprint !== null) {
            this.refreshNextChampionFingerprint();
            return;
        }
        champion.fingerprint = this.allocateChampionFingerprint();
    }

    private allocateChampionFingerprint(): number {
        const used = this.collectChampionFingerprints();
        let next = this.nextChampionFingerprint & 0xffff;
        if (next === 0) next = 1;
        while (used.has(next)) {
            next = (next + 1) & 0xffff;
            if (next === 0) next = 1;
        }
        this.nextChampionFingerprint = (next + 1) & 0xffff;
        if (this.nextChampionFingerprint === 0) this.nextChampionFingerprint = 1;
        return next;
    }

    private refreshNextChampionFingerprint(): void {
        const used = this.collectChampionFingerprints();
        let next = this.nextChampionFingerprint & 0xffff;
        if (next === 0) next = 1;
        while (used.has(next)) {
            next = (next + 1) & 0xffff;
            if (next === 0) next = 1;
        }
        this.nextChampionFingerprint = next;
    }

    private collectChampionFingerprints(): Set<number> {
        const used = new Set<number>();
        for (const champ of this.party.state.champions) {
            const fp = champ.fingerprint ?? 0;
            if (fp) used.add(fp & 0xffff);
        }
        return used;
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

    /** A champion died. Keeps the derived party state honest. */
    private onChampionDied(chIdx: number): void {
        const champ = this.party.state.champions[chIdx];
        if (!champ) return;
        if (this.party.state.selectedCharacterIndex === chIdx) {
            this.party.state.selectedCharacterIndex = -1;
        }
        if (this.party.state.magicCasterIndex === chIdx) {
            this.party.state.magicCasterIndex = -1;
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
                const wisdom = attrs.wisdom | 0;
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
            const wisdom = champion.attributes.wisdom | 0;
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

    private applyMagicShield(champion: Champion, isSpellShield: boolean, strength: number, mustHaveMana: number): void {
        const party = this.party.state;
        let fullStrength = strength | 0;
        if (mustHaveMana !== 0) {
            const mana = champion.attributes.mana | 0;
            if (mana === 0) return;
            if (mana < 4) {
                fullStrength = Math.trunc(fullStrength / 2);
                champion.attributes.mana = 0;
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

    private maybeScheduleViAltar(obj: ObjectID, location: Position, posInCell: number): void {
        const misc = this.dungeonState.getMiscRecord(obj);
        if (!misc) return;
        if ((misc.miscType | 0) !== MISC_BONES_OF_HERO) return;
        if ((misc.specialState | 0) !== 2) return;
        this.timerSystem.scheduleViAltar(obj, location, posInCell, this.state.tickCount);
    }

    /**
     * Throw the cursor object as a missile using CSBwin's LaunchMissile path.
     */
    throwObjectFromCursor(leftOrRight: number): boolean {
        const party = this.party.state;
        const owner = party.cursorOwner ?? -1;
        if (owner < 0) return false;

        const obj = this.normalizeObjectInHand(party.objectInHand ?? null);
        if (!obj) return false;
        if (!this.isLikelyObjectRecord(obj)) return false;

        const champion = party.champions[owner] ?? null;
        const range = this.estimateThrowRange(champion);
        const damage = this.estimateThrowDamage(champion);
        const decayRate = this.estimateThrowDecay(champion);

        party.objectInHand = null;
        const launched = this.timerSystem.throwObjectFromHand(
            obj,
            party.position,
            leftOrRight,
            party.facing,
            range,
            damage,
            decayRate,
            this.state.tickCount,
        );
        if (!launched) {
            party.objectInHand = obj;
        } else {
            this.awardThrowSkill(owner, obj);
        }
        return launched;
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

    private estimateThrowRange(champion: Champion | null): number {
        const strength = champion?.attributes?.strength ?? 0;
        const dexterity = champion?.attributes?.dexterity ?? 0;
        let range = 8 + ((strength + dexterity) >> 2);
        range = Math.max(1, Math.min(100, range));
        return range;
    }

    private estimateThrowDamage(champion: Champion | null): number {
        const strength = champion?.attributes?.strength ?? 0;
        let damage = 20 + strength;
        damage = Math.max(1, Math.min(200, damage));
        return damage;
    }

    private estimateThrowDecay(champion: Champion | null): number {
        const dexterity = champion?.attributes?.dexterity ?? 0;
        let decay = Math.max(1, 10 - Math.floor(dexterity / 20));
        decay = Math.max(1, Math.min(15, decay));
        return decay;
    }

    private awardThrowSkill(chIdx: number, obj: ObjectID): void {
        const experience = this.computeThrowSkillGain(obj);
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

    /**
     * CSBWin `doc/CSBwin-src/Mouse.cpp:724-736`: `D6W = 8`, `+= 4` for a weapon, and then
     * for a weapon whose `weaponDesc->uByte1 <= 12` a further `+ uByte3 / 4`.
     *
     * TODO: the last term is missing — `weaponDesc` (CSBWin `TAG0099d2`, our
     * `ObjectTables.weaponDesc`) is not plumbed into the engine yet, only
     * `objDescObjectType` is. Wire it through `ActuatorTables` and finish the port.
     */
    private computeThrowSkillGain(obj: ObjectID): number {
        const { category } = decodeObjectID(obj);
        return category === DBType.WEAPON ? 12 : 8;
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
            version: 1,
            savedAt: Date.now(),
            party: this.party.state,
            game: {
                tickCount: this.state.tickCount,
                paused: this.state.paused,
                elapsedTimeMs: this.state.currentTime - this.state.startTime,
            },
            dungeon: {
                item16,
                timers,
                missiles,
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
        this.footprints.reset();
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
