/**
 * What `api/stats` answers (`stats.ts`), as the statistics page reads it
 * (`src/stats/statsPage.ts`), and the champions an event names (`events.ts`). The page's
 * project checks this module, so it imports nothing, of Node's least of all.
 */

export interface CheckedChampion {
    name: string;
    id: number | null;
    reincarnated?: true;
    /** A reincarnated champion's mirror name, which the statistics count them by. */
    hero?: string;
    masteries?: number[];
}

/** A set as the answers name it: the `data_sets` table's id and name. */
export interface StatsSet {
    id: string;
    name: string;
}

/** `api/stats`: every public set, and their totals. Aggregates only. */
export interface StatsSummary {
    /** Distinct players of the sets' games, ever. */
    players: number;
    /** The time played, in ms: the sum of each game's largest play time reported (`games.played`). */
    playTime: number;
    sessions: number;
    started: number;
    won: number;
    /** Sessions and games started per week (from Monday, UTC), all sets together, the weeks with one. */
    weeks: { week: string; sessions: number; started: number }[];
    /** Each set, by play time, decreasing, then by games started, decreasing, then by name. */
    sets: (StatsSet & { playTime: number; sessions: number; started: number; won: number; deaths: number })[];
}

/** A won game as a set's answer lists it. */
export interface Win {
    /** Its day, `YYYY-MM-DD`, UTC. */
    day: string;
    /** The game clock, in ticks, and the play time, in ms, the page sent. */
    gameTime: number;
    playTime: number;
    champions: CheckedChampion[];
}

/** `api/stats/<set>/<level>`: the lost games on each of a set's level's squares. */
export interface LevelStats extends StatsSet {
    level: number;
    /** The most first, at most `DEATH_SQUARES` (`stats.ts`), then by x and y. */
    deaths: { x: number; y: number; count: number }[];
}

/** `api/stats/<set>`: one set's aggregates. Never an event, a player or a playthrough. */
export interface SetStats extends StatsSet {
    players: number;
    /** The time played, in ms, as the summary's. */
    playTime: number;
    sessions: number;
    started: number;
    won: number;
    /** The games a champion was ever in a party of. */
    parties: number;
    /** The lost games, every one: a party may die several times in a game. */
    died: number;
    /**
     * The fastest wins by game clock, then the earlier, then the game first received, of the
     * games whose start was received and whose clock its play time could have run
     * (`stats.ts`'s `CLOCK_SLACK_TICKS`).
     */
    fastest: Win[];
    /** The lost games on each level, by level: its squares are the level's answer. */
    levels: { level: number; count: number }[];
    /** The games a champion was in a party of, and won, by their mirror's name (`picks`), the most first. */
    champions: { name: string; games: number; won: number }[];
    /** Sessions, games started and games won per week, the weeks with one. */
    weeks: { week: string; sessions: number; started: number; won: number }[];
}
