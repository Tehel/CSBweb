/**
 * `Game` — CSBWin's main loop (the VBL-driven tick of `CSBCode.cpp`: `runFrame`,
 * `gameTick`, `tag0006a4`, `HandleMouseEvents` and the mouse queue's front door), the
 * construction of every system over one `GameContext`, and one-line facades for
 * `main.ts`, the UI and `tools/`. Everything else lives in the system that ports its
 * CSBWin file (`DEBT.md` E2).
 */

import type { DungeonData } from '../data/dungeonTypes';
import { DungeonLoader } from '../data/DungeonLoader';
import { readDeleteDuplicateTimers, readDisableSaves, readGlobalVariables } from '../data/CsbwinExpool';
import { Die, die } from './Die';
import { readGame } from './ReadGame';
import type { PartyState, MovementResult } from './gameTypes';
import { MovementAction } from './gameTypes';
import { ensureHandOwner } from './Party';
import { MovementSystem } from './MovementSystem';
import { ActuatorSystem } from './ActuatorSystem';
import { TimerSystem } from './TimerSystem';
import { WorldMove } from './WorldMove';
import { MissileEncounter } from './MissileEncounter';
import { MonsterSystem, newItem16Pool } from './MonsterSystem';
import { createGameContext, newGameState, type GameContext, type GameSystems } from './GameContext';
import { createInterfaceState } from './InterfaceState';
import { createGameHost, type GameHost } from './GameHost';
import {
    getRuntimeSaveState, installRuntimeState, prepareRuntimeState, startRuntimeState, timerQueueState,
    type PreparedState, type ReadState, type RuntimeSaveState,
} from './RuntimeSave';
import { MonsterPerception } from './MonsterPerception';
import { MonsterDamage } from './MonsterDamage';
import { MonsterAI } from './MonsterAI';
import { MonsterAttack } from './MonsterAttack';
import { tag01b29a } from './AttackMenu';
import { AttackSystem } from './AttackSystem';
import { MagicSystem } from './MagicSystem';
import { CharacterSystem } from './CharacterSystem';
import { MouseSystem } from './MouseSystem';
import { HallOfChampions } from './HallOfChampions';
import { MOUSE_UNCLICK, UNTRANSLATED_CLICK, type MouseQueueEntry } from './MouseQueue';
import { createGravityState, createLoopFlags, flashButton, vblFlashButton, vblInterrupt, waitForButtonFlash, type LoopScript, type MainLoop } from './LoopState';
import { makeMoreRoomInDB } from './MakeMoreRoomInDB';
import { smartDiscard } from './SmartDiscard';
import { isNinetySecondTick, isTenSecondTick, ninetySecondUpdate, tenSecondUpdate } from './PeriodicUpdates';
import { DsaSystem } from './DsaSystem';
import { CursorFilterType } from './dsa/DsaTypes';
import { OBJECT_ID_NULL, Position } from '../core/types';
import { EDT_GLOBAL_TEXT } from '../data/DecodeText';
import { VBL_FREQUENCY } from '../core/constants';

import { CharacterStats } from './CharacterStats';
import { PartyFootprints } from './PartyFootprints';
import { CsbRandom } from '../core/random';
import type { GameTables } from './GameTables';

/**
 * Game event callback types
 */
type GameEventCallback = (game: Game) => void;
type MovementCallback = (success: boolean, result?: MovementResult) => void;

/**
 * What `HandleMouseEvents` asks of the screen: a click's button, and where the buttons it
 * does not handle itself go.
 */
export interface MouseEventHandlers {
    /**
     * `TranslateMouseClick`'s search (doc/CSBwin-src/Mouse.cpp:1374-1442): the
     * button the screen's lists put at the point clicked now, 0 for none.
     */
    translate(x: number, y: number, buttons: number): number;
    /** Any button but a turn, a step or the button-up, with the point clicked. */
    button(num: number, x: number, y: number): void;
    /** `0x0add`, the button-up. */
    unclick(): void;
}

/** `VBLDelay(_1_, 300);  //about 5 seconds` after the CSB win (doc/CSBwin-src/CSBCode.cpp:640). */
export const WON_GAME_VBLS = 300;

/**
 * The most VBLs one call of `Game.gameLoop` runs to catch up with the wall clock: a
 * second's worth, which a background tab's timer, held to a call a second, still keeps up
 * with. A longer gap (a tab held longer, a machine asleep) is not made up.
 */
const MAX_VBLS_PER_CALL = VBL_FREQUENCY;

/**
 * The movement buttons, as `MoveParty` numbers them (doc/CSBwin-src/CSBCode.cpp:8033-8038):
 * 1-2 turn left and right; 3-6 step forward, right, backward, left, so `num - 3` is the
 * step's direction relative to the party's facing. The on-screen arrows are these
 * buttons (`buttons17304`), and so are the movement keys. `0x1124` and `0x1125` go a
 * level down and up, the two keys of a dungeon that sets `bThreeDMovements`
 * (`:8039-8040`, `TAG0196da`).
 */
const MOVEMENT_BUTTON: Record<MovementAction, number> = {
    [MovementAction.TURN_LEFT]: 1,
    [MovementAction.TURN_RIGHT]: 2,
    [MovementAction.MOVE_FORWARD]: 3,
    [MovementAction.STRAFE_RIGHT]: 4,
    [MovementAction.MOVE_BACKWARD]: 5,
    [MovementAction.STRAFE_LEFT]: 6,
    [MovementAction.MOVE_DOWN]: 0x1124,
    [MovementAction.MOVE_UP]: 0x1125,
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
     * `HandleMouseEvents`' `static i32 lastTime` (doc/CSBwin-src/Mouse.cpp:1452): the
     * `d.Time` of the last button it handled, click, turn or step. Zeroed by its
     * initialise call, which a game load makes (`SaveGame.cpp:1785`).
     * Public so that `tools/` can open the gate (0) or shut it for the rest of a tick
     * (`ctx.state.tickCount`: an entry handled in it).
     */
    lastInputTime = 0;
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
    /** The wall-clock time `gameLoop` counts VBLs from, and the VBLs it has run since. */
    private vblClockStart = 0;
    private vblsPaced = 0;
    private loopTimer: ReturnType<typeof setTimeout> | null = null;
    /** `MainLoop` has returned, on the tick of a lost game (see `gameTick`), or won. */
    private mainLoopReturned = false;
    /** An error has ended the game (`die`): it never runs again, and nothing saves it. */
    private dead = false;
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
    /**
     * `d.gameState == GAMESTATE_ResumeSavedGame` as `TAG0138ec` reads it: the game was read
     * from a save (`savedGameRead`), not from `dungeon.dat` (`readNewGame`).
     */
    private resumedSavedGame = false;
    /**
     * The player's time in this game, in VBLs: every VBL of the loop but the frozen
     * game's and the save menu's (`playTime`).
     */
    private playedVbls = 0;

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
        ctx.dungeon.makeMoreRoomInDB = (db) => makeMoreRoomInDB(ctx, db);
        ctx.sounds.soundFilter = (ordinal, highVolume, level, x, y) =>
            ctx.systems.dsa.soundFilter(ordinal, highVolume, level, x, y);
        ctx.dungeon.textSubstitution = {
            handChar: () => ctx.party.state.cursorOwner ?? -1,
            characterName: (index) => ctx.party.state.champions[index]?.name ?? null,
            globalText: (index) => ctx.dungeon.locateExpoolRecord(((EDT_GLOBAL_TEXT << 24) | (index & 0xffff)) >>> 0),
            globalVariable: (index) => ctx.systems.dsa.getGlobalVariable(index),
        };
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
        // A game built over a world takes it as a read does, `deleteDuplicateTimers` with it.
        this.installWorld(dungeonData);
    }

    /** Pin `d.RandomNumber`. For tools and, eventually, save-game restore. */
    setRandomSeed(seed: number): void {
        this.ctx.random.setSeed(seed);
    }

    /**
     * Start the game loop. `enterDungeon` is the boot's start, `_ShowPrisonDoor`
     * (doc/CSBwin-src/CSBCode.cpp:10780-10811): a new game, not a resumed one, then takes
     * the party onto its square, `MoveObject(RN(RNnul), -1, 0, d.partyX, d.partyY)`
     * (`:10803-10806`), as a step onto it would: a teleporter there sends it on, a pad
     * there is pressed. `_TAG021028` loaded the party's level before (`:10615`). The
     * restart after a lost game calls `GameSetup` and `TAG021028` alone
     * (`Code1f9e6.cpp:310-318`), and moves nothing.
     */
    start(enterDungeon = false): void {
        if (this.running || this.dead) {
            return;
        }

        // `_TAG021028` ends in `TAG0138ec()` and `d.ClockRunning = 1`, and `MainLoop` follows
        // (doc/CSBwin-src/CSBCode.cpp:10672-10673, `:11555`).
        this.tag0138ec();
        if (enterDungeon && !this.resumedSavedGame) {
            const { x, y } = this.ctx.party.state.position;
            this.systems.monsters.loadPartyLevelIfChanged();
            this.ctx.systems.worldMove.moveParty(-1, 0, x, y);
        }
        this.running = true;
        this.vblClockStart = Date.now();
        this.vblsPaced = 0;
        // `_MainLoop` goes straight to `tag000698`, the top of a tick
        // (doc/CSBwin-src/CSBCode.cpp:596-611): the first thing a started game does is
        // `ProcessTimers`, `DrawViewport`, `d.Time++`. The port's tick is a pass's, so one
        // is made due, and the first VBL's pass runs it and draws the game's first view.
        this.ctx.loop.clockTick = true;

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

    /**
     * An error has ended the game, CSBWin's `die` (`doc/CSBwin-src/CSBCode.cpp:96-122`),
     * which quits: the loop stops for good, the page's input is dead (`GameInput`), and
     * nothing saves the world the error left half-updated (`GameSaves.save`), which F5
     * would write over the quick save that F9 reads after the reload the message asks for.
     */
    die(): void {
        this.dead = true;
        this.stop();
    }

    /** Whether an error has ended the game (`die`). */
    isDead(): boolean {
        return this.dead;
    }

    /** Whether `MainLoop` has returned: the game is over, and the page's input is dead. */
    mainLoopHasReturned(): boolean {
        return this.mainLoopReturned;
    }

    /**
     * `_ReadEntireGame` for a new game: `dungeon.dat` read into the running game
     * (`readGame`, doc/CSBwin-src/SaveGame.cpp:1579-1594). `data` must be a fresh parse
     * of the file, since play writes into the `DungeonData` it runs on. The running game
     * takes it as its world, made a new game's (`newGameState`), and the rest of a new
     * game, the party at the start, the clock and the timers, which a load restores here,
     * so every system keeps its object and the page its wiring.
     *
     * `_ReadEntireGame` sends the cursor filter `CURSORFILTER_ReadGame` for `RNnul` before it
     * empties the hand (doc/CSBwin-src/SaveGame.cpp:1597-1603), and a saved game's read
     * sends it again for the save's object (`:1774-1779`). Neither runs a DSA: both come
     * before `ReadDatabases` sets the `EXPOOL` up (`:2986`), and every path to the read
     * has emptied it first (doc/PROVEN_FACTS.md → "The cursor filter's `ReadGame` runs no
     * DSA"). So the port sends neither.
     */
    readNewGame(data: DungeonData): void {
        readGame(this, {
            world: data,
            extendedFeatures: data.extendedFeatures,
            simpleEncipher: data.simpleEncipher,
            state: () => {
                const random = new CsbRandom();
                const newGame = newGameState(data, this.ctx.tables, random, (line) => this.ctx.host.trace(line));
                return {
                    party: newGame.party.state,
                    game: {
                        tickCount: 0,
                        randomSeed: random.getSeed(),
                        gameWon: false,
                        footprints: new PartyFootprints().capture(),
                        dsaGlobals: readGlobalVariables(data),
                        // A new game reads `disableSaves` as a saved one does, from its
                        // world's `EXPOOL` (`doc/CSBwin-src/SaveGame.cpp:1648`, `:1962-1964`).
                        disableSaves: readDisableSaves(data),
                        overlayPalette: newGame.overlayPalette,
                        // `totalMoveCount` is a global, not `d.`'s (`doc/CSBwin-src/data.cpp:254`),
                        // so `d.Initialize()` leaves it and the new game counts on from the last one.
                        block1: { ...newGame.block1, totalMoveCount: this.ctx.state.block1.totalMoveCount },
                    },
                    dungeon: {
                        // `InitializeItem16`'s pool (`MonsterSystem.initializeItem16`).
                        item16: data.item16?.length ? data.item16 : newItem16Pool(),
                        ...timerQueueState(newGame.timers),
                        missiles: data.databases.missiles.records,
                    },
                };
            },
        });
        this.canRestart = false;
        this.resumedSavedGame = false;
        this.playedVbls = 0;
    }

    /**
     * `_ReadEntireGame` for a new game from the bytes of `dungeon.dat`. Where
     * `ReadDatabases` fails (doc/CSBwin-src/SaveGame.cpp:1910-1912) CSBWin's read ends at
     * `tag01efee`, and at the boot in `die(0xbad)`. The author's decision is that a game
     * file that does not read ends the game wherever it is read (`DEBT.md` H): `die(0xbad)`,
     * whose message says why: the parse, or the read built over it (`readGame`).
     */
    readDungeonDat(bytes: Uint8Array): void {
        try {
            this.readNewGame(new DungeonLoader().loadDungeonDat(bytes));
        } catch (error) {
            if (error instanceof Die) throw error;
            die(this.ctx.host, 0xbad, `SAVED GAME DAMAGED!\ndungeon.dat: ${error instanceof Error ? error.message : error}`);
        }
    }

    /**
     * Take `data` as the world, whole: `_ReadEntireGame` reads the structure with the rest,
     * the header, every level's descriptor and tables, from the file it opens
     * (`ReadDatabases`, doc/CSBwin-src/SaveGame.cpp:2536). `DungeonState` keeps its object,
     * which every system and the renderer hold, and takes the new data: the world has
     * that one route, `ctx.dungeon`. A read (`readGame`) builds the state that goes with
     * it over the world first (`prepareRuntimeState`), and installs both at once.
     *
     * `deleteDuplicateTimers` is a global every read sets from the world's `EXPOOL` once
     * the databases are in (doc/CSBwin-src/SaveGame.cpp:1965-1975); a read reads it while
     * it builds.
     */
    installWorld(data: DungeonData, deleteDuplicateTimers = readDeleteDuplicateTimers(data)): void {
        this.ctx.dungeon.install(data);
        this.ctx.timers.deleteDuplicateTimers = deleteDuplicateTimers;
    }

    /**
     * `_ShowPrisonDoor` once `GameSetup` has read the game, new or resumed:
     * `if (DMRulesDesignOption) DM_rules = true` (doc/CSBwin-src/CSBCode.cpp:10796-10800).
     * The boot's alone: the restart after a lost game calls `GameSetup` straight
     * (`Code1f9e6.cpp:310`) and does not force it.
     */
    forceDMRulesAtBoot(): void {
        if (this.ctx.rules.dmRulesDesignOption) this.ctx.rules.dmRules = true;
    }

    /**
     * The tail of `_ReadEntireGame` once a saved game is in: `d.CanRestartFromSavegame = 1`
     * (doc/CSBwin-src/SaveGame.cpp:2087). `applySaveBytes` calls it. A save read in play,
     * which only the port has, begins at once (`tag0138ec`), as one read at the entrance or
     * after a lost game begins when the loop starts (`start`). First the old world's
     * interface goes: CSBWin reads a game only after `d.Initialize()` has zeroed the whole
     * of `d` (doc/CSBwin-src/CSBCode.cpp:333-340), so `ctx.interface` is a new game's, its
     * open chest dropped and never repacked into the world read, and an inventory the old
     * party had open is closed as `ShowHideInventory` closes one, `videoMode =
     * VM_ADVENTURE` (`:7512`): the party read has none open. Then the screen leaves the
     * old world (`GameHost.savedGameRead`).
     */
    savedGameRead(inventoryWasOpen: boolean): void {
        this.canRestart = true;
        this.resumedSavedGame = true;
        if (!this.running) return;
        if (inventoryWasOpen) this.ctx.loop.videoMode = 'VM_ADVENTURE';
        Object.assign(this.ctx.interface, createInterfaceState());
        this.ctx.host.savedGameRead();
        this.tag0138ec();
    }

    /**
     * `TAG0138ec`'s cursor filter, as the game read begins (doc/CSBwin-src/CSBCode.cpp:6348-6438):
     * `CURSORFILTER_ResumeSavedGame` for the object in a saved game's hand, and nothing for
     * an empty one (`:6356-6381`); `CURSORFILTER_EnteringPrison` for `RNnul` in a new game,
     * whose hand is then emptied (`:6423-6430`). Neither reads the packet back. Both set
     * `p1` four times, so `p2` to `p4` keep the constructor's 0 (`MoveObject.cpp:790-795`).
     * The rest of `TAG0138ec`, which puts the object on the cursor and draws the champions,
     * is not here.
     */
    private tag0138ec(): void {
        const party = this.ctx.party.state;
        if (this.resumedSavedGame) {
            const object = party.objectInHand;
            if (object === OBJECT_ID_NULL) return;
            this.systems.dsa.cursorFilter({ object, type: CursorFilterType.ResumeSavedGame, p1: 0, p2: 0, p3: 0, p4: 0 });
            return;
        }
        this.systems.dsa.cursorFilter({ object: OBJECT_ID_NULL, type: CursorFilterType.EnteringPrison, p1: 0, p2: 0, p3: 0, p4: 0 });
        party.objectInHand = OBJECT_ID_NULL;
    }

    /** `d.CanRestartFromSavegame`. */
    canRestartFromSavegame(): boolean {
        return this.canRestart;
    }

    /** `d.CanRestartFromSavegame = 0`, as `_FusionSequence` ends (doc/CSBwin-src/Attack.cpp:2430). */
    clearCanRestartFromSavegame(): void {
        this.canRestart = false;
    }

    /**
     * The player's time in this game, in milliseconds: the VBLs the loop has run, sixty
     * a second, the frozen game's and the save menu's left out. The wall clock paces the
     * VBLs (`gameLoop`), so this is the time the player spent in the game, asleep or
     * not, where `d.Time` counts ticks, which sleep runs fast; and a machine asleep, whose
     * VBLs are not made up, counts nothing.
     *
     * Not CSBWin's, and no file holds it. A save's row does (`SaveEntry.playTime`), a
     * load sets it from that row (`GameSaves.read`), and a new game starts at 0
     * (`readNewGame`).
     */
    playTime(): number {
        return Math.round(this.playedVbls * 1000 / VBL_FREQUENCY);
    }

    /** The play time of the save a game was read from (`playTime`). */
    setPlayTime(milliseconds: number): void {
        this.playedVbls = Math.round(milliseconds * VBL_FREQUENCY / 1000);
    }

    /**
     * `_StartCSB` calls `MainLoop` again once `ShowCredits` returns from a restart
     * (doc/CSBwin-src/CSBCode.cpp:11555-11562). The loop's state is `d`'s, which
     * `d.Initialize()` has reset (`Code1f9e6.cpp:309`), and the input goes
     * (`DiscardAllInput`, `:321`). `MainLoop` opens with a tick (`CSBCode.cpp:596-611`),
     * so one is due. The page starts the loop (`start`).
     */
    resumeMainLoop(): void {
        Object.assign(this.ctx.loop, createLoopFlags());
        this.ctx.loop.clockTick = true;
        this.script = null;
        this.ctx.mouseQueue.discardAllInput();
        this.mainLoopReturned = false;
    }

    /**
     * The page's VBL clock: as many VBLs (`runFrame`) as the wall clock has let pass since
     * the last call, at most `MAX_VBLS_PER_CALL`, then a call again when the next is due.
     * Everything in the game counts VBLs, the ticks (`vblInterrupt`) as the message
     * strip's scroll and a script's `VBLDelay`, so a timer that fires late or seldom slows
     * the game down and never puts one clock out of step with another.
     *
     * Paced with `setTimeout` rather than `requestAnimationFrame`. CSBWin's VBL timer
     * keeps advancing `d.Time` — and with it the teleporter/energy shimmer's
     * `GraphicRandom` counter, the party's food and water, every monster timer —
     * whether or not the window has focus; `requestAnimationFrame` callbacks are
     * fully suspended by the browser the moment the tab is backgrounded or occluded
     * (unlike `setTimeout`, which is only throttled), so an rAF-driven loop goes
     * completely idle exactly when a real VBL wouldn't.
     *
     * A VBL that throws is CSBWin's `die`: the game dies (`die`), and the host reports it.
     */
    private gameLoop = (): void => {
        if (!this.running) {
            return;
        }

        const now = Date.now();
        let due = Math.floor((now - this.vblClockStart) * VBL_FREQUENCY / 1000) - this.vblsPaced;
        if (due > MAX_VBLS_PER_CALL) {
            due = MAX_VBLS_PER_CALL;
            this.vblClockStart = now;
            this.vblsPaced = 0;
        } else {
            this.vblsPaced += due;
        }
        try {
            for (let n = 0; n < due && this.running; n++) this.runFrame();
        } catch (error) {
            this.die();
            this.ctx.host.die(error);
            return;
        }
        if (!this.running) return;

        const nextVbl = this.vblClockStart + (this.vblsPaced + 1) * 1000 / VBL_FREQUENCY;
        this.loopTimer = setTimeout(this.gameLoop, Math.max(0, nextVbl - Date.now()));
    };

    /**
     * One VBL of the loop: `vblInterrupt`, then the main loop's pass it wakes — the mouse
     * queue, a game tick if `d.clockTick` is set, and a message off the print queue.
     * Public so that `tools/` can step VBLs.
     */
    runFrame(): void {
        // Nothing of the loop runs once `MainLoop` has returned: `ShowCredits` has the screen.
        if (this.mainLoopReturned) return;
        // The player's time in the game (`playTime`): not the frozen game's VBLs, nor the
        // save menu's.
        if (!this.ctx.loop.gameFrozen && !this.ctx.state.paused) this.playedVbls++;
        this.paintIsHeld = false;
        // The VBL handler runs on every VBL, held in a script or not (`vblInterrupt`,
        // doc/CSBwin-src/CSBCode.cpp:1013-1087): the message strip's scroll moves on
        // first, then the button flash (`:1038-1048`), then `d.vblCount`, which raises
        // `d.clockTick` once it reaches `d.Speed`. It runs frozen or not, and under the
        // save menu.
        this.ctx.host.messages.vblInterrupt();
        vblFlashButton(this.ctx.loop);
        vblInterrupt(this.ctx);
        if (this.script !== null) {
            // A script's `VBLDelay` (`wvbl`, doc/CSBwin-src/CSBCode.cpp:1147-1157): the VBLs
            // go by, and the loop makes no pass. The last one resumes the script, up to its
            // next delay.
            if (--this.scriptDelay === 0) this.resumeScript();
            // `ShowCredits` has the screen, and never returns.
            if (this.mainLoopReturned) return;
            if (this.script !== null) {
                for (const callback of this.onFrameCallbacks) callback(this);
                return;
            }
            // The sequence has returned, and the pass it held goes on where it stopped, in
            // this VBL. The entry that called it was a button, whose `result` is 0
            // (doc/CSBwin-src/Mouse.cpp:1470, `:1772-1780`), so `while (intResult & 1)`
            // takes no other (`CSBCode.cpp:771`), and the rest of the pass is below: a tick
            // that `_MagicSelection`'s `d.clockTick = CastMagic(0)` (`Magic.cpp:567`) or the
            // VBL count made due runs now. A panel key's script, started outside a pass
            // (`DEBT.md` H, "Three inputs bypass the mouse queue"), ends the same way:
            // CSBWin's key is a click that a pass takes.
        } else {
            // `checkVBL` hands the loop its `UIM_VBL` (doc/CSBwin-src/system.cpp:624-630,
            // CSBUI.cpp:1274-1293), and the pass runs:
            // `do { HandleMouseEvents(_7_, 1); ... } while (intResult & 1);`
            // (doc/CSBwin-src/CSBCode.cpp:756-771): again while an entry lets the next follow.
            while (this.handleMouseEvents(1) & 1 && this.script === null) { /* the next entry, in the same pass */ }
            // A handler has started a script (the fusion, the spell panel): the pass is held
            // inside it.
            if (this.script !== null) return;
        }

        // `if (d.clockTick == 0) WaitForButtonFlash();` (doc/CSBwin-src/CSBCode.cpp:773).
        if (!this.ctx.loop.clockTick) waitForButtonFlash(this.ctx);
        // `if (d.clockTick == 0) goto tag0007b4; if (d.ClockRunning == 0) goto tag0007b4;`
        // (doc/CSBwin-src/CSBCode.cpp:774-775): frozen, the due tick waits, and runs in the
        // pass that thaws. The save menu holds the pass in `DisplayDiskMenu` (`:772`), so
        // a tick that falls due under it runs in the first pass after it.
        if (this.ctx.loop.clockTick && this.ctx.loop.clockRunning && !this.ctx.state.paused) {
            this.gameTick();
            // Won: `MainLoop` is in its `VBLDelay`, and this pass goes no further.
            if (this.script !== null) return;
        }
        // `tag0007c8` (doc/CSBwin-src/CSBCode.cpp:724-731): one print-queue entry a pass,
        // ticked or not, frozen or not. The save menu holds the loop in `DisplayDiskMenu`
        // (`:772`), so it takes none.
        if (!this.ctx.state.paused) this.ctx.host.messages.printNextQueued(this.ctx.state.tickCount);
        for (const callback of this.onFrameCallbacks) {
            callback(this);
        }
    }

    /**
     * Process one game tick (~4 times per second). Public so that `tools/` can step a
     * tick without the VBL around it (`runFrame`).
     */
    gameTick(): void {
        // `tag000698` (doc/CSBwin-src/CSBCode.cpp:613-621): a menu's mode, or any other
        // but an inventory's or sleep's, goes back to `VM_ADVENTURE`. `ForceScreenDraw()`
        // and `UI_Invalidate(true)` are the port's every frame.
        const loop = this.ctx.loop;
        if (loop.videoMode !== 'VM_ADVENTURE' && loop.videoMode !== 'VM_INVENTORY' && !this.ctx.party.state.sleeping) {
            loop.videoMode = 'VM_ADVENTURE';
        }
        // `d.vblCount = 0;` (doc/CSBwin-src/CSBCode.cpp:627): the next tick falls due
        // `d.Speed` VBLs from here. `d.Speed` itself is `speed()`, which the one game speed
        // makes the same value the top of the tick sets (`:622-626`).
        this.ctx.loop.vblCount = 0;
        // The top of a tick, then `ProcessTimers()` and `if (d.newPartyLevel != -1) goto
        // tag0006a4;` (doc/CSBwin-src/CSBCode.cpp:625-645): a timer that moved the party
        // to another level has it loaded, input discarded and the timers run again, all
        // in this tick.
        this.loadNewPartyLevel();
        do {
            if (this.systems.timer.processTimers()) {
                // "Game has been won." (doc/CSBwin-src/CSBCode.cpp:637-643)
                this.runScript(this.wonByTimers());
                return;
            }
        } while (this.loadNewPartyLevel());
        // `DrawViewport(d.partyFacing, d.partyX, d.partyY)` (doc/CSBwin-src/CSBCode.cpp:648):
        // the tick's redraw comes after the timers and after a new party level is loaded,
        // so a step down the stairs never draws the new square on the old level.
        for (const callback of this.onTickCallbacks) {
            callback(this);
        }
        // `tag000730: WaitForButtonFlash();` (doc/CSBwin-src/CSBCode.cpp:663-665), asleep
        // or not. CSBWin waits there for the VBL that puts the flashed rectangle back;
        // the port's pass does not (`DEBT.md` H), so whether it asked for one is kept.
        waitForButtonFlash(this.ctx);
        const putBackAsked = this.ctx.loop.flashButnActive;
        // `StartQueuedSound(); DisplayCharacterDamage();` (doc/CSBwin-src/CSBCode.cpp:666-667):
        // what `DamageCharacter` dealt since the last tick comes off the HP, and a champion
        // it kills can lose the game just below.
        this.ctx.systems.monsterAttack.displayCharacterDamage();
        // `tag000730`: `if (d.GameIsLost == 0) { d.Time++; … goto tag000698; } RETURN;`
        // (doc/CSBwin-src/CSBCode.cpp:668-788). With nobody left alive the rest of the tick
        // does not run, and `MainLoop` returns to `_StartCSB`, which shows the credits
        // (`:11557-11561`).
        if (this.ctx.party.state.gameIsLost) {
            this.mainLoopReturned = true;
            this.stop();
            this.ctx.host.showCredits(this.ctx.state.gameWon);
            return;
        }
        // `d.Time++; ... scrollingText.ClockTick();` (doc/CSBwin-src/CSBCode.cpp:670-687):
        // after the timers, so they ran on the `d.Time` the mouse handlers saw since the
        // last tick, and what they printed is placed in this tick.
        this.advanceTime();
        this.ctx.host.messages.clockTick(this.ctx.state.tickCount);
        // `SmartDiscard(false);` (doc/CSBwin-src/CSBCode.cpp:688).
        smartDiscard(this.ctx, false);
        // `if ((d.Time&511)==0) NinetySecondUpdate();` (doc/CSBwin-src/CSBCode.cpp:690-693).
        if (isNinetySecondTick(this.ctx.state.tickCount)) ninetySecondUpdate(this.ctx);
        // `if (d.freezeLifeTimer != 0) d.freezeLifeTimer--;` — one per game tick
        // (doc/CSBwin-src/CSBCode.cpp:694).
        if (this.ctx.party.state.freezeLifeTimer !== 0) this.ctx.party.state.freezeLifeTimer--;
        // `TAG01b29a(_4_);` (doc/CSBwin-src/CSBCode.cpp:695). What it draws is painted in
        // this tick, unless a put-back was asked above: CSBWin draws it only after that
        // VBL, so the port paints it at the put-back's redraw, and the frame shows the
        // tick's `DrawViewport` until then (`paintHeld`).
        tag01b29a(this.ctx);
        if (putBackAsked) this.paintIsHeld = true;
        else this.ctx.host.paint();
        // `if ((d.Time & (d.PartySleeping ? 15 : 63)) == 0) TenSecondUpdate();` (`:696-698`).
        if (isTenSecondTick(this.ctx.state.tickCount, this.ctx.party.state.sleeping)) tenSecondUpdate(this.ctx);
        // `if (d.partyMoveDisableTimer != 0) d.partyMoveDisableTimer--;` and the same for
        // `d.Word11712` (doc/CSBwin-src/CSBCode.cpp:699-705).
        if (this.ctx.party.state.partyMoveDisableTimer !== 0) this.ctx.party.state.partyMoveDisableTimer--;
        if (this.ctx.party.state.word11712 !== 0) this.ctx.party.state.word11712--;
        // `d.clockTick=0;` (doc/CSBwin-src/CSBCode.cpp:714).
        this.ctx.loop.clockTick = false;
    }

    /**
     * `ShowCredits(1)` once `ProcessTimers` has won the game, by the loop's tick
     * (`MainLoop`, doc/CSBwin-src/CSBCode.cpp:637-643) or a script's
     * (`_ProcessTimersViewportAndSound`, Attack.cpp:2201-2206): `VBLDelay(300)`, then the
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
     * called a `RESTARTABLE` sequence is suspended inside it; in the VBL the script ends,
     * `runFrame` finishes that pass.
     */
    runScript(script: LoopScript): void {
        this.script = script;
        this.resumeScript();
    }

    /** Whether the loop is held in a script (`runScript`). */
    isRunningScript(): boolean {
        return this.script !== null;
    }

    /**
     * A move a level down (`delta` 1) or up (-1) for the page's `?dev`, not CSBWin's: the
     * party is lifted off its square and put on the map numbered one more or one less,
     * as CSBWin's gravity counts its vertical axis (doc/CSBwin-src/Mouse.cpp:1280-1287),
     * on the same square of the dungeon when that map holds it, else on that map's
     * nearest square, as `TraverseStairway` puts it down a stairway (`CSBCode.cpp:7860-7868`):
     * the next tick loads the level (`loadNewPartyLevel`). Whatever is there, a wall, a
     * monster or no pit, and with no filter and no stamina: a way through a dungeon to
     * debug it, where `IncrementLevel` finds a level only over the squares two levels
     * share. False, and nothing done, above map 0 or below the last, in a script, or with
     * a level change already under way.
     */
    devChangeLevel(delta: 1 | -1): boolean {
        if (this.isRunningScript() || this.ctx.loop.newPartyLevel !== -1) return false;
        const here = this.ctx.party.state.position;
        const from = this.ctx.dungeon.getMap(here.z)?.descriptor;
        const to = this.ctx.dungeon.getMap(here.z + delta)?.descriptor;
        if (!from || !to) return false;
        const clamp = (v: number, size: number): number => Math.min(Math.max(v, 0), size - 1);
        const next = new Position(
            clamp(from.offsetX + here.x - to.offsetX, to.width),
            clamp(from.offsetY + here.y - to.offsetY, to.height),
            here.z + delta,
        );
        this.ctx.systems.worldMove.moveParty(here.x, here.y, -1, 0);
        this.ctx.loop.newPartyLevel = next.z;
        this.ctx.party.state.position = new Position(next.x, next.y, here.z);
        return true;
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
     * `_ProcessTimersViewportAndSound` (doc/CSBwin-src/Attack.cpp:2194), the tick a script
     * runs between its `VBLDelay`s: `ProcessTimers`, and a win there ends the game
     * (`wonByTimers`); then `d.Time++` and `scrollingText.ClockTick()`. Not the rest of the
     * main loop's tick: no input, no periodic update, no print-queue entry. `DrawViewport` and
     * `display` are the host's `drawViewport`. `StartQueuedSound` has no counterpart: it
     * plays nothing, since `d.CurrentSound` stays -1 once `QueueSound`'s assignment is
     * commented out (`doc/CSBwin-src/CSBCode.cpp:1935`) and `QueueSound` calls `StartSound`
     * itself.
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
     * `d.Time++`, after the timers, in the main loop's tick (doc/CSBwin-src/CSBCode.cpp:670)
     * and in `_ProcessTimersViewportAndSound` (`Attack.cpp:2210`), and the parameter
     * messages' sequence back to 0 with it.
     */
    private advanceTime(): void {
        this.ctx.state.tickCount++;
        // The overlay's end (`CSBCode.cpp:685`, `Attack.cpp:2211`).
        this.ctx.overlay.expire(this.ctx.state.tickCount);
        // `parameterMessageSequence = 0;` (`CSBCode.cpp:686`, `Attack.cpp:2212`).
        this.ctx.systems.dsa.parameterMessageSequence = 0;
    }

    /**
     * A movement key, `TAG0196da` (doc/CSBwin-src/CSBCode.cpp:8516): translated to its
     * button and queued, unless the queue is full — `MouseQEnd + 2 == MouseQStart`, seven
     * entries waiting (`:8526-8530`). The key queue in front of it (`CSBUI.cpp:154-156`)
     * is emptied into it one key per message (`CSBCode.cpp:717-722`), so it is never
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
     * `OnMouseClick` (doc/CSBwin-src/CSBCode.cpp:7670): the click at (x, y) with
     * the mouse buttons `buttons`, queued untranslated (`MouseQueue.enqueueClick`) while
     * fewer than `MOUSEQLEN-2` entries wait. Its button is the one the screen has there
     * when `handleMouseEvents` comes to it. Says whether it was queued.
     */
    onMouseClick(x: number, y: number, buttons: number): boolean {
        return this.ctx.mouseQueue.enqueueClick(x, y, buttons);
    }

    /**
     * `OnMouseUnClick` (doc/CSBwin-src/CSBCode.cpp:7640): the button-up, `0x0add`, queued
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
        return this.moveParty(action).success;
    }

    private moveParty(action: MovementAction): MovementResult {
        const result = this.systems.movement.moveParty(action);
        for (const callback of this.onMoveCallbacks) {
            callback(result.success, result);
        }
        return result;
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
     * `tag0006a4` (doc/CSBwin-src/CSBCode.cpp:625-633): `if (d.newPartyLevel != -1)`,
     * `LoadPartyLevel(d.newPartyLevel)`, whose `SetPartyLevel` moves `d.partyLevel` on
     * (`:5858`), then `MoveObject(RN(RNnul), -1, 0, d.partyX, d.partyY)`, which takes the
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
     * `HandleMouseEvents` (doc/CSBwin-src/Mouse.cpp:1450), which the main loop calls with
     * `delta = 1` (`CSBCode.cpp:758`): at most one entry of the mouse queue, and a result
     * whose bit 0 asks to be called again at once. A click at the head is translated
     * first, against the button lists of the screen as it is now, and one that hits no
     * button is dropped for the entry behind it (`TranslateMouseClick`, the loop at
     * doc/CSBwin-src/Mouse.cpp:1510-1528). The translation stays with the entry,
     * so a click that then waits is the same button when it goes. The head waits, rather
     * than being taken, while
     *
     * - an entry was handled this tick: `lastTime != 0 && d.Time < lastTime + delta`
     *   (`Mouse.cpp:1596-1604`), unless the game is frozen and the head is 148, the thaw
     *   (`thawCommand`, `:1591-1604`): no tick runs while frozen, so the thaw is never
     *   made to wait for one;
     * - it is a step and `d.partyMoveDisableTimer != 0`, or `d.Word11712 != 0` and the
     *   step heads in direction `d.Word11714` (`:1619-1632`) — and everything queued
     *   behind it waits too.
     *
     * The turns, the steps and the moves down and up (`0x1124`/`0x1125`) are handled here
     * (`TurnParty`, `MoveParty`, `:1689-1709`), the button-up and every other button by
     * `mouseEventHandlers`. A move down or up waits for no move delay: the test above is
     * for buttons 3-6 alone. Every button stamps
     * `lastTime`; the button-up does not, and lets the next entry follow (`:1662-1688`).
     * A handler that starts a script stamps it at once, not when the script ends
     * (`DEBT.md` H, "A script's caller finishes at once").
     *
     * Frozen, every entry but 148 is thrown away, one per call, and nothing else happens
     * (`:1433-1444`). `CauseFakeMouseClick`, which follows every take, replays a click
     * the port never defers.
     *
     * While the party slides (`gravityMove`), each call first throws the queue away, keys
     * and clicks alike, and queues `GravityMove`'s step in their place, or returns with the
     * queue empty when it has none (`Mouse.cpp:1482-1491`): CSBWin's
     * `d.MouseQStart = d.MouseQEnd = 0` and `MouseQStart = 1` are a queue of one and an
     * empty one.
     */
    private handleMouseEvents(delta: number): number {
        const queue = this.ctx.mouseQueue;
        if (this.ctx.loop.gravityMove) {
            queue.discardAllInput();
            const step = this.systems.movement.gravityMove();
            if (step === 0) return 0;
            queue.enqueueKey(step);
        }
        for (;;) {
            if (queue.count() === 0) return 0;
            if (this.translateMouseClick(queue.head())) break;
            queue.take();
        }
        const frozen = this.ctx.loop.gameFrozen;
        if (frozen && queue.head().num !== 148) {
            queue.take();
            return 0;
        }
        const time = this.ctx.state.tickCount;
        const thawCommand = frozen && queue.head().num === 148;
        if (this.lastInputTime !== 0 && time < this.lastInputTime + delta && !thawCommand) return 0;
        const entry = queue.head();
        const num = entry.num;
        const party = this.ctx.party.state;
        if (num >= 3 && num <= 6 && (
            party.partyMoveDisableTimer !== 0 ||
            (party.word11712 !== 0 && ((party.facing + num - 3) & 3) === party.word11714)
        )) return 0;
        queue.take();
        // `RecordFile_Record(&pMouseQueue[d.MouseQStart])` (doc/CSBwin-src/Mouse.cpp:1645),
        // the entry's one count in `totalMoveCount` (`Recording.cpp:1091-1114`). A viewport
        // click, button 80, is recorded by `HandleClickInViewport` instead, exactly once on
        // each of its paths, and it runs whenever `d.ClockRunning`, which is 0 only while
        // frozen, when this entry would have been discarded above (`Mouse.cpp:1804-1807`).
        this.recordFileRecord(entry);
        if (num === MOUSE_UNCLICK) {
            this.mouseEventHandlers?.unclick();
            return 1;
        }
        const action = BUTTON_MOVEMENT[num];
        if (action !== undefined) {
            const moved = this.moveParty(action);
            // `pButton = MoveParty(D6W); if (pButton != NULL) FlashButton(…)`
            // (doc/CSBwin-src/Mouse.cpp:1695-1706): a step's arrow, `d.MoveButn18496[button
            // - 3]`, which `MoveParty` returns unless the party move filter refused the step
            // (`CSBCode.cpp:8207`, `:8224-8226`). A turn flashes its own, in `_TurnParty`.
            if (num >= 3 && num <= 6 && !moved.refused) {
                const button = this.ctx.tables.moveButtons[num - 3]!;
                flashButton(this.ctx, button.x1, button.x2, button.y1, button.y2);
            }
        } else {
            this.mouseEventHandlers?.button(num, entry.x, entry.y);
        }
        this.lastInputTime = time;
        return 0;
    }

    /**
     * `TranslateMouseClick` (doc/CSBwin-src/Mouse.cpp:1374-1442): a click still
     * `UNTRANSLATED_CLICK` gets the button the screen has at its point, and an entry that
     * is already a button is left as it is. False for a click that hits no button. The
     * Reincarnate screen's `0xade` is not here: that screen takes its clicks itself, past
     * the queue (`DEBT.md` H, "Three inputs bypass the mouse queue"). Nor is the scroll
     * area's `0xd8`: `IsTextScrollArea` is false on Windows (`WinScreen.cpp:99-102`).
     */
    private translateMouseClick(entry: MouseQueueEntry): boolean {
        if (entry.num !== UNTRANSLATED_CLICK) return true;
        const num = this.mouseEventHandlers?.translate(entry.x, entry.y, entry.buttons) ?? 0;
        if (num === 0) return false;
        entry.num = num;
        return true;
    }

    /**
     * The count in `RECORDFILE::Record(MouseQueueEnt *)` (doc/CSBwin-src/Recording.cpp:1091-1114):
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
        ensureHandOwner(this.ctx);
    }

    /**
     * Register a callback for each game tick, run where CSBWin's tick draws the viewport:
     * after the timers and any new party level (doc/CSBwin-src/CSBCode.cpp:625-648).
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

    /** The game's state as a read restores it (`RuntimeSave.getRuntimeSaveState`). */
    getRuntimeSaveState(): RuntimeSaveState {
        return getRuntimeSaveState(this.ctx);
    }

    /**
     * The tail of CSBWin's `SaveGame`, once the file is written
     * (`MonsterSystem.reattachAfterSave`). A save that fails skips it: CSBWin's
     * `goto tag01e4f0` jumps past it (`doc/CSBwin-src/SaveGame.cpp:1361`). The same tail
     * starts `SmartDiscard` over (`:1343`), and ends in `d.CanRestartFromSavegame = 1`
     * (`:1358`).
     */
    saveWritten(): void {
        this.systems.monsters.reattachAfterSave();
        smartDiscard(this.ctx, true);
        this.canRestart = true;
    }

    /**
     * Restore `save` over the running world, as a read restores its own over the world it
     * installs (`readGame`): `prepareRuntimeState`, then `installReadState` and
     * `startReadState`. For the tools, which take a game back to a state they captured.
     */
    applyRuntimeSaveState(save: ReadState): void {
        const world = this.ctx.dungeon.getData();
        const prepared = prepareRuntimeState(world, save);
        // A new skin cache, over the records the snapshot put back.
        this.ctx.dungeon.install(world);
        this.installReadState(prepared);
        this.startReadState();
    }

    /**
     * Install a read's state (`RuntimeSave.installRuntimeState`), then the loop's own
     * reset: `HandleMouseEvents(_16_, -999887)` — `lastTime = 0`
     * (doc/CSBwin-src/SaveGame.cpp:1785, `Mouse.cpp:1473-1477`). `MainLoop` follows every
     * read and opens with a tick (`:596-611`), so one is made due: a game read in play,
     * which only the port has, ticks in the next pass, and that tick draws its first view.
     * Assignments alone: this is part of the read's swap, which cannot throw.
     *
     * The game read starts clean, as CSBWin's every read does: no script holds the loop,
     * since a read in CSBWin comes only at the boot and at the restart, which leaves the
     * credits for a new `MainLoop`; and the input is gone, `DiscardAllInput` ending both
     * (doc/CSBwin-src/CSBCode.cpp:10808, `Code1f9e6.cpp:321`). A read in play drops the
     * clicks and keys queued before it, which would be translated against the read
     * game's screen.
     */
    installReadState(prepared: PreparedState): void {
        installRuntimeState(this.ctx, prepared);
        this.script = null;
        this.scriptDelay = 0;
        this.ctx.mouseQueue.discardAllInput();
        this.lastInputTime = 0;
        // CSBWin saves none of the gravity's globals, nor resets them: a game read starts
        // from the program's start, `{0,1,2,0}` and at rest (`DEBT.md` H, "A game read
        // starts the gravity afresh").
        Object.assign(this.ctx.loop, createGravityState());
        this.ctx.loop.clockTick = true;
    }

    /**
     * The end of every game read, over the installed state: the party's level loaded
     * (`RuntimeSave.startRuntimeState`), and `_GameSetup`'s `SmartDiscard(true)` after
     * each `ReadEntireGame` (`CSBCode.cpp:10759-10760`).
     */
    startReadState(): void {
        startRuntimeState(this.ctx);
        smartDiscard(this.ctx, true);
    }
}
