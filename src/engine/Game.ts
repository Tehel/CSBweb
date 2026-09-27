/**
 * `Game` — CSBWin's main loop (the VBL-driven tick of `CSBCode.cpp`: `runFrame`,
 * `gameTick`, `tag0006a4`, `HandleMouseEvents` and the mouse queue's front door), the
 * construction of every system over one `GameContext`, and one-line facades for
 * `main.ts`, the UI and `tools/`. Everything else lives in the system that ports its
 * CSBWin file (`DEBT.md` E2).
 */

import type { DungeonData } from '../data/dungeonTypes';
import type { GameState, Champion, PartyState, MovementResult } from './gameTypes';
import { GAME_TIMING, MovementAction } from './gameTypes';
import { Party, ensureHandOwner } from './Party';
import { applyFeedParameters, type FeedParameters } from './Feeding';
import { DungeonState } from './DungeonState';
import { MovementSystem } from './MovementSystem';
import { ActuatorSystem } from './ActuatorSystem';
import { TimerQueue } from './TimerQueue';
import { TimerSystem } from './TimerSystem';
import { WorldMove } from './WorldMove';
import { MissileEncounter } from './MissileEncounter';
import { MonsterSystem } from './MonsterSystem';
import type { SoundQueue } from './SoundQueue';
import { createGameContext, type GameContext, type GameSystems } from './GameContext';
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
import { freeze, setClockTick, thaw, wakeUp } from './LoopState';
import { isNinetySecondTick, isTenSecondTick, ninetySecondUpdate, tenSecondUpdate } from './PeriodicUpdates';
import { DsaSystem, type ViewingFilterOptions, type ViewingFilterResult } from './DsaSystem';
import { Position, type ObjectID } from '../core/types';
import { CsbRandom } from '../core/random';

import { CharacterStats } from './CharacterStats';
import type { GameTables } from './GameTables';

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
    /**
     * The world `MoveObject`: teleporters, pits and stairs for the party, a monster and
     * any object. Public because `tools/` moves things through it directly.
     */
    readonly worldMove: WorldMove;
    /**
     * A missile meeting the party, a monster, a wall or a door, and the clouds and door
     * blows it sets off. Public because `tools/` spies on and calls it directly.
     */
    readonly missileEncounter: MissileEncounter;
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
    private onFrameCallbacks: GameEventCallback[] = [];
    private onMoveCallbacks: MovementCallback[] = [];

    /**
     * `host` is what the engine asks of whoever runs it (`GameHost`); what it leaves out
     * does nothing.
     */
    constructor(dungeonData: DungeonData, tables: GameTables, host: Partial<GameHost> = {}) {
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
        this.worldMove = new WorldMove(ctx);
        this.missileEncounter = new MissileEncounter(ctx);
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
            worldMove: this.worldMove,
            missileEncounter: this.missileEncounter,
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
     * Stop and restart the clock around the save menu (`UIState.onSetPaused`). The game's
     * own stop is the freeze, buttons 147 and 148.
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
     * One VBL of the loop: `vblInterrupt`, then the main loop's pass it wakes — the mouse
     * queue, a game tick if one is due, and a message off the print queue.
     * Public so that `tools/` can step frames at chosen times.
     */
    runFrame(currentTime: number): void {
        this.state.currentTime = currentTime;
        // `checkVBL` runs `vblInterrupt`, then hands the loop its `UIM_VBL`
        // (doc/CSBwin-src/system.cpp:624-630, CSBUI.cpp:1253-1272): the message strip's
        // scroll moves on first. It runs frozen or not, and under the save menu.
        this.ctx.host.messages.vblInterrupt();
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
        // `if (d.ClockRunning == 0) goto tag0007b4;` (doc/CSBwin-src/CSBCode.cpp:765):
        // frozen, the due tick waits, and runs in the frame that thaws.
        const tickDue = this.ctx.loop.clockTickSet || (timeSinceLastTick >= tickInterval && !this.ctx.loop.clockTickCleared);
        if (tickDue && this.ctx.loop.clockRunning) {
            if (!this.state.paused) {
                this.gameTick();
            }
            this.lastTickTime = currentTime;
        }
        // `tag0007c8` (doc/CSBwin-src/CSBCode.cpp:714-721): one print-queue entry a pass,
        // ticked or not, frozen or not. The save menu holds the loop in `DisplayDiskMenu`
        // (`:762`), so it takes none.
        if (!this.state.paused) this.ctx.host.messages.printNextQueued(this.state.tickCount);
        for (const callback of this.onFrameCallbacks) {
            callback(this);
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
        // `d.Time++; ... scrollingText.ClockTick();` (doc/CSBwin-src/CSBCode.cpp:660-677):
        // after the timers, so what they print is placed in this tick.
        this.ctx.host.messages.clockTick(this.state.tickCount);
        // `if ((d.Time&511)==0) NinetySecondUpdate();` and `if ((d.Time & (d.PartySleeping ?
        // 15 : 63)) == 0) TenSecondUpdate();` (doc/CSBwin-src/CSBCode.cpp:680-688).
        if (isNinetySecondTick(this.state.tickCount)) ninetySecondUpdate(this.ctx);
        if (isTenSecondTick(this.state.tickCount, this.party.state.sleeping)) tenSecondUpdate(this.ctx);
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

    /** `MoveParty` (`MovementSystem.moveParty`), then the move listeners (`onMove`). */
    move(action: MovementAction): boolean {
        const result = this.movementSystem.moveParty(action);
        for (const callback of this.onMoveCallbacks) {
            callback(result.success, result);
        }
        return result.success;
    }

    /** The UI's object move, the floor pick-up's `MoveObject` (`MouseSystem.triggerObjectMove`). */
    triggerObjectMove(position: Position, object: ObjectID, place: boolean, unchangedRoom: boolean, facing: number): void {
        this.mouse.triggerObjectMove(position, object, place, unchangedRoom, facing);
    }

    /** `DiscardAllInput` (`MouseQueue.discardAllInput`). */
    discardAllInput(): void {
        this.ctx.mouseQueue.discardAllInput();
    }

    /** Button 145, the sleep icon (`MouseSystem.sleep`). */
    sleep(): boolean {
        return this.mouse.sleep();
    }

    /** `WakeUp` for button 146 (`LoopState.wakeUp`). */
    wakeUp(): void {
        wakeUp(this.ctx);
    }

    /** Button 147, the engine's half (`LoopState.freeze`). */
    freeze(): void {
        freeze(this.ctx);
    }

    /** Button 148, the engine's half (`LoopState.thaw`). */
    thaw(): void {
        thaw(this.ctx);
    }

    /** `d.clockTick = value` from a UI handler (`LoopState.setClockTick`). */
    setClockTick(value: number): void {
        setClockTick(this.ctx, value);
    }

    /** `gameFrozen`: between buttons 147 and 148. */
    isFrozen(): boolean {
        return this.ctx.loop.gameFrozen;
    }

    isPartySleeping(): boolean {
        return this.party.state.sleeping;
    }

    /**
     * `tag0006a4` (doc/CSBwin-src/CSBCode.cpp:615-623): `if (d.newPartyLevel != -1)`,
     * `LoadPartyLevel(...); MoveObject(RN(RNnul), -1, 0, ...); d.newPartyLevel = -1;
     * DiscardAllInput();`. The port has already loaded the level and placed the party
     * there, as soon as it arrived (`WorldMove.arriveOnPartyLevel`, DEBT.md C57), so only
     * the discard is still owed, unless something else changed the party's level (see
     * `loadPartyLevelIfChanged`). Says whether it ran.
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
     *   (`Mouse.cpp:1468-1476`), unless the game is frozen and the head is 148, the thaw
     *   (`thawCommand`, `:1463-1476`): no tick runs while frozen, so the thaw is never
     *   made to wait for one;
     * - it is a step and `d.partyMoveDisableTimer != 0`, or `d.Word11712 != 0` and the
     *   step heads in direction `d.Word11714` (`:1485-1498`) — and everything queued
     *   behind it waits too.
     *
     * The turns and steps are handled here (`TurnParty`, `MoveParty`, `:1550-1570`), the
     * button-up and every other button by `mouseEventHandlers`. Every button stamps
     * `lastTime`; the button-up does not, and lets the next entry follow (`:1523-1549`).
     *
     * Frozen, every entry but 148 is thrown away, one per call, and nothing else happens
     * (`:1433-1444`). `CauseFakeMouseClick`, which follows every take, replays a click
     * the port never defers.
     *
     * Not ported: the stairs buttons `0x1124`/`0x1125`, for want of them in the port.
     */
    private handleMouseEvents(delta: number): number {
        const result = 0;
        const queue = this.ctx.mouseQueue;
        if (queue.count() === 0) return result;
        const frozen = this.ctx.loop.gameFrozen;
        if (frozen && queue.head().num !== 148) {
            queue.take();
            return result;
        }
        const time = this.state.tickCount;
        const thawCommand = frozen && queue.head().num === 148;
        if (this.lastInputTime !== 0 && time < this.lastInputTime + delta && !thawCommand) return result;
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

    /** A pre-built champion joins, as the tools' do (`HallOfChampions.addChampion`). */
    addChampion(champion: Champion): boolean {
        return this.hallOfChampions.addChampion(champion);
    }

    /** Button 160-162 on the potential champion's eye panel (`HallOfChampions`). */
    resurrectReincarnateCancel(button: number): boolean {
        return this.hallOfChampions.resurrectReincarnateCancel(button);
    }

    /** The name-entry screen answered (`HallOfChampions.reincarnateNamed`). */
    reincarnateNamed(chIdx: number, name: string, title: string): void {
        this.hallOfChampions.reincarnateNamed(chIdx, name, title);
    }

    /** `RemoveCharacterPossession` (`CharacterSystem`), for the inventory click and `tools/`. */
    removeCharacterPossession(chIdx: number, slot: number): ObjectID {
        return this.ctx.systems.character.removeCharacterPossession(chIdx, slot);
    }

    /** `AddCharacterPossession` (`CharacterSystem`), for the inventory click and `tools/`. */
    addCharacterPossession(chIdx: number, object: ObjectID, slot: number): void {
        this.ctx.systems.character.addCharacterPossession(chIdx, object, slot);
    }

    /** The apply half of `_FeedCharacter` (`Feeding.applyFeedParameters`), for the UI and `tools/`. */
    applyFeeding(chIdx: number, fp: FeedParameters): boolean {
        return applyFeedParameters(this.ctx, chIdx, fp);
    }

    /**
     * Replace the current party state (debug/testing).
     */
    setPartyState(state: PartyState): void {
        this.party.setState(state);
        ensureHandOwner(this.party.state);
    }




    /** `_ExecuteAttack`'s engine half (`CharacterSystem.executeAttack`), for the UI and `tools/`. */
    championAttack(chIdx: number, attackType: number): number {
        return this.character.executeAttack(chIdx, attackType);
    }

    /** `d.attackDamageToDisplay`, read and cleared (`AttackSystem.consumeAttackDamageToDisplay`). */
    consumeAttackDamageToDisplay(): number {
        return this.attackSystem.consumeAttackDamageToDisplay();
    }

    /**
     * Register callback for game tick
     */
    onTick(callback: GameEventCallback): void {
        this.onTickCallbacks.push(callback);
    }

    /** Called at the end of every frame, whether or not a tick ran in it. */
    onFrame(callback: GameEventCallback): void {
        this.onFrameCallbacks.push(callback);
    }

    /**
     * Register callback for movement
     */
    onMove(callback: MovementCallback): void {
        this.onMoveCallbacks.push(callback);
    }

    /** A click on the wall ahead, `TouchWallF1` (`MouseSystem.handleWallClick`). */
    handleWallClick(): boolean {
        return this.mouse.handleWallClick();
    }

    /** An empty-handed click on the bare stone ahead (`MouseSystem.handleStoneClick`). */
    handleStoneClick(): void {
        this.mouse.handleStoneClick();
    }

    /** A click on a door's button (`MouseSystem.handleDoorSwitchClick`). */
    handleDoorSwitchClick(): boolean {
        return this.mouse.handleDoorSwitchClick();
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
     * The tail of CSBWin's `SaveGame`, once the file is written
     * (`MonsterSystem.reattachAfterSave`). A save that fails skips it: CSBWin's
     * `SaveError` jumps past it (`doc/CSBwin-src/SaveGame.cpp:1264`). The same tail's
     * `SmartDiscard(true)` is not ported (DEBT.md G12).
     */
    saveWritten(): void {
        this.monsterSystem.reattachAfterSave();
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
