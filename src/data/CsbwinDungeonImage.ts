/**
 * Read the world out of a genuine CSBWin save file.
 *
 * Blocks 7-14 of a save are the dungeon image: the same structure as `dungeon.dat`,
 * written plain and uncompressed after the timer queue. `LoadGame` reaches it by
 * calling `ReadDatabases()` there (`doc/CSBwin-src/SaveGame.cpp:1909`) with
 * `d.gameState == GAMESTATE_ResumeSavedGame`, which makes that function skip its own
 * extended-features/compression preamble (`:2557-2586`) and stream straight on.
 *
 * Because the structure is `dungeon.dat`'s, this does not reimplement fourteen record
 * parsers — it hands the byte range to `DungeonLoader` with the three differences the
 * save's Extended Features block declares. Those differences, and the evidence for
 * them, are in `doc/PROVEN_FACTS.md` → "The dungeon image layout in a save file".
 */
import { possessionFields } from './CsbwinCharacters';
import { DungeonLoader } from './DungeonLoader';
import { readSaveFile, type SaveFile } from './SaveFile';
import type { DungeonData } from './dungeonTypes';
import type { ObjectID } from '../core/types';

export interface CsbwinWorld {
    dungeon: DungeonData;
    /** The file's blocks, already unscrambled and checksummed, and what each says. */
    save: SaveFile;
}

/**
 * Parse a whole CSBWin save: blocks 0-6 through `readSaveFile`, then the dungeon
 * image through `DungeonLoader` (`readCsbwinWorld`).
 *
 * Throws if any block or the image fails its checksum or the layout does not close, so a
 * caller that gets a result has a world it can trust rather than a half-parsed one.
 */
export function loadCsbwinWorld(file: Uint8Array): CsbwinWorld {
    return readCsbwinWorld(readSaveFile(file));
}

/**
 * The dungeon image of a save `readSaveFile` read, through `DungeonLoader`. A file with
 * no Extended Features block has its timers, champions' slots and hand numbered in
 * `save` itself, so a `SaveFile` is read into a world once.
 */
export function readCsbwinWorld(save: SaveFile): CsbwinWorld {
    // An enciphered save is read deciphered, the image as its blocks (`readExtendedFeatures`).
    const bytes = save.extended.data;
    const { imageOffset, cellFlagArraySize } = save;

    const layout = save.imageLayout;
    if (!layout) throw new Error('the dungeon image header did not parse');

    // The closure check, done here rather than left to a tool: the image's last section
    // is the cell flags, whose length the Extended Features block declares, and after it
    // there is only `WriteAndChecksum`'s final word (`doc/CSBwin-src/SaveGame.cpp:1320`).
    // If any section length is wrong the sum misses, and parsing on would read records
    // out of the middle of neighbouring sections rather than fail.
    const end = layout.cellFlags + cellFlagArraySize;
    if (cellFlagArraySize === 0 || end !== bytes.length - 2) {
        throw new Error(
            `dungeon image does not close: cell flags end at ${end}, file ends at ${bytes.length - 2}`,
        );
    }

    const loader = new DungeonLoader();
    const { objectIndex, bigActuators, version, indirectText, expandedPortraits } = save.extended;
    const dungeon = loader.loadFromArray(bytes.subarray(imageOffset), {
        bigActuators,
        newScrolls: version >= 0x42, // extended features version 'B'
        indirectText,
        expandedPortraits,
        cellFlagArraySize,
        // Every RN in a save's image is a slot number in the object indirect index, not
        // the packed RN `dungeon.dat` stores — see `src/data/CsbwinObjectIndex.ts`.
        objectIndex,
        // A file with no block names objects beside its image as packed RNs, which the
        // read numbers in the save's own blocks, as CSBWin converts `d.` in place
        // (`doc/CSBwin-src/SaveGame.cpp:2958-2975`).
        held: objectIndex ? undefined : {
            timers: save.timers,
            timerQueue: save.timerQueue,
            possessions: possessionFields(save.blocks.characters, save.block2.numCharacter),
            objectInHand: {
                get: () => (save.block2.objectInHand & 0xffff) as ObjectID,
                set: (rn) => { save.block2.objectInHand = rn; },
            },
        },
    });

    return { dungeon, save };
}
