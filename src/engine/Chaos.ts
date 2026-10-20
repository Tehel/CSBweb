/**
 * `Chaos.cpp`: the UTILITY's "MAKE NEW ADVENTURE", which reads a saved game and
 * `mini.dat` and writes a new Chaos Strikes Back save with the saved game's party in it
 * (`doc/CSBwin-src/Chaos.cpp:1-5`).
 *
 * The engine of it, and not the utility's screen: the page offers it as RISE on CSB's
 * entrance (`GameSaves.makeNewAdventure`, `src/renderer/intro/PrisonDoor.ts`).
 * `makeNewAdventure` is button 13 of
 * `_TAG004518` (`:4806-4833`) on a source save `_ReadSavedGame(0)` has read, from file
 * bytes to file bytes. Like CSBWin's, it works on the blocks as the file holds them, and
 * every field below is read and written at its `GAMEBLOCK1`, `GAMEBLOCK2` or `CHARDESC`
 * offset in the file's byte order, with CSBWin's own byte-order slips kept (`TAG002724`).
 *
 * CSBWin keeps the two games in one buffer, `e.Pnt24812`, of two 4112-byte records: the
 * source save at 0 and `mini.dat` at 4112. A record's fields here are `UtilityGame`'s.
 */
import { readU16BE, readU32LE, writeU16BE, writeU32LE } from '../core/bytes';
import type { CsbRandom } from '../core/random';
import { readExtendedFeatures } from '../data/CsbwinExtendedFeatures';
import { readCsbwinCharacter, writePortrait } from '../data/CsbwinCharacters';
import { CHARDESC_SIZE } from '../data/CsbwinSaveInfo';
import {
    genChecksum,
    readUnscrambleBlock,
    scramble,
    scrambleAndWrite,
    unscrambleStream,
} from '../data/CsbwinSaveStream';
import { buildImageChecksum } from '../data/CsbwinDungeonImageWriter';
import { computeDungeonImageLayout } from '../data/DungeonImageLayout';
import type { UtilityPortraits } from '../data/UtilityPortraits';
import { CHARFLAG_MALE } from './gameTypes';

/** `UtilityDiskMessages` (`doc/CSBwin-src/Chaos.cpp:518-561`), the ones this file shows. */
export const UtilityDiskMessages = {
    14: '\nSAVED GAME ERROR',
    20: '\nEACH CHAMPION MUST\nHAVE A UNIQUE FIRST NAME!',
    /** `_ReadSavedGame(1)` when `mini.dat` will not open (`:2835-2843`): the page's fetch. */
    24: 'CAN\'T FIND\nNEW ADVENTURE\nMINI.DAT',
    25: '\nTHE NEW ADVENTURE\nIS DAMAGED',
    29: 'THE NEW ADVENTURE\nCAN ONLY BE MADE AFTER\nA SAVED GAME IS LOADED.',
    30: '\nCAN\'T MAKE NEW ADVENTURE\nFROM THIS SAVED GAME.\nALREADY UTILIZED.',
} as const;

/** A refusal: the dialog CSBWin shows, by its `UtilityDiskMessages` text. */
export class UtilityError extends Error {}

const BLOCK2_SIZE = 128;
/** `CHARDESC[4]` and the 128 bytes of party state after them: `MyUnscrambleStream(A4+772, 3328)`. */
const CHARACTERS_SIZE = 3328;

/**
 * One of `e.Pnt24812`'s two records, as `_ReadSavedGame` fills it (`:2789-3164`), in the
 * file's byte order.
 *
 * Only CSBWin's own form is read, the one whose `GAMEBLOCK1` unscrambles with word 29
 * (`wordGear(A4+2) == 2`). `_ReadSavedGame` falls back to word 10 (`:2966-2981`), but
 * a block that unscrambles only with it stops CSBWin in `NotImplemented(0x1868)`
 * (`:2984-2999`); the port calls the file damaged (`DEBT.md` H).
 */
export interface UtilityGame {
    /** `A4+38`: `GAMEBLOCK1`, plain. */
    block1: Uint8Array;
    /** `A4+550`: `GAMEBLOCK2`, plain. */
    block2: Uint8Array;
    /** `A4+4100`: the `ITEM16`s, plain. */
    item16: Uint8Array;
    /** `A4+772`: the four `CHARDESC`s and the party state, plain. */
    characters: Uint8Array;
    /** `A4+4104`: the timers, plain. */
    timers: Uint8Array;
    /** `A4+4108`: the timer queue, plain. */
    timerQueue: Uint8Array;
    /** What `TAG00142e` reads after the timer queue, in order: the dungeon, to its cell flags. */
    image: Uint8Array;
    /**
     * `ExtendedFeaturesVersion != '@'`: whether the file opened with an Extended Features
     * block. `ReadExtendedFeatures` sets the global for the file just read
     * (`doc/CSBwin-src/SaveGame.cpp:299-424`), so at `_TAG000fc4` it is `mini.dat`'s.
     */
    extendedFeatures: boolean;
}

/** `LE16(wordGear(A4+560))`: `gb2.numcharacter`. */
function numCharacter(game: UtilityGame): number {
    return readU16BE(game.block2, 10);
}

/**
 * `_ReadSavedGame` (`doc/CSBwin-src/Chaos.cpp:2789-3164`), past the dialogs that choose
 * the file: the record of `bytes`, or the refusal `_ReadSavedGame` shows, message 14 for
 * the saved game (`P1` 0) and 25 for `mini.dat` (`P1` 1).
 */
export function ReadSavedGame(bytes: Uint8Array, P1: 0 | 1): UtilityGame {
    try {
        return readGame(bytes);
    } catch {
        throw new UtilityError(UtilityDiskMessages[P1 !== 0 ? 25 : 14]);
    }
}

function readGame(file: Uint8Array): UtilityGame {
    // `ReadExtendedFeatures(e.GameFile)` (`:2957`) marks an enciphered file's handle, so
    // every read after it is deciphered.
    const extended = readExtendedFeatures(file);
    const bytes = extended.data;
    let offset = extended.offset;
    const { buf: block1, next } = readUnscrambleBlock(bytes, offset);
    offset = next;
    const stream = (size: number, hashAt: number, checksumAt: number): Uint8Array => {
        const { buf, next: after } = unscrambleStream(
            bytes, offset, size, readU16BE(block1, hashAt), readU16BE(block1, checksumAt),
        );
        offset = after;
        return buf;
    };
    // `pnt_4646 = pnt_4126 + 312` and `pnt_4642 = pnt_4126 + 344`: the five hashes and
    // the five checksums.
    const block2 = stream(BLOCK2_SIZE, 312, 344);
    const item16 = stream(16 * readU16BE(block2, 46), 314, 346);
    const characters = stream(CHARACTERS_SIZE, 316, 348);
    // A name is 8 bytes and a title 20, and whatever follows a name's or a title's first
    // zero is cleared, for each of the `numcharacter` champions (`:3043-3079`).
    const count = readU16BE(block2, 10);
    for (let w2 = 0; w2 < count; w2++) {
        const base = CHARDESC_SIZE * w2;
        clearAfterTerminator(characters, base, 8);
        clearAfterTerminator(characters, base + 8, 20);
    }
    const timerSize = extended.extendedTimers ? 16 : extended.sequencedTimers ? 12 : 10;
    const maxTimers = readU16BE(block2, 28);
    const timers = stream(timerSize * maxTimers, 318, 350);
    const timerQueue = stream(2 * maxTimers, 320, 352);
    const image = readDungeon(bytes, offset, extended);
    return { block1, block2, item16, characters, timers, timerQueue, image, extendedFeatures: extended.header !== undefined };
}

function clearAfterTerminator(buf: Uint8Array, at: number, length: number): void {
    let w4 = 0;
    while (w4 < length && buf[at + w4] !== 0) w4++;
    for (; w4 < length; w4++) buf[at + w4] = 0;
}

/**
 * `TAG00142e` (`doc/CSBwin-src/Chaos.cpp:2424-2602`): the dungeon's sections, each byte
 * summed into a word, which the word after the cell flags must equal. A file that ends
 * before that word is taken, as `ReadGameFile`'s failure there returns 1.
 */
function readDungeon(
    bytes: Uint8Array,
    start: number,
    extended: ReturnType<typeof readExtendedFeatures>,
): Uint8Array {
    const layout = computeDungeonImageLayout(bytes, start, {
        indirectText: extended.indirectText,
        bigActuators: extended.bigActuators ?? false,
        newScrolls: extended.version >= 0x42, // 'B'
        expool: true,
    });
    if (!layout || layout.numMaps < 1) throw new Error('the dungeon does not read');
    // `cellArraySize = LE16(wordGear(A0+2)); if (cellflagArraySize != 0) cellArraySize = cellflagArraySize;`
    const cellArraySize = extended.cellFlagArraySize || readU16BE(bytes, start + 2);
    const end = layout.cellFlags + cellArraySize;
    if (end > bytes.length) throw new Error('the dungeon is cut short');
    const image = bytes.slice(start, end);
    if (end + 2 <= bytes.length) {
        const checksum = buildImageChecksum(image);
        if (bytes[end] !== checksum[0] || bytes[end + 1] !== checksum[1]) {
            throw new Error('the dungeon checksum does not match');
        }
    }
    return image;
}

/** A C string at `at` of the characters, `strcmp`'s operand: to its first zero. */
function cString(buf: Uint8Array, at: number): string {
    let s = '';
    for (let i = at; i < buf.length && buf[i] !== 0; i++) s += String.fromCharCode(buf[i]!);
    return s;
}

/**
 * `_CheckChampionNames` (`doc/CSBwin-src/Chaos.cpp:1774-1812`): every one of the saved
 * game's `e.Word24814` champions has a name, and no two the same.
 */
export function CheckChampionNames(source: UtilityGame): void {
    const word24814 = numCharacter(source);
    for (let d7 = 0; d7 < word24814; d7++) {
        const a4 = CHARDESC_SIZE * d7;
        if (source.characters[a4] === 0) throw new UtilityError(UtilityDiskMessages[20]);
        for (let d6 = d7 + 1; d6 < word24814; d6++) {
            if (cString(source.characters, a4) === cString(source.characters, CHARDESC_SIZE * d6)) {
                throw new UtilityError(UtilityDiskMessages[20]);
            }
        }
    }
}

/**
 * `_TAG00260e` (`doc/CSBwin-src/Chaos.cpp:3169-3238`): whether a new adventure may be
 * made from the saved game. One with no party is message 29. One that is neither an
 * Atari Dungeon Master save (`Byte22596` 1) nor has `Word22594` 1, or whose
 * `Word22592` is past 13, is message 30, "ALREADY UTILIZED". Then the names.
 */
export function TAG00260e(source: UtilityGame): void {
    if (numCharacter(source) === 0) throw new UtilityError(UtilityDiskMessages[29]);
    const pBlock1 = source.block1;
    if (pBlock1[301] !== 1 && readU16BE(pBlock1, 376) !== 1) {
        throw new UtilityError(UtilityDiskMessages[30]);
    }
    if (readU16BE(pBlock1, 378) > 13) throw new UtilityError(UtilityDiskMessages[30]);
    CheckChampionNames(source);
}

/**
 * `_TAG0026c4` (`doc/CSBwin-src/Chaos.cpp:3243-3259`): `mini.dat` is the new adventure,
 * its `Byte22596` 2 or more and its `Word22592` 13; message 30 otherwise.
 */
export function TAG0026c4(mini: UtilityGame): void {
    if (mini.block1[301]! >= 2 && readU16BE(mini.block1, 378) === 13) return;
    throw new UtilityError(UtilityDiskMessages[30]);
}

/**
 * `TAG002724` (`doc/CSBwin-src/Chaos.cpp:3264-3451`): the saved game's party copied into
 * `mini.dat`'s record, in place.
 *
 * Three of its writes read a big-endian field as the little-endian build holds it in
 * memory. Two are ported as they run there:
 *
 * - `RandomGameID` is `LoadLong(+308) + 1`, and `LoadLong` reads the four bytes
 *   low-first (`:1078-1090`), so the 1 is added to the file's first byte, the field's
 *   highest.
 * - `Word22594` is set to 1 by `wordGear(+376) = 1` for an Atari save
 *   (`Byte22596` 1), which leaves the bytes `01 00`: 256, read back.
 *
 * The third is not, the author's decision (`DEBT.md` H): `charFlags` is
 * `LE16(LE16(wordGear(+48) & 16))`, whose mask falls on the word as memory holds it, so
 * of the file's word CSBWin keeps 0x1000 and clears `CHARFLAG_male`. The port keeps
 * `CHARFLAG_male` and clears the rest, as the mask reads.
 */
export function TAG002724(source: UtilityGame, mini: UtilityGame, random: CsbRandom): void {
    const pnt4 = mini.block1;
    const pnt8 = source.block1;
    pnt4.set(pnt8.subarray(256, 288), 256);
    pnt4.set(pnt8.subarray(288, 296), 288);
    writeU32LE(pnt4, 308, (readU32LE(pnt8, 308) + 1) >>> 0);
    if (pnt8[301] === 1) {
        pnt4[376] = 1;
        pnt4[377] = 0;
    } else {
        pnt4.set(pnt8.subarray(376, 378), 376);
    }
    mini.characters.set(source.characters.subarray(0, 3200), 0);
    const word24814 = numCharacter(source);
    writeU16BE(mini.block2, 10, word24814);
    for (let d7 = 0; d7 < word24814; d7++) {
        const a4 = mini.characters.subarray(CHARDESC_SIZE * d7, CHARDESC_SIZE * (d7 + 1));
        // `gb2.partyfacing`, the new adventure's less the saved game's.
        let d6 = (readU16BE(mini.block2, 16) - readU16BE(source.block2, 16)) & 0xffff;
        if (d6 !== 0) {
            d6 = (d6 + 4) & 0xffff;
            a4[29] = (a4[29]! + d6) & 3;
            a4[28] = (a4[28]! + d6) & 3;
        }
        a4[30] = 1;
        a4[31] = 2;
        a4[32] = 0xff;
        a4[33] = 0;
        a4[34] = 0;
        a4[40] = 0;
        a4[41] = 0;
        a4[42] = 0;
        writeU16BE(a4, 44, 0xffff);
        writeU16BE(a4, 46, 0xffff);
        writeU16BE(a4, 48, readU16BE(a4, 48) & CHARFLAG_MALE);
        writeU16BE(a4, 50, 0);
        a4.copyWithin(52, 54, 56);
        a4.copyWithin(56, 58, 60);
        a4.copyWithin(60, 62, 64);
        writeU16BE(a4, 64, 0);
        writeU16BE(a4, 66, (random.next() & 255) + 1500);
        writeU16BE(a4, 68, (random.next() & 255) + 1500);
        for (let i = 0; i <= 6; i++) {
            const a0 = 3 * i + 70;
            a4[a0 + 2] = 30;
            a4[a0 + 1] = a4[a0]!;
        }
        a4[72] = 10;
        for (let i = 0; i < 20; i++) writeU16BE(a4, 6 * i + 92, 0);
        for (let i = 0; i < 30; i++) writeU16BE(a4, 2 * i + 212, 0xffff);
        writeU16BE(a4, 272, 0);
        writeU16BE(a4, 274, 0);
    }
}

/**
 * The port's own step, in `TAG00439e`'s place (`doc/CSBwin-src/Chaos.cpp:4632-4656`),
 * which swaps the portraits the utility's champion editor loaded into the saved game's
 * `CHARDESC`s before `TAG002724` copies them, and back after. CSBWin does not port the
 * editor, so its `characterImages` are the champions' own and the swap changes nothing.
 * Here each DM champion's portrait becomes the utility disk's redrawn face of them, what
 * the editor's LOAD → PORTRAIT of their `.CMP` would have put there; a portrait that is
 * no DM champion's stays, and so do the names and titles. The source is this call's own
 * copy, so nothing is swapped back.
 */
export function swapInNewFaces(source: UtilityGame, portraits: UtilityPortraits): void {
    for (let d7 = 0; d7 < numCharacter(source); d7++) {
        const face = portraits.newFaceFor(readCsbwinCharacter(source.characters, d7).champion.portrait);
        if (face) writePortrait(source.characters, CHARDESC_SIZE * d7, face);
    }
}

/**
 * `_TAG000fc4(1)` (`doc/CSBwin-src/Chaos.cpp:2001-2327`): the new adventure's record
 * written as a save file, past the dialog that names it.
 *
 * `SaveOption`'s neighbour `Byte22598` becomes 2, the sixteen hash words from 312 are
 * zeroed (`totalMoveCount` among them), each block's checksum is taken with hash 0, and
 * `GAMEBLOCK1` is written as `WriteFirstBlock` does (`:1716-1758`), which is
 * `ScrambleAndWrite`'s fold. The dungeon goes out as it was read, and the word after it
 * is its byte sum.
 *
 * When `mini.dat` opened with an Extended Features block, CSBWin writes a new one from
 * the globals the read left (`:2141-2200`). The port refuses such a file, which no known
 * `mini.dat` is (`DEBT.md` H).
 */
export function TAG000fc4(source: UtilityGame, mini: UtilityGame): Uint8Array {
    CheckChampionNames(source);
    if (mini.extendedFeatures) {
        throw new Error('a mini.dat with an Extended Features block is not supported');
    }
    const block1 = mini.block1.slice();
    const blocks = [mini.block2, mini.item16, mini.characters, mini.timers, mini.timerQueue].map((b) => b.slice());
    block1[300] = 2;
    for (let d7 = 0; d7 < 16; d7++) writeU16BE(block1, 312 + 2 * d7, 0);
    const hashes = [0, 1, 2, 3, 4].map((d7) => readU16BE(block1, 312 + 2 * d7));
    for (let d7 = 0; d7 < 5; d7++) {
        writeU16BE(block1, 344 + 2 * d7, genChecksum(blocks[d7]!, hashes[d7]!, blocks[d7]!.length / 2));
    }
    scrambleAndWrite(block1);
    for (let d7 = 0; d7 < 5; d7++) scramble(blocks[d7]!, hashes[d7]!, blocks[d7]!.length / 2);
    const checksum = buildImageChecksum(mini.image);
    const parts = [block1, ...blocks, mini.image, checksum];
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const part of parts) {
        out.set(part, at);
        at += part.length;
    }
    return out;
}

/**
 * "MAKE NEW ADVENTURE" (`_TAG004518`'s button 13, `doc/CSBwin-src/Chaos.cpp:4806-4833`):
 * the saved game `source` checked, `mini.dat` read and checked, the party copied in, and
 * the new adventure's save file. A refusal throws a `UtilityError` with the message
 * CSBWin shows. `random` is CSBWin's `STRandom`, which draws the food and water. With
 * `newFaces`, the DM champions get the utility disk's portraits of them
 * (`swapInNewFaces`); without, the adventure is CSBWin's.
 */
export function makeNewAdventure(
    source: Uint8Array, mini: Uint8Array, random: CsbRandom, newFaces: UtilityPortraits | null = null,
): Uint8Array {
    const saved = ReadSavedGame(source, 0);
    TAG00260e(saved);
    const adventure = ReadSavedGame(mini, 1);
    TAG0026c4(adventure);
    if (newFaces) swapInNewFaces(saved, newFaces);
    TAG002724(saved, adventure, random);
    return TAG000fc4(saved, adventure);
}
