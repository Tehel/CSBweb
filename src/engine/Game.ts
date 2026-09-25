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
import { GAME_TIMING, MovementAction, emptyPossessions } from './gameTypes';
import { Party, ensureHandOwner, findChampionByFingerprint, selectMagicCaster, setHandOwner } from './Party';
import { applyFeedParameters, type FeedParameters } from './Feeding';
import { DungeonState } from './DungeonState';
import { MovementSystem } from './MovementSystem';
import { applySaveGameState, type SaveGameState } from '../data/SaveGameLoader';
import { ActuatorSystem } from './ActuatorSystem';
import { TimerQueue, TimerFunction, type TimerEntry } from './TimerQueue';
import { TimerSystem } from './TimerSystem';
import { MonsterSystem } from './MonsterSystem';
import type { SoundQueue } from './SoundQueue';
import { createGameContext, nameIndexOf, type GameContext, type GameSystems } from './GameContext';
import { createGameHost, type GameHost } from './GameHost';
import { PartyFootprints, type FootprintsSnapshot } from './PartyFootprints';
import type { DungeonSnapshot } from './DungeonSnapshot';
import { MonsterPerception } from './MonsterPerception';
import { MonsterDamage } from './MonsterDamage';
import { MonsterAI } from './MonsterAI';
import { MonsterAttack } from './MonsterAttack';
import { AttackSystem } from './AttackSystem';
import { MagicSystem } from './MagicSystem';
import { CharacterSystem } from './CharacterSystem';
import { AttackType } from './monsterTypes';
import { DsaSystem, type ViewingFilterOptions, type ViewingFilterResult } from './DsaSystem';
import { adjustSkills, determineMastery, ensureSkills, AdjustSkillsWhy } from './skills';
import { DBType, decodeObjectID, encodeObjectID, OBJECT_ID_EOF, OBJECT_ID_NULL, Position, RoomType, type LocationRel, type ObjectID } from '../core/types';
import { MISC_BONES_OF_HERO, SoundIndex } from '../core/constants';
import { CsbRandom } from '../core/random';
import { sw } from '../core/intCast';
import { GetBasicObjectType } from './objectIndex';

import {
    ActuatorAction,
    PORTRAIT_INACTIVE,
    blocksDisables,
    getActuatorState,
    getActuatorType,
    setActuatorType,
} from '../data/actuatorHelpers';
import { CharacterStats } from './CharacterStats';
import type { GameTables } from './GameTables';
import {
    OBJNI_EKKHARD_CROSS,
    OBJNI_TORCH_A,
    OBJNI_TORCH_D,
} from '../core/objectNameIndex';
import {
    AttributeIndex,
    attributeCurrent,
    attributeMaximum,
    attributeMinimum,
    championAttribute,
    incrAttributeCurrent,
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
 * The wound mask a missile carries, a literal at `DamageCharacter(objectPos, D5W, 12,
 * …)` (`doc/CSBwin-src/Code11f52.cpp:2046`). Bits 2 and 3 are the torso and the legs.
 *
 * (The champion *wound sound*, ordinal `chIdx + 9`, belongs to the monster's melee
 * attack — `doc/CSBwin-src/Monster.cpp:4584`, ported in `MonsterAttack`. A missile
 * strike queues no sound of its own.)
 */
const MISSILE_WOUND_MASK = 12;

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
 * Version 5 adds `dungeon.snapshot.columnIndex` and the two header fields beside it.
 * Their absence was not a missing feature but a live corruption: `columnIndex` is
 * rewritten by every drop into an empty cell and every pick-up of a cell's last object
 * (`DungeonState.addObjectToCell`), so a v4 payload restored `objectList` against
 * whatever offsets play had left behind, and every cell's object chain was read from
 * the wrong place. A v4 save cannot be repaired — the index it needed was never
 * written — so it is refused like any other older format.
 *
 * Version 6 stores the timer table as CSBWin's array has it — by timer index, holes
 * included — and adds `timerQueue` (which of those timers are live, in firing order)
 * and `timerSequence` (the stamp the next queued timer takes), so a restored queue
 * fires in the same order it would have. It came with loading genuine CSBWin save
 * files, whose timer blocks have that shape.
 *
 * Version 7 moves a timer's object reference into the byte pair `ConvertTimers` names
 * for its function (`doc/CSBwin-src/SaveGame.cpp:2027-2050`; see
 * `collapseTimerBytes`). A v6 payload kept the RN only on the live `TimerEntry.object`,
 * which has no byte in the file, so a restored missile came back without its object.
 *
 * Version 8 drops `Champion`'s `shieldHand` / `weaponHand` / `quiver`, which mirrored
 * possession slots 0, 1 and 8 (`DEBT.md` D1).
 *
 * Version 9 stores an empty possession slot as `RNnul` (0xffff), as CSBWin and the
 * save file do, where it had been `null` (`DEBT.md` D2a).
 *
 * Version 10 does the same for `PartyState.objectInHand`, now required (`DEBT.md` D2b).
 *
 * No bump has an upgrade path: `quickLoad` refuses an older save rather than
 * restoring a half-state.
 */
export const RUNTIME_SAVE_VERSION = 10;

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
        /** The timer table, by timer index — holes included, as CSBWin's array has them. */
        timers?: TimerRecord[];
        /** Which of those timers are live, in firing order (`GameTimers::TimerQueue`). */
        timerQueue?: number[];
        /** `gameTimers.TimerSequence()` — the stamp the next queued timer will take. */
        timerSequence?: number;
        missiles?: MissileRecord[];
        /** Everything play can change: cell flags, object chains, all DB records. */
        snapshot: DungeonSnapshot;
    };
}

/**
 * `MOUSEQLEN` — 8, because `Data.h:1513` leaves `#define NoKeyQue` commented out; the 3 on
 * `:1515` is the dead branch (doc/CSBwin-src/Data.h:1513-1518).
 */
const MOUSEQLEN = 8;

/** The button-up `OnMouseUnClick` queues (doc/CSBwin-src/CSBCode.cpp:7594). */
const MOUSE_UNCLICK = 0x0add;

/** One `pMouseQueue` entry: a button number and the point clicked (0,0 for a key). */
export interface MouseQueueEntry { num: number; x: number; y: number }

/** Where `HandleMouseEvents` sends the buttons it does not handle itself. */
export interface MouseEventHandlers {
    /** Any button but a turn, a step or the button-up, with the point clicked. */
    button(num: number, x: number, y: number): void;
    /** `0x0add`, the button-up. */
    unclick(): void;
}

/**
 * The movement buttons, as `MoveParty` numbers them (doc/CSBwin-src/CSBCode.cpp:7946-7951):
 * 1-2 turn left and right; 3-6 step forward, right, backward, left, so `num - 3` is the
 * step's direction relative to the party's facing. The on-screen arrows are these
 * buttons (`buttons17304`), and so are the movement keys.
 */
const MOVEMENT_BUTTON: Record<MovementAction, number> = {
    [MovementAction.TURN_LEFT]: 1,
    [MovementAction.TURN_RIGHT]: 2,
    [MovementAction.MOVE_FORWARD]: 3,
    [MovementAction.STRAFE_RIGHT]: 4,
    [MovementAction.MOVE_BACKWARD]: 5,
    [MovementAction.STRAFE_LEFT]: 6,
};
const BUTTON_MOVEMENT: Record<number, MovementAction> = Object.fromEntries(
    Object.entries(MOVEMENT_BUTTON).map(([action, num]) => [num, Number(action) as MovementAction]),
);

/**
 * Game class - main game controller
 */
export class Game {
    state: GameState;
    party: Party;
    dungeonState: DungeonState;
    private movementSystem: MovementSystem;
    /**
     * CSBWin's one mouse queue, `pMouseQueue` (doc/CSBwin-src/Mouse.cpp): clicks, their
     * button-ups and keys alike, as button numbers. A ring of `MOUSEQLEN` entries that
     * keeps one slot empty — `MouseQStart` is the next entry to handle, `MouseQEnd` the
     * last one queued, and `MouseQEnd + 1 == MouseQStart` means empty.
     */
    private readonly mouseQueue: MouseQueueEntry[] =
        Array.from({ length: MOUSEQLEN }, () => ({ num: 0, x: 0, y: 0 }));
    private mouseQStart = 0;
    private mouseQEnd = MOUSEQLEN - 1;
    /**
     * Where `HandleMouseEvents` sends every button that is not its own (the turns and the
     * steps): the UI's dispatcher, and the button-up. Headless, nobody is listening and
     * the entry is still consumed and still takes its tick.
     */
    private mouseEventHandlers: MouseEventHandlers | null = null;
    /**
     * `HandleMouseEvents`' `static i32 lastTime` (doc/CSBwin-src/Mouse.cpp:1351): the
     * `d.Time` of the last button it handled, click, turn or step. Zeroed by its
     * initialise call, which a game load makes (`SaveGame.cpp:1661`).
     */
    private lastInputTime = 0;
    /** `d.newPartyLevel != -1`: a level change whose `DiscardAllInput` is still owed. */
    private newPartyLevel = false;
    /** The timer queue. Public like the other subsystems; `tools/` drives it. */
    readonly timerQueue: TimerQueue;
    /**
     * The game's random stream, CSBWin's `d.RandomNumber`
     * (`doc/CSBwin-src/CSBCode.cpp:351`). Everything with a game-visible outcome draws
     * from this one instance, in CSBWin's order, so a seeded run is reproducible and an
     * AI trace is comparable with CSBWin's. Rendering must never draw from it — CSBWin
     * keeps a separate `viewportRandom` precisely so drawing "doesn't upset the game"
     * (doc/CSBwin-src/Viewport.cpp:6706).
     *
     * Seeded from the host on first draw; `setRandomSeed` exists so a verification tool
     * can pin the stream, which is what makes a run repeatable.
     */
    private readonly random: CsbRandom;
    /** What every subsystem shares (`GameContext`), created first. */
    readonly ctx: GameContext;
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
    readonly footprints: PartyFootprints;
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
    /** `Magic.cpp`'s engine half: casting, `LaunchObject`, `DisableCharacterAction`. */
    readonly magic: MagicSystem;
    /** `Character.cpp`'s possession writers: `RemoveCharacterPossession`, `DropAllPossessions`. */
    readonly character: CharacterSystem;
    /** `d.Word11694`, which lives in `state` (`GameState.gameWon`). */
    get gameWon(): boolean { return this.state.gameWon; }
    set gameWon(won: boolean) { this.state.gameWon = won; }

    /** `d.CurrentPalette`, which lives in `state` (`GameState.currentPalette`). */
    get currentPalette(): number { return this.state.currentPalette; }
    set currentPalette(index: number) { this.state.currentPalette = index; }

    /** `QueueSound` — sounds named by ordinal, attenuated by distance from the party. */
    readonly sounds: SoundQueue;
    private dsaSystem: DsaSystem;
    /** Every table from `graphics.dat` (`GameTables`), CSBWin's `d.` tables. */
    private readonly tables: GameTables;
    /** `d.ObjDesc[].word4` and `d.CarryLocation[]`, the two `AddCharacter` reads. */
    private readonly addCharacterTables: AddCharacterTables;
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

    // Game loop
    private running: boolean = false;
    private lastTickTime: number = 0;
    /**
     * `d.clockTick = 0` from an inhibited move (doc/CSBwin-src/CSBCode.cpp:8313). The VBL
     * sets `clockTick` again on every VBL once `vblCount >= d.Speed` (`:1066-1077`), so
     * a tick that was due waits one frame.
     */
    private clockTickCleared = false;
    /**
     * `d.clockTick = 1` from `WakeUp` (doc/CSBwin-src/CSBCode.cpp:7050): a tick is due at
     * once, whatever the VBL count. The tick itself clears it again (`:704`), so a party
     * woken by a blow during `ProcessTimers` gets no extra tick.
     */
    private clockTickSet = false;
    private animationFrameId: number | null = null;

    // Event callbacks
    private onTickCallbacks: GameEventCallback[] = [];
    private onMoveCallbacks: MovementCallback[] = [];

    /**
     * `host` is what the engine asks of whoever runs it (`GameHost`); what it leaves out
     * does nothing.
     */
    constructor(dungeonData: DungeonData, tables: GameTables, host: Partial<GameHost> = {}) {
        this.tables = tables;
        this.addCharacterTables = { objDescCarryMask: tables.objDescWord4, carryLocation: tables.carryLocation };

        const ctx = createGameContext(dungeonData, tables, createGameHost(host));
        this.ctx = ctx;
        this.dungeonState = ctx.dungeon;
        this.party = ctx.party;
        this.state = ctx.state;
        this.random = ctx.random;
        this.footprints = ctx.footprints;
        this.timerQueue = ctx.timers;
        this.sounds = ctx.sounds;
        this.actuators = new ActuatorSystem(ctx);
        this.dsaSystem = new DsaSystem(ctx);
        this.timerSystem = new TimerSystem(ctx);
        this.monsterSystem = new MonsterSystem(ctx);
        this.monsterDamage = new MonsterDamage(ctx);
        this.monsterPerception = new MonsterPerception(ctx);
        this.monsterAttack = new MonsterAttack(ctx);
        this.monsterAI = new MonsterAI(ctx);
        this.characterStats = new CharacterStats(ctx);

        this.attackSystem = new AttackSystem(ctx);
        this.movementSystem = new MovementSystem(ctx);
        this.magic = new MagicSystem(ctx);
        this.character = new CharacterSystem(ctx);

        Object.assign(ctx.systems, {
            actuators: this.actuators,
            dsa: this.dsaSystem,
            timer: this.timerSystem,
            monsters: this.monsterSystem,
            monsterDamage: this.monsterDamage,
            monsterPerception: this.monsterPerception,
            monsterAttack: this.monsterAttack,
            monsterAI: this.monsterAI,
            characterStats: this.characterStats,
            attack: this.attackSystem,
            movement: this.movementSystem,
            magic: this.magic,
            character: this.character,
            game: this,
        } satisfies GameSystems);
    }

    processViewingFilter(options: ViewingFilterOptions): ViewingFilterResult | null {
        return this.dsaSystem.processViewingFilter(options);
    }

    /** Pin `d.RandomNumber`. For tools and, eventually, save-game restore. */
    setRandomSeed(seed: number): void {
        this.random.setSeed(seed);
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
            clearTimeout(this.animationFrameId);
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
     * Main game loop (VBL-style at 60Hz).
     *
     * Paced with `setTimeout` rather than `requestAnimationFrame`. CSBWin's VBL timer
     * keeps advancing `d.Time` — and with it the teleporter/energy shimmer's
     * `GraphicRandom` counter, the party's food and water, every monster timer —
     * whether or not the window has focus; `requestAnimationFrame` callbacks are
     * fully suspended by the browser the moment the tab is backgrounded or occluded
     * (unlike `setTimeout`, which is only throttled), so an rAF-driven loop goes
     * completely idle exactly when a real VBL wouldn't, and only catches up again on
     * the next thing that nudges the browser into repainting — a mouse move, a click.
     * That was the whole story behind "the animation only changes on mouse events."
     */
    private gameLoop = (): void => {
        if (!this.running) {
            return;
        }

        this.runFrame(Date.now());

        // Schedule next frame (60 FPS)
        this.animationFrameId = setTimeout(this.gameLoop, 1000 / 60) as unknown as number;
    };

    /**
     * One VBL of the loop: the mouse queue, then a game tick if one is due.
     * Public so that `tools/` can step frames at chosen times.
     */
    runFrame(currentTime: number): void {
        this.state.currentTime = currentTime;
        this.clockTickCleared = false;
        // `do { HandleMouseEvents(_7_, 1); ... } while (intResult & 1);`
        // (doc/CSBwin-src/CSBCode.cpp:746-761): again while an entry lets the next follow.
        while (this.handleMouseEvents(1) & 1) { /* the next entry, in the same pass */ }

        // Calculate time since last tick
        const timeSinceLastTick = currentTime - this.lastTickTime;
        // `d.Speed = 0` while the party sleeps (doc/CSBwin-src/Mouse.cpp:1697), and the
        // VBL raises `clockTick` once `vblCount >= d.Speed` (`CSBCode.cpp:1066-1077`) —
        // so asleep, a tick is due on every VBL.
        const tickInterval = this.party.state.sleeping ? 0 : 1000 / GAME_TIMING.TICKS_PER_SECOND;

        // Process game ticks
        if (this.clockTickSet || (timeSinceLastTick >= tickInterval && !this.clockTickCleared)) {
            if (!this.state.paused) {
                this.gameTick();
            }
            this.lastTickTime = currentTime;
        }
    }

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

        // The top of a tick, then `ProcessTimers()` and `if (d.newPartyLevel != -1) goto
        // tag0006a4;` (doc/CSBwin-src/CSBCode.cpp:615-635): a timer that moved the party
        // to another level has it loaded, input discarded and the timers run again, all
        // in this tick.
        this.loadNewPartyLevel();
        do {
            this.timerSystem.processTimers(this.state.tickCount);
        } while (this.loadNewPartyLevel());
        this.processNinetySecondUpdate();
        this.processTenSecondUpdate();
        // `if (d.freezeLifeTimer != 0) d.freezeLifeTimer--;` — one per game tick
        // (doc/CSBwin-src/CSBCode.cpp:684).
        if (this.party.state.freezeLifeTimer !== 0) this.party.state.freezeLifeTimer--;
        // `if (d.partyMoveDisableTimer != 0) d.partyMoveDisableTimer--;` and the same for
        // `d.Word11712` (doc/CSBwin-src/CSBCode.cpp:689-695).
        if (this.party.state.partyMoveDisableTimer !== 0) this.party.state.partyMoveDisableTimer--;
        if (this.party.state.word11712 !== 0) this.party.state.word11712--;
        // `d.clockTick=0;` (doc/CSBwin-src/CSBCode.cpp:704).
        this.clockTickSet = false;
    }

    /**
     * A movement key, `TAG0196da` (doc/CSBwin-src/CSBCode.cpp:8429): translated to its
     * button and queued, unless the queue is full — `MouseQEnd + 2 == MouseQStart`, seven
     * entries waiting (`:8439-8443`). The key queue in front of it (`CSBUI.cpp:143-145`)
     * is emptied into it one key per message (`CSBCode.cpp:707-712`), so it is never
     * what refuses a key.
     */
    enqueueMovement(action: MovementAction): boolean {
        return this.enqueueKeyButton(MOVEMENT_BUTTON[action]);
    }

    /**
     * Any other key `TAG0196da` found in a `pKeyXlate` table, queued the same way — the
     * Return key of the sleep-mode table `Byte18440`, which is button 146.
     */
    enqueueKeyButton(num: number): boolean {
        let end = this.mouseQEnd + 2;
        if (end > MOUSEQLEN - 1) end -= MOUSEQLEN;
        if (end === this.mouseQStart) return false;
        this.mouseQEnd = (this.mouseQEnd + 1) % MOUSEQLEN;
        this.mouseQueue[this.mouseQEnd] = { num, x: 0, y: 0 };
        return true;
    }

    /**
     * The queueing half of `OnMouseClick` (doc/CSBwin-src/CSBCode.cpp:7607): the caller
     * has already searched the UI's button lists (`SearchButtonList`) for `num`. Queued
     * only while fewer than `MOUSEQLEN-2` entries wait — there must be room left for the
     * button-up — and never for a click that hit no button (`:7626-7690`). Says whether
     * it was queued.
     */
    onMouseClick(num: number, x: number, y: number): boolean {
        if (num === 0) return false;
        if (this.queuedInputCount() >= MOUSEQLEN - 2) return false;
        this.mouseQEnd = (this.mouseQEnd + 1) % MOUSEQLEN;
        this.mouseQueue[this.mouseQEnd] = { num, x, y };
        return true;
    }

    /**
     * `OnMouseUnClick` (doc/CSBwin-src/CSBCode.cpp:7581): the button-up, `0x0add`, queued
     * while fewer than `MOUSEQLEN-1` entries wait — whether or not its click was.
     */
    onMouseUnClick(): void {
        if (this.queuedInputCount() >= MOUSEQLEN - 1) return;
        this.mouseQEnd = (this.mouseQEnd + 1) % MOUSEQLEN;
        this.mouseQueue[this.mouseQEnd] = { num: MOUSE_UNCLICK, x: 0, y: 0 };
    }

    /** `numEnt`: how many entries wait in the mouse queue (doc/CSBwin-src/CSBCode.cpp:7589-7590). */
    queuedInputCount(): number {
        return (this.mouseQEnd - this.mouseQStart + 1 + MOUSEQLEN) % MOUSEQLEN;
    }

    /** Who handles the buttons that are not movement (see `MouseEventHandlers`). */
    setMouseEventHandlers(handlers: MouseEventHandlers | null): void {
        this.mouseEventHandlers = handlers;
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
            if (result.stepped) this.setPartyMoveDelay();
            if (resolvedPosition) {
                const unchanged = oldPos.x === resolvedPosition.x
                    && oldPos.y === resolvedPosition.y
                    && oldPos.z === resolvedPosition.z;
                this.actuators.triggerObjectMove(oldPos, OBJECT_ID_NULL, false, unchanged, resolvedFacing);
                this.actuators.triggerObjectMove(resolvedPosition, OBJECT_ID_NULL, true, unchanged, resolvedFacing);
            }
            this.notePartyMoved();
            this.loadPartyLevelIfChanged();
            this.timerSystem.processTimers(this.state.tickCount);

            // Notify callbacks
            for (const callback of this.onMoveCallbacks) {
                callback(true, result);
            }

            return true;
        } else {
            if (result.inhibited) {
                // `DiscardAllInput(); d.clockTick = 0;` (doc/CSBwin-src/CSBCode.cpp:8310-8314).
                this.discardAllInput();
                this.clockTickCleared = true;
                this.clockTickSet = false;
            }
            // Notify callbacks of failure
            for (const callback of this.onMoveCallbacks) {
                callback(false, result);
            }

            return false;
        }
    }

    handleDsaTeleportParty(locr: LocationRel): void {
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
    }

    /**
     * The UI's object drop: `ActuatorSystem.triggerObjectMove` (`PlaceOrRemoveObjectInRoom`),
     * then whatever it set in motion — a level change, the timers it queued.
     */
    triggerObjectMove(position: Position, object: ObjectID, place: boolean, unchangedRoom: boolean, facing: number): void {
        this.actuators.triggerObjectMove(position, object, place, unchangedRoom, facing);
        this.loadPartyLevelIfChanged();
        this.timerSystem.processTimers(this.state.tickCount);
    }

    /**
     * The tail of `MoveParty`'s step (doc/CSBwin-src/CSBCode.cpp:8326-8349), after
     * `MoveObject` — so a champion a pit just killed no longer counts:
     *
     *   time2move = 1;
     *   for (i = 0; i < d.NumCharacter; i++)
     *     if (pCharacter->HP() != 0) time2move = sw(Larger(time2move, TimeToMove(pCharacter)));
     *   ...d.partyMoveDisableTimer = time2move;   // unless a party-move filter set a delay
     *   d.Word11712 = 0;
     *
     * A stairway is not a step: taking one sets neither.
     */
    private setPartyMoveDelay(): void {
        const party = this.party.state;
        let time2move = 1;
        for (const champ of party.champions) {
            if (champ.attributes.health !== 0) {
                time2move = sw(Math.max(time2move, this.characterStats.timeToMove(champ)));
            }
        }
        party.partyMoveDisableTimer = time2move;
        party.word11712 = 0;
    }

    /**
     * `DiscardAllInput` (doc/CSBwin-src/CSBCode.cpp:7532-7544): the mouse queue is reset
     * to empty, `MouseQStart = 0`, `MouseQEnd = MOUSEQLEN-1` — every key and click that
     * was waiting is lost.
     */
    discardAllInput(): void {
        this.mouseQStart = 0;
        this.mouseQEnd = MOUSEQLEN - 1;
    }

    /**
     * The engine half of button 145, the sleep icon (doc/CSBwin-src/Mouse.cpp:1683-1708).
     * The UI has already hidden the inventory and asked (`ShowHideInventory(4)`,
     * `TAG02076e`); this is `d.PartySleeping = 1`, `d.Speed = 0` — which `runFrame` reads
     * as a tick on every frame — and `DiscardAllInput()`. The sleep-mode button list,
     * `Buttons17796`, and `DisplaySleepScreen` are the listeners' business.
     *
     * Refused while a champion is only provisionally in the party (`:1685`).
     */
    sleep(): boolean {
        const party = this.party.state;
        if (party.potentialChampionIndex >= 0) return false;
        party.sleeping = true;
        this.notifySleep(true);
        this.discardAllInput();
        return true;
    }

    /**
     * `WakeUp` (doc/CSBwin-src/CSBCode.cpp:7047) — button 146, or any blow that lands on a
     * sleeping party (`Monster.cpp:4531`, `Character.cpp:2809-2812`). `d.clockTick = 1`,
     * `d.PartySleeping = 0`, the game speed back, the adventure button lists back (the
     * listeners), `DiscardAllInput()`.
     *
     * Not ported: `scrollingText.SetNewSpeed`, which paces the scroll animation the port
     * does not have (DEBT G5).
     */
    wakeUp(): void {
        this.clockTickSet = true;
        this.clockTickCleared = false;
        this.party.state.sleeping = false;
        this.notifySleep(false);
        this.discardAllInput();
    }

    isPartySleeping(): boolean {
        return this.party.state.sleeping;
    }

    /** Tell the host `d.PartySleeping` changed (see `sleep` / `wakeUp`). */
    private notifySleep(sleeping: boolean): void {
        this.ctx.host.sleepChanged(sleeping);
    }

    /**
     * `tag0006a4` (doc/CSBwin-src/CSBCode.cpp:615-623): `if (d.newPartyLevel != -1)`,
     * `LoadPartyLevel(...); MoveObject(RN(RNnul), -1, 0, ...); d.newPartyLevel = -1;
     * DiscardAllInput();`. The port has already placed the party — it resolves a whole
     * pit and teleporter chain at once — and may already have loaded the level (see
     * `loadPartyLevelIfChanged`), in which case only the discard is still owed. Says
     * whether it ran.
     */
    private loadNewPartyLevel(): boolean {
        if (!this.monsterSystem.loadPartyLevelIfChanged() && !this.newPartyLevel) return false;
        this.newPartyLevel = false;
        this.discardAllInput();
        return true;
    }

    /**
     * The port loads a new party level as soon as the party arrives on it; CSBWin only
     * sets `d.newPartyLevel` there and loads it at the top of the next tick, where
     * `DiscardAllInput()` follows (doc/CSBwin-src/CSBCode.cpp:615-623). So the discard is
     * left for `gameTick`: input queued between the arrival and that tick is lost too.
     */
    private loadPartyLevelIfChanged(): void {
        if (this.monsterSystem.loadPartyLevelIfChanged()) this.newPartyLevel = true;
    }

    /**
     * `HandleMouseEvents` (doc/CSBwin-src/Mouse.cpp:1349), which the main loop calls with
     * `delta = 1` (`CSBCode.cpp:748`): at most one entry of the mouse queue, and a result
     * whose bit 0 asks to be called again at once. The head waits, rather than being
     * taken, while
     *
     * - an entry was handled this tick: `lastTime != 0 && d.Time < lastTime + delta`
     *   (`Mouse.cpp:1468-1476`);
     * - it is a step and `d.partyMoveDisableTimer != 0`, or `d.Word11712 != 0` and the
     *   step heads in direction `d.Word11714` (`:1485-1498`) — and everything queued
     *   behind it waits too.
     *
     * The turns and steps are handled here (`TurnParty`, `MoveParty`, `:1550-1570`), the
     * button-up and every other button by `mouseEventHandlers`. Every button stamps
     * `lastTime`; the button-up does not, and lets the next entry follow (`:1523-1549`).
     *
     * Not ported: the frozen game's filter (`:1433-1444`) and the stairs buttons
     * `0x1124`/`0x1125`, for want of either in the port.
     */
    private handleMouseEvents(delta: number): number {
        const result = 0;
        if (this.queuedInputCount() === 0) return result;
        const time = this.state.tickCount;
        if (this.lastInputTime !== 0 && time < this.lastInputTime + delta) return result;
        const entry = this.mouseQueue[this.mouseQStart];
        const num = entry.num;
        const party = this.party.state;
        if (num >= 3 && num <= 6 && (
            party.partyMoveDisableTimer !== 0 ||
            (party.word11712 !== 0 && ((party.facing + num - 3) & 3) === party.word11714)
        )) return result;
        this.mouseQStart = (this.mouseQStart + 1) % MOUSEQLEN;
        if (num === MOUSE_UNCLICK) {
            this.mouseEventHandlers?.unclick();
            return result | 1;
        }
        const action = BUTTON_MOVEMENT[num];
        if (action !== undefined) {
            this.move(action);
        } else {
            this.mouseEventHandlers?.button(num, entry.x, entry.y);
        }
        this.lastInputTime = time;
        return result;
    }

    /**
     * Add a champion to the party
     */
    addChampion(champion: Champion): boolean {
        // `AddCharacter`'s fingerprint (doc/CSBwin-src/Character.cpp:513-516), given
        // once, on joining, as `addCharacter` gives it: this is how the tools'
        // champions join.
        const pos = this.party.state.position;
        champion.fingerprint = computeChampionFingerprint(this.party.state.champions, pos.z, pos.x, pos.y);
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
        if (party.objectInHand !== OBJECT_ID_NULL) return false;
        if (party.champions.length >= 4) return false;
        // One mirror at a time: a second click while the menu is up would push a
        // champion that `_ResurrectReincarnateCancel` can no longer reach.
        if (party.potentialChampionIndex >= 0) return false;

        const hero = this.findHeroForMirror(charID, mirrorCell, wall);
        if (!hero) return false;

        const index = party.champions.length; // LOCAL_2
        const possessions = emptyPossessions();
        const champion = createChampionFromPreset(
            hero,
            findFreeCharPosition(party.champions, party.facing),
            possessions,
        );
        // `pcA3->facing = pcA3->facing3 = d.partyFacing` (`:522`, `:531`) — the corner
        // the champion stands in is chosen above, but they face the way the party does.
        champion.facing = party.facing;
        champion.damageFromDirection = party.facing;
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
        return true;
    }

    /**
     * `_ResurrectReincarnateCancel` (`doc/CSBwin-src/CSBCode.cpp:6615`). `button` is
     * CSBWin's own id from `Buttons18372`: 160 Resurrect, 161 Reincarnate, 162 Cancel.
     */
    resurrectReincarnateCancel(button: number): boolean {
        const party = this.party.state;
        const index = party.potentialChampionIndex;
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
            return true;
        }

        const mirror = this.getMirrorCell();
        // `RemoveObjectFromRoom` for each possession (`:6668-6677`). `AddCharacter` left
        // them linked in the mirror's cell *as well as* on the champion; this is where
        // the room finally lets go of them.
        for (const value of champion.possessions) {
            if (value === OBJECT_ID_NULL) continue;
            this.dungeonState.removeObjectFromCell(mirror, value);
        }

        this.disableMirrorActuators(mirror);

        if (button === 161) {
            // `ReIncarnate(_2_, pcA3)` (`:6738`) is the *first* thing this branch does,
            // and in CSBWin it blocks until the player has typed a name. Here it opens
            // a modal screen and returns, so everything after it — the skill wipe, the
            // penalties, the tail below — is deferred to `finishReincarnate`, which the
            // screen calls when it is answered. The champion stays potential-free but
            // still last in the party throughout, which is all the deferred half needs.
            this.ctx.host.openReincarnateScreen(party.champions.length - 1);
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

        const messages = this.ctx.host.messages;
        const color = this.actuators.getChampionMessageColor(party.champions.length - 1);
        messages.printLinefeed();
        messages.quePrintLines(color, champion.name);
        messages.quePrintLines(color, button === 160 ? ' RESURRECTED' : ' REINCARNATED');

        party.selectedCharacterIndex = -1;
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
    private collectMirrorPossessions(champion: Champion, possessions: ObjectID[]): void {
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
        // `AddCharacter` places each object with `AddCharacterPossession`
        // (`doc/CSBwin-src/Character.cpp:789`), so a recruit arrives with the bonuses of
        // what they carry. Only the stat half is here; the rest is `DEBT.md` C34.
        for (let slot = 0; slot < 30; slot++) {
            const obj = possessions[slot]!;
            if (obj !== OBJECT_ID_NULL) this.character.adjustStatsForItemCarried(champion, slot, 1, obj);
        }
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
        // `expool.AddChampionBonesRecord(objD4, pcA3->fingerPrint)`, whatever the
        // fingerprint (doc/CSBwin-src/Character.cpp:2646): 0 pairs the bones too.
        this.dungeonState.addChampionBonesRecord(bones, champ.fingerprint);
    }

    /**
     * The tail of `ProcessMissileEncounter`'s party arm
     * (`doc/CSBwin-src/Code11f52.cpp:2044-2056`):
     *
     * ```cpp
     * if (D4W != 0) {
     *   D0W = DamageCharacter(objectPos, D5W, 12, d.Word12964);
     *   if (D0W != 0 && d.Word12962 != 0 && STRandomBool())
     *     PoisonCharacter(objectPos, d.Word12962);
     * }
     * ```
     *
     * Everything above it — which champion, how much, which mitigation, how much
     * poison — was decided in `TimerSystem.determineMagicDamage`; this only applies
     * it. Going through `DamageCharacter` rather than subtracting from `health` is
     * the whole point: it is what runs armour, wounds, the shields, the wake-up, and
     * `KillCharacter`. Until it did, a champion killed by a missile left no bones and
     * no possessions, and a party wiped by one did not lose the game.
     *
     * The **wound mask is 12**, a literal at the call site: bits 2 and 3, the torso
     * and the legs. A missile cannot wound a hand, a head or a foot.
     */
    applyMissileDamageToParty(options: {
        chIdx: number;
        damage: number;
        kind: number;
        poisonStrength: number;
    }): void {
        // No `d.LastMonsterAttackTime` here: only `MonsterAttacks` sets it
        // (`doc/CSBwin-src/Monster.cpp:982`), and this port does so in `MonsterAttack`.
        const dealt = this.monsterAttack.damageCharacter(
            options.chIdx,
            options.damage | 0,
            MISSILE_WOUND_MASK,
            options.kind | 0,
        );
        if (dealt === 0) return;
        // `STRandomBool()` — a poisoned missile infects only half the time.
        if ((options.poisonStrength | 0) !== 0 && this.random.bool() !== 0) {
            this.monsterAttack.poisonCharacter(options.chIdx, options.poisonStrength | 0);
        }
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
            this.party.state.magicFootprintsActive !== 0,
        );
    }

    /**
     * The apply half of `_FeedCharacter` (`doc/CSBwin-src/Character.cpp:4348`), with
     * the engine pieces the UI cannot reach bound in. Returns CSBWin's
     * `fp.performFeeding`, which is what tells the caller the object was consumed.
     */
    applyFeeding(chIdx: number, fp: FeedParameters): boolean {
        return applyFeedParameters(this.party.state, chIdx, fp, {
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
    }

    /**
     * A champion died. Keeps the derived party state honest.
     *
     * Closing the inventory on a dead champion is CSBWin's `ShowHideInventory(4)`
     * (`doc/CSBwin-src/Character.cpp:2619`). The magic tab is *not* cleared here:
     * `killCharacter` hands it to a living champion through `SelectMagicCaster`, and
     * blanking it afterwards would undo that.
     */
    onChampionDied(chIdx: number): void {
        const champ = this.party.state.champions[chIdx];
        if (!champ) return;
        if (this.party.state.selectedCharacterIndex === chIdx) {
            this.party.state.selectedCharacterIndex = -1;
        }
    }

    /**
     * Replace the current party state (debug/testing).
     */
    setPartyState(state: PartyState): void {
        this.party.setState(state);
        ensureHandOwner(this.party.state);
    }

    /**
     * `NinetySecondUpdate` (`doc/CSBwin-src/CSBCode.cpp:7339-7387`), called from the
     * game tick whenever `(d.Time & 511) == 0` (`doc/CSBwin-src/CSBCode.cpp:680-683`) —
     * every 512 ticks, about 85 seconds, despite the name.
     *
     * Each torch in a champion's hands loses one charge, and one that burns out loses its
     * `important` flag. The loop runs over `d.NumCharacter`, less one while
     * `d.PotentialCharacterOrdinal != 0`: a Hall of Champions recruit is always the last
     * champion, and their torch does not burn. The dead are not skipped (their hands are
     * empty anyway).
     *
     * CSBWin then calls `SelectPaletteForLightLevel` and `DrawEightHands` whether or not
     * a torch changed. Both have no counterpart here: the light palette and the hands
     * are derived from live state every frame (`src/renderer/ui/Light.ts`).
     */
    private processNinetySecondUpdate(): void {
        if ((this.state.tickCount & 511) !== 0) return;
        const party = this.party.state;
        let count = party.champions.length;
        if (party.potentialChampionIndex >= 0) count--;
        for (let chIdx = 0; chIdx < count; chIdx++) {
            const champion = party.champions[chIdx];
            if (!champion) continue;
            // `for (D6W=2; (D6W--) != 0;)` — hand 1, then hand 0.
            for (let hand = 1; hand >= 0; hand--) {
                const obj = this.getChampionPossession(champion, hand);
                if (obj === OBJECT_ID_NULL) continue;
                const nameIndex = this.nameIndex(obj);
                if (nameIndex < OBJNI_TORCH_A || nameIndex > OBJNI_TORCH_D) continue;
                const weapon = this.dungeonState.getWeaponRecord(obj as ObjectID);
                if (!weapon) continue;
                const charges = weapon.charges & 0x0f;
                if (charges === 0) continue;
                const next = (charges - 1) & 0x0f;
                weapon.charges = next;
                if (next === 0) weapon.important = false;
            }
        }
    }

    /**
     * `TenSecondUpdate` (`doc/CSBwin-src/Code17818.cpp:160-436`), called from the game
     * tick whenever `(d.Time & (d.PartySleeping ? 15 : 63)) == 0`
     * (`doc/CSBwin-src/CSBCode.cpp:686-688`) — every 16 s awake, 4 s asleep, despite
     * the name.
     *
     * Per living champion: mana regeneration, `tempAdjust` decay, food and water
     * consumption paid for in stamina, HP regeneration, and — every 256 ticks (64
     * asleep) — one point of each attribute's Current drawn back toward its Maximum.
     * That last step is what clears the red a level gain paints on the stats panel:
     * `LevelUp` raises only Maximum (`doc/CSBwin-src/Magic.cpp:98-148`).
     *
     * Not ported: the `d.Word11750` countdown (`:375-383`). It is a cursor-redraw
     * counter armed only by `CSBCode.cpp:959-965`, which this port has no equivalent
     * of, so it is always zero and the branch is dead. The trailing
     * `charFlags |= CHARFLAG_statsChanged` has no counterpart either: the panels are
     * redrawn from live state every frame.
     */
    private processTenSecondUpdate(): void {
        const party = this.party.state;
        const time = this.state.tickCount;
        const sleeping = party.sleeping;
        if ((time & (sleeping ? 15 : 63)) !== 0) return;
        if (party.champions.length === 0) return;

        this.footprints.ageFootprints();

        const random112 = (time & 0x40)
            | ((time & 0x80) >> 2)
            | ((time & 0x100) >> 4);
        const getObjectNameIndex = (objectId: ObjectID): number => this.nameIndex(objectId);

        for (let chIdx = 0; chIdx < party.champions.length; chIdx++) {
            const champ = party.champions[chIdx];
            if (!champ) continue;
            const attrs = champ.attributes;
            if ((attrs.health | 0) === 0) continue;
            if (party.potentialChampionIndex === chIdx) continue;
            const maxMana = attrs.maxMana | 0;
            const mana = attrs.mana | 0;
            if (mana < maxMana) {
                // Asleep, `DetermineMastery` reports 1 for every skill
                // (doc/CSBwin-src/Code17818.cpp:29-36): the roll is Wisdom + 2, and each
                // point costs 14 stamina, whatever the champion's levels.
                const magicMastery =
                    determineMastery(champ, 3, { getObjectNameIndex, partySleeping: sleeping })
                    + determineMastery(champ, 2, { getObjectNameIndex, partySleeping: sleeping });
                const wisdom = championAttribute(champ, AttributeIndex.Wisdom);
                if (random112 >= magicMastery + wisdom) {
                    if (mana > maxMana) {
                        attrs.mana = Math.max(maxMana, mana - 1);
                    }
                } else {
                    let manaAdjust = Math.trunc(maxMana / 40);
                    if (sleeping) manaAdjust *= 2;
                    manaAdjust += 1;
                    const staminaAdjust = manaAdjust * Math.max(7, 16 - magicMastery);
                    this.monsterAttack.adjustStamina(chIdx, staminaAdjust);
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

            // Food and water (`:291-344`). D6 grows by 2 for each halving of
            // MaxStamina that Stamina is still below — a tired champion eats more.
            let d6 = 4;
            for (let d4 = attrs.maxStamina | 0; (d4 >>= 1), (attrs.stamina | 0) < d4; d6 += 2) {
                // empty
            }
            let d4 = 0;
            // `ApplyLimits(1, (MaxStamina>>8)-1, 6)`
            let local4 = Math.min(6, Math.max(1, ((attrs.maxStamina | 0) >> 8) - 1));
            if (sleeping) local4 <<= 1;
            const sinceMove = sw(time - this.footprints.getLastPartyMoveTime());
            if (sinceMove > 80) {
                local4++;
                if (sinceMove > 250) local4++;
            }
            do {
                const d5 = d6 <= 4;
                if (champ.food < -512) {
                    if (d5) {
                        d4 += local4;
                        champ.food -= 2;
                    }
                } else {
                    if (champ.food >= 0) d4 -= local4;
                    champ.food -= d5 ? 2 : Math.trunc(d6 / 2);
                }
                if (champ.water < -512) {
                    if (d5) {
                        d4 += local4;
                        champ.water -= 1;
                    }
                } else {
                    if (champ.water >= 0) d4 -= local4;
                    champ.water -= d5 ? 1 : Math.trunc(d6 / 2);
                }
                d6--;
                if (d6 === 0) break;
            } while ((attrs.stamina | 0) < (attrs.maxStamina | 0) + d4);

            this.monsterAttack.adjustStamina(chIdx, d4);
            if (champ.food < -1024) champ.food = -1024;
            if (champ.water < -1024) champ.water = -1024;

            // HP regeneration (`:350-372`).
            if ((attrs.health | 0) < (attrs.maxHealth | 0)) {
                if ((attrs.stamina | 0) >= Math.trunc((attrs.maxStamina | 0) / 4)) {
                    if (random112 < championAttribute(champ, AttributeIndex.Vitality) + 12) {
                        let local4Hp = ((attrs.maxHealth | 0) >> 7) + 1;
                        if (sleeping) local4Hp *= 2;
                        const necklace = this.getChampionPossession(champ, 10);
                        if (necklace !== OBJECT_ID_NULL && this.getBaseObjectNameIndex(necklace) === OBJNI_EKKHARD_CROSS) {
                            local4Hp = local4Hp + Math.trunc(local4Hp / 2) + 1;
                        }
                        attrs.health += Math.min(local4Hp, (attrs.maxHealth | 0) - (attrs.health | 0));
                    }
                }
            }

            // Attributes drift back to Maximum, one point at a time (`:384-414`).
            if ((time & (sleeping ? 63 : 255)) === 0) {
                for (const attr of attrs.stats) {
                    const maximum = attributeMaximum(attr);
                    const current = attributeCurrent(attr);
                    if (current < maximum) {
                        incrAttributeCurrent(attr, 1);
                    } else if (current > maximum) {
                        incrAttributeCurrent(attr, -Math.trunc(current / (maximum === 0 ? 1 : maximum)));
                    }
                }
            }

            // A champion left facing elsewhere turns back with the party once no
            // monster has struck for 60 ticks (`:416-430`).
            if (!sleeping && champ.facing !== party.facing) {
                if (party.lastMonsterAttackTime < time - 60) {
                    champ.facing = party.facing;
                    champ.maxRecentDamage = 0;
                }
            }
        }
    }

    /** `CHARDESC::Possession(slot)` — `RNnul` when the slot is empty. */
    private getChampionPossession(champion: Champion, slot: number): ObjectID {
        return champion.possessions[slot] ?? OBJECT_ID_NULL;
    }

    private applyLimits(min: number, value: number, max: number): number {
        if (value < min) return min;
        if (value > max) return max;
        return value | 0;
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
        const raw = this.tables.byte20090[attackType] ?? 0;
        return (raw << 24) >> 24;
    }

    /** `d.attackDamageToDisplay` — read and cleared by the UI's damage flash. */
    consumeAttackDamageToDisplay(): number {
        const value = this.attackSystem.attackDamageToDisplay;
        this.attackSystem.attackDamageToDisplay = 0;
        return value;
    }

    /**
     * `ThrowByCharacter` with an explicit hand (`doc/CSBwin-src/Mouse.cpp:672`) — the
     * THROW attack, which throws what is in the fighting hand rather than what the
     * cursor is holding. `range`/`damage`/`decayRate` of -1 mean "compute them", which
     * is how the Party Attack Filter can override any of the three.
     */
    throwFromWeaponHand(options: {
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
            champion, 1, this.party.state.sleeping,
        );
        const obj = this.character.removeCharacterPossession(options.chIdx, 1);
        if (obj === OBJECT_ID_NULL) return 0;
        return this.throwByCharacter(
            options.chIdx, champion, obj, options.side, throwingDistance, options,
        ) ? 1 : 0;
    }

    /** The busy timer's `uByte6`, which decides which slot refills the hand. */
    setBusyTimerRefill(chIdx: number, value: number): void {
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
    enableCharacterAction(chIdx: number, refillSlot: number): void {
        const champion = this.party.state.champions[chIdx];
        if (!champion) return;
        if (champion.attackType !== -1) champion.attackStatModifier = 0;
        if ((champion.attributes.health | 0) !== 0) {
            // A bow that has just been fired reloads itself from slot 12, then from
            // slots 7-9, taking the first object of the matching ammunition class
            // (`TAG0153c2`, `doc/CSBwin-src/Timer.cpp:2656-2672`).
            if (champion.attackType === AttackType.atk_SHOOT && this.getChampionPossession(champion, 0) === OBJECT_ID_NULL) {
                for (const slot of [12, 7, 8, 9]) {
                    if (this.matchingAmmunition(champion, slot)) {
                        const ammo = this.character.removeCharacterPossession(chIdx, slot);
                        if (ammo !== OBJECT_ID_NULL) this.character.setChampionHand(champion, 0, ammo);
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
        if (launcher === OBJECT_ID_NULL || decodeObjectID(launcher).category !== DBType.WEAPON) return false;
        const launcherDesc = this.characterStats.weaponDescFor(launcher);
        if (!launcherDesc) return false;
        let wanted: number;
        if (launcherDesc.uByte1 >= 16 && launcherDesc.uByte1 <= 31) wanted = 10;
        else if (launcherDesc.uByte1 >= 32 && launcherDesc.uByte1 <= 47) wanted = 11;
        else return false;

        const candidate = this.getChampionPossession(champion, slot);
        if (candidate === OBJECT_ID_NULL || decodeObjectID(candidate).category !== DBType.WEAPON) return false;
        const desc = this.characterStats.weaponDescFor(candidate);
        return !!desc && desc.uByte1 === wanted;
    }

    /**
     * `TAG0115ee` (`doc/CSBwin-src/CSBCode.cpp:6251`) — put a weapon back into the hand
     * a throw emptied, from slot 12 first and then slots 7-9 (`:6263-6270`). Only a
     * weapon: a thrown apple does not come back.
     */
    private refillPossessionSlot(chIdx: number, slot: number): void {
        const champion = this.party.state.champions[chIdx];
        if (!champion) return;
        if (this.getChampionPossession(champion, slot) !== OBJECT_ID_NULL) return;
        for (const source of [12, 7, 8, 9]) {
            const obj = this.getChampionPossession(champion, source);
            if (obj === OBJECT_ID_NULL) continue;
            if (decodeObjectID(obj).category !== DBType.WEAPON) continue;
            const moved = this.character.removeCharacterPossession(chIdx, source);
            if (moved !== OBJECT_ID_NULL) this.character.setChampionHand(champion, slot, moved);
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
    climbDownIntoPit(target: Position): void {
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
        this.loadPartyLevelIfChanged();
    }


    /** `GetBasicObjectType` (`src/engine/objectIndex.ts`). */
    private getBaseObjectNameIndex(rn: ObjectID): number {
        return GetBasicObjectType(this.dungeonState, this.tables.objDescObjectType, rn);
    }

    /** `RN::NameIndex` (`src/engine/objectIndex.ts`). */
    private nameIndex(rn: ObjectID): number {
        return nameIndexOf(this.ctx, rn);
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
        if (party.objectInHand !== OBJECT_ID_NULL) return false;

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

        this.ctx.host.playSound(SoundIndex.SWITCH);
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

        const obj = party.objectInHand;
        if (obj === OBJECT_ID_NULL) return false;

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

        // `objD4.pos(w_4); MoveObject(objD4, -1, 0, D6W, D5W, NULL, NULL)`
        // (`doc/CSBwin-src/Mouse.cpp:881-882`): a freshly-dropped object still walks
        // through an active teleporter or open pit on the cell it lands on.
        const dropped = encodeObjectID(newPos, decoded.category, decoded.index);
        party.objectInHand = OBJECT_ID_NULL;
        this.timerSystem.moveObject(dropped, -1, 0, target.x, target.y, target.z);
        this.loadPartyLevelIfChanged();
        this.timerSystem.processTimers(this.state.tickCount);
        if (options?.viAltar) {
            this.maybeScheduleViAltar(dropped, target, newPos);
        }
        return true;
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

        const obj = party.objectInHand;
        if (obj === OBJECT_ID_NULL) return false;

        const champion = party.champions[owner] ?? null;
        if (!champion) return false;

        // CSBWin's `hand < 0` path: the object goes into the fighting hand for exactly
        // as long as it takes to measure the throw, because `DetermineThrowingDistance`
        // reads a *possession*, not a loose object (`doc/CSBwin-src/Mouse.cpp:698-705`).
        const saved = champion.possessions[1]!;
        this.character.setPossessionDirect(champion, 1, obj);
        const throwingDistance = this.characterStats.determineThrowingDistance(
            champion, 1, party.sleeping,
        );
        this.character.setPossessionDirect(champion, 1, saved);

        party.objectInHand = OBJECT_ID_NULL;
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
        this.monsterAttack.adjustStamina(chIdx, this.throwStaminaCost(obj));
        // A negative disable time means "use the default", which is 4 ticks.
        const disableTime = overrides && overrides.disableTime >= 0 ? overrides.disableTime : 4;
        this.magic.disableCharacterAction(chIdx, disableTime);

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
            partySleeping: party.sleeping,
            getObjectNameIndex: (objectId: ObjectID) => this.nameIndex(objectId),
        });
        const range = base + this.random.below(16) + Math.trunc(base / 2) + mastery;
        const damage = this.applyLimits(40, 8 * mastery + (this.random.next() & 31), 200);
        const decayRate = Math.max(5, 11 - mastery);

        const launched = this.timerSystem.throwObjectFromHand(
            obj,
            party.position,
            leftOrRight,
            party.facing,
            overrides && overrides.range >= 0 ? overrides.range : range,
            overrides && overrides.damage >= 0 ? overrides.damage : damage,
            overrides && overrides.decayRate >= 0 ? overrides.decayRate : decayRate,
            this.state.tickCount,
        );
        // `d.Word11712 = 4; d.Word11714 = d.partyFacing;` (doc/CSBwin-src/Mouse.cpp:753-754):
        // for 4 ticks the party cannot step after what it threw.
        party.word11712 = 4;
        party.word11714 = party.facing;
        return launched;
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


    /** The magic panel's cast button (`MagicSystem.castSpellFromUi`). */
    castSpellFromUi(chIdx: number, incantation: number[]): number {
        return this.magic.castSpellFromUi(chIdx, incantation);
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

    /**
     * The DSA global variables, where a dungeon keeps its puzzle progress. Public so a
     * loader that cannot read a save's own copy of them can keep the ones in play
     * rather than clear them (`src/data/CsbwinSaveGame.ts`).
     */
    getDsaGlobalVariables(): number[] {
        return this.dsaSystem.getGlobalVariables();
    }

    // Snapshot runtime state for quick-save.
    getRuntimeSaveState(): RuntimeSaveState {
        const item16 = this.state.dungeon.item16
            ? this.state.dungeon.item16.map((r) => ({
                  ...r,
                  singleMonsterStatus: [...r.singleMonsterStatus],
              }))
            : undefined;
        const { records: timers, queue: timerQueue } = this.buildTimerRecords();
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
                timerQueue,
                timerSequence: this.timerQueue.getNextSequence(),
                missiles,
                snapshot: this.dungeonState.captureSnapshot(),
            },
        };
    }

    // Restore runtime state from quick-save.
    applyRuntimeSaveState(save: RuntimeSaveState): void {
        // `d.PartySleeping = 0` wherever a game starts (doc/CSBwin-src/CSBCode.cpp:10479):
        // CSBWin never saves it. Loading over a sleeping party must hand the UI its
        // adventure button lists back, whatever the restored state says.
        const wasSleeping = this.isPartySleeping();
        this.party.setState(save.party);
        this.party.state.sleeping = false;
        if (wasSleeping) this.notifySleep(false);
        // `d.HandChar = b.gb2.handChar` (doc/CSBwin-src/SaveGame.cpp:1636): the cursor
        // owner is part of the saved state. `setState` carries it, and this repairs the
        // states written before it was ever set.
        ensureHandOwner(this.party.state);

        this.state.paused = save.game.paused;
        this.state.tickCount = save.game.tickCount;
        // `HandleMouseEvents(_16_, -999887)` — `lastTime = 0` (doc/CSBwin-src/SaveGame.cpp:1661,
        // `Mouse.cpp:1372-1376`).
        this.lastInputTime = 0;
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
        // The queue before `applySaveGameState`, which reads `timerWord8` back out of
        // it through `DungeonState`'s lookup.
        this.restoreTimerQueue(
            timers,
            save.dungeon.timerQueue ?? [],
            save.dungeon.timerSequence ?? 0,
        );
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

    /**
     * The timer table, laid out by timer index as CSBWin's array is, plus the queue
     * order beside it.
     *
     * This used to write a single field per timer, `timerWord8`, so no save of any kind
     * restored *when* anything was due: a door caught mid-close stayed put, a fuse
     * stopped burning. The whole `TIMER` is written now, and `timerQueue` carries the
     * firing order, which is what `TimerQueue.restore` puts back.
     *
     * An index with no live timer is filled with an empty record — `TT_EMPTY` is
     * function 0 — exactly as CSBWin's array has holes wherever `m_firstAvailTimer`'s
     * free list has slots.
     */
    /**
     * Which byte pair of `TIMER` holds an object reference, by timer function.
     *
     * `ConvertTimers` (`doc/CSBwin-src/SaveGame.cpp:2027-2050`): 48 and 49 — the missile
     * in flight — keep it in bytes 6-7, and 24, 25, 60 and 61 in bytes 8-9. Every other
     * function reads both pairs as plain numbers.
     */
    private static objectBytesOf(timerFunction: number): 6 | 8 | null {
        if (timerFunction === 48 || timerFunction === 49) return 6;
        if (timerFunction === 24 || timerFunction === 25 ||
            timerFunction === 60 || timerFunction === 61) return 8;
        return null;
    }

    /**
     * Collapse a live timer's three representations into the four bytes a file has.
     *
     * `TIMER` has one pair of bytes at 6-7 and one at 8-9, and CSBWin reads each pair
     * either as two bytes or as a word depending on the timer function
     * (`timerObj6()`, `timerWord8()`, `doc/CSBwin-src/CSB.h:1818-1860`). This port's
     * live `TimerEntry` carries *both* readings side by side, plus an `object` field
     * that has no byte at all — convenient in the engine, and three things where the
     * file has one. So the collapse has to happen somewhere, and this is the boundary.
     *
     * Three rules, each with a source:
     *
     * - The **object** goes into the pair `ConvertTimers` names for that function.
     *   Without this a thrown sword was written with its launch square in bytes 6-7 and
     *   the object nowhere, so the file lost it: `TimerSystem.launchMissile` puts the
     *   RN on `TimerEntry.object` and passes the launch x,y as the bytes.
     * - For 48 and 49, **bytes 8-9 are `timerWord8`** — the packed
     *   `[x:5][y:5][direction:2][decay:4]` `processMissileTimer` reads back. Those two
     *   bytes are passed as `pos` and `action`, which a missile timer leaves at zero,
     *   so they have to come from the word instead. Measured in
     *   `csbgame-flying-sword.dat`: function 49, bytes 6-7 = 0x079a (the object's slot)
     *   and bytes 8-9 = 0xa909 (the packed word).
     * - Where a **count** lives in `timerWord6` and nothing lives in the bytes — the
     *   magic shield and poison timers, which `MagicSystem.queueUtilityTimer` creates with
     *   x = y = 0 — the count is written into them. The two representations can only
     *   ever conflict when one is zero, because no creator sets both; the guard says
     *   exactly that rather than assuming it.
     */
    private static collapseTimerBytes(record: TimerRecord, object: number | undefined): TimerRecord {
        const at = Game.objectBytesOf(record.function);
        if (at === 6 && object !== undefined) {
            record.timerWord6 = object & 0xffff;
            record.uByte6 = (object >> 8) & 0xff;
            record.uByte7 = object & 0xff;
        } else if (at === 8 && object !== undefined) {
            record.timerWord8 = object & 0xffff;
            record.uByte8 = (object >> 8) & 0xff;
            record.uByte9 = object & 0xff;
        }
        if (at === 6) {
            record.uByte8 = (record.timerWord8 >> 8) & 0xff;
            record.uByte9 = record.timerWord8 & 0xff;
        }
        const word6 = record.timerWord6 & 0xffff;
        if (at === null && word6 !== 0 && record.uByte6 === 0 && record.uByte7 === 0) {
            record.uByte6 = (word6 >> 8) & 0xff;
            record.uByte7 = word6 & 0xff;
        }
        return record;
    }

    private buildTimerRecords(): { records: TimerRecord[]; queue: number[] } {
        const entries = this.timerQueue.getTimers();
        let maxIndex = -1;
        for (const entry of entries) {
            if (entry.index > maxIndex) maxIndex = entry.index;
        }
        if (maxIndex < 0) return { records: [], queue: [] };
        const records: TimerRecord[] = Array.from({ length: maxIndex + 1 }, () => emptyTimerRecord());
        for (const entry of entries) {
            records[entry.index] = Game.collapseTimerBytes({
                time: entry.time >>> 0,
                level: entry.level & 0xff,
                function: entry.function & 0xff,
                uByte5: entry.uByte5 & 0xff,
                uByte6: entry.uByte6 & 0xff,
                uByte7: entry.uByte7 & 0xff,
                uByte8: entry.uByte8 & 0xff,
                uByte9: entry.uByte9 & 0xff,
                sequence: entry.sequence & 0xffff,
                timerWord8: entry.timerWord8 & 0xffff,
                timerWord6: sw(entry.timerWord6),
            }, entry.object);
        }
        return { records, queue: entries.map((entry) => entry.index) };
    }

    /**
     * Rebuild the live queue from a saved table and firing order.
     *
     * The records are a table *by index*; the queue names which of them are live and in
     * what order. Both readings of bytes 6-9 come back, because which one a timer means
     * depends on its function and the queue entry carries both.
     */
    private restoreTimerQueue(records: TimerRecord[], order: number[], nextSequence: number): void {
        const entries: TimerEntry[] = [];
        for (const index of order) {
            const record = records[index];
            if (!record) continue;
            // The inverse of `collapseTimerBytes`: an object-carrying timer's RN comes
            // back off the byte pair `ConvertTimers` names and onto `TimerEntry.object`,
            // which is where every handler in this port looks for it
            // (`processMissileTimer`, `processTT_25`, `onMonsterAbeyance`). Without this
            // a restored missile has no object and vanishes on its next tick.
            const at = Game.objectBytesOf(record.function & 0xff);
            const object =
                at === 6 ? (record.timerWord6 & 0xffff) as ObjectID :
                at === 8 ? (record.timerWord8 & 0xffff) as ObjectID : undefined;
            entries.push({
                index,
                time: record.time >>> 0,
                level: record.level & 0xff,
                function: record.function & 0xff,
                uByte5: record.uByte5 & 0xff,
                uByte6: record.uByte6 & 0xff,
                uByte7: record.uByte7 & 0xff,
                uByte8: record.uByte8 & 0xff,
                uByte9: record.uByte9 & 0xff,
                sequence: record.sequence & 0xffff,
                timerWord8: record.timerWord8 & 0xffff,
                timerWord6: sw(record.timerWord6),
                object,
            });
        }
        this.timerQueue.restore(entries, nextSequence);
    }
}

/** A free slot in the timer table: `TT_EMPTY`, and nothing else set. */
function emptyTimerRecord(): TimerRecord {
    return {
        time: 0,
        level: 0,
        function: 0,
        uByte5: 0,
        uByte6: 0,
        uByte7: 0,
        uByte8: 0,
        uByte9: 0,
        sequence: 0,
        timerWord8: 0,
        timerWord6: 0,
    };
}
