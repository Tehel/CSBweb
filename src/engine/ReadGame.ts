/**
 * `_ReadEntireGame` (`doc/CSBwin-src/SaveGame.cpp:1536`): a game read into the running
 * one, a new game from `dungeon.dat` (`Game.readNewGame`) or a saved game from its file
 * (`applyCsbwinSave`), through one list of steps.
 */
import { readExpectedSignatures, readRulesOptions, type ExtendedFeaturesBlock } from '../data/CsbwinExtendedFeatures';
import type { DungeonData } from '../data/dungeonTypes';
import { readDeleteDuplicateTimers } from '../data/CsbwinExpool';
import { Die } from '../core/Die';
import { die } from './Die';
import { initializeGameContext } from './GameContext';
import { readFileSignatures } from './FileSignatures';
import type { Game } from './Game';
import { prepareRuntimeState, type RuntimeState } from './RuntimeSave';

/** What a read takes from its file, `dungeon.dat` or a save. */
export interface GameRead {
    /** The world, structure and all, as the file gives it. Play writes into it. */
    world: DungeonData;
    /** The Extended Features block the rules, the signatures and the overlay come from. */
    extendedFeatures: ExtendedFeaturesBlock | undefined;
    simpleEncipher: boolean | undefined;
    /**
     * What the read makes of the world before it is installed, `CheckMonsters`
     * (`doc/CSBwin-src/SaveGame.cpp:2029`) first, and the state that goes with it.
     */
    state(): RuntimeState;
}

/**
 * Read `read` into `game`: built off the running game, then installed at once, then
 * started.
 *
 * 1. **Built**, touching nothing of the running game: the graphics files the world names,
 *    checked (the end of `LoadGame`, `doc/CSBwin-src/SaveGame.cpp:1966-2025`,
 *    `readFileSignatures`); `CheckMonsters` over the world and the state
 *    (`GameRead.state`); `ReadExtendedFeatures`' rule flags and graphics signatures
 *    (`doc/CSBwin-src/SaveGame.cpp:380-383`, `:394-400`), over copies, a file with no
 *    block leaving them as they were; `deleteDuplicateTimers`; and the state put into the
 *    world, the timer queue made ready (`prepareRuntimeState`). An error here leaves the
 *    running game as it was, and is the caller's to report.
 * 2. **Installed**: the signatures, the rules, the context's `d.` as `d.Initialize()`
 *    leaves it (`initializeGameContext`), the world (`Game.installWorld`) and the state
 *    (`Game.installReadState`), by assignments that cannot throw.
 * 3. **Started**: the overlay the block names (`Overlay.readExtendedFeatures`), which reads
 *    `CSBgraphics.dat` against the signatures just installed, then the party's level
 *    loaded and the databases thinned (`Game.startReadState`). The new game is in by now,
 *    half started, so an error here ends it, `die(0xbad)`, as CSBWin's `tag01efee` ends
 *    any read that fails (`:2098-2119`).
 *
 * A `Die` is CSBWin's own end of the game wherever it comes, and passes through.
 */
export function readGame(game: Game, read: GameRead): void {
    const { ctx } = game;
    const runtimeFileSignatures = readFileSignatures(ctx, read.world);
    const state = read.state();
    const rules = { ...ctx.rules };
    readRulesOptions(rules, read.extendedFeatures, read.simpleEncipher);
    const signatures = { ...ctx.signatures };
    readExpectedSignatures(signatures, read.extendedFeatures);
    const deleteDuplicateTimers = readDeleteDuplicateTimers(read.world);
    const prepared = prepareRuntimeState(read.world, state);

    Object.assign(ctx.runtimeFileSignatures, runtimeFileSignatures);
    Object.assign(ctx.rules, rules);
    Object.assign(ctx.signatures, signatures);
    initializeGameContext(ctx);
    game.installWorld(read.world, deleteDuplicateTimers);
    game.installReadState(prepared);

    try {
        ctx.overlay.readExtendedFeatures(read.extendedFeatures);
        game.startReadState();
    } catch (error) {
        if (error instanceof Die) throw error;
        die(ctx.host, 0xbad, `SAVED GAME DAMAGED!\n${error instanceof Error ? error.message : error}`);
    }
}
