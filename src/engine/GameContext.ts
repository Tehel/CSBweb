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
import type { GameState } from './gameTypes';
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
  /** The object `Game.state` is: `state.tickCount` is `d.Time`. */
  readonly state: GameState;
  /** `d.RandomNumber`, the one game-visible random stream. */
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
  /** Every table from `graphics.dat`. */
  readonly tables: GameTables;
  /** What only the host can do: play a sample, trace, tell the UI something. */
  readonly host: GameHost;
  /** The subsystems, filled by `Game` as it builds them. */
  readonly systems: GameSystems;
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
  const state: GameState = {
    dungeon: dungeonData,
    running: false,
    paused: false,
    startTime: Date.now(),
    currentTime: Date.now(),
    tickCount: 0,
    gameWon: false,
    word1868: false,
    currentPalette: 0,
  };
  const timers = newGameTimerQueue(dungeonData, tables);
  return {
    dungeon,
    party,
    state,
    random: new CsbRandom(),
    footprints: new PartyFootprints(),
    timers,
    mouseQueue: new MouseQueue(),
    loop: createLoopFlags(),
    sounds: new SoundQueue(party, tables.sound1772, host, state, timers),
    smartDiscard: createSmartDiscardState(),
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
