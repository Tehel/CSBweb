import type { ObjectID } from '../../core/types';
import type { GameContext } from '../GameContext';
import type { StkOp } from './DsaTypes';
import type { DsaFilters } from './DsaFilters';
import type { DsaBank, DsaOverride, ExecutionPacket, GearJump } from './DsaMachine';
import { characterOperations } from './ops/characters';
import { dungeonOperations } from './ops/dungeon';
import { messageOperations } from './ops/messages';
import { monsterOperations } from './ops/monsters';
import { moveOperations } from './ops/move';
import { objectOperations } from './ops/objects';
import { runOperations } from './ops/run';
import { stackOperations } from './ops/stack';

/**
 * What an `&` operation reaches beyond its run's bank and packet: CSBWin's globals, which
 * `EX_AMPERSAND` reads where it stands (`doc/CSBwin-src/DSA.cpp:2345-4983`).
 */
export interface DsaOperationMachine {
  readonly ctx: GameContext;
  /** The filter sites, whose viewing filter `&DESCRIBE` changes. */
  readonly filters: DsaFilters;
  readonly override: DsaOverride;
  /** `pDSAparameters`, the array of the moment, which `NEWDSAPARAMETERS` swaps: its count, then its words. */
  parameters(): Int32Array;
  /** `parameterMessageSequence++`. */
  nextParameterMessageSequence(): number;
  /** `disableSaves = …`, which `&DISABLESAVES` sets (`doc/CSBwin-src/data.cpp:58`). */
  setDisableSaves(disable: boolean): void;
  isValidObjectId(objectId: number): objectId is ObjectID;
  /** `adjustSkillsParameters`, which `&SETADJUSTSKILLSPARAMETERS!` sets and the adjust-skills filter reads. */
  adjustSkillsParameters(): Int32Array;
  /** `Execute`, a run nested in this one on the same bank: `&GOSUB*`'s. */
  execute(exPkt: ExecutionPacket, bank: DsaBank): number;
  /** `EX_AMPERSAND`, which `&%INDIRECT` runs again on the operation its record names. */
  executeAmpersand(subcode: number, bank: DsaBank, exPkt: ExecutionPacket): GearJump | void;
}

/** A case of `EX_AMPERSAND`'s switch: `JUMP*`'s transfer, or nothing. */
export type DsaOperation = (bank: DsaBank, exPkt: ExecutionPacket, machine: DsaOperationMachine) => GearJump | void;

/** The domains' tables in one, where an operation two domains give is a slip of the port's. */
function join(...domains: ReadonlyMap<StkOp, DsaOperation>[]): ReadonlyMap<StkOp, DsaOperation> {
  const table = new Map<StkOp, DsaOperation>();
  for (const domain of domains) {
    for (const [op, run] of domain) {
      if (table.has(op)) throw new Error(`DSA & operation ${op} given twice`);
      table.set(op, run);
    }
  }
  return table;
}

/** The `&` operations `executeAmpersand` dispatches to, by subcode. */
export const DSA_OPERATIONS = join(
  stackOperations, messageOperations, objectOperations, moveOperations, characterOperations, monsterOperations,
  dungeonOperations, runOperations,
);
