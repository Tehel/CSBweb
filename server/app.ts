/**
 * What the deployed server answers (PLAN.md Phase 17, step 3): the built page, the game
 * files beside it, and the API. `server.ts` reads the environment and listens; this module
 * is the part a tool can stand up on a free port (`tools/dump-server.ts`).
 *
 * Node runs it as it is, stripping the types, so it uses only erasable syntax and names its
 * imports with their `.ts` extension (`server/tsconfig.json` holds it to that).
 *
 *   /                 dist/index.html               no-cache
 *   /assets/…         dist/assets/…, hashed names   immutable
 *   /gamefiles/…      GAMEFILES_DIR/…               no-cache, with ETag and Last-Modified
 *   /api/health       200, for the compose healthcheck
 *
 * Every file answers a conditional GET with 304. A path with a `.` segment, a backslash or
 * a NUL, encoded or not, is refused before it reaches the disk, so no request leaves the
 * two folders.
 */
import { createReadStream, readFileSync, statSync, type Stats } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join } from 'node:path';

import { MANIFEST_NAME, parseManifest, type DataSetManifest } from '../src/data/DataSets.ts';

export interface ServerOptions {
    /** The built page: `index.html` and `assets/`. */
    distDir: string;
    /** The data sets and their `manifest.json`, served under `gamefiles/`. */
    gamefilesDir: string;
}

/** The URL prefix of the game files: the page's `GAMEFILES_DIR` (`src/main.ts`). */
const GAMEFILES = 'gamefiles';

const CONTENT_TYPES: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.ico': 'image/x-icon',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain; charset=utf-8',
    '.wav': 'audio/wav',
};

const NO_CACHE = 'no-cache';
const IMMUTABLE = 'public, max-age=31536000, immutable';

/**
 * The game files' manifest, parsed by the page's own parser, with every folder it names
 * present in `gamefilesDir`, and the page's `index.html` in `distDir`. Throws an error
 * that says what is missing, so a bad mount stops the container rather than the player's
 * boot.
 */
export function checkFiles({ distDir, gamefilesDir }: ServerOptions): DataSetManifest {
    if (!isFile(join(distDir, 'index.html'))) throw new Error(`${distDir} holds no index.html: is the page built?`);
    let text: string;
    try {
        text = readFileSync(join(gamefilesDir, MANIFEST_NAME), 'utf8');
    } catch {
        throw new Error(`${gamefilesDir} holds no ${MANIFEST_NAME}`);
    }
    const manifest = parseManifest(text, '');
    const folders = [...manifest.dataSets.map((set) => set.dir), ...(manifest.swooshDir === null ? [] : [manifest.swooshDir])];
    const missing = folders.filter((dir) => !isDirectory(join(gamefilesDir, dir)));
    if (missing.length > 0) throw new Error(`${MANIFEST_NAME} names folders ${gamefilesDir} does not hold: ${missing.join(', ')}`);
    return manifest;
}

/** The server, not yet listening. */
export function createAppServer(options: ServerOptions): Server {
    return createServer((req, res) => {
        try {
            route(options, req, res);
        } catch (error) {
            console.error(`${req.method} ${req.url}:`, error);
            if (!res.headersSent) send(res, 500, 'Internal error');
            else res.destroy();
        }
    });
}

function route({ distDir, gamefilesDir }: ServerOptions, req: IncomingMessage, res: ServerResponse): void {
    const segments = pathSegments(req.url ?? '');
    if (segments === null) return send(res, 400, 'Bad path');

    if (segments[0] === 'api') {
        if (segments.length === 2 && segments[1] === 'health') {
            if (req.method !== 'GET' && req.method !== 'HEAD') return refuseMethod(res);
            res.setHeader('Cache-Control', 'no-store');
            return send(res, 200, '{"ok":true}', 'application/json; charset=utf-8');
        }
        return send(res, 404, 'Not found');
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') return refuseMethod(res);
    if (segments[0] === GAMEFILES) return serveFile(req, res, join(gamefilesDir, ...segments.slice(1)), NO_CACHE);
    if (segments.length === 0) return serveFile(req, res, join(distDir, 'index.html'), NO_CACHE);
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

function refuseMethod(res: ServerResponse): void {
    res.setHeader('Allow', 'GET, HEAD');
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
