/**
 * Fullscreen: `#game` (index.html) taken whole through the Fullscreen API, the game canvas
 * and the CRT effect's canvas with it, at the largest whole multiple of 320x200 that fits,
 * centred on black. And the screen's shape, in fullscreen and out of it: DISPLAY's ASPECT
 * RATIO.
 *
 * The two canvases share `#game`'s one grid cell and the `.screen` class, whose size is
 * `#game`'s `--screen-width` and `--screen-height`, set here: out of fullscreen, three
 * screen pixels to one, 960x600, the page's own until they are set. So the effect's canvas
 * covers the game canvas at any size, and the pointer, read from the game canvas's rect
 * (`canvasPoint`, `src/lib/crt.ts`), lands on what is shown. The multiple is counted in
 * device pixels, so every pixel of the screen is as many of the display's as every other,
 * under `image-rendering: pixelated`.
 *
 * The screen is 320x200 whatever its shape. At 16:10 its pixels are square; at 4:3 it is
 * shown 320x240, as a monitor of the ST's showed it, each line 6/5 of a pixel's width
 * tall: 960x720, and in fullscreen the largest whole multiple of 320x240. Its lines are
 * then not all as many of the display's rows as every other, but for a multiple of five.
 *
 * Esc leaves a browser's fullscreen, and the page does not see the key. Where the browser
 * has the Keyboard Lock API (Chromium's), Esc is locked while in fullscreen: it reaches
 * the page, which opens the settings with it, and Esc held down leaves. Elsewhere Esc
 * leaves, and a double click on the message area opens the settings (`GameInput`).
 *
 * The request needs the player's gesture. A mouse's press is one, and the settings
 * dialog takes its clicks at the press; a finger's press is not, only its lift, so where
 * the browser says the page has no gesture yet the request waits for the lift.
 */

import type { AspectRatio } from '../settings/Settings';

export interface Fullscreen {
    /** Whether the browser can put the page's element in fullscreen. */
    isAvailable: () => boolean;
    /** Whether the game is in fullscreen now. */
    isOn: () => boolean;
    /** Into fullscreen, or out of it: done when the browser says, or not at all. */
    toggle: () => void;
    /** Whether Esc reaches the page in fullscreen: the browser can lock the key. */
    keepsEscape: () => boolean;
}

export const NO_FULLSCREEN: Fullscreen = {
    isAvailable: () => false,
    isOn: () => false,
    toggle: () => {},
    keepsEscape: () => false,
};

/** The page's fullscreen, and the screen's shape, which the page sets from the settings. */
export interface PageFullscreen extends Fullscreen {
    /** The screen shown at `aspect`, in fullscreen or out of it. */
    setAspect: (aspect: AspectRatio) => void;
}

/** Out of fullscreen, screen pixels to one of the screen's, across. */
const WINDOW_SCALE = 3;

/** The screen's height for its width, at each shape. */
const HEIGHT_PER_WIDTH: Record<AspectRatio, number> = { '16:10': 10 / 16, '4:3': 3 / 4 };

interface KeyboardLock {
    lock?: (codes: string[]) => Promise<void>;
    unlock?: () => void;
}

function keyboardLock(): KeyboardLock | undefined {
    return (navigator as { keyboard?: KeyboardLock }).keyboard;
}

/**
 * `host` in fullscreen on `toggle`, `screen` sized in it and out of it, and `onChange`
 * told at every change, as the browser makes it.
 */
export function createFullscreen(host: HTMLElement, screen: HTMLCanvasElement, onChange: () => void): PageFullscreen {
    const enabled = document.fullscreenEnabled;
    const isOn = (): boolean => enabled && document.fullscreenElement === host;
    let heightPerWidth = HEIGHT_PER_WIDTH['16:10'];

    const fit = (): void => {
        const width = screen.width;
        const height = width * heightPerWidth;
        let scale = WINDOW_SCALE;
        let ratio = 1;
        if (isOn()) {
            ratio = devicePixelRatio;
            scale = Math.max(1, Math.min(
                Math.floor(host.clientWidth * ratio / width),
                Math.floor(host.clientHeight * ratio / height)));
        }
        host.style.setProperty('--screen-width', `${width * scale / ratio}px`);
        host.style.setProperty('--screen-height', `${height * scale / ratio}px`);
    };
    const setAspect = (aspect: AspectRatio): void => {
        heightPerWidth = HEIGHT_PER_WIDTH[aspect];
        fit();
    };
    if (!enabled) return { ...NO_FULLSCREEN, setAspect };

    document.addEventListener('fullscreenchange', () => {
        fit();
        const keyboard = keyboardLock();
        if (isOn()) keyboard?.lock?.(['Escape']).catch(() => {});
        else keyboard?.unlock?.();
        onChange();
    });
    window.addEventListener('resize', fit);

    const enter = (): void => {
        host.requestFullscreen().catch(() => {});
    };

    return {
        setAspect,
        isAvailable: () => true,
        isOn,
        toggle: () => {
            if (isOn()) {
                document.exitFullscreen().catch(() => {});
                return;
            }
            const activation = (navigator as { userActivation?: { isActive: boolean } }).userActivation;
            if (activation && !activation.isActive) window.addEventListener('pointerup', enter, { once: true });
            else enter();
        },
        keepsEscape: () => typeof keyboardLock()?.lock === 'function',
    };
}
