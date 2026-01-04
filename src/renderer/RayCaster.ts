/**
 * Ray-casting system for wall detection
 *
 * Implements DDA (Digital Differential Analysis) algorithm
 * to cast rays through the dungeon grid and detect wall hits
 * Based on CSBWin's column-based viewport rendering
 */

import type { DungeonState } from '../engine/DungeonState';
import type { ViewState, RayColumn } from './rendererTypes';
import {
    VIEWPORT,
    WallSide,
    directionToAngle,
    normalizeAngle,
    calculateWallHeight,
    calculateWallBounds,
    calculateShading,
} from './rendererTypes';

/**
 * RayCaster - performs ray-casting for viewport rendering
 */
export class RayCaster {
    private dungeon: DungeonState;

    constructor(dungeon: DungeonState) {
        this.dungeon = dungeon;
    }

    /**
     * Cast a single ray through the dungeon
     *
     * @param viewState - Current camera/view state
     * @param columnIndex - Column index (0 to VIEWPORT.COLUMNS-1)
     * @returns Ray column data with wall hit information
     */
    castRay(viewState: ViewState, columnIndex: number): RayColumn {
        // Calculate ray angle
        // Column 0 is leftmost (angle - FOV/2), column COLUMNS-1 is rightmost (angle + FOV/2)
        const viewAngle = directionToAngle(viewState.facing);
        const columnOffset = (columnIndex / VIEWPORT.COLUMNS) - 0.5; // -0.5 to 0.5
        const rayAngle = normalizeAngle(viewAngle + columnOffset * VIEWPORT.FOV_RADIANS);

        // Ray direction
        const rayDirX = Math.cos(rayAngle);
        const rayDirY = Math.sin(rayAngle);

        // Starting position (player position + sub-tile offset)
        const rayPosX = viewState.position.x + 0.5 + viewState.offsetX;
        const rayPosY = viewState.position.y + 0.5 + viewState.offsetY;

        // DDA setup
        // Which box of the map we're in
        let mapX = Math.floor(rayPosX);
        let mapY = Math.floor(rayPosY);

        // Length of ray from current position to next x or y-side
        let sideDistX: number;
        let sideDistY: number;

        // Length of ray from one x or y-side to next x or y-side
        const deltaDistX = Math.abs(1 / rayDirX);
        const deltaDistY = Math.abs(1 / rayDirY);

        // What direction to step in x or y-direction (either +1 or -1)
        let stepX: number;
        let stepY: number;

        // Calculate step and initial sideDist
        if (rayDirX < 0) {
            stepX = -1;
            sideDistX = (rayPosX - mapX) * deltaDistX;
        } else {
            stepX = 1;
            sideDistX = (mapX + 1.0 - rayPosX) * deltaDistX;
        }

        if (rayDirY < 0) {
            stepY = -1;
            sideDistY = (rayPosY - mapY) * deltaDistY;
        } else {
            stepY = 1;
            sideDistY = (mapY + 1.0 - rayPosY) * deltaDistY;
        }

        // Perform DDA
        let hit = false;
        let side: WallSide = WallSide.NORTH; // Which side was hit (NS or EW)
        let distance = 0;
        const maxSteps = 100; // Prevent infinite loops
        let steps = 0;

        while (!hit && steps < maxSteps) {
            // Jump to next map square, either in x-direction, or in y-direction
            if (sideDistX < sideDistY) {
                sideDistX += deltaDistX;
                mapX += stepX;
                side = stepX < 0 ? WallSide.WEST : WallSide.EAST;
            } else {
                sideDistY += deltaDistY;
                mapY += stepY;
                side = stepY < 0 ? WallSide.NORTH : WallSide.SOUTH;
            }

            // Check if ray has hit a wall
            if (!this.dungeon.isWalkable(viewState.mapIndex, mapX, mapY)) {
                hit = true;
            }

            steps++;
        }

        // Calculate distance to wall hit
        if (side === WallSide.NORTH || side === WallSide.SOUTH) {
            distance = (mapY - rayPosY + (1 - stepY) / 2) / rayDirY;
        } else {
            distance = (mapX - rayPosX + (1 - stepX) / 2) / rayDirX;
        }

        // Correct for fisheye effect by using perpendicular distance
        const perpDistance = Math.abs(distance * Math.cos(rayAngle - viewAngle));

        // Calculate texture X coordinate (0.0 to 1.0)
        let textureX: number;
        if (side === WallSide.NORTH || side === WallSide.SOUTH) {
            textureX = rayPosX + distance * rayDirX;
        } else {
            textureX = rayPosY + distance * rayDirY;
        }
        textureX = textureX - Math.floor(textureX); // Get fractional part

        // Get wall type
        const tile = this.dungeon.getTile(viewState.mapIndex, mapX, mapY);
        const wallType = tile ? tile.roomType : 0;

        // Calculate wall height and screen coordinates
        const wallHeight = calculateWallHeight(perpDistance);
        const bounds = calculateWallBounds(wallHeight);

        return {
            columnIndex,
            angle: rayAngle,
            distance: perpDistance,
            wallType,
            wallSide: side,
            textureX,
            wallHeight,
            wallTop: bounds.top,
            wallBottom: bounds.bottom,
        };
    }

    /**
     * Cast all rays for the viewport
     *
     * @param viewState - Current camera/view state
     * @returns Array of ray columns (one per viewport column)
     */
    castAllRays(viewState: ViewState): RayColumn[] {
        const rays: RayColumn[] = [];

        for (let i = 0; i < VIEWPORT.COLUMNS; i++) {
            rays.push(this.castRay(viewState, i));
        }

        return rays;
    }

    /**
     * Update dungeon reference (for map changes)
     */
    setDungeon(dungeon: DungeonState): void {
        this.dungeon = dungeon;
    }
}
