/**
 * `hcsb.hct`, the data of Chaos Strikes Back's Hint Oracle.
 *
 * CSBWin's HINT choice (`_StartHint`, `doc/CSBwin-src/Hint.cpp:6454`) reads it in
 * `_TAG006c7e_xxx` (`:5395-5505`); `doc/CSBWIN_HINT_ORACLE_REFERENCE.md` has the format.
 * In short, all words big-endian:
 *
 * ```
 *   word 2, word 13, word n      then skip to byte 2 * n
 *   word count, word size        the location table: count records of size bytes,
 *                                (x, y, level, 0, word hint)
 *   word count, word size        the hint records: count records of size bytes,
 *                                (title[22], word first chunk, word page count)
 *   word count                   the chunk lengths: count words
 *   the chunks                   end to end, each LZW then RLE compressed
 * ```
 *
 * A hint's pages are one chunk, `pageCount` strings each closed by a NUL, and the
 * `pageCount - 1` chunk lengths after it are 0.
 *
 * CSBWin deciphers the file with RC4 when the save's `hintKey` is set (`:5401-5405`).
 * Every save this project has carries a zero key (`doc/PROVEN_FACTS.md` → "The Extended
 * Features header a live game writes"), so only a plain file is read here; an enciphered
 * one fails the header check.
 */
import { readU16BE } from '../core/bytes';
import { LZWexpand, RLEexpand } from '../core/compression';

/** `#define MAXHINTINDICES 9` (`doc/CSBwin-src/Hint.cpp:11`): the titles the menu shows. */
export const MAXHINTINDICES = 9;

/** `sizeof(f.Byte12792)` (`Hint.cpp:333`): the buffer a hint's pages are expanded into. */
export const HINT_TEXT_BUFFER_SIZE = 2240;

/** A location record's x and y both 0xff: the hint applies anywhere on its level. */
export const HINT_ANYWHERE = 0xff;

/** One record of the location table (`f.Seg1Addr10550`). */
export interface HintLocation {
    x: number;
    y: number;
    level: number;
    /** An index into `HintOracle.hints`. */
    hint: number;
}

/** One hint record (`f.Seg2Addr10546`), with its chunk expanded. */
export interface OracleHint {
    title: string;
    /** The chunk its pages are in (`+22`). */
    chunk: number;
    /** The pages, in order: page N of `_TAG00799a_12` is `pages[N - 1]`. */
    pages: string[];
    /** The expanded chunk's length, NULs included. */
    expandedLength: number;
}

export interface HintOracle {
    /** Every record, in file order, which is the menu's order. */
    locations: HintLocation[];
    hints: OracleHint[];
    /** The chunk lengths (`f.Seg3Addr10542`). */
    chunkLengths: number[];
}

const TITLE_LENGTH = 22;

function latin1(bytes: Uint8Array): string {
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return s;
}

/** Parse a plain `hcsb.hct`. Throws on anything `_TAG006c7e_xxx` would reject. */
export function parseHintOracle(file: Uint8Array): HintOracle {
    const word = (at: number): number => {
        if (at + 2 > file.length) throw new Error(`hcsb.hct: truncated at ${at}`);
        return readU16BE(file, at);
    };
    // Error 55 and 81 (`Hint.cpp:5409-5415`).
    if (word(0) !== 2) throw new Error('hcsb.hct: first word is not 2 (enciphered?)');
    if (word(2) !== 13) throw new Error('hcsb.hct: second word is not 13');
    let at = 2 * word(4);

    const locationCount = word(at);
    const locationSize = word(at + 2);
    at += 4;
    const locations: HintLocation[] = [];
    for (let i = 0; i < locationCount; i++, at += locationSize) {
        locations.push({ x: file[at]!, y: file[at + 1]!, level: file[at + 2]!, hint: word(at + 4) });
    }

    const hintCount = word(at);
    const hintSize = word(at + 2);
    at += 4;
    const records: Array<{ title: string; chunk: number; pageCount: number }> = [];
    for (let i = 0; i < hintCount; i++, at += hintSize) {
        const end = file.subarray(at, at + TITLE_LENGTH).indexOf(0);
        records.push({
            title: latin1(file.subarray(at, at + (end < 0 ? TITLE_LENGTH : end))),
            chunk: word(at + 22),
            pageCount: word(at + 24),
        });
    }

    const chunkCount = word(at);
    at += 2;
    const chunkLengths: number[] = [];
    for (let i = 0; i < chunkCount; i++) chunkLengths.push(word(at + 2 * i));
    // `*pSeg3Len = TAG00181e(FDnum)`: the chunks start where the length table ends.
    const chunkOffsets: number[] = [];
    let offset = at + 2 * chunkCount;
    for (const length of chunkLengths) {
        chunkOffsets.push(offset);
        offset += length;
    }
    if (offset > file.length) throw new Error('hcsb.hct: the chunks run past the end of the file');

    const hints = records.map((r, id): OracleHint => {
        const start = chunkOffsets[r.chunk];
        if (start === undefined) throw new Error(`hcsb.hct: hint ${id} names chunk ${r.chunk} of ${chunkCount}`);
        // TAG003210: LZW, with the 0x90 run-length escape applied to its output.
        const text = RLEexpand(LZWexpand(file.subarray(start, start + chunkLengths[r.chunk]!)));
        const pages: string[] = [];
        let from = 0;
        while (pages.length < r.pageCount) {
            const end = text.indexOf(0, from);
            if (end < 0) throw new Error(`hcsb.hct: hint ${id} has ${pages.length} of ${r.pageCount} pages`);
            pages.push(latin1(text.subarray(from, end)));
            from = end + 1;
        }
        return { title: r.title, chunk: r.chunk, pages, expandedLength: text.length };
    });
    for (const l of locations) {
        if (l.hint >= hints.length) throw new Error(`hcsb.hct: a location names hint ${l.hint} of ${hints.length}`);
    }
    return { locations, hints, chunkLengths };
}

/**
 * The hints the Oracle offers a party on `level` at (`x`, `y`), in menu order.
 *
 * `_TAG00799a_9` (`doc/CSBwin-src/Hint.cpp:6108-6120`): a record applies when its level is
 * the party's and its square is the party's or is (0xff, 0xff). The list is not cut, but
 * the menu shows only the first `MAXHINTINDICES` (`_TAG00799a_6`, `:5998`).
 */
export function hintsAtPosition(oracle: HintOracle, level: number, x: number, y: number): number[] {
    const found: number[] = [];
    for (const l of oracle.locations) {
        if (l.level !== level) continue;
        if (l.x === x && l.y === y) found.push(l.hint);
        else if (l.x === HINT_ANYWHERE && l.y === HINT_ANYWHERE) found.push(l.hint);
    }
    return found;
}
