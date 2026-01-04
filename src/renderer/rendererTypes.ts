/**
 * First-person viewport renderer types and constants
 *
 * Column-based ray-casting renderer for Dungeon Master
 * Based on CSBWin's viewport rendering system
 */

import type { Direction, Coordinates } from '../core/types';
import type { DecodedImage } from '../core/imageDecoder';

/**
 * Viewport dimensions
 * Based on original Dungeon Master viewport size
 */
export const VIEWPORT = {
    WIDTH: 224,           // Viewport width in pixels
    HEIGHT: 136,          // Viewport height in pixels
    COLUMNS: 112,         // Number of ray-casting columns (every 2 pixels)
    CENTER_X: 112,        // Horizontal center
    CENTER_Y: 68,         // Vertical center
    HORIZON_Y: 68,        // Horizon line (sky/floor boundary)

    // Field of view
    FOV_DEGREES: 60,      // Field of view in degrees
    FOV_RADIANS: Math.PI / 3,  // FOV in radians

    // Distance constants
    NEAR_PLANE: 0.5,      // Minimum rendering distance
    FAR_PLANE: 16.0,      // Maximum rendering distance

    // Wall height scaling
    WALL_HEIGHT_SCALE: 64,  // Base wall height at distance 1.0
};

/**
 * Ray-casting column data
 */
export interface RayColumn {
    columnIndex: number;     // Column number (0 to COLUMNS-1)
    angle: number;           // Ray angle in radians
    distance: number;        // Distance to wall hit
    wallType: number;        // Wall type/texture ID
    wallSide: WallSide;      // Which side of the wall was hit
    textureX: number;        // Texture X coordinate (0.0 to 1.0)
    wallHeight: number;      // Calculated wall height on screen
    wallTop: number;         // Top Y coordinate of wall on screen
    wallBottom: number;      // Bottom Y coordinate of wall on screen
}

/**
 * Wall side enumeration
 */
export enum WallSide {
    NORTH = 0,   // Top wall
    EAST = 1,    // Right wall
    SOUTH = 2,   // Bottom wall
    WEST = 3,    // Left wall
}

/**
 * Wall segment for rendering
 */
export interface WallSegment {
    distance: number;        // Distance from viewer
    height: number;          // Screen height in pixels
    topY: number;            // Top Y coordinate
    bottomY: number;         // Bottom Y coordinate
    texture: DecodedImage | null;  // Wall texture
    textureX: number;        // Texture column (0.0 to 1.0)
    side: WallSide;          // Which wall side
    shading: number;         // Shading factor (0.0 to 1.0)
}

/**
 * Floor/ceiling strip for rendering
 */
export interface FloorCeilingStrip {
    y: number;               // Y coordinate on screen
    distance: number;        // Distance from viewer
    texture: DecodedImage | null;  // Floor/ceiling texture
    textureU: number;        // Texture U coordinate
    textureV: number;        // Texture V coordinate
    shading: number;         // Shading factor (0.0 to 1.0)
}

/**
 * Render state for a single column
 */
export interface ColumnRenderState {
    x: number;               // Screen X coordinate
    ray: RayColumn;          // Ray-casting data
    wall: WallSegment | null;         // Wall to render
    floorStrips: FloorCeilingStrip[]; // Floor segments
    ceilingStrips: FloorCeilingStrip[]; // Ceiling segments
}

/**
 * Camera/view state
 */
export interface ViewState {
    position: Coordinates;   // Camera position (can be fractional during movement)
    facing: Direction;       // Facing direction
    angle: number;           // View angle in radians (derived from facing)
    offsetX: number;         // Sub-tile X offset (-0.5 to 0.5)
    offsetY: number;         // Sub-tile Y offset (-0.5 to 0.5)
    mapIndex: number;        // Current map index
}

/**
 * Rendering options
 */
export interface RenderOptions {
    drawWalls: boolean;
    drawFloor: boolean;
    drawCeiling: boolean;
    drawObjects: boolean;
    enableShading: boolean;  // Distance-based shading
    enableTextures: boolean; // Use textures vs solid colors
    scale: number;           // Viewport scale factor (1 = native, 2 = 2x, etc.)
}

/**
 * Convert direction to angle in radians
 *
 * Screen coordinates: Y increases downward, X increases right
 * - North (0) = up = -Y = 270° (3π/2)
 * - East (1) = right = +X = 0°
 * - South (2) = down = +Y = 90° (π/2)
 * - West (3) = left = -X = 180° (π)
 */
export function directionToAngle(direction: Direction): number {
    switch (direction) {
        case 0: return 3 * Math.PI / 2; // North = 270° = -Y
        case 1: return 0;                // East = 0° = +X
        case 2: return Math.PI / 2;      // South = 90° = +Y
        case 3: return Math.PI;          // West = 180° = -X
        default: return 0;
    }
}

/**
 * Normalize angle to 0-2π range
 */
export function normalizeAngle(angle: number): number {
    const TWO_PI = 2 * Math.PI;
    angle = angle % TWO_PI;
    if (angle < 0) {
        angle += TWO_PI;
    }
    return angle;
}

/**
 * Calculate shading based on distance
 * Returns value from 0.0 (far/dark) to 1.0 (near/bright)
 */
export function calculateShading(distance: number): number {
    const maxDistance = VIEWPORT.FAR_PLANE;
    const minShading = 0.3; // Don't go completely black

    if (distance <= 0) return 1.0;
    if (distance >= maxDistance) return minShading;

    // Linear falloff
    const t = distance / maxDistance;
    return 1.0 - (t * (1.0 - minShading));
}

/**
 * Calculate wall screen height based on distance
 */
export function calculateWallHeight(distance: number): number {
    if (distance <= 0) return VIEWPORT.HEIGHT;

    const height = VIEWPORT.WALL_HEIGHT_SCALE / distance;
    return Math.min(height, VIEWPORT.HEIGHT * 2); // Cap at 2x viewport height
}

/**
 * Calculate wall top/bottom Y coordinates
 */
export function calculateWallBounds(wallHeight: number): { top: number; bottom: number } {
    const halfHeight = wallHeight / 2;
    const top = Math.floor(VIEWPORT.HORIZON_Y - halfHeight);
    const bottom = Math.floor(VIEWPORT.HORIZON_Y + halfHeight);

    return {
        top: Math.max(0, top),
        bottom: Math.min(VIEWPORT.HEIGHT - 1, bottom),
    };
}

/**
 * Default render options
 */
export const DEFAULT_RENDER_OPTIONS: RenderOptions = {
    drawWalls: true,
    drawFloor: true,
    drawCeiling: true,
    drawObjects: true,
    enableShading: true,
    enableTextures: true,
    scale: 2, // 2x scale for better visibility
};
