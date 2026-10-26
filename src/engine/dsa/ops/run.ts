import { locationRelFromInteger } from '../../../core/types';
import { Esl, messageParametersKey, specialLocationKey } from '../../../data/CsbwinExpool';
import { TimerFunction } from '../../TimerQueue';
import { DsaVarType, StkOp } from '../DsaTypes';
import type { DsaBank } from '../DsaMachine';
import type { DsaOperation, DsaOperationMachine } from '../DsaOperations';

/**
 * `EX_AMPERSAND`'s unpacking of `I_Indirect` (`doc/CSBwin-src/DSA.cpp:2351-2370`): the
 * operation a parameter record's first word names, and the one it runs. `I_FilteredCast`
 * is here though no operation packs it: it has no case of its own in `EX_AMPERSAND`.
 */
const INDIRECT_OPERATIONS: ReadonlyMap<number, StkOp> = new Map([
  [StkOp.I_DEL, StkOp.DEL],
  [StkOp.I_DEL_MON, StkOp.DEL_MON],
  [StkOp.I_INS_MON, StkOp.INS_MON],
  [StkOp.I_ADD, StkOp.ADD],
  [StkOp.I_CREATE_CLOUD, StkOp.CREATE_CLOUD],
  [StkOp.I_CAST, StkOp.CAST],
  [StkOp.I_FILTERED_CAST, StkOp.FILTERED_CAST],
  [StkOp.I_TELEPORT_PARTY, StkOp.TELEPORT_PARTY],
  [StkOp.I_MONSTER_STORE, StkOp.MONSTER_STORE],
  [StkOp.I_CHAR_STORE, StkOp.CHAR_STORE],
  [StkOp.I_CAUSE_POISON, StkOp.CAUSE_POISON],
  [StkOp.I_MOVE, StkOp.MOVE],
  [StkOp.I_COPY, StkOp.COPY],
  [StkOp.I_CELL_STORE, StkOp.CELL_STORE],
  [StkOp.I_THROW, StkOp.THROW],
  [StkOp.I_SWAP_CHARACTER, StkOp.SWAP_CHARACTER],
]);

/**
 * `Indirect` (`doc/CSBwin-src/DSA.cpp:2094-2193`): an `I_` operation's operands in a
 * parameter record, `[type, numVar, the numVar popped, array, its variables, numParam,
 * the first numParam DSA parameters]`, which a `TT_ParameterMessage` timer takes to the
 * DSA at `ESL_INDIRECTACTIONS`, corner 0, message type 0, due now or `&%DELAY` ticks on.
 * That DSA's `&%INDIRECT` unpacks and runs it. In a dungeon with no such location it does
 * nothing, not even pop. An array of `array` is the variables from the second word
 * popped on, as many as the first, and none past 20; a record of more than 29 words is
 * sent nowhere, once its operands are popped.
 *
 * CSBWin looks the location up at the first call of the process and keeps what it found
 * (`indirectLocChecked`, a function `static`); the port looks it up in the world each
 * time, which differs only after a load of another dungeon.
 */
function indirect(
  machine: DsaOperationMachine,
  bank: DsaBank,
  type: number,
  array: boolean,
  numVar: number,
  numParam: number,
): void {
  const { ctx } = machine;
  const location = ctx.dungeon.getSpecialLocation(specialLocationKey(Esl.INDIRECT_ACTIONS));
  if (location === null) return;
  const indirectLocr = locationRelFromInteger(location);
  const record = [type, numVar];
  for (let i = 0; i < numVar; i++) record.push(bank.stack.pop());
  record.push(array ? 1 : 0);
  if (array) {
    const n = record[2]! >>> 0;
    if (n > 20) return;
    for (let j = 0; j < n; j++) record.push(bank.getVar((record[3]! + j) | 0));
  }
  record.push(numParam);
  const parameters = machine.parameters();
  for (let i = 0; i < numParam; i++) record.push(parameters[1 + i] ?? 0);
  if (record.length > 29) return;
  let actionTime = ctx.state.tickCount;
  if (bank.indirectActionDelay > 0) {
    actionTime += bank.indirectActionDelay;
    bank.indirectActionDelay = -1;
  }
  const timer = ctx.timers.createTimerWithUByte5(
    TimerFunction.TT_PARAMETER_MESSAGE, indirectLocr.x, indirectLocr.y, 0, 0, actionTime, indirectLocr.l,
    machine.nextParameterMessageSequence(),
  );
  ctx.dungeon.writeExpoolRecord(messageParametersKey(timer.index), record);
}

/** An `I_` operation: its operands, sent to the DSA at `ESL_INDIRECTACTIONS` (`indirect`). */
function indirectOperation(type: StkOp, array: boolean, numVar: number, numParam: number): [StkOp, DsaOperation] {
  return [type, (bank, _exPkt, machine) => indirect(machine, bank, type, array, numVar, numParam)];
}

/**
 * The run's own: its new state, its parameters, the gear jumps and gosub, its DSA's id
 * and the indirect operations (`EX_AMPERSAND`'s cases, `doc/CSBwin-src/DSA.cpp:2346-2392`
 * for `&%INDIRECT` and `:4958-4979` for the `I_` operations), in the order the port's
 * switch had them.
 */
export const runOperations: ReadonlyMap<StkOp, DsaOperation> = new Map<StkOp, DsaOperation>([
  [StkOp.SET_NEW_STATE, (bank) => {
    bank.forceState = bank.stack.pop();
  }],
  [StkOp.PARAM_FETCH, (bank, _exPkt, machine) => {
    // `i`, `n` and `j` are `ui32` (`doc/CSBwin-src/DSA.cpp:2957-2986`), so the count is
    // compared unsigned: a count of -1, a parameter message whose record is gone, is
    // never short, and the words are copied as they stand.
    const parameters = machine.parameters();
    const index = bank.stack.pop() >>> 0;
    let n = bank.stack.pop() >>> 0;
    if (n > 100) {
      machine.ctx.host.trace('DSA &PARAM@ too many parameters');
      return;
    }
    const paramCount = (parameters[0] ?? 0) >>> 0;
    if (n > paramCount) {
      machine.ctx.host.trace('DSA &PARAM@ non-existent parameter');
      for (let j = paramCount; j < n; j++) {
        // `pdsaDbank->Var(j)` (`doc/CSBwin-src/DSA.cpp:2978`): a read of the
        // parameter's number, where the variable marked is `index + j`.
        bank.getVar(j);
        bank.setVarState(index + j, DsaVarType.NonParameter);
      }
      n = paramCount;
    }
    for (let j = 0; j < n; j++) {
      bank.setVar(index + j, parameters[1 + j] ?? 0);
    }
  }],
  [StkOp.PARAM_STORE, (bank, _exPkt, machine) => {
    // `doc/CSBwin-src/DSA.cpp:3001-3021`, signed.
    const parameters = machine.parameters();
    const index = bank.stack.pop();
    const n = bank.stack.pop();
    if (n > 100) {
      machine.ctx.host.trace('DSA &PARAM! too many parameters');
      return;
    }
    for (let j = 0; j < n; j++) {
      if (bank.getVarState(index + j) !== DsaVarType.NonParameter) {
        parameters[1 + j] = bank.getVar(index + j);
      }
    }
  }],
  [StkOp.SET_ADJUST_SKILLS_PARAMETERS, (bank, _exPkt, machine) => {
    const adjustSkillsParameters = machine.adjustSkillsParameters();
    adjustSkillsParameters[4] = bank.stack.pop();
    adjustSkillsParameters[3] = bank.stack.pop();
    adjustSkillsParameters[2] = bank.stack.pop();
    adjustSkillsParameters[1] = bank.stack.pop();
    adjustSkillsParameters[0] = bank.stack.pop();
  }],
  [StkOp.NUM_PARAM, (bank, _exPkt, machine) => {
    bank.stack.push(machine.parameters()[0] ?? 0);
  }],
  [StkOp.JUMP_GEAR, (bank) => {
    // `doc/CSBwin-src/DSA.cpp:4738-4746`: the state, then the column, from the stack.
    const state = bank.stack.pop();
    const col = bank.stack.pop();
    return { state, col };
  }],
  [StkOp.GOSUB_GEAR, (bank, exPkt, machine) => {
    // `doc/CSBwin-src/DSA.cpp:4747-4768`: `EX_GOSUB`'s call, the master's program.
    const state = bank.stack.pop();
    const msg = bank.stack.pop();
    machine.execute({
      ...exPkt,
      curState: state,
      column: msg,
      subroutineLevel: exPkt.subroutineLevel + 1,
      slave: exPkt.master,
    }, bank);
  }],
  [StkOp.THIS_DSA_ID, (bank, exPkt) => {
    // `doc/CSBwin-src/DSA.cpp:4823-4829`: the slave's RN, `ConvertToInteger`.
    bank.stack.push(exPkt.rnSlave);
  }],
  [StkOp.I_INDIRECT, (bank, exPkt, machine) => {
    // `doc/CSBwin-src/DSA.cpp:2346-2392`: the parameter record `indirect` packed, back
    // on the stack, in the variables and in the parameters, and its operation run. A
    // record that names none does nothing. A count past the array reads outside
    // CSBWin's, where the port reads 0 and stops at 100.
    const p = machine.parameters();
    const operation = INDIRECT_OPERATIONS.get(p[1] ?? 0);
    if (operation === undefined) return;
    const word = (k: number): number => p[1 + k] ?? 0;
    let r = 1;
    let n = Math.min(word(r++) >>> 0, 100);
    r += n;
    for (let i = 0; i < n; i++) bank.stack.push(word(--r));
    r += n;
    if (word(r++) !== 0) {
      n = Math.min(word(2) >>> 0, 100);
      let indx = word(3);
      for (let i = 0; i < n; i++) bank.setVar(indx++, word(r++));
    }
    n = Math.min(word(r++) >>> 0, 100);
    for (let i = 0; i < n; i++) p[1 + i] = word(r++);
    return machine.executeAmpersand(operation, bank, exPkt);
  }],
  indirectOperation(StkOp.I_DEL, false, 2, 0),
  indirectOperation(StkOp.I_DEL_MON, false, 2, 0),
  indirectOperation(StkOp.I_INS_MON, false, 2, 0),
  indirectOperation(StkOp.I_ADD, false, 3, 0),
  indirectOperation(StkOp.I_CREATE_CLOUD, false, 3, 0),
  indirectOperation(StkOp.I_CAST, false, 0, 13),
  indirectOperation(StkOp.I_TELEPORT_PARTY, false, 1, 0),
  indirectOperation(StkOp.I_MONSTER_STORE, true, 3, 0),
  indirectOperation(StkOp.I_CHAR_STORE, true, 3, 0),
  indirectOperation(StkOp.I_CAUSE_POISON, false, 2, 0),
  indirectOperation(StkOp.I_MOVE, false, 10, 0),
  indirectOperation(StkOp.I_COPY, false, 2, 0),
  indirectOperation(StkOp.I_CELL_STORE, true, 3, 0),
  indirectOperation(StkOp.I_THROW, false, 7, 0),
  indirectOperation(StkOp.I_SWAP_CHARACTER, false, 2, 0),
  [StkOp.I_DELAY, (bank) => {
    // `DSA.cpp:4973-4979`: the delay of the next `indirect`, this run only.
    bank.indirectActionDelay = bank.stack.pop();
  }],
]);
