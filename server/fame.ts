/**
 * The Hall of Fame's answers (`doc/ACHIEVEMENTS.md` → "The Hall of Fame"), which the Hall's
 * page reads (`src/fame/famePage.ts`): what the replays of the proofs verified
 * (`ProofStore.hall`), told by the players' public names. `app.ts` answers the routes,
 * cached as `api/stats`' are (`answerFame`); this module counts.
 *
 *   GET FAME_ROUTE                         every public set's figures (`fameSummary`)
 *   GET FAME_ROUTE/FAME_SETS/<id>          a public set's achievements (`fameSet`)
 *   GET FAME_ROUTE/FAME_PLAYERS/<public id>  a player's badges (`famePlayer`)
 *
 * **A player of the Hall** is an identity with a public name (`identity.ts`), counted once
 * whatever browsers it links, who has verified an achievement of the set; an identity a
 * moderator reset is no player of the Hall until it chooses another name. A set's
 * achievements are the build's (`achievementDefs`, `src/ui/achievementFiles.ts`), which
 * the server reads through the page's readers (`PageReaders.js`, `app.ts`): an unlock
 * whose id the set's file no longer holds is not counted.
 *
 * No answer holds a `playerId`, a playthrough or a proof's id: a player is their name and
 * their public id.
 */
import type { FameDef, FamePlayer, FamePlayerPage, FameSet, FameSummary, StatsSet } from './answers.ts';
import type { HallRow } from './proofs.ts';

/** The build's achievements of a set, the common file's merged with its own (`achievementDefs`); `null` where they do not read. */
export type AchievementDefsOf = (setId: string) => readonly FameDef[] | null;

/** A set's rows among `rows`, those of an achievement its file holds, by achievement, each its players' in `rows`' order (the first first). */
function setRows(set: StatsSet, rows: readonly HallRow[], defsOf: AchievementDefsOf): { defs: readonly FameDef[]; byAchievement: Map<string, HallRow[]> } {
    const defs = defsOf(set.id) ?? [];
    const byAchievement = new Map<string, HallRow[]>(defs.map((def) => [def.id, []]));
    for (const row of rows) if (row.dataSet === set.id) byAchievement.get(row.achievement)?.push(row);
    return { defs, byAchievement };
}

/** The identities among `byAchievement`'s rows. */
function playersIn(byAchievement: ReadonlyMap<string, readonly HallRow[]>): Set<string> {
    return new Set([...byAchievement.values()].flatMap((rows) => rows.map((row) => row.identity)));
}

/** `api/fame`: `sets`' figures, the most players of the Hall first, then in `sets`' order. */
export function fameSummary(sets: readonly StatsSet[], rows: readonly HallRow[], defsOf: AchievementDefsOf): FameSummary {
    const everyone = new Set<string>();
    const figures = sets.map((set) => {
        const { defs, byAchievement } = setRows(set, rows, defsOf);
        const players = playersIn(byAchievement);
        for (const player of players) everyone.add(player);
        const verified = [...byAchievement.values()].filter((theirs) => theirs.length > 0).length;
        return { id: set.id, name: set.name, players: players.size, achievements: defs.length, verified };
    });
    return { players: everyone.size, sets: figures.sort((a, b) => b.players - a.players) };
}

/** `api/fame/sets/<id>`: `set`'s achievements in its file's order, each with its players, their share and the first. */
export function fameSet(set: StatsSet, rows: readonly HallRow[], defsOf: AchievementDefsOf): FameSet {
    const { defs, byAchievement } = setRows(set, rows, defsOf);
    const players = playersIn(byAchievement).size;
    return {
        id: set.id, name: set.name, players,
        achievements: defs.map(({ id, name, text, tier }) => {
            const theirs = byAchievement.get(id) ?? [];
            const first: FamePlayer | null = theirs[0] ? { id: theirs[0].identity, name: theirs[0].name } : null;
            return { id, name, text, tier, players: theirs.length, share: players === 0 ? 0 : theirs.length / players, first };
        }),
    };
}

/**
 * `api/fame/players/<public id>`: `player`'s badges, `rows` theirs alone (`ProofStore.hall`),
 * by set in `sets`' order, each set's in its file's order, with the day, UTC, its first proof
 * was checked; a set they verified nothing of is left out.
 */
export function famePlayer(player: FamePlayer, sets: readonly StatsSet[], rows: readonly HallRow[], defsOf: AchievementDefsOf): FamePlayerPage {
    const badges = sets.map((set) => {
        const { defs, byAchievement } = setRows(set, rows.filter((row) => row.identity === player.id), defsOf);
        const achievements = defs.flatMap(({ id, name, text, tier }) => {
            const row = byAchievement.get(id)?.[0];
            return row ? [{ id, name, text, tier, day: new Date(row.at).toISOString().slice(0, 10) }] : [];
        });
        return { id: set.id, name: set.name, achievements };
    });
    return { id: player.id, name: player.name, sets: badges.filter((set) => set.achievements.length > 0) };
}
