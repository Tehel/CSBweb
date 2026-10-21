/**
 * A data set's thumbnail shown in place of the title animation, where its author checked
 * "As the title" (`DataSet.thumbnailAsTitle`). CSBWin has no such picture: it always plays
 * `_DisplayChaosStrikesBack` (`TitleSequence.ts`). The thumbnail is a full-colour
 * 320x200 image (`THUMBNAIL_WIDTH`, `src/data/DataSets.ts`); the screen is sixteen colour
 * registers of the Atari's 512, so the boot shows it reduced to sixteen of them
 * (`reduceTitlePicture`), faded in and out as CSBWin's screens fade (`showTitlePicture`).
 * `doc/CSBWIN_TITLE_SCREEN_REFERENCE.md` → "A thumbnail in place of the animation".
 */
import { SCREEN_HEIGHT, SCREEN_WIDTH } from '../ViewportGraphics';
import { fadeToPalette, PALETTE_11914, type IntroHost } from './IntroHost';
import type { TitleFrame } from './TitleThumbnail';

/** The colour registers: the most colours the picture keeps. */
export const TITLE_PICTURE_COLOURS = 16;

/** How long the picture stays up between its fades, in VBLs: 1.5 s, the author's choice. */
export const TITLE_PICTURE_HOLD_VBLS = 90;

/** An 8-bit component as the canvas shows a register's (`atariToRGB`): its level times 36. */
const LEVEL_STEP = 36;

/** A box of the median cut: indices into the image's distinct colours. */
type Box = number[];

/**
 * `rgba`, a `SCREEN_WIDTH`x`SCREEN_HEIGHT` image four bytes a pixel, as a screen of
 * `TITLE_PICTURE_COLOURS` registers: median cut over its colours, each box's mean the
 * nearest Atari shade, and each pixel the register nearest its colour, without dithering.
 * A pixel short of opaque is taken over black, the screen behind it. Everything here is
 * integer or exactly ordered, so an image gives the same screen on every machine.
 */
export function reduceTitlePicture(rgba: ArrayLike<number>, width: number, height: number): TitleFrame {
    if (width !== SCREEN_WIDTH || height !== SCREEN_HEIGHT || rgba.length !== width * height * 4) {
        throw new Error(`A title picture is ${SCREEN_WIDTH}x${SCREEN_HEIGHT}, not ${width}x${height}`);
    }
    // The distinct colours, `0xRRGGBB`, in the order the pixels first show them, and how
    // many pixels each one has.
    const indexOf = new Map<number, number>();
    const colours: number[] = [];
    const counts: number[] = [];
    const colourOfPixel = new Uint32Array(width * height);
    for (let p = 0; p < width * height; p++) {
        const alpha = rgba[p * 4 + 3]!;
        const over = (component: number): number => Math.round((rgba[p * 4 + component]! * alpha) / 255);
        const colour = (over(0) << 16) | (over(1) << 8) | over(2);
        let index = indexOf.get(colour);
        if (index === undefined) {
            index = colours.length;
            indexOf.set(colour, index);
            colours.push(colour);
            counts.push(0);
        }
        counts[index]!++;
        colourOfPixel[p] = index;
    }
    const component = (colour: number, channel: number): number => (colour >> (16 - channel * 8)) & 0xff;

    // The widest channel of a box, and its width.
    const widest = (box: Box): { channel: number; range: number } => {
        let best = { channel: 0, range: -1 };
        for (let channel = 0; channel < 3; channel++) {
            let min = 255, max = 0;
            for (const i of box) {
                const value = component(colours[i]!, channel);
                if (value < min) min = value;
                if (value > max) max = value;
            }
            if (max - min > best.range) best = { channel, range: max - min };
        }
        return best;
    };

    const boxes: Box[] = [colours.map((_, i) => i)];
    while (boxes.length < TITLE_PICTURE_COLOURS) {
        // The box whose widest channel is widest, the first of equals.
        let chosen = -1, channel = 0, range = 0;
        boxes.forEach((box, b) => {
            if (box.length < 2) return;
            const w = widest(box);
            if (w.range > range) {
                chosen = b;
                channel = w.channel;
                range = w.range;
            }
        });
        if (chosen < 0) break;
        // Cut it at its pixels' median along that channel, each half keeping a colour.
        const box = boxes[chosen]!.sort((a, b) => component(colours[a]!, channel) - component(colours[b]!, channel) || colours[a]! - colours[b]!);
        const total = box.reduce((sum, i) => sum + counts[i]!, 0);
        let cut = 1;
        for (let below = counts[box[0]!]!; cut < box.length - 1 && below * 2 < total; cut++) below += counts[box[cut]!]!;
        boxes.splice(chosen, 1, box.slice(0, cut), box.slice(cut));
    }

    // Each box's register: its pixels' mean colour, each component the nearest level.
    const registers = boxes.map((box) => {
        const total = box.reduce((sum, i) => sum + counts[i]!, 0);
        let register = 0;
        for (let channel = 0; channel < 3; channel++) {
            const sum = box.reduce((s, i) => s + component(colours[i]!, channel) * counts[i]!, 0);
            register |= Math.min(7, Math.round(sum / total / LEVEL_STEP)) << (8 - channel * 4);
        }
        return register;
    });

    // Each colour's register: the nearest as the canvas shows it, the first of equals.
    const registerOf = colours.map((colour) => {
        let best = 0, bestDistance = Infinity;
        registers.forEach((register, r) => {
            let distance = 0;
            for (let channel = 0; channel < 3; channel++) {
                const d = component(colour, channel) - ((register >> (8 - channel * 4)) & 0x7) * LEVEL_STEP;
                distance += d * d;
            }
            if (distance < bestDistance) {
                best = r;
                bestDistance = distance;
            }
        });
        return best;
    });

    const pixels = new Uint8Array(width * height);
    for (let p = 0; p < pixels.length; p++) pixels[p] = registerOf[colourOfPixel[p]!]!;
    while (registers.length < TITLE_PICTURE_COLOURS) registers.push(0);
    return { pixels, registers };
}

/**
 * Show `picture` in the title's place: the screen darkened as the animation's first fade
 * darkens it, the picture put up under black registers and faded in over `_FadeToPalette`'s
 * eight VBLs (`doc/CSBwin-src/Graphics.cpp:1625`), held `TITLE_PICTURE_HOLD_VBLS`, and faded
 * out to black, the screen then cleared, as the FTL logo leaves it (`Swoosh.ts`).
 */
export async function showTitlePicture(
    host: Pick<IntroHost, 'screen' | 'globalPalette' | 'present' | 'vbl'>,
    picture: TitleFrame,
): Promise<void> {
    await fadeToPalette(host, PALETTE_11914);
    host.screen.pixels.set(picture.pixels);
    await fadeToPalette(host, picture.registers);
    await host.vbl(TITLE_PICTURE_HOLD_VBLS);
    await fadeToPalette(host, PALETTE_11914);
    host.screen.pixels.fill(0);
}
