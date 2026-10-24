/**
 * A scripted fortnight of the statistics' events (`doc/STATISTICS.md`): four players, the
 * sets `dm-atari` and `csb`, and `secret`, which no answer may name. `tools/checks/stats.ts`
 * asserts the aggregates the store makes of it, and the dev server answers `api/stats` over
 * a store of it (`vite.config.mts`), so that the statistics page has something to show.
 */
import { checkEvent } from '../../server/events.ts';
import type { StatsStore } from '../../server/stats.ts';

export const P1 = '11111111-1111-4111-8111-111111111111';
export const P2 = '22222222-2222-4222-8222-222222222222';
export const P3 = '33333333-3333-4333-8333-333333333333';
/** The player of a set that is not public, and of a session of a game the store has no row of. */
export const P4 = '44444444-4444-4444-8444-444444444444';

/** A champion as the page reports one: its id a cell of graphic 26, or `null` from a save. */
export const ch = (name: string, id: number | null = 0, more: object = {}) => ({ name, id, ...more });

/** An event's body, as the page sends it. */
export function event(type: string, player: string, set: string, playthrough: number, payload: object, extra: object = {}): string {
    return JSON.stringify({ type, player, set, playthrough, build: 'abc1234', payload, ...extra });
}

export const day = (date: string, hour = 10) => Date.parse(`${date}T${String(hour).padStart(2, '0')}:00:00Z`);

/** A won game's champion: its masteries are its event's, after `reincarnated` and `hero` where they were. */
export const winner = (name: string, id: number | null = 0, hero?: string) =>
    ch(name, id, { ...(hero !== undefined ? { reincarnated: true, hero } : {}), masteries: [1, 2, 3, 4] });
export const won = (player: string, playthrough: number, gameTime: number, playTime: number, champions: object[]) =>
    event('won', player, 'dm-atari', playthrough, { gameTime, playTime, champions });
export const session = (player: string, set: string, playthrough: number, playTime: number) =>
    event('session', player, set, playthrough, { playTime });

/** A fortnight of four players, scripted: see the expected aggregates below. */
export const FORTNIGHT: [number, string][] = [
    [day('2026-10-05'), event('started', P1, 'dm-atari', 1, {})],
    [day('2026-10-05'), session(P1, 'dm-atari', 1, 0)],
    // A save continued: its play time is under its game's win, which counts.
    [day('2026-10-06', 9), session(P1, 'dm-atari', 1, 200_000)],
    [day('2026-10-05', 11), event('party', P1, 'dm-atari', 1, { champions: [ch('HALK', 3)] })],
    // WU TSE joined by REINCARNATE, as TSE: a pick of WU TSE.
    [day('2026-10-05', 12), event('party', P1, 'dm-atari', 1, { champions: [ch('HALK', 3), ch('TSE', 9, { reincarnated: true, hero: 'WU TSE' })] })],
    // 1,000 ticks in 5 minutes: 18,000 VBLs.
    [day('2026-10-07'), won(P1, 1, 1000, 300_000, [winner('HALK', 3), winner('TSE', 9, 'WU TSE')])],
    // A game's second start, from a save of it read again: no row, and nothing changed.
    [day('2026-10-08', 9), event('started', P1, 'dm-atari', 1, {})],
    [day('2026-10-06'), event('started', P2, 'dm-atari', 2, {})],
    [day('2026-10-06', 11), event('party', P2, 'dm-atari', 2, { champions: [ch('HALK', 3), ch('KID', 1, { reincarnated: true, hero: 'BOB' })] })],
    // A save of it read: KID, unflagged, no pick, BOB's slot having one.
    [day('2026-10-06', 12), event('lost', P2, 'dm-atari', 2, { gameTime: 50, playTime: 60, champions: [ch('HALK', null), ch('KID', null)], level: 1, x: 2, y: 3 })],
    [day('2026-10-06', 13), event('lost', P2, 'dm-atari', 2, { gameTime: 50, playTime: 90, champions: [ch('HALK', null)], level: 1, x: 2, y: 3 })],
    [day('2026-10-06', 14), event('lost', P2, 'dm-atari', 2, { gameTime: 70, playTime: 99, champions: [ch('HALK', null)], level: 1, x: 4, y: 3 })],
    [day('2026-10-08'), event('started', P3, 'dm-atari', 6, {})],
    [day('2026-10-08', 12), won(P3, 6, 500, 60_000, [winner('ROSE')])],
    [day('2026-10-09'), event('started', P1, 'dm-atari', 7, {})],
    [day('2026-10-09', 11), won(P1, 7, 500, 600_000, [winner('HALK', 3)])],
    // A game's second win, from an earlier save: its first is kept, and nothing of the second.
    [day('2026-10-09', 12), won(P1, 7, 1, 600_000, [winner('SYRA')])],
    // 121 ticks in a second's 60 VBLs, beyond the second's slack: a win, not ranked.
    [day('2026-10-10'), event('started', P2, 'dm-atari', 8, {})],
    [day('2026-10-10', 11), won(P2, 8, 121, 1000, [winner('BOB', 1)])],
    // 120: just possible.
    [day('2026-10-10', 12), event('started', P2, 'dm-atari', 9, {})],
    [day('2026-10-10', 13), won(P2, 9, 120, 1000, [winner('BOB', 1)])],
    [day('2026-10-11'), event('started', P2, 'csb', 3, {})],
    [day('2026-10-12'), event('started', P1, 'dm-atari', 4, {})],
    [day('2026-10-12'), session(P1, 'dm-atari', 4, 0)],
    // A game's play time is the largest a session reported, an earlier save's read after.
    [day('2026-10-13', 9), session(P1, 'dm-atari', 4, 3_600_000)],
    [day('2026-10-13', 20), session(P1, 'dm-atari', 4, 1_000_000)],
    // A win whose start never came, as an imported CSBWin save's: a win, not ranked.
    [day('2026-10-13'), won(P1, 5, 9, 8, [winner('SYRA', null)])],
    [day('2026-10-14'), event('lost', P3, 'csb', 3, { gameTime: 7, playTime: 6, champions: [ch('GOTHMOG', null)], level: 0, x: 5, y: 5 })],
    // Hours rank the sets: CSB's one game outplays DM's.
    [day('2026-10-14', 12), session(P3, 'csb', 3, 9_000_000)],
    // A session of a game the store has no row of, an imported save's: its week counts, and
    // neither its play time nor its player, of whom no row is made.
    [day('2026-10-14', 13), session(P4, 'dm-atari', 11, 7_200_000)],
    // A set that is not public: in none of the answers.
    [day('2026-10-06'), event('started', P4, 'secret', 10, {})],
    [day('2026-10-06', 11), event('lost', P4, 'secret', 10, { gameTime: 7, playTime: 6, champions: [ch('GOTHMOG')], level: 0, x: 5, y: 5 })],
    [day('2026-10-06', 12), session(P4, 'secret', 10, 50)],
];

/** `store` given the fortnight's events, each checked as `api/event` checks it. */
export function fillFortnight(store: StatsStore): void {
    for (const [time, body] of FORTNIGHT) {
        const checked = checkEvent(body, { hasSet: () => true });
        if (typeof checked === 'string') throw new Error(`refused (${checked}): ${body}`);
        store.record(checked, time);
    }
}
