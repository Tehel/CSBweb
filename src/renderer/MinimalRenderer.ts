/**
 * Minimal Cell-Based Renderer
 *
 * Based ONLY on proven facts extracted from CSBWin source code.
 * See doc/PROVEN_FACTS.md for verification.
 */

import type { DungeonState } from '../engine/DungeonState';
import type { GraphicsLoader } from '../data/GraphicsLoader';
import type { Direction, Position } from '../core/types';

/**
 * Proven graphics indices from CSBWin CSBCode.cpp line 2884
 * firstWallGraphic = 77, wall bitmaps = 77+7 = 84-89
 */
const WALL_GRAPHICS = {
    pWallBitmaps: [84, 85, 86, 87, 88, 89, 90], // indices 0-6
};

/**
 * Proven cell-to-bitmap mapping from Viewport.cpp lines 2267-2279
 */
const CELL_BITMAP_MAP: { [key: string]: number } = {
    'F0L1': 1,  // pWallBitmaps[1] = graphic 85
    'F0R1': 0,  // pWallBitmaps[0] = graphic 84
    'F0':   2,  // pWallBitmaps[2] = graphic 86
    'F1L1': 2,  // pWallBitmaps[2] = graphic 86
    'F1':   2,  // pWallBitmaps[2] = graphic 86
    'F1R1': 2,  // pWallBitmaps[2] = graphic 86
    'F2L1': 3,  // pWallBitmaps[3] = graphic 87
    'F2':   3,  // pWallBitmaps[3] = graphic 87
    'F2R1': 3,  // pWallBitmaps[3] = graphic 87
    'F3L2': 5,  // pWallBitmaps[5] = graphic 89
    'F3L1': 4,  // pWallBitmaps[4] = graphic 88
    'F3':   4,  // pWallBitmaps[4] = graphic 88
    'F3R1': 4,  // pWallBitmaps[4] = graphic 88
    'F3R2': 6,  // pWallBitmaps[6] = graphic 90
};

/**
 * Proven cell relative positions from Viewport.cpp lines 347-355
 */
interface CellDef {
    id: string;
    relX: number;  // -2 to +2
    relY: number;  // 0 to 4 (distance)
}

const CELLS: CellDef[] = [
    // Distance 0 (at party)
    { id: 'F0L1', relX: -1, relY: 0 },
    { id: 'F0',   relX:  0, relY: 0 },
    { id: 'F0R1', relX: +1, relY: 0 },
    // Distance 1
    { id: 'F1L1', relX: -1, relY: 1 },
    { id: 'F1',   relX:  0, relY: 1 },
    { id: 'F1R1', relX: +1, relY: 1 },
    // Distance 2
    { id: 'F2L1', relX: -1, relY: 2 },
    { id: 'F2',   relX:  0, relY: 2 },
    { id: 'F2R1', relX: +1, relY: 2 },
    // Distance 3
    { id: 'F3L2', relX: -2, relY: 3 },
    { id: 'F3L1', relX: -1, relY: 3 },
    { id: 'F3',   relX:  0, relY: 3 },
    { id: 'F3R1', relX: +1, relY: 3 },
    { id: 'F3R2', relX: +2, relY: 3 },
];

/**
 * TEMPORARY: Estimated rectangles based on working F0L1/F0R1
 * TODO: Extract actual values from CSBWin
 */
const ESTIMATED_RECTS: { [key: string]: { x: number, y: number, w: number, h: number } } = {
    // PROVEN: These work correctly
    'F0L1': { x: 0,   y: 0, w: 32, h: 136 },
    'F0R1': { x: 192, y: 0, w: 32, h: 136 },
    // ESTIMATED: Based on perspective
    'F0':   { x: 32,  y: 0, w: 160, h: 136 },
    'F1L1': { x: 0,   y: 12, w: 48, h: 112 },
    'F1':   { x: 48,  y: 12, w: 128, h: 112 },
    'F1R1': { x: 176, y: 12, w: 48, h: 112 },
    'F2L1': { x: 32,  y: 32, w: 48, h: 72 },
    'F2':   { x: 40,  y: 32, w: 144, h: 72 },
    'F2R1': { x: 144, y: 32, w: 48, h: 72 },
    'F3L2': { x: 48,  y: 42, w: 16, h: 48 },
    'F3L1': { x: 64,  y: 42, w: 48, h: 52 },
    'F3':   { x: 48,  y: 42, w: 128, h: 52 },
    'F3R1': { x: 112, y: 42, w: 48, h: 52 },
    'F3R2': { x: 160, y: 42, w: 80, h: 48 },
};

export class MinimalRenderer {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private dungeon: DungeonState;
    private graphics: GraphicsLoader;
    private imageData: ImageData;
    private pixels: Uint8ClampedArray;
    private palette: Uint16[];

    constructor(
        canvas: HTMLCanvasElement,
        dungeon: DungeonState,
        graphics: GraphicsLoader
    ) {
        this.canvas = canvas;
        this.canvas.width = 224;
        this.canvas.height = 136;

        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('No 2D context');
        this.ctx = ctx;

        this.dungeon = dungeon;
        this.graphics = graphics;
        this.palette = graphics.getPalette(0);

        this.imageData = ctx.createImageData(224, 136);
        this.pixels = this.imageData.data;
    }

    render(position: Position, facing: Direction, mapIndex: number): void {
        // Clear to black
        this.pixels.fill(0);
        for (let i = 3; i < this.pixels.length; i += 4) {
            this.pixels[i] = 255; // Alpha
        }

        // Render cells from far to near (proven order from Viewport.cpp line 6694)
        for (let distance = 3; distance >= 0; distance--) {
            const cellsAtDistance = CELLS.filter(c => c.relY === distance);
            for (const cell of cellsAtDistance) {
                this.renderCell(cell, position, facing, mapIndex);
            }
        }

        // Flush to canvas
        this.ctx.putImageData(this.imageData, 0, 0);
    }

    private renderCell(cell: CellDef, partyPos: Position, facing: Direction, mapIndex: number): void {
        // Calculate absolute dungeon position (proven transform)
        const absPos = this.getAbsolutePosition(partyPos, facing, cell.relX, cell.relY);

        // Get tile
        const tile = this.dungeon.getTile(mapIndex, absPos.x, absPos.y);
        if (!tile) return;

        // Only render stone walls (roomType 0) for now
        if (tile.roomType !== 0) return;

        // Get proven bitmap index
        const bitmapIdx = CELL_BITMAP_MAP[cell.id];
        if (bitmapIdx === undefined) return;

        const graphicIdx = WALL_GRAPHICS.pWallBitmaps[bitmapIdx];

        // Get estimated rectangle (TODO: extract actual)
        const rect = ESTIMATED_RECTS[cell.id];
        if (!rect) return;

        // Blit graphic
        this.blitGraphic(graphicIdx, rect.x, rect.y, rect.w, rect.h);
    }

    private getAbsolutePosition(
        party: Position,
        facing: Direction,
        relX: number,
        relY: number
    ): Position {
        let dx = 0, dy = 0;

        // Transform based on facing (proven from CSBWin)
        switch (facing) {
            case 0: // North (-Y)
                dx = relX;
                dy = -relY;
                break;
            case 1: // East (+X)
                dx = relY;
                dy = relX;
                break;
            case 2: // South (+Y)
                dx = -relX;
                dy = relY;
                break;
            case 3: // West (-X)
                dx = -relY;
                dy = -relX;
                break;
        }

        return { x: party.x + dx, y: party.y + dy };
    }

    private blitGraphic(
        graphicIdx: number,
        x: number,
        y: number,
        w: number,
        h: number
    ): void {
        try {
            const image = this.graphics.getImage(graphicIdx);

            // Simple scaling blit (no source rect for now)
            const scaleX = w / image.width;
            const scaleY = h / image.height;

            for (let dy = 0; dy < h; dy++) {
                for (let dx = 0; dx < w; dx++) {
                    const srcX = Math.floor(dx / scaleX);
                    const srcY = Math.floor(dy / scaleY);

                    if (srcX >= image.width || srcY >= image.height) continue;

                    const srcIdx = srcY * image.width + srcX;
                    const colorIdx = image.pixels[srcIdx];

                    // Skip transparent (proven from BltShapeToViewport line 2947)
                    if (colorIdx === 10) continue;

                    const color = this.palette[colorIdx];
                    const r = ((color >> 8) & 0x7) * 36;
                    const g = ((color >> 4) & 0x7) * 36;
                    const b = (color & 0x7) * 36;

                    const dstX = x + dx;
                    const dstY = y + dy;
                    if (dstX < 0 || dstX >= 224 || dstY < 0 || dstY >= 136) continue;

                    const dstIdx = (dstY * 224 + dstX) * 4;
                    this.pixels[dstIdx + 0] = r;
                    this.pixels[dstIdx + 1] = g;
                    this.pixels[dstIdx + 2] = b;
                    this.pixels[dstIdx + 3] = 255;
                }
            }
        } catch (e) {
            // Ignore errors
        }
    }
}
