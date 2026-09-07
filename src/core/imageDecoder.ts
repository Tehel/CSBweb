/**
 * IMG1/IMG2 image format decoder
 *
 * IMG1/IMG2 are RLE-compressed 16-color images.
 *
 * Reference: CSBWin Bitmaps.cpp, dmweb.free.fr documentation
 */

import type { ui8, ui16, ImageDimensions, Palette } from './types';
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
    pixels: ui8[];  // Pixel indices (0-15) into palette
}

/**
 * Decode IMG1/IMG2 format image
 *
 * Format:
 * - 2 bytes: width (big/little endian depending on format)
 * - 2 bytes: height
 * - N bytes: RLE-compressed nibble data
 *
 * RLE Algorithm (reference: CSBWin Bitmaps.cpp):
 * Each block starts with 2 nibbles: [nib1][nib2]
 *
 * nib1 determines action:
 * 0x0-0x7: Add (nib1+1) pixels of color nib2
 * 0x8:     Read byte, add (byte+1) pixels of color nib2
 * 0x9:     Read byte, add pixels (mixed mode)
 * 0xA:     Add (nib2+1) transparent pixels
 * 0xB:     Read byte, copy (byte+1) pixels from previous line, then 1× nib2
 * 0xC:     Read word, add (word+1) pixels of color nib2
 * 0xD:     Unused
 * 0xE:     Transparent pixels (extended)
 * 0xF:     Read word, copy (word+1) pixels from previous line, then 1× nib2
 */
export function decodeIMG(data: Uint8Array, format: ImageFormat = ImageFormat.IMG1): DecodedImage {
    let offset = 0;

    // Read dimensions
    let width: ui16, height: ui16;
    if (format === ImageFormat.IMG1) {
        // Big-endian
        width = (data[0] << 8) | data[1];
        height = (data[2] << 8) | data[3];
    } else {
        // Little-endian
        width = data[0] | (data[1] << 8);
        height = data[2] | (data[3] << 8);
    }
    offset = 4;

    const pixels: ui8[] = [];
    const totalPixels = width * height;

    /**
     * Helper: Read next byte
     */
    function readByte(): ui8 {
        return data[offset++];
    }

    /**
     * Helper: Read next word (big-endian)
     */
    function readWord(): ui16 {
        const hi = data[offset++];
        const lo = data[offset++];
        return (hi << 8) | lo;
    }

    /**
     * Helper: Copy pixels from previous line
     * Previous line starts at (currentPos - width)
     */
    function copyFromPreviousLine(count: ui16): void {
        const startPos = pixels.length - width;
        if (startPos < 0) {
            // No previous line, fill with transparent/black
            for (let i = 0; i < count; i++) {
                pixels.push(0);
            }
        } else {
            for (let i = 0; i < count; i++) {
                pixels.push(pixels[startPos + i]);
            }
        }
    }

    /**
     * Helper: Add pixels of given color
     */
    function addPixels(count: ui16, color: ui8): void {
        for (let i = 0; i < count; i++) {
            pixels.push(color & 0xF); // Ensure 4-bit value
        }
    }

    // Decode RLE stream
    while (offset < data.length && pixels.length < totalPixels) {
        const nib1 = data[offset] >> 4;
        const nib2 = data[offset] & 0xF;
        offset++;

        if ((nib1 & 0x8) === 0) {
            // 0x0-0x7: Simple repeat (nib1+1) times color nib2
            addPixels(nib1 + 1, nib2);
        } else {
            switch (nib1) {
                case 0x8: {
                    // Read byte, add (byte+1) pixels of color nib2
                    const count = readByte() + 1;
                    addPixels(count, nib2);
                    break;
                }

                case 0x9: {
                    // Mixed mode: read byte for count
                    const byte1 = readByte();
                    if ((byte1 & 1) === 0) {
                        // Even: 1 pixel of nib2, then byte1 raw nibbles
                        addPixels(1, nib2);
                        for (let i = 0; i < byte1; i++) {
                            const nibble = (i & 1) === 0
                                ? data[offset] >> 4
                                : data[offset++] & 0xF;
                            pixels.push(nibble);
                        }
                        if ((byte1 & 1) !== 0) offset++; // Skip last nibble if odd count
                    } else {
                        // Odd: nib2 ignored, (byte1+1) raw nibbles
                        for (let i = 0; i < byte1 + 1; i++) {
                            const nibble = (i & 1) === 0
                                ? data[offset] >> 4
                                : data[offset++] & 0xF;
                            pixels.push(nibble);
                        }
                        if (((byte1 + 1) & 1) !== 0) offset++; // Skip last nibble if odd count
                    }
                    break;
                }

                case 0xA: {
                    // Transparent pixels: (nib2+1) count
                    // For non-animation images, treat as color 0
                    addPixels(nib2 + 1, 0);
                    break;
                }

                case 0xB: {
                    // Copy (byte+1) pixels from previous line, then 1× nib2
                    const count = readByte() + 1;
                    copyFromPreviousLine(count);
                    addPixels(1, nib2);
                    break;
                }

                case 0xC: {
                    // Read word, add (word+1) pixels of color nib2
                    const count = readWord() + 1;
                    addPixels(count, nib2);
                    break;
                }

                case 0xD: {
                    // Unused in documentation
                    throw new Error(`Unsupported IMG opcode: 0xD at offset ${offset - 1}`);
                }

                case 0xE: {
                    // Extended transparent pixels (for animations)
                    // Sub-modes based on nib2
                    if (nib2 <= 0xC) {
                        // 0-C: (nib2+17) transparent pixels
                        addPixels(nib2 + 17, 0);
                    } else if (nib2 === 0xD) {
                        // Read byte: (byte+1) transparent
                        const count = readByte() + 1;
                        addPixels(count, 0);
                    } else if (nib2 === 0xE) {
                        // Read byte: (byte+257) transparent
                        const count = readByte() + 257;
                        addPixels(count, 0);
                    } else if (nib2 === 0xF) {
                        // Read word: (word+1) transparent
                        const count = readWord() + 1;
                        addPixels(count, 0);
                    }
                    break;
                }

                case 0xF: {
                    // Read word, copy (word+1) pixels from previous line, then 1× nib2
                    const count = readWord() + 1;
                    copyFromPreviousLine(count);
                    addPixels(1, nib2);
                    break;
                }
            }
        }
    }

    // Verify we got the right number of pixels
    if (pixels.length < totalPixels) {
        // Pad with zeros if short (some images are slightly truncated)
        while (pixels.length < totalPixels) {
            pixels.push(0);
        }
    } else if (pixels.length > totalPixels) {
        // Truncate if too many
        pixels.length = totalPixels;
    }

    return {
        width,
        height,
        pixels
    };
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
