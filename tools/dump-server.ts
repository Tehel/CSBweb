/**
 * The deployed server (`doc/DEPLOYMENT.md`, `server/`), stood up on a free port
 * over a scratch build, scratch game files and a scratch store, and asked what a browser, a
 * curious visitor, the page's beacon and the compose healthcheck would ask.
 *
 * Asserts:
 *   - the start-up check: the table the repository's manifest fills passes over its game
 *     files, and answers as that manifest; an empty table passes, and answers no set and
 *     no default, which the page reads; a missing `index.html`, a missing game files' folder and a folder the
 *     table names that is not there each stop it, saying why;
 *   - `/api/data-sets`: the table's approved sets, as a manifest the page's parser reads
 *     as the one that filled it, as JSON, not cached, read at each request; a pending set
 *     offered, as pending, to its owner and the moderators only, as the `X-Player-Id`
 *     header names them, and no owner named; `"moderator": true` said to each of two
 *     moderators, and to nobody else;
 *   - `/` and `/assets/…`: the page, `no-cache`, and the hashed files, `immutable`, the
 *     fonts as `font/ttf` and `font/woff2`; and `dist/server/`, the server's module, not
 *     served;
 *   - `/gamefiles/…`: ETag and Last-Modified, a 304 for either precondition, HEAD without
 *     a body, and the query ignored; and no descriptor left open on a large file after a
 *     download, a 304, a HEAD, or downloads the client abandons after their first bytes;
 *   - `/files/…`: a shared file, in a sub-folder too, its type by its extension in any
 *     case, `application/octet-stream` for one it does not name; a missing file and a
 *     folder 404, never a listing; POST 405; and, with no shared folder, or one that is not
 *     there, every path 404;
 *   - no path leaves the three folders, `..` and `.` raw, percent-encoded or behind a
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
 *     thumbnail that is not a PNG or not 320x200, and a base set that is not the site's; a table made
 *     before the publish's columns gains them;
 *   - `POST /api/data-sets/<id>` (`server/moderate.ts`): a moderator approves, hides and
 *     shows a set, a site's too, and rejects a pending one, its row then its folder gone,
 *     and its owner withdraws it while it is pending; and every refusal answered with
 *     nothing changed: a body that is not one action, or too large (400, 413), an id the
 *     table does not hold (404), an asker who may not (403), an action the set's state
 *     does not take, and a reject of a site's set or the default (409);
 *   - the walls a published set's row keeps, its `dungeon.dat`'s as the page reads them,
 *     and `/api/data-set-walls`, which gives a player those of the sets `api/data-sets`
 *     offers them, as the page parses them; and `fillWalls`, which reads those of the
 *     rows that keep none from their folders, says a `dungeon.dat` that does not read and
 *     reads none twice;
 *   - `server.ts` itself, as Node runs it: a bad mount, a store it cannot open, a page's
 *     check that is not built, or an entry of `MODERATOR_PLAYER_IDS` that is not a `playerId` exits 1
 *     before it listens; on a new store, it listens with no set; a list of two, spaces around the comma, makes both moderators; and SIGTERM stops a listening server with 0, its
 *     store filled by `tools/fill-data-sets.ts`, which then leaves it as it is, and its WAL
 *     checkpointed; started again, it plays from the table, and says a published set whose
 *     walls it cannot read;
 *   - `backup.ts`, run beside that server: a snapshot in `backups/` holding the events
 *     still in the WAL and the data sets, the server serving throughout, and exit 1 on a
 *     missing store; the folder of a set with an owner copied whole into
 *     `backups/gamefiles/`, the site's not, kept by the next run rather than copied
 *     again, and exit 1 on an owned set whose folder is not there.
 *
 * The scratch build's check (`CHECK_MODULE`) is a stand-in that exports the functions:
 * `tools/dump-build.ts` builds the real one and checks sets through it.
 *
 * Usage: npm test -- --only=dump-server.ts
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { deflateSync } from 'node:zlib';

import { CHECK_MODULE, checkFiles, createAppServer, fillWalls, pathSegments, type ApiOptions, type ServerOptions } from '../server/app.ts';
import { ANYONE, DataSetStore, manifestText } from '../server/dataSets.ts';
import { RateLimit } from '../server/events.ts';
import { MAX_MODERATION_BYTES } from '../server/moderate.ts';
import { MAX_PUBLISH_BYTES, MAX_PUBLISHED_FILE_BYTES } from '../server/publish.ts';
import { StatsStore } from '../server/stats.ts';
import { openStore } from '../server/store.ts';
import { DATA_SET_WALLS_ROUTE, DATA_SETS_ROUTE, LOCAL_DATA_SET_TEXT_LIMITS, parseManifest, PLAYER_ID_HEADER } from '../src/data/DataSets.ts';
import { checkLocalDataSet, localDataSet, readDungeonWalls } from '../src/data/LocalDataSets.ts';
import { parsePublishedDungeons } from '../src/data/DungeonSignature.ts';
import { indexedPng, indexedPngRows } from '../src/core/png.ts';
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

/** The scratch game files' sets, as a manifest. */
const SCRATCH_MANIFEST = JSON.stringify({ default: 'a', dataSets: [{ id: 'a', name: 'A', dir: 'set-a' }] });

/** `dataSets`, filled from `manifest` as `tools/fill-data-sets.ts` fills a store. */
function filledFrom(manifest: string, dataSets = emptyTable()): DataSetStore {
    dataSets.fill(parseManifest(manifest, ''));
    return dataSets;
}

/** What `manifest` says, as the page's parser reads it, to compare. */
function parsed(manifest: string): string {
    return JSON.stringify(parseManifest(manifest, ''));
}

/** The error `checkFiles` throws, or `''`. */
function refusal(options: ServerOptions, dataSets: DataSetStore): string {
    try {
        checkFiles(options, dataSets);
        return '';
    } catch (error) {
        return error instanceof Error ? error.message : String(error);
    }
}

/** Larger than what the sockets buffer, so a download the client abandons is cut short. */
const LARGE_FILE_BYTES = 16 << 20;

/** The descriptors this process, the server, holds open on `path` (Linux's `/proc`). */
function descriptorsOn(path: string): number {
    let count = 0;
    for (const fd of readdirSync('/proc/self/fd')) {
        try {
            if (readlinkSync(`/proc/self/fd/${fd}`) === path) count++;
        } catch {
            // The descriptor `readdirSync` read the folder through, closed since.
        }
    }
    return count;
}

/** What `descriptorsOn` says once the server has let go, or after a second. */
async function descriptorsSettledOn(path: string): Promise<number> {
    for (let wait = 0; wait < 20 && descriptorsOn(path) > 0; wait++) await new Promise((done) => setTimeout(done, 50));
    return descriptorsOn(path);
}

/** `path` asked for, and the connection closed at the first bytes of the answer. */
function abandon(port: number, path: string): Promise<void> {
    return new Promise((done, fail) => {
        const req = request({ host: '127.0.0.1', port, path }, (res) => {
            res.once('data', () => {
                req.destroy();
                done();
            });
        });
        req.on('error', (error) => (req.destroyed ? done() : fail(error)));
        req.end();
    });
}

function scratchFiles(scratch: string): ServerOptions {
    const distDir = join(scratch, 'dist');
    const gamefilesDir = join(scratch, 'gamefiles');
    const filesDir = join(scratch, 'files');
    mkdirSync(join(distDir, 'assets'), { recursive: true });
    mkdirSync(join(gamefilesDir, 'set-a'), { recursive: true });
    mkdirSync(join(filesDir, 'sub'), { recursive: true });
    writeFileSync(join(distDir, 'index.html'), '<!doctype html><title>page</title>');
    writeFileSync(join(distDir, 'assets', 'index-AbC123.js'), 'console.log(1);');
    writeFileSync(join(distDir, 'manifest.webmanifest'), '{}');
    writeFileSync(join(distDir, 'assets', 'font-AbC123.ttf'), Buffer.from([0, 1, 0, 0]));
    writeFileSync(join(distDir, 'assets', 'font-AbC123.woff2'), Buffer.from([0x77, 0x4f, 0x46, 0x32]));
    mkdirSync(join(distDir, 'server'));
    writeFileSync(join(distDir, CHECK_MODULE), 'export function checkLocalDataSet() {}\n'
        + 'export async function readDungeonWalls() { throw new Error("a stand-in"); }\n');
    writeFileSync(join(gamefilesDir, 'set-a', 'dungeon.dat'), Buffer.from([1, 2, 3, 4]));
    writeFileSync(join(gamefilesDir, 'set-a', 'large.dat'), Buffer.alloc(LARGE_FILE_BYTES));
    writeFileSync(join(gamefilesDir, 'set-a', '.hidden'), 'hidden');
    writeFileSync(join(filesDir, 'notes.txt'), 'NOTES');
    writeFileSync(join(filesDir, 'Manual.PDF'), '%PDF-1.4');
    writeFileSync(join(filesDir, 'disk.st'), Buffer.from([0, 1, 2]));
    writeFileSync(join(filesDir, 'sub', 'saves.zip'), Buffer.from([0x50, 0x4b, 3, 4]));
    writeFileSync(join(filesDir, '.hidden'), 'hidden');
    writeFileSync(join(scratch, 'secret.txt'), 'SECRET');
    return { distDir, gamefilesDir, filesDir };
}

function checkStartUp(scratch: string, options: ServerOptions): void {
    console.log('Start-up check:');
    const repository = filledFrom(readFileSync(MANIFEST_FILE, 'utf8'));
    const real = checkFiles({ distDir: options.distDir, gamefilesDir: GAMEFILES_DIR }, repository);
    console.log(`  ${MANIFEST_FILE}: ${real.join(', ')}`);
    check(real.length > 0, `the table ${MANIFEST_FILE} fills passes over ${GAMEFILES_DIR}`);
    check(parsed(manifestText(repository.read(), ANYONE)) === parsed(readFileSync(MANIFEST_FILE, 'utf8')),
        'the table answers as the manifest that filled it, every set, flag and folder');
    const filled = filledFrom(SCRATCH_MANIFEST);
    check(refusal(options, filled) === '', 'the scratch files pass');

    const empty = emptyTable();
    const answer = manifestText(empty.read(), ANYONE);
    console.log(`  empty table    : ${JSON.stringify(checkFiles(options, empty))}, answering ${answer}`);
    check(checkFiles(options, empty).length === 0 && answer === '{"default":null,"dataSets":[]}',
        'an empty table passes, and answers no set and no default');
    const none = parseManifest(answer, '');
    check(none.dataSets.length === 0 && none.defaultSet === null, 'which the page reads as no set, and no default');

    const noPage = refusal({ ...options, distDir: join(scratch, 'nowhere') }, filled);
    console.log(`  no page        : ${noPage.split(scratch).join('<scratch>')}`);
    check(noPage.includes('no index.html'), 'a build without index.html is refused');
    const noGamefiles = refusal({ ...options, gamefilesDir: join(scratch, 'nowhere') }, emptyTable());
    console.log(`  no game files  : ${noGamefiles.split(scratch).join('<scratch>')}`);
    check(noGamefiles.includes('is not a folder'), 'a game files\' folder that is not there is refused, even with an empty table');

    const bad = join(scratch, 'bad');
    mkdirSync(bad);
    const tableMissing = refusal({ ...options, gamefilesDir: bad }, filled);
    console.log(`  table's folders: ${tableMissing.split(scratch).join('<scratch>')}`);
    check(tableMissing.startsWith('the data_sets table names folders') && tableMissing.endsWith('does not hold: set-a'),
        'every folder the table names and the folder lacks is named');
}

async function checkAnswers(port: number, manifest: string, gamefilesDir: string): Promise<void> {
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
    const webManifest = await ask(port, '/manifest.webmanifest');
    check(webManifest.status === 200 && webManifest.headers['content-type'] === 'application/manifest+json' && webManifest.headers['cache-control'] === 'no-cache',
        `the web app manifest, as application/manifest+json, no-cache (${webManifest.headers['content-type']}, ${webManifest.headers['cache-control']})`);
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

    const large = '/gamefiles/set-a/large.dat';
    const largePath = join(gamefilesDir, 'set-a', 'large.dat');
    const whole = await ask(port, large);
    check(whole.status === 200 && whole.body.length === LARGE_FILE_BYTES, `a large file is served whole (${whole.body.length} bytes)`);
    await ask(port, large, 'GET', { 'If-None-Match': String(whole.headers.etag) });
    await ask(port, large, 'HEAD');
    check(await descriptorsSettledOn(largePath) === 0, 'and once it is, or answered 304 or to a HEAD, no descriptor is left open on it');
    const ABANDONED = 20;
    for (let i = 0; i < ABANDONED; i++) await abandon(port, large);
    const left = await descriptorsSettledOn(largePath);
    check(left === 0, `${ABANDONED} downloads of it abandoned at their first bytes leave no descriptor open on it (${left})`);

    console.log('\nThe shared files:');
    for (const [path, type, body] of [
        ['/files/notes.txt', 'text/plain; charset=utf-8', 'NOTES'],
        ['/files/Manual.PDF', 'application/pdf', '%PDF-1.4'],
        ['/files/sub/saves.zip', 'application/zip', 'PK\x03\x04'],
        ['/files/disk.st', 'application/octet-stream', '\x00\x01\x02'],
    ]) {
        const shared = await ask(port, path!);
        check(shared.status === 200 && shared.body === body && shared.headers['content-type'] === type,
            `${path}: ${shared.status}, as ${shared.headers['content-type']}`);
    }
    const sharedFile = await ask(port, '/files/notes.txt');
    check(sharedFile.headers['cache-control'] === 'no-cache' && (await ask(port, '/files/notes.txt', 'GET', { 'If-None-Match': String(sharedFile.headers.etag) })).status === 304,
        'no-cache, and a 304 for its ETag');
    for (const path of ['/files/nothing.txt', '/files', '/files/', '/files/sub', '/files/sub/']) {
        check((await ask(port, path)).status === 404, `${path}: 404, not a listing`);
    }
    check((await ask(port, '/files/notes.txt', 'POST')).status === 405, 'POST: 405');

    console.log('\nPaths that would leave the folders:');
    for (const path of [
        '/files/../secret.txt', '/files/%2e%2e/secret.txt', '/files/sub/..%2f..%2fsecret.txt', '/files/.hidden',
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
 * Rows added to the table while the server runs, as a publish and an approval add them:
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
 * and `csb` the site's base sets, `conflux` a set whose folder is not its id, and `stray`
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
    mkdirSync(join(gamefilesDir, 'stray'));
    const options: ServerOptions = { distDir, gamefilesDir };
    const db = new DatabaseSync(':memory:');
    const dataSets = filledFrom(JSON.stringify({
        default: 'dm-atari',
        dataSets: [{ id: 'dm-atari', name: 'DM' }, { id: 'csb', name: 'CSB' }, { id: 'conflux', name: 'Conflux', dir: 'conflux-dir' }],
    }), new DataSetStore(db));
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
            id, name: '  My DM ', description: 'Mine. ', authors: ['A Player', ' ', 'Another '], dmRules: 'true', thumbnailAsTitle: 'false', baseSet: 'dm-atari', ...extra,
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
        const record = (await checkLocalDataSet({ id: 'my-dm', name: '  My DM ', description: 'Mine. ', authors: ['A Player', ' ', 'Another '], dmRules: true, thumbnailAsTitle: false, baseSet: 'dm-atari', files: dmFiles() },
            new Set(), (set) => (set === 'dm-atari' ? dmFolder : null), 0)).record!;
        const flags = localDataSet(record);
        const stored = dataSets.read().dataSets.find((set) => set.id === 'my-dm')!;
        check(row.status === 'pending' && row.owner === PLAYER && row.dir === 'my-dm' && row.position === 3, 'its row is pending, owned by its sender, its folder its id, last in the list');
        check(row.name === record.name && row.description === record.description && row.authors === JSON.stringify(record.authors) && record.authors.join() === 'A Player,Another',
            'its name, description and authors are the page\'s record\'s, trimmed, the empty author dropped');
        const offered = parseManifest((await ask(port, '/api/data-sets', 'GET', { [PLAYER_ID_HEADER]: PLAYER })).body, '').dataSets;
        const mine = offered.find((set) => set.id === 'my-dm')!;
        console.log(`  api/data-sets says: ${JSON.stringify(mine.description)} by ${mine.authors.join(' and ')}`);
        check(mine.description === record.description && mine.authors.join() === record.authors.join()
            && offered.filter((set) => set.id !== 'my-dm').every((set) => set.description === '' && set.authors.length === 0),
            'api/data-sets gives its description and authors, and empty ones to the sets without');
        check((['csbGraphics', 'miniDat', 'hintOracle', 'dmRules', 'thumbnailAsTitle', 'hidden'] as const).every((flag) => stored[flag] === flags[flag]), 'its flags are those localDataSet gives the record');
        check(await seen(PLAYER) === 'dm-atari,csb,conflux,my-dm pending' && await seen(MODERATORS[0]) === 'dm-atari,csb,conflux,my-dm pending',
            'it is offered, pending, to its owner and the moderators');
        check(await seen(null) === 'dm-atari,csb,conflux' && await seen(OTHER) === 'dm-atari,csb,conflux', 'and to nobody else');
        check(before !== written(gamefilesDir, dataSets), 'the snapshot of the folder and the table sees a publish');

        const csbFiles = Object.fromEntries(['dungeon.dat', 'graphics.dat', 'hcsb.hct', 'hcsb.dat'].map((name) => [name, fileOf(new Uint8Array(readFileSync(`${csb.dir}/${name}`)), name)]));
        const own = await publish(fields('my-csb', { name: 'My CSB', dmRules: 'false', thumbnailAsTitle: 'true' }), csbFiles, OTHER);
        const ownSet = dataSets.read().dataSets.find((set) => set.id === 'my-csb');
        console.log(`  with its own graphics: ${own.status} ${own.body}, ${readdirSync(join(gamefilesDir, 'my-csb')).sort().join(', ')}`);
        check(own.status === 201 && readdirSync(join(gamefilesDir, 'my-csb')).sort().join() === 'dungeon.dat,graphics.dat,hcsb.dat,hcsb.hct'
            && readFileSync(join(gamefilesDir, 'my-csb', 'graphics.dat')).equals(readFileSync(`${csb.dir}/graphics.dat`)),
            'a set with its own graphics.dat keeps it, and has no thumbnail where it was given none');
        check(ownSet?.hintOracle === true && !ownSet.csbGraphics && !ownSet.dmRules && !ownSet.thumbnailAsTitle && ownSet.owner === OTHER,
            'its flags follow from its files: the Hint Oracle, no DM rules, and no thumbnail as the title without a thumbnail');

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
        dataSets.publish({ id: 'approved', name: 'Approved', description: '', authors: [], csbGraphics: false, hintOracle: false, dmRules: false, thumbnailAsTitle: false,
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
        await refused('a folder no row names', 409, () => publish(fields('stray'), dmFiles()), 'a folder of this name');
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
        await refused('thumbnailAsTitle neither true nor false', 400, () => publish(fields('p1', { thumbnailAsTitle: 'on' }), dmFiles()), "'thumbnailAsTitle'");
        await refused('a name too long', 400, () => publish(fields('p1', { name: 'x'.repeat(LOCAL_DATA_SET_TEXT_LIMITS.name + 1) }), dmFiles()), 'name is longer');
        await refused('authors too long', 400, () => publish(fields('p1', { authors: ['x'.repeat(100), 'y'.repeat(LOCAL_DATA_SET_TEXT_LIMITS.authors - 100)] }), dmFiles()), 'authors are longer');
        await refused('a file too large', 413, () => publish(fields('p1'), { ...dmFiles(), 'CSBgraphics.dat': fileOf(new Uint8Array(MAX_PUBLISHED_FILE_BYTES + 1), 'CSBgraphics.dat') }), 'CSBgraphics.dat is larger');
        await refused('a request too large', 413, () => ask(port, '/api/data-sets', 'POST',
            { [PLAYER_ID_HEADER]: PLAYER, 'Content-Type': 'multipart/form-data; boundary=x', 'X-Real-IP': '10.3.1.3' }, Buffer.alloc(MAX_PUBLISH_BYTES + 1)), 'request is larger');
        await refused('a dungeon.dat of zeros', 422, () => publish(fields('p1'), { ...dmFiles(), 'dungeon.dat': fileOf(new Uint8Array(64), 'dungeon.dat') }), '"about":"dungeon.dat"');
        await refused('no dungeon.dat', 422, () => publish(fields('p1'), { thumbnail: dmFiles().thumbnail }), '"about":"dungeon.dat"');
        await refused('a thumbnail that is not a PNG', 422, () => publish(fields('p1'), { ...dmFiles(), thumbnail: fileOf(new Uint8Array(64), 'thumbnail.png', 'image/png') }), '"about":"thumbnail","text":"It is not a PNG."');
        const large = indexedPng(640, 400, [[0, 0, 0]], deflateSync(indexedPngRows(640, 400, new Uint8Array(640 * 400))));
        await refused('a thumbnail of 640x400', 422, () => publish(fields('p1'), { ...dmFiles(), thumbnail: fileOf(large, 'thumbnail.png', 'image/png') }),
            '"about":"thumbnail","text":"It is 640x400, not 320x200."');
        await refused('a base set that is a player\'s', 422, () => publish(fields('p1', { baseSet: 'my-dm' }), { 'dungeon.dat': dmFiles()['dungeon.dat'] }), '"about":"baseSet"');
        await refused('an empty name', 422, () => publish(fields('p1', { name: ' ' }), dmFiles()), '"about":"name"');

        const statuses: number[] = [];
        for (let i = 0; i <= PUBLISHES_PER_WINDOW; i++) statuses.push((await publish(fields('p1', { dmRules: 'on' }), dmFiles(), PLAYER, '10.3.2.1')).status);
        console.log(`  ${PUBLISHES_PER_WINDOW + 1} publishes from one address: ${statuses.join(' ')}`);
        check(statuses.slice(0, -1).every((status) => status === 400) && statuses.at(-1) === 429, `the rate limit counts refused publishes too: ${PUBLISHES_PER_WINDOW} an address, then 429`);
        await refused('the rate limit', 429, () => publish(fields('p2'), dmFiles(), PLAYER, '10.3.2.1'), 'Too many publishes');
        check((await publish(fields('p2', { thumbnailAsTitle: 'true' }), dmFiles(), PLAYER, '10.3.2.2')).status === 201, 'another address is still heard');
        const titled = parseManifest((await ask(port, '/api/data-sets', 'GET', { [PLAYER_ID_HEADER]: PLAYER })).body, '').dataSets;
        check(titled.find((set) => set.id === 'p2')?.thumbnailAsTitle === true && titled.filter((set) => set.id !== 'p2').every((set) => !set.thumbnailAsTitle),
            'a set published with its thumbnail as the title says so in api/data-sets, and the others do not');
    } finally {
        server.close();
        db.close();
    }
}

/**
 * `POST /api/data-sets/<id>` (`server/moderate.ts`), on a server of its own over a scratch
 * table: the site's `dm-atari` (the default), a pending `site-pending` and a hidden
 * `site-hidden`, and the players' sets, each with a folder of one file.
 */
async function checkModeration(scratch: string): Promise<void> {
    console.log('\nModerating the sets:');
    const root = join(scratch, 'moderate');
    const distDir = join(root, 'dist');
    const gamefilesDir = join(root, 'gamefiles');
    mkdirSync(distDir, { recursive: true });
    writeFileSync(join(distDir, 'index.html'), '<!doctype html><title>page</title>');
    for (const dir of ['dm-atari', 'site-pending', 'site-hidden']) mkdirSync(join(gamefilesDir, dir), { recursive: true });
    const db = new DatabaseSync(':memory:');
    const dataSets = filledFrom(JSON.stringify({
        default: 'dm-atari',
        dataSets: [{ id: 'dm-atari', name: 'DM' }, { id: 'site-pending', name: 'P', status: 'pending' }, { id: 'site-hidden', name: 'H', hidden: true }],
    }), new DataSetStore(db));
    const options: ServerOptions = { distDir, gamefilesDir };
    checkFiles(options, dataSets);
    const players: [string, string][] = [['p1', PLAYER], ['p2', PLAYER], ['p3', OTHER], ['p4', PLAYER], ['p5', PLAYER]];
    for (const [id, owner] of players) {
        dataSets.publish({ id, name: id.toUpperCase(), description: '', authors: [], csbGraphics: false, hintOracle: false, dmRules: false, thumbnailAsTitle: false,
            walls: { shapes: [[1, 1]], signature: ['0'.repeat(64)] } }, owner);
        mkdirSync(join(gamefilesDir, id));
        writeFileSync(join(gamefilesDir, id, 'dungeon.dat'), Buffer.from([1, 2, 3, 4]));
    }
    const server = createAppServer(options, {
        checkDataSet: checkLocalDataSet, dataSets, moderatorPlayerIds: MODERATORS, store: new StatsStore(db),
        rules: { hasSet: (id) => dataSets.hasSet(id) }, rateLimit: new RateLimit(EVENTS_PER_WINDOW, 60_000),
        publishRateLimit: new RateLimit(PUBLISHES_PER_WINDOW, 60_000), now: Date.now,
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const port = (server.address() as AddressInfo).port;
    check((await ask(port, '/files/dm-atari')).status === 404, 'a server with no shared files\' folder answers 404 under files/');

    try {
        /** `body` posted about `id` as `player`, the page's `fetch` would send it. */
        const moderate = (id: string, body: string, player: string | null) =>
            ask(port, `/${DATA_SETS_ROUTE}/${encodeURIComponent(id)}`, 'POST', { 'Content-Type': 'application/json', ...(player === null ? {} : { [PLAYER_ID_HEADER]: player }) }, body);
        const action = (name: string) => JSON.stringify({ action: name });
        /** Each row's state, and the folders: compared before and after a refusal. */
        const states = () => `${dataSets.read().dataSets.map((set) => `${set.id}:${set.pending ? 'pending' : set.hidden ? 'hidden' : 'approved'}`).join()} | ${readdirSync(gamefilesDir).sort().join()}`;
        const seen = async (player: string | null) => parseManifest((await ask(port, '/api/data-sets', 'GET', player === null ? {} : { [PLAYER_ID_HEADER]: player })).body, '')
            .dataSets.map((set) => `${set.id}${set.pending ? ' pending' : ''}${set.hidden ? ' hidden' : ''}`).join();
        console.log(`  the table: ${states()}`);

        const done = async (label: string, id: string, name: string, player: string, after: () => boolean) => {
            const answer = await moderate(id, action(name), player);
            console.log(`    ${label}: ${answer.status} ${answer.body}, ${states()}`);
            check(answer.status === 200 && answer.body === JSON.stringify({ id }) && String(answer.headers['content-type']).startsWith('application/json')
                && answer.headers['cache-control'] === 'no-store' && after(), `${label}: 200, done`);
        };
        const refused = async (label: string, status: number, send: () => Promise<Answer>, says: string) => {
            const was = states();
            const answer = await send();
            console.log(`    ${label}: ${answer.status} ${answer.body}`);
            check(answer.status === status && answer.body.includes(says) && String(answer.headers['content-type']).startsWith('application/json')
                && !answer.body.includes(PLAYER) && !answer.body.includes(OTHER) && states() === was, `${label}: ${status}, nothing changed`);
        };
        const row = (id: string) => dataSets.read().dataSets.find((set) => set.id === id);
        const [moderator1, moderator2] = MODERATORS;

        console.log('  refusals:');
        await refused('not JSON', 400, () => moderate('p1', 'approve', moderator1), 'The body is not');
        await refused('an unknown action', 400, () => moderate('p1', action('delete'), moderator1), 'The body is not');
        await refused('a key beside the action', 400, () => moderate('p1', JSON.stringify({ action: 'approve', id: 'p2' }), moderator1), 'The body is not');
        await refused('a list', 400, () => moderate('p1', '["approve"]', moderator1), 'The body is not');
        await refused('a body too large', 413, () => moderate('p1', ' '.repeat(MAX_MODERATION_BYTES + 1), moderator1), 'larger than');
        await refused('an id the table does not hold', 404, () => moderate('nope', action('approve'), moderator1), 'no set of this id');
        const below = await ask(port, `/${DATA_SETS_ROUTE}/p1/approve`, 'POST', { [PLAYER_ID_HEADER]: moderator1 }, action('approve'));
        check(below.status === 404 && row('p1')?.pending === true, 'a path below a set is 404, nothing changed');
        await refused('no player', 403, () => moderate('p1', action('approve'), null), 'Only a moderator');
        await refused('a player that is not a playerId', 403, () => moderate('p1', action('approve'), 'me'), 'Only a moderator');
        await refused('the owner approving their own set', 403, () => moderate('p1', action('approve'), PLAYER), 'Only a moderator');
        await refused('the owner hiding it', 403, () => moderate('p1', action('hide'), PLAYER), 'Only a moderator');
        await refused('another player rejecting it', 403, () => moderate('p1', action('reject'), OTHER), 'Only a moderator');
        const get = await ask(port, `/${DATA_SETS_ROUTE}/p1`, 'GET', { [PLAYER_ID_HEADER]: moderator1 });
        check(get.status === 405 && get.headers.allow === 'POST', 'a GET of a set is 405, POST only');

        console.log('  the transitions:');
        await done('a moderator approves a pending set', 'p1', 'approve', moderator1, () => row('p1')?.pending === false && row('p1')?.hidden === false);
        check(await seen(null) === 'dm-atari,site-hidden hidden,p1', 'it is offered to everyone');
        await refused('approve it again', 409, () => moderate('p1', action('approve'), moderator1), 'The set is approved: only a pending set is approved');
        await refused('reject it, approved', 409, () => moderate('p1', action('reject'), moderator1), 'only a pending set is rejected');
        await refused('show it, not hidden', 409, () => moderate('p1', action('show'), moderator1), 'only a hidden set is shown');
        await refused('hide a pending set', 409, () => moderate('p2', action('hide'), moderator1), 'The set is pending: only an approved set is hidden');
        await done('the other moderator hides it', 'p1', 'hide', moderator2, () => row('p1')?.hidden === true && row('p1')?.pending === false);
        check(await seen(null) === 'dm-atari,site-hidden hidden,p1 hidden', 'it is offered hidden, the page\'s grid leaving it out but for a moderator');
        await refused('hide it again', 409, () => moderate('p1', action('hide'), moderator1), 'The set is hidden');
        await refused('approve it, hidden', 409, () => moderate('p1', action('approve'), moderator1), 'The set is hidden');
        await done('a moderator shows it', 'p1', 'show', moderator1, () => row('p1')?.hidden === false);
        await done('a site\'s set is hidden too', 'dm-atari', 'hide', moderator1, () => row('dm-atari')?.hidden === true);
        await done('and shown', 'site-hidden', 'show', moderator1, () => row('site-hidden')?.hidden === false);
        await done('a moderator approves a site\'s pending set', 'site-pending', 'approve', moderator1, () => row('site-pending')?.pending === false);
        await done('a moderator rejects a pending set', 'p2', 'reject', moderator1,
            () => row('p2') === undefined && !existsSync(join(gamefilesDir, 'p2')) && existsSync(join(gamefilesDir, 'p1', 'dungeon.dat')));
        await refused('and it is gone', 404, () => moderate('p2', action('reject'), moderator1), 'no set of this id');
        check(!(await seen(moderator1)).includes('p2') && !(await seen(PLAYER)).includes('p2'), 'it is offered to nobody, its owner included');
        await done('the owner withdraws their own pending set', 'p3', 'reject', OTHER, () => row('p3') === undefined && !existsSync(join(gamefilesDir, 'p3')));
        await done('a moderator approves another', 'p4', 'approve', moderator1, () => row('p4')?.pending === false);
        await refused('whose owner may not withdraw it, approved', 403, () => moderate('p4', action('reject'), PLAYER), 'Only a moderator');
        db.prepare("UPDATE data_sets SET status = 'pending' WHERE id = 'site-pending'").run();
        await refused('a moderator rejecting a site\'s pending set', 409, () => moderate('site-pending', action('reject'), moderator1), 'by hand');
        db.prepare("UPDATE data_set_defaults SET default_set = 'p5'").run();
        await refused('or the default set, made a pending player\'s by hand', 409, () => moderate('p5', action('reject'), moderator1), 'by hand');
        console.log(`  the table: ${states()}`);
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
    db.exec("UPDATE data_set_defaults SET swoosh = 'swoosh'");
    const dataSets = new DataSetStore(db);
    const columns = (db.prepare('PRAGMA table_info(data_sets)').all() as { name: string }[]).map((column) => column.name);
    const defaults = (db.prepare('PRAGMA table_info(data_set_defaults)').all() as { name: string }[]).map((column) => column.name);
    const row = db.prepare('SELECT description, authors, walls, thumbnail_as_title FROM data_sets').get() as { description: string; authors: string; walls: string | null; thumbnail_as_title: number };
    dataSets.publish({ id: 'b', name: 'B', description: '', authors: [], csbGraphics: false, hintOracle: false, dmRules: false, thumbnailAsTitle: false, walls: { shapes: [[1, 1]], signature: ['0'.repeat(64)] } }, PLAYER);
    console.log(`  an older table's columns: ${columns.join(', ')}`);
    check(columns.includes('description') && columns.includes('authors') && columns.includes('walls') && row.description === '' && row.authors === '[]' && row.walls === null
        && columns.includes('thumbnail_as_title') && row.thumbnail_as_title === 0 && !dataSets.read().dataSets[0].thumbnailAsTitle
        && dataSets.read().dataSets.map((set) => set.id).join() === 'a,b' && dataSets.walls().get('b')?.shapes.join() === '1,1',
        'a table made before them gains the description, authors, walls and thumbnail_as_title, its rows kept, none shown as the title');
    console.log(`  an older defaults' columns: ${defaults.join(', ')}`);
    check(defaults.join() === 'only,default_set' && dataSets.read().defaultId === 'a', 'and the defaults lose the FTL logo\'s folder, their row kept');
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
    const badMount = await finish(startEntry({ PORT: '0', DIST_DIR: options.distDir, GAMEFILES_DIR: join(scratch, 'nowhere'), STATS_DB: statsDb }));
    console.log(`  bad mount: exit ${badMount.code}, ${firstLine(badMount.out).split(scratch).join('<scratch>')}`);
    check(badMount.code === 1 && badMount.out.includes('Not starting:'), 'a bad mount exits 1 before it listens');
    const badStore = await finish(startEntry({ PORT: '0', DIST_DIR: options.distDir, GAMEFILES_DIR: options.gamefilesDir, STATS_DB: options.distDir }));
    console.log(`  bad store: exit ${badStore.code}, ${firstLine(badStore.out).replace(scratch, '<scratch>')}`);
    check(badStore.code === 1 && badStore.out.includes('Not starting:'), 'a store it cannot open exits 1 before it listens');
    const noCheck = join(scratch, 'dist-without-check');
    mkdirSync(noCheck);
    writeFileSync(join(noCheck, 'index.html'), '<!doctype html><title>page</title>');
    const unbuilt = await finish(startEntry({ PORT: '0', DIST_DIR: noCheck, GAMEFILES_DIR: options.gamefilesDir, STATS_DB: join(scratch, 'unbuilt', 'stats.db') }));
    console.log(`  no check built: exit ${unbuilt.code}, ${firstLine(unbuilt.out).split(scratch).join('<scratch>').replace(/ \(.*\)/, ' (…)')}`);
    check(unbuilt.code === 1 && unbuilt.out.includes(`${CHECK_MODULE} does not load`), 'a page\'s check that is not built exits 1 before it listens');
    const badModerator = await finish(startEntry({ PORT: '0', DIST_DIR: options.distDir, GAMEFILES_DIR: options.gamefilesDir, STATS_DB: join(scratch, 'moderator', 'stats.db'), MODERATOR_PLAYER_IDS: `${MODERATORS[0]},the-moderator` }));
    console.log(`  bad moderator: exit ${badModerator.code}, ${firstLine(badModerator.out)}`);
    check(badModerator.code === 1 && badModerator.out.includes('MODERATOR_PLAYER_IDS holds an entry that is not a playerId') && !existsSync(join(scratch, 'moderator')),
        'a MODERATOR_PLAYER_IDS entry that is not a playerId exits 1 before it opens the store');

    // A new store: the server listens with no set, and answers none.
    let emptyLine = '';
    let emptyAnswer = '';
    let noFiles = 0;
    const fresh = startEntry({ PORT: '0', DIST_DIR: options.distDir, GAMEFILES_DIR: options.gamefilesDir, STATS_DB: join(scratch, 'fresh', 'stats.db'), FILES_DIR: join(scratch, 'nowhere') });
    const freshEnded = await finish(fresh, (line) => {
        const listening = /^Listening on port (\d+)/.exec(line);
        if (!listening) return;
        emptyLine = line.split(scratch).join('<scratch>').replace(/port \d+/, 'port <n>');
        const port = Number(listening[1]);
        ask(port, '/api/data-sets').then((answer) => (emptyAnswer = answer.body))
            .then(() => ask(port, '/files/notes.txt')).then((answer) => (noFiles = answer.status))
            .finally(() => fresh.kill('SIGTERM'));
    });
    console.log(`  new store: ${emptyLine}, answering ${emptyAnswer}`);
    check(freshEnded.code === 0 && emptyLine.includes('(no set, from the data_sets table);') && emptyAnswer === '{"default":null,"dataSets":[]}',
        'on a new store, it listens with no set, and answers none');
    check(noFiles === 404, `a shared files' folder that is not there does not stop it, and serves nothing (${noFiles})`);

    // The store filled as `npm start`'s is, by tools/fill-data-sets.ts, which fills only an empty table.
    const manifestFile = join(scratch, 'manifest.json');
    writeFileSync(manifestFile, SCRATCH_MANIFEST);
    const fill = () => finish(spawn(process.execPath, ['--import', 'tsx', join(ROOT, 'tools', 'fill-data-sets.ts'), statsDb, manifestFile], {
        cwd: ROOT, env: process.env, stdio: ['ignore', 'pipe', 'pipe'],
    }));
    const filled = await fill();
    console.log(`  fill-data-sets: exit ${filled.code}, ${firstLine(filled.out).split(scratch).join('<scratch>')}`);
    check(filled.code === 0 && firstLine(filled.out).endsWith(': a, from <scratch>/manifest.json'.replace('<scratch>', scratch)), 'tools/fill-data-sets.ts fills the store\'s empty table');
    const refill = await fill();
    console.log(`  again: exit ${refill.code}, ${firstLine(refill.out)}`);
    check(refill.code === 1 && refill.out.includes('the data_sets table is not empty'), 'and refuses one that is not, leaving it as it is');

    let healthy = false;
    let walHeld = false;
    let backedUp: Backup | null = null;
    let again: { code: number | null; out: string } | null = null;
    let noFolder: { code: number | null; out: string } | null = null;
    let moderated = '';
    const child = startEntry({ PORT: '0', DIST_DIR: options.distDir, GAMEFILES_DIR: options.gamefilesDir, STATS_DB: statsDb,
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
    check(out.includes('(a, from the data_sets table);'), 'it serves the sets of the table the tool filled');

    let restartLine = '';
    const restart = startEntry({ PORT: '0', DIST_DIR: options.distDir, GAMEFILES_DIR: options.gamefilesDir, STATS_DB: statsDb });
    const restarted = await finish(restart, (line) => {
        if (!line.startsWith('Listening on port')) return;
        restartLine = line.split(scratch).join('<scratch>').replace(/port \d+/, 'port <n>');
        restart.kill('SIGTERM');
    });
    console.log(`  restarted: ${restartLine}`);
    check(restarted.code === 0 && restartLine.includes('(a, b, from the data_sets table);'), 'started again, it serves the table\'s sets, the published one too');
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
        const dataSets = filledFrom(SCRATCH_MANIFEST, new DataSetStore(db));
        const store = new StatsStore(db);
        checkFiles(options, dataSets);
        const manifest = SCRATCH_MANIFEST;
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
        await checkAnswers(port, manifest, options.gamefilesDir);
        await checkEvents(port, store);
        await checkTableRead(port, db, manifest);
        await checkPublish(scratch);
        await checkModeration(scratch);
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
