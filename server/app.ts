/**
 * What the deployed server answers (`doc/DEPLOYMENT.md`): the built page, the game
 * files beside it, and the API. `server.ts` reads the environment and listens; this module
 * is the part a tool can stand up on a free port (`tools/dump-server.ts`).
 *
 * Node runs it as it is, stripping the types, so it uses only erasable syntax and names its
 * imports with their `.ts` extension (`server/tsconfig.json` holds it to that).
 *
 *   /                 dist/index.html               no-cache
 *   /manifest.webmanifest  the installed game's     no-cache
 *   /assets/…         dist/assets/…, hashed names   immutable
 *   /server/…         404: the server's own module (`CHECK_MODULE`), never served
 *   /gamefiles/…      GAMEFILES_DIR/…               no-cache, with ETag and Last-Modified
 *   /files/…          FILES_DIR/…, the author's files shared by link, as the game files are;
 *                     404 everywhere when there is no such folder
 *   /api/data-sets    the page's list of sets, from the store's table (`dataSets.ts`), for
 *                     the player its `X-Player-Id` names; POST: that player's own set
 *                     published, pending (`publish.ts`)
 *   /api/data-sets/<id>  POST: the set approved, rejected, hidden or shown, by a moderator,
 *                     or withdrawn by its owner (`moderate.ts`); with a form, its text and
 *                     files edited by a moderator (`edit.ts`)
 *   /api/data-set-walls  the walls of the sets `api/data-sets` offers the same player
 *                     that keep them, the published ones (`wallsText`)
 *   /api/health       200, for the compose healthcheck
 *   /api/event        POST: a game's event, checked (`events.ts`) and stored (`stats.ts`)
 *   /api/stats        the store's aggregates, as JSON
 *
 * Every file answers a conditional GET with 304. A path with a `.` segment, a backslash or
 * a NUL, encoded or not, is refused before it reaches the disk, so no request leaves the
 * three folders. A folder is 404, never a listing.
 */
import { closeSync, createReadStream, fstatSync, openSync, statSync, type Stats } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join } from 'node:path';
import { pipeline } from 'node:stream';
import { pathToFileURL } from 'node:url';

import { DATA_SET_WALLS_ROUTE, DATA_SETS_ROUTE, PLAYER_ID_HEADER } from '../src/data/DataSets.ts';
import { manifestText, samePlayerId, wallsText, type DataSetStore, type DataSetViewer, type Moderator } from './dataSets.ts';
import { editDataSet } from './edit.ts';
import { checkEvent, isPlayerId, MAX_EVENT_BYTES, type EventRules, type RateLimit } from './events.ts';
import { MAX_MODERATION_BYTES, moderateDataSet, type ModerationAnswer } from './moderate.ts';
import type { Notify } from './notify.ts';
import { MAX_PUBLISH_BYTES, publishDataSet, type CheckDataSet, type PublishAnswer, type ReadDungeonWalls } from './publish.ts';
import type { StatsStore } from './stats.ts';

export interface ServerOptions {
    /** The built page: `index.html` and `assets/`. */
    distDir: string;
    /** The data sets, served under `gamefiles/`. */
    gamefilesDir: string;
    /** The files shared by link, served under `files/`: none, every `files/` path then 404. */
    filesDir?: string;
}

/** The folder of `distDir` that holds the server's own module, not the page's: never served. */
const SERVER_DIR = 'server';

/** The page's check built for Node (`CheckDataSet`, `publish.ts`), under `distDir`. */
export const CHECK_MODULE = `${SERVER_DIR}/LocalDataSets.js`;

/** What the server uses of `CHECK_MODULE`: the page's check of a set, and its reader of a dungeon's walls. */
export interface PageReaders {
    checkDataSet: CheckDataSet;
    readDungeonWalls: ReadDungeonWalls;
}

/** What `CHECK_MODULE` exports, loaded from `distDir`; throws, saying why, where it is not built. */
export async function loadPageReaders(distDir: string): Promise<PageReaders> {
    const file = join(distDir, CHECK_MODULE);
    let module: { checkLocalDataSet?: unknown; readDungeonWalls?: unknown };
    try {
        module = await import(pathToFileURL(file).href);
    } catch (error) {
        throw new Error(`${file} does not load (${error instanceof Error ? error.message : String(error)}): is the server's module built?`);
    }
    if (typeof module.checkLocalDataSet !== 'function') throw new Error(`${file} exports no checkLocalDataSet`);
    if (typeof module.readDungeonWalls !== 'function') throw new Error(`${file} exports no readDungeonWalls`);
    return { checkDataSet: module.checkLocalDataSet as CheckDataSet, readDungeonWalls: module.readDungeonWalls as ReadDungeonWalls };
}

/**
 * The walls of every set with an owner whose row keeps none, a set published before the
 * rows kept them, read from its folder's `dungeon.dat` with the page's reader and kept
 * (`DataSetStore.setWalls`). A `dungeon.dat` that does not read is left without, the
 * page then naming no save after that set, and said in `failed`. Run at start-up.
 */
export async function fillWalls(gamefilesDir: string, dataSets: DataSetStore, readDungeonWalls: ReadDungeonWalls): Promise<{ filled: string[]; failed: string[] }> {
    const filled: string[] = [], failed: string[] = [];
    for (const { id, dir } of dataSets.missingWalls()) {
        try {
            dataSets.setWalls(id, await readDungeonWalls(new Uint8Array(await readFile(join(gamefilesDir, dir, 'dungeon.dat')))));
            filled.push(id);
        } catch (error) {
            failed.push(`${id} (${error instanceof Error ? error.message : String(error)})`);
        }
    }
    return { filled, failed };
}

/** What the API needs beside the files. */
export interface ApiOptions {
    /** The page's check of a player's set (`CheckDataSet`). */
    checkDataSet: CheckDataSet;
    /** `api/data-sets`'s sets, read at each request. */
    dataSets: DataSetStore;
    /** The moderators, to whom `api/data-sets` offers every set: none, or several. */
    moderators: readonly Moderator[];
    store: StatsStore;
    rules: EventRules;
    /** Events per address. */
    rateLimit: RateLimit;
    /** Publishes per address, refused ones included. */
    publishRateLimit: RateLimit;
    /** The clock events are stored and notifications dated with. */
    now: () => number;
    /** Who is told of each change to the sets (`notify.ts`). */
    notify: Notify;
}

/** The URL prefix of the game files: the page's `GAMEFILES_DIR` (`src/main.ts`). */
const GAMEFILES = 'gamefiles';

/** The URL prefix of the files shared by link (`ServerOptions.filesDir`). */
const FILES = 'files';

/** A file's type by its extension, in any case; any other is `application/octet-stream`. */
const CONTENT_TYPES: Record<string, string> = {
    '.7z': 'application/x-7z-compressed',
    '.css': 'text/css; charset=utf-8',
    '.csv': 'text/csv; charset=utf-8',
    '.gif': 'image/gif',
    '.gz': 'application/gzip',
    '.htm': 'text/html; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.ico': 'image/x-icon',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.lzh': 'application/x-lzh-compressed',
    '.md': 'text/markdown; charset=utf-8',
    '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4',
    '.ogg': 'audio/ogg',
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.rar': 'application/vnd.rar',
    '.svg': 'image/svg+xml',
    '.tar': 'application/x-tar',
    '.ttf': 'font/ttf',
    '.txt': 'text/plain; charset=utf-8',
    '.wav': 'audio/wav',
    '.webmanifest': 'application/manifest+json',
    '.webm': 'video/webm',
    '.webp': 'image/webp',
    '.woff2': 'font/woff2',
    '.xml': 'application/xml; charset=utf-8',
    '.zip': 'application/zip',
};

const NO_CACHE = 'no-cache';
const IMMUTABLE = 'public, max-age=31536000, immutable';

/**
 * The page's `index.html` in `distDir`, `gamefilesDir`, and every folder the `data_sets`
 * table names in it, which may name none: a new server's table is empty, and its rows are
 * written by hand (`doc/DEPLOYMENT.md`) or published. The table's ids, in its order. Throws
 * an error that says what is missing, so a bad mount stops the container rather than the
 * player's boot.
 */
export function checkFiles({ distDir, gamefilesDir }: ServerOptions, dataSets: DataSetStore): string[] {
    if (!isFile(join(distDir, 'index.html'))) throw new Error(`${distDir} holds no index.html: is the page built?`);
    if (!isDirectory(gamefilesDir)) throw new Error(`${gamefilesDir} is not a folder: are the game files mounted?`);
    const sets = dataSets.read().dataSets;
    const missing = sets.map((set) => set.dir).filter((dir) => !isDirectory(join(gamefilesDir, dir)));
    if (missing.length > 0) throw new Error(`the data_sets table names folders ${gamefilesDir} does not hold: ${missing.join(', ')}`);
    return sets.map((set) => set.id);
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

function route({ distDir, gamefilesDir, filesDir }: ServerOptions, api: ApiOptions, req: IncomingMessage, res: ServerResponse): Promise<void> | void {
    const segments = pathSegments(req.url ?? '');
    if (segments === null) return send(res, 400, 'Bad path');

    if (segments[0] === 'api') {
        if (segments.join('/') === DATA_SETS_ROUTE) {
            if (req.method === 'POST') return receivePublish(gamefilesDir, api, req, res);
            if (req.method !== 'GET' && req.method !== 'HEAD') return refuseMethod(res, 'GET, HEAD, POST');
            res.setHeader('Cache-Control', 'no-store');
            res.setHeader('Vary', PLAYER_ID_HEADER);
            return send(res, 200, manifestText(api.dataSets.read(), dataSetViewer(api, req)), 'application/json; charset=utf-8');
        }
        if (segments.join('/') === DATA_SET_WALLS_ROUTE) {
            if (req.method !== 'GET' && req.method !== 'HEAD') return refuseMethod(res);
            res.setHeader('Cache-Control', 'no-store');
            res.setHeader('Vary', PLAYER_ID_HEADER);
            return send(res, 200, wallsText(api.dataSets.read(), api.dataSets.walls(), dataSetViewer(api, req)), 'application/json; charset=utf-8');
        }
        if (segments.length === 3 && segments.slice(0, 2).join('/') === DATA_SETS_ROUTE) {
            if (req.method !== 'POST') return refuseMethod(res, 'POST');
            if (isForm(req)) return receiveEdit(segments[2]!, gamefilesDir, api, req, res);
            return receiveModeration(segments[2]!, gamefilesDir, api, req, res);
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
        return serveFile(req, res, join(gamefilesDir, ...segments.slice(1)), NO_CACHE);
    }
    if (segments[0] === FILES) {
        if (filesDir === undefined) return send(res, 404, 'Not found');
        return serveFile(req, res, join(filesDir, ...segments.slice(1)), NO_CACHE);
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

/**
 * The file is opened once and its descriptor stated, so the headers describe the bytes
 * sent even when a data set is replaced meanwhile. The descriptor is closed on every
 * path: a 304, a HEAD, a download, and one the client abandons, which `pipeline` destroys
 * (`pipe` alone would leave it open, and enough of them fail every open with `EMFILE`).
 */
function serveFile(req: IncomingMessage, res: ServerResponse, path: string, cacheControl: string): void {
    let fd: number;
    let stats: Stats;
    try {
        fd = openSync(path, 'r');
    } catch {
        return send(res, 404, 'Not found');
    }
    try {
        stats = fstatSync(fd);
    } catch (error) {
        closeSync(fd);
        throw error;
    }
    if (!stats.isFile()) {
        closeSync(fd);
        return send(res, 404, 'Not found');
    }

    const etag = `W/"${stats.size.toString(16)}-${Math.floor(stats.mtimeMs).toString(16)}"`;
    res.setHeader('Cache-Control', cacheControl);
    res.setHeader('ETag', etag);
    res.setHeader('Last-Modified', stats.mtime.toUTCString());
    if (isNotModified(req, etag, stats.mtime)) {
        closeSync(fd);
        res.statusCode = 304;
        res.end();
        return;
    }

    res.setHeader('Content-Type', CONTENT_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream');
    res.setHeader('Content-Length', stats.size);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method === 'HEAD') {
        closeSync(fd);
        res.end();
        return;
    }
    pipeline(createReadStream(path, { fd }), res, (error) => {
        if (error && (error as NodeJS.ErrnoException).code !== 'ERR_STREAM_PREMATURE_CLOSE') console.error(`${req.method} ${req.url}:`, error);
    });
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
    const event = checkEvent(body.toString('utf8'), api.rules);
    if (typeof event === 'string') return send(res, 400, `Bad event: ${event}`);
    api.store.record(event, api.now());
    res.statusCode = 204;
    res.end();
}

/** What `receivePublish` needs of the API. */
export type PublishApi = Pick<ApiOptions, 'checkDataSet' | 'dataSets' | 'moderators' | 'publishRateLimit' | 'now' | 'notify'>;

/**
 * `POST api/data-sets`: the rate limit first, then the player, a `multipart/form-data` body
 * of at most `MAX_PUBLISH_BYTES`, and its form, before `publishDataSet` decides. Every
 * answer is JSON (`PublishAnswer`). The dev server answers the route with it too
 * (`vite.config.mts`).
 */
export async function receivePublish(gamefilesDir: string, api: PublishApi, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const answer = (status: number, error: string): PublishAnswer => ({ status, body: { error } });
    const refused = (): PublishAnswer | null => {
        if (!api.publishRateLimit.allow(clientAddress(req), api.now())) return answer(429, 'Too many publishes from here: try again in an hour.');
        if (!isPlayerId(req.headers[PLAYER_ID_HEADER.toLowerCase()])) return answer(400, `No player: ${PLAYER_ID_HEADER} is not a playerId.`);
        if (!isForm(req)) return answer(400, 'The body is not multipart/form-data.');
        return null;
    };
    let reply = refused();
    if (reply !== null) req.resume();
    else {
        const playerId = req.headers[PLAYER_ID_HEADER.toLowerCase()] as string;
        const form = await readForm(req);
        reply = typeof form === 'string' ? answer(form === 'large' ? 413 : 400, FORM_REFUSALS[form])
            : await publishDataSet(form, playerId, {
                checkDataSet: api.checkDataSet, dataSets: api.dataSets, gamefilesDir, now: api.now,
                notify: api.notify, publisher: dataSetViewer(api, req).moderator?.name ?? 'a player',
            });
    }
    res.setHeader('Cache-Control', 'no-store');
    send(res, reply.status, JSON.stringify(reply.body), 'application/json; charset=utf-8');
}

/** Whether `req`'s body says it is a form, as a publish and an edit are sent. */
function isForm(req: IncomingMessage): boolean {
    return req.headers['content-type']?.startsWith('multipart/form-data') ?? false;
}

/** Why a form was not read. */
const FORM_REFUSALS = { large: `The request is larger than ${MAX_PUBLISH_BYTES / (1024 * 1024)} MiB.`, broken: 'The body is not a form.' };

/** `req`'s form, a body of at most `MAX_PUBLISH_BYTES`, or why not. */
async function readForm(req: IncomingMessage): Promise<FormData | keyof typeof FORM_REFUSALS> {
    const body = await readBody(req, MAX_PUBLISH_BYTES);
    if (body === null) return 'large';
    const request = new Request('http://localhost/', { method: 'POST', headers: { 'Content-Type': req.headers['content-type']! }, body: new Uint8Array(body) });
    return await request.formData().catch(() => null) ?? 'broken';
}

/** What `receiveEdit` needs of the API. */
export type EditApi = Pick<ApiOptions, 'checkDataSet' | 'dataSets' | 'moderators' | 'now' | 'notify'>;

/**
 * `POST api/data-sets/<id>` with a form: its asker, refused unless they moderate before the
 * body is read, so that nobody else can make the server read `MAX_PUBLISH_BYTES`, then the
 * form, before `editDataSet` decides. Every answer is JSON (`PublishAnswer`). The dev
 * server answers the route with it too (`vite.config.mts`).
 */
export async function receiveEdit(id: string, gamefilesDir: string, api: EditApi, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const viewer = dataSetViewer(api, req);
    let reply: PublishAnswer;
    if (!viewer.moderator) {
        req.resume();
        reply = { status: 403, body: { error: 'Only a moderator may edit a set.' } };
    } else {
        const form = await readForm(req);
        reply = typeof form === 'string' ? { status: form === 'large' ? 413 : 400, body: { error: FORM_REFUSALS[form] } }
            : await editDataSet(id, form, viewer, { checkDataSet: api.checkDataSet, dataSets: api.dataSets, gamefilesDir, notify: api.notify, now: api.now });
    }
    res.setHeader('Cache-Control', 'no-store');
    send(res, reply.status, JSON.stringify(reply.body), 'application/json; charset=utf-8');
}

/** What `receiveModeration` needs of the API. */
export type ModerationApi = Pick<ApiOptions, 'dataSets' | 'moderators' | 'now' | 'notify'>;

/**
 * `POST api/data-sets/<id>`: its asker and a body of at most `MAX_MODERATION_BYTES`, before
 * `moderateDataSet` decides. Every answer is JSON (`ModerationAnswer`).
 */
export async function receiveModeration(id: string, gamefilesDir: string, api: ModerationApi, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readBody(req, MAX_MODERATION_BYTES);
    const reply: ModerationAnswer = body === null ? { status: 413, body: { error: `The body is larger than ${MAX_MODERATION_BYTES} bytes.` } }
        : await moderateDataSet(id, body.toString('utf8'), dataSetViewer(api, req), { dataSets: api.dataSets, gamefilesDir, notify: api.notify, now: api.now });
    res.setHeader('Cache-Control', 'no-store');
    send(res, reply.status, JSON.stringify(reply.body), 'application/json; charset=utf-8');
}

/**
 * Who asks `api/data-sets`: the `playerId` the page sends in `PLAYER_ID_HEADER`, where it
 * has a `playerId`'s form, and the moderator it is, if any. It is never logged.
 */
export function dataSetViewer(api: Pick<ApiOptions, 'moderators'>, req: IncomingMessage): DataSetViewer {
    const header = req.headers[PLAYER_ID_HEADER.toLowerCase()];
    const playerId = isPlayerId(header) ? header : null;
    const moderator = playerId === null ? null : api.moderators.find((one) => samePlayerId(playerId, one.playerId)) ?? null;
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

/** The request's body, or `null` past `limit` bytes, which is drained unread. */
function readBody(req: IncomingMessage, limit: number): Promise<Buffer | null> {
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
        req.on('end', () => done(size <= limit ? Buffer.concat(chunks) : null));
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
