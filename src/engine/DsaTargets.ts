/**
 * The squares a DSA's programs name, read from the programs without running them, for the
 * map's info (`src/engine/CellInfo.ts`). A location is a `LOCATIONREL` integer,
 * `(p << 16) | (l << 10) | (x << 5) | y` (`doc/CSBwin-src/DSA.cpp:293-310`), on its level's
 * own columns and rows. A program names one where a command or an operation reads a
 * location:
 *
 * - a message command's target and `COPYTELEPORTER`'s two (`GetTarget`,
 *   `doc/CSBwin-src/DSA.cpp:615-655`): the actuator's parameter A or B, a word of the
 *   program, or popped from the stack;
 * - `FETCH`'s location (`DsaMachine`'s `FETCH`), and an operation's, popped from the
 *   stack (`LOCATION_OPERANDS`).
 *
 * What is on the stack is followed through the program, a command at a time: a constant
 * the program loads (`LOAD_INTEGER`, `LOAD_INTEGER32`), or a parameter of the actuator or
 * of a DSA after it in its square (`loadParameter`), is known, and so is a location the
 * program holds (`LOAD_ABS`, `doc/CSBwin-src/DSA.cpp:1108-1118`); whatever else is pushed is
 * not. A parameter that one of the DSA's programs stores (`STORE`, `&PARAM!`) is a
 * variable, and not known. A command that leaves the program's line (`QUESTION`, `CASE`,
 * `JUMP`, `GOSUB`) or an operation whose stack effect is not listed here forgets the whole
 * stack. A location read from what is not known is computed as the DSA runs: it is not
 * followed, and the info says there are some.
 */
import { StkOp } from './dsa/DsaTypes';
import { walkProgram } from './DungeonCensus';

/** Where a value on the stack came from, when it is known. */
export type DsaValue =
  | { readonly kind: 'constant'; readonly value: number }
  /** `loadParameter`'s `where`: 0 and 1 the actuator's A and B, then the next DSA's, … */
  | { readonly kind: 'parameter'; readonly where: number }
  /** `L$`, the DSA's own square (`LOAD_DOLLAR`, `doc/CSBwin-src/DSA.cpp:1119-1125`), which the info does not list. */
  | { readonly kind: 'self' };

/** A location a program reads: what it does there, and where the location comes from. */
export interface DsaTargetUse {
  readonly words: string;
  readonly from: DsaValue;
}

/** What a DSA's programs read as locations, before any actuator's parameters are read. */
export interface DsaTargets {
  readonly uses: readonly DsaTargetUse[];
  /** Some location is computed as the DSA runs. */
  readonly computed: boolean;
  /** The parameter slots the programs store, which are then variables. */
  readonly stored: ReadonlySet<number>;
  /** Some program stores parameters through `&PARAM!`, at a slot it computes. */
  readonly storesAnyParameter: boolean;
}

/** A message's words by `MESSAGETYPE`: `MSG_NULL` sends nothing (`doc/CSBwin-src/DSA.cpp:666-700`). */
const MESSAGE_WORDS = [null, 'Sends SET to', 'Sends CLEAR to', 'Sends TOGGLE to'] as const;

/**
 * An operation that reads a location: which value it pops is the location, counted from
 * the top, and what it does there. `when` is another popped value the location depends
 * on: `&MOVE` reads one only for a type of 1, a cell, and `&DEL`, `&ADD` and `&DESCRIBE`
 * only for a location of 0 or more. Read off the port's operations (`src/engine/dsa/ops/`),
 * each CSBWin's `EX_AMPERSAND` case (`doc/CSBWIN_DSA_REFERENCE.md`).
 */
interface LocationOperand {
  readonly index: number;
  readonly words: string;
  readonly typeIndex?: number;
  readonly nonNegative?: boolean;
}

const LOCATION_OPERANDS: ReadonlyMap<number, readonly LocationOperand[]> = new Map<number, readonly LocationOperand[]>([
  [StkOp.FALSE_PIT, [{ index: 1, words: 'Makes false or real the pit' }]],
  [StkOp.GENERATOR_DELAY_STORE, [{ index: 0, words: 'Sets the generator delay' }]],
  [StkOp.GENERATOR_DELAY_FETCH, [{ index: 0, words: 'Reads the generator' }]],
  [StkOp.CELL_FETCH, [{ index: 2, words: 'Reads the square' }]],
  [StkOp.CELL_STORE, [{ index: 2, words: 'Changes the square' }]],
  [StkOp.CREATE_CLOUD, [{ index: 2, words: 'Makes a cloud' }]],
  [StkOp.THIS_CELL, [{ index: 1, words: 'Examines the square' }]],
  [StkOp.NEIGHBORS, [{ index: 1, words: 'Examines around the square' }]],
  [StkOp.TELEPORT_PARTY, [{ index: 0, words: 'Teleports the party to' }]],
  [StkOp.THROW, [{ index: 4, words: 'Throws a missile from' }, { index: 5, words: 'Throws the object of' }]],
  [StkOp.GET_SKIN, [{ index: 0, words: 'Reads the skin' }]],
  [StkOp.SET_SKIN, [{ index: 0, words: 'Sets the skin' }]],
  [StkOp.FETCH_EX_CELL_FLG, [{ index: 0, words: 'Reads the extended flags' }]],
  [StkOp.STORE_EX_CELL_FLG, [{ index: 0, words: 'Sets the extended flags' }]],
  [StkOp.PARTY_DISTANCE, [{ index: 0, words: 'Measures the party from' }]],
  [StkOp.MESSAGE, [{ index: 3, words: 'Sends a message to' }]],
  [StkOp.DESCRIBE, [{ index: 2, words: 'Describes from the texts of', nonNegative: true }]],
  [StkOp.SAY, [{ index: 1, words: 'Says the text of' }]],
  [StkOp.DEL_MON, [{ index: 1, words: 'Takes a monster from' }]],
  [StkOp.INS_MON, [{ index: 1, words: 'Adds a monster to' }]],
  [StkOp.MOVE, [{ index: 1, words: 'Moves an object to', typeIndex: 4 }, { index: 6, words: 'Moves an object from', typeIndex: 9 }]],
  [StkOp.DEL, [{ index: 0, words: 'Deletes an object from', nonNegative: true }]],
  [StkOp.ADD, [{ index: 1, words: 'Adds an object to', nonNegative: true }]],
]);

/**
 * The operations whose stack effect is fixed, and followed: so many values popped, one
 * result pushed or none, the result not known (`src/engine/dsa/ops/stack.ts`). `&DUP` and
 * `&SWAP` move what they hold, and are followed apart.
 */
const STACK_EFFECTS: ReadonlyMap<number, readonly [pops: number, pushes: number]> = new Map<number, readonly [number, number]>([
  [StkOp.PLUS, [2, 1]], [StkOp.GEAR, [2, 1]], [StkOp.EQUAL, [2, 1]], [StkOp.NOT_EQUAL, [2, 1]],
  [StkOp.AND, [2, 1]], [StkOp.XOR, [2, 1]], [StkOp.OR, [2, 1]], [StkOp.SHIFT, [2, 1]], [StkOp.RSHIFT, [2, 1]],
  [StkOp.LESS, [2, 1]], [StkOp.ULESS, [2, 1]], [StkOp.SLASH, [2, 1]], [StkOp.PERCENT, [2, 1]],
  [StkOp.ONE_PLUS, [1, 1]], [StkOp.ONE_MINUS, [1, 1]], [StkOp.NEG, [1, 1]], [StkOp.COMP, [1, 1]],
  [StkOp.NOT, [1, 1]], [StkOp.RANDOM, [1, 1]], [StkOp.BIT_COUNT, [1, 1]], [StkOp.FETCH, [1, 1]],
  [StkOp.STORE, [2, 0]], [StkOp.DROP, [1, 0]], [StkOp.TWO_DROP, [2, 0]],
]);

/** The stack as followed: the values known on top, over what is not. */
class Stack {
  private values: (DsaValue | null)[] = [];
  push(v: DsaValue | null): void { this.values.push(v); }
  pop(): DsaValue | null { return this.values.pop() ?? null; }
  /** The value `index` from the top, without popping it. */
  peek(index: number): DsaValue | null { return this.values[this.values.length - 1 - index] ?? null; }
  drop(n: number): void { for (let i = 0; i < n; i++) this.values.pop(); }
  forget(): void { this.values = []; }
}

/** What `programs` read as locations: every program of a DSA, all its states and columns. */
export function dsaTargets(programs: readonly Uint16Array[]): DsaTargets {
  const uses: DsaTargetUse[] = [];
  const stored = new Set<number>();
  let computed = false;
  let storesAnyParameter = false;
  const use = (words: string, from: DsaValue | null): void => {
    if (!from) computed = true;
    else if (from.kind !== 'self') uses.push({ words, from });
  };
  for (const program of programs) {
    const stack = new Stack();
    /** `GetTarget`'s value for a target type, reading its words at `at`; the next word after. */
    const target = (type: number, at: number, thirtyTwo: boolean): [DsaValue | null, number] => {
      switch (type) {
        case 0: return [{ kind: 'parameter', where: 0 }, at];
        case 1: return [{ kind: 'parameter', where: 1 }, at];
        case 2: {
          const lo = program[at] ?? 0;
          return thirtyTwo ? [{ kind: 'constant', value: (((program[at + 1] ?? 0) << 16) | lo) >>> 0 }, at + 2] : [{ kind: 'constant', value: lo }, at + 1];
        }
        default: return [stack.pop(), at];
      }
    };
    walkProgram(program, (name, word, at) => {
      switch (name) {
        case 'MESSAGE': case 'MESSAGE32': case 'DESSAGE32': {
          const words = MESSAGE_WORDS[(word >> 6) & 3];
          const delayWord = ((word >> 8) & 3) === 3 ? 1 : 0;
          const [from] = target((word >> 10) & 3, at + delayWord, name !== 'MESSAGE');
          if (words) use(words, from);
          return;
        }
        case 'COPYTELEPORTER': case 'COPYTELEPORTER32': {
          const thirtyTwo = name === 'COPYTELEPORTER32';
          const [src, next] = target((word >> 6) & 3, at, thirtyTwo);
          const [dst] = target((word >> 8) & 3, next, thirtyTwo);
          use('Copies the teleporter of', src);
          use('Copies a teleporter to', dst);
          return;
        }
        case 'LOAD': {
          const where = (word >> 6) & 0x1f;
          if (where === 26 || where === 27) stack.push({ kind: 'constant', value: program[at] ?? 0 });
          else if (where === 30) stack.push({ kind: 'constant', value: (((program[at + 1] ?? 0) << 16) | (program[at] ?? 0)) >>> 0 });
          else if (where <= 25) stack.push({ kind: 'parameter', where });
          else if (where === 28) stack.push({ kind: 'self' });
          return;
        }
        case 'STORE': {
          const where = (word >> 6) & 0x1f;
          if (where <= 25) {
            stored.add(where);
            stack.pop();
          }
          return;
        }
        case 'FETCH': {
          use('Reads the objects of', stack.peek(2));
          stack.drop(4);
          stack.push(null);
          return;
        }
        case 'EQUAL': stack.drop(2); stack.push(null); return;
        case 'VARIABLEFETCH': case 'GLOBALFETCH': stack.push(null); return;
        case 'VARIABLESTORE': case 'GLOBALSTORE': stack.pop(); return;
        case 'NOOP': case 'OVERRIDE': return;
        case 'AMPERSAND': case 'AMPERSAND2': {
          const op = ((word >> 6) & 0x7f) + (name === 'AMPERSAND2' ? 128 : 0);
          if (op === StkOp.PARAM_STORE) storesAnyParameter = true;
          const operands = LOCATION_OPERANDS.get(op);
          if (operands) {
            for (const o of operands) {
              const from = stack.peek(o.index);
              if (o.typeIndex !== undefined) {
                const type = stack.peek(o.typeIndex);
                if (type?.kind !== 'constant') computed = true;
                else if (type.value === 1) use(o.words, from);
              } else if (o.nonNegative && from?.kind === 'constant' && (from.value | 0) < 0) {
                continue;
              } else {
                use(o.words, from);
              }
            }
            stack.forget();
            return;
          }
          if (op === StkOp.DUP) {
            const v = stack.pop();
            stack.push(v);
            stack.push(v);
            return;
          }
          if (op === StkOp.SWAP) {
            const a = stack.pop();
            const b = stack.pop();
            stack.push(a);
            stack.push(b);
            return;
          }
          const effect = STACK_EFFECTS.get(op);
          if (!effect) { stack.forget(); return; }
          stack.drop(effect[0]);
          for (let i = 0; i < effect[1]; i++) stack.push(null);
          return;
        }
        default:
          // QUESTION, CASE, JUMP, GOSUB: the program leaves its line.
          stack.forget();
      }
    });
  }
  return { uses, computed, stored, storesAnyParameter };
}
