/**
 * Graphics.dat loader
 *
 * Complete parser for Dungeon Master graphics files
 * Reference: CSBWin Graphics.cpp; doc/GRAPHICS_MAPPINGS.md
 */

import { BinaryFile, Endianness } from '../core/BinaryFile';
import { decompressGraphics } from '../core/compression';
import { decodeIMG, ImageFormat, type DecodedImage } from '../core/imageDecoder';
import type { ui16 } from '../core/types';
import { Signature, type FileSignature } from './FileSignature';

/**
 * Cached graphic entry
 */
interface GraphicEntry {
    index: ui16;
    compressedSize: ui16;
    decompressedSize: ui16;
    rawData?: Uint8Array;      // Decompressed raw data
}

/**
 * Graphics.dat data
 */
interface GraphicsData {
    itemCount: ui16;
    entries: GraphicEntry[];
}

/** The most items the loader takes a file's first word to count. */
export const MAX_GRAPHICS_ITEMS = 1000;

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
    /**
     * `graphicSignature1/2`, the file's `Signature`, which CSBWin takes at its first
     * `openGraphicsFile`, before the title (`src/engine/FileSignatures.ts`).
     */
    private fileSignature: FileSignature | null = null;

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
        // Read header
        this.file.seek(0);
        const itemCount = this.file.readU16();

        if (itemCount === 0 || itemCount > MAX_GRAPHICS_ITEMS) {
            throw new Error(`Invalid graphics file: item count = ${itemCount}`);
        }
        this.fileSignature = Signature(this.file.read(0, this.file.length()));

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
                compressedSize: compressedSizes[i]!,
                decompressedSize: decompressedSizes[i]!
            });
        }

        this.data = {
            itemCount,
            entries
        };

        return this.data;
    }

    // Get raw data for a graphic (decompressed but not decoded)
    getRawGraphic(index: ui16): Uint8Array {
        if (!this.data) throw new Error('Graphics not loaded');
        if (index >= this.data.itemCount) throw new Error(`Invalid graphic index: ${index}`);

        const entry = this.data.entries[index]!;

        // Return cached if available
        if (entry.rawData) return entry.rawData;

        // Calculate offset
        const dataStartOffset = 2 + this.data.itemCount * 2 * 2;
        let offset = dataStartOffset;
        for (let i = 0; i < index; i++) {
            offset += this.data.entries[i]!.compressedSize;
        }

        // Read compressed data
        const compressedData = this.file.read(offset, entry.compressedSize);

        // Decompress if needed
        const rawData = decompressGraphics(compressedData, entry.compressedSize, entry.decompressedSize);

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
        let image = this.imageCache.get(index)
        if (!image) {
            image = decodeIMG(this.getRawGraphic(index), format);
            this.imageCache.set(index, image);
        }
        return image;
    }

    /**
     * Get number of graphics in file
     */
    getItemCount(): ui16 {
        return this.data?.itemCount || 0;
    }

    /** The file's signature (`fileSignature`). */
    getSignature(): FileSignature {
        if (!this.fileSignature) throw new Error('Graphics not loaded');
        return this.fileSignature;
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

}
