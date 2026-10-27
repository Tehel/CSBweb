/// <reference types="vite/client" />

/** The build's id, from `vite.config.mts`: the commit, or `CSBWEB_BUILD`. */
declare const __CSBWEB_BUILD__: string;

/**
 * Whether the page hands `window.__probe` to the CDP probes (`tools/probe-frames.ts`):
 * always on the dev server, and in a build only when `CSBWEB_PROBE=1`, the image the
 * golden frames check (`vite.config.mts`). A deployed build has no handle.
 */
declare const __CSBWEB_PROBE__: boolean;
