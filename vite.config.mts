import { defineConfig } from 'vite';
import { resolve } from 'path';
import { execSync } from 'node:child_process';

/**
 * The build the page's events name (`src/ui/gameEvents.ts`): `DMWEB_BUILD` where the
 * build is given one (the image's build stage has no `.git`), or the checkout's commit.
 */
function buildId(): string {
  if (process.env.DMWEB_BUILD) return process.env.DMWEB_BUILD;
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'unknown';
  }
}

export default defineConfig(({ command }) => ({
  root: '.',
  // Every URL relative to the page, so the game also runs under a sub-path.
  base: './',
  // The dev server serves `static/` as it stands: the game files and the manuals. A build
  // ships none of it. The page's own files are modules under `src/assets/`, which the
  // build hashes, and the game files are served beside the page (PLAN.md Phase 17).
  publicDir: command === 'serve' ? 'static' : false,
  define: {
    __DMWEB_BUILD__: JSON.stringify(buildId()),
    // The CDP probes' handle (`src/main.ts`): the dev server's, and a build's only when
    // asked for, so that the golden frames can check a built page. A deployed one has none.
    __DMWEB_PROBE__: JSON.stringify(command === 'serve' || process.env.DMWEB_PROBE === '1'),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html')
      }
    }
  },
  server: {
    port: 9000,
    open: false
  }
}));
