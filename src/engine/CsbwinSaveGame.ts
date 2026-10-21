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
 * The save's world becomes the running game's (`readGame`), structure and all,
 * as `_ReadEntireGame` reads it (`doc/CSBwin-src/SaveGame.cpp:2536`), so a save of any
 * dungeon loads into any running game. The rest goes through `RuntimeSaveState`, the
 * shape every read restores, whose snapshot then puts back what the world already
 * holds.
 *
 * What is restored, and from where:
 *
 * | Field | Source |
 * | --- | --- |
 * | Party position, facing, level, clock, `d.RandomNumber`, hand owner, magic caster, object in hand | `GAMEBLOCK2` (`doc/CSBwin-src/SaveGame.cpp:1741-1774`) |
 * | The four champions | block 4's `CHARDESC[4]` |
 * | Brightness, the three shields, the footprint ring, `freezeLifeTimer`, invisibility | block 4's 128-byte party tail (`doc/CSBwin-src/Data.h:781-797`) |
 * | The header, every level's descriptor and tables, cell flags, object chains, column index, every database record, the text arrays | the dungeon image, installed |
 * | `dsaLevelIndex`, `dsaIndex`, `specialLocations`, the extended-feature flags | the Extended Features block and `EXPOOL`, added to the same snapshot |
 * | `ITEM16`, missiles | blocks 3 and the image, through `RuntimeSave`'s `applySaveGameState` |
 * | The timer table and the queue that orders it | blocks 5 and 6, into `TimerQueue.restore` (`installRuntimeState`) |
 * | `d.RandomGameID`, `totalMoveCount`, `d.Byte22808`, `d.Word22592`-`d.Word22598` | `GAMEBLOCK1` (`buildBlock1State`) |
 * | The DSA global variables, and their number | `EXPOOL` (`readGlobalVariables`, `doc/CSBwin-src/SaveGame.cpp:1916-1930`) |
 * | The overlay palette | `EXPOOL` (`readOverlayPalette`, `doc/CSBwin-src/SaveGame.cpp:1931-1959`), the identity without it |
 * | `disableSaves` | `EXPOOL` (`readDisableSaves`, `doc/CSBwin-src/SaveGame.cpp:1962-1964`) |
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
 *   (`doc/CSBwin-src/Mouse.cpp:1855-1857`), and the port's quick-save takes the same
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
 * - `dsaLevelIndex`, `extendedWallDecorations`, `spellFilterLocation` and `hintKey` are
 *   the Extended Features block's, written out where a game from `dungeon.dat` had none,
 *   and `gameInfo` is "No game information was provided", which `ReadGameInfo` reads for
 *   the size of 0 such a game writes.
 * - A free record keeps only its link: the object a deleted scroll named, what a
 *   deleted monster carried or a deleted chest held, is not written
 *   (`doc/CSBwin-src/data.cpp:995-1017`).
 */
import { loadCsbwinWorld, type CsbwinWorld } from '../data/CsbwinDungeonImage';
import { readGameInfo } from '../data/CsbwinExtendedFeatures';
import { readDisableSaves, readGlobalVariables, readOverlayPalette, specialLocationsFromExpool } from '../data/CsbwinExpool';
import { readCsbwinParty, readCsbwinPartyTail } from '../data/CsbwinCharacters';
import { databaseRecords } from '../data/CsbwinObjectIndex';
import { CHARDESC_SIZE } from '../data/CsbwinSaveInfo';
import type { Block2 } from '../data/SaveGameLoader';
import { CheckMonsters } from './CheckMonsters';
import { captureDungeonSnapshot } from './DungeonSnapshot';
import { DungeonState } from './DungeonState';
import type { Game } from './Game';
import { identityOverlayPalette } from './OverlayPalette';
import { readGame } from './ReadGame';
import type { RuntimeSaveState } from './RuntimeSave';
import { DBType, OBJECT_ID_NULL, Position } from '../core/types';
import type { Direction, ObjectID } from '../core/types';
import type { Block1State, PartyState } from './gameTypes';
import type { GameInfo, MissileRecord } from '../data/dungeonTypes';

/**
 * `d.objectInHand.NonExtendedInteger(b.gb2.ObjectInHand)` (`doc/CSBwin-src/SaveGame.cpp:1773`):
 * the cursor's object is an indirect slot number like every other RN in the file.
 * `RNempty` is 0; the port keeps `RNnul` as its one empty value.
 */
function objectInHandOf(gb2: Block2): ObjectID {
    const raw = gb2.objectInHand & 0xffff;
    return raw === 0 || raw === 0xffff || raw === 0xfffe ? OBJECT_ID_NULL : raw as ObjectID;
}

/**
 * A save held against its world, before the read builds anything. `LoadGame` assigns
 * the party's level, x and y, `d.NumCharacter`, `d.HandChar`, `d.MagicCaster` and the
 * object in hand straight from `GAMEBLOCK2` (`doc/CSBwin-src/SaveGame.cpp:1755-1773`),
 * and reads the timer queue's `NumTimer` entries (`:1763-1764`, `:1819-1823`), checking
 * none of them: a value outside what it names is read past the level's cells, the
 * four `CHARDESC`s, the object index or the timer table. The port refuses such a save
 * (`DEBT.md` H). A slot inside `numCharacter` that holds no champion is CSBWin's to
 * play, and is read (`readCsbwinParty`). The champions' positions are not held: CSBWin
 * masks them where it uses them, and stores an impossible 5 there itself
 * (`doc/PROVEN_FACTS.md` -> "A save's party, hand and timers are read without a check
 * against its world").
 */
export function validateCsbwinWorld(world: CsbwinWorld): void {
    const gb2 = world.save.block2;
    if (!gb2) throw new Error('save has no GAMEBLOCK2');
    const { maps } = world.dungeon;
    const map = maps[gb2.partyLevel];
    if (!map) throw new Error(`the party is on level ${gb2.partyLevel}, of levels 0 to ${maps.length - 1}`);
    const { width, height } = map.descriptor;
    if (gb2.partyX < 0 || gb2.partyX >= width || gb2.partyY < 0 || gb2.partyY >= height) {
        throw new Error(`the party is at ${gb2.partyX},${gb2.partyY}, on a level of ${width} by ${height}`);
    }

    const { numCharacter } = gb2;
    if (numCharacter < 0 || numCharacter > 4) throw new Error(`the party is ${numCharacter} champions`);
    const champion = (index: number, what: string): void => {
        if (index < -1 || index >= numCharacter) throw new Error(`${what} is champion ${index}, of ${numCharacter}`);
    };
    champion(gb2.handChar, 'the hand');
    champion(gb2.magicCaster, 'the magic caster');

    const objectInHand = objectInHandOf(gb2);
    if (objectInHand !== OBJECT_ID_NULL) {
        const { rnMaps, databases } = world.dungeon;
        const db = rnMaps.dbType(objectInHand);
        if (db === DBType.UNKNOWN || rnMaps.idx(objectInHand) >= databaseRecords(databases, db).length) {
            throw new Error(`the object in hand, ${objectInHand}, names no record`);
        }
    }

    const { numTimer, maxTimers, firstAvailTimer } = gb2;
    if (numTimer < 0 || numTimer > maxTimers) throw new Error(`the timer queue is ${numTimer} timers, of ${maxTimers}`);
    if (firstAvailTimer < 0 || firstAvailTimer > maxTimers) {
        throw new Error(`the first free timer is ${firstAvailTimer}, of ${maxTimers}`);
    }
    for (const index of world.save.timerQueue ?? []) {
        if (index >= maxTimers) throw new Error(`the timer queue names timer ${index}, of ${maxTimers}`);
    }
}

/**
 * Build the party state out of `GAMEBLOCK2` and block 4.
 *
 * `LoadGame` assigns `d.HandChar` and `d.MagicCaster` **straight** from `GAMEBLOCK2`
 * rather than through `SetHandOwner`/`SelectMagicCaster` (`:1760-1761`), so this does
 * too — the setters would validate a champion and rewrite their facing, and a save is
 * restoring a state that was already valid.
 */
function buildPartyState(world: CsbwinWorld): PartyState {
    const block = world.save.characterBlock;
    const gb2 = world.save.block2;
    if (!block || !gb2) throw new Error('save has no character block or GAMEBLOCK2');

    const party = readCsbwinParty(block, gb2.numCharacter);
    const tail = readCsbwinPartyTail(block);

    // The `CURSORFILTER_ReadGame` that follows the object in hand (`:1774-1779`) runs no
    // DSA (`Game.readNewGame`).
    const objectInHand = objectInHandOf(gb2);

    const position = new Position(gb2.partyX, gb2.partyY, gb2.partyLevel);

    return {
        champions: party.map((c) => c.champion),
        position,
        facing: (gb2.partyFacing & 3) as Direction,
        magicCasterIndex: gb2.magicCaster,
        cursorOwner: gb2.handChar,
        selectedCharacterIndex: -1,
        // None of the three is in the file's party blocks. `LoadGame` clears
        // `d.GameIsLost` (doc/CSBwin-src/SaveGame.cpp:2095); the other two take
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
        // `d.Word11714` (doc/CSBwin-src/SaveGame.cpp:1769-1771).
        partyMoveDisableTimer: gb2.partyMoveDisableTimer,
        word11712: gb2.word11712,
        word11714: gb2.word11714,
        // `UnscrambleStream` reads all four records, the slots past the party with the
        // rest (doc/CSBwin-src/SaveGame.cpp:1802). A champion's own slot is held as
        // `AddCharacter` leaves it before filling it, cleared (`Character.cpp:482`).
        vacantCharacters: Array.from({ length: 4 }, (_, i) => i < party.length
            ? new Uint8Array(CHARDESC_SIZE)
            : block.slice(i * CHARDESC_SIZE, (i + 1) * CHARDESC_SIZE)),
    };
}

/**
 * `GAMEBLOCK1` into `d.`, as `LoadGame` takes it. `_ReadEntireGame` first sets the four
 * words to 2, 1, 1 and 13 (`doc/CSBwin-src/SaveGame.cpp:1568-1571`); the load copies
 * `totalMoveCount`, `RandomGameID` and `Byte22808` (`:1728`, `:1734-1735`), then
 * `Word22598` from its byte (`:2063-2064`). A save whose `Byte22596` is 1 is an Atari DM
 * save, whose `Word22592` is set from the dungeon it holds: 10 for fourteen levels and a
 * sentinel of 99, 13 for ten levels and 76, otherwise 0 (`:2065-2081`). Any other save
 * brings its own three words (`:2082-2085`).
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
 * The image's missile records. A free one, its link `RNnul`, keeps a stale flying object
 * whose slot may have been freed since, so it is read as `RNnul`, as `DungeonLoader`
 * reads it when the save has an object index (`readRNOfRecord`).
 */
function missilesOf(world: CsbwinWorld): MissileRecord[] {
    return world.dungeon.databases.missiles.records.map((record) => ({
        ...record,
        projectileObject: record.nextObject === OBJECT_ID_NULL ? OBJECT_ID_NULL : record.projectileObject,
    }));
}

/** `ReadGameInfo` over the save's block (`readGameInfo`); none for a save without one. */
function gameInfoOf(world: CsbwinWorld): GameInfo | undefined {
    const block = world.save.extendedFeatures;
    return block ? readGameInfo(block.gameInfoSize, world.save.gameInfo ?? new Uint8Array(0)) : undefined;
}

/** `EDT_SpecialLocations`, the image's EXPOOL records of special locations. */
function specialLocationsOf(world: CsbwinWorld): Record<number, number> | undefined {
    return (world.dungeon.expool && specialLocationsFromExpool(world.dungeon.expool)) ?? undefined;
}

/**
 * Everything a CSBWin save says, in the shape a read installs (`readGame`).
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
            // `d.Time = d.Long11732 = b.gb2.Time` (`:1746`) — the game clock, in ticks.
            tickCount: gb2.time,
            // `d.RandomNumber = b.gb2.ranseed` (`:1748`), so the stream continues where
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
            // The palette `d.Initialize()` cleared stays when a record is missing.
            overlayPalette: readOverlayPalette(world.dungeon) ?? identityOverlayPalette(),
            // `disableSaves`'s records leave the pool as they are read (`:1962-1964`).
            disableSaves: readDisableSaves(world.dungeon),
            block1: buildBlock1State(world),
        },
        dungeon: {
            item16: world.save.item16,
            timers: world.save.timers,
            timerQueue: world.save.timerQueue,
            timerSequence: world.save.timerSequence,
            firstAvailTimer: gb2.firstAvailTimer,
            missiles: missilesOf(world),
            // The image holds none of these seven: the save carries them beside it.
            snapshot: captureDungeonSnapshot({
                ...world.dungeon,
                dsaLevelIndex: world.save.dsaLevelIndex,
                dsaIndex: world.save.dsaIndex,
                specialLocations: specialLocationsOf(world),
                extendedWallDecorations: world.save.extendedWallDecorations,
                spellFilterLocation: world.save.spellFilterLocation,
                hintKey: world.save.hintKey,
                gameInfo: gameInfoOf(world),
            }),
        },
    };
}

/**
 * Parse a CSBWin save and read it into the running game (`readGame`): its world, the
 * image, structure and all, with the seven the save carries beside it, and its state.
 * Throws on a bad file.
 */
export function applyCsbwinSave(game: Game, bytes: Uint8Array): CsbwinWorld {
    const world = loadCsbwinWorld(bytes);
    validateCsbwinWorld(world);
    readGame(game, {
        world: world.dungeon,
        extendedFeatures: world.save.extendedFeatures,
        simpleEncipher: world.save.simpleEncipher,
        state: () => {
            // `_ReadEntireGame`'s `CheckMonsters` (doc/CSBwin-src/SaveGame.cpp:2029), before
            // `reloadAfterSaveGame` detaches the save's `ITEM16`s (`src/engine/CheckMonsters.ts`).
            CheckMonsters(new DungeonState(world.dungeon), game.ctx.tables.monsterDesc, (line) => game.ctx.host.trace(line));
            Object.assign(world.dungeon, {
                dsaLevelIndex: world.save.dsaLevelIndex,
                dsaIndex: world.save.dsaIndex,
                specialLocations: specialLocationsOf(world),
                extendedWallDecorations: world.save.extendedWallDecorations,
                spellFilterLocation: world.save.spellFilterLocation,
                hintKey: world.save.hintKey,
                gameInfo: gameInfoOf(world),
            });
            // The image's records are already big-actuator records.
            if (world.save.bigActuators) world.dungeon.bigActuators = true;
            // The snapshot puts back what the installed world already holds.
            return buildCsbwinRuntimeState(world);
        },
    });
    return world;
}
