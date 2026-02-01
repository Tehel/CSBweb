/**
 * Main game class
 *
 * Ties together all game systems and implements game loop
 * Based on CSBWin's VBL-driven game loop
 */

import type { DungeonData, Item16Record, MissileRecord, TeleporterRecord, TimerRecord } from '../data/dungeonTypes';
import type { GameState, Champion, PartyState, MovementResult } from './gameTypes';
import { GAME_TIMING, MovementAction } from './gameTypes';
import { Party } from './Party';
import { DungeonState } from './DungeonState';
import { MovementSystem } from './MovementSystem';
import { applySaveGameState, type SaveGameState } from '../data/SaveGameLoader';
import { ActuatorSystem, type ActuatorTables } from './ActuatorSystem';
import { TimerQueue, TimerFunction } from './TimerQueue';
import { TimerSystem, type TimerTables, type TimerHooks } from './TimerSystem';
import { DsaSystem, type DsaTables, type ViewingFilterOptions, type ViewingFilterResult } from './DsaSystem';
import { adjustSkills, determineMastery, ensureSkills, AdjustSkillsWhy } from './skills';
import { DBType, decodeObjectID, encodeObjectID, OBJECT_ID_EOF, OBJECT_ID_NULL, Position, RoomType, type ObjectID } from '../core/types';
import { SoundIndex } from '../core/constants';
import { ActuatorAction } from '../data/actuatorHelpers';

/**
 * Game event callback types
 */
export type GameEventCallback = (game: Game) => void;
export type MovementCallback = (success: boolean, message?: string, result?: MovementResult) => void;

interface DropCursorOptions {
    viAltar?: boolean;
}

const MISC_BONES_OF_HERO = 5; // CSBwin Objects.h misc_BonesOfHero
const OBJNI_TORCH_A = 4;
const OBJNI_TORCH_D = 7;

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
    private timerQueue: TimerQueue;
    private actuators: ActuatorSystem;
    private timerSystem: TimerSystem;
    private playSound?: (soundId: number, rateIdx?: number, distance?: number) => void;
    private dsaSystem: DsaSystem;
    private nextChampionFingerprint = 1;
    private objDescObjectType: ArrayLike<number> | null = null;

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
        this.actuators.setTables({
            adjustSkillsFilter: (params) => this.dsaSystem.processAdjustSkillsFilter(params),
        });
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
                onMissileEncounterFilter: (options) => this.dsaSystem.processMissileEncounterFilter(options),
                playSound: (soundId, rateIdx, distance) => this.playSound?.(soundId, rateIdx, distance),
                ...timerHooks,
            },
        );
        this.dsaSystem.setTeleportPartyHandler((locr) => this.handleDsaTeleportParty(locr));
        this.objDescObjectType = actuatorTables?.objDescObjectType ?? null;

        // Initialize movement system
        this.movementSystem = new MovementSystem(this.party, this.dungeonState);

        console.log('Game initialized at position:', startPos, 'facing:', startFacing);
    }

    processViewingFilter(options: ViewingFilterOptions): ViewingFilterResult | null {
        return this.dsaSystem.processViewingFilter(options);
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

        this.timerSystem.processTimers(this.state.tickCount);
        this.processNinetySecondUpdate();
        this.processTenSecondUpdate();

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
            this.timerSystem.processTimers(this.state.tickCount);

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
        this.actuators.triggerObjectMove(oldPos, OBJECT_ID_NULL, false, unchanged, party.facing);
        this.actuators.triggerObjectMove(resolved.position, OBJECT_ID_NULL, true, unchanged, party.facing);
        this.state.party = this.party.state;
    }

    triggerObjectMove(position: Position, object: ObjectID, place: boolean, unchangedRoom: boolean, facing: number): void {
        this.actuators.triggerObjectMove(position, object, place, unchangedRoom, facing);
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
        return this.party.addChampion(champion);
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

    private noteMonsterAttack(): void {
        this.party.state.lastMonsterAttackTime = this.state.tickCount | 0;
        this.state.party = this.party.state;
    }

    /**
     * Replace the current party state (debug/testing).
     */
    setPartyState(state: PartyState): void {
        this.party.setState(state);
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
                if (obj === null) continue;
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

    private isLikelyObjectRecord(value: number): boolean {
        const { category, index } = decodeObjectID(value as ObjectID);
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
        const { category, index } = decodeObjectID(rn);
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
        if (obj === null) return false;
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
        if (obj === null) return false;
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

    recordSpellCast(chIdx: number, incantation: number[], totalManaCost: number): void {
        if (chIdx < 0 || chIdx >= this.party.state.champions.length) return;
        if (!incantation || incantation.length === 0) return;
        const experience = Math.max(0, totalManaCost | 0);
        if (experience === 0) return;
        const map = this.dungeonState.getMap(this.party.state.position.z);
        const experienceMultiplier = map?.descriptor.difficulty ?? 0;
        const skillNumber = 3; // TODO: use spell definitions to select priest/wizard subskill.
        adjustSkills(this.party.state.champions, chIdx, skillNumber, experience, AdjustSkillsWhy.CastSpell2, {
            time: this.state.tickCount,
            lastMonsterAttackTime: this.party.state.lastMonsterAttackTime,
            experienceMultiplier,
            applyAdjustSkillsFilter: (params) => this.dsaSystem.processAdjustSkillsFilter(params),
            onLevelUp: (levelIdx, basicSkill) => this.actuators.notifyLevelUp(levelIdx, basicSkill),
        });
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

    private isLikelyObjectRecord(value: ObjectID): boolean {
        const { category, index } = decodeObjectID(value);
        switch (category) {
            case DBType.WEAPON:
                return index < this.dungeonState.getData().databases.weapons.records.length;
            case DBType.CLOTHING:
                return index < this.dungeonState.getData().databases.clothing.records.length;
            case DBType.SCROLL:
                return index < this.dungeonState.getData().databases.scrolls.records.length;
            case DBType.POTION:
                return index < this.dungeonState.getData().databases.potions.records.length;
            case DBType.CHEST:
                return index < this.dungeonState.getData().databases.containers.records.length;
            case DBType.MISC:
                return index < this.dungeonState.getData().databases.misc.records.length;
            default:
                return false;
        }
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
            experienceMultiplier,
            applyAdjustSkillsFilter: (params) => this.dsaSystem.processAdjustSkillsFilter(params),
            onLevelUp: (levelIdx, basicSkill) => this.actuators.notifyLevelUp(levelIdx, basicSkill),
        });
    }

    private computeThrowSkillGain(obj: ObjectID): number {
        const { category } = decodeObjectID(obj);
        return category === DBType.WEAPON ? 12 : 8;
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

    /**
     * Restore runtime state from quick-save.
     */
    applyRuntimeSaveState(save: RuntimeSaveState): void {
        this.party.setState(save.party);
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
