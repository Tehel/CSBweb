/// <reference types="vite/client" />

/** The build's id, from `vite.config.mts`: the commit, or `DMWEB_BUILD`. */
declare const __DMWEB_BUILD__: string;

/**
 * Whether the page hands `window.__probe` to the CDP probes (`tools/probe-frames.mjs`):
 * always on the dev server, and in a build only when `DMWEB_PROBE=1`, the image the
 * golden frames check (`vite.config.mts`). A deployed build has no handle.
 */
declare const __DMWEB_PROBE__: boolean;
