/**
 * `Game` — CSBWin's main loop (the VBL-driven tick of `CSBCode.cpp`: `runFrame`,
 * `gameTick`, `tag0006a4`, `HandleMouseEvents` and the mouse queue's front door), the
 * construction of every system over one `GameContext`, and one-line facades for
 * `main.ts`, the UI and `tools/`. Everything else lives in the system that ports its
 * CSBWin file (`DEBT.md` E2).
 */

import type { DungeonData } from '../data/dungeonTypes';
import { DungeonLoader } from '../data/DungeonLoader';
import { readRulesOptions } from '../data/CsbwinExtendedFeatures';
import type { PartyState, MovementResult } from './gameTypes';
import { MovementAction } from './gameTypes';
import { ensureHandOwner } from './Party';
import { MovementSystem } from './MovementSystem';
import { ActuatorSystem } from './ActuatorSystem';
import { TimerSystem } from './TimerSystem';
import { WorldMove } from './WorldMove';
import { MissileEncounter } from './MissileEncounter';
import { MonsterSystem } from './MonsterSystem';
import { createGameContext, type GameContext, type GameSystems } from './GameContext';
import { createGameHost, type GameHost } from './GameHost';
import { applyRuntimeSaveState, getRuntimeSaveState, type RuntimeSaveState } from './RuntimeSave';
import { MonsterPerception } from './MonsterPerception';
import { MonsterDamage } from './MonsterDamage';
import { MonsterAI } from './MonsterAI';
import { MonsterAttack } from './MonsterAttack';
import { AttackSystem } from './AttackSystem';
import { MagicSystem } from './MagicSystem';
import { CharacterSystem } from './CharacterSystem';
import { MouseSystem } from './MouseSystem';
import { HallOfChampions } from './HallOfChampions';
import { MOUSE_UNCLICK, type MouseQueueEntry } from './MouseQueue';
import { createLoopFlags, flashButton, vblFlashButton, waitForButtonFlash, type LoopScript, type MainLoop } from './LoopState';
import { makeMoreRoomInDB } from './MakeMoreRoomInDB';
import { smartDiscard } from './SmartDiscard';
import { isNinetySecondTick, isTenSecondTick, ninetySecondUpdate, tenSecondUpdate } from './PeriodicUpdates';
import { DsaSystem } from './DsaSystem';
import { Position } from '../core/types';
import { TICKS_PER_SECOND } from '../core/constants';

import { CharacterStats } from './CharacterStats';
import { CheckMonsters } from './CheckMonsters';
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

/** `VBLDelay(_1_, 300);  //about 5 seconds` after the CSB win (doc/CSBwin-src/CSBCode.cpp:630). */
export const WON_GAME_VBLS = 300;

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
export class Game implements MainLoop {
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
    /**
     * What every subsystem shares (`GameContext`), created first. The game's state,
     * party, dungeon, timer queue, footprints, sound queue and random stream are its
     * members, and have no other name here: `game.ctx.party`, `game.ctx.timers`.
     */
    readonly ctx: GameContext;
    /**
     * Every subsystem, by the one name each has: the context's (`GameContext.systems`).
     * `tools/` drives and spies on them through it.
     */
    readonly systems: GameSystems;
    /** `d.Word11694`, which lives in `state` (`GameState.gameWon`). */
    get gameWon(): boolean { return this.ctx.state.gameWon; }
    set gameWon(won: boolean) { this.ctx.state.gameWon = won; }

    // Game loop
    private running: boolean = false;
    private lastTickTime: number = 0;
    private loopTimer: ReturnType<typeof setTimeout> | null = null;
    /** `MainLoop` has returned, on the tick of a lost game (see `gameTick`), or won. */
    private mainLoopReturned = false;
    /** The `LoopScript` the loop is held in, or `null` (`runScript`). */
    private script: LoopScript | null = null;
    /** The VBLs left of the `VBLDelay` the script is in. */
    private scriptDelay = 0;
    /** This VBL's tick asked for a put-back before `TAG01b29a` drew (`paintHeld`). */
    private paintIsHeld = false;
    /**
     * `d.CanRestartFromSavegame`: set by a save and by a load, cleared by a new game and by
     * the CSB win. With it, the end of a lost game offers "RESTART THIS GAME"
     * (`ShowCredits.ts`).
     */
    private canRestart = false;

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
        // `_ReadEntireGame`'s `CheckMonsters` (doc/CSBwin-src/SaveGame.cpp:1826), which a
        // new game's read runs and the loader cannot: it needs the monster table.
        CheckMonsters(ctx.dungeon, tables.monsterDesc, (line) => ctx.host.trace(line));
        this.ctx = ctx;
        ctx.dungeon.makeMoreRoomInDB = (db) => makeMoreRoomInDB(ctx, db);
        Object.assign(ctx.systems, {
            actuators: new ActuatorSystem(ctx),
            dsa: new DsaSystem(ctx),
            timer: new TimerSystem(ctx),
            worldMove: new WorldMove(ctx),
            missileEncounter: new MissileEncounter(ctx),
            monsters: new MonsterSystem(ctx),
            monsterDamage: new MonsterDamage(ctx),
            monsterPerception: new MonsterPerception(ctx),
            monsterAttack: new MonsterAttack(ctx),
            monsterAI: new MonsterAI(ctx),
            characterStats: new CharacterStats(ctx),
            attack: new AttackSystem(ctx),
            movement: new MovementSystem(ctx),
            magic: new MagicSystem(ctx),
            character: new CharacterSystem(ctx),
            mouse: new MouseSystem(ctx),
            hallOfChampions: new HallOfChampions(ctx),
            mainLoop: this,
        } satisfies GameSystems);
        this.systems = ctx.systems;
    }

    /** Pin `d.RandomNumber`. For tools and, eventually, save-game restore. */
    setRandomSeed(seed: number): void {
        this.ctx.random.setSeed(seed);
    }

    /**
     * Start the game loop
     */
    start(): void {
        if (this.running) {
            return;
        }

        this.running = true;
        this.lastTickTime = Date.now();

        // Start game loop
        this.gameLoop();
    }

    /**
     * Stop the game loop
     */
    stop(): void {
        this.running = false;

        if (this.loopTimer !== null) {
            clearTimeout(this.loopTimer);
            this.loopTimer = null;
        }
    }

    /** Whether `MainLoop` has returned: the game is over, and the page's input is dead. */
    mainLoopHasReturned(): boolean {
        return this.mainLoopReturned;
    }

    /**
     * `_ReadEntireGame` for a new game: `dungeon.dat` read into the running game, through
     * the path a save takes (doc/CSBwin-src/SaveGame.cpp:1480-1494). `data` must be a
     * fresh parse of the file, since play writes into the `DungeonData` it runs on. The
     * running game takes it as its world (`installWorld`), and a scratch `Game` over it
     * gives the rest of a new game, the party at the start, the clock and the timers,
     * which a load restores here, so every system keeps its object and the page its
     * wiring.
     */
    readNewGame(data: DungeonData): void {
        const fresh = new Game(data, this.ctx.tables);
        // `totalMoveCount` is a global, not `d.`'s (`doc/CSBwin-src/data.cpp:253`), so
        // `d.Initialize()` leaves it and the new game counts on from the last one.
        const { totalMoveCount } = this.ctx.state.block1;
        this.installWorld(data);
        this.applyRuntimeSaveState(fresh.getRuntimeSaveState());
        this.ctx.state.block1.totalMoveCount = totalMoveCount;
        this.readNewGameRules(data);
        this.canRestart = false;
    }

    /**
     * `_ReadEntireGame` for a new game from the bytes of `dungeon.dat`: false when
     * `ReadDatabases` fails (doc/CSBwin-src/SaveGame.cpp:1740-1742), and the read then ends
     * at `tag01efee`, the boot's (`src/renderer/intro/BootSequence.ts`). The parse fails
     * before anything is installed, so the running game is left as it was.
     */
    readDungeonDat(bytes: Uint8Array): boolean {
        let data: DungeonData;
        try {
            data = new DungeonLoader().loadDungeonDat(bytes);
        } catch (error) {
            this.ctx.host.trace(`dungeon.dat failed its read: ${error}`);
            return false;
        }
        this.readNewGame(data);
        return true;
    }

    /**
     * Take `data` as the world, whole: `_ReadEntireGame` reads the structure with the rest,
     * the header, every level's descriptor and tables, from the file it opens
     * (`ReadDatabases`, doc/CSBwin-src/SaveGame.cpp:2324). `DungeonState` keeps its object,
     * which every system and the renderer hold, and takes the new data; `state.dungeon`
     * follows. A read installs its world before it restores the state that goes with it
     * (`applyRuntimeSaveState`), whose snapshot must then fit.
     */
    installWorld(data: DungeonData): void {
        this.ctx.state.dungeon = data;
        this.ctx.dungeon.install(data);
    }

    /**
     * `ReadExtendedFeatures`' rule flags for a new game, from the block its `dungeon.dat`
     * opens with (doc/CSBwin-src/SaveGame.cpp:392-398, read at `ReadDatabases`' start,
     * `:2347`). A file with no block leaves the rules as they were.
     */
    private readNewGameRules(data: DungeonData): void {
        readRulesOptions(this.ctx.rules, data.extendedFeatures);
    }

    /**
     * `_ShowPrisonDoor` once `GameSetup` has read the game, new or resumed:
     * `if (DMRulesDesignOption) DM_rules = true` (doc/CSBwin-src/CSBCode.cpp:10672-10676).
     * The boot's alone: the restart after a lost game calls `GameSetup` straight
     * (`Code1f9e6.cpp:310`) and does not force it.
     */
    forceDMRulesAtBoot(): void {
        if (this.ctx.rules.dmRulesDesignOption) this.ctx.rules.dmRules = true;
    }

    /**
     * The tail of `_ReadEntireGame` once a saved game is in: `d.CanRestartFromSavegame = 1`
     * (doc/CSBwin-src/SaveGame.cpp:1883). `applySaveBytes` calls it.
     */
    savedGameRead(): void {
        this.canRestart = true;
    }

    /** `d.CanRestartFromSavegame`. */
    canRestartFromSavegame(): boolean {
        return this.canRestart;
    }

    /** `d.CanRestartFromSavegame = 0`, as `_FusionSequence` ends (doc/CSBwin-src/Attack.cpp:2428). */
    clearCanRestartFromSavegame(): void {
        this.canRestart = false;
    }

    /**
     * `_StartCSB` calls `MainLoop` again once `ShowCredits` returns from a restart
     * (doc/CSBwin-src/CSBCode.cpp:11320-11327). The loop's state is `d`'s, which
     * `d.Initialize()` has reset (`Code1f9e6.cpp:309`), and the input goes
     * (`DiscardAllInput`, `:321`). The page starts the loop (`start`).
     */
    resumeMainLoop(): void {
        Object.assign(this.ctx.loop, createLoopFlags());
        this.script = null;
        this.ctx.mouseQueue.discardAllInput();
        this.mainLoopReturned = false;
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
     *
     * A frame that throws is CSBWin's `die`: the loop stops, and the host reports it.
     */
    private gameLoop = (): void => {
        if (!this.running) {
            return;
        }

        try {
            this.runFrame(Date.now());
        } catch (error) {
            this.stop();
            this.ctx.host.die(error);
            return;
        }

        // Schedule next frame (60 FPS)
        this.loopTimer = setTimeout(this.gameLoop, 1000 / 60);
    };

    /**
     * One VBL of the loop: `vblInterrupt`, then the main loop's pass it wakes — the mouse
     * queue, a game tick if one is due, and a message off the print queue.
     * Public so that `tools/` can step frames at chosen times.
     */
    runFrame(currentTime: number): void {
        // Nothing of the loop runs once `MainLoop` has returned: `ShowCredits` has the screen.
        if (this.mainLoopReturned) return;
        this.paintIsHeld = false;
        if (this.script !== null) {
            // A script's `VBLDelay` (`wvbl`, doc/CSBwin-src/CSBCode.cpp:1137-1147): the VBLs
            // go by, with their `vblInterrupt`, and the loop makes no pass. The last one
            // resumes the script, up to its next delay.
            this.ctx.host.messages.vblInterrupt();
            vblFlashButton(this.ctx.loop);
            for (const callback of this.onFrameCallbacks) callback(this);
            if (--this.scriptDelay === 0) this.resumeScript();
            return;
        }
        // `checkVBL` runs `vblInterrupt`, then hands the loop its `UIM_VBL`
        // (doc/CSBwin-src/system.cpp:624-630, CSBUI.cpp:1253-1272): the message strip's
        // scroll moves on first, then the button flash (`:1028-1038`). It runs frozen or
        // not, and under the save menu.
        this.ctx.host.messages.vblInterrupt();
        vblFlashButton(this.ctx.loop);
        this.ctx.loop.clockTickCleared = false;
        // `do { HandleMouseEvents(_7_, 1); ... } while (intResult & 1);`
        // (doc/CSBwin-src/CSBCode.cpp:746-761): again while an entry lets the next follow.
        while (this.handleMouseEvents(1) & 1 && this.script === null) { /* the next entry, in the same pass */ }
        // A handler has started a script (the fusion): the pass is held inside it.
        if (this.script !== null) return;

        // Calculate time since last tick
        const timeSinceLastTick = currentTime - this.lastTickTime;
        // `d.Speed = 0` while the party sleeps (doc/CSBwin-src/Mouse.cpp:1697), and the
        // VBL raises `clockTick` once `vblCount >= d.Speed` (`CSBCode.cpp:1066-1077`) —
        // so asleep, a tick is due on every VBL.
        const tickInterval = this.ctx.party.state.sleeping ? 0 : 1000 / TICKS_PER_SECOND;

        // Process game ticks
        // `if (d.ClockRunning == 0) goto tag0007b4;` (doc/CSBwin-src/CSBCode.cpp:765):
        // frozen, the due tick waits, and runs in the frame that thaws.
        const tickDue = this.ctx.loop.clockTickSet || (timeSinceLastTick >= tickInterval && !this.ctx.loop.clockTickCleared);
        // `if (d.clockTick == 0) WaitForButtonFlash();` (doc/CSBwin-src/CSBCode.cpp:763).
        if (!tickDue) waitForButtonFlash(this.ctx);
        if (tickDue && this.ctx.loop.clockRunning) {
            if (!this.ctx.state.paused) {
                this.gameTick();
            }
            this.lastTickTime = currentTime;
            // Won: `MainLoop` is in its `VBLDelay`, and this pass goes no further.
            if (this.script !== null) return;
        }
        // `tag0007c8` (doc/CSBwin-src/CSBCode.cpp:714-721): one print-queue entry a pass,
        // ticked or not, frozen or not. The save menu holds the loop in `DisplayDiskMenu`
        // (`:762`), so it takes none.
        if (!this.ctx.state.paused) this.ctx.host.messages.printNextQueued(this.ctx.state.tickCount);
        for (const callback of this.onFrameCallbacks) {
            callback(this);
        }
    }

    /**
     * Process one game tick (~4 times per second)
     */
    private gameTick(): void {
        // The top of a tick, then `ProcessTimers()` and `if (d.newPartyLevel != -1) goto
        // tag0006a4;` (doc/CSBwin-src/CSBCode.cpp:615-635): a timer that moved the party
        // to another level has it loaded, input discarded and the timers run again, all
        // in this tick.
        this.loadNewPartyLevel();
        do {
            if (this.systems.timer.processTimers()) {
                // "Game has been won." (doc/CSBwin-src/CSBCode.cpp:627-633)
                this.runScript(this.wonByTimers());
                return;
            }
        } while (this.loadNewPartyLevel());
        // `DrawViewport(d.partyFacing, d.partyX, d.partyY)` (doc/CSBwin-src/CSBCode.cpp:638):
        // the tick's redraw comes after the timers and after a new party level is loaded,
        // so a step down the stairs never draws the new square on the old level.
        for (const callback of this.onTickCallbacks) {
            callback(this);
        }
        // `tag000730: WaitForButtonFlash();` (doc/CSBwin-src/CSBCode.cpp:653-655), asleep
        // or not. CSBWin waits there for the VBL that puts the flashed rectangle back;
        // the port's pass does not (`DEBT.md` H), so whether it asked for one is kept.
        waitForButtonFlash(this.ctx);
        const putBackAsked = this.ctx.loop.flashButnActive;
        // `StartQueuedSound(); DisplayCharacterDamage();` (doc/CSBwin-src/CSBCode.cpp:656-657):
        // what `DamageCharacter` dealt since the last tick comes off the HP, and a champion
        // it kills can lose the game just below.
        this.ctx.systems.monsterAttack.displayCharacterDamage();
        // `tag000730`: `if (d.GameIsLost == 0) { d.Time++; … goto tag000698; } RETURN;`
        // (doc/CSBwin-src/CSBCode.cpp:658-778). With nobody left alive the rest of the tick
        // does not run, and `MainLoop` returns to `_StartCSB`, which shows the credits
        // (`:11322-11326`).
        if (this.ctx.party.state.gameIsLost) {
            this.mainLoopReturned = true;
            this.stop();
            this.ctx.host.showCredits(this.ctx.state.gameWon);
            return;
        }
        // `d.Time++; ... scrollingText.ClockTick();` (doc/CSBwin-src/CSBCode.cpp:660-677):
        // after the timers, so they ran on the `d.Time` the mouse handlers saw since the
        // last tick, and what they printed is placed in this tick.
        this.advanceTime();
        this.ctx.host.messages.clockTick(this.ctx.state.tickCount);
        // `SmartDiscard(false);` (doc/CSBwin-src/CSBCode.cpp:678).
        smartDiscard(this.ctx, false);
        // `if ((d.Time&511)==0) NinetySecondUpdate();` (doc/CSBwin-src/CSBCode.cpp:680-683).
        if (isNinetySecondTick(this.ctx.state.tickCount)) ninetySecondUpdate(this.ctx);
        // `if (d.freezeLifeTimer != 0) d.freezeLifeTimer--;` — one per game tick
        // (doc/CSBwin-src/CSBCode.cpp:684).
        if (this.ctx.party.state.freezeLifeTimer !== 0) this.ctx.party.state.freezeLifeTimer--;
        // `TAG01b29a(_4_);` (doc/CSBwin-src/CSBCode.cpp:685). What it draws is painted in
        // this tick, unless a put-back was asked above: CSBWin draws it only after that
        // VBL, so the port paints it at the put-back's redraw, and the frame shows the
        // tick's `DrawViewport` until then (`paintHeld`).
        this.ctx.host.tag01b29a();
        if (putBackAsked) this.paintIsHeld = true;
        else this.ctx.host.paint();
        // `if ((d.Time & (d.PartySleeping ? 15 : 63)) == 0) TenSecondUpdate();` (`:686-688`).
        if (isTenSecondTick(this.ctx.state.tickCount, this.ctx.party.state.sleeping)) tenSecondUpdate(this.ctx);
        // `if (d.partyMoveDisableTimer != 0) d.partyMoveDisableTimer--;` and the same for
        // `d.Word11712` (doc/CSBwin-src/CSBCode.cpp:689-695).
        if (this.ctx.party.state.partyMoveDisableTimer !== 0) this.ctx.party.state.partyMoveDisableTimer--;
        if (this.ctx.party.state.word11712 !== 0) this.ctx.party.state.word11712--;
        // `d.clockTick=0;` (doc/CSBwin-src/CSBCode.cpp:704).
        this.ctx.loop.clockTickSet = false;
    }

    /**
     * `ShowCredits(1)` once `ProcessTimers` has won the game, by the loop's tick
     * (`MainLoop`, doc/CSBwin-src/CSBCode.cpp:627-633) or a script's
     * (`_ProcessTimersViewportAndSound`, Attack.cpp:2199-2204): `VBLDelay(300)`, then the
     * credits. `ProcessTT_STONEROOM`'s actuator type 18 has set `d.Word11694` and cleared
     * `d.CanRestartFromSavegame`, which is kept here (`Timer.cpp:2370-2371`).
     */
    private *wonByTimers(): LoopScript {
        this.canRestart = false;
        yield WON_GAME_VBLS;
        yield* this.showCreditsAndEnd();
    }

    /**
     * `ShowCredits(n, 1)` from inside the loop: `MainLoop` is over, and the host shows the
     * end of the game. `ShowCredits` never returns, so neither does this: the script is
     * never resumed.
     */
    *showCreditsAndEnd(): LoopScript {
        this.mainLoopReturned = true;
        this.stop();
        this.ctx.host.showCredits(this.ctx.state.gameWon);
        yield Infinity;
    }

    /**
     * Hold the loop in `script`: run it now, up to its first `VBLDelay`, and let `runFrame`
     * run the rest in place of its passes. The caller returns at once, as the pass that
     * called a `RESTARTABLE` sequence is suspended inside it.
     */
    runScript(script: LoopScript): void {
        this.script = script;
        this.resumeScript();
    }

    /** Whether the loop is held in a script (`runScript`). */
    isRunningScript(): boolean {
        return this.script !== null;
    }

    /** Run the script up to its next `VBLDelay` of one VBL or more; a `VBLDelay(0)` waits for none. */
    private resumeScript(): void {
        const script = this.script!;
        for (;;) {
            const step = script.next();
            if (step.done) {
                this.script = null;
                return;
            }
            if (step.value > 0) {
                this.scriptDelay = step.value;
                return;
            }
        }
    }

    /**
     * `_ProcessTimersViewportAndSound` (doc/CSBwin-src/Attack.cpp:2192), the tick a script
     * runs between its `VBLDelay`s: `ProcessTimers`, and a win there ends the game
     * (`wonByTimers`); then `d.Time++` and `scrollingText.ClockTick()`. Not the rest of the
     * main loop's tick: no input, no periodic update, no print-queue entry. `DrawViewport` and
     * `display` are the host's `drawViewport`. `StartQueuedSound` has no counterpart: it
     * plays nothing, since `d.CurrentSound` stays -1 once `QueueSound`'s assignment is
     * commented out (`doc/CSBwin-src/CSBCode.cpp:1906`) and `QueueSound` calls `StartSound`
     * itself. Nor have the overlay's timeout and `parameterMessageSequence`, which the port does not model.
     */
    *processTimersViewportAndSound(): LoopScript {
        if (this.systems.timer.processTimers()) {
            yield* this.wonByTimers();
        }
        this.ctx.host.drawViewport();
        this.advanceTime();
        this.ctx.host.messages.clockTick(this.ctx.state.tickCount);
    }

    /**
     * `d.Time++`, after the timers, in the main loop's tick (doc/CSBwin-src/CSBCode.cpp:660)
     * and in `_ProcessTimersViewportAndSound` (`Attack.cpp:2208`).
     */
    private advanceTime(): void {
        this.ctx.state.tickCount++;
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

    /** Who handles the buttons that are not movement (see `MouseEventHandlers`). */
    setMouseEventHandlers(handlers: MouseEventHandlers | null): void {
        this.mouseEventHandlers = handlers;
    }

    /** `MoveParty` (`MovementSystem.moveParty`), then the move listeners (`onMove`). */
    move(action: MovementAction): boolean {
        const result = this.systems.movement.moveParty(action);
        for (const callback of this.onMoveCallbacks) {
            callback(result.success, result);
        }
        return result.success;
    }

    /** `DiscardAllInput` (`MouseQueue.discardAllInput`). */
    discardAllInput(): void {
        this.ctx.mouseQueue.discardAllInput();
    }

    /** `gameFrozen`: between buttons 147 and 148. */
    isFrozen(): boolean {
        return this.ctx.loop.gameFrozen;
    }

    isPartySleeping(): boolean {
        return this.ctx.party.state.sleeping;
    }

    /**
     * `tag0006a4` (doc/CSBwin-src/CSBCode.cpp:615-623): `if (d.newPartyLevel != -1)`,
     * `LoadPartyLevel(d.newPartyLevel)`, whose `SetPartyLevel` moves `d.partyLevel` on
     * (`:5793`), then `MoveObject(RN(RNnul), -1, 0, d.partyX, d.partyY)`, which takes the
     * party through the square it stands on again, leaves a second footprint and presses
     * the pads, then `d.newPartyLevel = -1; DiscardAllInput();`. A party put on another
     * level by hand, as a tool does, has that level loaded and the input discarded
     * (`loadPartyLevelIfChanged`). Says whether it ran. Public so that `tools/` can run
     * the top of a tick alone.
     */
    loadNewPartyLevel(): boolean {
        const level = this.ctx.loop.newPartyLevel;
        if (level === -1) {
            if (!this.systems.monsters.loadPartyLevelIfChanged()) return false;
        } else {
            const party = this.ctx.party.state;
            party.position = new Position(party.position.x, party.position.y, level);
            this.systems.monsters.loadPartyLevel(level);
            this.ctx.systems.worldMove.moveParty(-1, 0, party.position.x, party.position.y);
            this.ctx.loop.newPartyLevel = -1;
        }
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
     * A handler that starts a script stamps it at once, not when the script ends
     * (`DEBT.md` H, "A script's caller finishes at once").
     *
     * Frozen, every entry but 148 is thrown away, one per call, and nothing else happens
     * (`:1433-1444`). `CauseFakeMouseClick`, which follows every take, replays a click
     * the port never defers.
     *
     * Not ported: the vertical-move buttons `0x1124`/`0x1125` and the gravity hook
     * (`DEBT.md` X5).
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
        const time = this.ctx.state.tickCount;
        const thawCommand = frozen && queue.head().num === 148;
        if (this.lastInputTime !== 0 && time < this.lastInputTime + delta && !thawCommand) return result;
        const entry = queue.head();
        const num = entry.num;
        const party = this.ctx.party.state;
        if (num >= 3 && num <= 6 && (
            party.partyMoveDisableTimer !== 0 ||
            (party.word11712 !== 0 && ((party.facing + num - 3) & 3) === party.word11714)
        )) return result;
        queue.take();
        // `RecordFile_Record(&pMouseQueue[d.MouseQStart])` (doc/CSBwin-src/Mouse.cpp:1506),
        // the entry's one count in `totalMoveCount` (`Recording.cpp:1011-1019`). A viewport
        // click, button 80, is recorded by `HandleClickInViewport` instead, exactly once on
        // each of its paths, and it runs whenever `d.ClockRunning`, which is 0 only while
        // frozen, when this entry would have been discarded above (`Mouse.cpp:1665-1668`).
        this.recordFileRecord(entry);
        if (num === MOUSE_UNCLICK) {
            this.mouseEventHandlers?.unclick();
            return result | 1;
        }
        const action = BUTTON_MOVEMENT[num];
        if (action !== undefined) {
            this.move(action);
            // `pButton = MoveParty(D6W); if (pButton != NULL) FlashButton(…)`
            // (doc/CSBwin-src/Mouse.cpp:1556-1567): a step's arrow, `d.MoveButn18496[button
            // - 3]`, which `MoveParty` returns unless a party-move filter refused the step
            // (`CSBCode.cpp:8120`, `:8137-8139`; the filter is `DEBT.md` G2). A turn
            // flashes its own, in `_TurnParty`.
            if (num >= 3 && num <= 6) {
                const button = this.ctx.tables.moveButtons[num - 3]!;
                flashButton(this.ctx, button.x1, button.x2, button.y1, button.y2);
            }
        } else {
            this.mouseEventHandlers?.button(num, entry.x, entry.y);
        }
        this.lastInputTime = time;
        return result;
    }

    /**
     * The count in `RECORDFILE::Record(MouseQueueEnt *)` (doc/CSBwin-src/Recording.cpp:1011-1019):
     * `totalMoveCount` goes up for every entry below 0x2000 except the no-op, button 0x64
     * at (0x114, 0x2f). The recording file itself is not ported.
     */
    private recordFileRecord(entry: MouseQueueEntry): void {
        if (entry.num === 0x64 && entry.x === 0x114 && entry.y === 0x2f) return;
        if (entry.num < 0x2000) this.ctx.state.block1.totalMoveCount++;
    }

    /**
     * Replace the current party state (debug/testing).
     */
    setPartyState(state: PartyState): void {
        this.ctx.party.setState(state);
        ensureHandOwner(this.ctx.party.state);
    }

    /**
     * Register a callback for each game tick, run where CSBWin's tick draws the viewport:
     * after the timers and any new party level (doc/CSBwin-src/CSBCode.cpp:615-638).
     */
    onTick(callback: GameEventCallback): void {
        this.onTickCallbacks.push(callback);
    }

    /** Whether a VBL inverted the flashed rectangle since the last call: a redraw is due. */
    takeFlashChanged(): boolean {
        const changed = this.ctx.loop.flashChanged;
        this.ctx.loop.flashChanged = false;
        return changed;
    }

    /**
     * Whether nothing more is to be painted in this VBL: its tick asked the next VBL to put
     * a flashed rectangle back, and `TAG01b29a` has drawn since. The put-back's redraw
     * paints it (`takeFlashChanged`).
     */
    paintHeld(): boolean {
        return this.paintIsHeld;
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

    // Get position info for debugging
    getPositionInfo = () => this.systems.movement.getPositionInfo();

    // Get tick count
    getTickCount = () => this.ctx.state.tickCount;

    /**
     * The DSA global variables, where a dungeon keeps its puzzle progress. Public so a
     * loader that cannot read a save's own copy of them can keep the ones in play
     * rather than clear them (`src/data/CsbwinSaveGame.ts`).
     */
    getDsaGlobalVariables(): number[] {
        return this.systems.dsa.getGlobalVariables();
    }

    /** The quick-save's snapshot (`RuntimeSave.getRuntimeSaveState`). */
    getRuntimeSaveState(): RuntimeSaveState {
        return getRuntimeSaveState(this.ctx);
    }

    /**
     * The tail of CSBWin's `SaveGame`, once the file is written
     * (`MonsterSystem.reattachAfterSave`). A save that fails skips it: CSBWin's
     * `SaveError` jumps past it (`doc/CSBwin-src/SaveGame.cpp:1264`). The same tail
     * starts `SmartDiscard` over (`:1245`), and ends in `d.CanRestartFromSavegame = 1`
     * (`:1260`).
     */
    saveWritten(): void {
        this.systems.monsters.reattachAfterSave();
        smartDiscard(this.ctx, true);
        this.canRestart = true;
    }

    /**
     * Restore a quick-save (`RuntimeSave.applyRuntimeSaveState`), then the loop's own
     * reset: `HandleMouseEvents(_16_, -999887)` — `lastTime = 0`
     * (doc/CSBwin-src/SaveGame.cpp:1661, `Mouse.cpp:1372-1376`). Every game read comes
     * through here, and `_GameSetup` follows each `ReadEntireGame` with
     * `SmartDiscard(true)` (`CSBCode.cpp:10635-10636`).
     */
    applyRuntimeSaveState(save: RuntimeSaveState): void {
        applyRuntimeSaveState(this.ctx, save);
        this.lastInputTime = 0;
        smartDiscard(this.ctx, true);
    }
}
