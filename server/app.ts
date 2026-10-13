/**
 * What the deployed server answers (`doc/DEPLOYMENT.md`): the built page, the game
 * files beside it, and the API. `server.ts` reads the environment and listens; this module
 * is the part a tool can stand up on a free port (`tools/dump-server.ts`).
 *
 * Node runs it as it is, stripping the types, so it uses only erasable syntax and names its
 * imports with their `.ts` extension (`server/tsconfig.json` holds it to that).
 *
 *   /                 dist/index.html               no-cache
 *   /assets/…         dist/assets/…, hashed names   immutable
 *   /server/…         404: the server's own module (`CHECK_MODULE`), never served
 *   /gamefiles/…      GAMEFILES_DIR/…               no-cache, with ETag and Last-Modified
 *   /api/data-sets    the page's list of sets, from the store's table (`dataSets.ts`), for
 *                     the player its `X-Player-Id` names
 *   /api/health       200, for the compose healthcheck
 *   /api/event        POST: a game's event, checked (`events.ts`) and stored (`stats.ts`)
 *   /api/stats        the store's aggregates, as JSON
 *
 * Every file answers a conditional GET with 304. A path with a `.` segment, a backslash or
 * a NUL, encoded or not, is refused before it reaches the disk, so no request leaves the
 * two folders. The manifest is not served as a file, even where it lies under
 * `GAMEFILES_DIR`: the page asks `api/data-sets`.
 */
import { createReadStream, readFileSync, statSync, type Stats } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { DATA_SETS_ROUTE, parseManifest, PLAYER_ID_HEADER, type DataSetManifest } from '../src/data/DataSets.ts';
import { manifestText, samePlayerId, type DataSetStore, type DataSetViewer } from './dataSets.ts';
import { checkEvent, isPlayerId, MAX_EVENT_BYTES, type EventRules, type RateLimit } from './events.ts';
import type { StatsStore } from './stats.ts';

export interface ServerOptions {
    /** The built page: `index.html` and `assets/`. */
    distDir: string;
    /** The data sets, served under `gamefiles/`. */
    gamefilesDir: string;
    /**
     * The data sets' manifest, its folders relative to `gamefilesDir`, which fills an empty
     * `data_sets` table (`checkFiles`) and is read at no other time.
     */
    manifestFile: string;
}

/** What `checkFiles` found. */
export interface CheckedFiles {
    /** The table's sets' ids, in its order. */
    ids: string[];
    /** Whether the table was empty, and filled from the manifest. */
    filled: boolean;
}

/** The files of a set's folder, by name, as the page reads them (`DataSetFiles`, `src/data/DataSetFiles.ts`). */
export interface DataSetFolder {
    /** The file `name`'s bytes, or `null` where the set has none, or it cannot be read. */
    read(name: string): Promise<Uint8Array | null>;
    /** The file `name` as an error names it. */
    where(name: string): string;
}

/** A player's set as the page's form gives it (`LocalDataSetDraft`, `src/data/LocalDataSets.ts`). */
export interface DataSetDraft {
    /** The `<id>` of `local:<id>`. */
    id: string;
    name: string;
    description: string;
    authors: string[];
    dmRules: boolean;
    /** The set whose `graphics.dat` it plays where `files` holds none. */
    baseSet: string;
    /** By the name the game reads them under, and `thumbnail`. */
    files: Partial<Record<string, Blob>>;
}

/**
 * The page's check of a player's own set, `checkLocalDataSet` (`src/data/LocalDataSets.ts`),
 * which `npm run build` makes a Node module (`vite.config.mts`) and the server loads at
 * start-up (`loadCheckDataSet`), so that the server reads a set with the page's own readers.
 * It is typed here by its shape, since the page's sources are not erasable syntax and the
 * server's `tsc` cannot follow them; a tool that hands the API the source's function proves
 * that the two agree.
 */
export type CheckDataSet = (
    draft: DataSetDraft,
    takenIds: ReadonlySet<string>,
    base: (set: string) => DataSetFolder | null,
    createdAt: number,
) => Promise<{
    problems: { about: string; text: string }[];
    record: { id: string; dungeonSignature: readonly string[] } | null;
    census: unknown;
}>;

/** The folder of `distDir` that holds the server's own module, not the page's: never served. */
const SERVER_DIR = 'server';

/** The page's check built for Node (`CheckDataSet`), under `distDir`. */
export const CHECK_MODULE = `${SERVER_DIR}/LocalDataSets.js`;

/** The check `CHECK_MODULE` exports, loaded from `distDir`; throws, saying why, where it is not built. */
export async function loadCheckDataSet(distDir: string): Promise<CheckDataSet> {
    const file = join(distDir, CHECK_MODULE);
    let module: { checkLocalDataSet?: unknown };
    try {
        module = await import(pathToFileURL(file).href);
    } catch (error) {
        throw new Error(`${file} does not load (${error instanceof Error ? error.message : String(error)}): is the server's module built?`);
    }
    if (typeof module.checkLocalDataSet !== 'function') throw new Error(`${file} exports no checkLocalDataSet`);
    return module.checkLocalDataSet as CheckDataSet;
}

/** What the API needs beside the files. */
export interface ApiOptions {
    /** The page's check of a player's set (`CheckDataSet`). */
    checkDataSet: CheckDataSet;
    /** `api/data-sets`'s sets, read at each request. */
    dataSets: DataSetStore;
    /** The moderators' `playerId`s, to whom `api/data-sets` offers every set: none, or several. */
    moderatorPlayerIds: readonly string[];
    store: StatsStore;
    rules: EventRules;
    /** Events per address. */
    rateLimit: RateLimit;
    /** The clock events are stored with. */
    now: () => number;
}

/** The URL prefix of the game files: the page's `GAMEFILES_DIR` (`src/main.ts`). */
const GAMEFILES = 'gamefiles';

const CONTENT_TYPES: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.ico': 'image/x-icon',
    '.jpg': 'image/jpeg',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ttf': 'font/ttf',
    '.txt': 'text/plain; charset=utf-8',
    '.wav': 'audio/wav',
    '.woff2': 'font/woff2',
};

const NO_CACHE = 'no-cache';
const IMMUTABLE = 'public, max-age=31536000, immutable';

/**
 * The page's `index.html` in `distDir`, and the data sets, every folder they name present
 * in `gamefilesDir`. An empty `data_sets` table is filled from the manifest, parsed by the
 * page's own parser, once its folders are found, so a manifest that names a missing one
 * leaves the table empty for the next start to read it again; a table that is not empty is
 * read instead, and the manifest is not. Throws an error that says what is missing, so a
 * bad mount stops the container rather than the player's boot.
 */
export function checkFiles({ distDir, gamefilesDir, manifestFile }: ServerOptions, dataSets: DataSetStore): CheckedFiles {
    if (!isFile(join(distDir, 'index.html'))) throw new Error(`${distDir} holds no index.html: is the page built?`);
    const manifest = dataSets.isEmpty() ? readManifest(manifestFile) : null;
    const { dataSets: sets, swooshDir } = manifest ?? dataSets.read();
    const folders = [...sets.map((set) => set.dir), ...(swooshDir === null ? [] : [swooshDir])];
    const missing = folders.filter((dir) => !isDirectory(join(gamefilesDir, dir)));
    if (missing.length > 0) {
        throw new Error(`${manifest ? manifestFile : 'the data_sets table'} names folders ${gamefilesDir} does not hold: ${missing.join(', ')}`);
    }
    if (manifest) dataSets.fill(manifest);
    return { ids: dataSets.read().dataSets.map((set) => set.id), filled: manifest !== null };
}

function readManifest(manifestFile: string): DataSetManifest {
    let text: string;
    try {
        text = readFileSync(manifestFile, 'utf8');
    } catch {
        throw new Error(`the data_sets table is empty, and there is no manifest ${manifestFile} to fill it`);
    }
    return parseManifest(text, '');
}

/** The server, not yet listening. */
export function createAppServer(options: ServerOptions, api: ApiOptions): Server {
    return createServer((req, res) => {
        const fail = (error: unknown) => {
            console.error(`${req.method} ${req.url}:`, error);
            if (!res.headersSent) send(res, 500, 'Internal error');
            else res.destroy();
        };
        try {
            route(options, api, req, res)?.catch(fail);
        } catch (error) {
            fail(error);
        }
    });
}

function route({ distDir, gamefilesDir, manifestFile }: ServerOptions, api: ApiOptions, req: IncomingMessage, res: ServerResponse): Promise<void> | void {
    const segments = pathSegments(req.url ?? '');
    if (segments === null) return send(res, 400, 'Bad path');

    if (segments[0] === 'api') {
        if (segments.join('/') === DATA_SETS_ROUTE) {
            if (req.method !== 'GET' && req.method !== 'HEAD') return refuseMethod(res);
            res.setHeader('Cache-Control', 'no-store');
            res.setHeader('Vary', PLAYER_ID_HEADER);
            return send(res, 200, manifestText(api.dataSets.read(), dataSetViewer(api, req)), 'application/json; charset=utf-8');
        }
        const name = segments.length === 2 ? segments[1] : undefined;
        if (name === 'event') {
            if (req.method !== 'POST') return refuseMethod(res, 'POST');
            return receiveEvent(api, req, res);
        }
        if (name === 'health' || name === 'stats') {
            if (req.method !== 'GET' && req.method !== 'HEAD') return refuseMethod(res);
            res.setHeader('Cache-Control', 'no-store');
            const body = name === 'health' ? '{"ok":true}' : JSON.stringify(api.store.stats());
            return send(res, 200, body, 'application/json; charset=utf-8');
        }
        return send(res, 404, 'Not found');
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') return refuseMethod(res);
    if (segments[0] === GAMEFILES) {
        const path = join(gamefilesDir, ...segments.slice(1));
        if (resolve(path) === resolve(manifestFile)) return send(res, 404, 'Not found');
        return serveFile(req, res, path, NO_CACHE);
    }
    if (segments.length === 0) return serveFile(req, res, join(distDir, 'index.html'), NO_CACHE);
    if (segments[0] === SERVER_DIR) return send(res, 404, 'Not found');
    return serveFile(req, res, join(distDir, ...segments), segments[0] === 'assets' ? IMMUTABLE : NO_CACHE);
}

/**
 * The request's path as its decoded segments, or `null` for one that is malformed or could
 * leave the folder it names: a segment that starts with `.` (so `.` and `..` too), or holds
 * a `/`, a `\` or a NUL once decoded. The query is not part of it (the page's
 * `?dungeon=`).
 */
export function pathSegments(url: string): string[] | null {
    const path = url.split(/[?#]/, 1)[0]!;
    if (!path.startsWith('/')) return null;
    const segments: string[] = [];
    for (const raw of path.slice(1).split('/')) {
        if (raw === '') continue;
        let segment: string;
        try {
            segment = decodeURIComponent(raw);
        } catch {
            return null;
        }
        if (segment.startsWith('.') || /[/\\\0]/.test(segment)) return null;
        segments.push(segment);
    }
    return segments;
}

function serveFile(req: IncomingMessage, res: ServerResponse, path: string, cacheControl: string): void {
    let stats: Stats;
    try {
        stats = statSync(path);
    } catch {
        return send(res, 404, 'Not found');
    }
    if (!stats.isFile()) return send(res, 404, 'Not found');

    const etag = `W/"${stats.size.toString(16)}-${Math.floor(stats.mtimeMs).toString(16)}"`;
    res.setHeader('Cache-Control', cacheControl);
    res.setHeader('ETag', etag);
    res.setHeader('Last-Modified', stats.mtime.toUTCString());
    if (isNotModified(req, etag, stats.mtime)) {
        res.statusCode = 304;
        res.end();
        return;
    }

    res.setHeader('Content-Type', CONTENT_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream');
    res.setHeader('Content-Length', stats.size);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method === 'HEAD') {
        res.end();
        return;
    }
    const stream = createReadStream(path);
    stream.on('error', (error) => {
        console.error(`${req.method} ${req.url}:`, error);
        res.destroy();
    });
    stream.pipe(res);
}

/**
 * RFC 9110's preconditions for a GET: `If-None-Match`, compared weakly, and only when
 * there is none, `If-Modified-Since`, to the second.
 */
function isNotModified(req: IncomingMessage, etag: string, mtime: Date): boolean {
    const match = req.headers['if-none-match'];
    if (match !== undefined) {
        const opaque = (tag: string) => tag.trim().replace(/^W\//, '');
        return match.trim() === '*' || match.split(',').some((tag) => opaque(tag) === opaque(etag));
    }
    const since = req.headers['if-modified-since'];
    if (since === undefined) return false;
    const time = Date.parse(since);
    return !Number.isNaN(time) && Math.floor(mtime.getTime() / 1000) <= Math.floor(time / 1000);
}

/**
 * `api/event`: the rate limit first, then a body of at most `MAX_EVENT_BYTES`, checked and
 * stored. The page's `sendBeacon` reads no answer, so the status is for the tools and the
 * logs.
 */
async function receiveEvent(api: ApiOptions, req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!api.rateLimit.allow(clientAddress(req), api.now())) {
        req.resume();
        return send(res, 429, 'Too many events');
    }
    const body = await readBody(req, MAX_EVENT_BYTES);
    if (body === null) return send(res, 413, 'Event too large');
    const event = checkEvent(body, api.rules);
    if (typeof event === 'string') return send(res, 400, `Bad event: ${event}`);
    api.store.record(event, api.now());
    res.statusCode = 204;
    res.end();
}

/**
 * Who asks `api/data-sets`: the `playerId` the page sends in `PLAYER_ID_HEADER`, where it
 * has a `playerId`'s form, and whether it is a moderator's. It is never logged.
 */
function dataSetViewer(api: ApiOptions, req: IncomingMessage): DataSetViewer {
    const header = req.headers[PLAYER_ID_HEADER.toLowerCase()];
    const playerId = isPlayerId(header) ? header : null;
    const moderator = playerId !== null && api.moderatorPlayerIds.some((id) => samePlayerId(playerId, id));
    return { playerId, moderator };
}

/**
 * The address the rate limit counts: the host's nginx's `X-Real-IP`, which is trusted only
 * because the container's port is published on loopback (`doc/DEPLOYMENT.md`), or the socket's
 * own. It is never stored.
 */
function clientAddress(req: IncomingMessage): string {
    const forwarded = req.headers['x-real-ip'];
    if (typeof forwarded === 'string' && forwarded !== '') return forwarded;
    return req.socket.remoteAddress ?? '';
}

/** The request's body as text, or `null` past `limit` bytes, which is drained unread. */
function readBody(req: IncomingMessage, limit: number): Promise<string | null> {
    if (Number(req.headers['content-length'] ?? 0) > limit) {
        req.resume();
        return Promise.resolve(null);
    }
    return new Promise((done, fail) => {
        const chunks: Buffer[] = [];
        let size = 0;
        req.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size <= limit) chunks.push(chunk);
        });
        req.on('end', () => done(size <= limit ? Buffer.concat(chunks).toString('utf8') : null));
        req.on('error', fail);
    });
}

function refuseMethod(res: ServerResponse, allow = 'GET, HEAD'): void {
    res.setHeader('Allow', allow);
    send(res, 405, 'Method not allowed');
}

/** Node leaves the body out of an answer to HEAD. */
function send(res: ServerResponse, status: number, body: string, type = 'text/plain; charset=utf-8'): void {
    res.statusCode = status;
    res.setHeader('Content-Type', type);
    res.setHeader('Content-Length', Buffer.byteLength(body));
    res.end(body);
}

function isFile(path: string): boolean {
    try {
        return statSync(path).isFile();
    } catch {
        return false;
    }
}

function isDirectory(path: string): boolean {
    try {
        return statSync(path).isDirectory();
    } catch {
        return false;
    }
}
