import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'path';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { DATA_SETS_ROUTE } from './src/data/DataSets';

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
 * The dev server's `api/data-sets` (`src/data/DataSets.ts`): the repository's manifest,
 * `tools/data-sets.json`, read at each request, every set in it offered to every player.
 * The deployed server answers the same route its own way (`server/app.ts`).
 */
function dataSetsRoute(): Plugin {
  const file = resolve(import.meta.dirname, 'tools', 'data-sets.json');
  return {
    name: 'csbweb-data-sets',
    configureServer(server) {
      server.middlewares.use(`/${DATA_SETS_ROUTE}`, (req, res, next) => {
        if (req.url !== '/' && !req.url?.startsWith('/?')) return next();
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.statusCode = 405;
          res.setHeader('Allow', 'GET, HEAD');
          return res.end();
        }
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(req.method === 'HEAD' ? undefined : readFileSync(file, 'utf8'));
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
