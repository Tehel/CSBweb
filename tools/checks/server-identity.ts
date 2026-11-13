/**
 * The players' identities over HTTP (`server/identity.ts`, `doc/ACHIEVEMENTS.md` →
 * "Identity"): the server's `api/profile` and `api/identities/<id>`, stood up on a free port
 * over a scratch store, as the page's PROFILE asks them (`src/ui/profile.ts`).
 *
 * Asserts:
 *   - a public name's rules: 3 to 16 characters, letters, digits, `-`, `_` and `.`, words a
 *     single space apart, each refusal 400 and said, nothing written; a name chosen is a new
 *     identity, 201, its public id ten characters of the alphabet, its key 25, which the
 *     store keeps only as its SHA-256;
 *   - a name unique regardless of case: another's, in any case, 409; its own in another
 *     case, and another name, a rename, 200, the id kept;
 *   - the key: a second `playerId` linked by it, written in any case and grouped, 200, and
 *     the dump answering both with the identity, two browsers; a wrong key 403, a key of
 *     no key's form 400, nothing linked; a new key drawn, the old one then refused and the
 *     new one linking; a new key asked by a browser with no name 409;
 *   - the dump (`GET api/profile`): the sets the identity's browsers published, each its
 *     state, the recordings they shared, each its state, how many are listed as replays,
 *     their `started`, `won` and `lost` events by set, and no achievement; not cached;
 *     400 without a player;
 *   - a moderator's reset: a body not `{"action": "reset"}` 400, an unknown id 404, an asker
 *     who is not a moderator 403, then the name gone, the identity kept, a second reset
 *     409; the name refused to everyone from then, in any case; its player names it again;
 *   - an identity read (`GET api/identities/<id>`): 403 to anyone but a moderator, 404 an
 *     unknown id, and its name, browsers and proofs to a moderator, not cached;
 *   - the moderators told of each name chosen, changed, in case too, and reset, by whom,
 *     with its public id, and of nothing refused, linked or keyed (`notify.ts`);
 *   - a POST from another site 403, a body over `MAX_PROFILE_BYTES` 413, the rate per
 *     address 429; and no answer of any route holding a `playerId`;
 *   - the store's life: a store opened again keeps its identities, and one whose log has
 *     no `events_by_player` is given it.
 *
 * Usage: npm test -- --only=server-identity.ts
 */
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createAppServer } from '../../server/app.ts';
import { DataSetStore, parseModerators } from '../../server/dataSets.ts';
import { RateLimit } from '../../server/events.ts';
import { IdentityStore, MAX_PROFILE_BYTES } from '../../server/identity.ts';
import { notificationText, type DataSetEvent, type IdentityEvent } from '../../server/notify.ts';
import { ProofStore } from '../../server/proofs.ts';
import { RecordingStore } from '../../server/recordings.ts';
import { StatsStore } from '../../server/stats.ts';
import { openStore } from '../../server/store.ts';
import {
    IDENTITIES_ROUTE, IDENTITY_KEY_LENGTH, identityKeyOf, identityKeyText, parseManifest, PLAYER_ID_HEADER, PROFILE_ROUTE, PUBLIC_ID, RECORDING_PACKAGE_FIELD,
    RECORDINGS_ROUTE, type PlayerProfile, type ProfileIdentity,
} from '../../src/data/DataSets.ts';
import { checkLocalDataSet } from '../../src/engine/LocalDataSetCheck.ts';
import { readRecordingPackage } from '../../src/engine/RecordingPackage.ts';
import { check, finish } from '../lib/check.ts';
import { packageOf } from '../lib/recordingPackages.ts';

const PLAYER = '00000000-0000-4000-8000-000000000000';
const OTHER = '11111111-1111-4111-8111-111111111111';
const THIRD = '22222222-2222-4222-8222-222222222222';
const MODERATOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PLAYER_IDS = [PLAYER, OTHER, THIRD, MODERATOR];

/** Changes per address and window: more than the checks ask from one address but the rate's own. */
const CHANGES_PER_WINDOW = 5;

/** What the server told the moderators. */
const notified: (DataSetEvent | IdentityEvent)[] = [];

interface Answer {
    status: number;
    headers: Record<string, string | string[] | undefined>;
    body: string;
}

/** Every answer's body, searched for a `playerId` at the end. */
const bodies: string[] = [];

function ask(port: number, path: string, method = 'GET', headers: Record<string, string> = {}, body?: string): Promise<Answer> {
    return new Promise((done, fail) => {
        const req = request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
            let text = '';
            res.setEncoding('utf8');
            res.on('data', (chunk: string) => (text += chunk));
            res.on('end', () => {
                bodies.push(text);
                done({ status: res.statusCode ?? 0, headers: res.headers, body: text });
            });
        });
        req.on('error', fail);
        req.end(body);
    });
}

async function main(): Promise<void> {
    const scratch = mkdtempSync(join(tmpdir(), 'csbweb-identity-'));
    const distDir = join(scratch, 'dist');
    const gamefilesDir = join(scratch, 'gamefiles');
    mkdirSync(distDir, { recursive: true });
    writeFileSync(join(distDir, 'index.html'), '<!doctype html><title>page</title>');
    for (const dir of ['set-a', 'mine', 'mine-too']) mkdirSync(join(gamefilesDir, dir), { recursive: true });
    const recordingsDir = join(scratch, 'recordings');
    mkdirSync(recordingsDir);

    const db = openStore(join(scratch, 'store.db'));
    const dataSets = new DataSetStore(db);
    dataSets.fill(parseManifest(JSON.stringify({ default: 'a', dataSets: [{ id: 'a', name: 'A', dir: 'set-a' }] }), ''));
    const stats = new StatsStore(db);
    const recordings = new RecordingStore(db, 1 << 30);
    const identities = new IdentityStore(db);
    const server = createAppServer({ distDir, gamefilesDir }, {
        checkDataSet: checkLocalDataSet, dataSets, moderators: parseModerators(`${MODERATOR}=Alice`), store: stats, notify: (event) => notified.push(event),
        rules: { hasSet: (id) => dataSets.hasSet(id) }, rateLimit: new RateLimit(100, 60_000), eventBudget: new RateLimit(1000, 60_000),
        publishRateLimit: new RateLimit(100, 60_000), now: Date.now,
        recordings: { store: recordings, dir: recordingsDir, readPackage: readRecordingPackage, shareRateLimit: new RateLimit(100, 60_000) },
        identities: { store: identities, rateLimit: new RateLimit(CHANGES_PER_WINDOW, 60_000) },
        proofs: { store: new ProofStore(db, 1 << 30), dir: join(scratch, 'proofs'), rateLimit: new RateLimit(100, 60_000) },
        achievementDefs: () => null, achievementsAcross: () => [],
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const port = (server.address() as AddressInfo).port;

    try {
        let address = 0;
        /** `body` posted to `api/profile` as `player`, from an address of its own unless `ip` names one. */
        const change = async (player: string | null, body: object | string, ip = `10.9.0.${++address}`, headers: Record<string, string> = {}) => {
            const answer = await ask(port, `/${PROFILE_ROUTE}`, 'POST', {
                'Content-Type': 'application/json', 'X-Real-IP': ip, ...(player === null ? {} : { [PLAYER_ID_HEADER]: player }), ...headers,
            }, typeof body === 'string' ? body : JSON.stringify(body));
            // A cross-site POST is refused before the route, in plain text.
            const json = (answer.headers['content-type'] ?? '').includes('json') ? JSON.parse(answer.body) : { error: answer.body };
            return { ...answer, json: json as ProfileIdentity & { error?: string } };
        };
        const named = (player: string, name: string) => change(player, { action: 'name', name });
        const profileOf = async (player: string) => {
            const answer = await ask(port, `/${PROFILE_ROUTE}`, 'GET', { [PLAYER_ID_HEADER]: player });
            return { ...answer, profile: JSON.parse(answer.body) as PlayerProfile };
        };
        const identityRows = () => (db.prepare('SELECT COUNT(*) AS n FROM identities').get() as { n: number }).n;

        // The name's rules.
        console.log('The public name:');
        const blank = await profileOf(PLAYER);
        check(blank.status === 200 && blank.profile.identity === null && blank.headers['cache-control'] === 'no-store'
            && String(blank.headers['content-type']).startsWith('application/json'), 'a browser with no name: the dump says none, JSON, not cached');
        const refusals: [string, string][] = [
            ['ab', 'too short'], ['abcdefghijklmnopq', 'too long'], ['abc!', 'a character not a name\'s'], ['Élan', 'a letter not ASCII\'s'],
            [' abc', 'a space first'], ['abc ', 'a space last'], ['ab  cd', 'two spaces'], ['ab\tcd', 'a tab'],
        ];
        for (const [name, why] of refusals) {
            const refused = await named(PLAYER, name);
            check(refused.status === 400 && typeof refused.json.error === 'string' && refused.json.error.startsWith('A name is'), `${JSON.stringify(name)}, ${why}: 400, "${refused.json.error}"`);
        }
        check(identityRows() === 0, 'and nothing written');
        const chosen = await named(PLAYER, 'Tehel');
        const key = chosen.json.key ?? '';
        console.log(`  chosen: ${chosen.status} ${chosen.body.replace(/"key":"\w+"/, '"key":<key>')}`);
        check(chosen.status === 201 && chosen.json.name === 'Tehel' && PUBLIC_ID.test(chosen.json.id) && key.length === IDENTITY_KEY_LENGTH && identityKeyOf(key) === key,
            'a name chosen: 201, the name, a public id of ten characters, a key of 25');
        const stored = db.prepare('SELECT * FROM identities').get() as Record<string, unknown>;
        check(stored.key_hash === createHash('sha256').update(key).digest('hex') && !JSON.stringify(stored).includes(key),
            'the store keeps the key\'s SHA-256, and not the key');
        const id = chosen.json.id;
        for (const name of ['Va-l_i.d 9', 'a.b', 'sixteen chars ok']) {
            const valid = await named(THIRD, name);
            check(valid.status === 201 || valid.status === 200, `${JSON.stringify(name)} is a name: ${valid.status}`);
        }

        // Uniqueness, regardless of case.
        const taken = await named(OTHER, 'TEHEL');
        check(taken.status === 409 && taken.json.error === 'This name is taken.', 'another\'s name in another case: 409, taken');
        const sameInCase = await named(PLAYER, 'tehel');
        const renamed = await named(PLAYER, 'Tehel Two');
        check(sameInCase.status === 200 && sameInCase.json.id === id && sameInCase.json.name === 'tehel' && sameInCase.json.key === undefined
            && renamed.status === 200 && renamed.json.id === id && renamed.json.name === 'Tehel Two',
            'its own name in another case, then another name: 200, a rename, the id kept, no key');
        check((await named(OTHER, 'Tehel')).status === 201, 'the name left by a rename is free again');

        // What the dump holds: the sets PLAYER published, OTHER's recording, both players' games.
        console.log('\nThe dump:');
        const walls = { shapes: [[32, 32]] as [number, number][], signature: ['0'] };
        const published = { description: '', authors: [], csbGraphics: false, hintOracle: false, dmRules: false, thumbnailAsTitle: false, official: false, walls };
        dataSets.publish({ ...published, id: 'mine', name: 'Mine' }, PLAYER);
        dataSets.publish({ ...published, id: 'mine-too', name: 'Mine Too' }, PLAYER);
        dataSets.approve('mine');
        const form = new FormData();
        form.append(RECORDING_PACKAGE_FIELD, new File([await packageOf('a', 'Their win')], 'recording.gz', { type: 'application/gzip' }));
        const shared = await fetch(`http://127.0.0.1:${port}/${RECORDINGS_ROUTE}`, { method: 'POST', headers: { [PLAYER_ID_HEADER]: OTHER }, body: form });
        const recording = (await shared.json() as { id: string }).id;
        recordings.approve(recording);
        const event = (player: string, type: string, playthrough: number, payload: object) => ask(port, '/api/event', 'POST',
            { 'X-Real-IP': `10.9.1.${++address}` }, JSON.stringify({ type, player, set: 'a', playthrough, build: 'test', payload }));
        const champions = [{ name: 'HALK', id: 1, masteries: [1, 2, 3, 4] }];
        const sent = [
            await event(PLAYER, 'started', 1, {}), await event(PLAYER, 'won', 1, { gameTime: 100, playTime: 60_000, champions }),
            await event(OTHER, 'started', 2, {}), await event(OTHER, 'lost', 2, { gameTime: 50, playTime: 30_000, champions: [{ name: 'HALK', id: 1 }], level: 1, x: 2, y: 3 }),
            await event(OTHER, 'lost', 2, { gameTime: 60, playTime: 31_000, champions: [{ name: 'HALK', id: 1 }], level: 1, x: 2, y: 3 }),
            await event(THIRD, 'started', 3, {}),
        ];
        check(shared.status === 201 && sent.every((answer) => answer.status === 204), 'a recording shared by the other browser, and the games\' events stored');
        const alone = (await profileOf(PLAYER)).profile;
        console.log(`  the first browser's, alone: ${JSON.stringify(alone)}`);
        check(alone.identity?.name === 'Tehel Two' && alone.identity.id === id && alone.identity.browsers === 1
            && JSON.stringify(alone.dataSets) === '[{"id":"mine","name":"Mine","state":"approved"},{"id":"mine-too","name":"Mine Too","state":"pending"}]'
            && alone.recordings.length === 0 && alone.replays === 0
            && JSON.stringify(alone.statistics) === '[{"dataSet":"a","started":1,"won":1,"lost":0,"name":"A"}]' && alone.achievements.length === 0,
            'its identity, its sets with their states, no recording, its own games, and no achievement');

        // The key links a second playerId.
        console.log('\nThe key:');
        const wrong = await change(THIRD, { action: 'link', key: 'Z'.repeat(IDENTITY_KEY_LENGTH) });
        const malformed = await change(THIRD, { action: 'link', key: 'not a key' });
        const before = (await profileOf(THIRD)).profile.identity;
        check(wrong.status === 403 && malformed.status === 400 && before?.name === 'sixteen chars ok',
            'a key that is no identity\'s: 403; one of no key\'s form: 400; the browser left as it was');
        const linked = await change(OTHER, { action: 'link', key: identityKeyText(key).toLowerCase().replace(/0/g, 'o') });
        check(linked.status === 200 && linked.json.id === id && linked.json.name === 'Tehel Two' && linked.json.key === undefined,
            'the key, in lowercase, grouped, an O for a 0, links the second browser: 200, the identity, no key');
        const both = [(await profileOf(PLAYER)).profile, (await profileOf(OTHER)).profile];
        console.log(`  the dump, linked: ${JSON.stringify(both[0])}`);
        check(JSON.stringify(both[0]) === JSON.stringify(both[1]), 'the dump answers both browsers the same');
        const dump = both[0]!;
        check(dump.identity?.browsers === 2 && dump.dataSets.length === 2
            && dump.recordings.length === 1 && dump.recordings[0]?.id === recording && dump.recordings[0].title === 'Their win' && dump.recordings[0].state === 'approved'
            && dump.recordings[0].name === 'A' && !dump.recordings[0].broken && dump.replays === 1
            && JSON.stringify(dump.statistics) === '[{"dataSet":"a","started":2,"won":1,"lost":2,"name":"A"}]',
            'the identity\'s two browsers: the first\'s sets, the second\'s recording, listed, one replay, both\'s games together');
        const tehels = await named(OTHER, 'Tehel Three');
        check(tehels.status === 200 && tehels.json.id === id && (await profileOf(PLAYER)).profile.identity?.name === 'Tehel Three',
            'either browser renames the identity');
        check((await profileOf(PLAYER)).profile.identity !== null && identities.of(OTHER)?.id === id
            && (db.prepare('SELECT COUNT(*) AS n FROM identities WHERE name = ?').get('Tehel') as { n: number }).n === 1,
            'the second browser\'s own identity, left, keeps its name');
        const drawnAgain = await change(PLAYER, { action: 'key' });
        const oldKey = await change(THIRD, { action: 'link', key });
        const newKey = await change(THIRD, { action: 'link', key: drawnAgain.json.key ?? '' });
        check(drawnAgain.status === 200 && drawnAgain.json.id === id && (drawnAgain.json.key ?? '') !== key && identityKeyOf(drawnAgain.json.key ?? '') !== null
            && oldKey.status === 403 && newKey.status === 200 && newKey.json.id === id && (await profileOf(THIRD)).profile.identity?.browsers === 3,
            'a new key: the old one refused from then, the new one linking a third browser');
        const keyless = await change('33333333-3333-4333-8333-333333333333', { action: 'key' });
        check(keyless.status === 409, 'a new key asked by a browser no identity links: 409');

        // A moderator's reset.
        console.log('\nThe reset:');
        const reset = (player: string, target: string, body: object | string = { action: 'reset' }) => ask(port, `/${IDENTITIES_ROUTE}/${target}`, 'POST',
            { [PLAYER_ID_HEADER]: player, 'Content-Type': 'application/json' }, typeof body === 'string' ? body : JSON.stringify(body));
        const refusedResets = [
            [await reset(MODERATOR, id, { action: 'erase' }), 400], [await reset(MODERATOR, id, '{'), 400], [await reset(MODERATOR, id, { action: 'reset', why: 'x' }), 400],
            [await reset(MODERATOR, 'zzzzzzzzzz'), 404], [await reset(MODERATOR, 'Tehel'), 404], [await reset(PLAYER, id), 403],
        ] as const;
        check(refusedResets.every(([answer, status]) => answer.status === status) && identities.get(id)?.name === 'Tehel Three',
            `another body 400, an unknown id 404, an asker who is not a moderator 403, nothing changed: ${refusedResets.map(([answer]) => answer.status).join()}`);
        const done = await reset(MODERATOR, id);
        const afterReset = (await profileOf(OTHER)).profile.identity;
        const again = await reset(MODERATOR, id);
        check(done.status === 200 && done.body === JSON.stringify({ id }) && afterReset?.name === null && afterReset.id === id && afterReset.browsers === 3
            && again.status === 409, 'a moderator resets the name: the identity keeps its id and its browsers, with no name; a second reset 409');
        const retired = [await named(OTHER, 'tehel three'), await named('44444444-4444-4444-8444-444444444444', 'TEHEL THREE')];
        check(retired.every((answer) => answer.status === 409 && answer.json.error === 'A moderator has withdrawn this name.'),
            'the name reset is refused to everyone from then, in any case');
        const renamedAfter = await named(PLAYER, 'Tehel Four');
        check(renamedAfter.status === 200 && renamedAfter.json.id === id && renamedAfter.json.key === undefined, 'its player names the identity again: 200, the id kept');
        const told = notified.flatMap((event) => 'publicId' in event && event.publicId === id ? [`${event.activity} ${event.name}${event.was ? ` from ${event.was}` : ''} by ${event.by}`] : []);
        console.log(`  told: ${JSON.stringify(told)}`);
        check(JSON.stringify(told) === JSON.stringify(['chosen Tehel by a player', 'changed tehel from Tehel by a player', 'changed Tehel Two from tehel by a player',
            'changed Tehel Three from Tehel Two by a player', 'reset Tehel Three by Alice', 'chosen Tehel Four by a player']),
            'the moderators are told of each name chosen, changed, in case too, and reset, by whom; of nothing refused, linked or keyed');
        const last = notified.at(-1);
        check(last !== undefined && new RegExp(`^Name Tehel Four: chosen \\(public id ${id}\\)\nBy a player at \\d{8} \\d\\d:\\d\\d$`).test(notificationText(last)),
            `a name's notification: "${last && notificationText(last).replace('\n', ' / ')}"`);

        // The route's own refusals.
        console.log('\nThe routes:');
        const noPlayer = [await ask(port, `/${PROFILE_ROUTE}`), await change(null, { action: 'name', name: 'Nobody' })];
        const crossSite = await change(PLAYER, { action: 'name', name: 'Elsewhere' }, undefined, { 'Sec-Fetch-Site': 'cross-site' });
        const large = await ask(port, `/${PROFILE_ROUTE}`, 'POST', {
            [PLAYER_ID_HEADER]: PLAYER, 'Content-Length': String(MAX_PROFILE_BYTES + 1), 'X-Real-IP': '10.9.2.1', Connection: 'close' });
        const largeReset = await ask(port, `/${IDENTITIES_ROUTE}/${id}`, 'POST', { [PLAYER_ID_HEADER]: MODERATOR, 'Content-Length': String(MAX_PROFILE_BYTES + 1), Connection: 'close' });
        const notJson = await change(PLAYER, '{"action": "name"}');
        const methods = [await ask(port, `/${PROFILE_ROUTE}`, 'PUT'), await ask(port, `/${IDENTITIES_ROUTE}/${id}`, 'PUT')];
        const viewed = [await ask(port, `/${IDENTITIES_ROUTE}/${id}`), await ask(port, `/${IDENTITIES_ROUTE}/${id}`, 'GET', { [PLAYER_ID_HEADER]: PLAYER }),
            await ask(port, `/${IDENTITIES_ROUTE}/zzzzzzzzzz`, 'GET', { [PLAYER_ID_HEADER]: MODERATOR }), await ask(port, `/${IDENTITIES_ROUTE}/${id}`, 'GET', { [PLAYER_ID_HEADER]: MODERATOR })];
        check(viewed.map((answer) => answer.status).join() === '403,403,404,200' && viewed[3]?.headers['cache-control'] === 'no-store'
            && viewed[3].body === JSON.stringify({ id, name: 'Tehel Four', browsers: 3, proofs: [] }),
            `an identity read: 403 to anyone but a moderator, its own player too, 404 an unknown id, and to a moderator, uncached, its name, browsers and proofs: ${viewed[3]?.body}`);
        check(noPlayer.every((answer) => answer.status === 400) && crossSite.status === 403 && large.status === 413 && largeReset.status === 413 && notJson.status === 400
            && methods.every((answer) => answer.status === 405), 'no player 400, another site\'s POST 403, a body too large 413, a body not an action 400, another method 405');
        const rated: number[] = [];
        for (let n = 0; n <= CHANGES_PER_WINDOW; n++) rated.push((await change(PLAYER, { action: 'name', name: `Rated ${n}` }, '10.9.3.1')).status);
        check(rated.slice(0, -1).every((status) => status === 200) && rated.at(-1) === 429, `the rate per address: ${rated.join()}`);
        const leaked = PLAYER_IDS.filter((player) => bodies.some((body) => body.includes(player)));
        check(leaked.length === 0 && bodies.length > 40, `no answer of the ${bodies.length} holds a playerId`);

        // The store's life.
        console.log('\nThe store:');
        const reopened = new IdentityStore(db);
        check(reopened.of(PLAYER)?.id === id && reopened.players(id).length === 3, 'a store opened again keeps its identities and their browsers');
        db.exec('DROP INDEX events_by_player');
        new StatsStore(db);
        check(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'events_by_player'").get() !== undefined,
            'a log without events_by_player is given it');
    } finally {
        server.close();
        db.close();
        rmSync(scratch, { recursive: true, force: true });
    }
    finish();
    process.exit();
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
