/**
 * Dungeon state management
 *
 * Provides access to dungeon data (maps, tiles, objects)
 * Based on CSBWin's dungeon data access
 */

import type { ui8, ui16, Coordinates, CellFlag } from '../core/types';
import type { DungeonData, MapData, TileData } from '../data/dungeonTypes';
import { RoomType } from '../core/types';

/**
 * DungeonState - manages dungeon data and queries
 */
export class DungeonState {
    private data: DungeonData;

    constructor(data: DungeonData) {
        this.data = data;
    }

    /**
     * Get dungeon data
     */
    getData(): Readonly<DungeonData> {
        return this.data;
    }

    /**
     * Get number of maps
     */
    getMapCount(): ui8 {
        return this.data.maps.length;
    }

    /**
     * Get a map by index
     */
    getMap(index: ui8): MapData | null {
        if (index < 0 || index >= this.data.maps.length) {
            return null;
        }
        return this.data.maps[index];
    }

    /**
     * Get tile data at position
     *
     * @param mapIndex - Map index
     * @param x - X coordinate
     * @param y - Y coordinate
     * @returns Tile data or null if out of bounds
     */
    getTile(mapIndex: ui8, x: number, y: number): TileData | null {
        const map = this.getMap(mapIndex);
        if (!map) {
            return null;
        }

        // Check bounds
        if (x < 0 || x >= map.descriptor.width || y < 0 || y >= map.descriptor.height) {
            return null;
        }

        return map.tiles[x][y];
    }

    /**
     * Get cell flag at position
     *
     * @param mapIndex - Map index
     * @param x - X coordinate
     * @param y - Y coordinate
     * @returns Cell flag or 0 if out of bounds
     */
    getCellFlag(mapIndex: ui8, x: number, y: number): CellFlag {
        const map = this.getMap(mapIndex);
        if (!map) {
            return 0;
        }

        // Check bounds
        if (x < 0 || x >= map.descriptor.width || y < 0 || y >= map.descriptor.height) {
            return 0;
        }

        return map.cellFlags[x][y];
    }

    /**
     * Check if a position is walkable (not a wall)
     *
     * @param mapIndex - Map index
     * @param x - X coordinate
     * @param y - Y coordinate
     * @returns True if position is walkable
     */
    isWalkable(mapIndex: ui8, x: number, y: number): boolean {
        const tile = this.getTile(mapIndex, x, y);
        if (!tile) {
            return false; // Out of bounds = not walkable
        }

        // Check room type
        switch (tile.roomType) {
            case RoomType.STONE:
                return false; // Wall
            case RoomType.OPEN:
                return true;  // Floor
            case RoomType.DOOR:
                // TODO: Check if door is open
                return true;  // For now, assume doors can be passed
            case RoomType.STAIRS:
                return true;  // Stairs are walkable
            case RoomType.PIT:
                return true;  // Pits are "walkable" (you fall in)
            case RoomType.TELEPORTER:
                return true;  // Teleporters are walkable
            case RoomType.FALSEWALL:
                return false; // False walls appear as walls initially
            case RoomType.EMPTY:
                return false; // Empty space (void)
            default:
                return false;
        }
    }

    /**
     * Check if a position is a wall
     *
     * @param mapIndex - Map index
     * @param x - X coordinate
     * @param y - Y coordinate
     * @returns True if position is a wall
     */
    isWall(mapIndex: ui8, x: number, y: number): boolean {
        const tile = this.getTile(mapIndex, x, y);
        if (!tile) {
            return true; // Out of bounds = wall
        }

        return tile.roomType === RoomType.STONE || tile.roomType === RoomType.FALSEWALL;
    }

    /**
     * Check if a position is a door
     *
     * @param mapIndex - Map index
     * @param x - X coordinate
     * @param y - Y coordinate
     * @returns True if position is a door
     */
    isDoor(mapIndex: ui8, x: number, y: number): boolean {
        const tile = this.getTile(mapIndex, x, y);
        return tile?.roomType === RoomType.DOOR;
    }

    /**
     * Check if a position is a pit
     *
     * @param mapIndex - Map index
     * @param x - X coordinate
     * @param y - Y coordinate
     * @returns True if position is a pit
     */
    isPit(mapIndex: ui8, x: number, y: number): boolean {
        const tile = this.getTile(mapIndex, x, y);
        return tile?.roomType === RoomType.PIT;
    }

    /**
     * Check if a position is a teleporter
     *
     * @param mapIndex - Map index
     * @param x - X coordinate
     * @param y - Y coordinate
     * @returns True if position is a teleporter
     */
    isTeleporter(mapIndex: ui8, x: number, y: number): boolean {
        const tile = this.getTile(mapIndex, x, y);
        return tile?.roomType === RoomType.TELEPORTER;
    }

    /**
     * Check if a position is stairs
     *
     * @param mapIndex - Map index
     * @param x - X coordinate
     * @param y - Y coordinate
     * @returns True if position is stairs
     */
    isStairs(mapIndex: ui8, x: number, y: number): boolean {
        const tile = this.getTile(mapIndex, x, y);
        return tile?.roomType === RoomType.STAIRS;
    }

    /**
     * Check if a position has objects
     *
     * @param mapIndex - Map index
     * @param x - X coordinate
     * @param y - Y coordinate
     * @returns True if position has objects
     */
    hasObjects(mapIndex: ui8, x: number, y: number): boolean {
        const tile = this.getTile(mapIndex, x, y);
        return tile?.hasObjects || false;
    }

    /**
     * Get start position from dungeon header
     */
    getStartPosition(): Coordinates {
        return {
            x: this.data.header.startPosition.x,
            y: this.data.header.startPosition.y,
        };
    }

    /**
     * Get start facing direction
     */
    getStartFacing(): number {
        return this.data.header.startPosition.facing;
    }

    /**
     * Get start map index (level)
     */
    getStartMapIndex(): ui8 {
        return this.data.header.startPosition.level || 0;
    }

    /**
     * Get text by index
     */
    getText(index: ui16): string | null {
        if (index < 0 || index >= this.data.textData.length) {
            return null;
        }
        return this.data.textData[index];
    }

    /**
     * Get map dimensions
     */
    getMapDimensions(mapIndex: ui8): { width: ui8; height: ui8 } | null {
        const map = this.getMap(mapIndex);
        if (!map) {
            return null;
        }
        return {
            width: map.descriptor.width,
            height: map.descriptor.height,
        };
    }
}
