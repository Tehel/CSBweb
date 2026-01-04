/**
 * Cell rendering functions
 *
 * Renders individual cells based on room type and position
 * Simplified direct implementation (not bytecode interpreter)
 */

import type { DungeonState } from '../engine/DungeonState';
import type { Direction, Position } from '../core/types';
import { GraphicsBlit } from './GraphicsBlit';
import {
    CellId,
    CellPosition,
    CELL_RELATIVE_POSITIONS,
    CELL_SCREEN_RECTS,
    STONE_WALL_GRAPHICS,
    FLOOR_GRAPHICS,
    CEILING_GRAPHICS,
    getAbsoluteCellPosition,
    getWallViewForCell,
    WallView,
    type ScreenRect,
} from './cellTypes';

/**
 * Room types (from dungeon.dat)
 */
export enum RoomType {
    STONE = 0,
    OPEN = 1,
    STAIRS = 3,
    DOOR = 4,
    PIT = 5,
    TELEPORTER = 6,
    FALSEWALL = 7,
}

/**
 * CellRenderer - Renders dungeon cells to viewport
 */
export class CellRenderer {
    private dungeon: DungeonState;
    private blit: GraphicsBlit;

    constructor(dungeon: DungeonState, blit: GraphicsBlit) {
        this.dungeon = dungeon;
        this.blit = blit;
    }

    /**
     * Render a single cell
     *
     * @param cell - Cell position to render
     * @param partyPos - Party's current position
     * @param partyFacing - Party's facing direction
     * @param mapIndex - Current map index
     */
    renderCell(cell: CellPosition, partyPos: Position, partyFacing: Direction, mapIndex: number): void {
        // Get absolute dungeon position for this cell
        const absPos = getAbsoluteCellPosition(partyPos, partyFacing, cell);

        // Get tile data at this position
        const tile = this.dungeon.getTile(mapIndex, absPos.x, absPos.y);
        if (!tile) {
            return; // Out of bounds or invalid position
        }

        const roomType = tile.roomType;

        // Get screen rectangle for this cell
        const rect = CELL_SCREEN_RECTS[cell.id];
        if (!rect) {
            return; // No screen rect defined for this cell
        }

        // Render based on room type
        switch (roomType) {
            case RoomType.STONE:
                this.renderStoneWall(cell, rect);
                break;

            case RoomType.OPEN:
                // Open space - render floor/ceiling only
                this.renderOpenSpace(cell, rect);
                break;

            case RoomType.DOOR:
                this.renderDoor(cell, rect);
                break;

            case RoomType.STAIRS:
                this.renderStairs(cell, rect);
                break;

            case RoomType.PIT:
                this.renderPit(cell, rect);
                break;

            case RoomType.TELEPORTER:
                this.renderTeleporter(cell, rect);
                break;

            case RoomType.FALSEWALL:
                this.renderFalseWall(cell, rect);
                break;

            default:
                // Unknown room type - render as stone
                this.renderStoneWall(cell, rect);
                break;
        }
    }

    /**
     * Render a stone wall cell
     */
    private renderStoneWall(cell: CellPosition, rect: ScreenRect): void {
        if (cell.distance >= STONE_WALL_GRAPHICS.length) {
            return; // Too far
        }

        const wallSet = STONE_WALL_GRAPHICS[cell.distance];
        const wallView = getWallViewForCell(cell);

        let graphicIndex: number;
        switch (wallView) {
            case WallView.FRONT:
                graphicIndex = wallSet.front;
                break;
            case WallView.LEFT:
                graphicIndex = wallSet.left;
                break;
            case WallView.RIGHT:
                graphicIndex = wallSet.right;
                break;
            case WallView.LEFT_CORNER:
                graphicIndex = wallSet.leftCorner;
                break;
            case WallView.RIGHT_CORNER:
                graphicIndex = wallSet.rightCorner;
                break;
            default:
                graphicIndex = wallSet.front;
        }

        this.blit.blitGraphic(graphicIndex, rect, true);
    }

    /**
     * Render open space (no walls, just floor/ceiling if visible)
     */
    private renderOpenSpace(cell: CellPosition, rect: ScreenRect): void {
        // For now, just render floor graphic if we're looking down
        // More complex rendering would show distant walls through the opening
        if (cell.distance > 0 && cell.distance < FLOOR_GRAPHICS.length) {
            const floorGraphic = FLOOR_GRAPHICS[cell.distance];
            if (floorGraphic > 0) {
                // Blit floor graphic (might need different rect)
                this.blit.blitGraphic(floorGraphic, rect, true);
            }
        }
    }

    /**
     * Render a door
     */
    private renderDoor(cell: CellPosition, rect: ScreenRect): void {
        // TODO: Get door state (open/closed) from dungeon data
        // For now, render as stone wall
        this.renderStoneWall(cell, rect);
    }

    /**
     * Render stairs
     */
    private renderStairs(cell: CellPosition, rect: ScreenRect): void {
        // TODO: Implement stairs rendering with appropriate graphics
        // For now, render as stone wall
        this.renderStoneWall(cell, rect);
    }

    /**
     * Render a pit
     */
    private renderPit(cell: CellPosition, rect: ScreenRect): void {
        // Render pit as dark/black
        this.blit.fillRect(rect, 10, 10, 10);
    }

    /**
     * Render a teleporter
     */
    private renderTeleporter(cell: CellPosition, rect: ScreenRect): void {
        // TODO: Implement teleporter effect
        // For now, render as blue tinted stone
        this.renderStoneWall(cell, rect);
    }

    /**
     * Render a false wall
     */
    private renderFalseWall(cell: CellPosition, rect: ScreenRect): void {
        // False wall looks like normal wall
        this.renderStoneWall(cell, rect);
    }

    /**
     * Render floor for a distance level
     */
    renderFloor(distance: number): void {
        if (distance <= 0 || distance >= FLOOR_GRAPHICS.length) {
            return;
        }

        const floorGraphic = FLOOR_GRAPHICS[distance];
        if (floorGraphic <= 0) {
            return;
        }

        // Floor graphics are large and span multiple cells
        // Use a large rect centered on viewport
        const rect: ScreenRect = {
            x: 0,
            y: 68 + (distance * 10), // Approximate Y position based on distance
            width: 224,
            height: Math.max(10, 70 - distance * 15), // Smaller as distance increases
        };

        this.blit.blitGraphic(floorGraphic, rect, true);
    }

    /**
     * Render ceiling for a distance level
     */
    renderCeiling(distance: number): void {
        if (distance <= 0 || distance >= CEILING_GRAPHICS.length) {
            return;
        }

        const ceilingGraphic = CEILING_GRAPHICS[distance];
        if (ceilingGraphic <= 0) {
            return;
        }

        const rect: ScreenRect = {
            x: 0,
            y: Math.max(0, 40 - distance * 10),
            width: 224,
            height: Math.max(10, 30 - distance * 5),
        };

        this.blit.blitGraphic(ceilingGraphic, rect, true);
    }
}
