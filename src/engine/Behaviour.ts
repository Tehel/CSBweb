/**
 * The engine's behaviour as a recording was made (`doc/RECORDING.md` → "A recording's
 * level"): every old behaviour the engine keeps beside the new one, behind a flag a
 * recording of an earlier level turns on, as CSBWin keeps 9.0's behind
 * `version90Compatible` (`doc/CSBwin-src/Recording.cpp:172-180`,
 * `doc/CSBwin-src/Code11f52.cpp:907-910`).
 *
 * `ENGINE_LEVEL` is bumped, by one, by a commit that changes what a tick does from the
 * same inputs: the engine, and the interface's hit tests and the viewport's picking that
 * turn a logged click into an action. A change that only draws bumps nothing, nor a new
 * extra, off by default. The commit that bumps it keeps the old lines verbatim behind a
 * flag of `BEHAVIOURS`, `if (ctx.behaviour.<name>) { old } else { new }`, whose `until` is
 * the new level. A flag is never removed: an old recording a player kept may be imported
 * at any time.
 *
 * A game the page plays is at `ENGINE_LEVEL`, every flag off (`CURRENT_BEHAVIOUR`); a
 * recording is played at its own (`Recording.level`), each flag whose `until` is above it
 * on (`RecordingPlayer`). A recording of a level above `ENGINE_LEVEL`, a later build's, is
 * refused before it plays (`knownLevel`).
 */

/** The engine's level: what a recording made now carries (`Recording.level`). Recordings made before levels are 0. */
export const ENGINE_LEVEL = 0;

/** An old behaviour the engine keeps. */
export interface BehaviourChange {
    /** The flag, named for the behaviour it keeps, as `version90Compatible` is. */
    readonly name: string;
    /** What the old behaviour does. */
    readonly does: string;
    /** The debt ID of the commit that changed it (`git log --grep`). */
    readonly debt: string;
    /** The level the change made: a recording below it plays the old behaviour. */
    readonly until: number;
}

/** Every old behaviour the engine keeps, in the order of their levels. */
export const BEHAVIOURS = [] as const satisfies readonly BehaviourChange[];

export type BehaviourName = (typeof BEHAVIOURS)[number]['name'];

/**
 * The behaviour a game plays by (`GameContext.behaviour`): its level, and a flag per old
 * behaviour, on where the level is below its `until`.
 */
export type Behaviour = { readonly level: number } & { readonly [name in BehaviourName]: boolean };

/** Whether this engine plays `level`: an integer from 0 to `ENGINE_LEVEL`. */
export function knownLevel(level: number): boolean {
    return Number.isSafeInteger(level) && level >= 0 && level <= ENGINE_LEVEL;
}

/** The behaviour of `level`, which must be a known one (`knownLevel`), frozen. */
export function behaviourAt(level: number): Behaviour {
    if (!knownLevel(level)) throw new Error(`level ${level} is not one this engine plays`);
    const changes: readonly BehaviourChange[] = BEHAVIOURS;
    return Object.freeze({ level, ...Object.fromEntries(changes.map((change) => [change.name, level < change.until])) }) as Behaviour;
}

/** The behaviour of `ENGINE_LEVEL`: every flag off, the game a page plays. */
export const CURRENT_BEHAVIOUR = behaviourAt(ENGINE_LEVEL);
