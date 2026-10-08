/**
 * The census of DSA operations: which of CSBWin's `&` operations the port lacks, and how
 * often a dungeon's programs call each one.
 *
 * 1. **CSBWin's list.** `StkOp` (`src/engine/DsaSystem.ts`) is `STKOP`
 *    (`doc/CSBwin-src/Data.h:1736-1876`), 138 values: 0 to 126 and 129 to 139.
 *    `EX_AMPERSAND`'s switch (`doc/CSBwin-src/DSA.cpp:2393-4983`) has a case for every one
 *    but four. `I_Indirect` is unpacked before the switch (`:2346-2392`), so it is an
 *    operation all the same. `Noop` (0), `2Dup` (23) and `I_FilteredCast` (120) have no
 *    case, and reach the default's "Illegal subcode in EX_AMPERSAND" (`:4980-4982`): they
 *    are not operations, and the port owes them nothing. `I_FilteredCast` is only a word
 *    of a parameter record that `I_Indirect` runs as `FilteredCast` (`:2359`), which no
 *    operation writes. That leaves 135.
 * 2. **The port's list** is the `case StkOp.…` labels of `executeAmpersand`. What it lacks
 *    is pinned below in `LEFT`, which is empty: the port has every operation, and an
 *    operation taken out fails here.
 * 3. **The census.** Every program of the dungeon decodes to its exact length with
 *    CSBWin's operand layout, read off `EX_*` (`DSA.cpp:575-1341`, `:1492-1516`,
 *    `:4987`) and the command words (`Data.h:1894-2399`). A field is a relative state
 *    unless `IsMaxState`, which compares it with `-MAXSTATE`: in every command but
 *    `QUESTION` that value is out of the field's signed range, so CSBWin never reads the
 *    extra word. The default dungeon is Conflux 3.5's.
 *
 * Run: `npx tsx tools/dump-dsa-census.ts [dungeon.dat]`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DungeonLoader } from '../src/data/DungeonLoader';
import { StkOp } from '../src/engine/DsaSystem';
import { check, finish } from './lib/check';

const CONFLUX = 'static/gamefiles/conflux-3.5-b8/dungeon.dat';

/** What the port lacks, in `STKOP` order: nothing. */
const LEFT: readonly string[] = [];

/** The `STKOP` values that are no `case` of `EX_AMPERSAND`'s switch, nor `I_Indirect` (point 1). */
const NOT_OPERATIONS = new Set<number>([StkOp.NOOP, StkOp.TWO_DUP, StkOp.I_FILTERED_CAST]);

/**
 * `DSACOMMAND` (`Data.h:1710`): each command's relative-state field and its `MAXSTATE`
 * (`Data.h:1904-2399`), and the operand words its `EX_*` reads after the command word.
 */
interface CommandLayout {
  name: string;
  stateShift: number;
  stateBits: number;
  maxState: number;
  operands(word: number, program: Uint16Array, pc: number): number;
}

/** `GetTarget` (`DSA.cpp:593-634`): `TARGET_ABS` reads one word, two when 32-bit. */
function targetWords(target: number, thirtyTwo: boolean): number {
  return target === 2 ? (thirtyTwo ? 2 : 1) : 0;
}

const message = (thirtyTwo: boolean) => (word: number): number =>
  (((word >> 8) & 3) === 3 ? 1 : 0) + targetWords((word >> 10) & 3, thirtyTwo);
const copyTeleporter = (thirtyTwo: boolean) => (word: number): number =>
  targetWords((word >> 6) & 3, thirtyTwo) + targetWords((word >> 8) & 3, thirtyTwo);
const rowColumn = (word: number): number =>
  (((word >> 6) & 0x3f) === 63 ? 1 : 0) + ((word >> 12) & 1);
const none = (): number => 0;

const COMMANDS: Record<number, CommandLayout> = {
  1: { name: 'MESSAGE', stateShift: 12, stateBits: 4, maxState: -8, operands: message(false) },
  2: {
    name: 'OVERRIDE', stateShift: 12, stateBits: 4, maxState: -8,
    operands: (word) => (((word >> 6) & 7) === 1 && ((word >> 9) & 7) === 7 ? 1 : 0),
  },
  3: { name: 'NOOP', stateShift: 6, stateBits: 10, maxState: -512, operands: none },
  4: { name: 'COPYTELEPORTER', stateShift: 10, stateBits: 6, maxState: -32, operands: copyTeleporter(false) },
  5: { name: 'GOSUB', stateShift: 13, stateBits: 3, maxState: -4, operands: rowColumn },
  6: {
    name: 'LOAD', stateShift: 11, stateBits: 5, maxState: -16,
    // LOAD_INTEGER 26 and LOAD_ABS 27 read a word, LOAD_INTEGER32 30 two (`DSA.cpp:1100-1137`).
    operands: (word) => {
      const where = (word >> 6) & 0x1f;
      return where === 26 || where === 27 ? 1 : where === 30 ? 2 : 0;
    },
  },
  7: { name: 'FETCH', stateShift: 6, stateBits: 10, maxState: -512, operands: none },
  8: { name: 'EQUAL', stateShift: 6, stateBits: 10, maxState: -512, operands: none },
  9: {
    name: 'QUESTION', stateShift: 6, stateBits: 4, maxState: 2,
    // Both branches' words are stepped over whichever is taken (`DSA.cpp:869-928`).
    operands: (word) => (((word >> 11) & 3) !== 0 ? 1 : 0) + ((word >> 10) & 1)
      + (((word >> 14) & 3) !== 0 ? 1 : 0) + ((word >> 13) & 1),
  },
  11: { name: 'AMPERSAND', stateShift: 13, stateBits: 3, maxState: -4, operands: none },
  12: { name: 'JUMP', stateShift: 13, stateBits: 3, maxState: -4, operands: rowColumn },
  13: { name: 'STORE', stateShift: 11, stateBits: 5, maxState: -16, operands: none },
  14: { name: 'COPYTELEPORTER32', stateShift: 10, stateBits: 6, maxState: -32, operands: copyTeleporter(true) },
  15: { name: 'MESSAGE32', stateShift: 12, stateBits: 4, maxState: -8, operands: message(true) },
  // `numCase`, then four words a case (`DSA.cpp:1003-1033`).
  16: { name: 'CASE', stateShift: 6, stateBits: 10, maxState: -512, operands: (_w, p, pc) => 1 + 4 * (p[pc] ?? 0) },
  17: { name: 'VARIABLEFETCH', stateShift: 13, stateBits: 3, maxState: -4, operands: none },
  18: { name: 'VARIABLESTORE', stateShift: 13, stateBits: 3, maxState: -4, operands: none },
  19: { name: 'GLOBALFETCH', stateShift: 13, stateBits: 3, maxState: -4, operands: none },
  20: { name: 'GLOBALSTORE', stateShift: 13, stateBits: 3, maxState: -4, operands: none },
  21: { name: 'AMPERSAND2', stateShift: 13, stateBits: 3, maxState: -4, operands: none },
  22: { name: 'DESSAGE32', stateShift: 12, stateBits: 4, maxState: -8, operands: message(true) },
};

function signedField(word: number, shift: number, bits: number): number {
  const sign = 1 << (bits - 1);
  const value = (word >> shift) & ((1 << bits) - 1);
  return (value & (sign - 1)) - (value & sign);
}

/** Decode one program: false when a word is no command or the operands overrun it. */
function decode(program: Uint16Array, commands: Map<string, number>, operations: Map<number, number>): boolean {
  let pc = 0;
  while (pc < program.length) {
    const word = program[pc++] ?? 0;
    const layout = COMMANDS[word & 0x3f];
    if (!layout) return false;
    commands.set(layout.name, (commands.get(layout.name) ?? 0) + 1);
    if (signedField(word, layout.stateShift, layout.stateBits) === -layout.maxState) pc++;
    if (layout.name === 'AMPERSAND' || layout.name === 'AMPERSAND2') {
      const subcode = ((word >> 6) & 0x7f) + (layout.name === 'AMPERSAND2' ? 128 : 0);
      operations.set(subcode, (operations.get(subcode) ?? 0) + 1);
    }
    pc += layout.operands(word, program, pc);
  }
  return pc === program.length;
}

/** The `case StkOp.…` labels of `executeAmpersand`, the port's operations. */
function portedOperations(): Set<number> {
  const source = readFileSync(resolve('src/engine/DsaSystem.ts'), 'utf8');
  const start = source.indexOf('private executeAmpersand(');
  const end = source.indexOf('\n  private ', start + 1);
  const ported = new Set<number>();
  for (const [, name] of source.slice(start, end).matchAll(/case StkOp\.(\w+):/g)) {
    const value = (StkOp as unknown as Record<string, number>)[name!];
    check(value !== undefined, `executeAmpersand names StkOp.${name}`);
    if (value !== undefined) ported.add(value);
  }
  return ported;
}

function main(): void {
  const path = process.argv[2] ?? CONFLUX;
  const data = new DungeonLoader().loadDungeonDat(new Uint8Array(readFileSync(resolve(path))));

  const all = Object.values(StkOp).filter((v): v is number => typeof v === 'number').sort((a, b) => a - b);
  const expected = [...Array(127).keys(), ...Array.from({ length: 11 }, (_, i) => 129 + i)];
  check(all.join() === expected.join(), 'StkOp is STKOP: 0 to 126 and 129 to 139');
  const owed = all.filter((op) => !NOT_OPERATIONS.has(op));
  check(owed.length === 135, `CSBWin has 135 operations (${owed.length})`);

  const ported = portedOperations();
  const missing = owed.filter((op) => !ported.has(op));
  check([...ported].every((op) => !NOT_OPERATIONS.has(op)), 'the port gives no case to Noop, 2Dup or I_FilteredCast');

  const commands = new Map<string, number>();
  const operations = new Map<number, number>();
  let dsas = 0;
  let programs = 0;
  let undecoded = 0;
  for (const dsa of data.dsaIndex?.entries ?? []) {
    if (!dsa) continue;
    dsas++;
    for (const state of dsa.states) {
      for (const action of state?.actions ?? []) {
        programs++;
        if (!decode(action.program, commands, operations)) undecoded++;
      }
    }
  }

  console.log(`${path}: ${dsas} DSAs, ${programs} programs, ${undecoded} that do not decode`);
  console.log(`commands: ${[...commands].sort((a, b) => b[1] - a[1]).map(([n, c]) => `${n} ${c}`).join(', ')}`);
  const used = [...operations.keys()].filter((op) => !NOT_OPERATIONS.has(op));
  console.log(`& operations: ${owed.length} in CSBWin, ${ported.size} ported, ${missing.length} left; `
    + `${used.length} used here, ${used.filter((op) => !ported.has(op)).length} of them left`);
  console.log('left (value, name, calls here):');
  for (const op of missing) {
    console.log(`  ${String(op).padStart(3)} ${StkOp[op]!.padEnd(30)} ${operations.get(op) ?? 0}`);
  }
  const illegal = [...operations].filter(([op]) => NOT_OPERATIONS.has(op) || StkOp[op] === undefined);
  if (illegal.length) console.log(`illegal subcodes called: ${illegal.map(([op, c]) => `${op} ×${c}`).join(', ')}`);

  check(undecoded === 0, 'every program decodes to its exact length with CSBWin\'s layout');
  check(missing.map((op) => StkOp[op]).join() === LEFT.join(),
    `the operations left are LEFT's: ${missing.map((op) => StkOp[op]).join(', ')}`);
  if (path === CONFLUX) {
    check(dsas === 131 && programs === 4646, 'Conflux has 131 DSAs and 4646 programs');
    check(used.length === 118, `Conflux calls 118 operations (${used.length})`);
    check(illegal.length === 0, 'Conflux calls no illegal subcode');
  }
  finish();
}

main();
