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
import { DungeonLoader } from './DungeonLoader';
import { loadSaveGameState } from './SaveGameLoader';
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
    const dungeon = loader.loadFromArray(bytes.subarray(imageOffset), {
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
