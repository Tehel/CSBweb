/**
 * Graphics blitting functions
 *
 * Handles blitting pre-rendered bitmaps to the viewport canvas
 * Based on CSBWin's BltShapeToViewport and related functions
 */

import type { GraphicsLoader } from '../data/GraphicsLoader';
import type { Palette } from '../core/types';
import type { ScreenRect } from './cellTypes';

/**
 * GraphicsBlit - Handles bitmap blitting to viewport
 */
export class GraphicsBlit {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private graphics: GraphicsLoader;
    private palette: Palette;

    // Image data buffer for the entire viewport
    private imageData: ImageData;
    private pixels: Uint8ClampedArray;

    constructor(canvas: HTMLCanvasElement, graphics: GraphicsLoader, paletteIndex: number = 0) {
        this.canvas = canvas;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            throw new Error('Could not get 2D context');
        }
        this.ctx = ctx;
        this.graphics = graphics;
        this.palette = graphics.getPalette(paletteIndex);

        // Create image data buffer
        this.imageData = ctx.createImageData(canvas.width, canvas.height);
        this.pixels = this.imageData.data;
    }

    /**
     * Clear the viewport to black
     */
    clear(): void {
        this.pixels.fill(0);
        this.pixels.fill(255, 3, this.pixels.length); // Set alpha to 255
    }

    /**
     * Flush the pixel buffer to the canvas
     */
    flush(): void {
        this.ctx.putImageData(this.imageData, 0, 0);
    }

    /**
     * Blit a graphic to the viewport at the specified screen rectangle
     *
     * @param graphicIndex - Index of graphic in graphics.dat
     * @param rect - Screen rectangle where to blit (with optional source clipping)
     * @param transparent - Whether to treat color 0 as transparent
     */
    blitGraphic(graphicIndex: number, rect: ScreenRect, transparent: boolean = true): void {
        try {
            const image = this.graphics.getImage(graphicIndex);

            // Determine source rectangle (for sprite sheet clipping)
            const srcX = rect.srcX ?? 0;
            const srcY = rect.srcY ?? 0;
            const srcWidth = rect.srcWidth ?? image.width;
            const srcHeight = rect.srcHeight ?? image.height;

            // Calculate scaling
            const scaleX = rect.width / srcWidth;
            const scaleY = rect.height / srcHeight;

            for (let dy = 0; dy < rect.height; dy++) {
                for (let dx = 0; dx < rect.width; dx++) {
                    // Calculate source pixel coordinates within the source rectangle
                    const srcPixelX = srcX + Math.floor(dx / scaleX);
                    const srcPixelY = srcY + Math.floor(dy / scaleY);

                    // Bounds check on source image
                    if (srcPixelX < 0 || srcPixelX >= image.width ||
                        srcPixelY < 0 || srcPixelY >= image.height) {
                        continue;
                    }

                    // Get pixel from source image
                    const srcIndex = srcPixelY * image.width + srcPixelX;
                    const colorIndex = image.pixels[srcIndex];

                    // Skip transparent pixels (color 0)
                    if (transparent && colorIndex === 0) {
                        continue;
                    }

                    // Get RGB color from palette
                    const color = this.palette[colorIndex];
                    const r = ((color >> 8) & 0x7) * 36;
                    const g = ((color >> 4) & 0x7) * 36;
                    const b = (color & 0x7) * 36;

                    // Calculate destination pixel
                    const dstX = rect.x + dx;
                    const dstY = rect.y + dy;

                    // Bounds check on destination
                    if (dstX < 0 || dstX >= this.canvas.width ||
                        dstY < 0 || dstY >= this.canvas.height) {
                        continue;
                    }

                    // Write to pixel buffer
                    const dstIndex = (dstY * this.canvas.width + dstX) * 4;
                    this.pixels[dstIndex + 0] = r;
                    this.pixels[dstIndex + 1] = g;
                    this.pixels[dstIndex + 2] = b;
                    this.pixels[dstIndex + 3] = 255;
                }
            }
        } catch (error) {
            console.warn(`Failed to blit graphic ${graphicIndex}:`, error);
        }
    }

    /**
     * Blit a graphic mirrored horizontally
     *
     * @param graphicIndex - Index of graphic in graphics.dat
     * @param rect - Screen rectangle where to blit
     * @param transparent - Whether to treat color 0 as transparent
     */
    blitGraphicMirrored(graphicIndex: number, rect: ScreenRect, transparent: boolean = true): void {
        try {
            const image = this.graphics.getImage(graphicIndex);

            const scaleX = rect.width / image.width;
            const scaleY = rect.height / image.height;

            for (let sy = 0; sy < rect.height; sy++) {
                for (let sx = 0; sx < rect.width; sx++) {
                    // Mirror X coordinate
                    const srcX = Math.floor((rect.width - 1 - sx) / scaleX);
                    const srcY = Math.floor(sy / scaleY);

                    if (srcX >= image.width || srcY >= image.height) {
                        continue;
                    }

                    const srcIndex = srcY * image.width + srcX;
                    const colorIndex = image.pixels[srcIndex];

                    if (transparent && colorIndex === 0) {
                        continue;
                    }

                    const color = this.palette[colorIndex];
                    const r = ((color >> 8) & 0x7) * 36;
                    const g = ((color >> 4) & 0x7) * 36;
                    const b = (color & 0x7) * 36;

                    const dstX = rect.x + sx;
                    const dstY = rect.y + sy;

                    if (dstX < 0 || dstX >= this.canvas.width || dstY < 0 || dstY >= this.canvas.height) {
                        continue;
                    }

                    const dstIndex = (dstY * this.canvas.width + dstX) * 4;
                    this.pixels[dstIndex + 0] = r;
                    this.pixels[dstIndex + 1] = g;
                    this.pixels[dstIndex + 2] = b;
                    this.pixels[dstIndex + 3] = 255;
                }
            }
        } catch (error) {
            console.warn(`Failed to blit mirrored graphic ${graphicIndex}:`, error);
        }
    }

    /**
     * Fill a rectangle with a solid color
     *
     * @param rect - Screen rectangle to fill
     * @param r - Red component (0-255)
     * @param g - Green component (0-255)
     * @param b - Blue component (0-255)
     */
    fillRect(rect: ScreenRect, r: number, g: number, b: number): void {
        for (let y = 0; y < rect.height; y++) {
            for (let x = 0; x < rect.width; x++) {
                const dstX = rect.x + x;
                const dstY = rect.y + y;

                if (dstX < 0 || dstX >= this.canvas.width || dstY < 0 || dstY >= this.canvas.height) {
                    continue;
                }

                const dstIndex = (dstY * this.canvas.width + dstX) * 4;
                this.pixels[dstIndex + 0] = r;
                this.pixels[dstIndex + 1] = g;
                this.pixels[dstIndex + 2] = b;
                this.pixels[dstIndex + 3] = 255;
            }
        }
    }

    /**
     * Fill the entire viewport with a solid color
     *
     * @param r - Red component (0-255)
     * @param g - Green component (0-255)
     * @param b - Blue component (0-255)
     */
    fillViewport(r: number, g: number, b: number): void {
        for (let i = 0; i < this.pixels.length; i += 4) {
            this.pixels[i + 0] = r;
            this.pixels[i + 1] = g;
            this.pixels[i + 2] = b;
            this.pixels[i + 3] = 255;
        }
    }

    /**
     * Change the active palette
     *
     * @param paletteIndex - Index of palette to use
     */
    setPalette(paletteIndex: number): void {
        this.palette = this.graphics.getPalette(paletteIndex);
    }
}
