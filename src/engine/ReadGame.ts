/**
 * `_ReadEntireGame` (`doc/CSBwin-src/SaveGame.cpp:1536`): a game read into the running
 * one, a new game from `dungeon.dat` (`Game.readNewGame`) or a saved game from its file
 * (`applyCsbwinSave`), through one list of steps.
 */
import { readExpectedSignatures, readRulesOptions, type ExtendedFeaturesBlock } from '../data/CsbwinExtendedFeatures';
import type { DungeonData } from '../data/dungeonTypes';
import { readFileSignatures } from './FileSignatures';
import type { Game } from './Game';
import type { RuntimeSaveState } from './RuntimeSave';

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
    state(): RuntimeSaveState;
}

/**
 * Read `read` into `game`, in this order:
 *
 * 1. The graphics files the world names, checked before anything is installed: the end
 *    of `LoadGame` (`doc/CSBwin-src/SaveGame.cpp:1966-2025`, `readFileSignatures`).
 * 2. `CheckMonsters` over the world, and the state (`GameRead.state`).
 * 3. `ReadExtendedFeatures`' rule flags, graphics signatures and overlay
 *    (`doc/CSBwin-src/SaveGame.cpp:380-383`, `:394-400`, `Overlay.readExtendedFeatures`).
 *    A file with no block leaves them as they were.
 * 4. The world (`Game.installWorld`), and the state over it (`Game.applyRuntimeSaveState`).
 */
export function readGame(game: Game, read: GameRead): void {
    const { ctx } = game;
    readFileSignatures(ctx, read.world);
    const state = read.state();
    readRulesOptions(ctx.rules, read.extendedFeatures, read.simpleEncipher);
    readExpectedSignatures(ctx.signatures, read.extendedFeatures);
    ctx.overlay.readExtendedFeatures(read.extendedFeatures);
    game.installWorld(read.world);
    game.applyRuntimeSaveState(state);
}
