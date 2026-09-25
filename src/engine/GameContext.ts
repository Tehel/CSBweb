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
import type { ObjectID } from '../core/types';
import { CsbRandom } from '../core/random';
import { DungeonState } from './DungeonState';
import type { GameState } from './gameTypes';
import { createGameHost, type GameHost } from './GameHost';
import type { GameTables } from './GameTables';
import { NameIndex } from './objectIndex';
import { Party } from './Party';
import { PartyFootprints } from './PartyFootprints';
import { SoundQueue } from './SoundQueue';
import { TimerQueue } from './TimerQueue';
import type { ActuatorSystem } from './ActuatorSystem';
import type { AttackSystem } from './AttackSystem';
import type { CharacterStats } from './CharacterStats';
import type { DsaSystem } from './DsaSystem';
import type { CharacterSystem } from './CharacterSystem';
import type { Game } from './Game';
import type { MagicSystem } from './MagicSystem';
import type { MonsterAI } from './MonsterAI';
import type { MonsterAttack } from './MonsterAttack';
import type { MonsterDamage } from './MonsterDamage';
import type { MonsterPerception } from './MonsterPerception';
import type { MonsterSystem } from './MonsterSystem';
import type { MovementSystem } from './MovementSystem';
import type { TimerSystem } from './TimerSystem';

/**
 * The `Game` methods a subsystem still calls, reached through `ctx.systems.game`. They
 * have no system of their own until `DEBT.md` E2 splits `Game.ts`: each group E2 moves
 * out leaves this list, and its callers then name the new system. E2 is done when this
 * type is gone.
 */
export type GameMethods = Pick<Game,
  | 'addCharacter'
  | 'applyMissileDamageToParty'
  | 'climbDownIntoPit'
  | 'enableCharacterAction'
  | 'handleDsaTeleportParty'
  | 'notePartyMoved'
  | 'onChampionDied'
  | 'registerChampionBones'
  | 'setBusyTimerRefill'
  | 'throwFromWeaponHand'
  | 'wakeUp'
>;

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
  game: GameMethods;
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
  /** `QueueSound`. */
  readonly sounds: SoundQueue;
  /** Every table from `graphics.dat`. */
  readonly tables: GameTables;
  /** What only the host can do: play a sample, trace, tell the UI something. */
  readonly host: GameHost;
  /** The subsystems, filled by `Game` as it builds them. */
  readonly systems: GameSystems;
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
    currentPalette: 0,
  };
  return {
    dungeon,
    party,
    state,
    random: new CsbRandom(),
    footprints: new PartyFootprints(),
    timers: new TimerQueue(),
    sounds: new SoundQueue(party, tables.sound1772, host),
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
