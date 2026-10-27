/**
 * A save file, built from a live game and read back into one.
 *
 * A save is a CSBWin file and nothing else: the scrambled, checksummed sixteen blocks
 * `writeSaveFile` writes, which CSBWin itself opens. `toSaveFile` makes its blocks from
 * the running game, `buildSaveFile` its bytes, and `applySaveBytes` reads one back, the
 * port's or a genuine one, as `_ReadEntireGame` does (`fromSaveFile`, through
 * `applyCsbwinSave`): the file's world is installed whole,
 * whatever world the game was running, so a save of any dungeon loads into any running
 * game.
 *
 * What a file does not hold, a load does not give back: `src/engine/CsbwinSaveGame.ts` →
 * "What is not restored", which `tools/checks/save-roundtrip.ts` holds to its list.
 */
import { Die } from '../core/Die';
import {
    encodeBlock1,
    encodeBlock2,
    encodeItem16,
    encodeTimers,
    encodeTimerQueue,
    writeSaveFile,
    type Block1,
    type Block2,
    type SaveFileBlocks,
} from '../data/SaveFile';
import { applyCsbwinSave } from './CsbwinSaveGame';
import { buildCsbwinCharacterBlock } from '../data/CsbwinCharacters';
import { objectIndexOf } from '../data/CsbwinObjectIndex';
import { buildDungeonImage, cellFlagArraySize } from '../data/CsbwinDungeonImageWriter';
import { buildExtendedFeaturesPrefix, buildLiveExtendedFeatures } from '../data/CsbwinExtendedFeatures';
import { Expool } from '../data/CsbwinExpool';
import type { Game } from './Game';
import { getRuntimeState, type RuntimeState } from './RuntimeSave';
import type { Champion } from './gameTypes';

export interface SaveFileOptions {
    /**
     * The portrait pixels of a champion who carries only `portraitGraphic` — every
     * champion this engine created, since the engine holds no graphics to blit from.
     * `HostDrawing.portraitOf` is the one the app passes; without it such a
     * champion's `CHARDESC.portrait` is written blank.
     */
    portraitOf?: (champion: Champion) => number[] | undefined;
}

/**
 * The file's blocks, from the running game: the world it runs on, and what it holds
 * beside it (`getRuntimeState`).
 *
 * Every RN in them — the object list, every record link, the thirty possession slots of
 * every champion, `GAMEBLOCK2.ObjectInHand` and the object a timer is carrying — is a
 * slot of the world's object indirect index, and block 0 carries the index's two maps
 * as the world holds them (`objectIndexOf`), as CSBWin writes `dataTypeMap` and
 * `dataIndexMap` (`doc/CSBwin-src/SaveGame.cpp:952-958`, `:1010-1011`).
 */
export function toSaveFile(game: Game, options: SaveFileOptions = {}): SaveFileBlocks {
    const dungeon = game.ctx.dungeon.getData();
    const runtime = getRuntimeState(game.ctx);

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
    // The DSA global variables go into their `EXPOOL` records before the databases are
    // written (`doc/CSBwin-src/SaveGame.cpp:1205-1213`), in the running world as CSBWin's.
    const expool = new Expool(dungeon);
    if (!expool.storeGlobalVariables(runtime.game.dsaGlobals)) {
        game.ctx.host.trace('Error saving global variables');
    }
    // Then the overlay palette's 24 records (`:1216-1231`), and the record of
    // `disableSaves` (`:1293-1295`).
    expool.storeOverlayPalette(runtime.game.overlayPalette);
    if (runtime.game.disableSaves) expool.writeDisableSaves();

    const { item16, timers, timerQueue } = runtime.dungeon;
    const { typeMap, indexMap } = objectIndexOf(dungeon.rnMaps);
    return {
        block0: buildExtendedFeaturesPrefix({
            header: buildLiveExtendedFeatures({
                cellFlagArraySize: cellFlagArraySize(dungeon.maps),
                extendedWallDecorations: dungeon.extendedWallDecorations,
                spellFilterLocation: dungeon.spellFilterLocation,
                dmRules: game.ctx.rules.dmRules,
                dmRulesDesignOption: game.ctx.rules.dmRulesDesignOption,
                invisibleMonsters: game.ctx.rules.invisibleMonsters,
                drawAsSize4Monsters: game.ctx.rules.drawAsSize4Monsters,
                simpleEncipher: game.ctx.rules.simpleEncipher,
                supressDSAWarningOption: game.ctx.rules.supressDSAWarningOption,
                bGravityGame: game.ctx.rules.bGravityGame,
                bThreeDMovements: game.ctx.rules.bThreeDMovements,
                dsaIndex: dungeon.dsaIndex,
                signatures: game.ctx.signatures,
                hintKey: dungeon.hintKey,
                gameInfo: dungeon.gameInfo,
                overlay: game.ctx.overlay.toExtendedFeatures(),
            }),
            typeMap,
            indexMap,
            // The DSAs as play left them: a DSA whose `localState` is 1 keeps its state in
            // its own `m_state` (`DsaSystem.putState`), which `DSA::Write` writes.
            dsaIndex: dungeon.dsaIndex,
            gameInfo: dungeon.gameInfo?.text,
            dsaLevelIndex: dungeon.dsaLevelIndex,
        }),
        block1: encodeBlock1(buildBlock1FromGame(runtime)),
        block2: encodeBlock2(buildBlock2FromGame(game, runtime)),
        item16: encodeItem16(item16),
        characters: buildCharacterBlock(game, runtime, options),
        // The 16-byte `TIMER`, which is what every committed save uses and the only form
        // with `m_timerLevel` in a byte of its own. `buildLiveExtendedFeatures` declares
        // `SequencedTimers | ExtendedTimers` to match; the two must agree or block 5 is
        // read at the wrong stride.
        timers: encodeTimers(timers, 16, timerQueue),
        timerQueue: encodeTimerQueue(timerQueue, timers.length),
        image: buildDungeonImage(dungeon, {
            indirectText: true,
            bigActuators: true,
            newScrolls: true,
        }),
    };
}

/** The save file of the game as it stands: all sixteen blocks. */
export function buildSaveFile(game: Game, options: SaveFileOptions = {}): Uint8Array {
    return writeSaveFile(toSaveFile(game, options));
}

/**
 * `GAMEBLOCK1`'s fields, from the live game, as `SaveGame` fills them
 * (`doc/CSBwin-src/SaveGame.cpp:1083-1097`). `SaveOption` is 1, "SAVE AND PLAY" (`:917`):
 * the port saves and plays on, and has no "SAVE AND QUIT".
 */
function buildBlock1FromGame(runtime: RuntimeState): Block1 {
    const b = runtime.game.block1;
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
 * `GAMEBLOCK2`, from the live game: all twenty-one fields.
 *
 * `SaveGame` assigns each of these from a live counter immediately before it checksums
 * the block (`doc/CSBwin-src/SaveGame.cpp:1035-1056`); this is the same list in the same
 * order, against this port's equivalents.
 *
 * `ObjectInHand` (8) is an RN, a slot of the object indirect index block 0 carries
 * (`src/data/CsbwinObjectIndex.ts`).
 */
function buildBlock2FromGame(game: Game, runtime: RuntimeState): Block2 {
    const party = runtime.party;
    return {
        time: runtime.game.tickCount >>> 0,
        ranseed: runtime.game.randomSeed >>> 0,
        // `gb2.ObjectInHand = d.objectInHand.ConvertToInteger()` (`doc/CSBwin-src/SaveGame.cpp:1058`):
        // an empty cursor is `RNnul`, never `RNempty` (0), which CSBWin would load as an object.
        objectInHand: party.objectInHand & 0xffff,
        numCharacter: party.champions.length,
        partyX: party.position.x,
        partyY: party.position.y,
        partyFacing: party.facing,
        partyLevel: party.position.z,
        handChar: party.cursorOwner,
        magicCaster: party.magicCasterIndex,
        numTimer: runtime.dungeon.timerQueue.length,
        firstAvailTimer: runtime.dungeon.firstAvailTimer,
        maxTimers: runtime.dungeon.timers.length,
        item16QueLen: game.systems.monsters.getItem16QueLen(),
        lastMonsterAttackTime: party.lastMonsterAttackTime >>> 0,
        lastPartyMoveTime: runtime.game.footprints.lastPartyMoveTime >>> 0,
        partyMoveDisableTimer: party.partyMoveDisableTimer & 0xffff,
        word11712: party.word11712 & 0xffff,
        word11714: party.word11714 & 0xffff,
        maxItem16: runtime.dungeon.item16.length,
        timerSequence: runtime.dungeon.timerSequence,
    };
}

/**
 * Block 4 — `CHARDESC[4]` and the 128 bytes of party state beside them — packed out of
 * the live party.
 *
 * The two things a `Champion` does not carry are supplied here, both from the running
 * game: `CHARDESC.load`, which CSBWin keeps incrementally and this port re-sums,
 * written without the object in hand as `SaveGame` writes it
 * (`CharacterStats.savedLoad`), and the portrait pixels for a champion the *engine*
 * created, who carries `portraitGraphic` (a cell of basic graphic 26, or past 23 a
 * portrait of `CSBgraphics.dat`) because the engine holds no graphics to blit from.
 * `AddCharacter` blits that portrait into the character record once
 * (`doc/CSBwin-src/Character.cpp:485-509`); the port does the same here, at the
 * write.
 */
function buildCharacterBlock(
    game: Game,
    runtime: RuntimeState,
    options: SaveFileOptions,
): Uint8Array {
    const party = runtime.party;
    const footprints = runtime.game.footprints;
    return buildCsbwinCharacterBlock(
        party.champions,
        {
            brightness: party.brightness,
            seeThruWalls: party.seeThruWalls,
            magicFootprintsActive: party.magicFootprintsActive,
            partyShield: party.partyShield,
            fireShield: party.fireShield,
            spellShield: party.spellShield,
            numFootprintEnt: footprints.count,
            freezeLifeTimer: party.freezeLifeTimer,
            indexOfFirstMagicFootprint: footprints.indexOfFirstMagic,
            indexOfLastMagicFootprint: footprints.indexOfLastMagic,
            footprints: footprints.prints,
            footprintAges: footprints.ages,
            invisible: party.invisible,
        },
        {
            load: (champion) => game.systems.characterStats.savedLoad(champion),
            portraitOf: (champion) => options.portraitOf?.(champion),
        },
        party.vacantCharacters,
    );
}

export class SaveFileError extends Error {}

/**
 * Restore what the store handed back: a CSBWin file, the port's or a genuine one.
 *
 * The two menus and the quick-load all come through here. A failure becomes a
 * `SaveFileError`, because the menu's status line is the only place it can be shown,
 * and it wants a short line rather than a stack. A `Die` stays one: it has ended the
 * game, and the page has its message (`src/engine/Die.ts`).
 */
export function applySaveBytes(game: Game, bytes: Uint8Array): void {
    const inventoryWasOpen = game.ctx.party.state.selectedCharacterIndex >= 0;
    try {
        applyCsbwinSave(game, bytes);
    } catch (error) {
        if (error instanceof Die) throw error;
        throw new SaveFileError(`CSBWIN SAVE: ${(error as Error).message}`.toUpperCase());
    }
    game.savedGameRead(inventoryWasOpen);
}
