/**
 * The statistics' store and what it accepts (`doc/STATISTICS.md`): `server/events.ts`,
 * which checks an event and rebuilds it, `server/store.ts`, the SQLite file, and
 * `server/stats.ts`, its `events` table and their aggregates. `checks/server` asks the same
 * over HTTP; `checks/game-events` passes the real engine's events through the same check.
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
 *     the public sets (players, play time, sessions, games started and won, the weeks, the
 *     sets by play time) and each set's (its figures, its fastest wins by game clock, of the games whose start
 *     came and whose clock their play time could run, the first win of a game only, the
 *     deaths per level, the champions, the weeks) and each level's (its deaths per square,
 *     the most first); nothing of a set not public;
 *     no player id or build in them; a `session` never in the log, nor a game's row made of
 *     one, only its week's count and its game's largest play time;
 *   - the same aggregates but the sessions' made from the log, for a store made before the
 *     sessions and for a store of events only;
 *   - a game's second `started` or `won` no row of the log, and nothing changed by it; a
 *     store made before that rule keeps the first of each, and makes its picks again;
 *   - a full log: past its rows, an event refused and nothing of it kept, a session counted;
 *   - every time kept to 10 s, rounded down: an event's, a game's start and win; a store
 *     made before that rule given its times rounded down, and the same answers;
 *   - the rate limit's buckets: an address, an IPv4-mapped one as its IPv4, an IPv6 one as
 *     its /64;
 *   - the cache: an answer kept for its lifetime, made again after;
 *   - 200,000 events: the aggregates made from them once, then every answer in milliseconds,
 *     and small, and the store's bytes an event, which `MAX_EVENTS` is sized by.
 *
 * Usage: npm test -- --only=stats.ts
 */
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { addressBucket, checkEvent, RateLimit, type CheckedEvent, type EventRules } from '../../server/events.ts';
import type { LevelStats, SetStats, StatsSet, StatsSummary } from '../../server/answers.ts';
import { AnswerCache, DEATH_SQUARES, MAX_EVENTS, StatsStore, TIME_GRAIN } from '../../server/stats.ts';
import { openStore } from '../../server/store.ts';
import { check, finish } from '../lib/check';
import { ch, day, event, FORTNIGHT, P1, P2, P3, P4, session, winner, won } from '../lib/statsFortnight';

const RULES: EventRules = { hasSet: (id) => ['dm-atari', 'csb', 'conflux', 'secret'].includes(id) };

function accepted(body: string): CheckedEvent {
    const checked = checkEvent(body, RULES);
    if (typeof checked === 'string') throw new Error(`refused (${checked}): ${body}`);
    return checked;
}

function checkTheChecks(): void {
    console.log('What api/event accepts:');
    const party = accepted(event('party', P1, 'dm-atari', 7, {
        champions: [ch('HALK', 3), ch('BOB', 7, { reincarnated: true, hero: 'WU TSE', note: 'free text' }), ch('ROSE', null), ch("D'AR.-2", 0x7fff)],
        note: 'free text',
    }, { note: 'free text' }));
    console.log(`  party: ${JSON.stringify(party)}`);
    check(JSON.stringify(party) === JSON.stringify({
        type: 'party', player: P1, set: 'dm-atari', playthrough: 7, build: 'abc1234',
        payload: { champions: [ch('HALK', 3), ch('BOB', 7, { reincarnated: true, hero: 'WU TSE' }), ch('ROSE', null), ch("D'AR.-2", 0x7fff)] },
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
    const session = accepted(event('session', P1, 'csb', 0, { playTime: 7200000, anything: 'free text' }));
    check(JSON.stringify(session.payload) === '{"playTime":7200000}', 'session: its play time alone');

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
        [event('party', P1, 'csb', 1, { champions: [ch('BOB', 0, { hero: 'HALK' })] }), 'bad hero'],
        [event('party', P1, 'csb', 1, { champions: [ch('BOB', 0, { reincarnated: true, hero: 'Halk' })] }), 'bad hero'],
        [event('party', P1, 'csb', 1, { champions: [ch('BOB', 0, { reincarnated: true, hero: '' })] }), 'bad hero'],
        [event('won', P1, 'csb', 1, { gameTime: 1, playTime: 1, champions: [ch('HALK')] }), 'bad masteries'],
        [event('won', P1, 'csb', 1, { gameTime: 1, playTime: 1, champions: [ch('HALK', 0, { masteries: [1, 1, 1] })] }), 'bad masteries'],
        [event('won', P1, 'csb', 1, { gameTime: 1, playTime: 1, champions: [ch('HALK', 0, { masteries: [1, 1, 1, 64] })] }), 'bad masteries'],
        [event('won', P1, 'csb', 1, { gameTime: -1, playTime: 1, champions: [] }), 'bad gameTime'],
        [event('won', P1, 'csb', 1, { gameTime: 1, playTime: '1', champions: [] }), 'bad playTime'],
        [event('lost', P1, 'csb', 1, { gameTime: 1, playTime: 1, champions: [], level: 0, x: 256, y: 0 }), 'bad square'],
        [event('lost', P1, 'csb', 1, { gameTime: 1, playTime: 1, champions: [], level: 0, x: 0 }), 'bad square'],
        [event('session', P1, 'csb', 1, {}), 'bad playTime'],
        [event('session', P1, 'csb', 1, { playTime: -1 }), 'bad playTime'],
        [event('session', P1, 'csb', 1, { playTime: 0.5 }), 'bad playTime'],
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

    const buckets: [string, string][] = [
        ['10.1.2.3', '10.1.2.3'],
        ['::ffff:10.1.2.3', '10.1.2.3'],
        ['::FFFF:10.1.2.3', '10.1.2.3'],
        ['2001:db8:1:2::a', '2001:db8:1:2::/64'],
        ['2001:0DB8:0001:0002:ffff:ffff:ffff:ffff', '2001:db8:1:2::/64'],
        ['2001:db8::1', '2001:db8:0:0::/64'],
        ['2001:db8:0:0:1::', '2001:db8:0:0::/64'],
        ['fe80::1%eth0', 'fe80:0:0:0::/64'],
        ['::1', '0:0:0:0::/64'],
        ['64:ff9b::10.1.2.3', '64:ff9b:0:0::/64'],
        ['1:2:3:4:5:6:10.1.2.3', '1:2:3:4::/64'],
        ['', ''],
        ['not an address', 'not an address'],
    ];
    for (const [address, bucket] of buckets) check(addressBucket(address) === bucket, `${address || "''"} counts as ${addressBucket(address)}`);
    console.log(`  ${buckets.length} addresses, each in its bucket: an IPv4-mapped one its IPv4, an IPv6 one its /64`);
}

const SESSIONS = FORTNIGHT.filter(([, body]) => body.includes('"type":"session"')).length;
/** The fortnight's second `started` of game 1 and second `won` of game 7, which the log keeps no row of. */
const TWICE = 2;

const DM: StatsSet = { id: 'dm-atari', name: 'Dungeon Master' };
const CSB: StatsSet = { id: 'csb', name: 'Chaos Strikes Back' };
const CONFLUX: StatsSet = { id: 'conflux', name: 'Conflux' };
/** The public sets, in the table's order. */
const PUBLIC = [CONFLUX, CSB, DM];

/**
 * DM's play time: its games' largest, 300,000 (game 1's win, over its sessions), 99 (game
 * 2's last death), 60,000, 600,000, 1,000 and 1,000 (games 6 to 9's wins), 3,600,000
 * (game 4's sessions) and 8 (game 5's win).
 */
const DM_PLAY_TIME = 300_000 + 99 + 60_000 + 600_000 + 1_000 + 1_000 + 3_600_000 + 8;

const EXPECTED_SUMMARY: StatsSummary = {
    players: 3, playTime: DM_PLAY_TIME + 9_000_000, sessions: 7, started: 8, won: 6,
    weeks: [{ week: '2026-10-05', sessions: 2, started: 7 }, { week: '2026-10-12', sessions: 5, started: 1 }],
    sets: [
        { ...CSB, playTime: 9_000_000, sessions: 1, started: 1, won: 0, deaths: 1 },
        { ...DM, playTime: DM_PLAY_TIME, sessions: 6, started: 7, won: 6, deaths: 3 },
        { ...CONFLUX, playTime: 0, sessions: 0, started: 0, won: 0, deaths: 0 },
    ],
};

const EXPECTED_SETS: SetStats[] = [{
    ...DM, players: 3, playTime: DM_PLAY_TIME, sessions: 6, started: 7, won: 6, parties: 7, died: 3,
    fastest: [
        { day: '2026-10-10', gameTime: 120, playTime: 1000, champions: [winner('BOB', 1)] },
        { day: '2026-10-08', gameTime: 500, playTime: 60_000, champions: [winner('ROSE')] },
        { day: '2026-10-09', gameTime: 500, playTime: 600_000, champions: [winner('HALK', 3)] },
        { day: '2026-10-07', gameTime: 1000, playTime: 300_000, champions: [winner('HALK', 3), winner('TSE', 9, 'WU TSE')] },
    ] as SetStats['fastest'],
    levels: [{ level: 1, count: 3 }],
    champions: [
        { name: 'BOB', games: 3, won: 2 }, { name: 'HALK', games: 3, won: 2 },
        { name: 'ROSE', games: 1, won: 1 }, { name: 'SYRA', games: 1, won: 1 }, { name: 'WU TSE', games: 1, won: 1 },
    ],
    weeks: [{ week: '2026-10-05', sessions: 2, started: 6, won: 5 }, { week: '2026-10-12', sessions: 4, started: 1, won: 1 }],
}, {
    ...CSB, players: 1, playTime: 9_000_000, sessions: 1, started: 1, won: 0, parties: 1, died: 1, fastest: [],
    levels: [{ level: 0, count: 1 }],
    champions: [{ name: 'GOTHMOG', games: 1, won: 0 }],
    weeks: [{ week: '2026-10-05', sessions: 0, started: 1, won: 0 }, { week: '2026-10-12', sessions: 1, started: 0, won: 0 }],
}, {
    ...CONFLUX, players: 0, playTime: 0, sessions: 0, started: 0, won: 0, parties: 0, died: 0, fastest: [], levels: [], champions: [], weeks: [],
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
    check(JSON.stringify(store.summary(PUBLIC).sets) === JSON.stringify([CSB, CONFLUX, DM].map((set) => ({ ...set, playTime: 0, sessions: 0, started: 0, won: 0, deaths: 0 })))
        && store.summary([]).players === 0, 'with the schema, and nothing in it: the sets by name');
    for (const [time, body] of FORTNIGHT) store.record(accepted(body), time);
    check(existsSync(`${path}-wal`), 'it writes ahead, in WAL mode');

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
    const json = answers(store);
    check(![P1, P2, P3, P4, 'abc1234', 'secret'].some((text) => json.includes(text)), 'no player id, build or set not public in them');
    db.close();
    check(!existsSync(`${path}-wal`), 'close checkpoints the WAL into the file');

    const raw = new DatabaseSync(path);
    const mode = raw.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
    const { rows } = raw.prepare('SELECT COUNT(*) AS rows FROM events').get() as { rows: number };
    const logged = (raw.prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'session'").get() as { n: number }).n;
    check(mode.journal_mode === 'wal' && rows === FORTNIGHT.length - SESSIONS - TWICE,
        `the file alone holds the ${rows} events, in ${mode.journal_mode} mode, the ${SESSIONS} sessions not among them`);
    check(logged === 0, 'no session is a row of the log');
    const players = (raw.prepare("SELECT COUNT(*) AS n FROM games WHERE player = ?").get(P4) as { n: number }).n;
    check(players === 1, 'and no game is made of a session: its player is kept by its other events alone');
    const twice = (raw.prepare("SELECT COUNT(*) AS n FROM events WHERE type IN ('started', 'won') GROUP BY type, data_set, playthrough HAVING n > 1").all()).length;
    check(rows === FORTNIGHT.length - SESSIONS - TWICE && twice === 0, `nor a game's second started or won, of which it has ${TWICE}`);

    // The aggregates the log alone can make: the fortnight without its sessions.
    const logPath = join(scratch, 'log.db');
    const logDb = openStore(logPath);
    const logStore = new StatsStore(logDb);
    for (const [time, body] of FORTNIGHT) if (!body.includes('"type":"session"')) logStore.record(accepted(body), time);
    const withoutSessions = answers(logStore);
    const logSummary = logStore.summary(PUBLIC);
    logDb.close();
    console.log(`  without the sessions: play time ${logSummary.playTime}, sessions ${logSummary.sessions}, `
        + `the sets ${logSummary.sets.map((set) => `${set.id} ${set.playTime}`).join(', ')}`);
    check(logSummary.playTime === DM_PLAY_TIME - 3_600_000 + 6 && logSummary.sessions === 0,
        "without the sessions, a game's play time is its won and lost events' alone");

    // The store as the deployed one was before the sessions: the aggregates without them.
    raw.exec('DROP TABLE sessions; ALTER TABLE games DROP COLUMN played');
    raw.close();
    db = openStore(path);
    store = new StatsStore(db);
    check(answers(store) === withoutSessions, 'a store made before the sessions is given its games\' play time from the log, once');
    const upgraded = store.summary(PUBLIC).sessions;
    store.record(accepted(session(P1, 'dm-atari', 4, 0)), day('2026-10-15'));
    check(upgraded === 0 && store.summary(PUBLIC).sessions === 1, 'and counts the sessions from then on');
    const slotted = answers(store);
    db.close();

    // The store as it was before the picks' slots, which counted each name reported.
    const unslotted = new DatabaseSync(path);
    unslotted.exec(`DROP TABLE picks;
        CREATE TABLE picks (data_set TEXT NOT NULL, playthrough INTEGER NOT NULL, name TEXT NOT NULL, PRIMARY KEY (data_set, playthrough, name)) WITHOUT ROWID;
        INSERT INTO picks VALUES ('dm-atari', 2, 'KID')`);
    unslotted.close();
    db = openStore(path);
    store = new StatsStore(db);
    check(answers(store) === slotted, "a store made before the picks' slots is given its picks again, from the log, once");
    db.close();

    // The store as it was before a game's started and won were once each: the second ones
    // in its log, and the second win's party among its picks.
    const doubled = new DatabaseSync(path);
    const secondWin = JSON.stringify({ gameTime: 1, playTime: 600_000, champions: [winner('SYRA')] });
    doubled.exec(`DROP INDEX events_once;
        INSERT INTO events (time, player, type, data_set, playthrough, build, payload) VALUES
            (${day('2026-10-16')}, '${P1}', 'started', 'dm-atari', 1, 'abc1234', '{}'),
            (${day('2026-10-16')}, '${P1}', 'won', 'dm-atari', 7, 'abc1234', '${secondWin}');
        INSERT INTO picks VALUES ('dm-atari', 7, 'SYRA', 0)`);
    doubled.close();
    db = openStore(path);
    store = new StatsStore(db);
    const kept = (db.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number }).n;
    check(answers(store) === slotted && kept === FORTNIGHT.length - SESSIONS - TWICE,
        "a store made before a game's started and won were once each keeps the first of each, and its picks are made again");
    db.close();

    // The store as the first deployed one was: the log alone.
    const first = new DatabaseSync(path);
    first.exec('DROP TABLE games; DROP TABLE deaths; DROP TABLE picks; DROP TABLE sessions');
    first.close();
    db = openStore(path);
    store = new StatsStore(db);
    check(answers(store) === withoutSessions, 'a store of the log alone is given the same aggregates, made from it once');
    db.close();
}

function checkFull(): void {
    console.log('\nA full store:');
    const db = new DatabaseSync(':memory:');
    const store = new StatsStore(db, 2);
    const kept = FORTNIGHT.slice(0, 5).map(([time, body]) => store.record(accepted(body), time));
    const rows = (db.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number }).n;
    const { sessions, started } = store.setStats(DM);
    db.close();
    console.log(`  a log of 2 rows, given a started, two sessions and two parties: ${kept.join(' ')}`);
    check(kept.join() === 'true,true,true,true,false' && rows === 2, 'past its rows, an event is refused, and nothing of it kept');
    check(sessions === 2 && started === 1, 'where a session still counts');
}

/** Every time kept to `TIME_GRAIN`, an event's and a game's, and a store's made before it rounded down when opened. */
function checkGrain(): void {
    console.log('\nThe times:');
    const db = new DatabaseSync(':memory:');
    let store = new StatsStore(db);
    const at = day('2026-10-05');
    store.record(accepted(event('started', P1, 'dm-atari', 1, {})), at + 12_345);
    store.record(accepted(won(P1, 1, 1000, 300_000, [winner('HALK', 3)])), at + 3_600_000 + 9_999);
    const times = () => JSON.stringify([
        db.prepare('SELECT time FROM events ORDER BY id').all().map((row) => row.time),
        db.prepare('SELECT started, won FROM games').get()]);
    const coarse = JSON.stringify([[at + 10_000, at + 3_600_000], { started: at + 10_000, won: at + 3_600_000 }]);
    const kept = times();
    const answered = answers(store);
    console.log(`  received at +12,345 and +3,609,999 ms, kept as ${kept}`);
    check(kept === coarse && TIME_GRAIN === 10_000, 'an event\'s time, and its game\'s start and win, rounded down to 10 s');

    // The store as it was before the grain: its times to the millisecond.
    db.exec('UPDATE events SET time = time + 1234; UPDATE games SET started = started + 1234, won = won + 5678');
    store = new StatsStore(db);
    check(times() === coarse && answers(store) === answered, 'a store made before the grain is given its times rounded down, and the same answers');
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
    // About 120 ms alone, and three times that beside a full `npm test`'s other tools: the
    // bound is one only an answer that grows with the events reaches, not the machine's load.
    check(events > 200_000 && slowest < 2000, `every answer in ${slowest.toFixed(0)} ms, under 2000`);
    check(largest < 40_000 && deaths === DEATH_SQUARES, `the largest ${largest} bytes, its squares capped at ${deaths}`);
    const perEvent = statSync(path).size / events;
    console.log(`  the store: ${perEvent.toFixed(0)} bytes an event, its aggregates and indexes included`);
    check(perEvent < 400, `under the 400 bytes an event that MAX_EVENTS (${MAX_EVENTS}) is sized by`);
}

function main(): void {
    const scratch = mkdtempSync(join(tmpdir(), 'csbweb-stats-'));
    try {
        checkTheChecks();
        checkStore(scratch);
        checkFull();
        checkGrain();
        checkCache();
        checkScale(scratch);
    } finally {
        rmSync(scratch, { recursive: true, force: true });
    }
    finish();
}

main();
