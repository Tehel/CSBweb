/**
 * Cell-based renderer types and constants
 *
 * Based on CSBWin's 21-cell viewport system
 */

import type { Direction, Position } from '../core/types';

/**
 * Cell identifiers (from CSBWin Viewport.cpp lines 323-346)
 *
 * Cell numbering represents relative positions from party:
 * - RF = Relative Front
 * - Number = Distance (0-4)
 * - L/R = Left/Right offset
 * - Number after L/R = Offset amount (1-2)
 */
export enum CellId {
    // Distance 4 (farthest)
    RF4L2 = 0,
    RF4R2 = 1,

    // Distance 3
    RF3L2 = 2,
    RF3R2 = 3,
    RF3L1 = 4,
    RF3R1 = 5,
    RF3 = 6,

    // Distance 2
    RF2L2 = 10,
    RF2R2 = 11,
    RF2L1 = 12,
    RF2R1 = 13,
    RF2 = 14,

    // Distance 1
    RF1L1 = 15,
    RF1R1 = 16,
    RF1 = 17,

    // Distance 0 (party position)
    RF0L1 = 18,
    RF0R1 = 19,
    RF0 = 20,
}

/**
 * Cell position definition
 */
export interface CellPosition {
    id: CellId;
    distance: number;      // 0-4 (0 = at party, 4 = far)
    offsetX: number;       // -2 to +2 (left to right)
    offsetY: number;       // Relative Y from party
}

/**
 * Relative positions for all 21 cells
 * From CSBWin Viewport.cpp lines 347-355
 */
export const CELL_RELATIVE_POSITIONS: CellPosition[] = [
    // Distance 4
    { id: CellId.RF4L2, distance: 4, offsetX: -2, offsetY: 4 },
    { id: CellId.RF4R2, distance: 4, offsetX: +2, offsetY: 4 },

    // Distance 3
    { id: CellId.RF3L2, distance: 3, offsetX: -2, offsetY: 3 },
    { id: CellId.RF3R2, distance: 3, offsetX: +2, offsetY: 3 },
    { id: CellId.RF3L1, distance: 3, offsetX: -1, offsetY: 4 },
    { id: CellId.RF3R1, distance: 3, offsetX: +1, offsetY: 4 },
    { id: CellId.RF3, distance: 3, offsetX: 0, offsetY: 4 },

    // Distance 3 center columns (added for completeness)
    { id: 7, distance: 3, offsetX: -1, offsetY: 3 },
    { id: 8, distance: 3, offsetX: +1, offsetY: 3 },
    { id: 9, distance: 3, offsetX: 0, offsetY: 3 },

    // Distance 2
    { id: CellId.RF2L2, distance: 2, offsetX: -2, offsetY: 2 },
    { id: CellId.RF2R2, distance: 2, offsetX: +2, offsetY: 2 },
    { id: CellId.RF2L1, distance: 2, offsetX: -1, offsetY: 2 },
    { id: CellId.RF2R1, distance: 2, offsetX: +1, offsetY: 2 },
    { id: CellId.RF2, distance: 2, offsetX: 0, offsetY: 2 },

    // Distance 1
    { id: CellId.RF1L1, distance: 1, offsetX: -1, offsetY: 1 },
    { id: CellId.RF1R1, distance: 1, offsetX: +1, offsetY: 1 },
    { id: CellId.RF1, distance: 1, offsetX: 0, offsetY: 1 },

    // Distance 0 (at party)
    { id: CellId.RF0L1, distance: 0, offsetX: -1, offsetY: 0 },
    { id: CellId.RF0R1, distance: 0, offsetX: +1, offsetY: 0 },
    { id: CellId.RF0, distance: 0, offsetX: 0, offsetY: 0 },
];

/**
 * Screen rectangle where graphics should be blitted
 */
export interface ScreenRect {
    x: number;
    y: number;
    width: number;
    height: number;
    // Source rectangle (for clipping from sprite sheets)
    srcX?: number;
    srcY?: number;
    srcWidth?: number;
    srcHeight?: number;
}

/**
 * Screen rectangles for each cell
 * These define where graphics are blitted to the viewport
 *
 * Based on CSBWin's wallRectangles array and typical DM viewport layout
 * Coordinates derived from graphics sizes and viewport geometry
 */
export const CELL_SCREEN_RECTS: { [cellId: number]: ScreenRect } = {
    // Distance 4 (farthest - smallest) - Far back, narrow view
    [CellId.RF4L2]: { x: 64, y: 42, width: 16, height: 49 },
    [CellId.RF4R2]: { x: 144, y: 42, width: 16, height: 49 },

    // Distance 3 - Getting closer
    [CellId.RF3L2]: { x: 48, y: 40, width: 16, height: 49 },  // Uses graphic 89 (16×49)
    [CellId.RF3R2]: { x: 160, y: 40, width: 80, height: 46 }, // Uses graphic 90 (80×46)
    [CellId.RF3L1]: { x: 48, y: 40, width: 48, height: 51 },  // Part of graphic 88
    [CellId.RF3R1]: { x: 128, y: 40, width: 48, height: 51 }, // Part of graphic 88
    [CellId.RF3]: { x: 48, y: 40, width: 128, height: 51 },   // Graphic 88 (128×51)

    // Distance 2 - Closer
    [CellId.RF2L2]: { x: 16, y: 32, width: 48, height: 71 },
    [CellId.RF2R2]: { x: 160, y: 32, width: 48, height: 71 },
    [CellId.RF2L1]: { x: 40, y: 32, width: 48, height: 71 },
    [CellId.RF2R1]: { x: 136, y: 32, width: 48, height: 71 },
    [CellId.RF2]: { x: 40, y: 32, width: 144, height: 71 },   // Graphic 87 (144×71)

    // Distance 1 - Close
    [CellId.RF1L1]: { x: 16, y: 12, width: 64, height: 111 },
    [CellId.RF1R1]: { x: 144, y: 12, width: 64, height: 111 },
    [CellId.RF1]: { x: 32, y: 0, width: 160, height: 136 },   // Center wall at D1

    // Distance 0 (closest - full height)
    [CellId.RF0L1]: { x: 0, y: 0, width: 32, height: 136 },   // Graphic 85 (32×136)
    [CellId.RF0R1]: { x: 192, y: 0, width: 32, height: 136 }, // Graphic 84 (32×136)
    [CellId.RF0]: { x: 32, y: 0, width: 160, height: 136 },   // Center area
};

/**
 * Wall view types
 */
export enum WallView {
    FRONT = 0,        // Straight ahead view
    LEFT = 1,         // Left side view
    RIGHT = 2,        // Right side view
    LEFT_CORNER = 3,  // Left corner view
    RIGHT_CORNER = 4, // Right corner view
}

/**
 * Graphics index mapping for walls
 * Based on analysis in GRAPHICS_ORGANIZATION.md
 */
export interface WallGraphicSet {
    front: number;       // Front-facing wall graphic index
    left: number;        // Left side view
    right: number;       // Right side view
    leftCorner: number;  // Left corner
    rightCorner: number; // Right corner
}

/**
 * Wall graphics organized by distance and room type
 *
 * Extracted from CSBWin source code (see GRAPHICS_MAPPINGS.md)
 * For wallSet = 0 (default): graphics 84-90
 */
export const STONE_WALL_GRAPHICS: WallGraphicSet[] = [
    // Distance 0 (closest) - F0
    {
        front: 86,       // pWallBitmaps[2] - F0 uses same as F1
        left: 85,        // pWallBitmaps[1] - F0L1
        right: 84,       // pWallBitmaps[0] - F0R1
        leftCorner: 85,  // Reuse left
        rightCorner: 84, // Reuse right
    },
    // Distance 1 - F1
    {
        front: 86,       // pWallBitmaps[2] - 128×200
        left: 86,        // pWallBitmaps[2] - F1L1
        right: 86,       // pWallBitmaps[2] - F1R1
        leftCorner: 86,  // Same
        rightCorner: 86, // Same
    },
    // Distance 2 - F2
    {
        front: 87,       // pWallBitmaps[3] - 64×111
        left: 87,        // pWallBitmaps[3] - F2L1
        right: 87,       // pWallBitmaps[3] - F2R1
        leftCorner: 87,  // Same
        rightCorner: 87, // Same
    },
    // Distance 3 - F3
    {
        front: 88,       // pWallBitmaps[4] - 96×62
        left: 88,        // pWallBitmaps[4] - F3L1
        right: 88,       // pWallBitmaps[4] - F3R1
        leftCorner: 89,  // pWallBitmaps[5] - F3L2 (16×49)
        rightCorner: 90, // pWallBitmaps[6] - F3R2 (80×46)
    },
    // Distance 4 (farthest) - F4
    {
        front: 88,       // Reuse F3 graphics for distance 4
        left: 88,
        right: 88,
        leftCorner: 89,
        rightCorner: 90,
    },
];

/**
 * Floor graphics organized by distance
 */
export const FLOOR_GRAPHICS: number[] = [
    0,   // Distance 0 (unused - party position)
    75,  // Distance 1: 224×70
    95,  // Distance 2: 160×100
    87,  // Distance 3: 144×71
    0,   // Distance 4 (too far)
];

/**
 * Ceiling graphics (if different from floor)
 */
export const CEILING_GRAPHICS: number[] = [
    0,   // Distance 0
    76,  // Distance 1: 224×29
    102, // Distance 2: 160×91
    88,  // Distance 3: 128×51
    0,   // Distance 4
];

/**
 * Calculate absolute dungeon position from relative cell position
 *
 * @param partyPos - Party's current position
 * @param partyFacing - Party's facing direction (0-3)
 * @param cell - Cell position to calculate
 * @returns Absolute dungeon coordinates
 */
export function getAbsoluteCellPosition(
    partyPos: Position,
    partyFacing: Direction,
    cell: CellPosition
): Position {
    // Transform relative position based on party facing
    let dx = 0;
    let dy = 0;

    switch (partyFacing) {
        case 0: // North (-Y)
            dx = cell.offsetX;
            dy = -cell.offsetY;
            break;
        case 1: // East (+X)
            dx = cell.offsetY;
            dy = cell.offsetX;
            break;
        case 2: // South (+Y)
            dx = -cell.offsetX;
            dy = cell.offsetY;
            break;
        case 3: // West (-X)
            dx = -cell.offsetY;
            dy = -cell.offsetX;
            break;
    }

    return {
        x: partyPos.x + dx,
        y: partyPos.y + dy,
    };
}

/**
 * Determine which wall view to use based on cell position
 *
 * @param cell - Cell position
 * @returns Wall view type to use
 */
export function getWallViewForCell(cell: CellPosition): WallView {
    // Center cells show front view
    if (cell.offsetX === 0) {
        return WallView.FRONT;
    }

    // Left/right cells show side views
    if (cell.offsetX < 0) {
        return WallView.LEFT;
    } else {
        return WallView.RIGHT;
    }
}
