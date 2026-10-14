/**
 * The deployed server (`doc/DEPLOYMENT.md`, `server/`), stood up on a free port
 * over a scratch build, scratch game files and a scratch store, and asked what a browser, a
 * curious visitor, the page's beacon and the compose healthcheck would ask.
 *
 * Asserts:
 *   - the start-up check: the repository's manifest passes, and fills an empty table; a
 *     missing `index.html`, a missing manifest, a manifest that does not parse and a folder
 *     it names that is not there each stop it, saying why, and leave the table empty; a
 *     table that is not empty is read, with no manifest, a changed one left unread, and a
 *     folder it names that is not there stops it too;
 *   - `/api/data-sets`: the table's approved sets, as a manifest the page's parser reads
 *     as the one that filled it, as JSON, not cached, read at each request; a pending set
 *     offered, as pending, to its owner and the moderators only, as the `X-Player-Id`
 *     header names them, and no owner named; `"moderator": true` said to each of two
 *     moderators, and to nobody else; and the manifest not served as a file under
 *     `gamefiles/`;
 *   - `/` and `/assets/…`: the page, `no-cache`, and the hashed files, `immutable`, the
 *     fonts as `font/ttf` and `font/woff2`; and `dist/server/`, the server's module, not
 *     served;
 *   - `/gamefiles/…`: ETag and Last-Modified, a 304 for either precondition, HEAD without
 *     a body, and the query ignored;
 *   - no path leaves the two folders, `..` and `.` raw, percent-encoded or behind a
 *     backslash, and no dot-file is served;
 *   - `/api/health`, and a 405 for a method that is not GET or HEAD;
 *   - `/api/event`: POST only, an event stored (what is stored, `dump-stats` asserts), a bad
 *     one 400, a set added to the table while it runs known at once, a body over 4 KB 413 whether it says so or not, and the rate limit per
 *     forwarded address, 429; `/api/stats`: the store's aggregates, not cached;
 *   - the API is handed the page's own `checkLocalDataSet`, which `tsc` holds to the
 *     shape `server/publish.ts` types it by (`CheckDataSet`);
 *   - `POST /api/data-sets` (`server/publish.ts`), over DM's and CSB's real files: a set
 *     published, its `local:` dropped, its folder written whole with its base set's
 *     `graphics.dat` and its thumbnail, no `.partial` left, its row pending, last, owned by
 *     its sender, its text and flags those of the page's record, and offered to its owner
 *     and the moderators only; one with its own `graphics.dat` and the Hint Oracle; and
 *     every refusal answered with nothing written: the rate limit, no player, not a form,
 *     a field unknown, missing, twice or too long, a bad id, a file or a request too
 *     large, an id the table or the folder holds, and a set the page's check refuses, a
 *     thumbnail that is not a PNG and a base set that is not the site's; a table made
 *     before the publish's columns gains them;
 *   - the walls a published set's row keeps, its `dungeon.dat`'s as the page reads them,
 *     and `/api/data-set-walls`, which gives a player those of the sets `api/data-sets`
 *     offers them, as the page parses them; and `fillWalls`, which reads those of the
 *     rows that keep none from their folders, says a `dungeon.dat` that does not read and
 *     reads none twice;
 *   - `server.ts` itself, as Node runs it: a bad mount, a store it cannot open, a page's
 *     check that is not built, or an entry of `MODERATOR_PLAYER_IDS` that is not a `playerId` exits 1
 *     before it listens; a list of two, spaces around the comma, makes both moderators; and SIGTERM stops a listening server with 0, the store made, its
 *     table filled, and its WAL checkpointed; started again without a manifest, it plays
 *     from the table, and says a published set whose walls it cannot read;
 *   - `backup.ts`, run beside that server: a snapshot in `backups/` holding the events
 *     still in the WAL and the data sets, the server serving throughout, and exit 1 on a
 *     missing store; the folder of a set with an owner copied whole into
 *     `backups/gamefiles/`, the site's not, kept by the next run rather than copied
 *     again, and exit 1 on an owned set whose folder is not there.
 *
 * The scratch build's check (`CHECK_MODULE`) is a stand-in that exports the functions:
 * `tools/dump-build.ts` builds the real one and checks sets through it.
 *
 * Usage: npx tsx tools/dump-server.ts
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { CHECK_MODULE, checkFiles, createAppServer, fillWalls, pathSegments, type ApiOptions, type ServerOptions } from '../server/app.ts';
import { ANYONE, DataSetStore, manifestText } from '../server/dataSets.ts';
import { RateLimit } from '../server/events.ts';
import { MAX_PUBLISH_BYTES, MAX_PUBLISHED_FILE_BYTES } from '../server/publish.ts';
import { StatsStore } from '../server/stats.ts';
import { openStore } from '../server/store.ts';
import { DATA_SET_WALLS_ROUTE, DATA_SETS_ROUTE, LOCAL_DATA_SET_TEXT_LIMITS, parseManifest, PLAYER_ID_HEADER } from '../src/data/DataSets.ts';
import { checkLocalDataSet, localDataSet, readDungeonWalls } from '../src/data/LocalDataSets.ts';
import { parsePublishedDungeons } from '../src/data/DungeonSignature.ts';
import { dataSetNamed, GAMEFILES_DIR, MANIFEST_FILE } from './lib/dataSets.ts';

const ROOT = resolve(import.meta.dirname, '..');

let failures = 0;
function check(ok: boolean, what: string): void {
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}`);
    if (!ok) failures++;
}

interface Answer {
    status: number;
    headers: Record<string, string | string[] | undefined>;
    body: string;
}

/** `path` sent as it is: `fetch` would resolve its `..` before the server saw it. */
function ask(port: number, path: string, method = 'GET', headers: Record<string, string> = {}, body?: string | Buffer): Promise<Answer> {
    return new Promise((done, fail) => {
        const req = request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (chunk: string) => (body += chunk));
            res.on('end', () => done({ status: res.statusCode ?? 0, headers: res.headers, body }));
        });
        req.on('error', fail);
        req.end(body);
    });
}

/** A store in memory, its tables empty. */
function emptyTable(): DataSetStore {
    return new DataSetStore(new DatabaseSync(':memory:'));
}

/** What `manifest` says, as the page's parser reads it, to compare. */
function parsed(manifest: string): string {
    return JSON.stringify(parseManifest(manifest, ''));
}

/** The error `checkFiles` throws, or `''`. */
function refusal(options: ServerOptions, dataSets = emptyTable()): string {
    try {
        checkFiles(options, dataSets);
        return '';
    } catch (error) {
        return error instanceof Error ? error.message : String(error);
    }
}

function scratchFiles(scratch: string): ServerOptions {
    const distDir = join(scratch, 'dist');
    const gamefilesDir = join(scratch, 'gamefiles');
    mkdirSync(join(distDir, 'assets'), { recursive: true });
    mkdirSync(join(gamefilesDir, 'set-a'), { recursive: true });
    mkdirSync(join(gamefilesDir, 'logo'), { recursive: true });
    writeFileSync(join(distDir, 'index.html'), '<!doctype html><title>page</title>');
    writeFileSync(join(distDir, 'assets', 'index-AbC123.js'), 'console.log(1);');
    writeFileSync(join(distDir, 'assets', 'font-AbC123.ttf'), Buffer.from([0, 1, 0, 0]));
    writeFileSync(join(distDir, 'assets', 'font-AbC123.woff2'), Buffer.from([0x77, 0x4f, 0x46, 0x32]));
    mkdirSync(join(distDir, 'server'));
    writeFileSync(join(distDir, CHECK_MODULE), 'export function checkLocalDataSet() {}\n'
        + 'export async function readDungeonWalls() { throw new Error("a stand-in"); }\n');
    writeFileSync(join(gamefilesDir, 'manifest.json'), JSON.stringify({
        default: 'a', swoosh: 'logo',
        dataSets: [{ id: 'a', name: 'A', dir: 'set-a' }],
    }));
    writeFileSync(join(gamefilesDir, 'set-a', 'dungeon.dat'), Buffer.from([1, 2, 3, 4]));
    writeFileSync(join(gamefilesDir, 'set-a', '.hidden'), 'hidden');
    writeFileSync(join(scratch, 'secret.txt'), 'SECRET');
    return { distDir, gamefilesDir, manifestFile: join(gamefilesDir, 'manifest.json') };
}

function checkStartUp(scratch: string, options: ServerOptions): void {
    console.log('Start-up check:');
    const repository = emptyTable();
    const real = checkFiles({ distDir: options.distDir, gamefilesDir: GAMEFILES_DIR, manifestFile: MANIFEST_FILE }, repository);
    console.log(`  ${MANIFEST_FILE}: ${real.ids.join(', ')}`);
    check(real.filled && real.ids.length > 0, `the repository's ${MANIFEST_FILE} passes over ${GAMEFILES_DIR}, and fills the table`);
    check(parsed(manifestText(repository.read(), ANYONE)) === parsed(readFileSync(MANIFEST_FILE, 'utf8')),
        'the table answers as the manifest that filled it, every set, flag and folder');
    check(refusal(options) === '', 'the scratch files pass');

    const noPage = refusal({ ...options, distDir: join(scratch, 'nowhere') });
    console.log(`  no page        : ${noPage.split(scratch).join('<scratch>')}`);
    check(noPage.includes('no index.html'), 'a build without index.html is refused');
    const noManifest = refusal({ ...options, manifestFile: join(scratch, 'nowhere.json') });
    console.log(`  no manifest    : ${noManifest.split(scratch).join('<scratch>')}`);
    check(noManifest.includes('there is no manifest'), 'a missing manifest is refused, while the table is empty');

    const bad = join(scratch, 'bad');
    mkdirSync(bad);
    writeFileSync(join(bad, 'manifest.json'), '{ "dataSets": ');
    const badManifest = { ...options, gamefilesDir: bad, manifestFile: join(bad, 'manifest.json') };
    const notJson = refusal(badManifest);
    console.log(`  not JSON       : ${notJson}`);
    check(notJson.includes('is not JSON'), 'a manifest that does not parse is refused, by the page\'s parser');
    writeFileSync(join(bad, 'manifest.json'), JSON.stringify({
        default: 'a', swoosh: 'gone-logo',
        dataSets: [{ id: 'a', name: 'A', dir: 'gone' }],
    }));
    const unfilled = emptyTable();
    const missing = refusal(badManifest, unfilled);
    console.log(`  missing folders: ${missing.split(scratch).join('<scratch>')}`);
    check(missing.endsWith('does not hold: gone, gone-logo'), 'every folder the manifest names and the folder lacks is named');
    check(unfilled.isEmpty(), 'and the table is left empty, for the next start to read the manifest again');

    const filled = emptyTable();
    checkFiles(options, filled);
    const before = manifestText(filled.read(), ANYONE);
    const fromTable = checkFiles({ ...options, manifestFile: join(scratch, 'nowhere.json') }, filled);
    check(!fromTable.filled && fromTable.ids.join() === 'a', 'a table that is not empty is read, and the manifest is not: none is needed');
    const changed = join(scratch, 'changed.json');
    writeFileSync(changed, JSON.stringify({ default: 'z', dataSets: [{ id: 'z', name: 'Z', dir: 'set-a' }] }));
    check(refusal({ ...options, manifestFile: changed }, filled) === '' && manifestText(filled.read(), ANYONE) === before,
        'a manifest changed since is not read, and the table keeps what it holds');
    const tableMissing = refusal({ ...options, gamefilesDir: bad }, filled);
    console.log(`  table's folders: ${tableMissing.split(scratch).join('<scratch>')}`);
    check(tableMissing.startsWith('the data_sets table names folders') && tableMissing.endsWith('does not hold: set-a, logo'),
        'every folder the table names and the folder lacks is named');
}

async function checkAnswers(port: number, manifest: string): Promise<void> {
    console.log('\nThe page:');
    const page = await ask(port, '/?dungeon=csb');
    check(page.status === 200 && page.body.includes('<title>page</title>'), '/ is index.html, whatever the query');
    check(page.headers['cache-control'] === 'no-cache', `index.html is no-cache (${page.headers['cache-control']})`);
    check(String(page.headers['content-type']).startsWith('text/html'), 'as text/html');
    const asset = await ask(port, '/assets/index-AbC123.js');
    check(asset.status === 200 && asset.body === 'console.log(1);', 'a hashed asset is served');
    check(String(asset.headers['cache-control']).includes('immutable'), `a hashed asset is immutable (${asset.headers['cache-control']})`);
    check(String(asset.headers['content-type']).startsWith('text/javascript'), 'as text/javascript');
    for (const [file, type] of [['font-AbC123.ttf', 'font/ttf'], ['font-AbC123.woff2', 'font/woff2']]) {
        const font = await ask(port, `/assets/${file}`);
        check(font.status === 200 && font.headers['content-type'] === type, `a font, as ${type} (${font.headers['content-type']})`);
    }
    check((await ask(port, '/index.html')).headers['cache-control'] === 'no-cache', '/index.html is no-cache too');
    check((await ask(port, '/assets/nothing.js')).status === 404, 'a missing file is 404');
    check((await ask(port, '/assets')).status === 404, 'a folder is 404, not a listing');
    check((await ask(port, `/${CHECK_MODULE}`)).status === 404, `the server's module, ${CHECK_MODULE}, is not served`);

    console.log('\nThe game files:');
    const file = await ask(port, '/gamefiles/set-a/dungeon.dat');
    const etag = String(file.headers.etag);
    const lastModified = String(file.headers['last-modified']);
    console.log(`  ETag ${etag}, Last-Modified ${lastModified}`);
    check(file.status === 200 && file.body.length === 4, 'a game file is served');
    check(file.headers['content-type'] === 'application/octet-stream', `a .dat is application/octet-stream (${file.headers['content-type']})`);
    check(file.headers['cache-control'] === 'no-cache', 'a game file is revalidated, as an upload may change it');
    check(etag.startsWith('W/"') && lastModified !== 'undefined', 'with an ETag and a Last-Modified');
    check((await ask(port, '/gamefiles/set-a/dungeon.dat', 'GET', { 'If-None-Match': etag })).status === 304, 'If-None-Match with its ETag: 304');
    check((await ask(port, '/gamefiles/set-a/dungeon.dat', 'GET', { 'If-None-Match': `"other", ${etag.slice(2)}` })).status === 304,
        'If-None-Match, compared weakly, in a list: 304');
    check((await ask(port, '/gamefiles/set-a/dungeon.dat', 'GET', { 'If-None-Match': '"other"' })).status === 200, 'If-None-Match with another tag: 200');
    check((await ask(port, '/gamefiles/set-a/dungeon.dat', 'GET', { 'If-Modified-Since': lastModified })).status === 304, 'If-Modified-Since its date: 304');
    check((await ask(port, '/gamefiles/set-a/dungeon.dat', 'GET', { 'If-Modified-Since': 'Thu, 01 Jan 1970 00:00:00 GMT' })).status === 200,
        'If-Modified-Since an older date: 200');
    check((await ask(port, '/gamefiles/set-a/dungeon.dat', 'GET', { 'If-None-Match': '"other"', 'If-Modified-Since': lastModified })).status === 200,
        'If-None-Match wins over If-Modified-Since');
    const head = await ask(port, '/gamefiles/set-a/dungeon.dat', 'HEAD');
    check(head.status === 200 && head.body === '' && head.headers['content-length'] === '4', 'HEAD: the headers, no body');
    check((await ask(port, '/gamefiles/manifest.json')).status === 404, 'the manifest, in the folder, is not served as a file');

    console.log('\nPaths that would leave the folders:');
    for (const path of [
        '/gamefiles/../secret.txt', '/gamefiles/%2e%2e/secret.txt', '/gamefiles/%2E%2E%2Fsecret.txt',
        '/gamefiles/..%2fsecret.txt', '/gamefiles/..%5csecret.txt', '/gamefiles/set-a/..', '/../secret.txt',
        '/gamefiles/./manifest.json', '/gamefiles/set-a/.hidden', '/gamefiles/set-a/%00dungeon.dat', '/gamefiles/%zz', 'secret.txt',
    ]) {
        const answer = await ask(port, path);
        check(answer.status === 400 && !answer.body.includes('SECRET') && !answer.body.includes('hidden'), `${path}: ${answer.status}`);
    }
    check(JSON.stringify(pathSegments('//gamefiles//set-a/dungeon.dat?x=/../y')) === '["gamefiles","set-a","dungeon.dat"]',
        'empty segments are skipped, and the query is not part of the path');

    console.log('\nThe API:');
    const health = await ask(port, '/api/health');
    check(health.status === 200 && health.body === '{"ok":true}' && health.headers['cache-control'] === 'no-store', '/api/health: 200, not cached');
    const dataSets = await ask(port, '/api/data-sets?dungeon=a');
    console.log(`  /api/data-sets: ${dataSets.body}`);
    check(dataSets.status === 200 && parsed(dataSets.body) === parsed(manifest), '/api/data-sets: the table, as the manifest that filled it');
    check(String(dataSets.headers['content-type']).startsWith('application/json') && dataSets.headers['cache-control'] === 'no-store',
        'as JSON, not cached');
    check((await ask(port, '/api/data-sets', 'HEAD')).body === '', 'HEAD /api/data-sets: no body');
    const put = await ask(port, '/api/data-sets', 'PUT');
    check(put.status === 405 && put.headers.allow === 'GET, HEAD, POST', 'PUT on /api/data-sets: 405, with Allow: GET, HEAD, POST');
    check((await ask(port, '/api/nothing')).status === 404, 'an unknown API is 404');
    const post = await ask(port, '/', 'POST');
    check(post.status === 405 && post.headers.allow === 'GET, HEAD', 'POST on a file: 405, with Allow');
    check((await ask(port, '/api/health', 'DELETE')).status === 405, 'DELETE on /api/health: 405');
}

/**
 * Rows added to the table while the server runs, as P8's upload and approval will add them:
 * each request reads them.
 */
async function checkTableRead(port: number, db: DatabaseSync, manifest: string): Promise<void> {
    console.log('\nThe table, changed while the server runs:');
    const insert = db.prepare(
        'INSERT INTO data_sets (id, name, dir, position, status, owner, dm_rules) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const event = (set: string) => JSON.stringify({ type: 'started', player: PLAYER, set, playthrough: 1, build: 'test', payload: {} });
    let address = 0;
    const post = (set: string) => ask(port, '/api/event', 'POST', { 'X-Real-IP': `10.2.0.${++address}` }, event(set));

    check((await post('b')).status === 400, 'an event of a set the table lacks: 400');
    insert.run('p', 'Pending', 'set-a', 1, 'pending', PLAYER, 0);
    const as = async (player: string | null) => {
        const answer = await ask(port, '/api/data-sets', 'GET', player === null ? {} : { [PLAYER_ID_HEADER]: player });
        return { answer, sets: parseManifest(answer.body, '').dataSets };
    };
    const anyone = await as(null);
    check(parsed(anyone.answer.body) === parsed(manifest), 'a pending set is left out of the answer to a page that names no player');
    check(anyone.answer.headers.vary === PLAYER_ID_HEADER, `the answer varies with ${PLAYER_ID_HEADER} (Vary: ${anyone.answer.headers.vary})`);
    check(parsed((await as(OTHER)).answer.body) === parsed(manifest), 'and to another player');
    check(parsed((await as(MODERATORS[0].toUpperCase())).answer.body) === parsed(manifest), 'and to a moderator\'s id in another form: a playerId is lowercase');
    const owner = await as(PLAYER);
    console.log(`  to its owner: ${owner.answer.body}`);
    check(owner.sets.map((set) => `${set.id}${set.pending ? ' pending' : ''}`).join() === 'a,p pending', 'its owner is offered it, in its place, and told it is pending');
    check(!owner.answer.body.includes(PLAYER) && !owner.answer.body.includes('owner'), 'the answer names no owner, nor any playerId');
    for (const [i, moderator] of MODERATORS.entries()) {
        const asked = await as(moderator);
        console.log(`  to moderator ${i + 1}: ${asked.answer.body}`);
        check(asked.sets.map((set) => `${set.id}${set.pending ? ' pending' : ''}`).join() === 'a,p pending' && JSON.parse(asked.answer.body).moderator === true,
            `moderator ${i + 1} is offered every set, another player's pending one too, and told they moderate`);
    }
    check(!anyone.answer.body.includes('moderator') && !owner.answer.body.includes('moderator'), 'nobody else is told so, not even the set\'s owner');
    check((await post('p')).status === 204, 'and its events are taken');
    insert.run('b', 'B', 'set-a', 2, 'approved', null, 1);
    const approved = parseManifest((await ask(port, '/api/data-sets')).body, '');
    const added = approved.dataSets.at(-1);
    console.log(`  added: ${JSON.stringify(added)}`);
    check(approved.dataSets.map((set) => set.id).join() === 'a,b' && added?.dir === 'set-a' && added.dmRules && !added.hidden && !added.pending,
        'an approved set is answered at the next request, in its place, with its folder and flags');
    check((await post('b')).status === 204, 'and its events are taken at once');
}

const PLAYER = '00000000-0000-4000-8000-000000000000';
/** Another player, who owns nothing. */
const OTHER = '11111111-1111-4111-8111-111111111111';
/** The scratch server's `MODERATOR_PLAYER_IDS`. */
const MODERATORS = ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'] as const;
/** The scratch server's rate limit: events per address and window. */
const EVENTS_PER_WINDOW = 5;

async function checkEvents(port: number, store: StatsStore): Promise<void> {
    console.log('\nThe statistics:');
    let address = 0;
    /** Each from its own address, so that only the rate limit's own check meets it. */
    const post = (body: string, headers: Record<string, string> = {}) =>
        ask(port, '/api/event', 'POST', { 'Content-Type': 'text/plain;charset=UTF-8', 'X-Real-IP': `10.0.0.${++address}`, ...headers }, body);
    const event = (playthrough: number) => JSON.stringify({ type: 'started', player: PLAYER, set: 'a', playthrough, build: 'test', payload: {} });

    const stored = await post(event(1));
    check(stored.status === 204 && stored.body === '', 'an event: 204, no body');
    const stats = await ask(port, '/api/stats');
    console.log(`  /api/stats: ${stats.body.replace(/"week":"[^"]+"/g, '"week":<this week>')}`);
    check(stats.status === 200 && String(stats.headers['content-type']).startsWith('application/json') && stats.headers['cache-control'] === 'no-store',
        '/api/stats: JSON, not cached');
    check(JSON.stringify(JSON.parse(stats.body)) === JSON.stringify(store.stats()) && store.stats().players === 1, 'the store\'s aggregates, the event in them');
    check((await ask(port, '/api/stats', 'HEAD')).body === '', 'HEAD /api/stats: no body');

    const bad = await post(event(-1));
    check(bad.status === 400 && bad.body === 'Bad event: bad playthrough', `a bad event: ${bad.status}, ${bad.body}`);
    const big = JSON.stringify({ ...JSON.parse(event(2)), padding: 'x'.repeat(4096) });
    check((await post(big)).status === 413, 'a body over 4 KB that says so: 413');
    check((await post(big, { 'Transfer-Encoding': 'chunked' })).status === 413, 'a body over 4 KB, chunked: 413');
    const get = await ask(port, '/api/event');
    check(get.status === 405 && get.headers.allow === 'POST', 'GET on /api/event: 405, with Allow: POST');
    check(store.stats().players === 1, 'and none of those was stored');

    const answers: number[] = [];
    for (let i = 0; i <= EVENTS_PER_WINDOW; i++) answers.push((await post(event(10 + i), { 'X-Real-IP': '10.1.1.1' })).status);
    console.log(`  ${EVENTS_PER_WINDOW + 1} events from one address: ${answers.join(' ')}`);
    check(answers.slice(0, -1).every((status) => status === 204) && answers[EVENTS_PER_WINDOW] === 429, `the rate limit: ${EVENTS_PER_WINDOW} an address, then 429`);
    check((await post(event(20), { 'X-Real-IP': '10.1.1.2' })).status === 204, 'another address is still heard');
    check((await ask(port, '/api/event', 'POST', {}, event(21))).status === 204, 'without X-Real-IP, the socket\'s address counts');
}

/** The scratch publish server's rate limit: publishes per address and window. */
const PUBLISHES_PER_WINDOW = 3;

/** `bytes` as the form sends a file. */
function fileOf(bytes: Uint8Array<ArrayBuffer>, name: string, type = 'application/octet-stream'): File {
    return new File([bytes], name, { type });
}

/** What the folder holds and the table says: compared before and after a refusal. */
function written(gamefilesDir: string, dataSets: DataSetStore): string {
    return `${readdirSync(gamefilesDir).sort().join()} | ${dataSets.read().dataSets.map((set) => set.id).join()}`;
}

/**
 * `POST /api/data-sets`, on a server of its own over DM's and CSB's real files: `dm-atari`
 * and `csb` the site's base sets, `conflux` a set whose folder is not its id, and `swoosh`
 * a folder no row names.
 */
async function checkPublish(scratch: string): Promise<void> {
    console.log('\nPublishing a set:');
    const root = join(scratch, 'publish');
    const distDir = join(root, 'dist');
    const gamefilesDir = join(root, 'gamefiles');
    mkdirSync(distDir, { recursive: true });
    writeFileSync(join(distDir, 'index.html'), '<!doctype html><title>page</title>');
    const dm = dataSetNamed('dm-atari'), csb = dataSetNamed('csb');
    for (const [folder, from] of [['dm-atari', dm.dir], ['csb', csb.dir]] as const) {
        mkdirSync(join(gamefilesDir, folder), { recursive: true });
        symlinkSync(resolve(from, 'graphics.dat'), join(gamefilesDir, folder, 'graphics.dat'));
    }
    mkdirSync(join(gamefilesDir, 'conflux-dir'));
    mkdirSync(join(gamefilesDir, 'swoosh'));
    const manifestFile = join(root, 'manifest.json');
    writeFileSync(manifestFile, JSON.stringify({
        default: 'dm-atari', swoosh: 'swoosh',
        dataSets: [{ id: 'dm-atari', name: 'DM' }, { id: 'csb', name: 'CSB' }, { id: 'conflux', name: 'Conflux', dir: 'conflux-dir' }],
    }));
    const options: ServerOptions = { distDir, gamefilesDir, manifestFile };
    const db = new DatabaseSync(':memory:');
    const dataSets = new DataSetStore(db);
    checkFiles(options, dataSets);
    const server = createAppServer(options, {
        checkDataSet: checkLocalDataSet, dataSets, moderatorPlayerIds: MODERATORS, store: new StatsStore(db),
        rules: { hasSet: (id) => dataSets.hasSet(id) }, rateLimit: new RateLimit(EVENTS_PER_WINDOW, 60_000),
        publishRateLimit: new RateLimit(PUBLISHES_PER_WINDOW, 60_000), now: Date.now,
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const port = (server.address() as AddressInfo).port;

    try {
        const dmDungeon = new Uint8Array(readFileSync(`${dm.dir}/dungeon.dat`));
        const thumbnail = new Uint8Array(readFileSync(`${dm.dir}/dm-atari-thumbnail.png`));
        const fields = (id: string, extra: Record<string, string | string[]> = {}): Record<string, string | string[]> => ({
            id, name: '  My DM ', description: 'Mine. ', authors: ['A Player', ' ', 'Another '], dmRules: 'true', baseSet: 'dm-atari', ...extra,
        });
        const dmFiles = (): Record<string, File> => ({ 'dungeon.dat': fileOf(dmDungeon, 'dungeon.dat'), thumbnail: fileOf(thumbnail, 'thumbnail.png', 'image/png') });
        let address = 0;
        /** The form posted from an address of its own, as `player`, the page's `fetch` would send it. */
        const publish = async (text: Record<string, string | string[]>, files: Record<string, File>, player: string | null = PLAYER, ip = `10.3.0.${++address}`) => {
            const form = new FormData();
            for (const [key, value] of Object.entries(text)) for (const one of [value].flat()) form.append(key, one);
            for (const [key, file] of Object.entries(files)) form.append(key, file);
            const headers: Record<string, string> = { 'X-Real-IP': ip };
            if (player !== null) headers[PLAYER_ID_HEADER] = player;
            const response = await fetch(`http://127.0.0.1:${port}/${DATA_SETS_ROUTE}`, { method: 'POST', headers, body: form });
            const body = await response.text();
            return { status: response.status, type: response.headers.get('content-type') ?? '', body, json: JSON.parse(body) as { id?: string; error?: string; problems?: { about: string; text: string }[] } };
        };
        const seen = async (player: string | null) => parseManifest((await ask(port, '/api/data-sets', 'GET', player === null ? {} : { [PLAYER_ID_HEADER]: player })).body, '')
            .dataSets.map((set) => `${set.id}${set.pending ? ' pending' : ''}`).join();

        const before = written(gamefilesDir, dataSets);
        const accepted = await publish(fields('local:my-dm'), dmFiles());
        console.log(`  published: ${accepted.status} ${accepted.body}`);
        check(accepted.status === 201 && accepted.json.id === 'my-dm' && accepted.type.startsWith('application/json'), 'a set is published: 201, its id without local:, as JSON');
        check(!accepted.body.includes(PLAYER), 'the answer names no playerId');
        const folder = join(gamefilesDir, 'my-dm');
        console.log(`  its folder: ${readdirSync(folder).sort().join(', ')}`);
        check(readdirSync(folder).sort().join() === 'dungeon.dat,graphics.dat,my-dm-thumbnail.png', 'its folder holds its files, its base set\'s graphics.dat and its thumbnail, and nothing else');
        check(readFileSync(join(folder, 'dungeon.dat')).equals(dmDungeon) && readFileSync(join(folder, 'graphics.dat')).equals(readFileSync(`${dm.dir}/graphics.dat`))
            && readFileSync(join(folder, 'my-dm-thumbnail.png')).equals(thumbnail), 'each file as it was sent, the graphics.dat the base set\'s');
        check(!readdirSync(gamefilesDir).some((name) => name.startsWith('.')), 'no .partial is left');
        const row = db.prepare('SELECT * FROM data_sets WHERE id = ?').get('my-dm') as Record<string, unknown>;
        console.log(`  its row: ${JSON.stringify({ ...row, owner: row.owner === PLAYER ? '<the player>' : row.owner, walls: row.walls === null ? null : '<its walls>' })}`);
        const dmFolder = { read: async (name: string) => new Uint8Array(readFileSync(`${dm.dir}/${name}`)), where: (name: string) => name };
        const record = (await checkLocalDataSet({ id: 'my-dm', name: '  My DM ', description: 'Mine. ', authors: ['A Player', ' ', 'Another '], dmRules: true, baseSet: 'dm-atari', files: dmFiles() },
            new Set(), (set) => (set === 'dm-atari' ? dmFolder : null), 0)).record!;
        const flags = localDataSet(record);
        const stored = dataSets.read().dataSets.find((set) => set.id === 'my-dm')!;
        check(row.status === 'pending' && row.owner === PLAYER && row.dir === 'my-dm' && row.position === 3, 'its row is pending, owned by its sender, its folder its id, last in the list');
        check(row.name === record.name && row.description === record.description && row.authors === JSON.stringify(record.authors) && record.authors.join() === 'A Player,Another',
            'its name, description and authors are the page\'s record\'s, trimmed, the empty author dropped');
        check((['csbGraphics', 'miniDat', 'hintOracle', 'dmRules', 'hidden'] as const).every((flag) => stored[flag] === flags[flag]), 'its flags are those localDataSet gives the record');
        check(await seen(PLAYER) === 'dm-atari,csb,conflux,my-dm pending' && await seen(MODERATORS[0]) === 'dm-atari,csb,conflux,my-dm pending',
            'it is offered, pending, to its owner and the moderators');
        check(await seen(null) === 'dm-atari,csb,conflux' && await seen(OTHER) === 'dm-atari,csb,conflux', 'and to nobody else');
        check(before !== written(gamefilesDir, dataSets), 'the snapshot of the folder and the table sees a publish');

        const csbFiles = Object.fromEntries(['dungeon.dat', 'graphics.dat', 'hcsb.hct', 'hcsb.dat'].map((name) => [name, fileOf(new Uint8Array(readFileSync(`${csb.dir}/${name}`)), name)]));
        const own = await publish(fields('my-csb', { name: 'My CSB', dmRules: 'false' }), csbFiles, OTHER);
        const ownSet = dataSets.read().dataSets.find((set) => set.id === 'my-csb');
        console.log(`  with its own graphics: ${own.status} ${own.body}, ${readdirSync(join(gamefilesDir, 'my-csb')).sort().join(', ')}`);
        check(own.status === 201 && readdirSync(join(gamefilesDir, 'my-csb')).sort().join() === 'dungeon.dat,graphics.dat,hcsb.dat,hcsb.hct'
            && readFileSync(join(gamefilesDir, 'my-csb', 'graphics.dat')).equals(readFileSync(`${csb.dir}/graphics.dat`)),
            'a set with its own graphics.dat keeps it, and has no thumbnail where it was given none');
        check(ownSet?.hintOracle === true && !ownSet.csbGraphics && !ownSet.dmRules && ownSet.owner === OTHER, 'its flags follow from its files: the Hint Oracle, no DM rules');

        // The walls the rows keep, and api/data-set-walls.
        const dmWalls = JSON.stringify(await readDungeonWalls(dmDungeon));
        const csbWalls = JSON.stringify(await readDungeonWalls(new Uint8Array(readFileSync(`${csb.dir}/dungeon.dat`))));
        const kept = () => [...dataSets.walls()].map(([id, walls]) => `${id} ${walls.signature.length} levels`).join(', ');
        console.log(`  the walls kept: ${kept()}`);
        check(JSON.stringify(dataSets.walls().get('my-dm')) === dmWalls && JSON.stringify(dataSets.walls().get('my-csb')) === csbWalls
            && kept() === 'my-dm 14 levels, my-csb 2 levels', 'a published set\'s row keeps its dungeon.dat\'s walls, as the page reads them; the site\'s keep none');
        const wallsSeen = async (player: string | null) => {
            const answer = await ask(port, `/${DATA_SET_WALLS_ROUTE}`, 'GET', player === null ? {} : { [PLAYER_ID_HEADER]: player });
            const dungeons = parsePublishedDungeons(answer.body);
            return { answer, ids: dungeons.map((dungeon) => `${dungeon.dataSets.join()} (${dungeon.name})`).join(', '), dungeons };
        };
        const forOwner = await wallsSeen(PLAYER);
        console.log(`  api/data-set-walls, to the owner of my-dm: ${forOwner.ids}`);
        check(forOwner.answer.status === 200 && String(forOwner.answer.headers['content-type']).startsWith('application/json')
            && forOwner.answer.headers['cache-control'] === 'no-store' && forOwner.answer.headers.vary === PLAYER_ID_HEADER,
            'api/data-set-walls answers JSON, not cached, by player');
        check(forOwner.ids === 'my-dm (My DM)' && JSON.stringify({ shapes: forOwner.dungeons[0].shapes, signature: forOwner.dungeons[0].signature }) === dmWalls,
            'a player is given the walls of the sets api/data-sets offers them that keep some: their own pending one, as the page reads it');
        check((await wallsSeen(MODERATORS[0])).ids === 'my-dm (My DM), my-csb (My CSB)' && (await wallsSeen(null)).ids === '',
            'a moderator every published set\'s, and anyone else none while they are pending');
        dataSets.publish({ id: 'approved', name: 'Approved', description: '', authors: [], csbGraphics: false, hintOracle: false, dmRules: false,
            walls: JSON.parse(dmWalls) }, OTHER);
        db.prepare("UPDATE data_sets SET status = 'approved' WHERE id = 'approved'").run();
        check((await wallsSeen(null)).ids === 'approved (Approved)', 'an approved set\'s, to everyone');
        check((await ask(port, `/${DATA_SET_WALLS_ROUTE}`, 'POST')).status === 405, 'and only to GET and HEAD');

        // The walls of the sets published before the rows kept them, read at start-up.
        db.prepare("UPDATE data_sets SET walls = NULL WHERE owner IS NOT NULL AND id <> 'approved'").run();
        mkdirSync(join(gamefilesDir, 'broken'));
        writeFileSync(join(gamefilesDir, 'broken', 'dungeon.dat'), new Uint8Array([1, 2, 3]));
        db.prepare("INSERT INTO data_sets (id, name, dir, position, status, owner) VALUES ('broken', 'Broken', 'broken', 99, 'pending', ?)").run(OTHER);
        const filled = await fillWalls(gamefilesDir, dataSets, readDungeonWalls);
        console.log(`  the walls filled: ${filled.filled.join(', ')}; failed: ${filled.failed.join(', ')}`);
        check(filled.filled.join() === 'my-dm,my-csb' && JSON.stringify(dataSets.walls().get('my-dm')) === dmWalls && JSON.stringify(dataSets.walls().get('my-csb')) === csbWalls,
            'a published set whose row keeps no walls has them read from its folder\'s dungeon.dat, the same as on publish');
        check(filled.failed.length === 1 && filled.failed[0].startsWith('broken (') && !dataSets.walls().has('broken') && dataSets.missingWalls().map((set) => set.id).join() === 'broken',
            'one whose dungeon.dat does not read is said, and left without, to be read again at the next start');
        check((await fillWalls(gamefilesDir, dataSets, async () => { throw new Error('not asked'); })).filled.length === 0, 'the others are not read again');
        db.prepare("DELETE FROM data_sets WHERE id IN ('broken', 'approved')").run();
        rmSync(join(gamefilesDir, 'broken'), { recursive: true });

        console.log('  refusals:');
        const refused = async (label: string, status: number, send: () => Promise<{ status: number; body: string }>, says = '') => {
            const was = written(gamefilesDir, dataSets);
            const answer = await send();
            console.log(`    ${label}: ${answer.status} ${answer.body.length > 200 ? `${answer.body.slice(0, 200)}…` : answer.body}`);
            check(answer.status === status && answer.body.includes(says) && written(gamefilesDir, dataSets) === was, `${label}: ${status}, nothing written`);
        };
        await refused('the id again', 409, () => publish(fields('my-dm'), dmFiles()), 'a set of this id');
        await refused('a set\'s id whose folder is another', 409, () => publish(fields('conflux'), dmFiles()), 'a set of this id');
        await refused('a folder no row names', 409, () => publish(fields('swoosh'), dmFiles()), 'a folder of this name');
        await refused('an id that is not a folder\'s name', 400, () => publish(fields('.hidden'), dmFiles()), 'An id is');
        await refused('an id with a slash', 400, () => publish(fields('local:a/b'), dmFiles()), 'An id is');
        await refused('no player', 400, () => publish(fields('p1'), dmFiles(), null), 'No player');
        await refused('a player that is not a playerId', 400, () => publish(fields('p1'), dmFiles(), 'me'), 'No player');
        await refused('not a form', 400, () => ask(port, '/api/data-sets', 'POST', { [PLAYER_ID_HEADER]: PLAYER, 'Content-Type': 'application/json', 'X-Real-IP': '10.3.1.1' }, '{}'), 'not multipart');
        await refused('a broken form', 400, () => ask(port, '/api/data-sets', 'POST', { [PLAYER_ID_HEADER]: PLAYER, 'Content-Type': 'multipart/form-data; boundary=x', 'X-Real-IP': '10.3.1.2' }, '--x\r\nnonsense'), 'not a form');
        await refused('an unknown file', 400, () => publish(fields('p1'), { ...dmFiles(), 'run.sh': fileOf(new Uint8Array(4), 'run.sh') }), "field 'run.sh'");
        await refused('a field missing', 400, () => { const text = fields('p1'); delete text.baseSet; return publish(text, dmFiles()); }, "'baseSet' is not one text");
        await refused('a field twice', 400, () => publish(fields('p1', { name: ['A', 'B'] }), dmFiles()), "'name' is not one text");
        await refused('a file sent as text', 400, () => publish({ ...fields('p1'), 'dungeon.dat': 'bytes' }, {}), "'dungeon.dat' is not one file");
        await refused('dmRules neither true nor false', 400, () => publish(fields('p1', { dmRules: 'on' }), dmFiles()), "'dmRules'");
        await refused('a name too long', 400, () => publish(fields('p1', { name: 'x'.repeat(LOCAL_DATA_SET_TEXT_LIMITS.name + 1) }), dmFiles()), 'name is longer');
        await refused('authors too long', 400, () => publish(fields('p1', { authors: ['x'.repeat(100), 'y'.repeat(LOCAL_DATA_SET_TEXT_LIMITS.authors - 100)] }), dmFiles()), 'authors are longer');
        await refused('a file too large', 413, () => publish(fields('p1'), { ...dmFiles(), 'CSBgraphics.dat': fileOf(new Uint8Array(MAX_PUBLISHED_FILE_BYTES + 1), 'CSBgraphics.dat') }), 'CSBgraphics.dat is larger');
        await refused('a request too large', 413, () => ask(port, '/api/data-sets', 'POST',
            { [PLAYER_ID_HEADER]: PLAYER, 'Content-Type': 'multipart/form-data; boundary=x', 'X-Real-IP': '10.3.1.3' }, Buffer.alloc(MAX_PUBLISH_BYTES + 1)), 'request is larger');
        await refused('a dungeon.dat of zeros', 422, () => publish(fields('p1'), { ...dmFiles(), 'dungeon.dat': fileOf(new Uint8Array(64), 'dungeon.dat') }), '"about":"dungeon.dat"');
        await refused('no dungeon.dat', 422, () => publish(fields('p1'), { thumbnail: dmFiles().thumbnail }), '"about":"dungeon.dat"');
        await refused('a thumbnail that is not a PNG', 422, () => publish(fields('p1'), { ...dmFiles(), thumbnail: fileOf(new Uint8Array(64), 'thumbnail.png', 'image/png') }), '"about":"thumbnail","text":"It is not a PNG."');
        await refused('a base set that is a player\'s', 422, () => publish(fields('p1', { baseSet: 'my-dm' }), { 'dungeon.dat': dmFiles()['dungeon.dat'] }), '"about":"baseSet"');
        await refused('an empty name', 422, () => publish(fields('p1', { name: ' ' }), dmFiles()), '"about":"name"');

        const statuses: number[] = [];
        for (let i = 0; i <= PUBLISHES_PER_WINDOW; i++) statuses.push((await publish(fields('p1', { dmRules: 'on' }), dmFiles(), PLAYER, '10.3.2.1')).status);
        console.log(`  ${PUBLISHES_PER_WINDOW + 1} publishes from one address: ${statuses.join(' ')}`);
        check(statuses.slice(0, -1).every((status) => status === 400) && statuses.at(-1) === 429, `the rate limit counts refused publishes too: ${PUBLISHES_PER_WINDOW} an address, then 429`);
        await refused('the rate limit', 429, () => publish(fields('p2'), dmFiles(), PLAYER, '10.3.2.1'), 'Too many publishes');
        check((await publish(fields('p2'), dmFiles(), PLAYER, '10.3.2.2')).status === 201, 'another address is still heard');
    } finally {
        server.close();
        db.close();
    }
}

/** A table made before the publish's columns gains them, its rows kept, read as before. */
function checkAddedColumns(): void {
    const db = new DatabaseSync(':memory:');
    db.exec(`CREATE TABLE data_sets (id TEXT PRIMARY KEY, name TEXT NOT NULL, dir TEXT NOT NULL, position INTEGER NOT NULL UNIQUE,
        status TEXT NOT NULL CHECK (status IN ('approved', 'pending')), owner TEXT, csb_graphics INTEGER NOT NULL DEFAULT 0,
        mini_dat INTEGER NOT NULL DEFAULT 0, hint_oracle INTEGER NOT NULL DEFAULT 0, dm_rules INTEGER NOT NULL DEFAULT 0, hidden INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE data_set_defaults (only INTEGER PRIMARY KEY CHECK (only = 1), default_set TEXT NOT NULL REFERENCES data_sets (id), swoosh TEXT);
        INSERT INTO data_sets (id, name, dir, position, status) VALUES ('a', 'A', 'set-a', 0, 'approved');
        INSERT INTO data_set_defaults VALUES (1, 'a', NULL);`);
    const dataSets = new DataSetStore(db);
    const columns = (db.prepare('PRAGMA table_info(data_sets)').all() as { name: string }[]).map((column) => column.name);
    const row = db.prepare('SELECT description, authors, walls FROM data_sets').get() as { description: string; authors: string; walls: string | null };
    dataSets.publish({ id: 'b', name: 'B', description: '', authors: [], csbGraphics: false, hintOracle: false, dmRules: false, walls: { shapes: [[1, 1]], signature: ['0'.repeat(64)] } }, PLAYER);
    console.log(`  an older table's columns: ${columns.join(', ')}`);
    check(columns.includes('description') && columns.includes('authors') && columns.includes('walls') && row.description === '' && row.authors === '[]' && row.walls === null
        && dataSets.read().dataSets.map((set) => set.id).join() === 'a,b' && dataSets.walls().get('b')?.shapes.join() === '1,1',
        'a table made before them gains the description, authors and walls, its rows kept');
    db.close();
}

/** A script of `server/` run as Node runs it: on its own types where this Node strips them, through tsx otherwise. */
function startEntry(env: Record<string, string>, script = 'server.ts'): ChildProcess {
    const strips = (process.features as { typescript?: unknown }).typescript;
    const args = strips ? [] : ['--import', 'tsx'];
    return spawn(process.execPath, [...args, join(ROOT, 'server', script)], {
        cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'],
    });
}

/** The first line that is not Node's warning about `node:sqlite`. */
function firstLine(out: string): string {
    return out.trim().split('\n').find((line) => !line.includes('ExperimentalWarning') && !line.includes('--trace-warnings')) ?? '';
}

/** What the child printed, and its exit code, once it ends; `onLine` sees each line as it comes. */
function finish(child: ChildProcess, onLine: (line: string) => void = () => {}): Promise<{ code: number | null; out: string }> {
    let out = '';
    const take = (chunk: Buffer) => {
        out += chunk.toString();
        for (const line of chunk.toString().split('\n')) if (line) onLine(line);
    };
    child.stdout!.on('data', take);
    child.stderr!.on('data', take);
    const timeout = setTimeout(() => child.kill('SIGKILL'), 20000);
    return new Promise((done) => child.on('close', (code) => {
        clearTimeout(timeout);
        done({ code, out });
    }));
}

/** What `checkEntry` learnt of the first `backup.ts` run beside the server. */
interface Backup {
    code: number | null;
    out: string;
    events: number;
    sets: number;
    answering: boolean;
}

async function checkEntry(scratch: string, options: ServerOptions): Promise<void> {
    console.log('\nserver.ts:');
    const statsDb = join(scratch, 'stats', 'stats.db');
    const badMount = await finish(startEntry({ PORT: '0', DIST_DIR: options.distDir, GAMEFILES_DIR: join(scratch, 'nowhere'), MANIFEST_FILE: options.manifestFile, STATS_DB: statsDb }));
    console.log(`  bad mount: exit ${badMount.code}, ${firstLine(badMount.out).split(scratch).join('<scratch>')}`);
    check(badMount.code === 1 && badMount.out.includes('Not starting:'), 'a bad mount exits 1 before it listens');
    const badStore = await finish(startEntry({ PORT: '0', DIST_DIR: options.distDir, GAMEFILES_DIR: options.gamefilesDir, MANIFEST_FILE: options.manifestFile, STATS_DB: options.distDir }));
    console.log(`  bad store: exit ${badStore.code}, ${firstLine(badStore.out).replace(scratch, '<scratch>')}`);
    check(badStore.code === 1 && badStore.out.includes('Not starting:'), 'a store it cannot open exits 1 before it listens');
    const noCheck = join(scratch, 'dist-without-check');
    mkdirSync(noCheck);
    writeFileSync(join(noCheck, 'index.html'), '<!doctype html><title>page</title>');
    const unbuilt = await finish(startEntry({ PORT: '0', DIST_DIR: noCheck, GAMEFILES_DIR: options.gamefilesDir, MANIFEST_FILE: options.manifestFile, STATS_DB: join(scratch, 'unbuilt', 'stats.db') }));
    console.log(`  no check built: exit ${unbuilt.code}, ${firstLine(unbuilt.out).split(scratch).join('<scratch>').replace(/ \(.*\)/, ' (…)')}`);
    check(unbuilt.code === 1 && unbuilt.out.includes(`${CHECK_MODULE} does not load`), 'a page\'s check that is not built exits 1 before it listens');
    const badModerator = await finish(startEntry({ PORT: '0', DIST_DIR: options.distDir, GAMEFILES_DIR: options.gamefilesDir, MANIFEST_FILE: options.manifestFile, STATS_DB: join(scratch, 'moderator', 'stats.db'), MODERATOR_PLAYER_IDS: `${MODERATORS[0]},the-moderator` }));
    console.log(`  bad moderator: exit ${badModerator.code}, ${firstLine(badModerator.out)}`);
    check(badModerator.code === 1 && badModerator.out.includes('MODERATOR_PLAYER_IDS holds an entry that is not a playerId') && !existsSync(join(scratch, 'moderator')),
        'a MODERATOR_PLAYER_IDS entry that is not a playerId exits 1 before it opens the store');

    let healthy = false;
    let walHeld = false;
    let backedUp: Backup | null = null;
    let again: { code: number | null; out: string } | null = null;
    let noFolder: { code: number | null; out: string } | null = null;
    let moderated = '';
    const child = startEntry({ PORT: '0', DIST_DIR: options.distDir, GAMEFILES_DIR: options.gamefilesDir, MANIFEST_FILE: options.manifestFile, STATS_DB: statsDb,
        MODERATOR_PLAYER_IDS: ` ${MODERATORS[0]} , ${MODERATORS[1]} ` });
    const ended = finish(child, (line) => {
        const listening = /^Listening on port (\d+)/.exec(line);
        if (!listening) return;
        const port = Number(listening[1]);
        (async () => {
            healthy = (await ask(port, '/api/health')).status === 200;
            const told = async (player: string) => JSON.parse((await ask(port, '/api/data-sets', 'GET', { [PLAYER_ID_HEADER]: player })).body).moderator === true;
            moderated = `${await told(MODERATORS[0])},${await told(MODERATORS[1])},${await told(PLAYER)}`;
            // Three events, which the running server holds in its WAL, then a backup beside it.
            for (let i = 0; i < 3; i++) {
                await ask(port, '/api/event', 'POST', { 'Content-Type': 'text/plain;charset=UTF-8' },
                    JSON.stringify({ type: 'started', player: PLAYER, set: 'a', playthrough: 100 + i, build: 'test', payload: {} }));
            }
            walHeld = existsSync(`${statsDb}-wal`) && statSync(`${statsDb}-wal`).size > 0;
            // A player's set, uploaded beside the site's while the server runs.
            mkdirSync(join(options.gamefilesDir, 'set-b', 'sub'), { recursive: true });
            writeFileSync(join(options.gamefilesDir, 'set-b', 'sub', 'dungeon.dat'), Buffer.from([5, 6, 7]));
            const store = openStore(statsDb);
            store.prepare("INSERT INTO data_sets (id, name, dir, position, status, owner) VALUES ('b', 'B', 'set-b', 1, 'pending', ?)").run(PLAYER);
            store.close();
            const run = await finish(startEntry({ STATS_DB: statsDb, GAMEFILES_DIR: options.gamefilesDir }, 'backup.ts'));
            const target = /"target":"([^"]+)"/.exec(run.out)?.[1];
            let events = -1;
            let sets = -1;
            if (target) {
                const copy = new DatabaseSync(target, { readOnly: true });
                events = (copy.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number }).n;
                sets = (copy.prepare('SELECT COUNT(*) AS n FROM data_sets').get() as { n: number }).n;
                copy.close();
            }
            backedUp = { code: run.code, out: run.out, events, sets, answering: (await ask(port, '/api/health')).status === 200 };
            again = await finish(startEntry({ STATS_DB: statsDb, GAMEFILES_DIR: options.gamefilesDir }, 'backup.ts'));
            noFolder = await finish(startEntry({ STATS_DB: statsDb, GAMEFILES_DIR: join(scratch, 'nowhere'), BACKUP_DIR: join(scratch, 'backups-elsewhere') }, 'backup.ts'));
        })().finally(() => child.kill('SIGTERM'));
    });
    const { code, out } = await ended;
    for (const line of out.trim().split('\n')) {
        if (!line.includes('ExperimentalWarning') && !line.includes('--trace-warnings')) console.log(`  | ${line.split(scratch).join('<scratch>')}`);
    }
    check(healthy, 'it listens on the PORT given, 0 for a free one, and answers /api/health');
    console.log(`  moderator, as the two and a player: ${moderated}`);
    check(moderated === 'true,true,false', 'MODERATOR_PLAYER_IDS, two ids and spaces around the comma, makes both moderators, and nobody else');
    const backup = backedUp as Backup | null;
    const shown = (run: { code: number | null; out: string } | null) => `exit ${run?.code}, ${firstLine(run?.out ?? '').split(scratch).join('<scratch>').replace(/stats-[\dTZ-]+\.db/, 'stats-<date>.db').replace(/"bytes":\d+/, '"bytes":<n>')}`;
    console.log(`  backup.ts: ${shown(backup)}`);
    check(backup?.code === 0 && /<scratch>\/stats\/backups\/stats-[\dTZ-]+\.db/.test((backup?.out ?? '').split(scratch).join('<scratch>')),
        'backup.ts, run beside the server, writes a snapshot into backups/ beside the store');
    check(walHeld && backup?.events === 3, 'the snapshot holds the events the server had in its WAL');
    check(backup?.sets === 2, 'and the data sets\' table');
    check(backup?.answering === true, 'the server kept serving through the backup');
    const folders = join(scratch, 'stats', 'backups', 'gamefiles');
    const copy = join(folders, 'set-b', 'sub', 'dungeon.dat');
    check((backup?.out ?? '').includes('"copied":["set-b"],"kept":0') && existsSync(copy) && readFileSync(copy).equals(Buffer.from([5, 6, 7])),
        'the folder of the set with an owner is copied whole into backups/gamefiles/');
    check(!existsSync(join(folders, 'set-a')) && !existsSync(join(folders, 'set-b.partial')), 'the site\'s is not, and no .partial is left');
    const second = again as { code: number | null; out: string } | null;
    console.log(`  backup.ts again: ${shown(second)}`);
    check(second?.code === 0 && second.out.includes('"copied":[],"kept":1'), 'the next backup keeps that copy rather than copying it again');
    const noStore = await finish(startEntry({ STATS_DB: join(scratch, 'nowhere', 'stats.db') }, 'backup.ts'));
    check(noStore.code === 1 && noStore.out.includes('backup_failed'), 'backup.ts on a store that is not there exits 1');
    const missing = noFolder as { code: number | null; out: string } | null;
    check(missing?.code === 1 && missing.out.includes('backup_failed') && !existsSync(join(scratch, 'backups-elsewhere', 'gamefiles', 'set-b')),
        'backup.ts on a set with an owner whose folder is not there exits 1');
    check(code === 0 && out.includes('SIGTERM: shutting down') && out.includes('Stopped'), 'SIGTERM stops it, with 0');
    check(existsSync(statsDb) && !existsSync(`${statsDb}-wal`), 'the store was made, its folder too, and closed with its WAL checkpointed');
    check(out.includes('(a, from the data_sets table, filled from <scratch>'.replace('<scratch>', scratch)), 'its table filled from the manifest');

    let restartLine = '';
    const restart = startEntry({ PORT: '0', DIST_DIR: options.distDir, GAMEFILES_DIR: options.gamefilesDir, MANIFEST_FILE: join(scratch, 'nowhere.json'), STATS_DB: statsDb });
    const restarted = await finish(restart, (line) => {
        if (!line.startsWith('Listening on port')) return;
        restartLine = line.split(scratch).join('<scratch>').replace(/port \d+/, 'port <n>');
        restart.kill('SIGTERM');
    });
    console.log(`  restarted: ${restartLine}`);
    check(restarted.code === 0 && restartLine.includes('(a, b, from the data_sets table);'), 'started again without a manifest, it serves the table\'s sets');
    check(restarted.out.includes('No walls for b (') , 'and reads the walls of the published set whose row keeps none, saying it where its dungeon.dat does not read');
}

async function main(): Promise<void> {
    const scratch = mkdtempSync(join(tmpdir(), 'csbweb-server-'));
    let server: Server | null = null;
    let db: DatabaseSync | null = null;
    try {
        const options = scratchFiles(scratch);
        checkStartUp(scratch, options);

        db = openStore(join(scratch, 'scratch-stats.db'));
        const dataSets = new DataSetStore(db);
        const store = new StatsStore(db);
        checkFiles(options, dataSets);
        const manifest = readFileSync(options.manifestFile, 'utf8');
        const api: ApiOptions = {
            checkDataSet: checkLocalDataSet,
            dataSets,
            moderatorPlayerIds: MODERATORS,
            store,
            rules: { hasSet: (id) => dataSets.hasSet(id) },
            rateLimit: new RateLimit(EVENTS_PER_WINDOW, 60_000),
            publishRateLimit: new RateLimit(EVENTS_PER_WINDOW, 60_000),
            now: Date.now,
        };
        server = createAppServer(options, api);
        await new Promise<void>((done) => server!.listen(0, '127.0.0.1', done));
        const port = (server.address() as AddressInfo).port;
        await checkAnswers(port, manifest);
        await checkEvents(port, store);
        await checkTableRead(port, db, manifest);
        await checkPublish(scratch);
        checkAddedColumns();

        await checkEntry(scratch, options);
    } finally {
        server?.close();
        db?.close();
        rmSync(scratch, { recursive: true, force: true });
    }

    console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
    process.exit(failures ? 1 : 0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
