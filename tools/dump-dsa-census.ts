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
 * 3. **The census** (`dsaCensus`, `src/engine/DungeonCensus.ts`, which the form that
 *    adds a set shows): every program of the dungeon decodes to its exact length with
 *    CSBWin's operand layout. The default dungeon is Conflux 3.5's.
 *
 * Run: `npm test -- --only=dump-dsa-census.ts [dungeon.dat]`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DungeonLoader } from '../src/data/DungeonLoader';
import { StkOp } from '../src/engine/dsa/DsaTypes';
import { dsaCensus, NOT_OPERATIONS } from '../src/engine/DungeonCensus';
import { check, finish } from './lib/check';

const CONFLUX = 'tools/fixtures/gamefiles/conflux-3.5-b8/dungeon.dat';

/** What the port lacks, in `STKOP` order: nothing. */
const LEFT: readonly string[] = [];

/** The `case StkOp.…` labels of `executeAmpersand`, the port's operations. */
function portedOperations(): Set<number> {
  const source = readFileSync(resolve('src/engine/DsaSystem.ts'), 'utf8');
  const start = source.indexOf('\n  executeAmpersand(');
  const end = source.indexOf('\n  private ', start + 1);
  const ported = new Set<number>();
  for (const [, name] of source.slice(start, end).matchAll(/case StkOp\.(\w+):/g)) {
    const value = StkOp[name as keyof typeof StkOp];
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

  const { dsas, programs, undecoded, commands, operations } = dsaCensus(data);

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
