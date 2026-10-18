import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'path';
import { execSync } from 'node:child_process';
import { createReadStream, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DatabaseSync } from 'node:sqlite';

import { contentType, dataSetViewer, pathSegments, receiveDocument, receiveEdit, receiveModeration, receivePublish } from './server/app';
import { DataSetStore, manifestText, parseModerators, wallsText } from './server/dataSets';
import { RateLimit } from './server/events';
import { NOBODY } from './server/notify';
import type { CheckDataSet } from './server/publish';
import { DATA_SET_WALLS_ROUTE, DATA_SETS_ROUTE, DOCUMENTS_SEGMENT, PLAYER_ID_HEADER, parseManifest } from './src/data/DataSets';

/**
 * The build the page's events name (`src/ui/gameEvents.ts`): `CSBWEB_BUILD` where the
 * build is given one (the image's build stage has no `.git`), or the checkout's commit.
 */
function buildId(): string {
  if (process.env.CSBWEB_BUILD) return process.env.CSBWEB_BUILD;
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'unknown';
  }
}

/**
 * The dev server's one moderator, so that the welcome page's tick, cross and eye can be
 * tried: whoever's `localStorage` keeps this as their `playerId` (`src/ui/gameEvents.ts`).
 * `tools/probe-frames.mjs` is that player, and `tools/check-image.sh` gives the image the
 * same id in `MODERATOR_PLAYER_IDS`.
 */
const DEV_MODERATOR_PLAYER_ID = '00000000-0000-4000-8000-000000000001';

/**
 * The dev server's `api/data-sets` (`src/data/DataSets.ts`), answered as the deployed
 * server answers it (`server/app.ts`), with `DEV_MODERATOR_PLAYER_ID` its moderator, over
 * a store made at each request: the repository's manifest, `tools/data-sets.json`, read
 * then, its sets the site's, and every change made since the dev server started, the sets
 * published and moderated, made again in their order. A GET gets `manifestText` for the
 * player it names, a POST `receivePublish` with the page's own check, the source's
 * (`ssrLoadModule`), and a POST to `api/data-sets/<id>` `receiveModeration`, or
 * `receiveEdit` for a form, and to `api/data-sets/<id>/documents` `receiveDocument`.
 * `api/data-set-walls` answers `wallsText` over the same store: the published sets'.
 *
 * A published set is written into a scratch folder, made at start and removed at the end,
 * which holds a link to each entry of `static/gamefiles/`, so that a base set's
 * `graphics.dat` and every folder name are where `publishDataSet` looks; its files are
 * served from there under `gamefiles/<id>/`, and an edited set's under its new folder's
 * name. An edit, and a document added or removed, copies a site's folder through its link,
 * and deletes the link, never `static/gamefiles/`. The store is `node:sqlite`'s, in memory:
 * on a Node without it, a GET answers the manifest and a POST 501.
 */
function dataSetsRoute(): Plugin {
  const file = resolve(import.meta.dirname, 'tools', 'data-sets.json');
  const gamefiles = resolve(import.meta.dirname, 'static', 'gamefiles');
  return {
    name: 'csbweb-data-sets',
    async configureServer(server) {
      const sqlite = await import('node:sqlite').catch(() => null);
      const scratch = mkdtempSync(join(tmpdir(), 'csbweb-published-'));
      for (const entry of readdirSync(gamefiles)) symlinkSync(join(gamefiles, entry), join(scratch, entry));
      server.httpServer?.once('close', () => rmSync(scratch, { recursive: true, force: true }));
      const changes: ((store: DataSetStore) => void)[] = [];
      const published = new Set<string>();
      const moderators = parseModerators(`${DEV_MODERATOR_PLAYER_ID}=the dev moderator`);
      const publishRateLimit = new RateLimit(1000, 60_000);
      const checkDataSet: CheckDataSet = async (...args) =>
        ((await server.ssrLoadModule('/src/data/LocalDataSets.ts')) as { checkLocalDataSet: CheckDataSet }).checkLocalDataSet(...args);

      /** The store as it stands: the manifest's sets, then every change made since, a new one kept. */
      const openStore = (db: DatabaseSync): DataSetStore => {
        const store = new DataSetStore(db);
        store.fill(parseManifest(readFileSync(file, 'utf8'), ''));
        for (const change of changes) change(store);
        const keep = (change: (store: DataSetStore) => void) => {
          change(store);
          changes.push(change);
        };
        const { publish, approve, setHidden, remove, edit, addDocument, removeDocument } = DataSetStore.prototype;
        store.publish = (set, owner) => {
          keep((kept) => publish.call(kept, set, owner));
          published.add(set.id);
        };
        store.edit = (id, set) => {
          keep((kept) => edit.call(kept, id, set));
          published.add(set.dir);
        };
        store.addDocument = (id, dir, document) => {
          keep((kept) => addDocument.call(kept, id, dir, document));
          published.add(dir);
        };
        store.removeDocument = (id, dir, document) => {
          keep((kept) => removeDocument.call(kept, id, dir, document));
          published.add(dir);
        };
        store.approve = (id) => keep((kept) => approve.call(kept, id));
        store.setHidden = (id, hidden) => keep((kept) => setHidden.call(kept, id, hidden));
        store.remove = (id) => keep((kept) => remove.call(kept, id));
        return store;
      };

      server.middlewares.use(`/${DATA_SETS_ROUTE}`, async (req, res, next) => {
        const id = pathSegments(req.url ?? '');
        if (id?.length === 1) return moderate(id[0]!, req, res, next);
        if (id?.length === 2 && id[1] === DOCUMENTS_SEGMENT) return moderate(id[0]!, req, res, next, true);
        if (req.url !== '/' && !req.url?.startsWith('/?')) return next();
        const json = (status: number, body: string) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.end(req.method === 'HEAD' ? undefined : body);
        };
        if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'POST') {
          res.statusCode = 405;
          res.setHeader('Allow', 'GET, HEAD, POST');
          return res.end();
        }
        if (!sqlite) {
          if (req.method === 'POST') return json(501, JSON.stringify({ error: 'The dev server publishes on a Node with node:sqlite.' }));
          return json(200, readFileSync(file, 'utf8'));
        }
        const db = new sqlite.DatabaseSync(':memory:');
        try {
          const dataSets = openStore(db);
          if (req.method === 'POST') {
            await receivePublish(scratch, { checkDataSet, dataSets, moderators, publishRateLimit, now: Date.now, notify: NOBODY }, req, res);
          } else {
            res.setHeader('Vary', PLAYER_ID_HEADER);
            json(200, manifestText(dataSets.read(), dataSetViewer({ moderators }, req)));
          }
        } catch (error) {
          next(error);
        } finally {
          db.close();
        }
      });

      /** `POST api/data-sets/<id>`: the set `id` moderated, or edited, or its `documents` changed, as `server/app.ts` does it. */
      const moderate = async (id: string, req: IncomingMessage, res: ServerResponse, next: (error?: unknown) => void, documents = false) => {
        if (req.method !== 'POST' || !sqlite) {
          res.statusCode = req.method !== 'POST' ? 405 : 501;
          if (req.method !== 'POST') res.setHeader('Allow', 'POST');
          return res.end();
        }
        const db = new sqlite.DatabaseSync(':memory:');
        try {
          const api = { checkDataSet, dataSets: openStore(db), moderators, now: Date.now, notify: NOBODY };
          if (documents) await receiveDocument(id, scratch, api, req, res);
          else if (req.headers['content-type']?.startsWith('multipart/form-data')) await receiveEdit(id, scratch, api, req, res);
          else await receiveModeration(id, scratch, api, req, res);
        } catch (error) {
          next(error);
        } finally {
          db.close();
        }
      };

      server.middlewares.use(`/${DATA_SET_WALLS_ROUTE}`, (req, res, next) => {
        if (req.url !== '/' && !req.url?.startsWith('/?')) return next();
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.statusCode = 405;
          res.setHeader('Allow', 'GET, HEAD');
          return res.end();
        }
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Vary', PLAYER_ID_HEADER);
        if (!sqlite) return res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ dataSets: [] }));
        const db = new sqlite.DatabaseSync(':memory:');
        try {
          const dataSets = openStore(db);
          res.end(req.method === 'HEAD' ? undefined : wallsText(dataSets.read(), dataSets.walls(), dataSetViewer({ moderators }, req)));
        } catch (error) {
          next(error);
        } finally {
          db.close();
        }
      });

      // A published set's files, from the scratch folder.
      server.middlewares.use('/gamefiles', (req, res, next) => {
        const segments = pathSegments(req.url ?? '');
        if (!segments || !published.has(segments[0]!) || (req.method !== 'GET' && req.method !== 'HEAD')) return next();
        const path = join(scratch, ...segments);
        if (!statSync(path, { throwIfNoEntry: false })?.isFile()) return next();
        res.setHeader('Content-Type', contentType(path));
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cache-Control', 'no-cache');
        if (req.method === 'HEAD') return res.end();
        createReadStream(path).pipe(res);
      });
    },
  };
}

/**
 * The web app manifest that makes the game installable (`src/assets/manifest.webmanifest`),
 * named by `index.html` and served beside it as `manifest.webmanifest`, under a name that
 * does not change, as a browser keeps an installed app's manifest URL. Its `start_url` and
 * `scope`, `./`, are the page's folder, so it also installs under a sub-path. Its icons
 * are named in the source as files beside it, and become the dev server's `src/assets/…`,
 * or a build's hashed assets, emitted here, as Vite emits none of what a manifest names.
 */
function webAppManifest(): Plugin {
  const SOURCE = resolve(import.meta.dirname, 'src', 'assets', 'manifest.webmanifest');
  const FILE_NAME = 'manifest.webmanifest';
  type Manifest = { icons: { src: string }[] };
  /** The source, its icons' `src` each `iconSrc`'s. */
  const manifestText = (iconSrc: (name: string) => string): string => {
    const manifest = JSON.parse(readFileSync(SOURCE, 'utf8')) as Manifest;
    for (const icon of manifest.icons) icon.src = iconSrc(icon.src);
    return JSON.stringify(manifest, null, 2);
  };
  return {
    name: 'csbweb-web-app-manifest',
    transformIndexHtml: () => [{ tag: 'link', attrs: { rel: 'manifest', href: `./${FILE_NAME}` }, injectTo: 'head' }],
    configureServer(server) {
      server.middlewares.use(`/${FILE_NAME}`, (req, res, next) => {
        if (req.url !== '/' && !req.url?.startsWith('/?')) return next();
        res.setHeader('Content-Type', 'application/manifest+json');
        res.setHeader('Cache-Control', 'no-cache');
        res.end(manifestText((name) => `src/assets/${name}`));
      });
    },
    generateBundle() {
      const source = manifestText((name) => this.getFileName(this.emitFile({
        type: 'asset', name, source: readFileSync(resolve(dirname(SOURCE), name)),
      })));
      this.emitFile({ type: 'asset', fileName: FILE_NAME, source });
    },
  };
}

/**
 * The server's build of the page's check of a player's own set (`checkLocalDataSet`): `vite
 * build --ssr`, after the page's, one self-contained module that the server, which has no
 * `node_modules`, loads from `dist/server/` (`server/app.ts`, `CHECK_MODULE`).
 */
const SERVER_ENTRY = resolve(import.meta.dirname, 'src', 'data', 'LocalDataSets.ts');

export default defineConfig(({ command, isSsrBuild }) => ({
  // The server's module is no page, and has no manifest.
  plugins: [dataSetsRoute(), ...(isSsrBuild ? [] : [webAppManifest()])],
  root: '.',
  // Every URL relative to the page, so the game also runs under a sub-path.
  base: './',
  // The dev server serves `static/` as it stands: the game files and the manuals. A build
  // ships none of it. The page's own files are modules under `src/assets/`, which the
  // build hashes, and the game files are served beside the page (`doc/DEPLOYMENT.md`).
  publicDir: command === 'serve' ? 'static' : false,
  define: {
    __CSBWEB_BUILD__: JSON.stringify(buildId()),
    // The CDP probes' handle (`src/main.ts`): the dev server's, and a build's only when
    // asked for, so that the golden frames can check a built page. A deployed one has none.
    __CSBWEB_PROBE__: JSON.stringify(command === 'serve' || process.env.CSBWEB_PROBE === '1'),
  },
  build: {
    outDir: isSsrBuild ? 'dist/server' : 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: isSsrBuild ? SERVER_ENTRY : {
        main: resolve(import.meta.dirname, 'index.html')
      }
    }
  },
  server: {
    port: 9000,
    open: false
  }
}));
