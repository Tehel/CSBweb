import { OBJECT_ID_EOF, type LocationRel, type ObjectID } from '../../core/types';
import type { DsaDefinition } from '../../data/dungeonTypes';
import { DsaVarType, type DsaVars } from './DsaTypes';

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
