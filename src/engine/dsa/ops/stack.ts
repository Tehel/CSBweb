import { StkOp, DsaVarType } from '../DsaTypes';
import type { DsaBank } from '../DsaMachine';
import type { DsaOperation } from '../DsaOperations';

/** `bitCounts` (`doc/CSBwin-src/DSA.cpp:46`): the set bits of a nibble. */
export const BIT_COUNTS = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];

/**
 * `&VSET` (`doc/CSBwin-src/DSA.cpp:4851-4898`): `n` variables from `dst` set to `-src`
 * for a negative `src`, to `src - 100` past 99, and otherwise copied from the variables
 * at `src`, their states with them. `n` and `dst` are unsigned, `src` signed. A count
 * whose sum with `dst` or `src` wraps past 2^32 runs CSBWin past its 100 variables; the
 * port stops at the last (`DEBT.md` H, "An index CSBWin does not bound reads nobody").
 */
function vset(bank: DsaBank): void {
  let n = bank.stack.pop() >>> 0;
  const dst = bank.stack.pop() >>> 0;
  const src = bank.stack.pop() | 0;
  if (dst > 99) return;
  if (dst + n > 100) n = 100 - dst;
  const { values, definedFlags } = bank.vars;
  if (src < 0 || src > 99) {
    const value = src < 0 ? -src : src - 100;
    for (let i = 0; i < n && dst + i < 100; i++) values[dst + i] = value;
    definedFlags.fill(DsaVarType.WellDefined, dst, Math.min(100, dst + n));
  } else {
    if (src + n > 100) n = 100 - src;
    values.copyWithin(dst, src, Math.min(100, src + n));
    definedFlags.copyWithin(dst, src, Math.min(100, src + n));
  }
}

/**
 * The stack, its arithmetic and the run's variables: `EX_AMPERSAND`'s cases
 * (`doc/CSBwin-src/DSA.cpp:2395-2733`, `&BITCOUNT` at `:4833` and `&VSET` at `:4851`),
 * in the order the port's switch had them.
 */
export const stackOperations: ReadonlyMap<StkOp, DsaOperation> = new Map<StkOp, DsaOperation>([
  [StkOp.TWO_DROP, (bank) => {
    bank.stack.pop();
    bank.stack.pop();
  }],
  [StkOp.ONE_PLUS, (bank) => {
    bank.stack.push(bank.stack.pop() + 1);
  }],
  [StkOp.SWAP, (bank) => {
    bank.stack.roll(1);
  }],
  [StkOp.NEG, (bank) => {
    bank.stack.push(-bank.stack.pop());
  }],
  [StkOp.COMP, (bank) => {
    bank.stack.push(~bank.stack.pop());
  }],
  [StkOp.DUP, (bank) => {
    const v = bank.stack.pop();
    bank.stack.push(v);
    bank.stack.push(v);
  }],
  [StkOp.FETCH, (bank) => {
    const idx = bank.stack.pop();
    bank.stack.push(bank.getVar(idx));
  }],
  [StkOp.STORE, (bank) => {
    const idx = bank.stack.pop();
    bank.setVar(idx, bank.stack.pop());
  }],
  [StkOp.DROP, (bank) => {
    bank.stack.pop();
  }],
  [StkOp.PLUS, (bank) => {
    bank.stack.push(bank.stack.pop() + bank.stack.pop());
  }],
  [StkOp.GEAR, (bank) => {
    // An `i32` product, which wraps (`DSA.cpp:2534-2540`).
    bank.stack.push(Math.imul(bank.stack.pop(), bank.stack.pop()));
  }],
  [StkOp.ONE_MINUS, (bank) => {
    bank.stack.push(bank.stack.pop() - 1);
  }],
  [StkOp.ROLL, (bank) => {
    bank.stack.roll(bank.stack.pop());
  }],
  [StkOp.ROT, (bank) => {
    bank.stack.roll(2);
  }],
  [StkOp.MINUS_ROLL, (bank) => {
    bank.stack.minusRoll(bank.stack.pop());
  }],
  [StkOp.MINUS_ROT, (bank) => {
    bank.stack.minusRoll(2);
  }],
  [StkOp.PICK, (bank) => {
    bank.stack.pick(bank.stack.pop());
  }],
  [StkOp.TWO_PICK, (bank) => {
    bank.stack.pick(2);
  }],
  [StkOp.OVER, (bank) => {
    bank.stack.pick(1);
  }],
  [StkOp.POKE, (bank) => {
    bank.stack.poke(bank.stack.pop());
  }],
  [StkOp.EQUAL, (bank) => {
    bank.stack.push(bank.stack.pop() === bank.stack.pop() ? 1 : 0);
  }],
  [StkOp.NOT_EQUAL, (bank) => {
    bank.stack.push(bank.stack.pop() === bank.stack.pop() ? 0 : 1);
  }],
  [StkOp.NOT, (bank) => {
    bank.stack.push(bank.stack.pop() === 0 ? 1 : 0);
  }],
  [StkOp.AND, (bank) => {
    bank.stack.push(bank.stack.pop() & bank.stack.pop());
  }],
  [StkOp.XOR, (bank) => {
    bank.stack.push(bank.stack.pop() ^ bank.stack.pop());
  }],
  [StkOp.OR, (bank) => {
    bank.stack.push(bank.stack.pop() | bank.stack.pop());
  }],
  [StkOp.SHIFT, (bank) => {
    const v = bank.stack.pop();
    const w = bank.stack.pop();
    bank.stack.push(v >= 0 ? (w << (v & 31)) : (w >> ((-v) & 31)));
  }],
  [StkOp.RSHIFT, (bank) => {
    const v = bank.stack.pop();
    const w = bank.stack.pop();
    bank.stack.push(v >= 0 ? (w >> (v & 31)) : (w << ((-v) & 31)));
  }],
  [StkOp.LESS, (bank) => {
    const v = bank.stack.pop();
    const w = bank.stack.pop();
    bank.stack.push(w < v ? 1 : 0);
  }],
  [StkOp.ULESS, (bank) => {
    const v = bank.stack.pop() >>> 0;
    const w = bank.stack.pop() >>> 0;
    bank.stack.push(w < v ? 1 : 0);
  }],
  [StkOp.SLASH, (bank) => {
    const v = bank.stack.pop();
    const w = bank.stack.pop();
    bank.stack.push(v === 0 ? 0 : Math.trunc(w / v));
  }],
  [StkOp.PERCENT, (bank) => {
    const v = bank.stack.pop();
    const w = bank.stack.pop();
    bank.stack.push(v === 0 ? 0 : w % v);
  }],
  [StkOp.RANDOM, (bank, _exPkt, { ctx }) => {
    let v = bank.stack.pop() >>> 0;
    if (v === 0) v = 1;
    // `(ui32)STRandom() % V` with `ui32 V` (doc/CSBwin-src/DSA.cpp:2721-2733) — the
    // full 24-bit draw modulo V, unsigned, *not* `STRandom(V)`, which masks to 16 bits.
    const result = (ctx.random.next() >>> 0) % v;
    bank.stack.push(result | 0);
  }],
  [StkOp.BIT_COUNT, (bank) => {
    // `doc/CSBwin-src/DSA.cpp:4833-4850`.
    const v = bank.stack.pop() >>> 0;
    let count = 0;
    for (let shift = 0; shift < 32; shift += 4) count += BIT_COUNTS[(v >>> shift) & 0x0f]!;
    bank.stack.push(count);
  }],
  [StkOp.VSET, vset],
]);
