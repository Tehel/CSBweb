/**
 * A `dungeon.dat` written: the inverse of `DungeonLoader.loadDungeonDat` for the form
 * CSBWin's own dungeon files take, as the DM Windows package's and Conflux's do
 * (`doc/PROVEN_FACTS.md` → "DM's two `dungeon.dat` files").
 *
 * That form is a save's dungeon without the save: the Extended Features prefix, then
 * the image in the shape a save is written in, then its checksum word. `ReadDatabases`
 * reads it for a new game (`doc/CSBwin-src/SaveGame.cpp:2558-2586`):
 * `ReadExtendedFeatures` takes the prefix and returns its size, the first word behind it
 * is not 33028, so the image is read as it stands from there, in the shapes the block
 * declares (`IndirectText`, `BigActuators`, six-byte scrolls from version `'B'`), and
 * its RNs are slots of the object indirect index the prefix carries, so
 * `ConvertListOfObjects` does not run (`:2927`, only for `'@'`). The image closes with
 * the byte sum `FetchDataBytes` keeps (`:2868-2870`).
 *
 * What the packed `dungeon.dat` cannot hold, this can: an RN there is
 * `[position:2][category:4][index:10]`, 1,024 records a database, where a slot of the
 * index is a word of its own (Conflux holds 10,318 actuators).
 *
 * The world given must be save-shaped, as `DungeonLoader` leaves every world it reads
 * (`convertOriginalDungeon`), and a new game's: no `Byte7302` spares, which the new
 * game adds behind the file's records (`DungeonState.addNewGameSpares`).
 */
import { buildDungeonImage, buildImageChecksum, cellFlagArraySize } from './CsbwinDungeonImageWriter';
import { buildExtendedFeaturesPrefix, buildLiveExtendedFeatures } from './CsbwinExtendedFeatures';
import { objectIndexOf } from './CsbwinObjectIndex';
import type { DungeonData } from './dungeonTypes';

interface DungeonFileOptions {
    /**
     * The block's `DMRules`, which a new game takes as `DMRulesDesignOption`
     * (`doc/CSBwin-src/SaveGame.cpp:394-400`) in place of the data set's `dmRules`.
     */
    dmRules: boolean;
}

export function buildDungeonFile(dungeon: DungeonData, options: DungeonFileOptions): Uint8Array {
    if (!dungeon.indirectText || !dungeon.bigActuators || !dungeon.newScrolls) {
        throw new Error('the world is not in the converted shape a dungeon file with a block needs');
    }
    const objectIndex = objectIndexOf(dungeon.rnMaps);
    const prefix = buildExtendedFeaturesPrefix({
        header: buildLiveExtendedFeatures({
            cellFlagArraySize: cellFlagArraySize(dungeon.maps),
            extendedWallDecorations: dungeon.extendedWallDecorations,
            spellFilterLocation: dungeon.spellFilterLocation,
            dmRules: false,
            dmRulesDesignOption: options.dmRules,
            invisibleMonsters: false,
            drawAsSize4Monsters: false,
            simpleEncipher: false,
            supressDSAWarningOption: false,
            bGravityGame: false,
            bThreeDMovements: false,
            dsaIndex: dungeon.dsaIndex,
            hintKey: dungeon.hintKey,
            gameInfo: dungeon.gameInfo,
        }),
        typeMap: objectIndex.typeMap,
        indexMap: objectIndex.indexMap,
        dsaIndex: dungeon.dsaIndex,
        gameInfo: dungeon.gameInfo?.text,
        dsaLevelIndex: dungeon.dsaLevelIndex,
    });
    const image = buildDungeonImage(dungeon, { indirectText: true, bigActuators: true, newScrolls: true });
    const checksum = buildImageChecksum(image);
    const out = new Uint8Array(prefix.length + image.length + checksum.length);
    out.set(prefix, 0);
    out.set(image, prefix.length);
    out.set(checksum, prefix.length + image.length);
    return out;
}
