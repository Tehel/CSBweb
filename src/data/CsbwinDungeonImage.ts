/**
 * Read the world out of a genuine CSBWin save file.
 *
 * Blocks 7-14 of a save are the dungeon image: the same structure as `dungeon.dat`,
 * written plain and uncompressed after the timer queue. `LoadGame` reaches it by
 * calling `ReadDatabases()` there (`doc/CSBwin-src/SaveGame.cpp:1739`) with
 * `d.gameState == GAMESTATE_ResumeSavedGame`, which makes that function skip its own
 * extended-features/compression preamble (`:2345-2374`) and stream straight on.
 *
 * Because the structure is `dungeon.dat`'s, this does not reimplement fourteen record
 * parsers — it hands the byte range to `DungeonLoader` with the three differences the
 * save's Extended Features block declares. Those differences, and the evidence for
 * them, are in `doc/PROVEN_FACTS.md` → "The dungeon image layout in a save file".
 */
import { readU16BE, writeU16BE } from '../core/bytes';
import type { CsbwinObjectIndex } from './CsbwinObjectIndex';
import { DungeonLoader } from './DungeonLoader';
import { loadSaveGameState, type DungeonImageLayout } from './SaveGameLoader';
import type { DungeonData } from './dungeonTypes';

export interface CsbwinWorld {
    dungeon: DungeonData;
    /** Everything blocks 0-6 carried, already unscrambled and checksummed. */
    save: ReturnType<typeof loadSaveGameState>;
}

/**
 * Parse a whole CSBWin save: blocks 0-6 through `loadSaveGameState`, then the dungeon
 * image through `DungeonLoader`.
 *
 * Throws if any block or the image fails its checksum or the layout does not close, so a
 * caller that gets a result has a world it can trust rather than a half-parsed one.
 */
export function loadCsbwinWorld(bytes: Uint8Array): CsbwinWorld {
    const save = loadSaveGameState(bytes);
    const imageOffset = save.dungeonImageOffset;
    if (imageOffset === undefined) throw new Error('save has no dungeon image');

    const layout = save.imageLayout;
    if (!layout) throw new Error('the dungeon image header did not parse');

    // The closure check, done here rather than left to a tool: the image's last section
    // is the cell flags, whose length the Extended Features block declares, and after it
    // there is only `WriteAndChecksum`'s final word (`doc/CSBwin-src/SaveGame.cpp:1222`).
    // If any section length is wrong the sum misses, and parsing on would read records
    // out of the middle of neighbouring sections rather than fail.
    const cellFlagArraySize = save.cellFlagArraySize ?? 0;
    const end = layout.cellFlags + cellFlagArraySize;
    if (cellFlagArraySize === 0 || end !== bytes.length - 2) {
        throw new Error(
            `dungeon image does not close: cell flags end at ${end}, file ends at ${bytes.length - 2}`,
        );
    }

    const loader = new DungeonLoader();
    const objectIndex = save.objectIndex;
    const image = bytes.subarray(imageOffset);
    const mended = objectIndex && mendDoorZero(image, imageOffset, layout, cellFlagArraySize, objectIndex);
    const dungeon = loader.loadFromArray(mended || image, {
        bigActuators: save.bigActuators ?? false,
        newScrolls: (save.version ?? 0) >= 0x42, // extended features version 'B'
        indirectText: save.indirectText ?? false,
        expandedPortraits: save.expandedPortraits ?? false,
        expool: true,
        cellFlagArraySize,
        // Every RN in a save's image is a slot number in the object indirect index, not
        // the packed RN `dungeon.dat` stores — see `src/data/CsbwinObjectIndex.ts`.
        objectIndex,
    });

    return { dungeon, save };
}

/** The databases whose records begin with their link: all but `EXPOOL` (11), 12 and 13. */
const RECORDS_WITH_A_LINK = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 14, 15];

/**
 * The image of a save the port wrote before its RNs were CSBWin's slots, mended: `null`
 * for any other file.
 *
 * That writer gave every record of every database a slot, in database then record order
 * from slot 1, and left slot 0 free, `0xff`/`0xffff`, where CSBWin's is `0`/`0` ("Don't
 * use entry zero", `doc/CSBwin-src/SaveGame.cpp:1968-1973`). Nothing CSBWin does frees
 * slot 0: `DeleteDBEntry` would find door 0 named twice, there and in its own slot, and
 * keep both (`doc/CSBwin-src/data.cpp:993-1015`). It also wrote the packed RN 0 as 0, taking
 * it for `RNempty`, though it is door 0 in corner 0. So the cell that holds door 0 begins
 * its chain with 0, which `checkIndirectIndex` refuses, and the file does not load in
 * CSBWin either.
 *
 * In such a file a 0 where a chain goes on can only be door 0, whose slot is 1. Those
 * words are written as 1, in the object list and in every record's link, and slot 0
 * becomes CSBWin's. The file's own bytes are left alone.
 */
function mendDoorZero(
    image: Uint8Array,
    imageOffset: number,
    layout: DungeonImageLayout,
    cellFlagArraySize: number,
    objectIndex: CsbwinObjectIndex,
): Uint8Array | null {
    const { typeMap, indexMap } = objectIndex;
    if (objectIndex.length < 2 || typeMap[0] !== 0xff || indexMap[0] !== 0xffff) return null;
    if ((typeMap[1] & 0x0f) !== 0 || indexMap[1] !== 0) return null;

    const mended = image.slice();
    let count = 0;
    const mend = (at: number): void => {
        if (readU16BE(mended, at) !== 0) return;
        writeU16BE(mended, at, 1);
        count++;
    };
    for (let i = 0; i < layout.objectListSize; i++) mend(layout.objectList - imageOffset + i * 2);
    for (const db of RECORDS_WITH_A_LINK) {
        const start = layout.databases[db] - imageOffset;
        for (let i = 0; i < (layout.objectCounts[db] ?? 0); i++) mend(start + i * layout.recordSizes[db]);
    }
    // The image's checksum is the sum of its bytes (`DungeonLoader.compareChecksum`), and
    // each word mended adds 1 to it: a sum that was right stays right.
    const sumAt = layout.cellFlags + cellFlagArraySize - imageOffset;
    writeU16BE(mended, sumAt, (readU16BE(mended, sumAt) + count) & 0xffff);
    typeMap[0] = 0;
    indexMap[0] = 0;
    return mended;
}
