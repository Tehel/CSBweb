/**
 * A data set's thumbnail, the welcome page's picture of it (`src/ui/welcomePage.ts`): the
 * last frame of its title. `tools/gen-thumbnails.ts` writes the site's sets' into their
 * folders; the form that adds a player's own set draws one from its graphics
 * (`src/ui/addDataSetForm.ts`, "Generate from data").
 *
 * The frame is `displayChaosStrikesBack` (`TitleSequence.ts`) played to its end on a host
 * whose blanks take no time, from the set's own `graphics.dat`, and the screen it leaves
 * seen through the colour registers it leaves. So it is the boot's title as the player
 * sees it at its last hold: the logo and "Master" on red, for DM's data, or whatever
 * another set's item 1 holds, through the same registers.
 *
 * The PNG is the whole 320x200 screen, paletted, its sixteen entries the sixteen registers
 * as the canvas shows them (an Atari intensity times 36, `atariToRGB`), so pixel `n` is
 * register `n`. The page shows it at half size, 160x100, where a screen of two device
 * pixels to the CSS pixel shows every one of its pixels.
 */
import { atariToRGB } from '../../core/types';
import { encodeIndexedPng } from '../../core/png';
import type { GraphicsLoader } from '../../data/GraphicsLoader';
import { extractGraphicsTables } from '../../data/tables/GraphicsTables';
import { createPaletteIndexViewportBuffer, type IndexedBitmap } from '../csbwin/CanvasBlitter';
import { loadFontData } from '../csbwin/TextRenderer';
import { SCREEN_HEIGHT, SCREEN_WIDTH, getCachedGraphicBitmap } from '../ViewportGraphics';
import { PALETTE_11914, type IntroHost } from './IntroHost';
import { displayChaosStrikesBack } from './TitleSequence';

export interface TitleFrame {
    /** The 320x200 screen, a register's number to a pixel. */
    pixels: Uint8Array;
    /** The sixteen colour registers, Atari `0RGB`. */
    registers: number[];
}

/** The title's last frame, played from `graphics`. Throws where an item it draws does not decode. */
export async function lastTitleFrame(graphics: GraphicsLoader): Promise<TitleFrame> {
    const uiTables = extractGraphicsTables(graphics).ui;
    const cache = new Map<string, IndexedBitmap>();
    const unused = (): never => { throw new Error('the title asked for what only the entrance uses'); };
    const host: IntroHost = {
        screen: createPaletteIndexViewportBuffer(SCREEN_WIDTH, SCREEN_HEIGHT, 0),
        uiTables,
        font: loadFontData(graphics),
        // The boot's first registers (`createIntroHost`, `BootSequence.ts`). The title's first
        // fade sets all sixteen, so the last frame does not depend on them.
        globalPalette: [...(uiTables.graphic232.palette552[0] ?? PALETTE_11914)],
        getGraphic(graphicNum: number): IndexedBitmap {
            const bitmap = getCachedGraphicBitmap(graphics, cache, graphicNum);
            if (!bitmap) throw new Error(`graphics.dat item ${graphicNum} did not decode`);
            return bitmap;
        },
        present: () => {},
        vbl: () => Promise.resolve(),
        startSound: () => {},
        drawPrisonInterior: unused,
        nextEvent: unused,
        takeClick: unused,
        discardAllInput: unused,
        mouseSwitches: unused,
        keyWaiting: unused,
        setCursorVisible: unused,
    };
    await displayChaosStrikesBack(host);
    return { pixels: host.screen.pixels, registers: host.globalPalette.slice(0, 16) };
}

/** The PNG's palette: each register's `[r, g, b]` as the canvas shows it. */
export function thumbnailPalette(registers: readonly number[]): number[][] {
    return registers.map((register) => {
        const { r, g, b } = atariToRGB(register);
        return [r, g, b];
    });
}

/** `frame` as the thumbnail's PNG. */
export function thumbnailPng(frame: TitleFrame): Promise<Uint8Array<ArrayBuffer>> {
    return encodeIndexedPng(SCREEN_WIDTH, SCREEN_HEIGHT, frame.pixels, thumbnailPalette(frame.registers));
}
