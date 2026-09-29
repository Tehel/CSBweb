/**
 * What a DMweb save file contains, and how to build one from a live game.
 *
 * This is **not** the CSBWin binary format, though it carries one: a genuine save loads
 * through `applySaveBytes` below, and `raw` is a whole CSBWin file. What it carries is
 * the pair the quick-save has carried since format v2:
 *
 * - `raw` — the scrambled, checksummed CSBWin file `saveSaveGameState` writes, all
 *   sixteen blocks, base64'd. A load reads its world as a CSBWin save's, structure and
 *   all, and installs it in place of the running one (`applySavePayload`), so a save of
 *   any dungeon loads into any running game;
 * - `runtime` — `getRuntimeSaveState` (`RuntimeSave.ts`), the whole mutable world
 *   (`src/engine/DungeonSnapshot.ts`), restored over the world `raw` installed.
 *
 * The `header` is the addition. Listing a directory of saves has to show a date, a level
 * and the party without parsing megabytes of `runtime`, so the three are lifted to the
 * front of the file. They are **derived**, never authoritative: `applySavePayload`
 * ignores the header entirely and restores from `runtime`.
 */
import { saveSaveGameState, type Block1, type Block2, type SaveGameState } from '../data/SaveGameLoader';
import { applyCsbwinSave, installCsbwinWorld } from '../data/CsbwinSaveGame';
import { loadCsbwinWorld } from '../data/CsbwinDungeonImage';
import { buildCsbwinCharacterBlock } from '../data/CsbwinCharacters';
import { buildObjectIndirectIndex } from '../data/CsbwinObjectIndex';
import { buildDungeonImage, cellFlagArraySize } from '../data/CsbwinDungeonImageWriter';
import { buildLiveExtendedFeatures } from '../data/CsbwinExtendedFeatures';
import type { DungeonData, TimerRecord } from '../data/dungeonTypes';
import type { Game } from './Game';
import { RUNTIME_SAVE_VERSION, type RuntimeSaveState } from './RuntimeSave';
import type { Champion } from './gameTypes';
import { OBJECT_ID_NULL } from '../core/types';

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
     * `GameScreen.portraitPixelsFor` is the one the app passes; without it such a
     * champion's `CHARDESC.portrait` is written blank.
     */
    portraitOf?: (champion: Champion) => number[] | undefined;
}

/**
 * The live timers that carry an object reference, and where in the record it sits.
 *
 * `ConvertTimers` switches on the timer function
 * (`doc/CSBwin-src/SaveGame.cpp:2027-2050`): 48 and 49 carry `timerObj6` — bytes 6-7,
 * the missile in flight — and 24, 25, 60 and 61 carry `timerObj8`, bytes 8-9. Every
 * other function reads those bytes as plain numbers (a map square, an action code) and
 * must not be touched.
 *
 * A slot not named by the queue is not a live timer and holds nothing worth converting.
 */
function objectCarryingTimers(
    timers: readonly TimerRecord[],
    queue: readonly number[],
): Array<{ slot: number; at: 6 | 8; rn: number }> {
    const live = new Set(queue);
    const out: Array<{ slot: number; at: 6 | 8; rn: number }> = [];
    timers.forEach((timer, slot) => {
        if (!live.has(slot)) return;
        if (timer.function === 48 || timer.function === 49) {
            out.push({ slot, at: 6, rn: timer.timerWord6 & 0xffff });
        } else if (timer.function === 24 || timer.function === 25 ||
                   timer.function === 60 || timer.function === 61) {
            out.push({ slot, at: 8, rn: timer.timerWord8 & 0xffff });
        }
    });
    return out;
}

/**
 * Blocks 0 and 7-15 of the file, and the one numbering they and blocks 2 and 4 share.
 *
 * Every RN that leaves this port has to be a slot in the **same** object indirect index:
 * the two maps block 0 carries, the object list, every record link, the thirty
 * possession slots of every champion, `GAMEBLOCK2.ObjectInHand` and the object a timer
 * is carrying. That is why the index, the image and the character block are built here
 * together rather than each where it belongs — `tools/dump-save-file-roundtrip.ts` makes
 * the same argument for a parsed save, and this is the live half of it.
 *
 * `buildObjectIndirectIndex` takes the references that are in no cell chain as
 * `heldReferences`, in CSBWin's own order — the object-carrying timers
 * (`ConvertTimers`, `:2745`), the possession slots (`ConvertCharacters`, `:2746`), then
 * `d.objectInHand` (`:2753-2760`) — because each of those calls fixes the referenced
 * record's *position* in `dataTypeMap`, and an object a champion is carrying would
 * otherwise keep position 0 and come back in the wrong corner of its cell
 * (`doc/PROVEN_FACTS.md` → "Everything CSBWin converts to slot numbers, and in what
 * order").
 */
function buildFileBlocks(
    game: Game,
    runtime: RuntimeSaveState,
    timers: TimerRecord[],
    options: SavePayloadOptions,
): {
    extendedFeatures: SaveGameState['extendedFeatures'];
    dungeonImage: Uint8Array;
    characterBlock: Uint8Array;
    objectIndex: SaveGameState['objectIndex'];
    objectInHand: number;
    timers: TimerRecord[];
} {
    const dungeon: DungeonData = game.state.dungeon;

    // The world has to be save-shaped, which `DungeonLoader` guarantees by converting on
    // load (`src/data/CsbwinDungeonConversions.ts`). Refuse rather than write a file
    // whose header declares three shapes the image does not have — a reader told
    // `IndirectText` and handed a raw text array parses the databases from the wrong
    // offset onward and cannot detect it until the closing checksum.
    if (!dungeon.indirectText || !dungeon.bigActuators || !dungeon.newScrolls) {
        throw new Error(
            'the world is not in the converted shape a save file needs ' +
            `(indirectText=${!!dungeon.indirectText}, bigActuators=${!!dungeon.bigActuators}, ` +
            `newScrolls=${!!dungeon.newScrolls})`,
        );
    }
    // `DSA::Write` is unported. No dungeon this project loads defines a DSA, and a file
    // that dropped them silently would be worse than none.
    const numDSA = (dungeon.dsaIndex?.entries ?? []).filter((e) => e !== null).length;
    if (numDSA > 0) {
        throw new Error(`this port cannot write the ${numDSA} DSA programs this dungeon defines`);
    }

    const party = runtime.party;
    const champions = party.champions ?? [];
    // `gb2.ObjectInHand = d.objectInHand.ConvertToInteger()` (`doc/CSBwin-src/SaveGame.cpp:1033`):
    // an empty cursor is `RNnul`, never `RNempty` (0), which CSBWin would load as an object.
    const objectInHand = party.objectInHand & 0xffff;

    const held: number[] = [];
    const carried = objectCarryingTimers(timers, runtime.dungeon.timerQueue ?? []);
    for (const { rn } of carried) held.push(rn);
    for (const champion of champions) {
        for (const slot of champion.possessions) {
            if (slot !== OBJECT_ID_NULL) held.push(slot);
        }
    }
    held.push(objectInHand);

    const index = buildObjectIndirectIndex(dungeon, held);
    const encode = (rn: number) => index.encode(rn);

    // The timers are the one place a reference is not already a field of something the
    // writers reach: `TIMER` bytes 6-9 are plain numbers to every other function, so the
    // translation has to be done by hand, on a copy.
    const written = timers.map((t) => ({ ...t }));
    for (const { slot, at, rn } of carried) {
        const word = encode(rn) & 0xffff;
        const timer = written[slot];
        if (at === 6) { timer.timerWord6 = word; timer.uByte6 = word >> 8; timer.uByte7 = word & 0xff; }
        else { timer.timerWord8 = word; timer.uByte8 = word >> 8; timer.uByte9 = word & 0xff; }
    }

    return {
        extendedFeatures: buildLiveExtendedFeatures({
            cellFlagArraySize: cellFlagArraySize(dungeon.maps),
            extendedWallDecorations: dungeon.extendedWallDecorations,
            spellFilterLocation: dungeon.spellFilterLocation,
            dmRules: game.ctx.rules.dmRules,
            dmRulesDesignOption: game.ctx.rules.dmRulesDesignOption,
        }),
        dungeonImage: buildDungeonImage(dungeon, {
            indirectText: true,
            bigActuators: true,
            newScrolls: true,
            encode,
        }),
        characterBlock: buildCharacterBlock(game, runtime, options, encode),
        objectIndex: index,
        objectInHand: encode(objectInHand),
        timers: written,
    };
}

export function buildSavePayload(game: Game, options: SavePayloadOptions = {}): SavePayload {
    const runtime = game.getRuntimeSaveState();
    const item16 = runtime.dungeon.item16 ?? [];
    const timers = runtime.dungeon.timers ?? [];
    const missiles = runtime.dungeon.missiles ?? [];
    const file = buildFileBlocks(game, runtime, timers, options);
    const saveGameState: SaveGameState = {
        item16,
        timers: file.timers,
        timerQueue: runtime.dungeon.timerQueue,
        timerSequence: runtime.dungeon.timerSequence,
        missiles,
        maxItem16: item16.length,
        maxTimers: timers.length,
        // The 16-byte `TIMER`, which is what every committed save uses and the only form
        // with `m_timerLevel` in a byte of its own. `buildLiveExtendedFeatures` declares
        // `SequencedTimers | ExtendedTimers` to match; the two must agree or block 5 is
        // read at the wrong stride.
        sequencedTimers: true,
        extendedTimers: true,
        handChar: runtime.party.cursorOwner ?? -1,
        magicCaster: runtime.party.magicCasterIndex ?? -1,
        block1: buildBlock1FromGame(runtime),
        block2: {
            ...buildBlock2FromGame(game, runtime),
            objectInHand: file.objectInHand,
        },
        characterBlock: file.characterBlock,
        extendedFeatures: file.extendedFeatures,
        objectIndex: file.objectIndex,
        dsaLevelIndex: game.state.dungeon.dsaLevelIndex,
        dungeonImage: file.dungeonImage,
    };
    return {
        header: makeSaveHeader(runtime),
        runtime,
        raw: encodeBytesToBase64(saveSaveGameState(saveGameState)),
    };
}

/**
 * `GAMEBLOCK1`'s fields, from the live game, as `SaveGame` fills them
 * (`doc/CSBwin-src/SaveGame.cpp:1058-1072`). `SaveOption` is 1, "SAVE AND PLAY" (`:893`):
 * the port saves and plays on, and has no "SAVE AND QUIT".
 */
function buildBlock1FromGame(runtime: RuntimeSaveState): Block1 {
    const b = runtime.game.block1;
    if (!b) throw new Error('the runtime state carries no GAMEBLOCK1 fields');
    return {
        byte22598: b.word22598 & 0xff,
        byte22596: b.word22596 & 0xff,
        saveOption: 1,
        randomGameID: b.randomGameID >>> 0,
        totalMoveCount: b.totalMoveCount >>> 0,
        word22594: b.word22594 & 0xffff,
        word22592: b.word22592 & 0xffff,
        byte22808: Uint8Array.from(b.byte22808),
    };
}

/**
 * `GAMEBLOCK2`, from the live game — the fifteen fields the writer used to leave at
 * zero as well as the six it already had.
 *
 * `SaveGame` assigns each of these from a live counter immediately before it checksums
 * the block (`doc/CSBwin-src/SaveGame.cpp:1010-1031`); this is the same list in the same
 * order, against this port's equivalents.
 *
 * One is written in this port's own terms rather than the file's:
 *
 * - `ObjectInHand` (8) is an RN, which in a file is a slot number in the object
 *   indirect index (`src/data/CsbwinObjectIndex.ts`). This returns the port's packed
 *   `[pos][db][idx]` id; `buildSavePayload` re-encodes it through the index it builds
 *   for the image, because the two have to be one numbering.
 */
function buildBlock2FromGame(game: Game, runtime: RuntimeSaveState): Block2 {
    const party = runtime.party;
    const champions = party.champions ?? [];
    return {
        time: runtime.game.tickCount >>> 0,
        ranseed: runtime.game.randomSeed >>> 0,
        objectInHand: party.objectInHand & 0xffff,
        numCharacter: champions.length,
        partyX: party.position?.x ?? 0,
        partyY: party.position?.y ?? 0,
        partyFacing: party.facing ?? 0,
        partyLevel: party.position?.z ?? 0,
        handChar: party.cursorOwner ?? -1,
        magicCaster: party.magicCasterIndex ?? -1,
        numTimer: runtime.dungeon.timerQueue?.length ?? 0,
        firstAvailTimer: game.timerQueue.getFirstAvailTimer(),
        maxTimers: runtime.dungeon.timers?.length ?? 0,
        item16QueLen: game.monsterSystem.getItem16QueLen(),
        lastMonsterAttackTime: party.lastMonsterAttackTime >>> 0,
        lastPartyMoveTime: runtime.game.footprints.lastPartyMoveTime >>> 0,
        partyMoveDisableTimer: (party.partyMoveDisableTimer ?? 0) & 0xffff,
        word11712: (party.word11712 ?? 0) & 0xffff,
        word11714: (party.word11714 ?? 0) & 0xffff,
        maxItem16: runtime.dungeon.item16?.length ?? 0,
        timerSequence: runtime.dungeon.timerSequence ?? 0,
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
    encodeRN: (rn: number) => number,
): Uint8Array {
    const party = runtime.party;
    const footprints = runtime.game.footprints;
    return buildCsbwinCharacterBlock(
        party.champions ?? [],
        {
            brightness: party.brightness ?? 0,
            seeThruWalls: party.seeThruWalls,
            magicFootprintsActive: party.magicFootprintsActive,
            partyShield: party.partyShield,
            fireShield: party.fireShield,
            spellShield: party.spellShield,
            numFootprintEnt: footprints.count,
            freezeLifeTimer: party.freezeLifeTimer ?? 0,
            indexOfFirstMagicFootprint: footprints.indexOfFirstMagic,
            indexOfLastMagicFootprint: footprints.indexOfLastMagic,
            footprints: footprints.prints,
            footprintAges: footprints.ages,
            invisible: party.invisible,
        },
        {
            load: (champion) => game.characterStats?.characterLoad(champion) ?? champion.load,
            portraitOf: (champion) => options.portraitOf?.(champion),
            // The thirty possession slots are RNs like any other and go out as slot
            // numbers in the same index the image uses.
            encodeRN,
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
 * Restore a parsed payload into the running game. `raw` is read as a CSBWin save's world
 * is, and installed whole whatever world the game was running (`installCsbwinWorld`,
 * `_ReadEntireGame`'s read, doc/CSBwin-src/SaveGame.cpp:2324); then `runtime`, the
 * whole mutable state, is restored over it.
 */
export function applySavePayload(game: Game, payload: SavePayload): void {
    installCsbwinWorld(game, loadCsbwinWorld(decodeBase64ToBytes(payload.raw)));
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
    } else {
        try {
            applyCsbwinSave(game, bytes);
        } catch (error) {
            throw new SavePayloadError(`CSBWIN SAVE: ${(error as Error).message}`.toUpperCase());
        }
    }
    game.savedGameRead();
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
