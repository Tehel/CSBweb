/**
 * `DecodeText` (`doc/CSBwin-src/CSBCode.cpp:5487`): a text record's 5-bit codes, three to
 * a word, into bytes, through graphics.dat's escape tables (`doc/PROVEN_FACTS.md` →
 * "Text Retrieval and Decode"). A free function over the dungeon's words, so that a
 * reader holding a `DungeonData` and the tables (`extractPresetHeroes`) decodes as
 * `DungeonState` does. Its last step, `SubstituteCharacterNames`, reads the game, so
 * `DungeonState.decodeText` applies it.
 */
import type { ui16 } from '../core/types';
import { textStart } from './CsbwinDungeonConversions';
import type { DungeonData, TextRecord } from './dungeonTypes';
import type { TextDecodeTables } from './tables/ObjectTables';

export function DecodeText(
    data: Pick<DungeonData, 'textWords' | 'indirectTextIndex' | 'compressedText'>,
    record: TextRecord,
    typeOfText: number,
    max: number,
    tables: TextDecodeTables,
): Uint8Array | null {
    const force = (typeOfText & 0x8000) !== 0;
    if (!record.visible && !force) return null;

    // `DB2::index()` means different things either side of `ConvertToIndirectText`,
    // and `textStart` is the one place that knows which.
    const start = textStart(data, record.textOffset);
    if (!start) return null;
    return decodeTextFromWords(start.words, start.at, typeOfText, max, tables);
}

function decodeTextFromWords(
    words: readonly ui16[],
    startWord: number,
    typeOfText: number,
    max: number,
    tables: TextDecodeTables
): Uint8Array | null {
    if (startWord < 0 || startWord >= words.length) return null;

    const out: number[] = [];
    let wordIndex = startWord;
    let word = 0;
    let bitPos = 0;
    let slashCount = 0;
    let escapeCode = 0;

    let separator = 0;
    if ((typeOfText & 0x7fff) === 1) {
        out.push(10);
        separator = 32;
    } else if (typeOfText === 0) {
        separator = 0x80;
    } else {
        separator = 10;
    }

    while (out.length < max - 2) {
        if (bitPos === 0) {
            word = words[wordIndex++] ?? 0;
        }

        let code: number;
        if (bitPos === 0) code = (word >> 10) & 0x1f;
        else if (bitPos === 1) code = (word >> 5) & 0x1f;
        else code = word & 0x1f;
        bitPos = (bitPos + 1) % 3;

        if (code === 28) slashCount++;
        else slashCount = 0;

        if (escapeCode !== 0) {
            if (escapeCode === 30) {
                const table = typeOfText === 0 ? tables.byte10336 : tables.byte10016;
                appendEscapeString(out, table, 8, code, max);
            } else {
                appendEscapeString(out, tables.byte10080, 2, code, max);
            }
            escapeCode = 0;
            continue;
        }

        if (code < 28) {
            let outCode = code;
            if (typeOfText !== 0) {
                if (code === 26) outCode = 32;
                else if (code === 27) outCode = 46;
                else outCode = code + 65;
            }
            out.push(outCode);
            continue;
        }

        if (code === 28) {
            if (separator === 32 && slashCount === 2 && out.length > 0) {
                out[out.length - 1] = 10;
            } else {
                out.push(separator);
            }
            continue;
        }

        if (code <= 30) {
            escapeCode = code;
            continue;
        }

        break; // 31 end of text
    }

    out.push(typeOfText === 0 ? 0x81 : 0);
    return Uint8Array.from(out);
}

function appendEscapeString(out: number[], table: Uint8Array, entrySize: number, index: number, max: number): void {
    const base = index * entrySize;
    for (let i = 0; i < entrySize && base + i < table.length; i++) {
        const value = table[base + i] ?? 0;
        if (value === 0) break;
        if (out.length >= max - 2) return;
        out.push(value);
    }
}

/**
 * What `SubstituteCharacterNames` reads of the game: `d.HandChar`, the champions' names,
 * the `EXPOOL`'s global texts and the DSA global variables.
 */
export interface TextSubstitution {
    /** `d.HandChar`, -1 when nobody holds the cursor. */
    handChar(): number;
    /** `d.CH16482[index].name`, or null at or past `d.NumCharacter`. */
    characterName(index: number): string | null;
    /** `expool.Locate((EDT_GlobalText << 24) | index)`: the record's longwords, or null. */
    globalText(index: number): readonly number[] | null;
    /** `globalVariables[index]`, or null at or past `numGlobalVariables`. */
    globalVariable(index: number): number | null;
}

/** `EDT_GlobalText` (`doc/CSBwin-src/CSB.h:1573`). */
export const EDT_GLOBAL_TEXT = 10;

const DOT = 0x2e;
const A = 0x41;

/**
 * `SubstituteCharacterNames` (`doc/CSBwin-src/CSBCode.cpp:5367-5482`), the end of every
 * `DecodeText` (`:5664-5667`): `.Q.A` is the champion holding the cursor and `.Q.B` to
 * `.Q.E` the first to fourth (`.Q.F` to `.Q.K` print nothing), `.R.` and four hex digits
 * a global text, `.N.` and two a global variable in decimal. A digit is a letter from `A`
 * (0) to `P` (15). A wall text, `bcd`, holds codes rather than ASCII and is only looked at
 * when it has a `.Q.` (`bcdstrstr`, `:5354-5365`); the others when they have any of the
 * three. A substitution that fails, a name or text that is not there, stops the copy:
 * the text ends there, and `ok` is false, which is `DecodeText`'s -1.
 */
export function SubstituteCharacterNames(
    text: Uint8Array,
    max: number,
    bcd: boolean,
    s: TextSubstitution,
): { text: Uint8Array; ok: boolean } {
    const terminator = bcd ? 0x81 : 0;
    let len = text.indexOf(terminator);
    if (len < 0) len = text.length;
    const has = (p: number[]): boolean => {
        for (let i = 0; i + p.length <= len; i++) {
            if (p.every((c, k) => text[i + k] === c)) return true;
        }
        return false;
    };
    if (bcd) {
        // `bcdstrstr` tries `i < strLen - patLen`, one start short of the end.
        let found = false;
        for (let i = 0; i < len - 3 && !found; i++) {
            found = text[i] === 27 && text[i + 1] === 16 && text[i + 2] === 27;
        }
        if (!found) return { text, ok: true };
    } else if (!has([DOT, 0x51, DOT]) && !has([DOT, 0x52, DOT]) && !has([DOT, 0x4e, DOT])) {
        return { text, ok: true };
    }
    if (len < 4) return { text, ok: true };

    const offset = bcd ? A : 0;
    const point = bcd ? 27 : DOT;
    // Past the terminator CSBWin reads what its buffer last held, but only once the
    // terminator has failed the match, so what is read there never counts.
    const at = (i: number): number => (text[i] ?? 0) + offset;
    const out: number[] = [];
    const put = (c: number): boolean => {
        if (out.length >= max) return false;
        out.push(bcd ? c - A : c);
        return true;
    };
    const hex = (from: number, n: number): boolean => {
        for (let k = 0; k < n; k++) {
            const c = at(from + k);
            if (c < A || c > A + 15) return false;
        }
        return true;
    };
    let result = true;
    let i = 0;
    while (result && i < len) {
        if (at(i) - offset === point && at(i + 2) - offset === point) {
            if (at(i + 1) === 0x51 && at(i + 3) >= A && at(i + 3) <= 0x4b) {
                i += 3;
                const cmd = at(i++);
                if (cmd === A) {
                    const hand = s.handChar();
                    result = hand >= 0 && substituteName(s.characterName(hand), put);
                } else if (cmd <= 0x45) {
                    result = substituteName(s.characterName(cmd - 0x42), put);
                }
                continue;
            }
            if (at(i + 1) === 0x52 && hex(i + 3, 4)) {
                i += 3;
                let index = 0;
                for (const k = i + 4; i < k; i++) index = index * 16 + at(i) - A;
                const record = s.globalText(index);
                if (!record) {
                    result = false;
                } else {
                    for (let b = 0; b < record.length * 4; b++) {
                        const c = ((record[b >> 2] ?? 0) >>> (8 * (b & 3))) & 0xff;
                        if (c === 0 || !put(c)) break;
                    }
                }
                continue;
            }
            if (at(i + 1) === 0x4e && hex(i + 3, 2)) {
                i += 3;
                let index = 0;
                for (const k = i + 2; i < k; i++) index = index * 16 + at(i) - A;
                const value = s.globalVariable(index);
                if (value === null) {
                    result = false;
                } else {
                    for (const c of String(value | 0)) if (!put(c.charCodeAt(0))) break;
                }
                continue;
            }
        }
        if (out.length < max - 1) out.push(text[i] ?? 0);
        i++;
    }
    out.push(terminator);
    return { text: Uint8Array.from(out), ok: result };
}

/**
 * `SubstituteCharacterName` (`doc/CSBwin-src/CSBCode.cpp:5275-5293`): the name's eight
 * bytes, or up to its end. False when there is no such champion.
 */
function substituteName(name: string | null, put: (c: number) => boolean): boolean {
    if (name === null) return false;
    for (let k = 0; k < 8 && k < name.length; k++) {
        if (!put(name.charCodeAt(k))) break;
    }
    return true;
}
