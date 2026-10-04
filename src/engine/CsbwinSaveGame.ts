/**
 * Load a genuine CSBWin save into the running game.
 *
 * The pieces were all in place separately: `loadCsbwinWorld` parses the dungeon image
 * into a real `DungeonData`, `readCsbwinParty` unpacks `CHARDESC[4]`, and
 * the save's object indirect index, which the world keeps as its `RnMaps`, makes every
 * object reference in either of them mean something.
 * What was missing is this — turning the three into the `RuntimeSaveState` the engine
 * already knows how to restore.
 *
 * The save's world becomes the running game's (`Game.installWorld`), structure and all,
 * as `_ReadEntireGame` reads it (`doc/CSBwin-src/SaveGame.cpp:2324`), so a save of any
 * dungeon loads into any running game. The rest goes through `RuntimeSaveState`, the
 * shape every read restores, whose snapshot then puts back what the world already
 * holds.
 *
 * What is restored, and from where:
 *
 * | Field | Source |
 * | --- | --- |
 * | Party position, facing, level, clock, `d.RandomNumber`, hand owner, magic caster, object in hand | `GAMEBLOCK2` (`doc/CSBwin-src/SaveGame.cpp:1617-1650`) |
 * | The four champions | block 4's `CHARDESC[4]` |
 * | Brightness, the three shields, the footprint ring, `freezeLifeTimer`, invisibility | block 4's 128-byte party tail (`doc/CSBwin-src/Data.h:766-782`) |
 * | The header, every level's descriptor and tables, cell flags, object chains, column index, every database record, the text arrays | the dungeon image, installed |
 * | `dsaLevelIndex`, `dsaIndex`, `specialLocations`, the extended-feature flags | the Extended Features block and `EXPOOL`, added to the same snapshot |
 * | `ITEM16`, missiles | blocks 3 and the image, through `RuntimeSave`'s `applySaveGameState` |
 * | The timer table and the queue that orders it | blocks 5 and 6, through `Game.restoreTimerQueue` |
 * | `d.RandomGameID`, `totalMoveCount`, `d.Byte22808`, `d.Word22592`-`d.Word22598` | `GAMEBLOCK1` (`buildBlock1State`) |
 * | The DSA global variables, and their number | `EXPOOL` (`readGlobalVariables`, `doc/CSBwin-src/SaveGame.cpp:1746-1760`) |
 * | `disableSaves` | `EXPOOL` (`readDisableSaves`, `doc/CSBwin-src/SaveGame.cpp:1791-1793`) |
 *
 * **What is not restored.** A save is the file alone (`SaveGameFile.ts`), so this is
 * everything a save and a load lose. `tools/dump-save-roundtrip.ts` plays a game, saves
 * it, loads it, and holds the whole of what differs to this list.
 *
 * - **What CSBWin's file does not hold either**, and a game it reads starts without:
 *   `d.Word11694` (`gameWon`) and `d.PartySleeping`, `d.PendingDamage` and
 *   `d.PendingOuches` (a blow dealt since the tick's `DisplayCharacterDamage` is never
 *   taken off the HP), `d.SelectedCharacterOrdinal` (the open inventory),
 *   `d.PotentialCharacterOrdinal` and `d.GameIsLost` (`buildPartyState`). CSBWin's disk
 *   menu does not open on a champion who is still being chosen
 *   (`doc/CSBwin-src/Mouse.cpp:1716-1718`), and the port's quick-save takes the same
 *   guard (`GameSaves.quickSave`), so the candidate never reaches a file.
 *
 * And what comes back in the file's form, the same game told otherwise:
 *
 * - A champion the engine created carries `portraitGraphic`; the writer blits the
 *   portrait into `CHARDESC`, as `AddCharacter` does, and a load gives the pixels.
 * - `CHARDESC.load` is the sum the writer computes (`DEBT.md` H), where the live field
 *   carries only what a file said.
 * - A timer's bytes 6-9 come back under both readings, the bytes and the words, where
 *   the live entry had the one its creator set (`RuntimeSave.collapseTimerBytes`).
 * - The footprint ring is the file's twenty-four entries, the ones not yet walked zero.
 * - `dsaLevelIndex`, `extendedWallDecorations` and `spellFilterLocation` are the
 *   Extended Features block's, written out where a game from `dungeon.dat` had none.
 * - A free record keeps only its link: the object a deleted scroll named, what a
 *   deleted monster carried or a deleted chest held, is not written
 *   (`doc/CSBwin-src/data.cpp:993-1015`).
 */
import { loadCsbwinWorld, type CsbwinWorld } from '../data/CsbwinDungeonImage';
import { readRulesOptions } from '../data/CsbwinExtendedFeatures';
import { readDisableSaves, readGlobalVariables } from '../data/CsbwinExpool';
import { readCsbwinParty, readCsbwinPartyTail } from '../data/CsbwinCharacters';
import { CHARDESC_SIZE } from '../data/CsbwinSaveInfo';
import { CheckMonsters } from './CheckMonsters';
import { captureDungeonSnapshot } from './DungeonSnapshot';
import { DungeonState } from './DungeonState';
import type { Game } from './Game';
import type { RuntimeSaveState } from './RuntimeSave';
import { OBJECT_ID_NULL, Position } from '../core/types';
import type { Direction, ObjectID } from '../core/types';
import type { Block1State, PartyState } from './gameTypes';

/**
 * Build the party state out of `GAMEBLOCK2` and block 4.
 *
 * `LoadGame` assigns `d.HandChar` and `d.MagicCaster` **straight** from `GAMEBLOCK2`
 * rather than through `SetHandOwner`/`SelectMagicCaster` (`:1636-1637`), so this does
 * too — the setters would validate a champion and rewrite their facing, and a save is
 * restoring a state that was already valid.
 */
function buildPartyState(world: CsbwinWorld): PartyState {
    const block = world.save.characterBlock;
    const gb2 = world.save.block2;
    if (!block || !gb2) throw new Error('save has no character block or GAMEBLOCK2');

    const party = readCsbwinParty(block, gb2.numCharacter);
    const tail = readCsbwinPartyTail(block);

    // `d.objectInHand.NonExtendedInteger(b.gb2.ObjectInHand)` (`:1642`) — the cursor's
    // object is an indirect slot number like every other RN in the file. `RNempty` is 0;
    // the port keeps `RNnul` as its one empty value.
    const rawInHand = gb2.objectInHand & 0xffff;
    const objectInHand =
        rawInHand === 0 || rawInHand === 0xffff || rawInHand === 0xfffe
            ? OBJECT_ID_NULL
            : rawInHand as ObjectID;

    const position = new Position(gb2.partyX, gb2.partyY, gb2.partyLevel);

    return {
        champions: party.map((c) => c.champion),
        position,
        facing: (gb2.partyFacing & 3) as Direction,
        magicCasterIndex: gb2.magicCaster,
        cursorOwner: gb2.handChar,
        selectedCharacterIndex: -1,
        // None of the three is in the file's party blocks. `LoadGame` clears
        // `d.GameIsLost` (doc/CSBwin-src/SaveGame.cpp:1891); the other two take
        // `initialPartyState`'s values, as they did before they were required.
        potentialChampionIndex: -1,
        gameIsLost: false,
        // `d.PendingDamage` and `d.PendingOuches` are not in the file either.
        pendingDamage: [0, 0, 0, 0],
        pendingOuches: [0, 0, 0, 0],
        sleeping: false,
        objectInHand,
        partyShield: tail.partyShield,
        fireShield: tail.fireShield,
        spellShield: tail.spellShield,
        brightness: tail.brightness,
        invisible: tail.invisible,
        seeThruWalls: tail.seeThruWalls,
        magicFootprintsActive: tail.magicFootprintsActive,
        lastMonsterAttackTime: gb2.lastMonsterAttackTime,
        freezeLifeTimer: tail.freezeLifeTimer,
        // `d.partyMoveDisableTimer = b.gb2.partyMoveDisableTimer`, `d.Word11712`,
        // `d.Word11714` (doc/CSBwin-src/SaveGame.cpp:1645-1647).
        partyMoveDisableTimer: gb2.partyMoveDisableTimer,
        word11712: gb2.word11712,
        word11714: gb2.word11714,
        // `UnscrambleStream` reads all four records, the slots past the party with the
        // rest (doc/CSBwin-src/SaveGame.cpp:1676). A champion's own slot is held as
        // `AddCharacter` leaves it before filling it, cleared (`Character.cpp:481`).
        vacantCharacters: Array.from({ length: 4 }, (_, i) => i < party.length
            ? new Uint8Array(CHARDESC_SIZE)
            : block.slice(i * CHARDESC_SIZE, (i + 1) * CHARDESC_SIZE)),
    };
}

/**
 * `GAMEBLOCK1` into `d.`, as `LoadGame` takes it. `_ReadEntireGame` first sets the four
 * words to 2, 1, 1 and 13 (`doc/CSBwin-src/SaveGame.cpp:1467-1470`); the load copies
 * `totalMoveCount`, `RandomGameID` and `Byte22808` (`:1603`, `:1610-1611`), then
 * `Word22598` from its byte (`:1859-1860`). A save whose `Byte22596` is 1 is an Atari DM
 * save, whose `Word22592` is set from the dungeon it holds: 10 for fourteen levels and a
 * sentinel of 99, 13 for ten levels and 76, otherwise 0 (`:1861-1877`). Any other save
 * brings its own three words (`:1878-1881`).
 */
function buildBlock1State(world: CsbwinWorld): Block1State {
    const gb1 = world.save.block1;
    if (!gb1) throw new Error('save has no GAMEBLOCK1');
    const block1: Block1State = {
        randomGameID: gb1.randomGameID >>> 0,
        word22592: 13,
        word22594: 1,
        word22596: 2,
        word22598: gb1.byte22598 & 0xff,
        byte22808: [...gb1.byte22808],
        totalMoveCount: gb1.totalMoveCount >>> 0,
    };
    if ((gb1.byte22596 & 0xff) === 1) {
        const { numMaps, randomSeed: sentinel } = world.dungeon.header;
        block1.word22592 = numMaps === 14 && sentinel === 99 ? 10
            : numMaps === 10 && sentinel === 76 ? 13
            : 0;
    } else {
        block1.word22596 = gb1.byte22596 & 0xff;
        block1.word22594 = gb1.word22594;
        block1.word22592 = gb1.word22592;
    }
    return block1;
}

/**
 * Everything a CSBWin save says, in the shape `Game.applyRuntimeSaveState` takes.
 *
 * Pure: no `Game` is touched, so a verification tool can build one and read it without
 * standing a game up.
 */
export function buildCsbwinRuntimeState(world: CsbwinWorld): RuntimeSaveState {
    const gb2 = world.save.block2;
    if (!gb2) throw new Error('save has no GAMEBLOCK2');
    const block = world.save.characterBlock;
    if (!block) throw new Error('save has no character block');
    const tail = readCsbwinPartyTail(block);

    return {
        party: buildPartyState(world),
        game: {
            // `d.Time = d.Long11732 = b.gb2.Time` (`:1622`) — the game clock, in ticks.
            tickCount: gb2.time,
            // `d.RandomNumber = b.gb2.ranseed` (`:1624`), so the stream continues where
            // the saved game left it rather than being reseeded from the host clock.
            randomSeed: gb2.ranseed >>> 0,
            gameWon: false,
            footprints: {
                prints: [...tail.footprints],
                ages: [...tail.footprintAges],
                count: tail.numFootprintEnt,
                lastPartyMoveTime: gb2.lastPartyMoveTime,
                indexOfFirstMagic: tail.indexOfFirstMagicFootprint,
                indexOfLastMagic: tail.indexOfLastMagicFootprint,
            },
            dsaGlobals: readGlobalVariables(world.dungeon),
            // `disableSaves`'s records leave the pool as they are read (`:1791-1793`).
            disableSaves: readDisableSaves(world.dungeon),
            block1: buildBlock1State(world),
        },
        dungeon: {
            item16: world.save.item16,
            timers: world.save.timers,
            timerQueue: world.save.timerQueue,
            timerSequence: world.save.timerSequence,
            firstAvailTimer: gb2.firstAvailTimer,
            missiles: world.save.missiles,
            // The image holds none of these five: the save carries them beside it.
            snapshot: captureDungeonSnapshot({
                ...world.dungeon,
                dsaLevelIndex: world.save.dsaLevelIndex,
                dsaIndex: world.save.dsaIndex,
                specialLocations: world.save.specialLocations,
                extendedWallDecorations: world.save.extendedWallDecorations,
                spellFilterLocation: world.save.spellFilterLocation,
            }),
        },
    };
}

/**
 * `_ReadEntireGame`'s read of a save's world, installed as the running game's
 * (`Game.installWorld`): the image, structure and all, with the five the save carries
 * beside it, its rules, and `CheckMonsters` (doc/CSBwin-src/SaveGame.cpp:1826). The save
 * restores its state over it (`applyCsbwinSave`).
 */
function installCsbwinWorld(game: Game, world: CsbwinWorld): void {
    // Before `reloadAfterSaveGame` detaches the save's `ITEM16`s (`src/engine/CheckMonsters.ts`).
    CheckMonsters(new DungeonState(world.dungeon), game.ctx.tables.monsterDesc, (line) => game.ctx.host.trace(line));
    readRulesOptions(game.ctx.rules, world.save.extendedFeatures, world.save.simpleEncipher);
    game.installWorld(Object.assign(world.dungeon, {
        dsaLevelIndex: world.save.dsaLevelIndex,
        dsaIndex: world.save.dsaIndex,
        specialLocations: world.save.specialLocations,
        extendedWallDecorations: world.save.extendedWallDecorations,
        spellFilterLocation: world.save.spellFilterLocation,
    }));
}

/** Parse a CSBWin save and restore it into the running game. Throws on a bad file. */
export function applyCsbwinSave(game: Game, bytes: Uint8Array): CsbwinWorld {
    const world = loadCsbwinWorld(bytes);
    installCsbwinWorld(game, world);
    // The snapshot puts back what the installed world already holds.
    game.applyRuntimeSaveState(buildCsbwinRuntimeState(world));
    // The image's records are already big-actuator records.
    if (world.save.bigActuators) game.ctx.state.dungeon.bigActuators = true;
    return world;
}
