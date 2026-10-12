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
 *     as the one that filled it, as JSON, not cached, read at each request; and the
 *     manifest not served as a file under `gamefiles/`;
 *   - `/` and `/assets/…`: the page, `no-cache`, and the hashed files, `immutable`, the
 *     fonts as `font/ttf` and `font/woff2`;
 *   - `/gamefiles/…`: ETag and Last-Modified, a 304 for either precondition, HEAD without
 *     a body, and the query ignored;
 *   - no path leaves the two folders, `..` and `.` raw, percent-encoded or behind a
 *     backslash, and no dot-file is served;
 *   - `/api/health`, and a 405 for a method that is not GET or HEAD;
 *   - `/api/event`: POST only, an event stored (what is stored, `dump-stats` asserts), a bad
 *     one 400, a set added to the table while it runs known at once, a body over 4 KB 413 whether it says so or not, and the rate limit per
 *     forwarded address, 429; `/api/stats`: the store's aggregates, not cached;
 *   - `server.ts` itself, as Node runs it: a bad mount or a store it cannot open exits 1
 *     before it listens, and SIGTERM stops a listening server with 0, the store made, its
 *     table filled, and its WAL checkpointed; started again without a manifest, it plays
 *     from the table;
 *   - `backup.ts`, run beside that server: a snapshot in `backups/` holding the events
 *     still in the WAL and the data sets, the server serving throughout, and exit 1 on a
 *     missing store.
 *
 * Usage: npx tsx tools/dump-server.ts
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { checkFiles, createAppServer, pathSegments, type ApiOptions, type ServerOptions } from '../server/app.ts';
import { DataSetStore, manifestText } from '../server/dataSets.ts';
import { RateLimit } from '../server/events.ts';
import { StatsStore } from '../server/stats.ts';
import { openStore } from '../server/store.ts';
import { parseManifest } from '../src/data/DataSets.ts';
import { GAMEFILES_DIR, MANIFEST_FILE } from './lib/dataSets.ts';

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
function ask(port: number, path: string, method = 'GET', headers: Record<string, string> = {}, body?: string): Promise<Answer> {
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
    check(parsed(manifestText(repository.read())) === parsed(readFileSync(MANIFEST_FILE, 'utf8')),
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
    const before = manifestText(filled.read());
    const fromTable = checkFiles({ ...options, manifestFile: join(scratch, 'nowhere.json') }, filled);
    check(!fromTable.filled && fromTable.ids.join() === 'a', 'a table that is not empty is read, and the manifest is not: none is needed');
    const changed = join(scratch, 'changed.json');
    writeFileSync(changed, JSON.stringify({ default: 'z', dataSets: [{ id: 'z', name: 'Z', dir: 'set-a' }] }));
    check(refusal({ ...options, manifestFile: changed }, filled) === '' && manifestText(filled.read()) === before,
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
    check((await ask(port, '/api/data-sets', 'POST')).status === 405, 'POST on /api/data-sets: 405');
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
    const pending = await ask(port, '/api/data-sets');
    check(parsed(pending.body) === parsed(manifest), 'a pending set is left out of the answer');
    check((await post('p')).status === 204, 'and its events are taken');
    insert.run('b', 'B', 'set-a', 2, 'approved', null, 1);
    const approved = parseManifest((await ask(port, '/api/data-sets')).body, '');
    const added = approved.dataSets.at(-1);
    console.log(`  added: ${JSON.stringify(added)}`);
    check(approved.dataSets.map((set) => set.id).join() === 'a,b' && added?.dir === 'set-a' && added.dmRules && !added.hidden,
        'an approved set is answered at the next request, in its place, with its folder and flags');
    check((await post('b')).status === 204, 'and its events are taken at once');
}

const PLAYER = '00000000-0000-4000-8000-000000000000';
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

async function checkEntry(scratch: string, options: ServerOptions): Promise<void> {
    console.log('\nserver.ts:');
    const statsDb = join(scratch, 'stats', 'stats.db');
    const badMount = await finish(startEntry({ PORT: '0', DIST_DIR: options.distDir, GAMEFILES_DIR: join(scratch, 'nowhere'), MANIFEST_FILE: options.manifestFile, STATS_DB: statsDb }));
    console.log(`  bad mount: exit ${badMount.code}, ${firstLine(badMount.out).split(scratch).join('<scratch>')}`);
    check(badMount.code === 1 && badMount.out.includes('Not starting:'), 'a bad mount exits 1 before it listens');
    const badStore = await finish(startEntry({ PORT: '0', DIST_DIR: options.distDir, GAMEFILES_DIR: options.gamefilesDir, MANIFEST_FILE: options.manifestFile, STATS_DB: options.distDir }));
    console.log(`  bad store: exit ${badStore.code}, ${firstLine(badStore.out).replace(scratch, '<scratch>')}`);
    check(badStore.code === 1 && badStore.out.includes('Not starting:'), 'a store it cannot open exits 1 before it listens');

    let healthy = false;
    let walHeld = false;
    let backedUp: { code: number | null; out: string; events: number; sets: number; answering: boolean } | null = null;
    const child = startEntry({ PORT: '0', DIST_DIR: options.distDir, GAMEFILES_DIR: options.gamefilesDir, MANIFEST_FILE: options.manifestFile, STATS_DB: statsDb });
    const ended = finish(child, (line) => {
        const listening = /^Listening on port (\d+)/.exec(line);
        if (!listening) return;
        const port = Number(listening[1]);
        (async () => {
            healthy = (await ask(port, '/api/health')).status === 200;
            // Three events, which the running server holds in its WAL, then a backup beside it.
            for (let i = 0; i < 3; i++) {
                await ask(port, '/api/event', 'POST', { 'Content-Type': 'text/plain;charset=UTF-8' },
                    JSON.stringify({ type: 'started', player: PLAYER, set: 'a', playthrough: 100 + i, build: 'test', payload: {} }));
            }
            walHeld = existsSync(`${statsDb}-wal`) && statSync(`${statsDb}-wal`).size > 0;
            const run = await finish(startEntry({ STATS_DB: statsDb }, 'backup.ts'));
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
        })().finally(() => child.kill('SIGTERM'));
    });
    const { code, out } = await ended;
    for (const line of out.trim().split('\n')) {
        if (!line.includes('ExperimentalWarning') && !line.includes('--trace-warnings')) console.log(`  | ${line.split(scratch).join('<scratch>')}`);
    }
    check(healthy, 'it listens on the PORT given, 0 for a free one, and answers /api/health');
    const backup = backedUp as { code: number | null; out: string; events: number; sets: number; answering: boolean } | null;
    console.log(`  backup.ts: exit ${backup?.code}, ${firstLine(backup?.out ?? '').split(scratch).join('<scratch>').replace(/stats-[\dTZ-]+\.db/, 'stats-<date>.db').replace(/"bytes":\d+/, '"bytes":<n>')}`);
    check(backup?.code === 0 && /<scratch>\/stats\/backups\/stats-[\dTZ-]+\.db/.test((backup?.out ?? '').split(scratch).join('<scratch>')),
        'backup.ts, run beside the server, writes a snapshot into backups/ beside the store');
    check(walHeld && backup?.events === 3, 'the snapshot holds the events the server had in its WAL');
    check(backup?.sets === 1, 'and the data sets\' table');
    check(backup?.answering === true, 'the server kept serving through the backup');
    const noStore = await finish(startEntry({ STATS_DB: join(scratch, 'nowhere', 'stats.db') }, 'backup.ts'));
    check(noStore.code === 1 && noStore.out.includes('backup_failed'), 'backup.ts on a store that is not there exits 1');
    check(code === 0 && out.includes('SIGTERM: shutting down') && out.includes('Stopped'), 'SIGTERM stops it, with 0');
    check(existsSync(statsDb) && !existsSync(`${statsDb}-wal`), 'the store was made, its folder too, and closed with its WAL checkpointed');
    check(out.includes('(a, from the data_sets table, filled from <scratch>'.replace('<scratch>', scratch)), 'its table filled from the manifest');

    let again = '';
    const restart = startEntry({ PORT: '0', DIST_DIR: options.distDir, GAMEFILES_DIR: options.gamefilesDir, MANIFEST_FILE: join(scratch, 'nowhere.json'), STATS_DB: statsDb });
    const restarted = await finish(restart, (line) => {
        if (!line.startsWith('Listening on port')) return;
        again = line.split(scratch).join('<scratch>').replace(/port \d+/, 'port <n>');
        restart.kill('SIGTERM');
    });
    console.log(`  again: ${again}`);
    check(restarted.code === 0 && again.includes('(a, from the data_sets table);'), 'started again without a manifest, it serves the table\'s sets');
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
            dataSets,
            store,
            rules: { hasSet: (id) => dataSets.hasSet(id) },
            rateLimit: new RateLimit(EVENTS_PER_WINDOW, 60_000),
            now: Date.now,
        };
        server = createAppServer(options, api);
        await new Promise<void>((done) => server!.listen(0, '127.0.0.1', done));
        const port = (server.address() as AddressInfo).port;
        await checkAnswers(port, manifest);
        await checkEvents(port, store);
        await checkTableRead(port, db, manifest);

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
