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
 *     range, a champion's name past 7 characters, a fifth champion, masteries that are
 *     not four;
 *   - the store: the schema made in a missing file, WAL mode, and the WAL checkpointed into
 *     the file on close, which holds the events when it is opened again;
 *   - the aggregates of a scripted fortnight, exactly: players, games started and won per
 *     set and week, the champions per set, the deaths per square, the won games with their
 *     wall time; and no player id or build in them.
 *
 * Usage: npx tsx tools/dump-stats.ts
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { checkEvent, RateLimit, type CheckedEvent, type EventRules } from '../server/events.ts';
import { StatsStore, type Stats } from '../server/stats.ts';
import { openStore } from '../server/store.ts';
import { check, finish } from './lib/check';

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const P3 = '33333333-3333-4333-8333-333333333333';

const RULES: EventRules = { hasSet: (id) => ['dm-atari', 'csb'].includes(id) };

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
        champions: [ch('HALK', 3), ch('BOB', 7, { reincarnated: true, note: 'free text' }), ch('ROSE', null), ch('', 0x7fff)],
        note: 'free text',
    }, { note: 'free text' }));
    console.log(`  party: ${JSON.stringify(party)}`);
    check(JSON.stringify(party) === JSON.stringify({
        type: 'party', player: P1, set: 'dm-atari', playthrough: 7, build: 'abc1234',
        payload: { champions: [ch('HALK', 3), ch('BOB', 7, { reincarnated: true }), ch('ROSE', null), ch('', 0x7fff)] },
    }), 'party: rebuilt, unknown fields dropped, every name and id as sent');

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

/** A fortnight of three players, scripted: see the expected aggregates below. */
const FORTNIGHT: [number, string][] = [
    [day('2026-10-05'), event('started', P1, 'dm-atari', 1, {})],
    [day('2026-10-05', 11), event('party', P1, 'dm-atari', 1, { champions: [ch('HALK', 3)] })],
    [day('2026-10-05', 12), event('party', P1, 'dm-atari', 1, { champions: [ch('HALK', 3), ch('WU TSE', 9)] })],
    [day('2026-10-07'), event('won', P1, 'dm-atari', 1, {
        gameTime: 1000, playTime: 5000, champions: [ch('HALK', 3, { masteries: [3, 2, 1, 1] }), ch('WU TSE', 9, { masteries: [2, 3, 1, 1] })],
    })],
    [day('2026-10-06'), event('started', P2, 'dm-atari', 2, {})],
    [day('2026-10-06', 11), event('party', P2, 'dm-atari', 2, { champions: [ch('HALK', 3), ch('BOB', 1, { reincarnated: true })] })],
    [day('2026-10-06', 12), event('lost', P2, 'dm-atari', 2, { gameTime: 50, playTime: 60, champions: [ch('HALK', null)], level: 1, x: 2, y: 3 })],
    [day('2026-10-06', 13), event('lost', P2, 'dm-atari', 2, { gameTime: 50, playTime: 90, champions: [ch('HALK', null)], level: 1, x: 2, y: 3 })],
    [day('2026-10-11'), event('started', P2, 'csb', 3, {})],
    [day('2026-10-12'), event('started', P1, 'dm-atari', 4, {})],
    [day('2026-10-13'), event('won', P1, 'dm-atari', 5, { gameTime: 9, playTime: 8, champions: [ch('SYRA', null, { masteries: [1, 1, 4, 4] })] })],
    [day('2026-10-14'), event('lost', P3, 'csb', 3, { gameTime: 7, playTime: 6, champions: [ch('GOTHMOG', null)], level: 0, x: 5, y: 5 })],
];

const EXPECTED: Stats = {
    players: 3,
    weeks: [
        { set: 'csb', week: '2026-10-05', players: 1, started: 1, won: 0 },
        { set: 'dm-atari', week: '2026-10-05', players: 2, started: 2, won: 1 },
        { set: 'csb', week: '2026-10-12', players: 1, started: 0, won: 0 },
        { set: 'dm-atari', week: '2026-10-12', players: 1, started: 1, won: 1 },
    ],
    champions: [
        { set: 'csb', name: 'GOTHMOG', games: 1 },
        { set: 'dm-atari', name: 'HALK', games: 2 },
        { set: 'dm-atari', name: 'BOB', games: 1 },
        { set: 'dm-atari', name: 'SYRA', games: 1 },
        { set: 'dm-atari', name: 'WU TSE', games: 1 },
    ],
    deaths: [
        { set: 'csb', level: 0, x: 5, y: 5, count: 1 },
        { set: 'dm-atari', level: 1, x: 2, y: 3, count: 2 },
    ],
    wins: [
        {
            set: 'dm-atari', week: '2026-10-05', gameTime: 1000, playTime: 5000, wallTime: 2 * 24 * 3600 * 1000,
            champions: [ch('HALK', 3, { masteries: [3, 2, 1, 1] }), ch('WU TSE', 9, { masteries: [2, 3, 1, 1] })],
        },
        { set: 'dm-atari', week: '2026-10-12', gameTime: 9, playTime: 8, wallTime: null, champions: [ch('SYRA', null, { masteries: [1, 1, 4, 4] })] },
    ],
};

function checkStore(scratch: string): void {
    console.log('\nThe store:');
    const path = join(scratch, 'stats.db');
    let db = openStore(path);
    let store = new StatsStore(db);
    check(existsSync(path), 'a missing file is made');
    check(JSON.stringify(store.stats()) === '{"players":0,"weeks":[],"champions":[],"deaths":[],"wins":[]}', 'with the schema, and nothing in it');
    for (const [time, body] of FORTNIGHT) store.record(accepted(body), time);
    check(existsSync(`${path}-wal`), 'it writes ahead, in WAL mode');
    db.close();
    check(!existsSync(`${path}-wal`), 'close checkpoints the WAL into the file');

    const raw = new DatabaseSync(path, { readOnly: true });
    const mode = raw.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
    const { rows } = raw.prepare('SELECT COUNT(*) AS rows FROM events').get() as { rows: number };
    raw.close();
    check(mode.journal_mode === 'wal' && rows === FORTNIGHT.length, `the file alone holds the ${rows} events, in ${mode.journal_mode} mode`);

    db = openStore(path);
    store = new StatsStore(db);
    const stats = store.stats();
    db.close();
    console.log('\nThe aggregates of the scripted fortnight:');
    for (const [key, value] of Object.entries(stats)) {
        if (!Array.isArray(value)) console.log(`  ${key}: ${value}`);
        else for (const row of value) console.log(`  ${key}: ${JSON.stringify(row)}`);
    }
    for (const key of Object.keys(EXPECTED) as (keyof Stats)[]) {
        check(JSON.stringify(stats[key]) === JSON.stringify(EXPECTED[key]), `${key}, as scripted`);
    }
    const json = JSON.stringify(stats);
    check(![P1, P2, P3, 'abc1234'].some((text) => json.includes(text)), 'no player id or build in them');
}

function main(): void {
    const scratch = mkdtempSync(join(tmpdir(), 'csbweb-stats-'));
    try {
        checkTheChecks();
        checkStore(scratch);
    } finally {
        rmSync(scratch, { recursive: true, force: true });
    }
    finish();
}

main();
