/**
 * A dungeon's signature: what tells whose a save is, since the file does not say.
 *
 * A CSBWin save holds no name of its dungeon, but it holds the dungeon (blocks 7-14),
 * and a file on its way into the store is checked against the running one by it
 * (`PLAN.md` → Phase 10, "An import is checked against the dungeon"). CSBWin has no such
 * check: it keeps a game's saves in that game's directory
 * (`doc/CSBwin-src/CSBCode.cpp:9747-9756`).
 *
 * The signature is one digest per level, of the level's walls: its width, its height,
 * and a bit per cell, stone or anything else. Nothing finer goes in. What a release
 * moved, a teleporter or an object, and what play changes, a door, a pit, a wall's
 * objects, all leave it alone, so the four Dungeon Master sets here are one dungeon and
 * a save of any of them is a save of it.
 *
 * The digest is SHA-256 through `crypto.subtle`, which a page has in a secure context
 * alone. The page is served from localhost and will be hosted over https, both secure,
 * so it is always there: the author's decision is that nothing stands in for it.
 */
import { getRoomType, RoomType } from '../core/types';
import type { DungeonData, MapData } from './dungeonTypes';

/** A digest per level, in the levels' order: 64 hexadecimal digits each. */
export type DungeonSignature = readonly string[];

/**
 * What a level's digest is taken of: its width, its height, then a bit per cell in the
 * file's order, column by column, the first cell in a byte's high bit. The bit is set
 * for any cell but stone.
 */
export function levelWalls(map: MapData): Uint8Array<ArrayBuffer> {
    const { width, height } = map.descriptor;
    const walls = new Uint8Array(2 + Math.ceil((width * height) / 8));
    walls[0] = width;
    walls[1] = height;
    let cell = 0;
    for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++, cell++) {
            if (getRoomType(map.cellFlags[x][y]) !== RoomType.STONE) walls[2 + (cell >> 3)] |= 0x80 >> (cell & 7);
        }
    }
    return walls;
}

/** The signature of `dungeon`, a `dungeon.dat`'s or a save's. */
export async function dungeonSignature(dungeon: DungeonData): Promise<string[]> {
    const signature: string[] = [];
    for (const map of dungeon.maps) {
        const digest = await crypto.subtle.digest('SHA-256', levelWalls(map));
        signature.push(Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(''));
    }
    return signature;
}

/** A dungeon the port can name. */
export interface KnownDungeon {
    name: string;
    /** The data sets that play it, their `DataSet.id`: none for a dungeon the port cannot play. */
    dataSets: readonly string[];
    signature: DungeonSignature;
}

/**
 * The catalogue. It is not read from the game's files as a table of CSBWin's is: it may
 * list a dungeon whose files the page does not have, and the page loads one data set's.
 * `tools/dump-dungeon-signature.ts` holds every entry to the files here, and prints the
 * digests of a dungeon that is to be added.
 *
 * The four Dungeon Master sets are one dungeon. Chaos Strikes Back is two: its
 * `dungeon.dat` is the prison, and the game is `mini.dat`'s (`DEBT.md` G17). Conflux is
 * not listed: its `dungeon.dat` is enciphered, and not read (`DEBT.md` G4).
 */
export const KNOWN_DUNGEONS: readonly KnownDungeon[] = [
    {
        name: 'Dungeon Master',
        dataSets: ['dm-atari', 'dm-windows', 'dm-atari-1.2', 'dm-atari-1.3-fr'],
        signature: [
            '167ec1080a5ce33a678ad38ba810d9723c25a12d6380443ad24aab877a2c6507',
            '2601fa2a50a662417b081aa47633a2c99379316f745c3454b7c51e855ac07559',
            'f6b6de7b6098eb7ec8028f84f531b736f14d8ccf6a240c2217eacdef723cbe14',
            '09ce9e15a93fb4182606112c9efb9eea2ca4935db3c1f3d47ed0198197e20cdb',
            '508fe5bfe1075872f3152dd0d14e4096314fea983e04b339774d8ff3e51181c9',
            '2c55ec179a626e417a075af9399077a759e30aa1626c32d20f29141aab0ee50f',
            '4c4ca2d3f738ed73588cd02bd2cfeeaedd7ce4a2be34f26e20120a0c23dede68',
            '2732e4a22ea4a8ff93d9332e0414efccffe9fe4e07999cde1cf8d878d3d91101',
            '533e71826a528db1451fad87569c4e34a60cbb99c785dac07c1cb9a9f5b9728c',
            'e275c1f1ca53ffd5d52a8608bd70555d47a484981bdbc484d45c29a92a6192b9',
            '76bdf577ac0b1497c32b307af5afadb90e890ebca7163d3035e713b8d62ac950',
            'ebf848e9aea42b3ac007efcbf58c031f1f0e8fd0fcddc00e309bdc4db6b9a5e4',
            'fe041c65423dc507813a391a348c6311ecde3fed63a2e85b903f25286ee03b96',
            'abc4d17013d93fa0d2d31e32e7e9851bece8e89a3f3cbcda44f9139022420361',
        ],
    },
    {
        name: 'Chaos Strikes Back',
        dataSets: ['csb'],
        signature: [
            '9d42bdc4a2f2a9513b57fedde53c7472feaea0cce74a897c2b773ffb56493006',
            '4b756274bd04c300536e090410be7a8ae16387508205895e7110421b56e4aed2',
            '5fb68fd2dc9777d1b0dd66dc49c566e1c9a41ba4a3e2d0be5ae4361272f9add0',
            'd3784c64a8717a0262f35b10256769f699ed5173df770f3f01a0023062ae6413',
            '18a42c458f69d044bceb348f414999eb772710e2b5953059790f2c1bb1db4db7',
            'b239842ee185701c7afa4efbbf2d5b6e4a08f5424d9017ebb0a88826e65a3e3a',
            'e8120cfdd06e2c2f621e44f180aa60ae3714fc9f4eaca780c9ab92e31df6113b',
            'dc72dcf4a1ea3e928cbf6f35e526faf1ffa006813a279e765c60af69e389ed27',
            '4c03822d4e55c24624562511030f53ffb6dcba7d3c6a6289194e10116e64fa58',
            '9962a953f63414d9977e0595aadb73d14bf28ba2d2f5072cf25b18f609b90eec',
            '9f44ac6acb8a37b00b615dc89259d306035be82dee7db2b472e4c48326195440',
        ],
    },
    {
        name: 'Chaos Strikes Back, the prison',
        dataSets: ['csb'],
        signature: [
            'e6ceb1dfd22dff936c9572feed5fe878b7649771daabb245c19162ada94e32c7',
            'daa2538fad1ccb10717afd7bf3c90cfc0ef88948ec38f1ff729fbdf3336d96df',
        ],
    },
    {
        name: 'Kids dungeon 24',
        dataSets: ['kids-dungeon'],
        signature: [
            'cfccd1cff2c660a714b747329d684c5f2b3c35da0ea5cbb79106dc944da29777',
            '367ff76418cbeef6cdbf8b0668aa91a8a9ad6290d3cb4a92008c7f691042f611',
            '85590ce50b3812d720d3260356b9ce7ab8733b839b326c550a6b46bf2073944d',
        ],
    },
    {
        name: '3D2D1D',
        dataSets: ['3d2d1d'],
        signature: [
            'e54b23180f537c92831ebe0de5816a6583a577951a5d17e1f73ebd66e1c926ab',
            'b7778d04e69c1c2f6677e5bdd1af7d0524ce0a6dcd84bebc96307a7134adfe6a',
            '5ee318d5a4c3445cac9ec096a3d6fe7107a24d6aaca10ec3ec1f0e4df27df7a1',
            'fdf307e3343b147dca6d1b00ef9f525334385d978b549a895e348b36940526c6',
            'c73e01d7ae59314c5b68da2822df429d5550488e3ff6ef24970b82e03c7ea89d',
            '7d95988566c9fcfcf3bd6e74427c7089ef23d5a93ec9c1512562c6a6489e44d4',
            '6ef7319b7858df41be162763661dde8008710b674082dfd470749fb960f1cb1a',
            'd8ab2a4ddf64d2da80cc68ab9d1a1e01c8c217abd4c982e8507db3a7c124189a',
            '368b5dc255e36bb32741c72ca6af621aad02ad5ad91c77049e4cc5c1c62b4313',
            '895467d5bce99a75f493fd9bea8562eb0b52a7c44618b7299eb690a8244ab798',
        ],
    },
];

/** The known dungeon a signature looks like. */
export interface DungeonMatch {
    dungeon: KnownDungeon;
    /** How many of the signature's levels are the dungeon's, each against the level of its own number. */
    levels: number;
    /** Whether the signature is the dungeon's: as many levels, and every one the same. */
    whole: boolean;
}

/**
 * The known dungeon most levels of `signature` match, and `null` when none of them
 * matches any. A dungeon the signature is the whole of comes before one it is the first
 * levels of.
 */
export function identifyDungeon(
    signature: DungeonSignature,
    known: readonly KnownDungeon[] = KNOWN_DUNGEONS,
): DungeonMatch | null {
    let best: DungeonMatch | null = null;
    for (const dungeon of known) {
        const levels = dungeon.signature.filter((digest, level) => digest === signature[level]).length;
        const whole = levels === signature.length && levels === dungeon.signature.length;
        if (levels === 0) continue;
        if (!best || levels > best.levels || (levels === best.levels && whole && !best.whole)) {
            best = { dungeon, levels, whole };
        }
    }
    return best;
}

/**
 * What a file's dungeon is to a data set, by its signature: the set's `own`, whole; a
 * `modified` version of the set's own, most of it and not the whole; an `other` known
 * dungeon's, the whole or most of one; or of an `unknown` dungeon, no level of any.
 */
export type DungeonCheck =
    | { kind: 'own' | 'modified' | 'other'; dungeon: KnownDungeon }
    | { kind: 'unknown' };

/**
 * `signature` against the data set `dataSet`, its `DataSet.id`: the dungeon it looks like
 * (`identifyDungeon`) is the set's when it lists the set, and a set may have two.
 */
export function checkDungeon(
    signature: DungeonSignature,
    dataSet: string,
    known: readonly KnownDungeon[] = KNOWN_DUNGEONS,
): DungeonCheck {
    const match = identifyDungeon(signature, known);
    if (!match) return { kind: 'unknown' };
    if (!match.dungeon.dataSets.includes(dataSet)) return { kind: 'other', dungeon: match.dungeon };
    return { kind: match.whole ? 'own' : 'modified', dungeon: match.dungeon };
}
