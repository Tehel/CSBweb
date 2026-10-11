/**
 * Fullscreen: `#game` (index.html) taken whole through the Fullscreen API, the game canvas
 * and the CRT effect's canvas with it, at the largest whole multiple of 320x200 that fits,
 * centred on black.
 *
 * The two canvases share `#game`'s one grid cell and the `.screen` class, whose size is
 * `#game`'s `--screen-width` and `--screen-height`: set here in fullscreen, and absent, the
 * page's 960x600, out of it. So the effect's canvas covers the game canvas at any size, and
 * the pointer, read from the game canvas's rect (`canvasPoint`, `src/lib/crt.ts`), lands
 * on what is shown. The multiple is counted in device pixels, so every pixel of the screen
 * is as many of the display's as every other, under `image-rendering: pixelated`.
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

interface KeyboardLock {
    lock?: (codes: string[]) => Promise<void>;
    unlock?: () => void;
}

function keyboardLock(): KeyboardLock | undefined {
    return (navigator as { keyboard?: KeyboardLock }).keyboard;
}

/**
 * `host` in fullscreen on `toggle`, `screen` sized in it, and `onChange` told at every
 * change, as the browser makes it.
 */
export function createFullscreen(host: HTMLElement, screen: HTMLCanvasElement, onChange: () => void): Fullscreen {
    if (!document.fullscreenEnabled) return NO_FULLSCREEN;
    const isOn = (): boolean => document.fullscreenElement === host;

    const fit = (): void => {
        if (!isOn()) {
            host.style.removeProperty('--screen-width');
            host.style.removeProperty('--screen-height');
            return;
        }
        const ratio = devicePixelRatio;
        const scale = Math.max(1, Math.min(
            Math.floor(host.clientWidth * ratio / screen.width),
            Math.floor(host.clientHeight * ratio / screen.height)));
        host.style.setProperty('--screen-width', `${screen.width * scale / ratio}px`);
        host.style.setProperty('--screen-height', `${screen.height * scale / ratio}px`);
    };

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
