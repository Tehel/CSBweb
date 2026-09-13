/**
 * The `graphics.dat` image codec — CSBWin's `ExpandGraphic`.
 *
 * IMG1 and IMG2 name the two byte orders the 4-byte header can come in, nothing more.
 */

import type { ui8, ImageDimensions, Palette } from './types';
import { atariToRGBA } from './types';

/**
 * IMG1 and IMG2 differ only in endianness of width/height
 * - IMG1: Big-endian (Atari ST)
 * - IMG2: Little-endian (PC)
 */
export enum ImageFormat {
    IMG1, // Big-endian
    IMG2  // Little-endian
}

/**
 * Decoded image data
 */
export interface DecodedImage extends ImageDimensions {
    pixels: Uint8Array;  // Pixel indices (0-15) into palette
}

/**
 * `ExpandGraphic` — the `graphics.dat` image codec.
 *
 * A transcription of `doc/CSBwin-src/CSBCode.cpp:10836`. The 68000 original writes into
 * Atari planar memory through 16-pixel groups and a running bit mask; this works in chunky
 * bytes, which is the only liberty taken. Every opcode, count and fall-through is the C++'s.
 *
 * This file used to hold a decoder written from the dmweb.free.fr format notes instead, and
 * three of its opcodes disagreed with CSBWin: `0xA` and `0xE` were "transparent pixels" where
 * CSBWin has a plain colour run, and `0xD` threw. Only one real image in either data set
 * exercises any of them — graphic 5, the credits scroll, which uses `0xA` four times — and it
 * came out with the whole picture sliding right from (78,55) on. Items 558..562 use the
 * others, but they are the tables `0x22e`..`0x232`, not images at all.
 *
 * ## The format
 *
 * Four bytes of `width`, `height`, then a byte-oriented opcode stream. Pixels are 4-bit
 * palette indices written left to right, top to bottom, into a buffer whose line pitch is
 * rounded **up to a whole 16-pixel group** — `D7W = ((width+15)>>1) & 0x7ff8` bytes
 * (`CSBCode.cpp:10857`). Every image in `graphics.dat` happens to be a multiple of 16 wide,
 * so the padding never shows; it is here because the "copy the previous line" opcode is
 * defined in terms of that pitch.
 *
 * | first byte | count | emits |
 * | --- | --- | --- |
 * | `0x00`..`0x7F` | `(b >> 4) + 1` | that many pixels of colour `b & 0xf` |
 * | `0x8X`, `0xAX` | next byte, +1 | that many pixels of colour `X` |
 * | `0xCX`, `0xEX` | next **two** bytes, +1 | that many pixels of colour `X` |
 * | `0x9X` | next byte, +1 | that many literal nibbles |
 * | `0xDX` | next two bytes, +1 | that many literal nibbles |
 * | `0xBX` | next byte, +1 | that many pixels copied from the line above, **then one of colour `X`** |
 * | `0xFX` | next two bytes, +1 | the same, with a 16-bit count |
 *
 * Bit `0x40` is "the count is 16-bit" and bits `0x30` pick the mode: `0x00` and `0x20` are
 * both a solid run, `0x10` is the literal stream, `0x30` copies the line above. That is why
 * `0xA` behaves as `0x8` and `0xE` as `0xC` — the `0x20` bit is simply not consulted on that
 * branch (`CSBCode.cpp:10891-10894`).
 *
 * The trailing pixel on `0xB`/`0xF` is a **fall-through**, not a separate opcode: the copy
 * loop at `tag0214e4` runs off its end into `tag0214f2`, which is the same "place one pixel"
 * subroutine the single-pixel opcode uses (`CSBCode.cpp:10917-10924`).
 */
export function decodeIMG(data: Uint8Array, format: ImageFormat = ImageFormat.IMG1): DecodedImage {
    const width = format === ImageFormat.IMG1
        ? (data[0] << 8) | data[1]
        : data[0] | (data[1] << 8);
    const height = format === ImageFormat.IMG1
        ? (data[2] << 8) | data[3]
        : data[2] | (data[3] << 8);

    // `D7W = (I16)(((D7W+15)>>1)&0x7ff8)` bytes per line; two pixels to the byte.
    const stride = ((((width + 15) >> 1) & 0x7ff8)) * 2;
    const total = stride * height;
    const buffer = new Uint8Array(total);

    let off = 4;
    let p = 0;

    const emit = (value: ui8): void => {
        if (p < total) buffer[p++] = value & 0xf;
    };

    while (off < data.length && p < total) {
        const op = data[off++];
        const colour = op & 0xf;

        // `if (D2B < 0) goto tag0214be;` — the short form, its count in the high nibble.
        // A high nibble of 0 takes `tag0214f2`, one pixel, which is `(0 >> 4) + 1`.
        if (op < 0x80) {
            const count = (op >> 4) + 1;
            for (let i = 0; i < count; i++) emit(colour);
            continue;
        }

        // `D1B = *(A0++); if (D3W & 0x40) { D1W <<= 8; D1B = *(A0++); }; D1W += 1;`
        let count = data[off++];
        if (op & 0x40) count = ((count << 8) | data[off++]) & 0xffff;
        count += 1;

        switch (op & 0x30) {
            case 0x10: {
                // `tag021558` — a stream of literal nibbles, high then low. An odd count
                // opens with one pixel of the opcode's own colour so the rest pairs up.
                if (count & 1) emit(colour);
                for (let i = 0; i < (count >> 1); i++) {
                    const pair = data[off++];
                    emit(pair >> 4);
                    emit(pair);
                }
                break;
            }
            case 0x30: {
                // `A2 = A1 - D7W` — the same column one line up, advancing in step. Then
                // the fall-through into `tag0214f2`.
                for (let i = 0; i < count && p < total; i++, p++) {
                    buffer[p] = p >= stride ? buffer[p - stride] : 0;
                }
                emit(colour);
                break;
            }
            default: {
                // `tag021482` — a solid run. Both 0x00 and 0x20 land here.
                for (let i = 0; i < count; i++) emit(colour);
            }
        }
    }

    // A stream that stops short leaves the rest at colour 0. CSBWin has no such guard — it
    // runs until the destination is full and reads off the end of the source if it has to —
    // and graphic 5 is four pixels short of 320x200, so the real game shows four pixels of
    // whatever followed the buffer in the heap. They are the bottom-right corner of a border.
    const pixels = stride === width
        ? buffer
        : (() => {
            const cropped = new Uint8Array(width * height);
            for (let y = 0; y < height; y++) {
                cropped.set(buffer.subarray(y * stride, y * stride + width), y * width);
            }
            return cropped;
        })();

    return { width, height, pixels };
}

/**
 * Convert decoded image to RGBA ImageData for canvas
 */
export function imageToRGBA(image: DecodedImage, palette: Palette): ImageData {
    const rgba = new Uint8ClampedArray(image.width * image.height * 4);

    for (let i = 0; i < image.pixels.length; i++) {
        const colorIndex = image.pixels[i];
        const color = atariToRGBA(palette[colorIndex]);

        rgba[i * 4 + 0] = color.r;
        rgba[i * 4 + 1] = color.g;
        rgba[i * 4 + 2] = color.b;
        rgba[i * 4 + 3] = color.a;
    }

    return new ImageData(rgba, image.width, image.height);
}

/**
 * Draw decoded image to canvas
 */
export function drawImageToCanvas(
    ctx: CanvasRenderingContext2D,
    image: DecodedImage,
    palette: Palette,
    x: number = 0,
    y: number = 0,
    scale: number = 1
): void {
    const imageData = imageToRGBA(image, palette);

    if (scale === 1) {
        ctx.putImageData(imageData, x, y);
    } else {
        // Create temporary canvas for scaling
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = image.width;
        tempCanvas.height = image.height;
        const tempCtx = tempCanvas.getContext('2d')!;
        tempCtx.putImageData(imageData, 0, 0);

        // Disable smoothing for pixel-perfect scaling
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(
            tempCanvas,
            0, 0, image.width, image.height,
            x, y, image.width * scale, image.height * scale
        );
    }
}
