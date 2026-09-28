/**
 * Load a genuine CSBWin save into the running game.
 *
 * The pieces were all in place separately: `loadCsbwinWorld` parses the dungeon image
 * into a real `DungeonData`, `readCsbwinParty` unpacks `CHARDESC[4]`, and
 * `CsbwinObjectIndex` makes every object reference in either of them mean something.
 * What was missing is this — turning the three into the `RuntimeSaveState` the engine
 * already knows how to restore.
 *
 * Going through `RuntimeSaveState` rather than replacing `Game.state.dungeon` outright
 * is deliberate. The live `DungeonData` is held by reference all over the engine — the
 * renderer, `DungeonState`, every subsystem — so swapping the object would leave half
 * the game looking at the old world. `applyRuntimeSaveState` already re-seats all of it
 * from a snapshot, and has been doing so for the quick-save; a CSBWin save is simply
 * another source for the same snapshot.
 *
 * What is restored, and from where:
 *
 * | Field | Source |
 * | --- | --- |
 * | Party position, facing, level, clock, `d.RandomNumber`, hand owner, magic caster, object in hand | `GAMEBLOCK2` (`doc/CSBwin-src/SaveGame.cpp:1617-1650`) |
 * | The four champions | block 4's `CHARDESC[4]` |
 * | Brightness, the three shields, the footprint ring, `freezeLifeTimer`, invisibility | block 4's 128-byte party tail (`doc/CSBwin-src/Data.h:766-782`) |
 * | Cell flags, object chains, column index, every database record, the text arrays | the dungeon image, through `captureDungeonSnapshot` |
 * | `dsaLevelIndex`, `dsaIndex`, `specialLocations`, the extended-feature flags | the Extended Features block and `EXPOOL`, added to the same snapshot |
 * | `ITEM16`, missiles | blocks 3 and the image, through `applySaveGameState` |
 * | The timer table and the queue that orders it | blocks 5 and 6, through `Game.restoreTimerQueue` |
 *
 * **What is not restored**, all of it recorded in `PLAN.md`:
 *
 * - **The DSA global variables.** CSBWin reads them out of `EXPOOL` under
 *   `(EDT_Database << 24) | (EDBT_GlobalVariables << 16) | i`, sixteen `ui32` per record
 *   (`doc/CSBwin-src/SaveGame.cpp:1746-1763`), and `locateExpoolRecord` finds a record's
 *   first word but does not hand back the run. No committed save needs it: the shipped
 *   DM dungeon defines no DSAs at all — `numDSA` is 0 and there are no special-location
 *   records in any of the twelve — so the live game's globals are kept rather than
 *   cleared.
 * - **`d.Word11694`** (`gameWon`) and `d.PartySleeping`, neither of which `GAMEBLOCK2`
 *   carries where this reader looks.
 */
import { loadCsbwinWorld, type CsbwinWorld } from './CsbwinDungeonImage';
import { readCsbwinParty, readCsbwinPartyTail } from './CsbwinCharacters';
import { captureDungeonSnapshot } from '../engine/DungeonSnapshot';
import type { Game } from '../engine/Game';
import { RUNTIME_SAVE_VERSION, type RuntimeSaveState } from '../engine/RuntimeSave';
import type { TimerRecord } from './dungeonTypes';
import { OBJECT_ID_NULL, Position } from '../core/types';
import type { Direction, ObjectID } from '../core/types';
import type { PartyState } from '../engine/gameTypes';

export interface CsbwinRuntimeOptions {
    /**
     * The DSA global variables to keep. CSBWin's live in `EXPOOL` and are not read yet
     * (see the module comment); passing the running game's own leaves them untouched
     * rather than zeroed.
     */
    dsaGlobals?: number[];
}

/**
 * Build the party state out of `GAMEBLOCK2` and block 4.
 *
 * `LoadGame` assigns `d.HandChar` and `d.MagicCaster` **straight** from `GAMEBLOCK2`
 * rather than through `SetHandOwner`/`SelectMagicCaster` (`:1636-1637`), so this does
 * too — the setters would validate a champion and rewrite their facing, and a save is
 * restoring a state that was already valid.
 */
function buildPartyState(world: CsbwinWorld, dsaGlobalsUnused?: never): PartyState {
    void dsaGlobalsUnused;
    const block = world.save.characterBlock;
    const gb2 = world.save.block2;
    if (!block || !gb2) throw new Error('save has no character block or GAMEBLOCK2');

    const party = readCsbwinParty(block, gb2.numCharacter, world.save.objectIndex);
    const tail = readCsbwinPartyTail(block);

    // `d.objectInHand.NonExtendedInteger(b.gb2.ObjectInHand)` (`:1642`) — the cursor's
    // object is an indirect slot number like every other RN in the file. `RNempty` is 0;
    // the port keeps `RNnul` as its one empty value.
    const rawInHand = gb2.objectInHand & 0xffff;
    const objectInHand =
        rawInHand === 0 || rawInHand === 0xffff || rawInHand === 0xfffe
            ? OBJECT_ID_NULL
            : ((world.save.objectIndex ? world.save.objectIndex.resolve(rawInHand) : rawInHand) as ObjectID);

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
        moving: false,
        turning: false,
    };
}

/**
 * Turn the object a live timer is carrying from a slot number into a packed RN.
 *
 * `parseTimers` keeps `TIMER` bytes 6-9 as it finds them, because to every other timer
 * function they are plain numbers — a map square, an action code. For the six functions
 * `ConvertTimers` names they are an object reference, and in a save file that means a
 * slot in the object indirect index (`doc/PROVEN_FACTS.md` → "An RN in a save file is an
 * indirect index"). Nothing here consumed one until the engine started restoring a
 * timer's object at all, which is why this is only now a defect rather than a gap: a
 * missile restored with an unresolved slot number names whatever record our numbering
 * happens to put there, and the thrown sword lands somewhere else entirely.
 *
 * 48 and 49 keep it in bytes 6-7, 24, 25, 60 and 61 in bytes 8-9
 * (`doc/CSBwin-src/SaveGame.cpp:2027-2050`). Only a timer the queue names is live.
 */
function resolveTimerObjects(world: CsbwinWorld): TimerRecord[] | undefined {
    const timers = world.save.timers;
    if (!timers) return undefined;
    const index = world.save.objectIndex;
    if (!index) return timers;
    const live = new Set(world.save.timerQueue ?? []);
    return timers.map((timer, slot) => {
        if (!live.has(slot)) return timer;
        const fn = timer.function;
        if (fn === 48 || fn === 49) {
            const rn = index.resolve(timer.timerWord6 & 0xffff);
            return { ...timer, timerWord6: rn, uByte6: (rn >> 8) & 0xff, uByte7: rn & 0xff };
        }
        if (fn === 24 || fn === 25 || fn === 60 || fn === 61) {
            const rn = index.resolve(timer.timerWord8 & 0xffff);
            return { ...timer, timerWord8: rn, uByte8: (rn >> 8) & 0xff, uByte9: rn & 0xff };
        }
        return timer;
    });
}

/**
 * Everything a CSBWin save says, in the shape `Game.applyRuntimeSaveState` takes.
 *
 * Pure: no `Game` is touched, so a verification tool can build one and read it without
 * standing a game up.
 */
export function buildCsbwinRuntimeState(
    world: CsbwinWorld,
    options: CsbwinRuntimeOptions = {},
): RuntimeSaveState {
    const gb2 = world.save.block2;
    if (!gb2) throw new Error('save has no GAMEBLOCK2');
    const block = world.save.characterBlock;
    if (!block) throw new Error('save has no character block');
    const tail = readCsbwinPartyTail(block);

    return {
        version: RUNTIME_SAVE_VERSION,
        savedAt: Date.now(),
        party: buildPartyState(world),
        game: {
            // `d.Time = d.Long11732 = b.gb2.Time` (`:1622`) — the game clock, in ticks.
            tickCount: gb2.time,
            elapsedTimeMs: 0,
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
            dsaGlobals: options.dsaGlobals ?? [],
        },
        dungeon: {
            item16: world.save.item16,
            timers: resolveTimerObjects(world),
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

/** Parse a CSBWin save and restore it into the running game. Throws on a bad file. */
export function applyCsbwinSave(game: Game, bytes: Uint8Array): CsbwinWorld {
    const world = loadCsbwinWorld(bytes);
    const runtime = buildCsbwinRuntimeState(world, {
        // Keep what the running game has; see the module comment on `EXPOOL`.
        dsaGlobals: game.getDsaGlobalVariables(),
    });
    game.applyRuntimeSaveState(runtime);
    // The records restored by the snapshot are already big-actuator records. Set by hand
    // rather than through `applySaveGameState`, which would call `applyBigActuators` and
    // re-derive the word-8 of every type-47 actuator from records that already carry it.
    if (world.save.bigActuators) game.state.dungeon.bigActuators = true;
    return world;
}
