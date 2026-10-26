/**
 * What can be told about a CSBWin save file without loading it.
 *
 * A save's row holds its level, its roster and its playthrough, read from the file when
 * the row is written (`src/data/saves/SaveStore.ts`). They come out of blocks 1, 2 and 4,
 * which `readSaveFile` already unscrambles and checksums — this module only unpacks
 * the champion names out of the raw character block it hands back.
 *
 * Of the image, the best part of a megabyte, it reads only the layout
 * (`computeDungeonImageLayout`) and never the world. The consequence is deliberate: a
 * file whose blocks unscramble but whose image is damaged has a row and fails on LOAD,
 * with the reason on the menu's status line.
 */
import { readSaveFile, type SaveFile } from './SaveFile';

/**
 * `CHARDESC` is 800 bytes (`doc/CSBwin-src/CSB.h:2542-2653`, whose last member is
 * `FILL337[800-337]`), and block 4 holds four of them followed by 128 bytes of party
 * state.
 */
export const CHARDESC_SIZE = 800;

/**
 * `name` is `char[8]` at offset 0 and the title runs from 8 to 27 — **20 bytes, not the
 * 16 the struct declares**. `AddCharacter` proves the span: it refuses a title character
 * at `D6W >= 19` and then writes `title[D6W] = 0`, so index 19 is a legal write
 * (`doc/CSBwin-src/Character.cpp:579-588`), and the next member, `facing`, sits at
 * offset 28.
 */
export const CHARDESC_NAME_OFFSET = 0;
export const CHARDESC_NAME_SIZE = 8;
export const CHARDESC_TITLE_OFFSET = 8;
export const CHARDESC_TITLE_SIZE = 20;

/**
 * Names and titles are plain `char` arrays — `swapCharacter` never touches them
 * (`doc/CSBwin-src/SaveGame.cpp:498-529`) — so they need no byte-swapping. A byte
 * outside printable ASCII becomes `?`, which is what makes a misread block obvious
 * instead of plausible.
 *
 * **They are C strings, and the first NUL ends them.** `AddCharacter` terminates both
 * (`doc/CSBwin-src/Character.cpp:568,588`) and the game prints them with
 * `TextToViewport(…, pcA3->title, false)` (`:1343`), which stops there. Some genuine
 * saves hold a title of `\0HE DEVIL`, which CSBWin shows as a **blank** title, and so
 * does the port. The stray NUL is written by `EditCharacterName`'s insert branch
 * (`doc/CSBwin-src/Chaos.cpp:6539-6540`), whose shift loop starts at `max_len` (7) rather
 * than at the name's length, so its first move is `name[8] = name[7]` — and `name` is
 * `char[8]`, so `name[8]` *is* `title[0]`. See `doc/PROVEN_FACTS.md` → "A champion's
 * title can lose its first character".
 */
export function decodeCharField(bytes: Uint8Array): string {
    let out = '';
    for (const byte of bytes) {
        if (byte === 0) break;
        out += byte >= 32 && byte < 127 ? String.fromCharCode(byte) : '?';
    }
    return out;
}

/**
 * The inverse: a `char` field of exactly `size` bytes, NUL-terminated and zero-filled.
 *
 * `AddCharacter` writes the characters and then its terminator into a record
 * `ClearMemory` has already zeroed (`doc/CSBwin-src/Character.cpp:479,568,588`), so
 * every byte past the terminator is 0 — which is what the committed saves hold, with
 * one exception that this function cannot express and callers must handle: a title
 * whose first byte was zeroed by the editor bug still carries its text after the
 * terminator. `Champion.titleField` keeps those bytes; see `writeCsbwinCharacter`.
 *
 * A character the field cannot hold is dropped rather than truncating the string
 * silently: the string is written up to `size - 1` bytes, as CSBWin's own bounds do.
 */
export function encodeCharField(text: string, size: number): Uint8Array {
    const out = new Uint8Array(size);
    const limit = Math.min(text.length, size - 1);
    for (let i = 0; i < limit; i++) {
        const code = text.charCodeAt(i);
        out[i] = code >= 32 && code < 127 ? code : 0x3f; // '?', as decodeCharField shows it
    }
    return out;
}

/** The four champions of a save's block 4, names and titles, empty slots included. */
function readCharacterNames(characterBlock: Uint8Array): Array<{ name: string; title: string }> {
    const out: Array<{ name: string; title: string }> = [];
    for (let i = 0; i < 4; i++) {
        const base = i * CHARDESC_SIZE;
        out.push({
            name: decodeCharField(
                characterBlock.subarray(base + CHARDESC_NAME_OFFSET, base + CHARDESC_NAME_OFFSET + CHARDESC_NAME_SIZE),
            ),
            title: decodeCharField(
                characterBlock.subarray(base + CHARDESC_TITLE_OFFSET, base + CHARDESC_TITLE_OFFSET + CHARDESC_TITLE_SIZE),
            ),
        });
    }
    return out;
}

export interface CsbwinSaveInfo {
    level: number;
    champions: string[];
    /** `gb2.Time`, the virtual clock — not a wall-clock date; a CSBWin save carries none. */
    time: number;
    /** `d.RandomGameID`, `GAMEBLOCK1`'s (`doc/CSBwin-src/SaveGame.cpp:1085`): the game the file is a save of. */
    randomGameID: number;
}

/**
 * Read the listing fields, or `null` if the file is not a CSBWin save this port can
 * unscramble. Never throws: the store's upgrade calls it on whatever its rows hold.
 */
export function readCsbwinSaveInfo(bytes: Uint8Array): CsbwinSaveInfo | null {
    try {
        return csbwinSaveInfoOf(readSaveFile(bytes));
    } catch {
        return null;
    }
}

/**
 * The listing fields of a save already read (`readSaveFile`), so that a caller who has
 * read the file reads none of it again.
 */
export function csbwinSaveInfoOf(save: SaveFile): CsbwinSaveInfo {
    const { block1, block2 } = save;
    const roster = readCharacterNames(save.blocks.characters);
    const champions = roster
        .slice(0, Math.max(0, Math.min(4, block2.numCharacter)))
        .map((c) => c.name)
        .filter((n) => n.length > 0);
    return { level: block2.partyLevel, champions, time: block2.time, randomGameID: block1.randomGameID >>> 0 };
}
