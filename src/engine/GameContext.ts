/**
 * `GameContext` — what every subsystem shares, CSBWin's global `d.`.
 *
 * `Game` creates it first and hands it to each subsystem as its first constructor
 * argument. Everything in it is created once and never replaced, so a subsystem may keep
 * a field of it; what changes is read through it at call time: `ctx.party.state` (which
 * `Party.setState` replaces) and `ctx.state.tickCount` (`d.Time`).
 *
 * `systems` holds the subsystems themselves, so that they call each other directly, as
 * CSBWin's functions do; `host` holds the calls that leave the engine (`GameHost`).
 */
import { globalTextKey, readOverlayPalette } from '../data/CsbwinExpool';
import { noExpectedSignatures, type ExpectedSignatures } from '../data/CsbwinExtendedFeatures';
import { noRuntimeFileSignatures, type RuntimeFileSignatures } from '../data/FileSignature';
import type { DungeonData } from '../data/dungeonTypes';
import { DBType, type ObjectID } from '../core/types';
import { sw } from '../core/intCast';
import { CsbRandom } from '../core/random';
import { CheckMonsters } from './CheckMonsters';
import { DungeonState, NO_GAME } from './DungeonState';
import type { Block1State, GameState } from './gameTypes';
import type { GameHost } from './GameHost';
import type { GameTables } from './GameTables';
import { NameIndex } from './objectIndex';
import { Party } from './Party';
import { PartyFootprints } from './PartyFootprints';
import { MouseQueue } from './MouseQueue';
import { createLoopFlags, type LoopFlags, type MainLoop } from './LoopState';
import { createInterfaceState, type InterfaceState } from './InterfaceState';
import { Overlay } from './Overlay';
import { identityOverlayPalette } from './OverlayPalette';
import { makeMoreRoomInDB } from './MakeMoreRoomInDB';
import { createSmartDiscardState, type SmartDiscardState } from './SmartDiscard';
import { SoundQueue } from './SoundQueue';
import { TimerQueue } from './TimerQueue';
import type { ThrownWeaponTags } from './ThrownWeapons';
import type { ActuatorSystem } from './ActuatorSystem';
import type { AttackSystem } from './AttackSystem';
import type { CharacterStats } from './CharacterStats';
import type { DsaSystem } from './DsaSystem';
import type { ChampionDamage } from './ChampionDamage';
import type { CharacterSystem } from './CharacterSystem';
import type { HallOfChampions } from './HallOfChampions';
import type { MagicSystem } from './MagicSystem';
import type { MissileEncounter } from './MissileEncounter';
import type { MonsterAI } from './MonsterAI';
import type { MonsterAttack } from './MonsterAttack';
import type { MonsterDamage } from './MonsterDamage';
import type { MonsterPerception } from './MonsterPerception';
import type { MonsterSystem } from './MonsterSystem';
import type { MouseSystem } from './MouseSystem';
import type { MovementSystem } from './MovementSystem';
import type { TimerSystem } from './TimerSystem';
import type { WorldMove } from './WorldMove';

/**
 * The subsystems, so that one calls another directly. `Game` fills it
 * as it constructs them. No constructor may call through it — only a method may, and
 * methods run after construction, so the construction order does not matter. A call
 * goes through the instance at call time, so a tool that replaces a method on an
 * instance still intercepts it.
 */
export interface GameSystems {
  actuators: ActuatorSystem;
  dsa: DsaSystem;
  timer: TimerSystem;
  worldMove: WorldMove;
  missileEncounter: MissileEncounter;
  monsters: MonsterSystem;
  monsterDamage: MonsterDamage;
  monsterPerception: MonsterPerception;
  monsterAttack: MonsterAttack;
  championDamage: ChampionDamage;
  monsterAI: MonsterAI;
  characterStats: CharacterStats;
  attack: AttackSystem;
  movement: MovementSystem;
  magic: MagicSystem;
  character: CharacterSystem;
  mouse: MouseSystem;
  hallOfChampions: HallOfChampions;
  /** The main loop itself (`Game`), for the scripts that hold it. */
  mainLoop: MainLoop;
}

/** The extras (`DEBT.md` X): a flag each, every one off by default. */
export interface Extras {
  /** What a champion's THROW or SHOOT sent off, gathered back (`gatherThrownWeapons`). */
  readonly gatherThrownWeapons: boolean;
  /** An empty hand drinking at a water fountain (`drinkAtWaterFountain`). */
  readonly drinkAtFountain: boolean;
  /** A mastery just gained drawn in colour 7 on the attribute panel (`MasteryGains.ts`). */
  readonly colourNewMastery: boolean;
  /** An item's figures under the eye's description (`getItemPropertyLines`). */
  readonly showItemProperties: boolean;
  /** A hundred keys waiting in the mouse queue, not seven (`LONG_MOUSEQLEN`). */
  readonly unlimitedKeyQueue: boolean;
}

/** Every extra off: the game is CSBWin's. */
export const NO_EXTRAS: Extras = {
  gatherThrownWeapons: false, drinkAtFountain: false, colourNewMastery: false, showItemProperties: false,
  unlimitedKeyQueue: false,
};

export interface GameContext {
  /** The level data: the dungeon half of `d.`. */
  readonly dungeon: DungeonState;
  /** The party; `party.state` is always the current one. */
  readonly party: Party;
  /** The game's own state: `state.tickCount` is `d.Time`. */
  readonly state: GameState;
  /**
   * `d.RandomNumber` (`doc/CSBwin-src/CSBCode.cpp:361`), the one game-visible random
   * stream. Everything with a game-visible outcome draws from it, in CSBWin's order, so a
   * seeded run is reproducible and an AI trace is comparable with CSBWin's. Rendering must
   * never draw from it: CSBWin keeps a separate `viewportRandom` precisely so drawing
   * "doesn't upset the game" (`doc/CSBwin-src/Viewport.cpp:6713`). Seeded from the host
   * on first draw; `Game.setRandomSeed` pins it for a tool.
   */
  readonly random: CsbRandom;
  /** `d.PartyFootprints` + `d.Byte13220` — the scent trail monsters follow. */
  readonly footprints: PartyFootprints;
  /** `GameTimers`. */
  readonly timers: TimerQueue;
  /** `pMouseQueue`, which `DiscardAllInput` empties from anywhere. */
  readonly mouseQueue: MouseQueue;
  /** `d.clockTick` and `d.newPartyLevel` as other files write them (`LoopFlags`). */
  readonly loop: LoopFlags;
  /** The interface's `d.` fields the engine reads too: the eye, the mouth, the open chest, the attack menu (`InterfaceState`). */
  readonly interface: InterfaceState;
  /** `QueueSound`. */
  readonly sounds: SoundQueue;
  /** `SmartDiscard.cpp`'s statics: where the discard cycle stands. */
  readonly smartDiscard: SmartDiscardState;
  /**
   * `d.LevelCleared[16]` (`doc/CSBwin-src/Data.h:956`), one per database: the level
   * `MakeMoreRoomInDB` last took an object from, where its next sweep starts. Zero at
   * every game read (`initializeGameContext`) and never saved.
   */
  readonly levelCleared: Uint8Array;
  /** `DM_rules` and `DMRulesDesignOption`, which outlive a game (`RulesOptions`). */
  readonly rules: RulesOptions;
  /**
   * The graphics signatures the last Extended Features block read named, which outlive a
   * game as `rules` do (`ExpectedSignatures`).
   */
  readonly signatures: ExpectedSignatures;
  /**
   * What the last world read named of the graphics files in its `EXPOOL`
   * (`RuntimeFileSignatures`, `src/engine/FileSignatures.ts`), which outlives a game too.
   */
  readonly runtimeFileSignatures: RuntimeFileSignatures;
  /**
   * The overlay palette (`src/engine/OverlayPalette.ts`), red, green and blue, as its
   * world's `EXPOOL` gives it at a read. A read restores it in place.
   */
  readonly overlayPalette: Uint8Array;
  /**
   * The viewport overlay and its jitter (`src/engine/Overlay.ts`), globals of CSBWin's
   * that outlive a game; a read takes what its Extended Features block says of them.
   */
  readonly overlay: Overlay;
  /** Every table from `graphics.dat`. */
  readonly tables: GameTables;
  /**
   * The extras (`DEBT.md` X), one flag each, as the player's settings leave them
   * (`src/settings/Settings.ts`): what CSBWin does not have. All off, the game is CSBWin's.
   */
  extras: Extras;
  /** What THROW and SHOOT sent off, for the extra that gathers it back (`ThrownWeapons`). */
  readonly thrownWeapons: ThrownWeaponTags;
  /** What only the host can do: play a sample, trace, tell the UI something. */
  readonly host: GameHost;
  /** The subsystems, built over the context by `createGameContext`'s `buildSystems`. */
  readonly systems: GameSystems;
}

/**
 * Eight of CSBWin's process-wide globals, not `d.`'s: `DM_rules` (`doc/CSBwin-src/data.cpp:252`),
 * `DMRulesDesignOption` (`CSBUI.cpp:148`), `invisibleMonsters` and `drawAsSize4Monsters`
 * (`data.cpp:78-79`), `simpleEncipher`, and CSBWin 20230608's three, all `false` at start.
 * Only `ReadExtendedFeatures` assigns the first four from a file (`SaveGame.cpp:394-402`), and
 * only for a file whose block is present, so a file without one (`dm-atari/dungeon.dat`,
 * CSB's Atari-era saves) leaves them as they were; the same for the last two of the three.
 * A new game and a load therefore keep them: `Game.readNewGame` and the save paths never
 * replace this object.
 */
export interface RulesOptions {
  /** `DM_rules`: reincarnation costs nothing (`CSBCode.cpp:6799`, `:6820`). */
  dmRules: boolean;
  /** `DMRulesDesignOption`: the dungeon asks for DM rules, forced on at the boot. */
  dmRulesDesignOption: boolean;
  /** `invisibleMonsters`: a creature's bit 11 hides it (`DB4::invisible()`, `CSB.h:1128`). */
  invisibleMonsters: boolean;
  /**
   * `drawAsSize4Monsters`: a creature's bits 12-14 count, drawn as one figure filling the cell,
   * unique, poisoned (`DB4::drawAsSize4()`, `Unique()`, `Poisoned()`, `CSB.h:1130-1135`).
   */
  drawAsSize4Monsters: boolean;
  /**
   * `simpleEncipher` (`data.cpp:244`): a file read was enciphered, so every save is
   * (`SaveGame.cpp:939-946`, `:968-971`). Set by an enciphered file, cleared by none.
   */
  simpleEncipher: boolean;
  /**
   * `SupressDSAWarningOption` (`doc/CSBwin-src/data.cpp:63`): the dungeon stops
   * "Excessive DSA operations" (`DSA.cpp:5472`), a warning the port does not give. Kept to
   * be written back. Unlike the rest, every file read clears it (`SaveGame.cpp:312`).
   */
  supressDSAWarningOption: boolean;
  /**
   * `bGravityGame` (`doc/CSBwin-src/data.cpp:241`): the party falls along the axes
   * it last moved on (`CSBCode.cpp:8166`, `MovementSystem.gravityMove`). Read from the
   * dungeon.
   */
  bGravityGame: boolean;
  /**
   * `bThreeDMovements` (`doc/CSBwin-src/data.cpp:240`): the keys that move the party
   * up and down a level (`CSBCode.cpp:8575`, `translateKey`). Read from the dungeon.
   */
  bThreeDMovements: boolean;
}

/**
 * A new game's timer table, as `ReadDatabases` sizes it (`doc/CSBwin-src/SaveGame.cpp:2761`,
 * `:2768-2776`, `:2824-2828`): 100 slots, and one more per record of the monster
 * database and of each database from the missiles on, a record count being the file's
 * and `d.Byte7302`'s extra ones together (`DungeonState.addNewGameSpares`). The read
 * then takes `deleteDuplicateTimers` from the world's `EXPOOL` (`:1965-1975`,
 * `Game.installWorld`).
 */
function newGameTimerQueue(dungeonData: DungeonData): TimerQueue {
  const timers = new TimerQueue();
  timers.allocate(100);
  for (let db = 0; db < 16; db++) {
    if (db !== DBType.CREATURE && db < DBType.MISSILE) continue;
    timers.allocate(sw(timers.getMaxTimers() + (dungeonData.header.objectCounts[db] ?? 0)));
  }
  return timers;
}

/**
 * `d.RandomGameID` as a new game draws it: the product of the low words of two draws
 * (`doc/CSBwin-src/SaveGame.cpp:1638-1647`).
 *
 * CSBWin keeps a product of 0, which either word being 0 gives, about one game in
 * 32768. The port draws again: an id is never 0, the value a file of an earlier build
 * holds for no playthrough at all (`DEBT.md` H).
 */
export function drawRandomGameID(random: CsbRandom): number {
    for (;;) {
        const d0 = random.next() & 0xffff;
        const d1 = random.next() & 0xffff;
        const id = (d0 * d1) >>> 0;
        if (id !== 0) return id;
    }
}

/**
 * `_ReadEntireGame`'s `d.` for a new game: the four words it sets first
 * (`doc/CSBwin-src/SaveGame.cpp:1568-1571`), `Word22592` then taken from a compressed
 * `dungeon.dat` and staying 13 for a plain one (`:2562-2570`, `DungeonData.word22592`),
 * and `d.RandomGameID` (`drawRandomGameID`).
 *
 * The empty world (`emptyDungeonData`) is what `d.Initialize()` leaves before any read,
 * and `d.Initialize()` draws nothing: it only seeds `d.RandomNumber`
 * (`doc/CSBwin-src/CSBCode.cpp:360-361`). Its `RandomGameID` is 0, and the stream is left
 * for the read.
 */
function newGameBlock1(random: CsbRandom, dungeonData: DungeonData): Block1State {
    return {
        randomGameID: dungeonData.header.numMaps > 0 ? drawRandomGameID(random) : 0,
        word22592: dungeonData.word22592 ?? 13,
        word22594: 1,
        word22596: 2,
        word22598: 1,
        byte22808: new Array<number>(132).fill(0),
        totalMoveCount: 0,
    };
}

/** A new game before any system runs (`newGameState`). */
export interface NewGameState {
  /** The party at the dungeon's start, with no champion. */
  party: Party;
  /** `GAMEBLOCK1`, its `RandomGameID` drawn (`newGameBlock1`). */
  block1: Block1State;
  /** The timer table as sized, and empty (`newGameTimerQueue`). */
  timers: TimerQueue;
  /** The world's overlay palette, or the one `d.Initialize()` clears. */
  overlayPalette: Uint8Array;
}

/**
 * What `_ReadEntireGame` makes of `dungeon.dat` before any system runs: `dungeonData`
 * takes `d.Byte7302`'s spare records (`DungeonState.addNewGameSpares`) and
 * `CheckMonsters` (doc/CSBwin-src/SaveGame.cpp:2029), in place, and the party, `block1`,
 * the timers and the overlay palette are a new game's. `RandomGameID` is drawn from
 * `random`. `createGameContext` builds a context from it, and `Game.readNewGame` the
 * state its read restores.
 */
export function newGameState(
  dungeonData: DungeonData,
  tables: GameTables,
  random: CsbRandom,
  trace: (line: string) => void,
): NewGameState {
  const dungeon = new DungeonState(dungeonData, NO_GAME);
  dungeon.addNewGameSpares(tables.byte7302);
  CheckMonsters(dungeon, tables.monsterDesc, trace);
  return {
    party: new Party(dungeon.getStartPosition(), dungeon.getStartFacing()),
    block1: newGameBlock1(random, dungeonData),
    timers: newGameTimerQueue(dungeonData),
    overlayPalette: readOverlayPalette(dungeonData) ?? identityOverlayPalette(),
  };
}

/**
 * The context for a new game over `dungeonData` (`newGameState`): the party at the
 * dungeon's start, the clock at 0, an empty timer queue, and `host`. Its dungeon and its
 * sound queue ask the game what they need through it (`DungeonHooks`, `SoundFilter`),
 * and `buildSystems` builds the systems over it, the last thing before it is returned:
 * no system reads another while it is built.
 */
export function createGameContext(
  dungeonData: DungeonData,
  tables: GameTables,
  host: GameHost,
  buildSystems: (ctx: GameContext) => GameSystems,
): GameContext {
  const random = new CsbRandom();
  const { party, block1, timers, overlayPalette } =
    newGameState(dungeonData, tables, random, (line) => host.trace(line));
  const dungeon = new DungeonState(dungeonData, {
    makeMoreRoomInDB: (db) => makeMoreRoomInDB(ctx, db),
    textSubstitution: {
      handChar: () => ctx.party.state.cursorOwner,
      characterName: (index) => ctx.party.state.champions[index]?.name ?? null,
      globalText: (index) => ctx.dungeon.locateExpoolRecord(globalTextKey(index)),
      globalVariable: (index) => ctx.systems.dsa.getGlobalVariable(index),
    },
    timerWord8: (index) => ctx.timers.getTimerWord8(index),
  });
  const state: GameState = {
    paused: false,
    tickCount: 0,
    gameWon: false,
    word1868: false,
    currentPalette: 0,
    block1,
  };
  const ctx: GameContext = {
    dungeon,
    party,
    state,
    random,
    footprints: new PartyFootprints(),
    timers,
    mouseQueue: new MouseQueue(),
    loop: createLoopFlags(),
    interface: createInterfaceState(),
    sounds: new SoundQueue(party, tables.sound1772, host, state, timers,
      (ordinal, highVolume, level, x, y) => ctx.systems.dsa.filters.soundFilter(ordinal, highVolume, level, x, y)),
    smartDiscard: createSmartDiscardState(),
    levelCleared: new Uint8Array(16),
    rules: {
      dmRules: false, dmRulesDesignOption: false,
      invisibleMonsters: false, drawAsSize4Monsters: false, simpleEncipher: false,
      supressDSAWarningOption: false, bGravityGame: false, bThreeDMovements: false,
    },
    signatures: noExpectedSignatures(),
    runtimeFileSignatures: noRuntimeFileSignatures(),
    overlayPalette,
    overlay: new Overlay(overlayPalette, (line) => host.trace(line)),
    tables,
    extras: NO_EXTRAS,
    thrownWeapons: new Map(),
    host,
    systems: null as unknown as GameSystems,
  };
  (ctx as { systems: GameSystems }).systems = buildSystems(ctx);
  return ctx;
}

/**
 * `d.Initialize()`'s share of the context. Its `memset` zeroes the whole of `d`
 * (`DBank::Initialize`, `doc/CSBwin-src/CSBCode.cpp:333-339`) before the restart's read
 * (`Code1f9e6.cpp:309`), as the program's start leaves it before the boot's, so every
 * game read (`readGame`) begins with these as a new context has them. The rest of the
 * context's `d.` the read sets itself (`installRuntimeState`), and the restart resets the
 * loop's (`Game.resumeMainLoop`).
 */
export function initializeGameContext(ctx: GameContext): void {
  ctx.levelCleared.fill(0);
  ctx.state.word1868 = false;
  ctx.state.currentPalette = 0;
  Object.assign(ctx.interface, createInterfaceState());
}

/** `RN::NameIndex()` (`engine/objectIndex`), with the party's facing for a lit torch. */
export function nameIndexOf(ctx: GameContext, rn: ObjectID): number {
  return NameIndex(ctx.dungeon, ctx.tables, ctx.party.state.facing, rn);
}
