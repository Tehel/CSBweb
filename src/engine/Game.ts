/**
 * Main game class
 *
 * Ties together all game systems and implements game loop
 * Based on CSBWin's VBL-driven game loop
 */

import type { DungeonData } from '../data/dungeonTypes';
import type { GameState, Champion, PartyState, MovementResult } from './gameTypes';
import { GAME_TIMING, MovementAction } from './gameTypes';
import { Party, ensureHandOwner, setHandOwner } from './Party';
import { applyFeedParameters, type FeedParameters } from './Feeding';
import { DungeonState } from './DungeonState';
import { MovementSystem } from './MovementSystem';
import { ActuatorSystem } from './ActuatorSystem';
import { TimerQueue, TimerFunction } from './TimerQueue';
import { TimerSystem } from './TimerSystem';
import { MonsterSystem } from './MonsterSystem';
import type { SoundQueue } from './SoundQueue';
import { createGameContext, nameIndexOf, type GameContext, type GameSystems } from './GameContext';
import { createGameHost, type GameHost } from './GameHost';
import { PartyFootprints } from './PartyFootprints';
import { applyRuntimeSaveState, getRuntimeSaveState, type RuntimeSaveState } from './RuntimeSave';
import { MonsterPerception } from './MonsterPerception';
import { MonsterDamage } from './MonsterDamage';
import { MonsterAI } from './MonsterAI';
import { MonsterAttack } from './MonsterAttack';
import { AttackSystem } from './AttackSystem';
import { MagicSystem } from './MagicSystem';
import { CharacterSystem } from './CharacterSystem';
import { MouseSystem, type DropCursorOptions } from './MouseSystem';
import { HallOfChampions } from './HallOfChampions';
import { MOUSE_UNCLICK } from './MouseQueue';
import { wakeUp } from './LoopState';
import { DsaSystem, type ViewingFilterOptions, type ViewingFilterResult } from './DsaSystem';
import { determineMastery, ensureSkills } from './skills';
import { decodeObjectID, OBJECT_ID_EOF, OBJECT_ID_NULL, Position, RoomType, type ObjectID } from '../core/types';
import { SoundIndex } from '../core/constants';
import { CsbRandom } from '../core/random';
import { sw } from '../core/intCast';
import { GetBasicObjectType } from './objectIndex';

import { ActuatorAction } from '../data/actuatorHelpers';
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
    championAttribute,
    incrAttributeCurrent,
} from './attributes';
import { computeChampionFingerprint } from './AddCharacter';

/**
 * Game event callback types
 */
export type GameEventCallback = (game: Game) => void;
export type MovementCallback = (success: boolean, result?: MovementResult) => void;

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
    /** `Mouse.cpp`'s engine half: the cursor's drop and throw, `ThrowByCharacter`. */
    readonly mouse: MouseSystem;
    /** `AddCharacter`, `_ResurrectReincarnateCancel`, `ReIncarnate`'s tail. */
    readonly hallOfChampions: HallOfChampions;
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
    /**
     * `GetObjectWeight` / `MaxLoad` / `DetermineThrowingDistance` / `Quickness`
     * (`src/engine/CharacterStats.ts`). Public because the throw path, the armour
     * calculation and `tools/` all reach it.
     */
    readonly characterStats: CharacterStats;

    // Game loop
    private running: boolean = false;
    private lastTickTime: number = 0;
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
        this.mouse = new MouseSystem(ctx);
        this.hallOfChampions = new HallOfChampions(ctx);

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
            mouse: this.mouse,
            hallOfChampions: this.hallOfChampions,
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
        this.ctx.loop.clockTickCleared = false;
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
        if (this.ctx.loop.clockTickSet || (timeSinceLastTick >= tickInterval && !this.ctx.loop.clockTickCleared)) {
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
        this.ctx.loop.clockTickSet = false;
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
        return this.ctx.mouseQueue.enqueueKey(num);
    }

    /**
     * The queueing half of `OnMouseClick` (doc/CSBwin-src/CSBCode.cpp:7607): the caller
     * has already searched the UI's button lists (`SearchButtonList`) for `num`. Queued
     * only while fewer than `MOUSEQLEN-2` entries wait — there must be room left for the
     * button-up — and never for a click that hit no button (`:7626-7690`). Says whether
     * it was queued.
     */
    onMouseClick(num: number, x: number, y: number): boolean {
        return this.ctx.mouseQueue.enqueueClick(num, x, y);
    }

    /**
     * `OnMouseUnClick` (doc/CSBwin-src/CSBCode.cpp:7581): the button-up, `0x0add`, queued
     * while fewer than `MOUSEQLEN-1` entries wait — whether or not its click was.
     */
    onMouseUnClick(): void {
        this.ctx.mouseQueue.enqueueUnClick();
    }

    /** `numEnt`: how many entries wait in the mouse queue (doc/CSBwin-src/CSBCode.cpp:7589-7590). */
    queuedInputCount(): number {
        return this.ctx.mouseQueue.count();
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
            this.timerSystem.notePartyMoved();
            this.monsterSystem.loadPartyLevelOnArrival();
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
                this.ctx.loop.clockTickCleared = true;
                this.ctx.loop.clockTickSet = false;
            }
            // Notify callbacks of failure
            for (const callback of this.onMoveCallbacks) {
                callback(false, result);
            }

            return false;
        }
    }

    /**
     * The UI's object drop: `ActuatorSystem.triggerObjectMove` (`PlaceOrRemoveObjectInRoom`),
     * then whatever it set in motion — a level change, the timers it queued.
     */
    triggerObjectMove(position: Position, object: ObjectID, place: boolean, unchangedRoom: boolean, facing: number): void {
        this.actuators.triggerObjectMove(position, object, place, unchangedRoom, facing);
        this.monsterSystem.loadPartyLevelOnArrival();
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

    /** `DiscardAllInput` (`MouseQueue.discardAllInput`). */
    discardAllInput(): void {
        this.ctx.mouseQueue.discardAllInput();
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

    /** `WakeUp` for button 146 (`LoopState.wakeUp`). */
    wakeUp(): void {
        wakeUp(this.ctx);
    }

    isPartySleeping(): boolean {
        return this.party.state.sleeping;
    }

    /** Tell the host `d.PartySleeping` changed (see `sleep`; `wakeUp` tells it itself). */
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
        if (!this.monsterSystem.loadPartyLevelIfChanged() && !this.ctx.loop.newPartyLevel) return false;
        this.ctx.loop.newPartyLevel = false;
        this.discardAllInput();
        return true;
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
        const queue = this.ctx.mouseQueue;
        if (queue.count() === 0) return result;
        const time = this.state.tickCount;
        if (this.lastInputTime !== 0 && time < this.lastInputTime + delta) return result;
        const entry = queue.head();
        const num = entry.num;
        const party = this.party.state;
        if (num >= 3 && num <= 6 && (
            party.partyMoveDisableTimer !== 0 ||
            (party.word11712 !== 0 && ((party.facing + num - 3) & 3) === party.word11714)
        )) return result;
        queue.take();
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

    /** Button 160-162 on the potential champion's eye panel (`HallOfChampions`). */
    resurrectReincarnateCancel(button: number): boolean {
        return this.hallOfChampions.resurrectReincarnateCancel(button);
    }

    /** The name-entry screen answered (`HallOfChampions.reincarnateNamed`). */
    reincarnateNamed(chIdx: number, name: string, title: string): void {
        this.hallOfChampions.reincarnateNamed(chIdx, name, title);
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

    /** `DropObject` (`MouseSystem.dropObjectFromCursor`), for the UI and `tools/`. */
    dropObjectFromCursor(relativePos: number, options?: DropCursorOptions): boolean {
        return this.mouse.dropObjectFromCursor(relativePos, options);
    }

    /** `ThrowObjectInHand` (`MouseSystem.throwObjectFromCursor`), for the UI and `tools/`. */
    throwObjectFromCursor(leftOrRight: number): boolean {
        return this.mouse.throwObjectFromCursor(leftOrRight);
    }


    /** The magic panel's cast button (`MagicSystem.castSpellFromUi`). */
    castSpellFromUi(chIdx: number, incantation: number[]): number {
        return this.magic.castSpellFromUi(chIdx, incantation);
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

    /** The quick-save's snapshot (`RuntimeSave.getRuntimeSaveState`). */
    getRuntimeSaveState(): RuntimeSaveState {
        return getRuntimeSaveState(this.ctx);
    }

    /**
     * Restore a quick-save (`RuntimeSave.applyRuntimeSaveState`), then the loop's own
     * reset: `HandleMouseEvents(_16_, -999887)` — `lastTime = 0`
     * (doc/CSBwin-src/SaveGame.cpp:1661, `Mouse.cpp:1372-1376`).
     */
    applyRuntimeSaveState(save: RuntimeSaveState): void {
        applyRuntimeSaveState(this.ctx, save);
        this.lastInputTime = 0;
    }
}
