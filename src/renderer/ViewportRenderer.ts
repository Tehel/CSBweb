/**
 * First-person viewport renderer
 *
 * Renders the 3D view using ray-casting results
 * Based on CSBWin's column-based renderer
 */

import type { DungeonState } from '../engine/DungeonState';
import type { GraphicsLoader } from '../data/GraphicsLoader';
import type { Palette } from '../core/types';
import type { ViewState, RayColumn, RenderOptions } from './rendererTypes';
import { RayCaster } from './RayCaster';
import {
    VIEWPORT,
    calculateShading,
    DEFAULT_RENDER_OPTIONS,
    directionToAngle,
} from './rendererTypes';

/**
 * ViewportRenderer - renders first-person 3D view
 */
export class ViewportRenderer {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private rayCaster: RayCaster;
    private dungeon: DungeonState;
    private graphics: GraphicsLoader;
    private options: RenderOptions;

    // Off-screen canvas for rendering at native resolution
    private offscreenCanvas: HTMLCanvasElement;
    private offscreenCtx: CanvasRenderingContext2D;

    constructor(
        canvas: HTMLCanvasElement,
        dungeon: DungeonState,
        graphics: GraphicsLoader,
        options: RenderOptions = DEFAULT_RENDER_OPTIONS
    ) {
        this.canvas = canvas;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            throw new Error('Could not get 2D context');
        }
        this.ctx = ctx;

        this.dungeon = dungeon;
        this.graphics = graphics;
        this.options = { ...options };
        this.rayCaster = new RayCaster(dungeon);

        // Create off-screen canvas at native viewport resolution
        this.offscreenCanvas = document.createElement('canvas');
        this.offscreenCanvas.width = VIEWPORT.WIDTH;
        this.offscreenCanvas.height = VIEWPORT.HEIGHT;
        const offscreenCtx = this.offscreenCanvas.getContext('2d');
        if (!offscreenCtx) {
            throw new Error('Could not get off-screen 2D context');
        }
        this.offscreenCtx = offscreenCtx;
    }

    /**
     * Render the viewport
     *
     * @param viewState - Current camera/view state
     */
    render(viewState: ViewState): void {
        // Clear off-screen canvas
        this.offscreenCtx.fillStyle = '#000';
        this.offscreenCtx.fillRect(0, 0, VIEWPORT.WIDTH, VIEWPORT.HEIGHT);

        // Cast all rays
        const rays = this.rayCaster.castAllRays(viewState);

        // Render ceiling and floor first (if enabled)
        if (this.options.drawCeiling) {
            this.renderCeiling();
        }
        if (this.options.drawFloor) {
            this.renderFloor();
        }

        // Render walls column by column
        if (this.options.drawWalls) {
            this.renderWalls(rays, viewState);
        }

        // Scale and draw to main canvas
        this.ctx.imageSmoothingEnabled = false;
        this.ctx.drawImage(
            this.offscreenCanvas,
            0, 0, VIEWPORT.WIDTH, VIEWPORT.HEIGHT,
            0, 0, VIEWPORT.WIDTH * this.options.scale, VIEWPORT.HEIGHT * this.options.scale
        );
    }

    /**
     * Render ceiling (simple solid color for now)
     */
    private renderCeiling(): void {
        this.offscreenCtx.fillStyle = '#1a1a1a'; // Dark gray
        this.offscreenCtx.fillRect(0, 0, VIEWPORT.WIDTH, VIEWPORT.HORIZON_Y);
    }

    /**
     * Render floor (simple solid color for now)
     */
    private renderFloor(): void {
        this.offscreenCtx.fillStyle = '#2a2a2a'; // Slightly lighter gray
        this.offscreenCtx.fillRect(0, VIEWPORT.HORIZON_Y, VIEWPORT.WIDTH, VIEWPORT.HEIGHT - VIEWPORT.HORIZON_Y);
    }

    /**
     * Render walls using ray-casting results
     */
    private renderWalls(rays: RayColumn[], viewState: ViewState): void {
        // Get palette (use palette 0 for now)
        const palette = this.graphics.getPalette(0);

        // Render each column (every 2 pixels wide)
        for (let i = 0; i < rays.length; i++) {
            const ray = rays[i];
            const x = i * 2; // Each column is 2 pixels wide

            if (ray.distance >= VIEWPORT.FAR_PLANE) {
                continue; // Too far to render
            }

            // Calculate shading
            let shading = 1.0;
            if (this.options.enableShading) {
                shading = calculateShading(ray.distance);
            }

            if (this.options.enableTextures) {
                // Render textured wall
                this.renderTexturedWallColumn(ray, x, palette, shading);
            } else {
                // Render solid color wall (fallback)
                const wallColor = this.getWallColor(ray.wallType, ray.wallSide);
                const shadedColor = this.applyShading(wallColor, shading);
                this.offscreenCtx.fillStyle = shadedColor;
                this.offscreenCtx.fillRect(
                    x,
                    ray.wallTop,
                    2, // Column width
                    ray.wallBottom - ray.wallTop + 1
                );
            }
        }
    }

    /**
     * Render a textured wall column
     */
    private renderTexturedWallColumn(
        ray: RayColumn,
        screenX: number,
        palette: Palette,
        shading: number
    ): void {
        // Get wall texture based on room type
        const textureIndex = this.getWallTextureIndex(ray.wallType, ray.wallSide);

        try {
            const texture = this.graphics.getImage(textureIndex);

            // Calculate texture column (0 to texture.width-1)
            const textureX = Math.floor(ray.textureX * texture.width);

            // Calculate wall height in pixels
            const wallHeight = ray.wallBottom - ray.wallTop;

            // Draw vertical stripe from texture
            for (let y = ray.wallTop; y <= ray.wallBottom && y < VIEWPORT.HEIGHT; y++) {
                // Calculate texture Y coordinate
                const textureY = Math.floor(((y - ray.wallTop) / wallHeight) * texture.height);

                // Get pixel from texture
                const pixelIndex = textureY * texture.width + textureX;
                if (pixelIndex >= 0 && pixelIndex < texture.pixels.length) {
                    const colorIndex = texture.pixels[pixelIndex];
                    const color = palette[colorIndex];

                    // Convert Atari ST color to RGB
                    const r = ((color >> 8) & 0x7) * 36;
                    const g = ((color >> 4) & 0x7) * 36;
                    const b = (color & 0x7) * 36;

                    // Apply shading
                    const shadedR = Math.floor(r * shading);
                    const shadedG = Math.floor(g * shading);
                    const shadedB = Math.floor(b * shading);

                    // Draw 2-pixel wide column
                    this.offscreenCtx.fillStyle = `rgb(${shadedR}, ${shadedG}, ${shadedB})`;
                    this.offscreenCtx.fillRect(screenX, y, 2, 1);
                }
            }
        } catch (error) {
            // Fallback to solid color if texture fails
            const wallColor = this.getWallColor(ray.wallType, ray.wallSide);
            const shadedColor = this.applyShading(wallColor, shading);
            this.offscreenCtx.fillStyle = shadedColor;
            this.offscreenCtx.fillRect(
                screenX,
                ray.wallTop,
                2,
                ray.wallBottom - ray.wallTop + 1
            );
        }
    }

    /**
     * Get wall texture index based on room type and side
     *
     * Wall graphics in DM typically start around index 0
     * Different wall types use different texture sets
     */
    private getWallTextureIndex(roomType: number, side: number): number {
        // Base wall texture indices (these are typical DM values)
        // You may need to adjust these based on your specific graphics.dat
        const baseIndices = [
            0,   // STONE (0) - stone walls
            0,   // OPEN (1) - shouldn't be drawn, use stone as fallback
            10,  // (2)
            20,  // STAIRS (3)
            30,  // DOOR (4)
            0,   // PIT (5)
            40,  // TELEPORTER (6)
            0,   // FALSEWALL (7)
        ];

        const baseIndex = baseIndices[roomType] || 0;

        // Add offset for wall side (front, right, back, left)
        // Each wall type typically has 4 variations
        return baseIndex + (side % 4);
    }

    /**
     * Get wall color based on room type and side
     */
    private getWallColor(roomType: number, side: number): string {
        // Different shades for different wall types
        const baseColors = [
            '#666666', // STONE (0)
            '#888888', // OPEN (1) - shouldn't be drawn
            '#8B4513', // (2)
            '#996633', // STAIRS (3)
            '#CC8800', // DOOR (4)
            '#444444', // PIT (5)
            '#5555AA', // TELEPORTER (6)
            '#777777', // FALSEWALL (7)
        ];

        const baseColor = baseColors[roomType] || '#666666';

        // Darken or lighten based on wall side for depth perception
        if (side === 0 || side === 2) {
            // North/South walls slightly darker
            return this.adjustBrightness(baseColor, 0.85);
        } else {
            // East/West walls slightly lighter
            return this.adjustBrightness(baseColor, 1.0);
        }
    }

    /**
     * Apply shading factor to color
     */
    private applyShading(color: string, shading: number): string {
        // Parse hex color
        const hex = color.replace('#', '');
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);

        // Apply shading
        const shadedR = Math.floor(r * shading);
        const shadedG = Math.floor(g * shading);
        const shadedB = Math.floor(b * shading);

        return `rgb(${shadedR}, ${shadedG}, ${shadedB})`;
    }

    /**
     * Adjust brightness of a color
     */
    private adjustBrightness(color: string, factor: number): string {
        const hex = color.replace('#', '');
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);

        const adjustedR = Math.min(255, Math.floor(r * factor));
        const adjustedG = Math.min(255, Math.floor(g * factor));
        const adjustedB = Math.min(255, Math.floor(b * factor));

        return `#${adjustedR.toString(16).padStart(2, '0')}${adjustedG.toString(16).padStart(2, '0')}${adjustedB.toString(16).padStart(2, '0')}`;
    }

    /**
     * Update render options
     */
    setOptions(options: Partial<RenderOptions>): void {
        this.options = { ...this.options, ...options };
    }

    /**
     * Get current render options
     */
    getOptions(): Readonly<RenderOptions> {
        return this.options;
    }

    /**
     * Resize canvas
     */
    resize(width: number, height: number): void {
        this.canvas.width = width;
        this.canvas.height = height;
    }
}
