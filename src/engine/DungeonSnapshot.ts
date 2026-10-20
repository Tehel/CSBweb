/**
 * A snapshot of everything in the dungeon that play can change. The state a read
 * restores (`RuntimeSave.ts`) carries it, and a save's load restores its world through
 * it (`src/engine/CsbwinSaveGame.ts`). It is never written: a save is the CSBWin file
 * (`src/engine/SaveGameFile.ts`).
 *
 * `DUNGEON_DATA_SOURCES` is the list of what it holds: every field of `DungeonData`, and
 * where a restore takes it from. It is typed over every key, so a field added to
 * `DungeonData` does not compile until it is placed there, and `tools/dump-savegame.ts`
 * walks it to check that play wrote no `loaded` field and that every `snapshot` field
 * comes back.
 *
 * Two placements need their reason:
 *
 * - `columnIndex` looks structural and is not. `DungeonState.addObjectToCell` and
 *   `removeObjectFromCell` rewrite every later entry whenever a cell gains or loses its
 *   last object, as CSBWin does (`doc/CSBwin-src/CSBCode.cpp:5276-5289`), and CSBWin
 *   saves the array beside the object list (`doc/CSBwin-src/SaveGame.cpp:1252`).
 *   Restoring `objectList` without it makes `GetObjectListIndex` read every cell's chain
 *   at the wrong offset, so objects vanish from the cells that hold them and surface in
 *   cells that do not. `levelIndex` really is structural: `DungeonLoader.buildLevelIndex`
 *   derives it from the map descriptors and nothing writes it.
 * - `textWords`, `indirectTextIndex` and `compressedText` are carried although play never
 *   writes them. They are the *converted* form of an image, and which form a world holds
 *   depends on the file it came from (`src/data/CsbwinDungeonConversions.ts`). Without
 *   them a restored world is a hybrid: TEXT records from the snapshot, carrying entry
 *   numbers into the index `dungeon.dat` was converted into. Carrying them makes a
 *   restore self-consistent, and lets the binary writer take blocks 11-13 from a world
 *   whatever its provenance.
 * - `expool` is database 11, which play writes: a death puts the bones' record there
 *   (`src/data/CsbwinExpool.ts`). The rest of it is the file's, and this port cannot
 *   regenerate it.
 * - `dsaLevelIndex`, `dsaIndex`, `specialLocations`, `extendedWallDecorations`,
 *   `spellFilterLocation`, `hintKey` and `gameInfo` are carried for the same reason. `dungeon.dat` has none of
 *   them; a CSBWin save's Extended Features block and `EXPOOL` do, and a CSBWin load
 *   writes them into the world (`buildCsbwinRuntimeState`). Only each DSA's `state`
 *   changes in play, but `dsaIndex` goes in whole, since it is the save's.
 */
import type { ui8, ui16, ui32, ObjectID } from '../core/types';
import type { DungeonData, DatabaseRecord, Databases, DsaDefinition, DsaIndex } from '../data/dungeonTypes';

/**
 * Where a restored world takes a field from:
 *
 * - `snapshot`: this snapshot, captured and applied below;
 * - `runtimeSave`: `RuntimeSave`, which carries it beside the snapshot and puts it back
 *   through `applySaveGameState`;
 * - `loaded`: the file the world was built from. Play never writes it.
 */
export type FieldSource = 'snapshot' | 'runtimeSave' | 'loaded';

type Each<T> = T extends ReadonlyArray<infer E> ? NonNullable<E> : T;

/**
 * A source for every field of `T`, or, for an object field, a table of its own fields
 * (of each element, for an array). Every key is required.
 */
export type SourceTable<T> = {
    readonly [K in keyof T]-?:
        | FieldSource
        | (Each<NonNullable<T[K]>> extends object ? SourceTable<Each<NonNullable<T[K]>>> : never);
};

export const DUNGEON_DATA_SOURCES = {
    header: {
        randomSeed: 'loaded',
        mapDataSize: 'loaded',
        numMaps: 'loaded',
        word4Low: 'loaded',
        // Set by the load-time text conversion, beside `indirectTextIndex`.
        textDataSize: 'loaded',
        startPosition: 'loaded',
        facing: 'loaded',
        // The mutations that edit `objectList` and the databases maintain both
        // (`DungeonState.addObjectToCell`, `findEmptyDBEntry`), and CSBWin saves the
        // 44-byte header (`doc/CSBwin-src/SaveGame.cpp:1236`).
        objectListSize: 'snapshot',
        objectCounts: 'snapshot',
    },
    maps: {
        descriptor: 'loaded',
        // Door state, pits, false walls, teleporters and the has-objects bit: the one
        // copy of the cell byte.
        cellFlags: 'snapshot',
        monsterTypes: 'loaded',
        wallDecorationTOC: 'loaded',
        floorDecorationTOC: 'loaded',
        doorDecorationTOC: 'loaded',
    },
    // Links, charges, container contents, creature hit points, actuator counters. The
    // arrays grow too: `CreateAndDropObject`, `Game.createMiscObject` and
    // `MonsterSystem.createMonster` append.
    databases: {
        doors: 'snapshot',
        teleporters: 'snapshot',
        texts: 'snapshot',
        actuators: 'snapshot',
        creatures: 'snapshot',
        weapons: 'snapshot',
        clothing: 'snapshot',
        scrolls: 'snapshot',
        potions: 'snapshot',
        containers: 'snapshot',
        misc: 'snapshot',
        missiles: 'snapshot',
        clouds: 'snapshot',
    },
    textWords: 'snapshot',
    indirectTextIndex: 'snapshot',
    compressedText: 'snapshot',
    objectList: 'snapshot',
    // Every RN is a slot of these, so they travel with the object list.
    rnMaps: 'snapshot',
    columnIndex: 'snapshot',
    levelIndex: 'loaded',
    item16: 'runtimeSave',
    expool: 'snapshot',
    dsaLevelIndex: 'snapshot',
    dsaIndex: 'snapshot',
    specialLocations: 'snapshot',
    extendedWallDecorations: 'snapshot',
    spellFilterLocation: 'snapshot',
    hintKey: 'snapshot',
    gameInfo: 'snapshot',
    bigActuators: 'loaded',
    indirectText: 'loaded',
    newScrolls: 'loaded',
    // Read into `block1` when a new game is made (`newGameBlock1`), which a save carries.
    word22592: 'loaded',
    // Read into `ctx.rules` when a new game is made (`Game.readNewGameRules`); a save
    // carries the rules itself.
    extendedFeatures: 'loaded',
    // Read into `ctx.rules` with them; a save of the game is enciphered in its turn.
    simpleEncipher: 'loaded',
} as const satisfies SourceTable<DungeonData>;

type DatabaseKey = keyof Databases;

/** The database keys, taken from the table so capture and restore cannot drift apart. */
const DATABASE_KEYS = Object.keys(DUNGEON_DATA_SOURCES.databases) as DatabaseKey[];

/** `DsaIndex.entries` as JSON holds it: each program as base64 of big-endian words. */
type DsaIndexSnapshot = Array<
    | (Omit<DsaDefinition, 'states'> & {
          states: Array<{ actions: Array<{ column: number; program: string }> } | null>;
      })
    | null
>;

export interface DungeonSnapshot {
    /** One base64 string per map: the cell flags in `[x][y]` order, row-major over x. */
    cellFlags: string[];
    objectList: ObjectID[];
    /**
     * `data.rnMaps`: `dataTypeMap` as base64, `dataIndexMap` as base64 of big-endian
     * words. Every RN of the snapshot is a slot of these.
     */
    rnMaps: { typeMap: string; indexMap: string };
    /** `data.columnIndex` — the per-column offset into `objectList`. */
    columnIndex: ui16[];
    /** `data.header.objectListSize`. */
    objectListSize: ui16;
    /** `data.header.objectCounts`. */
    objectCounts: ui16[];
    /** Every database's records, by key. A database absent from the map is left alone. */
    databases: Partial<Record<DatabaseKey, DatabaseRecord[]>>;
    /**
     * `data.textWords`, base64 of big-endian words. After the load-time conversion this
     * is the compressed text, which is why it and `compressedText` normally hold the
     * same bytes; they are stored separately because nothing guarantees it.
     */
    textWords?: string;
    /** `data.indirectTextIndex` — word offsets into `compressedText`. */
    indirectTextIndex?: ui32[];
    /** `data.compressedText`, base64 of big-endian words. */
    compressedText?: string;
    /**
     * `data.expool` — database 11, base64, or `null` for a world with no block, which a
     * restore then removes: the champion bones records are in it.
     */
    expool?: string | null;
    /**
     * `data.dsaLevelIndex`, one base64 string of big-endian words per level. This and the
     * next five are what a CSBWin load writes. Each is `null` where the world has none,
     * which a restore then removes.
     */
    dsaLevelIndex?: string[] | null;
    /** `data.dsaIndex.entries`. */
    dsaIndex?: DsaIndexSnapshot | null;
    /** `data.specialLocations`, as `[location, value]` pairs. */
    specialLocations?: Array<[number, number]> | null;
    extendedWallDecorations?: boolean | null;
    spellFilterLocation?: number | null;
    /** `data.hintKey`, base64. */
    hintKey?: string | null;
    /** `data.gameInfo`, its text base64. */
    gameInfo?: { size: number; text: string } | null;
}

function encodeBytes(bytes: Uint8Array): string {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
}

function decodeBytes(encoded: string): Uint8Array {
    const binary = atob(encoded);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i) & 0xff;
    return out;
}

/** Words as big-endian bytes, so a 1749-word text array costs 4.7 KB rather than 12. */
function encodeWords(words: ArrayLike<ui16>): string {
    const bytes = new Uint8Array(words.length * 2);
    for (let i = 0; i < words.length; i++) {
        bytes[i * 2] = (words[i] >> 8) & 0xff;
        bytes[i * 2 + 1] = words[i] & 0xff;
    }
    return encodeBytes(bytes);
}

function decodeWords(encoded: string): ui16[] {
    const bytes = decodeBytes(encoded);
    const words: ui16[] = [];
    for (let i = 0; i + 1 < bytes.length; i += 2) words.push((bytes[i] << 8) | bytes[i + 1]);
    return words;
}

function encodeDsaIndex(index: DsaIndex): DsaIndexSnapshot {
    return index.entries.map(
        (entry) =>
            entry && {
                ...entry,
                states: entry.states.map(
                    (state) =>
                        state && {
                            actions: state.actions.map(({ column, program }) => ({
                                column,
                                program: encodeWords(program),
                            })),
                        },
                ),
            },
    );
}

function decodeDsaIndex(entries: DsaIndexSnapshot): DsaIndex {
    return {
        entries: entries.map(
            (entry) =>
                entry && {
                    ...entry,
                    states: entry.states.map(
                        (state) =>
                            state && {
                                actions: state.actions.map(({ column, program }) => ({
                                    column,
                                    program: Uint16Array.from(decodeWords(program)),
                                })),
                            },
                    ),
                },
        ),
    };
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
        rnMaps: { typeMap: encodeBytes(data.rnMaps.typeMapBytes()), indexMap: encodeWords(data.rnMaps.indexMapWords()) },
        columnIndex: [...data.columnIndex],
        objectListSize: data.header.objectListSize,
        objectCounts: [...data.header.objectCounts],
        databases,
    };

    if (data.textWords) snapshot.textWords = encodeWords(data.textWords);
    if (data.indirectTextIndex) snapshot.indirectTextIndex = [...data.indirectTextIndex];
    if (data.compressedText) snapshot.compressedText = encodeWords(data.compressedText);
    snapshot.expool = data.expool ? encodeBytes(data.expool) : null;

    snapshot.dsaLevelIndex = data.dsaLevelIndex ? data.dsaLevelIndex.map(encodeWords) : null;
    snapshot.dsaIndex = data.dsaIndex ? encodeDsaIndex(data.dsaIndex) : null;
    snapshot.specialLocations = data.specialLocations
        ? Object.entries(data.specialLocations).map(([location, value]) => [Number(location), value])
        : null;
    snapshot.extendedWallDecorations = data.extendedWallDecorations ?? null;
    snapshot.spellFilterLocation = data.spellFilterLocation ?? null;
    snapshot.hintKey = data.hintKey ? encodeBytes(data.hintKey) : null;
    snapshot.gameInfo = data.gameInfo ? { size: data.gameInfo.size, text: encodeBytes(data.gameInfo.text) } : null;

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
                map.cellFlags[x][y] = cellFlags[x][y];
            }
        }
    });

    data.objectList.length = 0;
    data.objectList.push(...snapshot.objectList);
    data.rnMaps.restore(decodeBytes(snapshot.rnMaps.typeMap), decodeWords(snapshot.rnMaps.indexMap));

    // The column index has to land with the object list it indexes: the two are one
    // structure, and half of it is worse than none.
    data.columnIndex.length = 0;
    data.columnIndex.push(...snapshot.columnIndex);

    data.header.objectListSize = snapshot.objectListSize;
    data.header.objectCounts.length = 0;
    data.header.objectCounts.push(...snapshot.objectCounts);

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

    // The converted image. A snapshot written before these were captured has none of
    // them, and leaving what the world already holds is the right answer for such a file
    // — it is `dungeon.dat`'s, which is what the save was taken against.
    if (snapshot.textWords !== undefined) data.textWords = decodeWords(snapshot.textWords);
    if (snapshot.indirectTextIndex !== undefined) {
        data.indirectTextIndex = [...snapshot.indirectTextIndex];
    }
    if (snapshot.compressedText !== undefined) {
        data.compressedText = decodeWords(snapshot.compressedText);
    }
    if (snapshot.expool === null) delete data.expool;
    else if (snapshot.expool !== undefined) data.expool = decodeBytes(snapshot.expool);

    // The same holds for the five a CSBWin load writes, and `null` is a world that had
    // none.
    if (snapshot.dsaLevelIndex === null) delete data.dsaLevelIndex;
    else if (snapshot.dsaLevelIndex) data.dsaLevelIndex = snapshot.dsaLevelIndex.map(decodeWords);
    if (snapshot.dsaIndex === null) delete data.dsaIndex;
    else if (snapshot.dsaIndex) data.dsaIndex = decodeDsaIndex(snapshot.dsaIndex);
    if (snapshot.specialLocations === null) delete data.specialLocations;
    else if (snapshot.specialLocations) data.specialLocations = Object.fromEntries(snapshot.specialLocations);
    if (snapshot.extendedWallDecorations === null) delete data.extendedWallDecorations;
    else if (snapshot.extendedWallDecorations !== undefined) {
        data.extendedWallDecorations = snapshot.extendedWallDecorations;
    }
    if (snapshot.spellFilterLocation === null) delete data.spellFilterLocation;
    else if (snapshot.spellFilterLocation !== undefined) data.spellFilterLocation = snapshot.spellFilterLocation;
    if (snapshot.hintKey === null) delete data.hintKey;
    else if (snapshot.hintKey) data.hintKey = decodeBytes(snapshot.hintKey);
    if (snapshot.gameInfo === null) delete data.gameInfo;
    else if (snapshot.gameInfo) data.gameInfo = { size: snapshot.gameInfo.size, text: decodeBytes(snapshot.gameInfo.text) };
}
