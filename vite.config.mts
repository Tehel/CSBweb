import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: '.',
  // Every URL relative to the page, so the game also runs under a sub-path.
  base: './',
  publicDir: 'static',
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
});
