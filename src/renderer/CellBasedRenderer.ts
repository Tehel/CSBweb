/**
 * Cell-based viewport renderer
 *
 * Implements the correct 2.5D sprite-based rendering system
 * Based on CSBWin's 21-cell approach
 */

import type { DungeonState } from '../engine/DungeonState';
import type { GraphicsLoader } from '../data/GraphicsLoader';
import type { Direction, Position } from '../core/types';
import { GraphicsBlit } from './GraphicsBlit';
import { CellRenderer } from './CellRenderer';
import { CELL_RELATIVE_POSITIONS, type CellPosition } from './cellTypes';

/**
 * Viewport constants
 */
const VIEWPORT_WIDTH = 224;
const VIEWPORT_HEIGHT = 136;

/**
 * View state for rendering
 */
export interface ViewState {
    position: Position;
    facing: Direction;
    mapIndex: number;
}

/**
 * Render options
 */
export interface RenderOptions {
    scale: number;
    paletteIndex: number;
}

const DEFAULT_RENDER_OPTIONS: RenderOptions = {
    scale: 2,
    paletteIndex: 0,
};

/**
 * CellBasedRenderer - 2.5D sprite-based viewport renderer
 */
export class CellBasedRenderer {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private dungeon: DungeonState;
    private graphics: GraphicsLoader;
    private options: RenderOptions;

    // Off-screen canvas for rendering at native resolution
    private offscreenCanvas: HTMLCanvasElement;
    private offscreenCtx: CanvasRenderingContext2D;

    // Rendering components
    private blit: GraphicsBlit;
    private cellRenderer: CellRenderer;

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

        // Create off-screen canvas at native viewport resolution
        this.offscreenCanvas = document.createElement('canvas');
        this.offscreenCanvas.width = VIEWPORT_WIDTH;
        this.offscreenCanvas.height = VIEWPORT_HEIGHT;
        const offscreenCtx = this.offscreenCanvas.getContext('2d');
        if (!offscreenCtx) {
            throw new Error('Could not get off-screen 2D context');
        }
        this.offscreenCtx = offscreenCtx;

        // Create rendering components
        this.blit = new GraphicsBlit(this.offscreenCanvas, graphics, options.paletteIndex);
        this.cellRenderer = new CellRenderer(dungeon, this.blit);
    }

    /**
     * Render the viewport
     *
     * @param viewState - Current view state (party position and facing)
     */
    render(viewState: ViewState): void {
        // Clear to black
        this.blit.clear();

        // Render floor and ceiling first (back to front)
        this.renderBackground();

        // Render all 21 cells from far to near
        // Distance 4 (farthest)
        this.renderCellsAtDistance(4, viewState);

        // Distance 3
        this.renderCellsAtDistance(3, viewState);

        // Distance 2
        this.renderCellsAtDistance(2, viewState);

        // Distance 1
        this.renderCellsAtDistance(1, viewState);

        // Distance 0 (closest - at party position)
        this.renderCellsAtDistance(0, viewState);

        // TODO: Render objects/creatures/decorations

        // Flush pixel buffer to canvas
        this.blit.flush();

        // Scale and draw to main canvas
        this.ctx.imageSmoothingEnabled = false;
        this.ctx.drawImage(
            this.offscreenCanvas,
            0, 0, VIEWPORT_WIDTH, VIEWPORT_HEIGHT,
            0, 0, VIEWPORT_WIDTH * this.options.scale, VIEWPORT_HEIGHT * this.options.scale
        );
    }

    /**
     * Render background (floor and ceiling)
     */
    private renderBackground(): void {
        // Fill with dark colors for floor and ceiling
        // TODO: Use actual floor/ceiling graphics

        // Ceiling (top half)
        this.blit.fillViewport(26, 26, 26); // Dark gray

        // Simple horizon
        const horizonY = VIEWPORT_HEIGHT / 2;

        // Floor (bottom half) - slightly lighter
        this.blit.fillRect(
            { x: 0, y: horizonY, width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT - horizonY },
            42, 42, 42
        );
    }

    /**
     * Render all cells at a specific distance
     *
     * @param distance - Distance level (0-4)
     * @param viewState - Current view state
     */
    private renderCellsAtDistance(distance: number, viewState: ViewState): void {
        // Find all cells at this distance
        const cellsAtDistance = CELL_RELATIVE_POSITIONS.filter(cell => cell.distance === distance);

        // Sort by X offset (left to right) for proper ordering
        cellsAtDistance.sort((a, b) => {
            // Render from outside to inside
            return Math.abs(b.offsetX) - Math.abs(a.offsetX);
        });

        // Render each cell
        for (const cell of cellsAtDistance) {
            this.cellRenderer.renderCell(cell, viewState.position, viewState.facing, viewState.mapIndex);
        }
    }

    /**
     * Update render options
     */
    setOptions(options: Partial<RenderOptions>): void {
        this.options = { ...this.options, ...options };

        // Update palette if changed
        if (options.paletteIndex !== undefined) {
            this.blit.setPalette(options.paletteIndex);
        }
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
