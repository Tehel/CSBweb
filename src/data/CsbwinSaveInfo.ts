/**
 * What can be told about a genuine CSBWin save file without loading it.
 *
 * The save/load menu lists whatever `.dat` files it finds beside our own saves, and it
 * needs a level and a roster for each row. Both come out of blocks 2 and 4, which
 * `loadSaveGameState` already unscrambles and checksums — this module only unpacks the
 * champion names out of the raw character block it hands back.
 *
 * **These files cannot be loaded yet.** The dungeon image's text section does not parse,
 * which puts every database and the cell flags out of reach
 * (`doc/CSBWIN_SAVEGAME_REFERENCE.md` → "Where the dungeon image parse stands"), so the
 * menu lists them and refuses to load them rather than restoring a party into a world
 * reset to `dungeon.dat`. When Phase 10's reader is finished, this is where the rest of
 * the row comes from.
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
 */
export function decodeCharField(bytes: Uint8Array): string {
    let out = '';
    for (const byte of bytes) {
        if (byte === 0) continue;
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
