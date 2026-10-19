/**
 * The statistics' store and what it accepts (`doc/STATISTICS.md`): `server/events.ts`,
 * which checks an event and rebuilds it, `server/store.ts`, the SQLite file, and
 * `server/stats.ts`, its `events` table and their aggregates. `dump-server` asks the same
 * over HTTP; `dump-game-events` passes the real engine's events through the same check.
 *
 * Asserts:
 *   - an event of each type passes, rebuilt from its checked fields only: what the page
 *     did not send under a known name is dropped;
 *   - every field that could carry free text or nonsense is refused: a player that is not
 *     a UUID, an unknown set or type, a build that is not a token, a number out of its
 *     range, a champion's name past 7 characters, blank, or with a character a name
 *     cannot hold (lower case, a control, a NUL, a bidi override, markup), a fifth
 *     champion, masteries that are not four;
 *   - the store: the schema made in a missing file, WAL mode, and the WAL checkpointed into
 *     the file on close, which holds the events when it is opened again;
 *   - the aggregates of a scripted fortnight, exactly, as the events arrive: the summary of
 *     the public sets (players, games started and won, the weeks, the sets by games started)
 *     and each set's (its figures, its fastest wins by game clock, of the games whose start
 *     came and whose clock their play time could run, the first win of a game only, the
 *     deaths per level, the champions, the weeks) and each level's (its deaths per square,
 *     the most first); nothing of a set not public;
 *     no player id or build in them;
 *   - the same aggregates made from the log alone, for a store of events only;
 *   - the cache: an answer kept for its lifetime, made again after;
 *   - 200,000 events: the aggregates made from them once, then every answer in milliseconds,
 *     and small.
 *
 * Usage: npm test -- --only=dump-stats.ts
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { checkEvent, RateLimit, type CheckedEvent, type EventRules } from '../server/events.ts';
import { AnswerCache, DEATH_SQUARES, StatsStore, type LevelStats, type SetStats, type StatsSet, type StatsSummary } from '../server/stats.ts';
import { openStore } from '../server/store.ts';
import { check, finish } from './lib/check';

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const P3 = '33333333-3333-4333-8333-333333333333';

const P4 = '44444444-4444-4444-8444-444444444444';

const RULES: EventRules = { hasSet: (id) => ['dm-atari', 'csb', 'conflux', 'secret'].includes(id) };

/** A champion as the page reports one: its id a cell of graphic 26, or `null` from a save. */
const ch = (name: string, id: number | null = 0, more: object = {}) => ({ name, id, ...more });

function event(type: string, player: string, set: string, playthrough: number, payload: object, extra: object = {}): string {
    return JSON.stringify({ type, player, set, playthrough, build: 'abc1234', payload, ...extra });
}

function accepted(body: string): CheckedEvent {
    const checked = checkEvent(body, RULES);
    if (typeof checked === 'string') throw new Error(`refused (${checked}): ${body}`);
    return checked;
}

function checkTheChecks(): void {
    console.log('What api/event accepts:');
    const party = accepted(event('party', P1, 'dm-atari', 7, {
        champions: [ch('HALK', 3), ch('BOB', 7, { reincarnated: true, note: 'free text' }), ch('ROSE', null), ch("D'AR.-2", 0x7fff)],
        note: 'free text',
    }, { note: 'free text' }));
    console.log(`  party: ${JSON.stringify(party)}`);
    check(JSON.stringify(party) === JSON.stringify({
        type: 'party', player: P1, set: 'dm-atari', playthrough: 7, build: 'abc1234',
        payload: { champions: [ch('HALK', 3), ch('BOB', 7, { reincarnated: true }), ch('ROSE', null), ch("D'AR.-2", 0x7fff)] },
    }), 'party: rebuilt, unknown fields dropped, every name and id as sent');
    const typed = accepted(event('party', P1, 'csb', 1, { champions: [ch('A B.,;:'), ch('!?/'), ch('ÀÖØÝ')] }));
    check(JSON.stringify(typed.payload) === JSON.stringify({ champions: [ch('A B.,;:'), ch('!?/'), ch('ÀÖØÝ')] }),
        'names of the Reincarnate screen\'s punctuation, and of the rest a name may hold');

    const won = accepted(event('won', P1, 'dm-atari', 7, { gameTime: 123456, playTime: 7890000, champions: [ch('SYRA', 2, { masteries: [1, 2, 3, 15] })] }));
    console.log(`  won  : ${JSON.stringify(won.payload)}`);
    check(JSON.stringify(won.payload) === '{"gameTime":123456,"playTime":7890000,"champions":[{"name":"SYRA","id":2,"masteries":[1,2,3,15]}]}',
        'won: its times and masteries');
    const lost = accepted(event('lost', P1, 'csb', 0xffffffff, { gameTime: 0, playTime: 0, champions: [ch('ÉLÉONOR')], level: 3, x: 31, y: 0 }));
    console.log(`  lost : ${JSON.stringify(lost.payload)}`);
    check(JSON.stringify(lost.payload) === '{"gameTime":0,"playTime":0,"champions":[{"name":"ÉLÉONOR","id":0}],"level":3,"x":31,"y":0}',
        'lost: its square; a name of 7 characters, counted as characters');
    const started = accepted(event('started', P1, 'csb', 0, { anything: 'free text' }));
    check(JSON.stringify(started.payload) === '{}', 'started: an empty payload, whatever was sent');

    console.log('\nWhat it refuses:');
    const champion = ch('HALK', 0, { masteries: [1, 1, 1, 1] });
    const refusals: [string, string][] = [
        ['{', 'not JSON'],
        ['[]', 'not an object'],
        [event('visit', P1, 'csb', 1, {}), 'unknown type'],
        [event('started', 'PLAYERNAME', 'csb', 1, {}), 'player is not a UUID'],
        [event('started', 'ABCDEF01-2345-4678-89AB-CDEF01234567', 'csb', 1, {}), 'player is not a UUID'],
        [event('started', P1, '3d2d1d', 1, {}), 'unknown set'],
        [event('started', P1, 'csb', -1, {}), 'bad playthrough'],
        [event('started', P1, 'csb', 0x100000000, {}), 'bad playthrough'],
        [event('started', P1, 'csb', 1.5, {}), 'bad playthrough'],
        [event('started', P1, 'csb', 1, {}, { build: 'a build with spaces' }), 'bad build'],
        [event('started', P1, 'csb', 1, {}, { build: '' }), 'bad build'],
        [event('started', P1, 'csb', 1, {}, { payload: null }), 'payload is not an object'],
        [event('party', P1, 'csb', 1, {}), 'bad champions'],
        [event('party', P1, 'csb', 1, { champions: [champion, champion, champion, champion, champion] }), 'bad champions'],
        [event('party', P1, 'csb', 1, { champions: ['HALK'] }), 'bad champion'],
        [event('party', P1, 'csb', 1, { champions: [{ name: 7, id: 0 }] }), 'bad name'],
        [event('party', P1, 'csb', 1, { champions: [{ name: null, id: 0 }] }), 'bad name'],
        [event('party', P1, 'csb', 1, { champions: [ch('ABCDEFGH')] }), 'bad name'],
        [event('party', P1, 'csb', 1, { champions: [ch('')] }), 'bad name'],
        [event('party', P1, 'csb', 1, { champions: [ch('   ')] }), 'bad name'],
        [event('party', P1, 'csb', 1, { champions: [ch('Halk')] }), 'bad name'],
        [event('party', P1, 'csb', 1, { champions: [ch('HA\nLK')] }), 'bad name'],
        [event('party', P1, 'csb', 1, { champions: [ch('HA\0LK')] }), 'bad name'],
        [event('party', P1, 'csb', 1, { champions: [ch('\u202eKLAH')] }), 'bad name'],
        [event('party', P1, 'csb', 1, { champions: [ch('<B>')] }), 'bad name'],
        [event('party', P1, 'csb', 1, { champions: [ch('A&B')] }), 'bad name'],
        [event('party', P1, 'csb', 1, { champions: [ch('"A"')] }), 'bad name'],
        [event('party', P1, 'csb', 1, { champions: [ch('×')] }), 'bad name'],
        [event('party', P1, 'csb', 1, { champions: [{ name: 'HALK' }] }), 'bad id'],
        [event('party', P1, 'csb', 1, { champions: [ch('HALK', -1)] }), 'bad id'],
        [event('party', P1, 'csb', 1, { champions: [ch('HALK', 0x8000)] }), 'bad id'],
        [event('party', P1, 'csb', 1, { champions: [ch('HALK', 0, { reincarnated: 'yes' })] }), 'bad reincarnated'],
        [event('won', P1, 'csb', 1, { gameTime: 1, playTime: 1, champions: [ch('HALK')] }), 'bad masteries'],
        [event('won', P1, 'csb', 1, { gameTime: 1, playTime: 1, champions: [ch('HALK', 0, { masteries: [1, 1, 1] })] }), 'bad masteries'],
        [event('won', P1, 'csb', 1, { gameTime: 1, playTime: 1, champions: [ch('HALK', 0, { masteries: [1, 1, 1, 64] })] }), 'bad masteries'],
        [event('won', P1, 'csb', 1, { gameTime: -1, playTime: 1, champions: [] }), 'bad gameTime'],
        [event('won', P1, 'csb', 1, { gameTime: 1, playTime: '1', champions: [] }), 'bad playTime'],
        [event('lost', P1, 'csb', 1, { gameTime: 1, playTime: 1, champions: [], level: 0, x: 256, y: 0 }), 'bad square'],
        [event('lost', P1, 'csb', 1, { gameTime: 1, playTime: 1, champions: [], level: 0, x: 0 }), 'bad square'],
    ];
    for (const [body, why] of refusals) {
        const answer = checkEvent(body, RULES);
        check(answer === why, `${body}: ${typeof answer === 'string' ? answer : 'accepted'}`);
    }
    console.log(`  ${refusals.length} refused, each for its reason`);

    const limit = new RateLimit(3, 60_000);
    const allowed = [0, 1, 2, 3].map((i) => limit.allow('a', 1000 + i));
    check(allowed.join() === 'true,true,true,false' && limit.allow('b', 1004), 'the rate limit: three per window and address');
    check(limit.allow('a', 61_000), 'and a new window starts the count again');
}

const day = (date: string, hour = 10) => Date.parse(`${date}T${String(hour).padStart(2, '0')}:00:00Z`);

/** A won game's champion: its masteries are its event's. */
const winner = (name: string, id: number | null = 0) => ch(name, id, { masteries: [1, 2, 3, 4] });
const won = (player: string, playthrough: number, gameTime: number, playTime: number, champions: object[]) =>
    event('won', player, 'dm-atari', playthrough, { gameTime, playTime, champions });

/** A fortnight of four players, scripted: see the expected aggregates below. */
const FORTNIGHT: [number, string][] = [
    [day('2026-10-05'), event('started', P1, 'dm-atari', 1, {})],
    [day('2026-10-05', 11), event('party', P1, 'dm-atari', 1, { champions: [ch('HALK', 3)] })],
    [day('2026-10-05', 12), event('party', P1, 'dm-atari', 1, { champions: [ch('HALK', 3), ch('WU TSE', 9)] })],
    // 1,000 ticks in 5 minutes: 18,000 VBLs.
    [day('2026-10-07'), won(P1, 1, 1000, 300_000, [winner('HALK', 3), winner('WU TSE', 9)])],
    [day('2026-10-08', 9), event('started', P1, 'dm-atari', 1, {})],
    [day('2026-10-06'), event('started', P2, 'dm-atari', 2, {})],
    [day('2026-10-06', 11), event('party', P2, 'dm-atari', 2, { champions: [ch('HALK', 3), ch('BOB', 1, { reincarnated: true })] })],
    [day('2026-10-06', 12), event('lost', P2, 'dm-atari', 2, { gameTime: 50, playTime: 60, champions: [ch('HALK', null)], level: 1, x: 2, y: 3 })],
    [day('2026-10-06', 13), event('lost', P2, 'dm-atari', 2, { gameTime: 50, playTime: 90, champions: [ch('HALK', null)], level: 1, x: 2, y: 3 })],
    [day('2026-10-06', 14), event('lost', P2, 'dm-atari', 2, { gameTime: 70, playTime: 99, champions: [ch('HALK', null)], level: 1, x: 4, y: 3 })],
    [day('2026-10-08'), event('started', P3, 'dm-atari', 6, {})],
    [day('2026-10-08', 12), won(P3, 6, 500, 60_000, [winner('ROSE')])],
    [day('2026-10-09'), event('started', P1, 'dm-atari', 7, {})],
    [day('2026-10-09', 11), won(P1, 7, 500, 600_000, [winner('HALK', 3)])],
    // A game's second win, from an earlier save: its first is kept, its party a pick of the game.
    [day('2026-10-09', 12), won(P1, 7, 1, 600_000, [winner('SYRA')])],
    // 121 ticks in a second's 60 VBLs, beyond the second's slack: a win, not ranked.
    [day('2026-10-10'), event('started', P2, 'dm-atari', 8, {})],
    [day('2026-10-10', 11), won(P2, 8, 121, 1000, [winner('BOB', 1)])],
    // 120: just possible.
    [day('2026-10-10', 12), event('started', P2, 'dm-atari', 9, {})],
    [day('2026-10-10', 13), won(P2, 9, 120, 1000, [winner('BOB', 1)])],
    [day('2026-10-11'), event('started', P2, 'csb', 3, {})],
    [day('2026-10-12'), event('started', P1, 'dm-atari', 4, {})],
    // A win whose start never came, as an imported CSBWin save's: a win, not ranked.
    [day('2026-10-13'), won(P1, 5, 9, 8, [winner('SYRA', null)])],
    [day('2026-10-14'), event('lost', P3, 'csb', 3, { gameTime: 7, playTime: 6, champions: [ch('GOTHMOG', null)], level: 0, x: 5, y: 5 })],
    // A set that is not public: in none of the answers.
    [day('2026-10-06'), event('started', P4, 'secret', 10, {})],
    [day('2026-10-06', 11), event('lost', P4, 'secret', 10, { gameTime: 7, playTime: 6, champions: [ch('GOTHMOG')], level: 0, x: 5, y: 5 })],
];

const DM: StatsSet = { id: 'dm-atari', name: 'Dungeon Master' };
const CSB: StatsSet = { id: 'csb', name: 'Chaos Strikes Back' };
const CONFLUX: StatsSet = { id: 'conflux', name: 'Conflux' };
/** The public sets, in the table's order. */
const PUBLIC = [CONFLUX, CSB, DM];

const EXPECTED_SUMMARY: StatsSummary = {
    players: 3, started: 8, won: 6,
    weeks: [{ week: '2026-10-05', started: 7 }, { week: '2026-10-12', started: 1 }],
    sets: [
        { ...DM, started: 7, won: 6, deaths: 3 },
        { ...CSB, started: 1, won: 0, deaths: 1 },
        { ...CONFLUX, started: 0, won: 0, deaths: 0 },
    ],
};

const EXPECTED_SETS: SetStats[] = [{
    ...DM, players: 3, started: 7, won: 6, parties: 7, died: 3,
    fastest: [
        { day: '2026-10-10', gameTime: 120, playTime: 1000, champions: [winner('BOB', 1)] },
        { day: '2026-10-08', gameTime: 500, playTime: 60_000, champions: [winner('ROSE')] },
        { day: '2026-10-09', gameTime: 500, playTime: 600_000, champions: [winner('HALK', 3)] },
        { day: '2026-10-07', gameTime: 1000, playTime: 300_000, champions: [winner('HALK', 3), winner('WU TSE', 9)] },
    ] as SetStats['fastest'],
    levels: [{ level: 1, count: 3 }],
    champions: [
        { name: 'BOB', games: 3, won: 2 }, { name: 'HALK', games: 3, won: 2 },
        { name: 'SYRA', games: 2, won: 2 }, { name: 'ROSE', games: 1, won: 1 }, { name: 'WU TSE', games: 1, won: 1 },
    ],
    weeks: [{ week: '2026-10-05', started: 6, won: 5 }, { week: '2026-10-12', started: 1, won: 1 }],
}, {
    ...CSB, players: 1, started: 1, won: 0, parties: 1, died: 1, fastest: [],
    levels: [{ level: 0, count: 1 }],
    champions: [{ name: 'GOTHMOG', games: 1, won: 0 }],
    weeks: [{ week: '2026-10-05', started: 1, won: 0 }],
}, {
    ...CONFLUX, players: 0, started: 0, won: 0, parties: 0, died: 0, fastest: [], levels: [], champions: [], weeks: [],
}];

const EXPECTED_LEVELS: LevelStats[] = [
    { ...DM, level: 1, deaths: [{ x: 2, y: 3, count: 2 }, { x: 4, y: 3, count: 1 }] },
    { ...DM, level: 0, deaths: [] },
    { ...CSB, level: 0, deaths: [{ x: 5, y: 5, count: 1 }] },
];

/** Every answer `store` gives for the public sets. */
const answers = (store: StatsStore) => JSON.stringify([store.summary(PUBLIC), ...PUBLIC.map((set) => store.setStats(set)),
    ...EXPECTED_LEVELS.map(({ id, name, level }) => store.levelStats({ id, name }, level))]);

function checkStore(scratch: string): void {
    console.log('\nThe store:');
    const path = join(scratch, 'stats.db');
    let db = openStore(path);
    let store = new StatsStore(db);
    check(existsSync(path), 'a missing file is made');
    check(JSON.stringify(store.summary(PUBLIC).sets) === JSON.stringify([CSB, CONFLUX, DM].map((set) => ({ ...set, started: 0, won: 0, deaths: 0 })))
        && store.summary([]).players === 0, 'with the schema, and nothing in it: the sets by name');
    for (const [time, body] of FORTNIGHT) store.record(accepted(body), time);
    check(existsSync(`${path}-wal`), 'it writes ahead, in WAL mode');
    const asRecorded = answers(store);
    db.close();
    check(!existsSync(`${path}-wal`), 'close checkpoints the WAL into the file');

    const raw = new DatabaseSync(path);
    const mode = raw.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
    const { rows } = raw.prepare('SELECT COUNT(*) AS rows FROM events').get() as { rows: number };
    check(mode.journal_mode === 'wal' && rows === FORTNIGHT.length, `the file alone holds the ${rows} events, in ${mode.journal_mode} mode`);
    // The store as the deployed one was: the log alone.
    raw.exec('DROP TABLE games; DROP TABLE deaths; DROP TABLE picks');
    raw.close();

    db = openStore(path);
    store = new StatsStore(db);
    const summary = store.summary(PUBLIC);
    const sets = PUBLIC.map((set) => store.setStats(set));
    console.log('\nThe aggregates of the scripted fortnight:');
    console.log(`  summary: ${JSON.stringify(summary)}`);
    for (const set of sets) console.log(`  ${set.id}: ${JSON.stringify(set)}`);
    check(JSON.stringify(summary) === JSON.stringify(EXPECTED_SUMMARY), 'the summary, as scripted');
    for (const expected of EXPECTED_SETS) {
        const set = sets.find((answer) => answer.id === expected.id)!;
        for (const key of Object.keys(expected) as (keyof SetStats)[]) {
            check(JSON.stringify(set[key]) === JSON.stringify(expected[key]), `${expected.id}'s ${key}, as scripted`);
        }
    }
    for (const expected of EXPECTED_LEVELS) {
        const level = store.levelStats(expected, expected.level);
        console.log(`  ${expected.id}, level ${expected.level}: ${JSON.stringify(level.deaths)}`);
        check(JSON.stringify(level) === JSON.stringify(expected), `${expected.id}'s level ${expected.level}'s squares, the most died on first`);
    }
    check(answers(store) === asRecorded, 'a store of the log alone is given the same aggregates, made from it once');
    const json = answers(store);
    check(![P1, P2, P3, P4, 'abc1234', 'secret'].some((text) => json.includes(text)), 'no player id, build or set not public in them');
    db.close();
}

function checkCache(): void {
    console.log('\nThe cache:');
    let now = 0;
    let made = 0;
    const cache = new AnswerCache(30_000, () => now);
    const get = () => cache.get('a', () => String(++made));
    const kept = [get(), (now = 29_999, get())];
    const remade = [(now = 30_000, get()), (now = 59_999, get()), (now = 60_000, get())];
    check(kept.join() === '1,1' && remade.join() === '2,2,3', `an answer kept for its lifetime, made again after: ${[...kept, ...remade].join(' ')}`);
    check(cache.get('b', () => 'b') === 'b' && get() === '3', 'by key');
}

/** Over 200,000 events: 45,000 games over a year, three sets, 5,000 players, levels of 48x32. */
function checkScale(scratch: string): void {
    console.log('\nAt scale:');
    const path = join(scratch, 'scale.db');
    let seed = 1;
    const random = (n: number) => {
        seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
        return (seed >>> 16) % n;
    };
    const names = ['HALK', 'SYRA', 'WU TSE', 'ALEX', 'IAIDO', 'NABI', 'GOTHMOG', 'ELIJA', 'LEYLA', 'CHANI', 'HAWK', 'ZED'];
    const sets = ['dm-atari', 'csb', 'conflux'];
    const raw = openStore(path);
    raw.exec(`CREATE TABLE events (id INTEGER PRIMARY KEY, time INTEGER NOT NULL, player TEXT NOT NULL, type TEXT NOT NULL,
        data_set TEXT NOT NULL, playthrough INTEGER NOT NULL, build TEXT NOT NULL, payload TEXT NOT NULL)`);
    const insert = raw.prepare('INSERT INTO events (time, player, type, data_set, playthrough, build, payload) VALUES (?, ?, ?, ?, ?, ?, ?)');
    let events = 0;
    raw.exec('BEGIN');
    for (let game = 0; game < 45_000; game++) {
        const player = `00000000-0000-4000-8000-${String(random(5000)).padStart(12, '0')}`;
        const set = sets[random(3)]!;
        let time = day('2025-10-01') + random(365 * 24) * 3_600_000;
        const party = [0, 1, 2, 3].map(() => ch(names[random(names.length)]!)).filter((c, i, all) => all.findIndex((o) => o.name === c.name) === i);
        const add = (type: string, payload: object) => {
            insert.run(time, player, type, set, game, 'abc1234', JSON.stringify(payload));
            time += 600_000;
            events++;
        };
        add('started', {});
        add('party', { champions: party });
        if (random(4) === 0) {
            const gameTime = 50_000 + random(500_000);
            add('won', { gameTime, playTime: gameTime * 250, champions: party.map((c) => ({ ...c, masteries: [1, 2, 3, 4] })) });
        }
        else for (let death = 0; death < 3; death++) add('lost', { gameTime: 9, playTime: 9, champions: party, level: random(14), x: random(48), y: random(32) });
    }
    raw.exec('COMMIT');
    raw.close();

    const timed = <T>(make: () => T): [T, number] => {
        const start = performance.now();
        const made = make();
        return [made, performance.now() - start];
    };
    const db = openStore(path);
    const [store, filled] = timed(() => new StatsStore(db));
    const public_ = sets.map((id) => ({ id, name: id }));
    const [summary, summaryMs] = timed(() => JSON.stringify(store.summary(public_)));
    const each = public_.map((set) => timed(() => JSON.stringify(store.setStats(set))));
    const [level, levelMs] = timed(() => JSON.stringify(store.levelStats(public_[0]!, 3)));
    db.close();
    const slowest = Math.max(summaryMs, levelMs, ...each.map(([, ms]) => ms));
    const largest = Math.max(summary.length, level.length, ...each.map(([body]) => body.length));
    console.log(`  ${events} events, their aggregates made in ${filled.toFixed(0)} ms; the summary in ${summaryMs.toFixed(1)} ms, `
        + `${summary.length} bytes; the sets in ${each.map(([body, ms]) => `${ms.toFixed(1)} ms, ${body.length} bytes`).join('; ')}; `
        + `a level in ${levelMs.toFixed(1)} ms, ${level.length} bytes`);
    const deaths = (JSON.parse(level) as LevelStats).deaths.length;
    check(events > 200_000 && slowest < 250, `every answer in ${slowest.toFixed(0)} ms, under 250`);
    check(largest < 40_000 && deaths === DEATH_SQUARES, `the largest ${largest} bytes, its squares capped at ${deaths}`);
}

function main(): void {
    const scratch = mkdtempSync(join(tmpdir(), 'csbweb-stats-'));
    try {
        checkTheChecks();
        checkStore(scratch);
        checkCache();
        checkScale(scratch);
    } finally {
        rmSync(scratch, { recursive: true, force: true });
    }
    finish();
}

main();
