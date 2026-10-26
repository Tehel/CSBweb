import {
  DBType,
  OBJECT_ID_EOF,
  type ObjectID,
  type LocationRel,
  locationRelFromInteger,
  locationRelToInteger,
  Position,
  RoomType,
  rnEquals,
  getRoomType,
} from '../core/types';
import { die } from './Die';
import type { ActuatorRecord, DsaDefinition, DsaState } from '../data/dungeonTypes';
import {
  getActuatorDsaSelector,
  getActuatorDsaState,
  getActuatorParameterA,
  getActuatorParameterB,
  getActuatorType,
  setActuatorDsaState,
  setActuatorParameterA,
  setActuatorParameterB,
} from '../data/actuatorHelpers';
import type { DungeonState } from './DungeonState';
import type { GameContext } from './GameContext';
import { TimerFunction } from './TimerQueue';
import type { TimerEntry, TimerQueue } from './TimerQueue';
import { Esl, messageParametersKey, readGlobalVariables, specialLocationKey } from '../data/CsbwinExpool';
import { DsaBank, DsaOverride, ProgramCursor, type ExecutionPacket, type GearJump } from './dsa/DsaMachine';
import { DSA_OPERATIONS, type DsaOperationMachine } from './dsa/DsaOperations';
import { findFirstTeleporter, updateCellFlag } from './dsa/ops/dungeon';
import { globalText } from './dsa/ops/messages';
import { DsaFilters } from './dsa/DsaFilters';
import { DsaVars, DsaVarType, StkOp } from './dsa/DsaTypes';

enum DsaCommand {
  MESSAGE = 1,
  OVERRIDE = 2,
  NOOP = 3,
  COPYTELEPORTER = 4,
  GOSUB = 5,
  LOAD = 6,
  FETCH = 7,
  EQUAL = 8,
  QUESTION = 9,
  AMPERSAND = 11,
  JUMP = 12,
  STORE = 13,
  COPYTELEPORTER32 = 14,
  MESSAGE32 = 15,
  CASE = 16,
  VARIABLEFETCH = 17,
  VARIABLESTORE = 18,
  GLOBALFETCH = 19,
  GLOBALSTORE = 20,
  AMPERSAND2 = 21,
  DESSAGE32 = 22,
}

enum MessageType {
  NULL = 0,
  SET = 1,
  CLEAR = 2,
  TOGGLE = 3,
}

enum TargetType {
  A = 0,
  B = 1,
  ABS = 2,
  GEAR = 3,
}

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
 * `sizeof(ATTACKPARAMETERS)` — what `SetupDSAParam` writes into `pDSAparameters[0]`
 * (`doc/CSBwin-src/Attack.cpp:1361`). It is a byte count where every other filter
 * stores a word count, which is CSBWin's own inconsistency; since `PARAM_FETCH`
 * clamps its request to 100 first, an over-large count behaves as "all of them".
 */
const PARTY_ATTACK_PARAM_SIZEOF = 124;
/** The `ATTACKPARAMETERS` words, `sizeof(ATTACKPARAMETERS) / 4`. */
const PARTY_ATTACK_PARAM_WORDS = PARTY_ATTACK_PARAM_SIZEOF / 4;

export class DsaSystem {
  private readonly dungeon: DungeonState;
  private readonly timers: TimerQueue;
  /** `d.Byte1596`, the room-type timer functions. */
  private readonly byte1596: ArrayLike<number>;
  private parameters: Int32Array = new Int32Array(101);
  /** The filter sites, which hand a dungeon's DSAs a block and read back what they leave. */
  readonly filters: DsaFilters;
  private adjustSkillsParameters = new Int32Array(5);
  /**
   * `globalVariables` — where a dungeon's DSAs keep their puzzle progress, so a read
   * has to carry them (`getGlobalVariables` / `setGlobalVariables`). Its length is
   * `numGlobalVariables`: a game read takes both from its `EXPOOL`
   * (`readGlobalVariables`), and a save puts them back (`Expool.storeGlobalVariables`).
   */
  private globalVariables: Int32Array;
  /**
   * `parameterMessageSequence` (`doc/CSBwin-src/data.cpp:89`): the `uByte5` of the next
   * `TT_ParameterMessage` timer, so that two set at one time run in the order they were
   * set (`TIMER::operator<`, `Timer.cpp:779-791`). Back to 0 at every `d.Time++`
   * (`CSBCode.cpp:686`, `Attack.cpp:2212`) and at a load (`SaveGame.cpp:1749`).
   */
  parameterMessageSequence = 0;
  /**
   * `disableSaves` (`doc/CSBwin-src/data.cpp:58`), which `&DISABLESAVES` sets: while it
   * holds, nothing saves the game (`GameSaves`). A read takes it from its `EXPOOL` record
   * (`readDisableSaves`), and a save writes that record (`Expool.writeDisableSaves`).
   */
  disableSaves = false;
  /** The commands and the `&` operations warned of once, apart: an opcode of one is not the other's. */
  private warnedCommands = new Set<number>();
  private warnedOps = new Set<number>();
  /**
   * `pExPkt`, "only for debugging purposes" (`doc/CSBwin-src/DSA.cpp:277`): where the run
   * stands, for a `die`'s message, as `SAVEPEXPKT` keeps it through a nested run (`:5050-5051`).
   */
  private where: { locr: LocationRel; state: number; column: number } | null = null;
  private readonly override = new DsaOverride();
  /** What the operations of `DSA_OPERATIONS` reach of the machine, and what a tool hands one of them. */
  readonly operationMachine: DsaOperationMachine;

  constructor(private readonly ctx: GameContext) {
    this.dungeon = ctx.dungeon;
    this.timers = ctx.timers;
    this.byte1596 = ctx.tables.byte1596;
    this.globalVariables = Int32Array.from(readGlobalVariables(ctx.dungeon.getData()));
    this.filters = new DsaFilters(ctx, {
      setParameters: (count, values) => this.setParameters(count, values),
      setParameter: (index, value) => { this.parameters[1 + index] = value; },
      getParameter: (index) => this.getParameter(index),
      newDsaParameters: (fn) => this.newDsaParameters(fn),
      storeAttackParameters: (words) => this.storeAttackParameters(words),
      adjustSkillsParameters: () => this.adjustSkillsParameters,
      runFilterDsa: (rn, timer, location, vars) => { this.processTimer6Internal(rn, timer, location, true, vars); },
      findFirstDsaActuator: (position) => this.findFirstDsaActuator(position),
      globalText: (index) => globalText(this.dungeon, index),
      isValidObjectId: (objectId): objectId is ObjectID => this.isValidObjectId(objectId),
    });
    this.operationMachine = {
      ctx,
      filters: this.filters,
      override: this.override,
      parameters: () => this.parameters,
      nextParameterMessageSequence: () => this.parameterMessageSequence++,
      setDisableSaves: (disable) => { this.disableSaves = disable; },
      isValidObjectId: (objectId): objectId is ObjectID => this.isValidObjectId(objectId),
    };
  }

  setParameters(count: number, values: ArrayLike<number>): void {
    const n = Math.min(Math.max(count, 0), 100);
    this.parameters[0] = n;
    for (let i = 0; i < n; i++) {
      this.parameters[1 + i] = values[i] ?? 0;
    }
  }

  /**
   * What a room timer leaves in the DSA parameters before it reaches its square's DSAs
   * (`ProcessTT_FALSEWALL`, `doc/CSBwin-src/Timer.cpp:1399-1407`; `ProcessTT_OPENROOM`,
   * `:1699-1707`; `ProcessTT_STONEROOM`, `:2178-2186`): a parameter message's own, which
   * leave `EXPOOL`, with a count of -1 when the record is gone (`EXPOOL::Read`'s -1); a
   * count of 0 for any other timer. The words past the count stay as they were.
   */
  readRoomTimerParameters(timer: TimerEntry): void {
    if (timer.function !== TimerFunction.TT_PARAMETER_MESSAGE) {
      this.parameters[0] = 0;
      return;
    }
    const record = this.dungeon.readExpoolRecord(messageParametersKey(timer.index));
    this.parameters[0] = record === null ? -1 : record.length;
    record?.forEach((value, i) => { this.parameters[1 + i] = value; });
  }

  getParameter(index: number): number {
    if (index < 0 || index >= 100) return 0;
    return this.parameters[1 + index] ?? 0;
  }

  /**
   * `NEWDSAPARAMETERS` (`doc/CSBwin-src/CSB.h:4286-4301`): `fn` runs on a parameter array
   * of its own, whose count is 0, and the caller's is back once it returns. Every filter
   * but the party attack's is called so, and so is a DSA that `ActivateDSA` starts
   * (`doc/CSBwin-src/Timer.cpp:1525`); a program that runs one, `&EXPERIENCE+` reaching
   * the adjust-skills filter, finds its own parameters after it. CSBWin leaves the words
   * past the count uninitialised; `&PARAM@` reads none past the count, so the port's
   * zeros cannot be told from them.
   */
  newDsaParameters<T>(fn: () => T): T {
    const saved = this.parameters;
    this.parameters = new Int32Array(101);
    try {
      return fn();
    } finally {
      this.parameters = saved;
    }
  }

  /**
   * `SetupDSAParam`'s part in the DSA parameters (`doc/CSBwin-src/Attack.cpp:1358-1360`):
   * `_Attack` lays its `ATTACKPARAMETERS` over the current array, with no
   * `NEWDSAPARAMETERS`, so at every attack, filter or none, the count becomes 124 and
   * the 31 words 0. The words past them keep what they held.
   */
  setupAttackParameters(): void {
    this.parameters[0] = PARTY_ATTACK_PARAM_SIZEOF;
    this.parameters.fill(0, 1, 1 + PARTY_ATTACK_PARAM_WORDS);
  }

  /**
   * The attack's words, which CSBWin writes into the current array as it goes: the port
   * keeps them in `AttackSystem`'s `PartyAttackParameters`, and copies them in before a
   * party attack filter runs and when the attack is over, where a DSA can read them.
   */
  storeAttackParameters(words: ArrayLike<number>): void {
    for (let i = 0; i < PARTY_ATTACK_PARAM_WORDS; i++) this.parameters[1 + i] = words[i] ?? 0;
  }

  /**
   * `ProcessDSATimer5` (`doc/CSBwin-src/DSA.cpp:5297-5303`): the DSA `rn` at `location`,
   * which `timer` reaches, on variables of its own and not as a filter's. `ProcessTT_OPENROOM`
   * runs it (`Timer.cpp:1757`), and so does `ActivateDSA` (`:1534`). True when the run
   * deleted `rn`, so the caller's walk of the square's chain stops.
   */
  processTimer5(rn: ObjectID, timer: TimerEntry, location: Position): boolean {
    const vars = new DsaVars();
    return this.processTimer6Internal(rn, timer, location, false, vars);
  }

  /**
   * `ProcessDSATimer6` as `ProcessTT_STONEROOM` calls it (`doc/CSBwin-src/Timer.cpp:2230`):
   * `processTimer5`'s run, on variables of its own and not as a filter's.
   */
  processTimer6(rn: ObjectID, timer: TimerEntry, location: Position): boolean {
    const vars = new DsaVars();
    return this.processTimer6Internal(rn, timer, location, false, vars);
  }

  /**
   * `ProcessDSATimer7` (`doc/CSBwin-src/DSA.cpp:5305-5311`), which `ProcessTT_FALSEWALL`
   * runs (`Timer.cpp:1433`): `processTimer5`'s run.
   */
  processTimer7(rn: ObjectID, timer: TimerEntry, location: Position): boolean {
    const vars = new DsaVars();
    return this.processTimer6Internal(rn, timer, location, false, vars);
  }

  /** The DSA global variables, all `numGlobalVariables`, for the state a read restores (`RuntimeSave.ts`). */
  getGlobalVariables(): number[] {
    return Array.from(this.globalVariables);
  }

  /** `globalVariables[index]`, or null at or past `numGlobalVariables` (`SubstituteGlobalVariable`). */
  getGlobalVariable(index: number): number | null {
    return index >= 0 && index < this.globalVariables.length ? this.globalVariables[index]! : null;
  }

  /** The DSA global variables, and their number, `numGlobalVariables`. */
  setGlobalVariables(values: readonly number[]): void {
    this.globalVariables = Int32Array.from(values, (value) => value | 0);
  }

  private processTimer6Internal(
    rn: ObjectID,
    timer: TimerEntry,
    location: Position,
    filter: boolean,
    vars: DsaVars,
  ): boolean {
    const action = this.ctx.systems.timer.getTimerAction(timer);
    if (action === 3) return false;
    const level = location.z;
    const slaveRecord = this.dungeon.getActuatorRecord(rn);
    if (!slaveRecord) return false;
    const slaveSelector = getActuatorDsaSelector(slaveRecord);
    const slaveIndex = this.getAbsDsaIndex(level, slaveSelector);
    if (slaveIndex === null) return false;
    const slaveDsa = this.getDsa(slaveIndex);
    if (!slaveDsa) return false;

    const locrSlave: LocationRel = {
      l: level,
      x: location.x,
      y: location.y,
      p: this.dungeon.rnMaps.pos(rn) & 3,
    };
    const master = this.findMaster(slaveDsa, rn, timer.uByte6, timer.uByte7, locrSlave);
    const masterRecord = this.dungeon.getActuatorRecord(master.rn);
    if (!masterRecord) return false;
    const masterSelector = getActuatorDsaSelector(masterRecord);
    const masterIndex = this.getAbsDsaIndex(level, masterSelector);
    if (masterIndex === null) return false;
    const masterDsa = this.getDsa(masterIndex);
    if (!masterDsa) return false;

    const currentState = this.getState(masterRecord, masterDsa);
    const msgType = 3 * (timer.uByte8 & 3) + action;
    // An `OVERRIDE` no operation used dies with its run (`doc/CSBwin-src/DSA.cpp:5417`),
    // and a run nested in another's clears the caller's.
    this.override.p = false;

    const bank = new DsaBank(vars, (line) => this.ctx.host.trace(line), (errorNum, underflow) =>
      die(this.ctx.host, errorNum, underflow ? this.debugMessage('DSA stack underflow') : 'SystemError'));
    bank.stack.clear();
    bank.filter = filter;
    const finalState = this.execute({
      curState: currentState,
      column: msgType,
      locrMaster: master.locr,
      locrSlave,
      rnMaster: master.rn,
      rnSlave: rn,
      master: masterDsa,
      slave: slaveDsa,
      subroutineLevel: 0,
    }, bank);

    // `PutState` whatever `Execute` returned, -1 included (`doc/CSBwin-src/DSA.cpp:5463-5464`).
    const nextState = bank.forceState >= 0 ? bank.forceState : finalState;
    this.putState(masterRecord, masterDsa, nextState);
    // `ProcessDSATimer6` returns `deletedSlave` (`doc/CSBwin-src/DSA.cpp:5484-5487`),
    // and every timer walk that runs a DSA breaks out of the cell's chain on it
    // (`Timer.cpp:1433`, `:1757`, `:2230`) — the slave's link is no longer the cell's.
    return this.consumateDeletes(bank, rn);
  }

  /**
   * `DSADBANK::ConsumateDeletes` (`doc/CSBwin-src/DSA.cpp:179-192`) — free everything
   * `&DEL` condemned during the run, and say whether the DSA's own actuator was among
   * it. `==` on an `RN` compares the indirect index alone (`CSBTypes.h:355`).
   */
  private consumateDeletes(bank: DsaBank, rnSlave: ObjectID): boolean {
    let result = false;
    while (bank.objectDeleteList !== OBJECT_ID_EOF) {
      const obj = bank.objectDeleteList;
      if (rnEquals(obj, rnSlave)) result = true;
      bank.objectDeleteList = this.dungeon.getDBRecordLink(obj);
      this.dungeon.deleteDBEntry(obj);
    }
    return result;
  }

  private execute(exPkt: ExecutionPacket, bank: DsaBank): number {
    const saved = this.where;
    try {
      return this.executeRun(exPkt, bank);
    } finally {
      this.where = saved;
    }
  }

  /** `constructDebugMessage` (`doc/CSBwin-src/DSA.cpp:278-289`). */
  private debugMessage(msg: string): string {
    const w = this.where;
    return w ? `${msg}\nDSA at ${w.locr.l}(${w.locr.x},${w.locr.y})\nRow=${w.state};Col=${w.column}` : msg;
  }

  private executeRun(exPkt: ExecutionPacket, bank: DsaBank): number {
    let finalState = -1;
    let curState = exPkt.curState;
    let column = exPkt.column;

    do {
      this.where = { locr: exPkt.locrMaster, state: curState, column };
      const state = this.getDsaState(exPkt.slave, curState);
      if (!state) {
        if (finalState === -1) finalState = curState;
        return finalState;
      }
      const program = this.getProgramForColumn(state, column);
      if (!program || program.length === 0) {
        if (finalState === -1) finalState = curState;
        return finalState;
      }
      const cursor = new ProgramCursor(program);
      let transferState = -1;
      let transferCol = -1;
      let nextState = curState;

      while (cursor.remaining > 0) {
        const word = cursor.word();
        const opcode = word & 0x3f;
        switch (opcode) {
          case DsaCommand.NOOP: {
            const relState = cursor.relState(word, 6, 10, -512);
            nextState = curState + relState;
            break;
          }
          case DsaCommand.MESSAGE:
          case DsaCommand.MESSAGE32:
          case DsaCommand.DESSAGE32: {
            const relState = cursor.relState(word, 12, 4, -8);
            nextState = curState + relState;
            const msgType = (word >> 6) & 0x3;
            const delayType = (word >> 8) & 0x3;
            const targetType = (word >> 10) & 0x3;
            let delay = 0;
            const masterRec = this.getActuator(exPkt.rnMaster);
            if (delayType === 1) delay = masterRec ? getActuatorParameterA(masterRec) : 0;
            else if (delayType === 2) delay = masterRec ? getActuatorParameterB(masterRec) : 0;
            else if (delayType === 3) {
              delay = cursor.word();
            }
            const target = this.getTarget(targetType, opcode !== DsaCommand.MESSAGE, cursor, bank, exPkt.rnMaster);
            if (msgType !== MessageType.NULL && target) {
              const action = msgType - 1;
              const morD = opcode === DsaCommand.DESSAGE32 ? 'D' : 'M';
              this.queueDsaSwitchAction(delay, action, target.l, target.x, target.y, target.p, morD);
            }
            break;
          }
          case DsaCommand.COPYTELEPORTER:
          case DsaCommand.COPYTELEPORTER32: {
            const relState = cursor.relState(word, 10, 6, -32);
            nextState = curState + relState;
            const targetFrom = (word >> 6) & 0x3;
            const targetTo = (word >> 8) & 0x3;
            const locSrc = this.getTarget(targetFrom, opcode === DsaCommand.COPYTELEPORTER32, cursor, bank, exPkt.rnMaster);
            const locDst = this.getTarget(targetTo, opcode === DsaCommand.COPYTELEPORTER32, cursor, bank, exPkt.rnMaster);
            if (locSrc && locDst) this.copyTeleporter(locSrc, locDst);
            break;
          }
          case DsaCommand.GOSUB: {
            const relState = cursor.relState(word, 13, 3, -4);
            nextState = curState + relState;
            let row = (word >> 6) & 0x3f;
            const colFlag = (word >> 12) & 0x1;
            if (row === 63) {
              row = cursor.word();
            }
            let col = 0;
            if (colFlag !== 0) {
              col = cursor.word();
            }
            const subPacket: ExecutionPacket = {
              ...exPkt,
              curState: row,
              column: col,
              subroutineLevel: exPkt.subroutineLevel + 1,
              slave: exPkt.master,
            };
            this.execute(subPacket, bank);
            break;
          }
          case DsaCommand.JUMP: {
            const relState = cursor.relState(word, 13, 3, -4);
            nextState = curState + relState;
            let row = (word >> 6) & 0x3f;
            const colFlag = (word >> 12) & 0x1;
            if (row === 63) {
              row = cursor.word();
            }
            transferState = row;
            transferCol = 0;
            if (colFlag !== 0) {
              transferCol = cursor.word();
            }
            break;
          }
          case DsaCommand.QUESTION: {
            const relState = cursor.relState(word, 6, 4, 2);
            nextState = curState + relState;
            const ifColumn = (word >> 10) & 0x1;
            const ifCmd = (word >> 11) & 0x3;
            const elseColumn = (word >> 13) & 0x1;
            const elseCmd = (word >> 14) & 0x3;

            const cond = bank.stack.pop() !== 0;
            let cmd = 0;
            let addr = 0;
            let col = 0;
            if (cond) {
              cmd = ifCmd;
              if (cmd !== 0) {
                addr = cursor.word();
              }
              if (ifColumn !== 0) {
                col = cursor.word();
              }
              if (elseCmd !== 0) {
                cursor.skip();
              }
              if (elseColumn !== 0) {
                cursor.skip();
              }
            } else {
              if (ifCmd !== 0) {
                cursor.skip();
              }
              if (ifColumn !== 0) {
                cursor.skip();
              }
              cmd = elseCmd;
              if (cmd !== 0) {
                addr = cursor.word();
              }
              if (elseColumn !== 0) {
                col = cursor.word();
              }
            }
            if (cmd === 1) {
              transferState = addr;
              transferCol = col;
            } else if (cmd === 2) {
              const subPacket: ExecutionPacket = {
                ...exPkt,
                curState: addr,
                column: col,
                subroutineLevel: exPkt.subroutineLevel + 1,
                slave: exPkt.master,
              };
              this.execute(subPacket, bank);
            }
            break;
          }
          case DsaCommand.CASE: {
            const relState = cursor.relState(word, 6, 10, -512);
            nextState = curState + relState;
            const value = bank.stack.pop();
            const numCase = cursor.word();
            // `EX_CASE`'s binary search over the cases, in unsigned order
            // (`doc/CSBwin-src/DSA.cpp:1005-1031`): on an unsorted table, or a value given
            // twice, it finds what the search finds, not the first.
            const key = value >>> 0;
            const word32 = (at: number): number => ((cursor.at(at + 1) << 16) | cursor.at(at)) >>> 0;
            let base = cursor.position;
            for (let n = numCase; n > 0;) {
              const m = n >> 1;
              const at = base + 4 * m;
              const caseValue = word32(at);
              if (caseValue === key) {
                const target = word32(at + 2);
                transferState = (target >>> 8) & 0xffff;
                transferCol = target & 0xff;
                break;
              }
              if (caseValue > key) {
                n = m;
              } else {
                base = at + 4;
                n -= m + 1;
              }
            }
            cursor.skip(4 * numCase);
            break;
          }
          case DsaCommand.EQUAL: {
            const relState = cursor.relState(word, 6, 10, -512);
            const v1 = bank.stack.pop();
            const v2 = bank.stack.pop();
            bank.stack.push(v1 === v2 ? 1 : 0);
            nextState = curState + relState;
            break;
          }
          case DsaCommand.LOAD: {
            const relState = cursor.relState(word, 11, 5, -16, true);
            nextState = curState + relState;
            const where = (word >> 6) & 0x1f;
            // `m_PC` is a `ui16 *` (`doc/CSBwin-src/DSA.cpp:251`): LOAD_INTEGER pushes the
            // word unsigned (`:1100-1107`).
            if (where === 26) {
              bank.stack.push(cursor.word());
            } else if (where === 27) {
              bank.stack.push(cursor.word());
            } else if (where === 28) {
              bank.stack.push(locationRelToInteger(exPkt.locrMaster));
            } else if (where === 30) {
              const lo = cursor.word();
              const hi = cursor.word();
              bank.stack.push((hi << 16) | lo);
            } else if (where <= 25) {
              const value = this.loadParameter(where, exPkt.rnMaster);
              bank.stack.push(value);
            }
            // 29 (`LOAD_ABS32`) and 31 are "Illegal DSA load command", and push nothing
            // (`:1139-1144`).
            break;
          }
          case DsaCommand.STORE: {
            // `EX_STORE` (`doc/CSBwin-src/DSA.cpp:1318-1387`): a `where` above 25 is
            // "Illegal DSA store command", which pops nothing and leaves the next state.
            const where = (word >> 6) & 0x1f;
            if (where > 25) break;
            this.storeParameter(where, exPkt.rnMaster, bank.stack.pop());
            const relState = cursor.relState(word, 11, 5, -16);
            nextState = curState + relState;
            break;
          }
          case DsaCommand.VARIABLESTORE: {
            const relState = cursor.relState(word, 13, 3, -4, true);
            nextState = curState + relState;
            const index = (word >> 6) & 0x7f;
            bank.setVar(index, bank.stack.pop());
            break;
          }
          case DsaCommand.VARIABLEFETCH: {
            const relState = cursor.relState(word, 13, 3, -4, true);
            nextState = curState + relState;
            const index = (word >> 6) & 0x7f;
            bank.stack.push(bank.getVar(index));
            break;
          }
          case DsaCommand.GLOBALSTORE: {
            const relState = cursor.relState(word, 13, 3, -4, true);
            nextState = curState + relState;
            const index = (word >> 6) & 0x7f;
            const value = bank.stack.pop();
            // `DSA.cpp:1269-1276`.
            if (index >= this.globalVariables.length) {
              this.ctx.host.trace('Global Store to non-existent variable');
            } else {
              this.globalVariables[index] = value;
            }
            break;
          }
          case DsaCommand.GLOBALFETCH: {
            const relState = cursor.relState(word, 13, 3, -4, true);
            nextState = curState + relState;
            const index = (word >> 6) & 0x7f;
            // Past the last variable, "Gloal fetch from non-existent variable" pushes
            // 0xcdcdcdcd (`doc/CSBwin-src/DSA.cpp:1303-1307`).
            if (index >= this.globalVariables.length) this.ctx.host.trace('Gloal fetch from non-existent variable');
            const value = index < this.globalVariables.length ? this.globalVariables[index]! : 0xcdcdcdcd;
            bank.stack.push(value);
            break;
          }
          case DsaCommand.FETCH: {
            const relState = cursor.relState(word, 6, 10, -512);
            nextState = curState + relState;
            const objMask = bank.stack.pop();
            const posMask = bank.stack.pop();
            const location = bank.stack.pop();
            let depth = bank.stack.pop();
            const locr = locationRelFromInteger(location);
            if (!this.dungeon.isValidLocation(locr)) {
              bank.stack.push(-1);
              break;
            }
            let positionMask = posMask;
            if (positionMask === -1) positionMask = 1 << locr.p;
            let result = -1;
            const pos = new Position(locr.x, locr.y, locr.l);
            for (let rn = this.dungeon.findFirstObject(pos); rn !== OBJECT_ID_EOF; rn = this.dungeon.getDBRecordLink(rn)) {
              const decoded = this.dungeon.rnMaps.decode(rn);
              if (((1 << (decoded.position & 3)) & positionMask) === 0) continue;
              if (((1 << decoded.category) & objMask) === 0) continue;
              if (depth === 0) {
                result = rn;
                break;
              }
              depth -= 1;
            }
            bank.stack.push(result);
            break;
          }
          case DsaCommand.AMPERSAND:
          case DsaCommand.AMPERSAND2: {
            const relState = cursor.relState(word, 13, 3, -4);
            nextState = curState + relState;
            const subcode = ((word >> 6) & 0x7f) + (opcode === DsaCommand.AMPERSAND2 ? 128 : 0);
            const jump = this.executeAmpersand(subcode, bank, exPkt);
            if (jump) {
              transferState = jump.state;
              transferCol = jump.col;
            }
            break;
          }
          case DsaCommand.OVERRIDE: {
            // `EX_OVERRIDE` (`doc/CSBwin-src/DSA.cpp:1038-1073`): any `what` but 1 is
            // "Illegal DSA override command", which leaves the next state.
            const what = (word >> 6) & 0x7;
            const value = (word >> 9) & 0x7;
            if (what !== 1) break;
            this.override.p = true;
            this.override.pos = value;
            if (value === 7) {
              this.override.pos = cursor.word() & 0xff;
            }
            const relState = cursor.relState(word, 12, 4, -8);
            nextState = curState + relState;
            break;
          }
          default:
            // "Unknown DSA command code", and the run returns the state it is in
            // (`doc/CSBwin-src/DSA.cpp:5263-5265`).
            if (!this.warnedCommands.has(opcode)) {
              this.warnedCommands.add(opcode);
              this.ctx.host.trace(`Unknown DSA command code ${opcode}`);
            }
            return curState;
        }

        if (transferState >= 0) break;
        if (finalState === -1 && nextState >= 0) finalState = nextState;
      }

      if (nextState >= 0 && finalState === -1) finalState = nextState;
      curState = transferState;
      column = transferCol;
      transferState = -1;
      transferCol = -1;
    } while (curState >= 0);

    return finalState;
  }

  /**
   * `EX_AMPERSAND`'s switch (`doc/CSBwin-src/DSA.cpp:2393-4983`): an operation of
   * `DSA_OPERATIONS`, else one of the cases still here. Public so that `tools/` can watch
   * an operation run, in the middle of a program.
   */
  executeAmpersand(subcode: number, bank: DsaBank, exPkt: ExecutionPacket): GearJump | void {
    const operation = DSA_OPERATIONS.get(subcode);
    if (operation) return operation(bank, exPkt, this.operationMachine);
    switch (subcode) {
      case StkOp.SET_NEW_STATE:
        bank.forceState = bank.stack.pop();
        break;
      case StkOp.PARAM_FETCH: {
        // `i`, `n` and `j` are `ui32` (`doc/CSBwin-src/DSA.cpp:2957-2986`), so the count is
        // compared unsigned: a count of -1, a parameter message whose record is gone, is
        // never short, and the words are copied as they stand.
        const index = bank.stack.pop() >>> 0;
        let n = bank.stack.pop() >>> 0;
        if (n > 100) {
          this.ctx.host.trace('DSA &PARAM@ too many parameters');
          break;
        }
        const paramCount = (this.parameters[0] ?? 0) >>> 0;
        if (n > paramCount) {
          this.ctx.host.trace('DSA &PARAM@ non-existent parameter');
          for (let j = paramCount; j < n; j++) {
            // `pdsaDbank->Var(j)` (`doc/CSBwin-src/DSA.cpp:2978`): a read of the
            // parameter's number, where the variable marked is `index + j`.
            bank.getVar(j);
            bank.setVarState(index + j, DsaVarType.NonParameter);
          }
          n = paramCount;
        }
        for (let j = 0; j < n; j++) {
          bank.setVar(index + j, this.parameters[1 + j] ?? 0);
        }
        break;
      }
      case StkOp.PARAM_STORE: {
        // `doc/CSBwin-src/DSA.cpp:3001-3021`, signed.
        const index = bank.stack.pop();
        const n = bank.stack.pop();
        if (n > 100) {
          this.ctx.host.trace('DSA &PARAM! too many parameters');
          break;
        }
        for (let j = 0; j < n; j++) {
          if (bank.getVarState(index + j) !== DsaVarType.NonParameter) {
            this.parameters[1 + j] = bank.getVar(index + j);
          }
        }
        break;
      }
      case StkOp.SET_ADJUST_SKILLS_PARAMETERS: {
        this.adjustSkillsParameters[4] = bank.stack.pop();
        this.adjustSkillsParameters[3] = bank.stack.pop();
        this.adjustSkillsParameters[2] = bank.stack.pop();
        this.adjustSkillsParameters[1] = bank.stack.pop();
        this.adjustSkillsParameters[0] = bank.stack.pop();
        break;
      }
      case StkOp.NUM_PARAM:
        bank.stack.push(this.parameters[0] ?? 0);
        break;
      case StkOp.JUMP_GEAR: {
        // `doc/CSBwin-src/DSA.cpp:4738-4746`: the state, then the column, from the stack.
        const state = bank.stack.pop();
        const col = bank.stack.pop();
        return { state, col };
      }
      case StkOp.GOSUB_GEAR: {
        // `doc/CSBwin-src/DSA.cpp:4747-4768`: `EX_GOSUB`'s call, the master's program.
        const state = bank.stack.pop();
        const msg = bank.stack.pop();
        this.execute({
          ...exPkt,
          curState: state,
          column: msg,
          subroutineLevel: exPkt.subroutineLevel + 1,
          slave: exPkt.master,
        }, bank);
        break;
      }
      case StkOp.THIS_DSA_ID:
        // `doc/CSBwin-src/DSA.cpp:4823-4829`: the slave's RN, `ConvertToInteger`.
        bank.stack.push(exPkt.rnSlave);
        break;
      case StkOp.I_INDIRECT: {
        // `doc/CSBwin-src/DSA.cpp:2346-2392`: the parameter record `indirect` packed, back
        // on the stack, in the variables and in the parameters, and its operation run. A
        // record that names none does nothing. A count past the array reads outside
        // CSBWin's, where the port reads 0 and stops at 100.
        const operation = INDIRECT_OPERATIONS.get(this.parameters[1] ?? 0);
        if (operation === undefined) return;
        const p = this.parameters;
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
        return this.executeAmpersand(operation, bank, exPkt);
      }
      // `DSA.cpp:4958-4972`: each `I_` operation's operands, sent to the DSA at
      // `ESL_INDIRECTACTIONS` (`indirect`).
      case StkOp.I_DEL: this.indirect(bank, subcode, false, 2, 0); break;
      case StkOp.I_DEL_MON: this.indirect(bank, subcode, false, 2, 0); break;
      case StkOp.I_INS_MON: this.indirect(bank, subcode, false, 2, 0); break;
      case StkOp.I_ADD: this.indirect(bank, subcode, false, 3, 0); break;
      case StkOp.I_CREATE_CLOUD: this.indirect(bank, subcode, false, 3, 0); break;
      case StkOp.I_CAST: this.indirect(bank, subcode, false, 0, 13); break;
      case StkOp.I_TELEPORT_PARTY: this.indirect(bank, subcode, false, 1, 0); break;
      case StkOp.I_MONSTER_STORE: this.indirect(bank, subcode, true, 3, 0); break;
      case StkOp.I_CHAR_STORE: this.indirect(bank, subcode, true, 3, 0); break;
      case StkOp.I_CAUSE_POISON: this.indirect(bank, subcode, false, 2, 0); break;
      case StkOp.I_MOVE: this.indirect(bank, subcode, false, 10, 0); break;
      case StkOp.I_COPY: this.indirect(bank, subcode, false, 2, 0); break;
      case StkOp.I_CELL_STORE: this.indirect(bank, subcode, true, 3, 0); break;
      case StkOp.I_THROW: this.indirect(bank, subcode, false, 7, 0); break;
      case StkOp.I_SWAP_CHARACTER: this.indirect(bank, subcode, false, 2, 0); break;
      case StkOp.I_DELAY:
        // `DSA.cpp:4973-4979`: the delay of the next `indirect`, this run only.
        bank.indirectActionDelay = bank.stack.pop();
        break;
      default:
        if (!this.warnedOps.has(subcode)) {
          this.warnedOps.add(subcode);
          this.ctx.host.trace(`Unimplemented DSA & opcode ${subcode}`);
        }
        break;
    }
  }

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
  private indirect(bank: DsaBank, type: number, array: boolean, numVar: number, numParam: number): void {
    const location = this.dungeon.getSpecialLocation(specialLocationKey(Esl.INDIRECT_ACTIONS));
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
    for (let i = 0; i < numParam; i++) record.push(this.parameters[1 + i] ?? 0);
    if (record.length > 29) return;
    let actionTime = this.ctx.state.tickCount;
    if (bank.indirectActionDelay > 0) {
      actionTime += bank.indirectActionDelay;
      bank.indirectActionDelay = -1;
    }
    const timer = this.timers.createTimerWithUByte5(
      TimerFunction.TT_PARAMETER_MESSAGE, indirectLocr.x, indirectLocr.y, 0, 0, actionTime, indirectLocr.l,
      this.parameterMessageSequence++,
    );
    this.dungeon.writeExpoolRecord(messageParametersKey(timer.index), record);
  }

  private getDsa(index: number): DsaDefinition | null {
    const dsaIndex = this.dungeon.getData().dsaIndex;
    if (!dsaIndex) return null;
    return dsaIndex.entries[index] ?? null;
  }

  private getDsaState(dsa: DsaDefinition, state: number): DsaState | null {
    return dsa.states[state] ?? null;
  }

  private getProgramForColumn(state: DsaState, column: number): Uint16Array | null {
    for (const action of state.actions) {
      if (action.column === column) return action.program;
    }
    return null;
  }

  private getAbsDsaIndex(level: number, selector: number): number | null {
    const idx = this.dungeon.getDsaLevelIndex(level, selector);
    if (idx === null || idx === undefined) return null;
    if (idx > 255) return null;
    return idx;
  }

  /**
   * `FindMaster` (`doc/CSBwin-src/DSA.cpp:535-548`). CSBWin implements no slave DSA: a
   * DSA is its own master unless its `LocalState()` is 3 (`IsMaster`, `Data.h:2479-2482`),
   * and for one that is, it warns and runs the slave as its master all the same. The
   * slave's master coordinates are then left unset, so the port takes the timer's, as
   * for a master. No dungeon here has a DSA whose local state is 3.
   */
  private findMaster(slave: DsaDefinition, rnSlave: ObjectID, x: number, y: number, locrSlave: LocationRel): {
    rn: ObjectID;
    locr: LocationRel;
  } {
    if (slave.localState !== 3) {
      return { rn: rnSlave, locr: { l: locrSlave.l, x, y, p: locrSlave.p } };
    }
    this.ctx.host.trace('Slave DSA Not Implemented');
    return { rn: rnSlave, locr: { l: locrSlave.l, x, y, p: locrSlave.p } };
  }

  private getState(rec: ActuatorRecord, dsa: DsaDefinition): number {
    switch (dsa.localState) {
      case 0:
        return getActuatorDsaState(rec);
      case 1:
        return dsa.state;
      case 2:
        return getActuatorParameterB(rec);
      default:
        this.ctx.host.trace(`Illegal DSA localState ${dsa.localState}`);
        return 0;
    }
  }

  private putState(rec: ActuatorRecord, dsa: DsaDefinition, state: number): void {
    switch (dsa.localState) {
      case 0:
        setActuatorDsaState(rec, state);
        break;
      case 1:
        // `void State(i32 s){m_state = (ui16)s;}` (`doc/CSBwin-src/Data.h:2483`).
        dsa.state = state & 0xffff;
        break;
      case 2:
        setActuatorParameterB(rec, state);
        break;
      default:
        this.ctx.host.trace(`Illegal DSA localState ${dsa.localState}`);
        break;
    }
  }

  private getTarget(
    targetType: number,
    thirtyTwo: boolean,
    cursor: ProgramCursor,
    bank: DsaBank,
    rnMaster: ObjectID,
  ): LocationRel | null {
    let target = 0;
    switch (targetType) {
      case TargetType.A: {
        const rec = this.getActuator(rnMaster);
        target = rec ? getActuatorParameterA(rec) : 0;
        break;
      }
      case TargetType.B: {
        const rec = this.getActuator(rnMaster);
        target = rec ? getActuatorParameterB(rec) : 0;
        break;
      }
      case TargetType.ABS: {
        target = cursor.word();
        if (thirtyTwo) {
          target |= (cursor.word() << 16) >>> 0;
        }
        break;
      }
      case TargetType.GEAR:
        target = bank.stack.pop();
        break;
      default:
        return null;
    }
    const locr = locationRelFromInteger(target);
    if (this.override.p) {
      locr.p = this.override.pos & 3;
      this.override.p = false;
    }
    return locr;
  }

  /**
   * `QueueDSASwitchAction` (`doc/CSBwin-src/DSA.cpp:486-533`): a set, clear or toggle
   * (`tmrAct` 0, 1, 2) sent `delay` ticks on to a cell, as the timer its room type takes
   * (`'M'`), or as a `TT_DESSAGE` (`'D'`). A DSA's `MESSAGE` sends it, and so does a
   * portrait the Hall of Champions disables (`PortraitTranslateDisable`,
   * `CSBCode.cpp:6648-6671`).
   */
  queueDsaSwitchAction(
    delay: number,
    tmrAct: number,
    level: number,
    targetX: number,
    targetY: number,
    targetPos: number,
    morD: 'M' | 'D',
  ): void {
    const actionTime = (this.ctx.state.tickCount + delay) >>> 0;

    if (morD === 'M') {
      const map = this.dungeon.getMap(level);
      if (!map) return;
      const cellFlag = map.cellFlags[targetX]?.[targetY];
      if (cellFlag === undefined) return;
      const roomType = getRoomType(cellFlag);
      if (roomType !== RoomType.STONE && roomType !== RoomType.FALSEWALL) {
        targetPos = 0;
      }
      const mapping = this.byte1596[roomType]!;
      if (mapping === 0) {
        this.ctx.host.trace(`Illegal DSA timer target (${targetX},${targetY}) L${level}`);
        return;
      }
      this.timers.createTimer(mapping, targetX, targetY, targetPos, tmrAct, actionTime, level);
      return;
    }

    this.timers.createTimer(TimerFunction.TT_DESSAGE, targetX, targetY, targetPos, tmrAct, actionTime, level);
  }

  private loadParameter(where: number, rnMaster: ObjectID): number {
    let rn = rnMaster;
    let slot = where;
    while (slot > 1) {
      rn = this.dungeon.getDBRecordLink(rn);
      if (rn === OBJECT_ID_EOF) break;
      const decoded = this.dungeon.rnMaps.decode(rn);
      if (decoded.category !== DBType.ACTUATOR) continue;
      const rec = this.getActuator(rn);
      if (!rec || getActuatorType(rec) !== 47) continue;
      slot -= 2;
    }
    if (rn === OBJECT_ID_EOF) return 0;
    const rec = this.getActuator(rn);
    if (!rec) return 0;
    return slot === 0 ? getActuatorParameterA(rec) : getActuatorParameterB(rec);
  }

  private storeParameter(where: number, rnMaster: ObjectID, value: number): void {
    let rn = rnMaster;
    let slot = where;
    while (slot > 1) {
      rn = this.dungeon.getDBRecordLink(rn);
      if (rn === OBJECT_ID_EOF) break;
      const decoded = this.dungeon.rnMaps.decode(rn);
      if (decoded.category !== DBType.ACTUATOR) continue;
      const rec = this.getActuator(rn);
      if (!rec || getActuatorType(rec) !== 47) continue;
      slot -= 2;
    }
    if (rn === OBJECT_ID_EOF) return;
    const rec = this.getActuator(rn);
    if (!rec) return;
    if (slot === 0) setActuatorParameterA(rec, value);
    else setActuatorParameterB(rec, value);
  }

  private copyTeleporter(src: LocationRel, dst: LocationRel): void {
    const srcPos = new Position(src.x, src.y, src.l);
    const dstPos = new Position(dst.x, dst.y, dst.l);
    const srcRn = findFirstTeleporter(this.dungeon, srcPos);
    const dstRn = findFirstTeleporter(this.dungeon, dstPos);
    if (srcRn === OBJECT_ID_EOF || dstRn === OBJECT_ID_EOF) return;
    const srcRec = this.dungeon.getTeleporterRecord(srcRn);
    const dstRec = this.dungeon.getTeleporterRecord(dstRn);
    if (!srcRec || !dstRec) return;
    dstRec.sound = srcRec.sound;
    dstRec.scope = srcRec.scope;
    dstRec.absoluteRotation = srcRec.absoluteRotation;
    dstRec.rotation = srcRec.rotation;
    dstRec.destX = srcRec.destX;
    dstRec.destY = srcRec.destY;
    dstRec.destMap = srcRec.destMap;
    const srcMap = this.dungeon.getMap(src.l);
    if (!srcMap) return;
    updateCellFlag(this.dungeon, dst, srcMap.cellFlags[src.x]![src.y]!);
  }

  private findFirstDsaActuator(position: Position): ObjectID {
    for (let rn = this.dungeon.findFirstObject(position); rn !== OBJECT_ID_EOF; rn = this.dungeon.getDBRecordLink(rn)) {
      if (this.dungeon.rnMaps.dbType(rn) !== DBType.ACTUATOR) continue;
      const rec = this.dungeon.getActuatorRecord(rn);
      if (!rec) continue;
      if (getActuatorType(rec) === 47) return rn;
    }
    return OBJECT_ID_EOF;
  }

  /** `RN::checkIndirectIndex(i)` (`doc/CSBwin-src/data.cpp:530-535`): a slot of the maps. */
  private isValidObjectId(objectId: number): objectId is ObjectID {
    return objectId >= 0 && this.dungeon.rnMaps.checkIndirectIndex(objectId);
  }

  private getActuator(rn: ObjectID): ActuatorRecord | null {
    return this.dungeon.getActuatorRecord(rn);
  }

}
