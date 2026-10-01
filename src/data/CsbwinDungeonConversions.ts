/**
 * The three conversions CSBWin runs **once, on load**, over an original dungeon.
 *
 * `ReadDatabases` is the only reader either kind of file goes through, and it turns a
 * `dungeon.dat`-shaped image into the shape a save file is written in. There are three
 * of them and each is gated on a flag the Extended Features block declares, so a save —
 * which already carries the converted form — is read straight through
 * (`doc/CSBwin-src/SaveGame.cpp:2345-2346` skips the preamble for
 * `GAMESTATE_ResumeSavedGame`, and the flags are false only for an original dungeon):
 *
 * | Conversion | Gate | Called at |
 * | --- | --- | --- |
 * | `MakeBigActuators` | `!bigActuators` | `:2604-2607`, while the ACTUATOR database is being read |
 * | `ConvertToIndirectText` | `!indirectText` | `:2645-2648`, after the last database |
 * | `convertScrolls` | `ExtendedFeaturesVersion < 'B'` | `:2768-2772`, last of all |
 *
 * **Why this matters to the writer.** A game started from `dungeon.dat` holds a
 * `dungeon.dat`-shaped world, and there is no way to write that world into a save file:
 * a save declares `IndirectText` and `BigActuators` in its header and stores six-byte
 * scrolls, and a reader that is told one shape and handed another parses the image at
 * the wrong offsets from the first record onwards. Converting on load, as CSBWin does,
 * means the in-memory world is **always** save-shaped and the writer never has to ask
 * where it came from.
 *
 * Run them twice and you get a corrupt world rather than an error — `ConvertToIndirectText`
 * would decode the index it built last time as if it were text — so the gates are the
 * whole safety argument, and they are the same gates CSBWin uses.
 */
import { DBType, OBJECT_ID_NULL, RoomType, encodeObjectID } from '../core/types';
import type { ui16, ui32 } from '../core/types';
import { getActuatorType } from './actuatorHelpers';
import type { DungeonData } from './dungeonTypes';

/** Which of the three shapes a world is in. `true` means "already converted". */
export interface DungeonImageShape {
    /** ACTUATOR records carry `word8` (`EF_FLAGS.BigActuators`). */
    bigActuators: boolean;
    /** The text is an indirect index plus compressed text (`EF_FLAGS.IndirectText`). */
    indirectText: boolean;
    /** SCROLL records are six bytes with an RN (`ExtendedFeaturesVersion >= 'B'`). */
    newScrolls: boolean;
}

/**
 * `ComputeTextLength` (`doc/CSBwin-src/SaveGame.cpp:2202-2217`) — the number of 16-bit
 * words in one text entry, counting the word that carries the 31 terminator.
 *
 * CSBWin's loop has no bound, because its input is always a valid text array. Ours must
 * stop at the end of the array regardless: a word read past it comes back as 0, whose
 * three 5-bit characters are all zero, so the terminator would never be found.
 */
export function ComputeTextLength(words: readonly ui16[], startWord: number): number {
    let len = 0;
    let idx = startWord;
    while (idx < words.length) {
        const word = words[idx++];
        len++;
        if (((word >> 10) & 0x1f) === 31 || ((word >> 5) & 0x1f) === 31 || (word & 0x1f) === 31) {
            return len;
        }
    }
    return len;
}

/**
 * `ConvertToIndirectText` (`doc/CSBwin-src/SaveGame.cpp:2221-2276`).
 *
 * Walks the TEXT database in record order, copies each live record's entry out of the
 * raw text array into a freshly packed `compressedText`, and records where it landed in
 * `indirectTextIndex`. A record whose link is `RNnul` is skipped entirely and gets no
 * entry, which is why the index is shorter than the database.
 *
 * Two overwrites make it a conversion rather than a derivation, and both are load-bearing:
 *
 * - `pDB2->index(newIndex)` (`:2270`) — the record's own index word stops being a word
 *   offset into the text array and becomes an entry number in the new index. That word
 *   is `TextRecord.textOffset` here, and it is what the image writer emits, so a record
 *   left unconverted writes a word offset into a file whose reader will treat it as an
 *   entry number.
 * - `NumWordsInTextArray(indirectIndexLen)` (`:2274`) — the header word that sized the
 *   raw text array now holds the *length of the index*. Measured: `dungeon.dat` declares
 *   1749 and every committed save declares 125, which is exactly this port's index
 *   length for the same dungeon.
 *
 * `d.compressedText` replaces the raw array, which CSBWin frees (it is a `SAFEMEM` local
 * in `ReadDatabases`), so `textWords` is pointed at the compressed words too — the same
 * state a save load leaves behind.
 */
export function ConvertToIndirectText(data: DungeonData): void {
    const words = data.textWords ?? [];
    const indirectTextIndex: ui32[] = [];
    const compressedText: ui16[] = [];
    let sizeOfCompressedText = 0;

    for (const record of data.databases.texts.records) {
        if (record.nextObject === OBJECT_ID_NULL) continue;

        const oldIndex = record.textOffset;
        // `if (oldIndex > NumWordsInTextArray())` — CSBWin puts a message box up and
        // zeroes the index (`:2246-2254`). There is no message box here; the record is
        // left pointing at entry 0, as CSBWin leaves it.
        if (oldIndex > data.header.textDataSize || oldIndex >= words.length) {
            record.textOffset = 0;
            continue;
        }

        const len = ComputeTextLength(words, oldIndex);
        const newIndex = indirectTextIndex.length;
        indirectTextIndex.push(sizeOfCompressedText);
        for (let w = 0; w < len; w++) compressedText.push(words[oldIndex + w] ?? 0);
        sizeOfCompressedText += len;
        record.textOffset = newIndex;
    }

    data.indirectTextIndex = indirectTextIndex;
    data.compressedText = compressedText;
    data.textWords = compressedText;
    data.header.textDataSize = indirectTextIndex.length & 0xffff;
    data.indirectText = true;
}

/**
 * `MakeBigActuators` (`doc/CSBwin-src/SaveGame.cpp:2287-2314`) and the `DB3::MakeBig`
 * (`doc/CSBwin-src/data.cpp:1327-1334`) it calls on every record.
 *
 * The eight-byte record grows to ten. The two new bytes are not simply zero: for a DSA
 * actuator — type 47 — `MakeBig` lifts the top bits of `word4` and `word6` into the new
 * `word8` and masks them off, because the ten-byte form widens both parameters from 14
 * bits to 16 (`DB3::ParameterA`/`ParameterB`, `data.cpp:1337-1345`).
 *
 * **A knowing divergence, and why it cannot bite here.** CSBWin calls this *before*
 * `db.swap(dbACTUATOR)` (`SaveGame.cpp:2604-2608`), so on the little-endian build it
 * shipping reads `actuatorType()` out of a word that still holds the file's byte order —
 * bits 8-14 of the true `word2` rather than bits 0-6. This port's records are already
 * decoded, so it reads the type CSBWin meant. The two agree for any dungeon with no
 * type-47 actuator under *either* reading, and DM's `dungeon.dat` has none under either;
 * `tools/dump-dungeon-conversions.ts` asserts that rather than assuming it.
 * <sub>`doc/PROVEN_FACTS.md` → "`MakeBigActuators` runs before the byte swap".</sub>
 */
export function MakeBigActuators(data: DungeonData): void {
    for (const record of data.databases.actuators.records) {
        record.word8 = 0;
        if (getActuatorType(record) !== 47) continue;
        record.word8 = (((record.word6 >> 12) & 0xc0) | ((record.word4 >> 14) & 0x03)) & 0xffff;
        record.word6 &= 0x3fff;
        record.word4 &= 0x3fff;
    }
    data.bigActuators = true;
}

/**
 * `convertScrolls` (`doc/CSBwin-src/SaveGame.cpp:2144-2166`).
 *
 * The four-byte scroll holds a 10-bit index into the TEXT **database** and a six-bit
 * flag above it; the six-byte scroll holds an RN to that text record and a word whose
 * bit 0 is `open`. The conversion is the obvious one plus one subtlety about slots:
 *
 * CSBWin calls `AllocateIndirectIndex(dbTEXT, index)` (`:2153`), which mints a **new**
 * slot in the object indirect index rather than reusing the one `ConvertListOfObjects`
 * may already have given that record — so in a genuine save a text record a scroll names
 * can have two slots. This port has no live index at all: `buildObjectIndirectIndex`
 * builds one at write time with a single slot per `(database, record)`, so the two
 * collapse into one. That is invisible outside the file — nothing but the file refers to
 * a slot number, and both slots resolve to the same record — and `countAliases` is where
 * the collapse is documented.
 *
 * `AllocateIndirectIndex` writes the database number alone into `dataTypeMap`
 * (`:2141`), leaving the slot's position bits at zero, which is why the RN is built at
 * position 0. Measured: every scroll in a committed save resolves to `RN(0, dbTEXT, n)`
 * where `n` is `dungeon.dat`'s own 10-bit index for the same scroll.
 *
 * **`m_word4`'s upper bits cannot be reproduced and are written as zero.**
 * `pScroll->open(...)` writes bit 0 over whatever the record already held, and the two
 * bytes the record grew by were never initialised, so a genuine save carries allocation
 * debris there — 3585, 530, 5132 and 532 in the first four records of every committed save.
 * A converted world writes 0, which is the only honest value.
 */
export function convertScrolls(data: DungeonData): void {
    for (const record of data.databases.scrolls.records) {
        // `openFlag = pWord[1] >> 10` — the six bits above the index, before they are
        // overwritten; `open` is `openFlag == 0`.
        const openFlag = record.word2Bits10_15 ?? (record.open ? 0 : 1);
        record.textObject = encodeObjectID(0, DBType.TEXT, record.textReference & 0x3ff);
        record.open = openFlag === 0;
        record.word4Bits1_15 = 0;
        record.word2Bits10_15 = undefined;
    }
    data.newScrolls = true;
}

/**
 * Run whichever of the three the image's declared shape says have not run yet, in
 * CSBWin's own order.
 *
 * The order is not cosmetic: `convertScrolls` runs **after** `ConvertToIndirectText`
 * (`:2770` against `:2648`), so the text record index a scroll's new RN names is the
 * post-conversion one. Running the scrolls first would build RNs against the raw
 * word offsets.
 */
export function convertOriginalDungeon(data: DungeonData, shape: Partial<DungeonImageShape>): void {
    if (!shape.bigActuators) MakeBigActuators(data);
    if (!shape.indirectText) ConvertToIndirectText(data);
    if (!shape.newScrolls) convertScrolls(data);
}

/**
 * `ExtendPortraits` (`doc/CSBwin-src/SaveGame.cpp:1402-1426`): give every Hall of
 * Champions mirror CSBWin's own portrait fields.
 *
 * Not one of `ReadDatabases`' three. `_ReadEntireGame` calls it once the whole file is
 * read (`:1827`), for a new game and a save alike, and it does nothing when the file's
 * Extended Features block carried `ExpandedPortraits` (`:403`). The flag is reset at the
 * start of every read (`:1462`), so a file with no block is always cleaned: DM's
 * `dungeon.dat`, whose 24 mirrors carry leftover bits in these fields, and CSB's
 * Atari-era saves. A file either program writes carries the flag.
 *
 * For every live actuator of type 127 it zeroes `ClearResponses`, `SetResponses`,
 * `ToggleResponses`, the two unused bits, `State`, `BlockDisables`, `DisableMessage` and
 * `Position` (`CSB.h:1055-1069`): `word4` bits 0-11 and the whole of `word6`. The
 * wall graphic ordinal and the type/value word are kept.
 */
export function ExtendPortraits(data: DungeonData): void {
    for (const record of data.databases.actuators.records) {
        if (record.nextObject === OBJECT_ID_NULL) continue;
        if (getActuatorType(record) !== 127) continue;
        record.word6 &= ~0x003f;          // ClearResponses(0)
        record.word6 &= ~0x0fc0;          // SetResponses(0)
        record.word4 &= ~0x003f;          // ToggleResponses(0)
        record.word6 &= ~0xc000;          // ClearUnusedPor()
        record.word4 &= ~0x0e00;          // State(0)
        record.word4 &= ~0x0100;          // BlockDisables(false)
        record.word4 &= ~0x00c0;          // DisableMessage(0)
        record.word6 &= ~0x3000;          // Position(0)
    }
}

/**
 * `CheckCelltypes` (`doc/CSBwin-src/SaveGame.cpp:1367-1400`): turn every cell whose room
 * type is above `roomDOOR`'s 6 into open floor, keeping the low five bits.
 *
 * `_ReadEntireGame` calls it once the whole file is read (`:1825`), a new game's and a
 * save's alike, with no gate. DM's cells are all 0-6, so it changes nothing there.
 * `CheckMonsters`, which `_ReadEntireGame` runs between this and `ExtendPortraits`, needs
 * the monster table and runs where that is (`src/engine/CheckMonsters.ts`); the three
 * touch different data, so the order does not matter.
 */
export function CheckCelltypes(data: DungeonData): void {
    for (const map of data.maps) {
        const { width, height } = map.descriptor;
        for (let x = 0; x < width; x++) {
            for (let y = 0; y < height; y++) {
                const cell = map.cellFlags[x][y];
                if ((cell >> 5) > RoomType.FALSEWALL) map.cellFlags[x][y] = (cell & 0x1f) | (RoomType.OPEN << 5);
            }
        }
    }
}

/**
 * Where one text record's words start, and in which array.
 *
 * The same question a converted world and an unconverted one answer differently, asked
 * in one place so that no consumer has to know which it is holding: after
 * `ConvertToIndirectText` the record's index word is an entry in `indirectTextIndex`,
 * before it it is a word offset into the raw array.
 */
export function textStart(
    data: Pick<DungeonData, 'textWords' | 'indirectTextIndex' | 'compressedText'>,
    index: number,
): { words: readonly ui16[]; at: number } | null {
    const { indirectTextIndex, compressedText } = data;
    if (indirectTextIndex && compressedText) {
        const at = indirectTextIndex[index];
        if (at === undefined) return null;
        return { words: compressedText, at };
    }
    const words = data.textWords;
    if (!words) return null;
    return { words, at: index };
}
