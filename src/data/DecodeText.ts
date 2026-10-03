/**
 * `DecodeText` (`doc/CSBwin-src/CSBCode.cpp:5487`): a text record's 5-bit codes, three to
 * a word, into bytes, through graphics.dat's escape tables (`doc/PROVEN_FACTS.md` →
 * "Text Retrieval and Decode"). A free function over the dungeon's words, so that a
 * reader holding a `DungeonData` and the tables (`extractPresetHeroes`) decodes exactly
 * as `DungeonState` does.
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
