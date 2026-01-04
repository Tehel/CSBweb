/**
 * Graphics.dat loader
 *
 * Complete parser for Dungeon Master graphics files
 * Based on static/js/graphics.js and CSBWin Graphics.cpp
 * Reference: doc/notes.txt (IMG1/IMG2 format)
 */

import { BinaryFile, Endianness } from '../core/BinaryFile';
import { decompressGraphics } from '../core/compression';
import { decodeIMG, ImageFormat, type DecodedImage } from '../core/imageDecoder';
import type { ui8, ui16, Palette } from '../core/types';
import { DEFAULT_PALETTE } from '../core/constants';

/**
 * Cached graphic entry
 */
interface GraphicEntry {
    index: ui16;
    compressedSize: ui16;
    decompressedSize: ui16;
    rawData?: Uint8Array;      // Decompressed raw data
    image?: DecodedImage;       // Decoded image (pixels)
}

/**
 * Graphics.dat data
 */
export interface GraphicsData {
    itemCount: ui16;
    entries: GraphicEntry[];
    palettes: Palette[];        // Extracted from palette graphic
}

/**
 * Graphics.dat loader
 *
 * Loads and decodes graphics from graphics.dat file.
 * Implements caching to avoid re-decompressing images.
 */
export class GraphicsLoader {
    private file: BinaryFile;
    private data: GraphicsData | null = null;
    private imageCache: Map<ui16, DecodedImage>;

    constructor() {
        this.file = new BinaryFile(Endianness.BIG_ENDIAN); // Atari ST format
        this.imageCache = new Map();
    }

    /**
     * Load graphics from URL
     */
    async load(url: string): Promise<GraphicsData> {
        await this.file.load(url);
        return this.parse();
    }

    /**
     * Load graphics from Uint8Array
     */
    loadFromArray(data: Uint8Array): GraphicsData {
        this.file.loadFromArray(data);
        return this.parse();
    }

    /**
     * Main parsing function
     */
    private parse(): GraphicsData {
        console.log('Parsing graphics.dat...');

        // Read header
        this.file.seek(0);
        const itemCount = this.file.readU16();

        if (itemCount === 0 || itemCount > 1000) {
            throw new Error(`Invalid graphics file: item count = ${itemCount}`);
        }

        console.log(`Graphics file contains ${itemCount} items`);

        // Read compressed sizes (itemCount words)
        const compressedSizes: ui16[] = [];
        for (let i = 0; i < itemCount; i++) {
            compressedSizes.push(this.file.readU16());
        }

        // Read decompressed sizes (itemCount words)
        const decompressedSizes: ui16[] = [];
        for (let i = 0; i < itemCount; i++) {
            decompressedSizes.push(this.file.readU16());
        }

        // Build entry table
        const entries: GraphicEntry[] = [];
        for (let i = 0; i < itemCount; i++) {
            entries.push({
                index: i,
                compressedSize: compressedSizes[i],
                decompressedSize: decompressedSizes[i]
            });
        }

        // Calculate offsets (data starts after header + 2 size arrays)
        const dataStartOffset = 2 + itemCount * 2 * 2;
        console.log(`Graphics data starts at offset 0x${dataStartOffset.toString(16)}`);

        this.data = {
            itemCount,
            entries,
            palettes: []
        };

        // Extract palettes (typically at index 562 in DM)
        try {
            this.extractPalettes();
            console.log(`Extracted ${this.data.palettes.length} palettes`);
        } catch (error) {
            console.warn('Could not extract palettes:', error);
            // Use default palette
            this.data.palettes = [DEFAULT_PALETTE];
        }

        return this.data;
    }

    /**
     * Get raw data for a graphic (decompressed but not decoded)
     */
    getRawGraphic(index: ui16): Uint8Array {
        if (!this.data) {
            throw new Error('Graphics not loaded');
        }

        if (index >= this.data.itemCount) {
            throw new Error(`Invalid graphic index: ${index}`);
        }

        const entry = this.data.entries[index];

        // Return cached if available
        if (entry.rawData) {
            return entry.rawData;
        }

        // Calculate offset
        const dataStartOffset = 2 + this.data.itemCount * 2 * 2;
        let offset = dataStartOffset;
        for (let i = 0; i < index; i++) {
            offset += this.data.entries[i].compressedSize;
        }

        // Read compressed data
        this.file.seek(offset);
        const compressedData = this.file.read(entry.compressedSize);

        // Decompress if needed
        const rawData = decompressGraphics(
            compressedData,
            entry.compressedSize,
            entry.decompressedSize
        );

        // Cache it
        entry.rawData = rawData;

        return rawData;
    }

    /**
     * Get decoded image for a graphic
     *
     * @param index - Graphic index
     * @param format - Image format (IMG1 or IMG2), defaults to IMG1
     */
    getImage(index: ui16, format: ImageFormat = ImageFormat.IMG1): DecodedImage {
        // Check cache first
        if (this.imageCache.has(index)) {
            return this.imageCache.get(index)!;
        }

        // Get raw data and decode
        const rawData = this.getRawGraphic(index);
        const image = decodeIMG(rawData, format);

        // Cache the decoded image
        this.imageCache.set(index, image);

        return image;
    }

    /**
     * Extract palettes from graphics file
     *
     * In Dungeon Master, palettes are stored at index 562.
     * The file contains 8 palettes of 16 colors each (256 bytes total).
     * Palette data starts at offset 0x4FE in the raw graphic data.
     */
    private extractPalettes(): void {
        if (!this.data) {
            throw new Error('Graphics not loaded');
        }

        // Try to get palette graphic (index 562 in DM)
        const paletteIndex = 562;
        if (paletteIndex >= this.data.itemCount) {
            throw new Error('Palette graphic not found');
        }

        const rawData = this.getRawGraphic(paletteIndex);

        // Palettes are at offset 0x4FE (1278 bytes) in the raw data
        const paletteOffset = 0x4FE;
        if (rawData.length < paletteOffset + 256) {
            throw new Error('Palette data not found in graphic');
        }

        const palettes: Palette[] = [];

        // Read 8 palettes
        for (let p = 0; p < 8; p++) {
            const palette: ui16[] = [];
            const baseOffset = paletteOffset + p * 32; // 16 colors × 2 bytes

            for (let c = 0; c < 16; c++) {
                const offset = baseOffset + c * 2;
                const color = (rawData[offset] << 8) | rawData[offset + 1];
                palette.push(color);
            }

            palettes.push(palette);
        }

        this.data.palettes = palettes;
    }

    /**
     * Get a palette by index (0-7)
     */
    getPalette(index: number): Palette {
        if (!this.data) {
            throw new Error('Graphics not loaded');
        }

        if (index < 0 || index >= this.data.palettes.length) {
            // Return default palette if index out of range
            return DEFAULT_PALETTE;
        }

        return this.data.palettes[index];
    }

    /**
     * Get number of graphics in file
     */
    getItemCount(): ui16 {
        return this.data?.itemCount || 0;
    }

    /**
     * Check if graphics are loaded
     */
    isLoaded(): boolean {
        return this.data !== null;
    }

    /**
     * Get loaded graphics data
     */
    getData(): GraphicsData | null {
        return this.data;
    }

    /**
     * Clear image cache to free memory
     */
    clearCache(): void {
        this.imageCache.clear();
        if (this.data) {
            for (const entry of this.data.entries) {
                delete entry.rawData;
                delete entry.image;
            }
        }
    }

    /**
     * Get cache statistics
     */
    getCacheStats(): { cachedImages: number; cachedRaw: number } {
        let cachedRaw = 0;
        if (this.data) {
            for (const entry of this.data.entries) {
                if (entry.rawData) cachedRaw++;
            }
        }

        return {
            cachedImages: this.imageCache.size,
            cachedRaw
        };
    }
}

/**
 * Helper: Create ImageData for canvas rendering
 */
export function createImageData(
    image: DecodedImage,
    palette: Palette
): ImageData {
    const rgba = new Uint8ClampedArray(image.width * image.height * 4);

    for (let i = 0; i < image.pixels.length; i++) {
        const colorIndex = image.pixels[i];
        const color = palette[colorIndex];

        // Convert Atari ST color (0RGB, 4 bits per channel) to RGBA
        const r = ((color >> 8) & 0x7) * 36;
        const g = ((color >> 4) & 0x7) * 36;
        const b = (color & 0x7) * 36;

        rgba[i * 4 + 0] = r;
        rgba[i * 4 + 1] = g;
        rgba[i * 4 + 2] = b;
        rgba[i * 4 + 3] = 255; // Opaque
    }

    return new ImageData(rgba, image.width, image.height);
}

/**
 * Helper: Draw image to canvas with optional scaling
 */
export function drawImage(
    ctx: CanvasRenderingContext2D,
    image: DecodedImage,
    palette: Palette,
    x: number,
    y: number,
    scale: number = 1
): void {
    const imageData = createImageData(image, palette);

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
