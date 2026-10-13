import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'path';
import { execSync } from 'node:child_process';
import { createReadStream, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { dataSetViewer, pathSegments, receivePublish } from './server/app';
import { DataSetStore, manifestText, type PublishedDataSet } from './server/dataSets';
import { RateLimit } from './server/events';
import type { CheckDataSet } from './server/publish';
import { DATA_SETS_ROUTE, PLAYER_ID_HEADER, parseManifest } from './src/data/DataSets';

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
 * The dev server's `api/data-sets` (`src/data/DataSets.ts`), answered as the deployed
 * server answers it (`server/app.ts`), over a store made at each request: the repository's
 * manifest, `tools/data-sets.json`, read then, its sets the site's, and the sets published
 * since the dev server started. A GET gets `manifestText` for the player it names, a POST
 * `receivePublish` with the page's own check, the source's (`ssrLoadModule`).
 *
 * A published set is written into a scratch folder, made at start and removed at the end,
 * which holds a link to each entry of `static/gamefiles/`, so that a base set's
 * `graphics.dat` and every folder name are where `publishDataSet` looks; its files are
 * served from there under `gamefiles/<id>/`. The store is `node:sqlite`'s, in memory:
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
      const published: [PublishedDataSet, string][] = [];
      const publishRateLimit = new RateLimit(1000, 60_000);
      const checkDataSet: CheckDataSet = async (...args) =>
        ((await server.ssrLoadModule('/src/data/LocalDataSets.ts')) as { checkLocalDataSet: CheckDataSet }).checkLocalDataSet(...args);

      /** The store as it stands: the manifest's sets, then the published ones, a new one kept. */
      const openStore = (db: DatabaseSync): DataSetStore => {
        const store = new DataSetStore(db);
        store.fill(parseManifest(readFileSync(file, 'utf8'), ''));
        for (const [set, owner] of published) store.publish(set, owner);
        const publish = store.publish.bind(store);
        store.publish = (set, owner) => {
          publish(set, owner);
          published.push([set, owner]);
        };
        return store;
      };

      server.middlewares.use(`/${DATA_SETS_ROUTE}`, async (req, res, next) => {
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
            await receivePublish(scratch, { checkDataSet, dataSets, publishRateLimit, now: Date.now }, req, res);
          } else {
            res.setHeader('Vary', PLAYER_ID_HEADER);
            json(200, manifestText(dataSets.read(), dataSetViewer({ moderatorPlayerIds: [] }, req)));
          }
        } catch (error) {
          next(error);
        } finally {
          db.close();
        }
      });

      // A published set's files, from the scratch folder.
      server.middlewares.use('/gamefiles', (req, res, next) => {
        const segments = pathSegments(req.url ?? '');
        if (!segments || !published.some(([set]) => set.id === segments[0]) || (req.method !== 'GET' && req.method !== 'HEAD')) return next();
        const path = join(scratch, ...segments);
        if (!statSync(path, { throwIfNoEntry: false })?.isFile()) return next();
        res.setHeader('Content-Type', path.endsWith('.png') ? 'image/png' : 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-cache');
        if (req.method === 'HEAD') return res.end();
        createReadStream(path).pipe(res);
      });
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
  plugins: [dataSetsRoute()],
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
