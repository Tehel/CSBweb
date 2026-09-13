/**
 * What a DMweb save file contains, and how to build one from a live game.
 *
 * This is **not** the CSBWin binary format. Reading one of those is done — a genuine
 * save loads through `applySaveBytes` below — but *writing* one is what is left of
 * Phase 10. What this carries is the pair the quick-save has carried since format v2:
 *
 * - `runtime` — `Game.getRuntimeSaveState()`, the whole mutable world
 *   (`src/engine/DungeonSnapshot.ts`), which is what actually restores a game;
 * - `raw` — the real, scrambled, checksummed CSBWin file *prefix* that
 *   `saveSaveGameState` can already write (blocks 0-6), base64'd. Nothing needs it to
 *   load, and it is kept because writing it is what keeps the two halves honest with
 *   each other: the day the binary writer is finished, these files already carry the
 *   fields it emits.
 *
 * The `header` is the addition. Listing a directory of saves has to show a date, a level
 * and the party without parsing megabytes of `runtime`, so the three are lifted to the
 * front of the file. They are **derived**, never authoritative: `applySavePayload`
 * ignores the header entirely and restores from `runtime`.
 */
import { loadSaveGameState, applySaveGameState, saveSaveGameState, type SaveGameState } from '../data/SaveGameLoader';
import { applyCsbwinSave } from '../data/CsbwinSaveGame';
import { buildCsbwinCharacterBlock } from '../data/CsbwinCharacters';
import type { Game } from './Game';
import { RUNTIME_SAVE_VERSION, type RuntimeSaveState } from './Game';
import type { Champion } from './gameTypes';

/** Marks the file as ours, so a stray `.json` in the folder is rejected rather than parsed. */
export const SAVE_PAYLOAD_FORMAT = 'dmweb-save';

/** Bumped with `RUNTIME_SAVE_VERSION`; a mismatch is refused, never half-restored. */
export const SAVE_PAYLOAD_VERSION = RUNTIME_SAVE_VERSION;

/** The suffix a DMweb save carries on disk. */
export const SAVE_FILE_EXTENSION = '.dmweb.json';

export interface SaveHeader {
    format: typeof SAVE_PAYLOAD_FORMAT;
    version: number;
    /** `Date.now()` at the moment of the save. */
    savedAt: number;
    /** The dungeon level the party stood on — `position.z`. */
    level: number;
    /** Champion names, in party order. */
    champions: string[];
}

export interface SavePayload {
    header: SaveHeader;
    runtime: RuntimeSaveState;
    /** base64 of the CSBWin block 0-6 prefix. */
    raw: string;
}

export function encodeBytesToBase64(data: Uint8Array): string {
    let bin = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < data.length; i += chunkSize) {
        bin += String.fromCharCode(...data.subarray(i, i + chunkSize));
    }
    return btoa(bin);
}

export function decodeBase64ToBytes(data: string): Uint8Array {
    const bin = atob(data);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 0xff;
    return out;
}

/** Derive the listing header from the runtime state it accompanies. */
export function makeSaveHeader(runtime: RuntimeSaveState): SaveHeader {
    return {
        format: SAVE_PAYLOAD_FORMAT,
        version: runtime.version,
        savedAt: runtime.savedAt,
        level: runtime.party?.position?.z ?? 0,
        champions: (runtime.party?.champions ?? []).map((c) => (c?.name ?? '').trim()),
    };
}

/**
 * Build the save. The `SaveGameState` half mirrors what `LoadGame` reads back out of
 * `GAMEBLOCK2` (`doc/CSBwin-src/SaveGame.cpp:1636-1637`).
 */
export interface SavePayloadOptions {
    /**
     * The portrait pixels of a champion who carries only `portraitGraphic` — every
     * champion this engine created, since the engine holds no graphics to blit from.
     * `ViewportRenderer.portraitPixelsFor` is the one the app passes; without it such a
     * champion's `CHARDESC.portrait` is written blank.
     */
    portraitOf?: (champion: Champion) => number[] | undefined;
}

export function buildSavePayload(game: Game, options: SavePayloadOptions = {}): SavePayload {
    const runtime = game.getRuntimeSaveState();
    const item16 = runtime.dungeon.item16 ?? [];
    const timers = runtime.dungeon.timers ?? [];
    const missiles = runtime.dungeon.missiles ?? [];
    const saveGameState: SaveGameState = {
        item16,
        timers,
        timerQueue: runtime.dungeon.timerQueue,
        timerSequence: runtime.dungeon.timerSequence,
        missiles,
        maxItem16: item16.length,
        maxTimers: timers.length,
        sequencedTimers: false,
        extendedTimers: false,
        handChar: runtime.party.cursorOwner ?? -1,
        magicCaster: runtime.party.magicCasterIndex ?? -1,
        characterBlock: buildCharacterBlock(game, runtime, options),
    };
    return {
        header: makeSaveHeader(runtime),
        runtime,
        raw: encodeBytesToBase64(saveSaveGameState(saveGameState)),
    };
}

/**
 * Block 4 — `CHARDESC[4]` and the 128 bytes of party state beside them — packed out of
 * the live party.
 *
 * The two things a `Champion` does not carry are supplied here, both from the running
 * game: `CHARDESC.load`, which CSBWin keeps incrementally and this port re-sums
 * (`CharacterStats.characterLoad`), and the portrait pixels for a champion the *engine*
 * created, who carries `portraitGraphic` — a cell of basic graphic 26 — because the
 * engine holds no graphics to blit from. `AddCharacter` blits that cell into the
 * character record once (`doc/CSBwin-src/Character.cpp:486-495`); this is where the
 * port finally does the same.
 */
function buildCharacterBlock(
    game: Game,
    runtime: RuntimeSaveState,
    options: SavePayloadOptions,
): Uint8Array {
    const party = runtime.party;
    const footprints = runtime.game.footprints;
    return buildCsbwinCharacterBlock(
        party.champions ?? [],
        {
            brightness: party.brightness ?? 0,
            seeThruWalls: party.seeThruWalls ?? 0,
            magicFootprintsActive: party.magicFootprintsActive ?? 0,
            partyShield: party.partyShield ?? 0,
            fireShield: party.fireShield ?? 0,
            spellShield: party.spellShield ?? 0,
            numFootprintEnt: footprints?.count ?? party.numFootprintEnt ?? 0,
            freezeLifeTimer: party.freezeLifeTimer ?? 0,
            indexOfFirstMagicFootprint: party.indexOfFirstMagicFootprint ?? 0,
            indexOfLastMagicFootprint: party.indexOfLastMagicFootprint ?? 0,
            footprints: footprints?.prints ?? [],
            footprintAges: footprints?.ages ?? [],
            invisible: party.invisible ?? 0,
        },
        {
            load: (champion) => game.characterStats?.characterLoad(champion) ?? champion.load ?? 0,
            portraitOf: (champion) => options.portraitOf?.(champion),
        },
    );
}

export class SavePayloadError extends Error {}

/**
 * Parse a file's bytes. Throws `SavePayloadError` with a message fit for the menu's
 * status line — a save written by an older build is refused rather than half-restored,
 * for the reason `quickLoad` already refuses one: a v1 save has no world state in it at
 * all, so restoring one drops the party into a dungeon reset to `dungeon.dat`.
 */
export function decodeSavePayload(bytes: Uint8Array): SavePayload {
    let parsed: unknown;
    try {
        parsed = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
        throw new SavePayloadError('NOT A DMWEB SAVE');
    }
    const payload = parsed as Partial<SavePayload>;
    if (!payload || typeof payload !== 'object') throw new SavePayloadError('NOT A DMWEB SAVE');
    // A quick-save written before the header existed is still perfectly loadable.
    const runtime = payload.runtime;
    if (!runtime || typeof runtime !== 'object') throw new SavePayloadError('NOT A DMWEB SAVE');
    if (runtime.version !== SAVE_PAYLOAD_VERSION) {
        throw new SavePayloadError(`SAVE IS FORMAT V${runtime.version ?? '?'}, THIS BUILD READS V${SAVE_PAYLOAD_VERSION}`);
    }
    if (typeof payload.raw !== 'string') throw new SavePayloadError('SAVE IS MISSING ITS BLOCK DATA');
    return {
        header: payload.header ?? makeSaveHeader(runtime),
        runtime,
        raw: payload.raw,
    };
}

export function encodeSavePayload(payload: SavePayload): Uint8Array {
    return new TextEncoder().encode(JSON.stringify(payload));
}

/**
 * Restore a parsed payload into the running game. The order is `LoadGame`'s: the
 * `SaveGameState` blocks first, then the runtime world
 * (`doc/CSBwin-src/SaveGame.cpp:1617-1745`).
 */
export function applySavePayload(game: Game, payload: SavePayload): void {
    const saveState = loadSaveGameState(decodeBase64ToBytes(payload.raw));
    applySaveGameState(game.state.dungeon, saveState, game.state.party);
    game.applyRuntimeSaveState(payload.runtime);
}

/**
 * Is this one of our JSON saves, or a genuine CSBWin binary?
 *
 * A `SavePayload` is `JSON.stringify` output, so its first non-whitespace byte is `{`.
 * A CSBWin save opens with the Extended Features block — and may open with an
 * RC4-obfuscated one, which is why this asks the cheap, certain question about *our*
 * format rather than trying to recognise theirs.
 */
function looksLikeJson(bytes: Uint8Array): boolean {
    for (let i = 0; i < Math.min(bytes.length, 64); i++) {
        const byte = bytes[i];
        if (byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d) continue;
        return byte === 0x7b; // '{'
    }
    return false;
}

/**
 * Restore whatever the store handed back — one of our saves, or a genuine CSBWin one.
 *
 * The two menus and the quick-load all come through here so that the choice is made in
 * one place. A CSBWin file goes to `applyCsbwinSave`, whose failures are turned into
 * `SavePayloadError` because the menu's status line is the only place they can be
 * shown, and it wants a short line rather than a stack.
 */
export function applySaveBytes(game: Game, bytes: Uint8Array): void {
    if (looksLikeJson(bytes)) {
        applySavePayload(game, decodeSavePayload(bytes));
        return;
    }
    try {
        applyCsbwinSave(game, bytes);
    } catch (error) {
        throw new SavePayloadError(`CSBWIN SAVE: ${(error as Error).message}`.toUpperCase());
    }
}

/**
 * The name a new save gets. CSBWin has four fixed filenames and rotates a `.BAK`
 * (`doc/CSBwin-src/CSBCode.cpp:9744-9761`); this port saves as often as asked, so the
 * name has to be unique instead. Sortable, and readable in a file manager.
 */
export function makeSaveFileName(savedAt: number, taken: ReadonlySet<string> = new Set()): string {
    const d = new Date(savedAt);
    const p = (n: number, w = 2) => String(n).padStart(w, '0');
    const stem =
        `dmweb-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
        `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
    let name = `${stem}${SAVE_FILE_EXTENSION}`;
    let n = 2;
    while (taken.has(name)) name = `${stem}-${n++}${SAVE_FILE_EXTENSION}`;
    return name;
}
