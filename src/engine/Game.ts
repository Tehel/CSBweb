/**
 * Main game class
 *
 * Ties together all game systems and implements game loop
 * Based on CSBWin's VBL-driven game loop
 */

import type { DungeonData, Item16Record, TimerRecord } from '../data/dungeonTypes';
import type { GameState, Champion, PartyState, MovementResult } from './gameTypes';
import { GAME_TIMING, MovementAction } from './gameTypes';
import { Party } from './Party';
import { DungeonState } from './DungeonState';
import { MovementSystem } from './MovementSystem';
import { applySaveGameState, type SaveGameState } from '../data/SaveGameLoader';
import { ActuatorSystem, type ActuatorTables } from './ActuatorSystem';
import { TimerQueue, TimerFunction } from './TimerQueue';
import { TimerSystem, type TimerTables, type TimerHooks } from './TimerSystem';
import { DsaSystem, type DsaTables } from './DsaSystem';
import { decodeObjectID, OBJECT_ID_EOF, OBJECT_ID_NULL, RoomType, type ObjectID } from '../core/types';
import { SoundIndex } from '../core/constants';
import { ActuatorAction } from '../data/actuatorHelpers';

/**
 * Game event callback types
 */
export type GameEventCallback = (game: Game) => void;
export type MovementCallback = (success: boolean, message?: string, result?: MovementResult) => void;

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
    private timerQueue: TimerQueue;
    private actuators: ActuatorSystem;
    private timerSystem: TimerSystem;
    private playSound?: (soundId: number, rateIdx?: number) => void;
    private dsaSystem: DsaSystem;

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
        playSound?: (soundId: number, rateIdx?: number) => void,
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
        this.actuators = new ActuatorSystem(
            this.dungeonState,
            () => this.party.state,
            this.timerQueue,
            () => this.state.tickCount,
            actuatorTables,
        );
        this.dsaSystem = new DsaSystem(
            this.dungeonState,
            () => this.state.tickCount,
            this.timerQueue,
            () => this.party.state,
            dsaTables ?? actuatorTables,
            this.actuators,
        );
        this.timerSystem = new TimerSystem(
            this.dungeonState,
            () => this.party.state,
            this.timerQueue,
            this.actuators,
            timerTables,
            {
                onDsaTimer5: (rn, timer, loc) => this.dsaSystem.processTimer5(rn, timer, loc),
                onDsaTimer6: (rn, timer, loc) => this.dsaSystem.processTimer6(rn, timer, loc),
                onDsaTimer7: (rn, timer, loc) => this.dsaSystem.processTimer7(rn, timer, loc),
                onMissileHitParty: (options) => this.applyMissileDamageToParty(options),
                onMissileHitMonster: (options) => this.applyMissileDamageToMonster(options),
                ...timerHooks,
            },
        );
        this.playSound = playSound;

        // Initialize movement system
        this.movementSystem = new MovementSystem(this.party, this.dungeonState, this.actuators);

        console.log('Game initialized at position:', startPos, 'facing:', startFacing);
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

        this.timerSystem.processTimers(this.state.tickCount);

        // Update party state in game state
        this.state.party = this.party.state;
    }

    /**
     * Attempt to move the party
     */
    move(action: MovementAction): boolean {
        const result = this.movementSystem.move(action);

        if (result.success) {
            this.party.applyMovement(result);

            // Update party state in game state
            this.state.party = this.party.state;

            // Notify callbacks
            for (const callback of this.onMoveCallbacks) {
                callback(true, result.message, result);
            }

            return true;
        } else {
            // Notify callbacks of failure
            for (const callback of this.onMoveCallbacks) {
                callback(false, result.message, result);
            }

            return false;
        }
    }

    /**
     * Add a champion to the party
     */
    addChampion(champion: Champion): boolean {
        return this.party.addChampion(champion);
    }

    private applyMissileDamageToParty(options: {
        damage: number;
        position: PartyState['position'];
    }): boolean {
        const damage = options.damage | 0;
        if (damage <= 0) return false;
        const candidates = this.party.state.champions.filter((c) => c.alive);
        if (candidates.length === 0) return false;

        const frontRow = candidates.filter((c) => c.partyPosition === 0 || c.partyPosition === 1);
        const target = (frontRow[0] ?? candidates[0]) ?? null;
        if (!target) return false;

        const current = target.attributes.health | 0;
        const next = Math.max(0, current - damage);
        target.attributes.health = next;
        if (next === 0) target.alive = false;
        const woundSounds = [
            SoundIndex.CHAMP_WOUND_1,
            SoundIndex.CHAMP_WOUND_2,
            SoundIndex.CHAMP_WOUND_3,
            SoundIndex.CHAMP_WOUND_4,
        ];
        const sound = woundSounds[Math.floor(Math.random() * woundSounds.length)];
        this.playSound?.(sound);
        return true;
    }

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
        for (let i = 0; i < hp.length; i++) {
            if ((hp[i] ?? 0) > 0) {
                targetIndex = i;
                break;
            }
        }
        if (targetIndex === -1) return false;

        const current = hp[targetIndex] ?? 0;
        const next = Math.max(0, current - damage);
        hp[targetIndex] = next;

        let aliveCount = 0;
        for (const value of hp) {
            if ((value ?? 0) > 0) aliveCount++;
        }
        record.count = Math.max(0, aliveCount - 1);
        if (aliveCount === 0) {
            const monsterRn = options.monster as ObjectID;
            this.dungeonState.removeObjectFromCell(options.position, monsterRn);
            this.dungeonState.deleteDBEntry(monsterRn);
        }

        return true;
    }

    /**
     * Replace the current party state (debug/testing).
     */
    setPartyState(state: PartyState): void {
        this.party.setState(state);
        this.state.party = this.party.state;
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
     * Get position info for debugging
     */
    getPositionInfo(): string {
        return this.movementSystem.getPositionInfo();
    }

    /**
     * Get tick count
     */
    getTickCount(): number {
        return this.state.tickCount;
    }

    /**
     * Get elapsed time in seconds
     */
    getElapsedTime(): number {
        return (this.state.currentTime - this.state.startTime) / 1000;
    }

    /**
     * Snapshot runtime state for quick-save.
     */
    getRuntimeSaveState(): RuntimeSaveState {
        const item16 = this.state.dungeon.item16
            ? this.state.dungeon.item16.map((r) => ({
                  facings: r.facings,
                  positions: r.positions,
                  singleMonsterStatus: [...r.singleMonsterStatus],
              }))
            : undefined;
        const timers = this.state.dungeon.timers
            ? this.state.dungeon.timers.map((t) => ({ timerWord8: t.timerWord8 }))
            : undefined;

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
            },
        };
    }

    /**
     * Restore runtime state from quick-save.
     */
    applyRuntimeSaveState(save: RuntimeSaveState): void {
        this.party.setState(save.party);
        this.state.party = this.party.state;

        this.state.paused = save.game.paused;
        this.state.tickCount = save.game.tickCount;
        const now = Date.now();
        this.state.currentTime = now;
        this.state.startTime = now - save.game.elapsedTimeMs;

        const item16 = save.dungeon.item16 ?? [];
        const timers = save.dungeon.timers ?? [];
        const saveGameState: SaveGameState = {
            item16,
            timers,
            maxItem16: item16.length,
            maxTimers: timers.length,
            sequencedTimers: false,
            extendedTimers: false,
        };
        applySaveGameState(this.state.dungeon, saveGameState);
    }
}
