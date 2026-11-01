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
 *
 * A CSBWin version's behaviour is a profile of the same flags (`PROFILES`): what that
 * version did where 2023's source, which the engine follows, does otherwise, read from a
 * diff of its source against 2023's (`DEBT.md` R18, step 5). A run of that version
 * (`DEBT.md` F24) plays at a profile, which its recording carries beside its level
 * (`Recording.profile`); a game the page plays has none. A flag a profile plays names it
 * with the level it joined the profile at, so that a flag added to a profile bumps
 * `ENGINE_LEVEL` and leaves the profile's recordings of an earlier level as they were made.
 */

/** The engine's level: what a recording made now carries (`Recording.level`). Recordings made before levels are 0. */
export const ENGINE_LEVEL = 1;

/** A CSBWin version whose runs the engine plays by the flags that name it. */
export interface BehaviourProfile {
    /** Its name, `csbwin-<version>`, which a recording carries (`Recording.profile`). */
    readonly name: string;
    /** The version it plays, and the runs it is for. */
    readonly does: string;
    /** The source its flags are read from, beside 2023's (`npm run fetch-csbwin-src -- --version=`). */
    readonly source: string;
}

/** The CSBWin versions the engine plays besides 2023's. */
export const PROFILES = [
    {
        name: 'csbwin-11.014',
        does: 'CSBWin 11.014, the nearest source to 11.017 and 11.018, which recorded the 11.0xx runs (DMMovie42, 43a, 43b, 45)',
        source: 'doc/CSBwin-src-11.014/',
    },
] as const satisfies readonly BehaviourProfile[];

export type ProfileName = (typeof PROFILES)[number]['name'];

/** An old behaviour the engine keeps: the port's own before a change of play, or a CSBWin version's. */
export interface BehaviourChange {
    /** The flag, named for the behaviour it keeps, as `version90Compatible` is. */
    readonly name: string;
    /** What the old behaviour does. */
    readonly does: string;
    /** The debt ID of the commit that changed it (`git log --grep`). */
    readonly debt: string;
    /**
     * The level the change made: a recording below it plays the old behaviour. `null` for a
     * behaviour the port never had, a CSBWin version's, which only its profiles play.
     */
    readonly until: number | null;
    /**
     * The profiles that play the old behaviour, each with the level it joined it at: a
     * recording of that profile at that level or above plays it.
     */
    readonly profiles?: { readonly [profile in ProfileName]?: number };
}

/** Every old behaviour the engine keeps, in the order of their levels. */
export const BEHAVIOURS = [
    {
        name: 'smartDiscardDrawnPriority',
        does: "CSBWin 11.014's SmartDiscard: every object not important is scanned into a list ranked by a priority drawn afresh at each comparison, so the discard draws all game long (`SmartDiscard11014.ts`)",
        debt: 'R18',
        until: null,
        profiles: { 'csbwin-11.014': 1 },
    },
] as const satisfies readonly BehaviourChange[];

export type BehaviourName = (typeof BEHAVIOURS)[number]['name'];

/**
 * The behaviour a game plays by (`GameContext.behaviour`): its level, its profile, and a
 * flag per old behaviour, on where the level is below its `until` or the profile plays it.
 */
export type Behaviour = { readonly level: number; readonly profile: ProfileName | null } & { readonly [name in BehaviourName]: boolean };

/** Whether this engine plays `level`: an integer from 0 to `ENGINE_LEVEL`. */
export function knownLevel(level: number): boolean {
    return Number.isSafeInteger(level) && level >= 0 && level <= ENGINE_LEVEL;
}

/** Whether this engine plays `profile`: one of `PROFILES`, or `null`, none. */
export function knownProfile(profile: string | null): profile is ProfileName | null {
    return profile === null || PROFILES.some((known) => known.name === profile);
}

/** Whether `change` is on at `level` and `profile`. */
export function playsOld(change: BehaviourChange, level: number, profile: ProfileName | null): boolean {
    const since = profile === null ? undefined : change.profiles?.[profile];
    return (change.until !== null && level < change.until) || (since !== undefined && level >= since);
}

/** The behaviour of `level` and `profile`, which must be known ones (`knownLevel`, `knownProfile`), frozen. */
export function behaviourAt(level: number, profile: string | null = null): Behaviour {
    if (!knownLevel(level)) throw new Error(`level ${level} is not one this engine plays`);
    if (!knownProfile(profile)) throw new Error(`profile ${profile} is not one this engine plays`);
    const changes: readonly BehaviourChange[] = BEHAVIOURS;
    return Object.freeze({
        level, profile, ...Object.fromEntries(changes.map((change) => [change.name, playsOld(change, level, profile)])),
    }) as Behaviour;
}

/** The behaviour of `ENGINE_LEVEL` and no profile: every flag off, the game a page plays. */
export const CURRENT_BEHAVIOUR = behaviourAt(ENGINE_LEVEL);
