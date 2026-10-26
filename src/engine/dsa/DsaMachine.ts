import {
  DBType,
  OBJECT_ID_EOF,
  Position,
  locationRelFromInteger,
  locationRelToInteger,
  type LocationRel,
  type ObjectID,
} from '../../core/types';
import type { ActuatorRecord, DsaDefinition, DsaState } from '../../data/dungeonTypes';
import {
  getActuatorParameterA,
  getActuatorParameterB,
  getActuatorType,
  setActuatorParameterA,
  setActuatorParameterB,
} from '../../data/actuatorHelpers';
import type { DungeonState } from '../DungeonState';
import type { GameContext } from '../GameContext';
import { findFirstTeleporter, updateCellFlag } from './ops/dungeon';
import { DsaVarType, type DsaVars } from './DsaTypes';

/**
 * `Override_P` and `Override_Pos` (`doc/CSBwin-src/DSA.cpp:444-445`): the corner an
 * `OVERRIDE` command sets, which the next target an operation takes is given and clears.
 */
export class DsaOverride {
  p = false;
  pos = 0;
}

/**
 * `STACK` (`doc/CSBwin-src/DSA.cpp:370-424`): 100 values, and `die` on an overflow
 * (`0xdcd6`), an underflow (`0xdcd7`), a pick or a poke past the bottom (`0xdcdb`) and a
 * roll past it (`0xdcda`). `fail` is that `die`, `underflow` asking for its "DSA stack
 * underflow" message; the overflow's has none.
 */
export class DsaStack {
  private stack: number[] = [];

  constructor(private readonly fail: (errorNum: number, underflow: boolean) => never) {}

  clear(): void {
    this.stack.length = 0;
  }

  push(value: number): void {
    if (this.stack.length > 99) this.fail(0xdcd6, false);
    this.stack.push(value | 0);
  }

  pop(): number {
    if (this.stack.length < 1) this.fail(0xdcd7, true);
    return this.stack.pop()!;
  }

  /** The `ui32` index's `i+1`, which wraps as the C's does. */
  private reach(index: number): number {
    return ((index >>> 0) + 1) >>> 0;
  }

  pick(index: number): void {
    if (this.stack.length < this.reach(index)) this.fail(0xdcdb, true);
    this.push(this.stack[this.stack.length - 1 - (index >>> 0)] ?? 0);
  }

  poke(index: number): void {
    const value = this.pop();
    const i = index >>> 0;
    if (this.stack.length < i) this.fail(0xdcdb, true);
    // `stack[stacklen-i] = v`: 0 writes the slot above the top, which holds nothing.
    if (i > 0) this.stack[this.stack.length - i] = value;
  }

  roll(index: number): void {
    if (this.stack.length < this.reach(index)) this.fail(0xdcda, true);
    const start = this.stack.length - 1 - (index >>> 0);
    const value = this.stack[start];
    for (let i = start; i < this.stack.length - 1; i++) {
      this.stack[i] = this.stack[i + 1] ?? 0;
    }
    this.stack[this.stack.length - 1] = value ?? 0;
  }

  minusRoll(index: number): void {
    if (this.stack.length < this.reach(index)) this.fail(0xdcda, true);
    const end = this.stack.length - 1;
    const start = end - (index >>> 0);
    const value = this.stack[end];
    for (let i = end; i > start; i--) {
      this.stack[i] = this.stack[i - 1] ?? 0;
    }
    this.stack[start] = value ?? 0;
  }
}

export class DsaBank {
  readonly stack: DsaStack;
  forceState = -1;
  mostRecentInterestingObjectID = -1;
  filter = false;
  indirectActionDelay = -1;
  /**
   * `m_objectDeleteList` (`doc/CSBwin-src/DSA.cpp:133`) — what `&DEL` has condemned,
   * chained through the records' own links, freed only once the run is over.
   */
  objectDeleteList: ObjectID = OBJECT_ID_EOF;
  /**
   * `numText` and `textStrings` (`doc/CSBwin-src/DSA.cpp:127-128`): the run's ten texts,
   * which `&TEXT@` and `&CHARNAME@` set, none until the first is.
   */
  private texts: Array<string | null> | null = null;

  /** `trace` says what CSBWin's `NoValue` asks in its message box; `fail` is the stack's `die`. */
  constructor(
    public vars: DsaVars,
    private readonly trace: (line: string) => void,
    fail: (errorNum: number, underflow: boolean) => never,
  ) {
    this.stack = new DsaStack(fail);
  }

  /**
   * `NOFILTER` (`doc/CSBwin-src/DSA.cpp:458-463`): an operation that changes the dungeon,
   * run from a filter, warns the dungeon's author.
   */
  noFilter(): void {
    if (this.filter) this.trace('Filter Modifying Dungeon');
  }

  /** `DSADBANK::SetText` (`doc/CSBwin-src/DSA.cpp:195-206`): an index past 9 sets nothing. */
  setText(text: string, index: number): void {
    if (index > 9) return;
    this.texts ??= new Array<string | null>(10).fill(null);
    this.texts[index] = text;
  }

  /**
   * `DSADBANK::GetText` (`doc/CSBwin-src/DSA.cpp:208-213`): "" for a text never set. An
   * index past 9 reads past CSBWin's array once any text is set; here it reads "".
   */
  getText(index: number): string {
    if (!this.texts) return '';
    return this.texts[index >>> 0] ?? '';
  }

  /**
   * `DSADBANK::Var(i)` (`doc/CSBwin-src/DSA.cpp:142`): a variable not well defined, never
   * set or past a short `&PARAM@`, is zeroed by the read (`NoValue`).
   */
  getVar(index: number): number {
    if (index < 0 || index >= this.vars.values.length) return 0;
    if (this.vars.definedFlags[index] !== DsaVarType.WellDefined) {
      this.noValue(index);
      return 0;
    }
    return this.vars.values[index] ?? 0;
  }

  /**
   * `DSADBANK::NoValue` (`doc/CSBwin-src/DSA.cpp:228-239`): the variable is zeroed, and
   * the message box CSBWin raises, until its player answers "yes" to suppress it, is a
   * trace each time.
   */
  private noValue(index: number): void {
    this.vars.values[index] = 0;
    this.trace(`DSA variable[${index}] used without having been assigned a value.`);
  }

  setVar(index: number, value: number): void {
    if (index < 0 || index >= this.vars.values.length) return;
    this.vars.values[index] = value | 0;
    this.vars.definedFlags[index] = DsaVarType.WellDefined;
  }

  /**
   * `DSADBANK::SetVarBit` (`doc/CSBwin-src/DSA.cpp:144`): a variable not well defined is
   * zeroed (`NoValue`) before the bit goes in, and is still not well defined after.
   * `&CELL@`, its one caller, has set the variable to 0 first.
   */
  setVarBit(index: number, bitmask: number): void {
    if (index < 0 || index >= this.vars.values.length) return;
    if (this.vars.definedFlags[index] !== DsaVarType.WellDefined) this.noValue(index);
    this.vars.values[index] = (this.vars.values[index] ?? 0) | bitmask;
  }

  setVarState(index: number, state: DsaVarType): void {
    if (index < 0 || index >= this.vars.definedFlags.length) return;
    this.vars.definedFlags[index] = state;
  }

  getVarState(index: number): DsaVarType {
    if (index < 0 || index >= this.vars.definedFlags.length) return DsaVarType.Undefined;
    return this.vars.definedFlags[index] as DsaVarType;
  }
}

/**
 * `EXECUTIONPACKET` (`doc/CSBwin-src/DSA.cpp:248-263`), what a run is handed: its
 * `m_PC`, `m_wordsRemaining`, `m_nextState` and transfers are `executeRun`'s own, over
 * a `ProgramCursor`. `locrSlave` and `subroutineLevel` serve only CSBWin's trace.
 */
export interface ExecutionPacket {
  curState: number;
  column: number;
  locrMaster: LocationRel;
  locrSlave: LocationRel;
  rnMaster: ObjectID;
  rnSlave: ObjectID;
  master: DsaDefinition;
  slave: DsaDefinition;
  subroutineLevel: number;
}

/** `JUMP*`'s transfer, which `execute` takes as `EX_JUMP`'s (`doc/CSBwin-src/DSA.cpp:4738-4746`). */
export interface GearJump {
  state: number;
  col: number;
}

function signExtend(value: number, bits: number): number {
  const sign = 1 << (bits - 1);
  return (value & (sign - 1)) - (value & sign);
}

/**
 * `m_PC` and `m_wordsRemaining` (`doc/CSBwin-src/DSA.cpp:251-252`): a program's words,
 * read in order, 0 past its end, and how many are left to the end, which ends the run of
 * a column when it reaches 0. `m_PC` is a `ui16 *`, so a word is unsigned.
 */
export class ProgramCursor {
  private pc = 0;

  constructor(private readonly program: Uint16Array) {}

  /** `m_wordsRemaining`: the words past the cursor, below 0 once a read ran past the end. */
  get remaining(): number {
    return this.program.length - this.pc;
  }

  get position(): number {
    return this.pc;
  }

  /** `*(exPkt.m_PC++)`. */
  word(): number {
    return this.program[this.pc++] ?? 0;
  }

  /** `exPkt.m_PC += n` over words not read. */
  skip(n = 1): void {
    this.pc += n;
  }

  /** The word at `index`, wherever the cursor is: `EX_CASE`'s table. */
  at(index: number): number {
    return this.program[index] ?? 0;
  }

  /**
   * A command's relative state: the signed `bits`-wide field at `shift`, or, when
   * `IsMaxState()` (the field is `-MAXSTATE`, `doc/CSBwin-src/Data.h:1904-2399`), the
   * next word, cast to `i16` when `signed`. Every `MAXSTATE` but `QUESTION`'s 2 is the
   * field's most negative value, whose negation the field cannot hold
   * (`doc/CSBWIN_DSA_REFERENCE.md`).
   */
  relState(word: number, shift: number, bits: number, maxState: number, signed = false): number {
    const relState = signExtend((word >> shift) & ((1 << bits) - 1), bits);
    if (relState !== -maxState) return relState;
    const next = this.word();
    return signed ? (next << 16) >> 16 : next;
  }
}

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
 * What `Execute` reaches beyond its run: CSBWin's globals, and the `&` operations and
 * the switch action, which the façade answers.
 */
export interface DsaInterpreterHost {
  readonly ctx: GameContext;
  readonly override: DsaOverride;
  /** `globalVariables`, the array of the moment, which a read replaces. */
  globalVariables(): Int32Array;
  executeAmpersand(subcode: number, bank: DsaBank, exPkt: ExecutionPacket): GearJump | void;
  queueDsaSwitchAction(
    delay: number, tmrAct: number, level: number, targetX: number, targetY: number, targetPos: number, morD: 'M' | 'D',
  ): void;
}

/**
 * `Execute` (`doc/CSBwin-src/DSA.cpp:5054`) and its commands, `EX_NOOP` to `EX_FETCH`
 * (`:575-5044`): a DSA's programs run, state by state, on a bank.
 */
export class DsaInterpreter {
  private readonly ctx: GameContext;
  private readonly dungeon: DungeonState;
  private readonly override: DsaOverride;
  /** The commands warned of once. */
  private warnedCommands = new Set<number>();
  /**
   * `pExPkt`, "only for debugging purposes" (`doc/CSBwin-src/DSA.cpp:277`): where the run
   * stands, for a `die`'s message, as `SAVEPEXPKT` keeps it through a nested run (`:5050-5051`).
   */
  private where: { locr: LocationRel; state: number; column: number } | null = null;

  constructor(private readonly host: DsaInterpreterHost) {
    this.ctx = host.ctx;
    this.dungeon = host.ctx.dungeon;
    this.override = host.override;
  }

  execute(exPkt: ExecutionPacket, bank: DsaBank): number {
    const saved = this.where;
    try {
      return this.executeRun(exPkt, bank);
    } finally {
      this.where = saved;
    }
  }

  /** `constructDebugMessage` (`doc/CSBwin-src/DSA.cpp:278-289`). */
  debugMessage(msg: string): string {
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
              this.host.queueDsaSwitchAction(delay, action, target.l, target.x, target.y, target.p, morD);
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
            const globalVariables = this.host.globalVariables();
            const value = bank.stack.pop();
            // `DSA.cpp:1269-1276`.
            if (index >= globalVariables.length) {
              this.ctx.host.trace('Global Store to non-existent variable');
            } else {
              globalVariables[index] = value;
            }
            break;
          }
          case DsaCommand.GLOBALFETCH: {
            const relState = cursor.relState(word, 13, 3, -4, true);
            nextState = curState + relState;
            const index = (word >> 6) & 0x7f;
            const globalVariables = this.host.globalVariables();
            // Past the last variable, "Gloal fetch from non-existent variable" pushes
            // 0xcdcdcdcd (`doc/CSBwin-src/DSA.cpp:1303-1307`).
            if (index >= globalVariables.length) this.ctx.host.trace('Gloal fetch from non-existent variable');
            const value = index < globalVariables.length ? globalVariables[index]! : 0xcdcdcdcd;
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
            const jump = this.host.executeAmpersand(subcode, bank, exPkt);
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

  private getDsaState(dsa: DsaDefinition, state: number): DsaState | null {
    return dsa.states[state] ?? null;
  }

  private getProgramForColumn(state: DsaState, column: number): Uint16Array | null {
    for (const action of state.actions) {
      if (action.column === column) return action.program;
    }
    return null;
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

  private getActuator(rn: ObjectID): ActuatorRecord | null {
    return this.dungeon.getActuatorRecord(rn);
  }
}
