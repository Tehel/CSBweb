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
 * diff of its source against 2023's (`doc/CSBWIN_REFERENCE_INDEX.md` → "The older
 * trees"), and where the port parts
 * from CSBWin on purpose (`DEBT.md` H) and the version's runs need CSBWin's way, 2023's
 * among them (`csbwinScentLoops`). A run of that version
 * (`DEBT.md` F24) plays at a profile, which its recording carries beside its level
 * (`Recording.profile`); a game the page plays has none. A flag a profile plays names it
 * with the level it joined the profile at, so that a flag added to a profile bumps
 * `ENGINE_LEVEL` and leaves the profile's recordings of an earlier level as they were made.
 */

/** The engine's level: what a recording made now carries (`Recording.level`). Recordings made before levels are 0. */
export const ENGINE_LEVEL = 6;

/** A CSBWin version whose runs the engine plays by the flags that name it. */
export interface BehaviourProfile {
    /** Its name, `csbwin-<version>`, which a recording carries (`Recording.profile`). */
    readonly name: string;
    /** The version it plays, and the runs it is for. */
    readonly does: string;
    /** The source its flags are read from, beside 2023's (`npm run fetch-csbwin-src -- --version=`). */
    readonly source: string;
}

/** The CSBWin versions whose runs the engine plays as they were recorded. */
export const PROFILES = [
    {
        name: 'csbwin-2023',
        does: "CSBWin's 2023 source, which the engine follows but where the port parts from it on purpose, for the runs of CSBWin 17.6 (DMMovie2615, DMMovie2823, CSBMovie0640) and 2023.05.20 (CSBFullRecordingV4)",
        source: 'doc/CSBwin-src/',
    },
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
    {
        name: 'releaseScentLoops',
        does: "the release's scents: a step writes every strength with the square left's sum then the new print's 24 (the Amiga's tables, only the prints on each square), print k's strength written at N-1-k, 0 included, and the decay lowers the party's square's print too, but on the Amiga's (`PartyFootprints.ts`)",
        debt: 'R18',
        until: 2,
    },
    {
        name: 'csbwinScentLoops',
        does: "CSBWin's scents: the release's on the Atari, but `AddFootprintEntry` never writes strength 0 (`while (index-- != 1)`) and the decay stops after dropping the oldest print (`PartyFootprints.ts`)",
        debt: 'R18',
        until: null,
        profiles: { 'csbwin-2023': 2, 'csbwin-11.014': 2 },
    },
    {
        name: 'tag016426StatisticIgnored',
        does: "CSBWin 11.014's `TAG016426`, `170 - w_10/256`: the Atari's compiler bug (ReDMCSB's `BUG0_41`), which reads every statistic as 0, so Antifire and Antimagic are ignored and Vitality against poison and a wound (`ChampionDamage.attributeScaledReduction`)",
        debt: 'R18',
        until: null,
        profiles: { 'csbwin-11.014': 3 },
    },
    {
        name: 'missileRangeFromDexterity',
        does: "CSBWin 11.014's range of a monster's missile, from `uByte8[4]/4 + 1`, its dexterity, which is also the missile's damage, where 2023 and the Atari take its attack (`MonsterAttack.fillAttackParameters`)",
        debt: 'R18',
        until: null,
        profiles: { 'csbwin-11.014': 4 },
    },
    {
        name: 'magicDamageThroughArmour',
        does: "the port's magic damage to a champion, multiplied by `130 - armour` over 64 as the other kinds are after its Antimagic and spell shield, about twice the blow on an unarmoured champion, where CSBWin and the Atari skip the armour (`ChampionDamage.damageCharacter`)",
        debt: 'F24',
        until: 5,
    },
    {
        name: 'skippedStepForgetsParty',
        does: "a step back the 1-in-4 roll skips goes on to the next direction, where CSBWin and the Atari read the last `PossibleMove`'s `moveOntoPartyPosition` and may attack or remember the party's square (`MonsterAI.tryDirectionsD5ToD4`)",
        debt: 'F24',
        until: 5,
    },
    {
        name: 'csbwinDoorsSidewaysToMonsters',
        does: "CSBWin's `PossibleMove`, which reads a door's up-down bit as `BITS5_5(mode())`, `mode()` being that bit already, so always 0: every door, up-down too, lets a monster by only open to state 1 or less, where the Atari lets one by an up-down door up to its height (`MonsterPerception.possibleMove`)",
        debt: 'F24',
        until: null,
        profiles: { 'csbwin-2023': 5, 'csbwin-11.014': 5 },
    },
    {
        name: 'actuatorWord8BigEndian',
        does: "a big actuator's `word8`, bits 16-17 of a DSA's parameters A and B, read big-endian as the record's other words, where CSBWin's `DB3::swap` leaves it as the file has it, which its little-endian build reads swapped: a location's corner in parameter A lost, Conflux's wave DSA messaging corner 0 (`actuatorHelpers.getActuatorDsaParameters`)",
        debt: 'F24',
        until: 6,
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
