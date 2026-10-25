/**
 * A PC `dungeon.dat` turned into the Atari file it is the twin of.
 *
 * The PC's Dungeon Master writes its `dungeon.dat` little-endian: the same image, section
 * for section and byte for byte, with every word's two bytes the other way round. CSBWin
 * reads a `dungeon.dat` big-endian only (`ReadDatabases`, `doc/CSBwin-src/SaveGame.cpp:2536`,
 * swaps every word it reads through `LE16`, a byte swap on its little-endian build,
 * `CSBTypes.h:150-158`), so it refuses a PC file. The port takes one where the form that
 * adds a player's own set is given its files (`src/ui/addDataSetForm.ts`) and keeps the
 * Atari file in the record, so that nothing past the form ever meets the PC's byte order.
 *
 * The words are those `ReadDatabases` swaps:
 *
 * - The header's (`DUNGEONDATINDEX::Swap`, `data.cpp:1778`), but its bytes 4 and 5:
 *   `NumLevel` is the high byte of `word4` (`CSB.h:2131`), and the PC file holds it in its
 *   byte 4, as the Atari file does, not in byte 5.
 * - A level descriptor's words 0, 8, 10, 12 and 14 (`swapLevelDescriptors`,
 *   `SaveGame.cpp:617`); its bytes 2 to 7 are bytes.
 * - The column index, the object list and the text, all words (`swapPointer10454`,
 *   `swapPRN10464`, `ComputeTextLength`'s `LE16`, `SaveGame.cpp:531-542`, `:2421`).
 * - Each record's words (`DATABASES::swap`, `data.cpp:1166`, and each `DBn::swap`): a
 *   monster's bytes 4 and 5, a chest's 6 and 7 and a missile's 4 and 5 are bytes.
 * - The cell flags and what follows them in each map are bytes; the checksum after them,
 *   where there is one, is a word (`SaveGame.cpp:2866-2867`).
 *
 * Three PC files bear this out: the `DUNGEON.DAT`, `DUNGEONF.DAT` and `DUNGEONG.DAT` of
 * the 1992 European release read as the Atari 1.2 and French 1.3 dungeons, but for the
 * changes of that later revision.
 *
 * A PC file is told by its length: the image its header and level descriptors describe,
 * read little-endian, ends where the file does, or two bytes before a little-endian
 * checksum of every byte before it. A file with an Extended Features block, compressed
 * (33028) or enciphered, is CSBWin's or the Atari's, never the PC's, and is never told.
 */
import { readU16BE, readU16LE, readU8 } from '../core/bytes';

const HEADER_SIZE = 44;
const DESCRIPTOR_SIZE = 16;
/** A plain image's record sizes, by database (`dbEntrySizes`, with the small actuator and the old scroll). */
const RECORD_SIZES = [4, 6, 4, 8, 16, 4, 4, 4, 4, 8, 4, 0, 0, 0, 8, 4];
/** Each record's bytes that are a word's first, by database; a record's other bytes are bytes. */
const RECORD_WORDS: readonly (readonly number[])[] = [
    [0, 2], [0, 2, 4], [0, 2], [0, 2, 4, 6], [0, 2, 6, 8, 10, 12, 14], [0, 2], [0, 2], [0, 2],
    [0, 2], [0, 2, 4], [0, 2], [], [], [], [0, 2, 6], [0, 2],
];
const HEADER_WORDS = [0, 2, 6, 8, 10];
const DESCRIPTOR_WORDS = [0, 8, 10, 12, 14];

type WordReader = (bytes: Uint8Array, at: number) => number;

/** Where `bytes`' sections start, its words read by `word`; `null` where its header names no level. */
function sections(bytes: Uint8Array, word: WordReader) {
    if (bytes.length < HEADER_SIZE) return null;
    const numMaps = bytes[4]!;
    if (numMaps === 0) return null;
    const columns = HEADER_SIZE + numMaps * DESCRIPTOR_SIZE;
    if (columns > bytes.length) return null;
    let totalColumns = 0;
    for (let map = 0; map < numMaps; map++) {
        totalColumns += ((word(bytes, HEADER_SIZE + map * DESCRIPTOR_SIZE + 8) >> 6) & 0x1f) + 1;
    }
    const objectList = columns + totalColumns * 2;
    const text = objectList + word(bytes, 10) * 2;
    const databases: number[] = [];
    let at = text + word(bytes, 6) * 2;
    for (let db = 0; db < 16; db++) {
        databases.push(at);
        at += word(bytes, 12 + db * 2) * RECORD_SIZES[db]!;
    }
    return { numMaps, columns, objectList, text, databases, cellFlags: at, end: at + word(bytes, 2) };
}

/** Whether `bytes`, read by `word`, is a whole image: it ends where its header says, or two bytes later with its checksum. */
function isWhole(bytes: Uint8Array, word: WordReader): boolean {
    const layout = sections(bytes, word);
    if (!layout) return false;
    if (bytes.length === layout.end) return true;
    if (bytes.length !== layout.end + 2) return false;
    let sum = 0;
    for (let i = 0; i < layout.end; i++) sum = (sum + bytes[i]!) & 0xffff;
    return word(bytes, layout.end) === sum;
}

/** `bytes`, a whole image read by `word`, with every word's two bytes exchanged. */
function swapWords(bytes: Uint8Array, word: WordReader): Uint8Array<ArrayBuffer> {
    const layout = sections(bytes, word)!;
    const out = bytes.slice();
    const swap = (at: number): void => {
        out[at] = readU8(bytes, at + 1);
        out[at + 1] = readU8(bytes, at);
    };
    for (const at of HEADER_WORDS) swap(at);
    for (let db = 0; db < 16; db++) swap(12 + db * 2);
    for (let map = 0; map < layout.numMaps; map++) {
        for (const at of DESCRIPTOR_WORDS) swap(HEADER_SIZE + map * DESCRIPTOR_SIZE + at);
    }
    for (let at = layout.columns; at < layout.databases[0]!; at += 2) swap(at);
    for (let db = 0; db < 16; db++) {
        const size = RECORD_SIZES[db]!;
        for (let record = layout.databases[db]!; size > 0 && record < (layout.databases[db + 1] ?? layout.cellFlags); record += size) {
            for (const at of RECORD_WORDS[db]!) swap(record + at);
        }
    }
    if (bytes.length === layout.end + 2) swap(layout.end);
    return out;
}

/** Whether `bytes` is a PC `dungeon.dat`: whole read little-endian, and not read big-endian. */
export function isLittleEndianDungeonDat(bytes: Uint8Array): boolean {
    return isWhole(bytes, readU16LE) && !isWhole(bytes, readU16BE);
}

/** The Atari `dungeon.dat` that `bytes`, a PC one, is the twin of; `null` where `bytes` is no PC `dungeon.dat`. */
export function bigEndianDungeonDat(bytes: Uint8Array): Uint8Array<ArrayBuffer> | null {
    return isLittleEndianDungeonDat(bytes) ? swapWords(bytes, readU16LE) : null;
}

/** The PC `dungeon.dat` that `bytes`, a plain Atari one, is the twin of: the tools' way to make one. */
export function littleEndianDungeonDat(bytes: Uint8Array): Uint8Array<ArrayBuffer> | null {
    return isWhole(bytes, readU16BE) && !isWhole(bytes, readU16LE) ? swapWords(bytes, readU16BE) : null;
}
