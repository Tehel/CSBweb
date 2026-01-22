/**
 * Dungeon state management
 *
 * Provides access to dungeon data (maps, tiles, objects)
 * Based on CSBWin's dungeon data access
 */

import { ui8, ui16, Position, CellFlag, ObjectID, Direction } from '../core/types';
import type {
    ClothingRecord,
    ContainerRecord,
    CreatureRecord,
    CloudRecord,
    DungeonData,
    DoorRecord,
    Item16Record,
    MapData,
    MissileRecord,
    MiscRecord,
    PotionRecord,
    ScrollRecord,
    TileData,
    TimerRecord,
    WeaponRecord,
    ActuatorRecord,
} from '../data/dungeonTypes';
import { DBType, decodeObjectID, OBJECT_ID_EOF, OBJECT_ID_NULL, RoomType } from '../core/types';
import type { TextRecord } from '../data/dungeonTypes';

export interface TextDecodeTables {
    escape1: Uint8Array; // Byte10080[64]
    escape2Wall: Uint8Array; // Byte10336[256]
    escape2Other: Uint8Array; // Byte10016[256]
}

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
     * Find the map index and coordinates for a level delta using CSBWin's IncrementLevel logic.
     *
     * Ported from CSBWin `IncrementLevel()` (doc/CSBwin-src/CSBCode.cpp:4709-4759).
     */
    incrementLevel(position: Position, delta: number): Position | null {
        const map = this.getMap(position.z);
        if (!map) return null;

        const absX = map.descriptor.offsetX + position.x;
        const absY = map.descriptor.offsetY + position.y;
        const targetLevel = map.descriptor.level + delta;

        for (let idx = 0; idx < this.data.maps.length; idx++) {
            const candidate = this.data.maps[idx];
            const desc = candidate.descriptor;
            if (desc.level !== targetLevel) continue;

            const minX = desc.offsetX;
            const maxX = desc.offsetX + desc.width - 1;
            const minY = desc.offsetY;
            const maxY = desc.offsetY + desc.height - 1;

            if (absX < minX || absX > maxX || absY < minY || absY > maxY) continue;

            return new Position(absX - desc.offsetX, absY - desc.offsetY, idx as ui8);
        }

        return null;
    }

    /**
     * Find a valid facing when exiting stairs on a level.
     *
     * Ported from CSBWin `ExitStairsDirection()` (doc/CSBwin-src/Code11f52.cpp:290-325).
     */
    getExitStairsDirection(position: Position, fallback: Direction): Direction {
        const { x, y, z } = position;
        const map = this.getMap(position.z);
        if (!map) return fallback;

        const deltaX = [0, 1, 0, -1];
        const deltaY = [-1, 0, 1, 0];

        for (let direction = 0; direction < 4; direction++) {
            const newX = x + deltaX[direction];
            const newY = y + deltaY[direction];
            if (newX < 0 || newY < 0 || newX >= map.descriptor.width || newY >= map.descriptor.height) continue;

            const cellFlag = this.getCellFlag(new Position(newX, newY, z));
            const roomType = (cellFlag >> 5) & 0x7;

            if (roomType === RoomType.STONE || roomType === RoomType.STAIRS) continue;
            if (roomType === RoomType.FALSEWALL && (cellFlag & 0x05) === 0) continue;

            return direction as Direction;
        }
        return fallback;
    }

    /**
     * Get tile data at position
     * @returns Tile data or null if out of bounds
     */
    getTile(position: Position): TileData | null {
        const { x, y, z } = position;
        const map = this.getMap(z);
        if (!map) return null;

        // Check bounds
        if (x < 0 || x >= map.descriptor.width || y < 0 || y >= map.descriptor.height) return null;

        return map.tiles[x][y];
    }

    /**
     * Get cell flag at position
     * @returns Cell flag or 0 if out of bounds
     */
    getCellFlag(position: Position): CellFlag {
        const { x, y, z } = position;
        const map = this.getMap(z);
        if (!map) return 0;

        // Check bounds
        if (x < 0 || x >= map.descriptor.width || y < 0 || y >= map.descriptor.height) return 0;

        return map.cellFlags[x][y];
    }

    /**
     * Index within `data.objectList` for the first object in (map,x,y), or -1 if none/out of bounds.
     *
     * Ported from CSBWin `GetObjectListIndex()` (doc/CSBwin-src/CSBCode.cpp:5103-5127).
     */
    getObjectListIndex(position: Position): number {
        const { x, y, z } = position;
        const map = this.getMap(z);
        if (!map) return -1;
        if (x < 0 || x >= map.descriptor.width || y < 0 || y >= map.descriptor.height) return -1;

        const cellFlag = map.cellFlags[x][y];
        if ((cellFlag & 0x10) === 0) return -1;

        const baseCol = this.data.levelIndex[z] + x;
        const colBase = this.data.columnIndex[baseCol];
        let idx = colBase;

        for (let yy = 0; yy < y; yy++) {
            if ((map.cellFlags[x][yy] & 0x10) !== 0) idx++;
        }

        return idx;
    }

    /**
     * Find first object RN in a cell, or `OBJECT_ID_EOF` if none.
     *
     * Ported from CSBWin `FindFirstObject()` (doc/CSBwin-src/CSBCode.cpp:5130-5137).
     */
    findFirstObject(position: Position): ObjectID {
        const idx = this.getObjectListIndex(position);
        if (idx < 0) return OBJECT_ID_EOF;
        return this.data.objectList[idx] ?? OBJECT_ID_EOF;
    }

    /**
     * Return the linked-list next pointer for a record RN, or `OBJECT_ID_EOF`.
     *
     * Ported from CSBWin `GetDBRecordLink()` (doc/CSBwin-src/CSBCode.cpp:5090-5100).
     */
    getDBRecordLink(rn: ObjectID): ObjectID {
        if (rn === OBJECT_ID_EOF || rn === OBJECT_ID_NULL) return OBJECT_ID_EOF;
        const { category, index } = decodeObjectID(rn);

        switch (category) {
            case DBType.DOOR:
                return this.data.databases.doors.records[index]?.nextObject ?? OBJECT_ID_EOF;
            case DBType.TELEPORTER:
                return this.data.databases.teleporters.records[index]?.nextObject ?? OBJECT_ID_EOF;
            case DBType.TEXT:
                return this.data.databases.texts.records[index]?.nextObject ?? OBJECT_ID_EOF;
            case DBType.ACTUATOR:
                return this.data.databases.actuators.records[index]?.nextObject ?? OBJECT_ID_EOF;
            case DBType.CREATURE:
                return this.data.databases.creatures.records[index]?.nextObject ?? OBJECT_ID_EOF;
            case DBType.WEAPON:
                return this.data.databases.weapons.records[index]?.nextObject ?? OBJECT_ID_EOF;
            case DBType.CLOTHING:
                return this.data.databases.clothing.records[index]?.nextObject ?? OBJECT_ID_EOF;
            case DBType.SCROLL:
                return this.data.databases.scrolls.records[index]?.nextObject ?? OBJECT_ID_EOF;
            case DBType.POTION:
                return this.data.databases.potions.records[index]?.nextObject ?? OBJECT_ID_EOF;
            case DBType.CHEST:
                return this.data.databases.containers.records[index]?.nextObject ?? OBJECT_ID_EOF;
            case DBType.MISC:
                return this.data.databases.misc.records[index]?.nextObject ?? OBJECT_ID_EOF;
            case DBType.MISSILE:
                return this.data.databases.missiles.records[index]?.nextObject ?? OBJECT_ID_EOF;
            case DBType.CLOUD:
                return this.data.databases.clouds.records[index]?.nextObject ?? OBJECT_ID_EOF;
            default:
                return OBJECT_ID_EOF;
        }
    }

    /**
     * Find the first DOOR record RN in a cell, or `OBJECT_ID_EOF`.
     *
     * Ported from CSBWin `FindFirstDoor()` semantics (doc/CSBwin-src/Code11f52.cpp:579+).
     */
    findFirstDoor(position: Position): ObjectID {
        for (let rn = this.findFirstObject(position); rn !== OBJECT_ID_EOF; rn = this.getDBRecordLink(rn)) {
            if (decodeObjectID(rn).category === DBType.DOOR) return rn;
        }
        return OBJECT_ID_EOF;
    }

    getTextRecord(rn: ObjectID): TextRecord | null {
        const { category, index } = decodeObjectID(rn);
        if (category !== DBType.TEXT) return null;
        return this.data.databases.texts.records[index] ?? null;
    }

    getDsaLevelIndex(level: number, selector: number): number | null {
        const table = this.data.dsaLevelIndex;
        if (!table) return null;
        const row = table[level];
        if (!row) return null;
        return row[selector] ?? null;
    }

    getActuatorRecord(rn: ObjectID): ActuatorRecord | null {
        const { category, index } = decodeObjectID(rn);
        if (category !== DBType.ACTUATOR) return null;
        return this.data.databases.actuators.records[index] ?? null;
    }

    getDoorRecordByIndex(index: number): DoorRecord | null {
        return this.data.databases.doors.records[index] ?? null;
    }

    /**
     * Apply an actuator action to its target door on the current level.
     * Returns true when a door state changed.
     */
    applyActuatorToDoor(actuator: ActuatorRecord, source: Position, pressed: boolean): boolean {
        if (actuator.targetLocal) return false;
        const map = this.getMap(source.z);
        if (!map) return false;

        const targetData = actuator.targetData | 0;
        const x = (targetData >> 6) & 0x1f;
        const y = (targetData >> 11) & 0x1f;
        if (x < 0 || y < 0 || x >= map.descriptor.width || y >= map.descriptor.height) return false;

        const cellFlag = map.cellFlags[x][y];
        if (((cellFlag >> 5) & 0x7) !== RoomType.DOOR) return false;

        const action = this.resolveActuatorAction(actuator.actionType, actuator.revertEffect, pressed);
        if (action < 0) return false;

        return this.applyDoorActionAt(map, x, y, cellFlag, action);
    }

    /**
     * Trigger wall actuators on the cell in front of the party.
     */
    triggerWallActuators(position: Position, facing: number): boolean {
        const target = this.getForwardPosition(position, facing);
        if (!target) return false;
        const touchedPosition = (facing + 2) & 0x3;
        return this.triggerActuatorsAt(target, touchedPosition, facing, true, 'wall');
    }

    /**
     * Trigger floor pressure pads in a cell (party stepping on/off).
     */
    triggerPressurePads(position: Position, facing: number, pressed: boolean): boolean {
        const tile = this.getTile(position);
        if (!tile) return false;
        if (tile.roomType !== RoomType.OPEN && tile.roomType !== RoomType.PIT) return false;
        return this.triggerActuatorsAt(position, 0, facing, pressed, 'floor');
    }

    getWeaponRecord(rn: ObjectID): WeaponRecord | null {
        const { category, index } = decodeObjectID(rn);
        if (category !== DBType.WEAPON) return null;
        return this.data.databases.weapons.records[index] ?? null;
    }

    getClothingRecord(rn: ObjectID): ClothingRecord | null {
        const { category, index } = decodeObjectID(rn);
        if (category !== DBType.CLOTHING) return null;
        return this.data.databases.clothing.records[index] ?? null;
    }

    getScrollRecord(rn: ObjectID): ScrollRecord | null {
        const { category, index } = decodeObjectID(rn);
        if (category !== DBType.SCROLL) return null;
        return this.data.databases.scrolls.records[index] ?? null;
    }

    getPotionRecord(rn: ObjectID): PotionRecord | null {
        const { category, index } = decodeObjectID(rn);
        if (category !== DBType.POTION) return null;
        return this.data.databases.potions.records[index] ?? null;
    }

    getContainerRecord(rn: ObjectID): ContainerRecord | null {
        const { category, index } = decodeObjectID(rn);
        if (category !== DBType.CHEST) return null;
        return this.data.databases.containers.records[index] ?? null;
    }

    getMiscRecord(rn: ObjectID): MiscRecord | null {
        const { category, index } = decodeObjectID(rn);
        if (category !== DBType.MISC) return null;
        return this.data.databases.misc.records[index] ?? null;
    }

    getCreatureRecord(rn: ObjectID): CreatureRecord | null {
        const { category, index } = decodeObjectID(rn);
        if (category !== DBType.CREATURE) return null;
        return this.data.databases.creatures.records[index] ?? null;
    }

    getMissileRecord(rn: ObjectID): MissileRecord | null {
        const { category, index } = decodeObjectID(rn);
        if (category !== DBType.MISSILE) return null;
        return this.data.databases.missiles.records[index] ?? null;
    }

    getCloudRecord(rn: ObjectID): CloudRecord | null {
        const { category, index } = decodeObjectID(rn);
        if (category !== DBType.CLOUD) return null;
        return this.data.databases.clouds.records[index] ?? null;
    }

    getItem16Record(index: number): Item16Record | null {
        const items = this.data.item16;
        if (!items || index < 0 || index >= items.length) return null;
        return items[index] ?? null;
    }

    getTimerRecord(index: number): TimerRecord | null {
        const timers = this.data.timers;
        if (!timers || index < 0 || index >= timers.length) return null;
        return timers[index] ?? null;
    }

    getTimerWord8(index: number): ui16 | null {
        const rec = this.getTimerRecord(index);
        return rec ? rec.timerWord8 : null;
    }

    getMonsterRenderState(creature: CreatureRecord): { positions: ui8; facings: ui8; statuses: Uint8Array } {
        const groupIndex = creature.groupIndex;
        if (groupIndex !== undefined) {
            const item16 = this.getItem16Record(groupIndex);
            if (item16) {
                const statuses = new Uint8Array(4);
                for (let i = 0; i < 4; i++) statuses[i] = item16.singleMonsterStatus[i] ?? 0;
                return {
                    positions: item16.positions,
                    facings: item16.facings,
                    statuses
                };
            }
        }

        const face = creature.facing & 0x3;
        const facings = (face | (face << 2) | (face << 4) | (face << 6)) & 0xff;
        return {
            positions: creature.positions,
            facings,
            statuses: new Uint8Array(4)
        };
    }

    /**
     * Check if a position is walkable (not a wall)
     * @returns True if position is walkable
     */
    isWalkable(position: Position): boolean {
        const tile = this.getTile(position);
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
                {
                    const doorState = tile.attributes & 0x7;
                    return doorState <= 1 || doorState === 5;
                }
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

    private getForwardPosition(position: Position, facing: number): Position | null {
        switch (facing & 3) {
            case 0: return position.north;
            case 1: return position.east;
            case 2: return position.south;
            case 3: return position.west;
            default: return null;
        }
    }

    private triggerActuatorsAt(
        position: Position,
        requiredPos: number,
        facing: number,
        pressed: boolean,
        mode: 'wall' | 'floor'
    ): boolean {
        let changed = false;
        for (let rn = this.findFirstObject(position); rn !== OBJECT_ID_EOF; rn = this.getDBRecordLink(rn)) {
            const decoded = decodeObjectID(rn);
            if (decoded.category !== DBType.ACTUATOR) continue;
            if ((decoded.position & 0x3) !== (requiredPos & 0x3)) continue;
            const rec = this.data.databases.actuators.records[decoded.index];
            if (!rec || rec.sensorType === 0) continue;
            if (mode === 'wall' && !this.isWallClickActuator(rec.sensorType)) continue;
            if (mode === 'floor' && !this.isPressurePadActuator(rec.sensorType)) continue;

            let pressedNow = pressed;
            if (rec.sensorType === 3 && rec.data !== 0) {
                pressedNow = pressedNow && ((facing + 1) & 0x3) === (rec.data & 0x3);
            }

            if (this.applyActuatorToDoor(rec, position, pressedNow)) changed = true;
        }
        return changed;
    }

    private isWallClickActuator(sensorType: number): boolean {
        return sensorType === 1 || sensorType === 2;
    }

    private isPressurePadActuator(sensorType: number): boolean {
        return sensorType === 1 || sensorType === 2 || sensorType === 3;
    }

    private resolveActuatorAction(actionType: number, normallyClosed: boolean, pressed: boolean): number {
        const switchClosed = pressed !== normallyClosed;
        const action = actionType & 0x3;
        if (action === 3) return switchClosed ? 0 : 1;
        if (!switchClosed) return -1;
        return action;
    }

    private applyDoorActionAt(map: MapData, x: number, y: number, cellFlag: CellFlag, action: number): boolean {
        const doorState = cellFlag & 0x7;
        if (doorState === 5) return false;

        let nextState = doorState;
        if (action === 0) {
            if (doorState === 0) return false;
            nextState = 0;
        } else if (action === 1) {
            if (doorState === 4) return false;
            nextState = 4;
        } else if (action === 2) {
            nextState = doorState === 0 ? 4 : 0;
        } else {
            return false;
        }

        if (nextState === doorState) return false;

        const newAttr = (cellFlag & 0x8) | (nextState & 0x7);
        const newCellFlag = (cellFlag & 0xf0) | newAttr;
        map.cellFlags[x][y] = newCellFlag;
        const tile = map.tiles[x][y];
        tile.cellFlag = newCellFlag;
        tile.attributes = newAttr;
        return true;
    }

    /**
     * Check if a position is a wall
     * @returns True if position is a wall
     */
    isWall(position: Position): boolean {
        const tile = this.getTile(position);
        if (!tile) return true; // Out of bounds = wall
        return tile.roomType === RoomType.STONE || tile.roomType === RoomType.FALSEWALL;
    }

    /**
     * Check if a position is a door
     * @returns True if position is a door
     */
    isDoor(position: Position): boolean {
        const tile = this.getTile(position);
        return tile?.roomType === RoomType.DOOR;
    }

    /**
     * Check if a position is a pit
     * @returns True if position is a pit
     */
    isPit(position: Position): boolean {
        const tile = this.getTile(position);
        return tile?.roomType === RoomType.PIT;
    }

    /**
     * Check if a position is a teleporter
     * @returns True if position is a teleporter
     */
    isTeleporter(position: Position): boolean {
        const tile = this.getTile(position);
        return tile?.roomType === RoomType.TELEPORTER;
    }

    /**
     * Check if a position is stairs
     * @returns True if position is stairs
     */
    isStairs(position: Position): boolean {
        const tile = this.getTile(position);
        return tile?.roomType === RoomType.STAIRS;
    }

    /**
     * Check if a position has objects
     * @returns True if position has objects
     */
    hasObjects(position: Position): boolean {
        const tile = this.getTile(position);
        return tile?.hasObjects || false;
    }

    // Get start position from dungeon header
    getStartPosition(): Position {
        return new Position(this.data.header.startPosition.x, this.data.header.startPosition.y, 0);
    }

    // Get start facing direction
    getStartFacing(): number {
        return this.data.header.startPosition.facing;
    }

    // Get start map index (level)
    getStartMapIndex(): ui8 {
        return this.data.header.startPosition.z || 0;
    }

    decodeWallTextBytes(record: TextRecord, tables?: TextDecodeTables): Uint8Array | null {
        return this.decodeTextBytes(record, 0, 990, tables);
    }

    decodeTextBytes(record: TextRecord, typeOfText: number, max: number, tables?: TextDecodeTables): Uint8Array | null {
        const force = (typeOfText & 0x8000) !== 0;
        if (!record.visible && !force) return null;

        const indirectIndex = this.data.indirectTextIndex;
        const compressed = this.data.compressedText;
        if (indirectIndex && compressed && record.textIndex !== undefined) {
            const startWord = indirectIndex[record.textIndex] ?? 0;
            return this.decodeTextFromWords(compressed, startWord, typeOfText, max, tables);
        }

        const words = this.data.textWords;
        if (!words) return null;
        return this.decodeTextFromWords(words, record.textOffset, typeOfText, max, tables);
    }

    decodeTextString(record: TextRecord, typeOfText: number, tables?: TextDecodeTables): string | null {
        const bytes = this.decodeTextBytes(record, typeOfText, 990, tables);
        if (!bytes) return null;
        return typeOfText === 0
            ? this.wallTextBytesToString(bytes)
            : this.textBytesToString(bytes);
    }

    decodeMessageText(record: TextRecord, tables?: TextDecodeTables): string | null {
        return this.decodeTextString(record, 1, tables);
    }

    decodeScrollText(scroll: ScrollRecord, tables?: TextDecodeTables): string | null {
        const rec = this.getTextRecordByIndex(scroll.textReference);
        if (!rec) return null;
        return this.decodeTextString(rec, 0x8002, tables);
    }

    private decodeTextFromWords(
        words: ui16[],
        startWord: number,
        typeOfText: number,
        max: number,
        tables?: TextDecodeTables
    ): Uint8Array | null {
        if (startWord < 0 || startWord >= words.length) return null;

        const out: number[] = [];
        let wordIndex = startWord;
        let word = 0;
        let bitPos = 0;
        let slashCount = 0;
        let escapeCode = 0;

        let separator = 0;
        if ((typeOfText & 0x7fff) === 1) {
            out.push(10);
            separator = 32;
        } else if (typeOfText === 0) {
            separator = 0x80;
        } else {
            separator = 10;
        }

        while (out.length < max - 2) {
            if (bitPos === 0) {
                word = words[wordIndex++] ?? 0;
            }

            let code: number;
            if (bitPos === 0) code = (word >> 10) & 0x1f;
            else if (bitPos === 1) code = (word >> 5) & 0x1f;
            else code = word & 0x1f;
            bitPos = (bitPos + 1) % 3;

            if (code === 28) slashCount++;
            else slashCount = 0;

            if (escapeCode !== 0) {
                if (tables) {
                    if (escapeCode === 30) {
                        const table = typeOfText === 0 ? tables.escape2Wall : tables.escape2Other;
                        this.appendEscapeString(out, table, 8, code, max);
                    } else {
                        this.appendEscapeString(out, tables.escape1, 2, code, max);
                    }
                }
                escapeCode = 0;
                continue;
            }

            if (code < 28) {
                let outCode = code;
                if (typeOfText !== 0) {
                    if (code === 26) outCode = 32;
                    else if (code === 27) outCode = 46;
                    else outCode = code + 65;
                }
                out.push(outCode);
                continue;
            }

            if (code === 28) {
                if (separator === 32 && slashCount === 2 && out.length > 0) {
                    out[out.length - 1] = 10;
                } else {
                    out.push(separator);
                }
                continue;
            }

            if (code <= 30) {
                escapeCode = code;
                continue;
            }

            break; // 31 end of text
        }

        out.push(typeOfText === 0 ? 0x81 : 0);
        return Uint8Array.from(out);
    }

    private wallTextBytesToString(bytes: Uint8Array): string {
        let out = '';
        for (const b of bytes) {
            if (b === 0x81) break;
            if (b === 0x80) {
                out += '\n';
                continue;
            }
            if (b >= 0 && b <= 25) out += String.fromCharCode(65 + b);
            else if (b === 26) out += ' ';
            else if (b === 27) out += '.';
        }
        return out;
    }

    private textBytesToString(bytes: Uint8Array): string {
        let out = '';
        for (const b of bytes) {
            if (b === 0) break;
            if (b === 10) {
                out += '\n';
                continue;
            }
            out += String.fromCharCode(b);
        }
        return out;
    }

    private getTextRecordByIndex(index: number): TextRecord | null {
        if (index < 0 || index >= this.data.databases.texts.records.length) return null;
        return this.data.databases.texts.records[index] ?? null;
    }

    private appendEscapeString(out: number[], table: Uint8Array, entrySize: number, index: number, max: number): void {
        const base = index * entrySize;
        for (let i = 0; i < entrySize && base + i < table.length; i++) {
            const value = table[base + i] ?? 0;
            if (value === 0) break;
            if (out.length >= max - 2) return;
            out.push(value);
        }
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
