/**
 * What can be told about a genuine CSBWin save file without loading it.
 *
 * The save/load menu lists whatever `.dat` files it finds beside our own saves, and it
 * needs a level and a roster for each row. Both come out of blocks 2 and 4, which
 * `loadSaveGameState` already unscrambles and checksums — this module only unpacks the
 * champion names out of the raw character block it hands back.
 *
 * **These files load** (`src/data/CsbwinSaveGame.ts`), but listing one must stay far
 * cheaper than loading it: a directory of saves is read on every menu open, and the
 * dungeon image behind each row is the best part of a megabyte. So this stops at blocks
 * 2 and 4 and never touches the image. The consequence is deliberate: a file whose
 * blocks unscramble but whose image is damaged is listed as loadable and fails on LOAD,
 * with the reason on the menu's status line.
 */
import { loadSaveGameState } from './SaveGameLoader';

/**
 * `CHARDESC` is 800 bytes (`doc/CSBwin-src/CSB.h:2483-2594`, whose last member is
 * `FILL337[800-337]`), and block 4 holds four of them followed by 128 bytes of party
 * state.
 */
export const CHARDESC_SIZE = 800;

/**
 * `name` is `char[8]` at offset 0 and the title runs from 8 to 27 — **20 bytes, not the
 * 16 the struct declares**. `AddCharacter` proves the span: it refuses a title character
 * at `D6W >= 19` and then writes `title[D6W] = 0`, so index 19 is a legal write
 * (`doc/CSBwin-src/Character.cpp:578-587`), and the next member, `facing`, sits at
 * offset 28.
 */
export const CHARDESC_NAME_OFFSET = 0;
export const CHARDESC_NAME_SIZE = 8;
export const CHARDESC_TITLE_OFFSET = 8;
export const CHARDESC_TITLE_SIZE = 20;

/**
 * Names and titles are plain `char` arrays — `swapCharacter` never touches them
 * (`doc/CSBwin-src/SaveGame.cpp:490-521`) — so they need no byte-swapping. A byte
 * outside printable ASCII becomes `?`, which is what makes a misread block obvious
 * instead of plausible.
 *
 * **They are C strings, and the first NUL ends them.** `AddCharacter` terminates both
 * (`doc/CSBwin-src/Character.cpp:567,587`) and the game prints them with
 * `TextToViewport(…, pcA3->title, false)` (`:1338`), which stops there. This reader used
 * to *skip* zero bytes and go on, which is why some genuine saves appeared to hold a
 * title of `\0HE DEVIL`: CSBWin shows those champions a **blank** title, and so must we.
 * The stray NUL is written by `EditCharacterName`'s insert branch
 * (`doc/CSBwin-src/Chaos.cpp:5323-5324`), whose shift loop starts at `max_len` (7) rather
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

/** The four champions of a save's block 4, names and titles, empty slots included. */
export function readCharacterNames(characterBlock: Uint8Array): Array<{ name: string; title: string }> {
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
}

/**
 * Read the listing fields, or `null` if the file is not a CSBWin save this port can
 * unscramble. Never throws: the menu calls it on every `.dat` it happens to find.
 */
export function readCsbwinSaveInfo(bytes: Uint8Array): CsbwinSaveInfo | null {
    try {
        const state = loadSaveGameState(bytes);
        const block2 = state.block2;
        if (!block2) return null;
        const roster = state.characterBlock ? readCharacterNames(state.characterBlock) : [];
        const champions = roster
            .slice(0, Math.max(0, Math.min(4, block2.numCharacter)))
            .map((c) => c.name)
            .filter((n) => n.length > 0);
        return { level: block2.partyLevel, champions, time: block2.time };
    } catch {
        return null;
    }
}
