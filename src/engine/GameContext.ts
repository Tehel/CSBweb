/**
 * `GameContext` — what every subsystem shares, CSBWin's global `d.` (`DEBT.md` E1).
 *
 * `Game` creates it first and hands it to each subsystem as its first constructor
 * argument. Everything in it is created once and never replaced, so a subsystem may keep
 * a field of it; what changes is read through it at call time: `ctx.party.state` (which
 * `Party.setState` replaces) and `ctx.state.tickCount` (`d.Time`).
 *
 * `systems` holds the subsystems themselves, so that they call each other directly, as
 * CSBWin's functions do; `host` holds the calls that leave the engine (`GameHost`).
 */
import type { DungeonData } from '../data/dungeonTypes';
import { DBType, type ObjectID } from '../core/types';
import { sw } from '../core/intCast';
import { CsbRandom } from '../core/random';
import { DungeonState } from './DungeonState';
import type { Block1State, GameState } from './gameTypes';
import { createGameHost, type GameHost } from './GameHost';
import type { GameTables } from './GameTables';
import { NameIndex } from './objectIndex';
import { Party } from './Party';
import { PartyFootprints } from './PartyFootprints';
import { MouseQueue } from './MouseQueue';
import { createLoopFlags, type LoopFlags, type MainLoop } from './LoopState';
import { createSmartDiscardState, type SmartDiscardState } from './SmartDiscard';
import { SoundQueue } from './SoundQueue';
import { TimerQueue } from './TimerQueue';
import type { ActuatorSystem } from './ActuatorSystem';
import type { AttackSystem } from './AttackSystem';
import type { CharacterStats } from './CharacterStats';
import type { DsaSystem } from './DsaSystem';
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
 * The subsystems, so that one calls another directly (`DEBT.md` E1c). `Game` fills it
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

export interface GameContext {
  /** The level data: the dungeon half of `d.`. */
  readonly dungeon: DungeonState;
  /** The party; `party.state` is always the current one. */
  readonly party: Party;
  /** The game's own state: `state.tickCount` is `d.Time`. */
  readonly state: GameState;
  /**
   * `d.RandomNumber` (`doc/CSBwin-src/CSBCode.cpp:351`), the one game-visible random
   * stream. Everything with a game-visible outcome draws from it, in CSBWin's order, so a
   * seeded run is reproducible and an AI trace is comparable with CSBWin's. Rendering must
   * never draw from it: CSBWin keeps a separate `viewportRandom` precisely so drawing
   * "doesn't upset the game" (`doc/CSBwin-src/Viewport.cpp:6706`). Seeded from the host
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
  /** `QueueSound`. */
  readonly sounds: SoundQueue;
  /** `SmartDiscard.cpp`'s statics: where the discard cycle stands. */
  readonly smartDiscard: SmartDiscardState;
  /**
   * `d.LevelCleared[16]` (`doc/CSBwin-src/Data.h:941`), one per database: the level
   * `MakeMoreRoomInDB` last took an object from, where its next sweep starts. Zero at
   * the start and never saved.
   */
  readonly levelCleared: Uint8Array;
  /** `DM_rules` and `DMRulesDesignOption`, which outlive a game (`RulesOptions`). */
  readonly rules: RulesOptions;
  /** Every table from `graphics.dat`. */
  readonly tables: GameTables;
  /** What only the host can do: play a sample, trace, tell the UI something. */
  readonly host: GameHost;
  /** The subsystems, filled by `Game` as it builds them. */
  readonly systems: GameSystems;
}

/**
 * Two of CSBWin's process-wide globals, not `d.`'s: `DM_rules` (`doc/CSBwin-src/data.cpp:251`)
 * and `DMRulesDesignOption` (`CSBUI.cpp:137`), both `false` at start. Only
 * `ReadExtendedFeatures` assigns them from a file (`SaveGame.cpp:392-398`), and only for a
 * file whose block is present, so a file without one (`dm-atari/dungeon.dat`, CSB's
 * Atari-era saves) leaves both as they were. A new game and a load therefore keep them:
 * `Game.readNewGame` and the save paths never replace this object.
 */
export interface RulesOptions {
  /** `DM_rules`: reincarnation costs nothing (`CSBCode.cpp:6740`, `:6761`). */
  dmRules: boolean;
  /** `DMRulesDesignOption`: the dungeon asks for DM rules, forced on at the boot. */
  dmRulesDesignOption: boolean;
}

/**
 * A new game's timer table, as `ReadDatabases` sizes it (`doc/CSBwin-src/SaveGame.cpp:2549`,
 * `:2556-2564`, `:2612-2616`): 100 slots, and one more per record of the monster
 * database and of each database from the missiles on, a record count being the file's
 * and `d.Byte7302`'s extra ones together.
 */
function newGameTimerQueue(dungeonData: DungeonData, tables: GameTables): TimerQueue {
  const timers = new TimerQueue();
  timers.allocate(100);
  for (let db = 0; db < 16; db++) {
    if (db !== DBType.CREATURE && db < DBType.MISSILE) continue;
    const dbSize = sw((dungeonData.header.objectCounts[db] ?? 0) + (tables.byte7302[db] ?? 0));
    timers.allocate(sw(timers.getMaxTimers() + dbSize));
  }
  return timers;
}

/**
 * `d.RandomGameID` as a new game draws it: the product of the low words of two draws
 * (`doc/CSBwin-src/SaveGame.cpp:1523-1532`).
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
 * (`doc/CSBwin-src/SaveGame.cpp:1467-1470`), `Word22592` then taken from a compressed
 * `dungeon.dat` and staying 13 for a plain one (`:2350-2358`, `DungeonData.word22592`),
 * and `d.RandomGameID` (`drawRandomGameID`).
 *
 * The empty world (`emptyDungeonData`) is what `d.Initialize()` leaves before any read,
 * and `d.Initialize()` draws nothing: it only seeds `d.RandomNumber`
 * (`doc/CSBwin-src/CSBCode.cpp:350-351`). Its `RandomGameID` is 0, and the stream is left
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

/**
 * The context for a new game over `dungeonData`: the party at the dungeon's start, the
 * clock at 0, an empty timer queue, and `host` (a null host by default).
 */
export function createGameContext(
  dungeonData: DungeonData,
  tables: GameTables,
  host: GameHost = createGameHost(),
): GameContext {
  const dungeon = new DungeonState(dungeonData);
  const party = new Party(dungeon.getStartPosition(), dungeon.getStartFacing());
  const random = new CsbRandom();
  const state: GameState = {
    dungeon: dungeonData,
    paused: false,
    tickCount: 0,
    gameWon: false,
    word1868: false,
    currentPalette: 0,
    block1: newGameBlock1(random, dungeonData),
  };
  const timers = newGameTimerQueue(dungeonData, tables);
  return {
    dungeon,
    party,
    state,
    random,
    footprints: new PartyFootprints(),
    timers,
    mouseQueue: new MouseQueue(),
    loop: createLoopFlags(),
    sounds: new SoundQueue(party, tables.sound1772, host, state, timers),
    smartDiscard: createSmartDiscardState(),
    levelCleared: new Uint8Array(16),
    rules: { dmRules: false, dmRulesDesignOption: false },
    tables,
    host,
    // Empty until `Game` fills it; a tool that stands one subsystem up fills what it needs.
    systems: {} as GameSystems,
  };
}

/** `RN::NameIndex()` (`engine/objectIndex`), with the party's facing for a lit torch. */
export function nameIndexOf(ctx: GameContext, rn: ObjectID): number {
  return NameIndex(ctx.dungeon, ctx.tables, ctx.party.state.facing, rn);
}
