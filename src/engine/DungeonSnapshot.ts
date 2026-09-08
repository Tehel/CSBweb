/**
 * A snapshot of everything in the dungeon that play can change.
 *
 * The quick-save used to carry the party, the tick count, the `ITEM16` pool, the
 * timers and the missile records — and nothing else. Every *world* mutation was
 * therefore lost on load while the party kept its inventory: doors closed again,
 * objects the party had moved snapped back to where `dungeon.dat` put them, fired
 * actuators re-armed. A door opened with a key that the load did not give back is
 * unopenable, which makes the save unrecoverable rather than merely wrong.
 *
 * This is *not* Phase 10. Phase 10 writes a byte-compatible CSBWin save file; this
 * is the runtime JSON snapshot, and it only has to round-trip through itself.
 *
 * What mutates, and so what is here:
 *
 * - `cellFlags` — door state, pit open/closed, false walls, teleporters, and the
 *   has-objects bit. `MapData.tiles` is a pure derivation of the cell flag byte
 *   (`DungeonLoader.parseMapData`), so it is rebuilt on restore rather than stored.
 * - `objectList` — the per-cell object chains. Every pick-up, drop and throw edits
 *   it. `columnIndex` / `levelIndex` are structural and never written, so they stay
 *   out.
 * - every database's records — links, charges, container contents, creature hit
 *   points, actuator counters. The arrays also *grow*: `CreateAndDropObject`,
 *   `Game.createMiscObject` and `MonsterSystem.createMonster` all append.
 * - `dsaIndex` state machine positions (`DsaSystem` writes `dsa.state`) and the DSA
 *   global variables, which is where a dungeon keeps its puzzle progress.
 * - the champion-bones map, which is pure runtime state.
 */
import type { ui8, ui16, ObjectID } from '../core/types';
import type { DungeonData, DatabaseRecord, Databases } from '../data/dungeonTypes';

/** The database keys, fixed here so capture and restore cannot drift apart. */
const DATABASE_KEYS = [
    'doors',
    'teleporters',
    'texts',
    'actuators',
    'creatures',
    'weapons',
    'clothing',
    'scrolls',
    'potions',
    'containers',
    'misc',
    'missiles',
    'clouds',
] as const satisfies ReadonlyArray<keyof Databases>;

type DatabaseKey = (typeof DATABASE_KEYS)[number];

export interface DungeonSnapshot {
    /** One base64 string per map: the cell flags in `[x][y]` order, row-major over x. */
    cellFlags: string[];
    objectList: ObjectID[];
    /** Every database's records, by key. A database absent from the map is left alone. */
    databases: Partial<Record<DatabaseKey, DatabaseRecord[]>>;
    /** `dsaIndex.entries[i].state`, or null where the entry is empty. */
    dsaStates?: Array<ui16 | null>;
    /** `DsaSystem`'s 100 global variables. */
    dsaGlobals?: number[];
    /** The champion-bones map, as `[key, fingerprint]` pairs. */
    championBones?: Array<[number, number]>;
}

/**
 * Copy one record. Records are flat bags of numbers and booleans with a single
 * exception — `CreatureRecord.hp` is a `ui16[]` — so cloning one level of array is
 * enough, and doing it generically means a new array field cannot silently alias.
 */
function cloneRecord<T extends object>(record: T): T {
    const copy: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
        copy[key] = Array.isArray(value) ? [...value] : value;
    }
    return copy as T;
}

function encodeCellFlags(cellFlags: ui8[][]): string {
    const width = cellFlags.length;
    const height = width > 0 ? cellFlags[0].length : 0;
    const bytes = new Uint8Array(width * height);
    let at = 0;
    for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) bytes[at++] = cellFlags[x][y] & 0xff;
    }
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
}

function decodeCellFlags(encoded: string, width: number, height: number): ui8[][] {
    const binary = atob(encoded);
    if (binary.length !== width * height) {
        throw new Error(`cell flag block is ${binary.length} bytes, expected ${width * height}`);
    }
    const cellFlags: ui8[][] = [];
    let at = 0;
    for (let x = 0; x < width; x++) {
        cellFlags[x] = [];
        for (let y = 0; y < height; y++) cellFlags[x][y] = binary.charCodeAt(at++) & 0xff;
    }
    return cellFlags;
}

export function captureDungeonSnapshot(data: DungeonData): DungeonSnapshot {
    const databases: Partial<Record<DatabaseKey, DatabaseRecord[]>> = {};
    for (const key of DATABASE_KEYS) {
        const database = data.databases[key];
        if (!database) continue;
        databases[key] = database.records.map((record) => cloneRecord(record));
    }

    const snapshot: DungeonSnapshot = {
        cellFlags: data.maps.map((map) => encodeCellFlags(map.cellFlags)),
        objectList: [...data.objectList],
        databases,
    };

    if (data.dsaIndex) {
        snapshot.dsaStates = data.dsaIndex.entries.map((entry) => (entry ? entry.state : null));
    }

    return snapshot;
}

export function applyDungeonSnapshot(data: DungeonData, snapshot: DungeonSnapshot): void {
    if (snapshot.cellFlags.length !== data.maps.length) {
        throw new Error(
            `snapshot has ${snapshot.cellFlags.length} maps, dungeon has ${data.maps.length}`,
        );
    }

    data.maps.forEach((map, index) => {
        const { width, height } = map.descriptor;
        const cellFlags = decodeCellFlags(snapshot.cellFlags[index], width, height);
        for (let x = 0; x < width; x++) {
            for (let y = 0; y < height; y++) {
                const cellFlag = cellFlags[x][y];
                map.cellFlags[x][y] = cellFlag;
                // `tiles` is derived from the cell flag byte, exactly as the loader
                // derives it (`DungeonLoader.parseMapData`), and the engine keeps the
                // two in step (`DungeonState.setCellHasObjects`, `setDoorState`).
                const tile = map.tiles[x]?.[y];
                if (!tile) continue;
                tile.cellFlag = cellFlag;
                tile.roomType = (cellFlag >> 5) & 0x7;
                tile.hasObjects = (cellFlag & 0x10) !== 0;
                tile.attributes = cellFlag & 0xf;
            }
        }
    });

    data.objectList.length = 0;
    data.objectList.push(...snapshot.objectList);

    for (const key of DATABASE_KEYS) {
        const records = snapshot.databases[key];
        if (!records) continue;
        const database = data.databases[key];
        if (!database) continue;
        // Replace in place: the databases object is shared by reference all over the
        // engine, and the arrays grow during play, so length must follow the snapshot.
        database.records.length = 0;
        for (const record of records) {
            (database.records as DatabaseRecord[]).push(cloneRecord(record));
        }
        database.count = database.records.length;
    }

    if (snapshot.dsaStates && data.dsaIndex) {
        snapshot.dsaStates.forEach((state, index) => {
            const entry = data.dsaIndex?.entries[index];
            if (entry && state !== null) entry.state = state;
        });
    }
}
