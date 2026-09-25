/**
 * `GameContext` — what every subsystem shares, CSBWin's global `d.` (`DEBT.md` E1).
 *
 * `Game` creates it first and hands it to each subsystem as its first constructor
 * argument. Everything in it is created once and never replaced, so a subsystem may keep
 * a field of it; what changes is read through it at call time: `ctx.party.state` (which
 * `Party.setState` replaces) and `ctx.state.tickCount` (`d.Time`).
 *
 * E1c adds `systems`, the subsystems themselves, and E1d `host`, the calls that leave the
 * engine (see the design note in `DEBT.md` E1).
 */
import type { DungeonData } from '../data/dungeonTypes';
import type { ObjectID } from '../core/types';
import { CsbRandom } from '../core/random';
import { DungeonState } from './DungeonState';
import type { GameState } from './gameTypes';
import type { GameTables } from './GameTables';
import { NameIndex } from './objectIndex';
import { Party } from './Party';
import { PartyFootprints } from './PartyFootprints';
import { SoundQueue } from './SoundQueue';
import { TimerQueue } from './TimerQueue';

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
}

/**
 * The context for a new game over `dungeonData`: the party at the dungeon's start, the
 * clock at 0, an empty timer queue. `playSound` is where `QueueSound` sends a sample.
 */
export function createGameContext(
  dungeonData: DungeonData,
  tables: GameTables,
  playSound?: (soundId: number, rateIdx?: number, distance?: number) => void,
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
    sounds: new SoundQueue(party, tables.sound1772, playSound),
    tables,
  };
}

/** `RN::NameIndex()` (`engine/objectIndex`), with the party's facing for a lit torch. */
export function nameIndexOf(ctx: GameContext, rn: ObjectID): number {
  return NameIndex(ctx.dungeon, ctx.tables, ctx.party.state.facing, rn);
}
