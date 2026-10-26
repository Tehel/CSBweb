import { OBJECT_ID_EOF, OBJECT_ID_NULL, locationRelFromInteger, type ObjectID } from '../../../core/types';
import { monsterDrawAsSize4, monsterInvisible, monsterPoisoned, monsterUnique } from '../../monsterTypes';
import { StkOp } from '../DsaTypes';
import type { DsaBank } from '../DsaMachine';
import type { DsaOperation, DsaOperationMachine } from '../DsaOperations';

/**
 * `STKOP_MonPoss` (`doc/CSBwin-src/DSA.cpp:3359-3389`): the slot of the group's
 * `possindex`th possession, counted from 0, or -1 past the last. When the slot popped is
 * no group, `object` keeps the default `RN`, `RNnul`, and its integer 0xffff is pushed.
 */
function monPoss(machine: DsaOperationMachine, bank: DsaBank): void {
  const dungeon = machine.ctx.dungeon;
  let possIndex = bank.stack.pop() >>> 0;
  const idx = bank.stack.pop();
  let object: ObjectID = OBJECT_ID_NULL;
  const monster = machine.isValidObjectId(idx) ? dungeon.getCreatureRecord(idx) : null;
  if (monster) {
    for (object = monster.possession; possIndex > 0 && object !== OBJECT_ID_EOF;
      object = dungeon.getDBRecordLink(object)) {
      possIndex--;
    }
  }
  bank.stack.push(object === OBJECT_ID_EOF ? -1 : object);
}

/**
 * `STKOP_MonsterFetch` (`doc/CSBwin-src/DSA.cpp:3993-4057`): up to `num` of eight words
 * about the group at a slot, into the variables from `index` on: how many it is, its
 * type, the four hit points, the flags (1 invisible, 2 drawn as size 4, 4 unique, 8
 * poisoned, each through its gated `DB4` accessor) and the alternate graphics. A slot
 * that is no group reads zeros, and -1 for the type.
 */
function monsterFetch(machine: DsaOperationMachine, bank: DsaBank): void {
  const rules = machine.ctx.rules;
  const num = bank.stack.pop() >>> 0;
  const index = bank.stack.pop() >>> 0;
  const id = bank.stack.pop();
  const result = new Int32Array(8);
  result[1] = -1;
  const monster = machine.isValidObjectId(id) ? machine.ctx.dungeon.getCreatureRecord(id) : null;
  if (monster) {
    result[0] = (monster.numMonM1 & 0x3) + 1;
    result[1] = monster.creatureType;
    for (let i = 0; i < 4; i++) result[2 + i] = monster.hp[i] ?? 0;
    if (monsterInvisible(rules, monster)) result[6]! |= 1;
    if (monsterDrawAsSize4(rules, monster)) result[6]! |= 2;
    if (monsterUnique(rules, monster)) result[6]! |= 4;
    if (monsterPoisoned(rules, monster)) result[6]! |= 8;
    result[7] = monster.alternateGraphics;
  }
  const n = Math.min(8, num);
  for (let i = 0; i < n; i++) bank.setVar(index + i, result[i]!);
}

/**
 * `STKOP_MonsterStore` (`doc/CSBwin-src/DSA.cpp:4076-4127`): the hit points, flags and
 * alternate graphics `&MONSTER@` reads, written back from the variables from `index`
 * on, as far as `num` reaches; the count and the type are not. The flags are written
 * whatever the design options. `num` is unsigned, so `num - 2` of 0 or 1 lets all four
 * hit points be written.
 */
function monsterStore(machine: DsaOperationMachine, bank: DsaBank): void {
  const num = bank.stack.pop() >>> 0;
  const index = bank.stack.pop() >>> 0;
  const id = bank.stack.pop();
  bank.noFilter();
  if (!machine.isValidObjectId(id)) return;
  const monster = machine.ctx.dungeon.getCreatureRecord(id);
  if (!monster) return; // "Not a Monster"
  for (let i = 0; i < 4 && i < ((num - 2) >>> 0); i++) monster.hp[i] = bank.getVar(index + i + 2) & 0xffff;
  if (num > 6) {
    const flags = bank.getVar(index + 6);
    monster.invisible = (flags & 1) !== 0;
    monster.drawAsSize4 = (flags & 2) !== 0;
    monster.unique = (flags & 4) !== 0;
    monster.poisoned = (flags & 8) !== 0;
  }
  if (num > 7) monster.alternateGraphics = bank.getVar(index + 7) & 7;
}

/**
 * `STKOP_MonLandD` (`doc/CSBwin-src/DSA.cpp:4769-4791`): in the monster move filter, the
 * group's location as `1024 * level + 32 * x + y` and its distance to the party less
 * one, from the filter's parameters, into variables `idx` and `idx + 1`. Outside that
 * filter it does nothing, not even pop.
 */
function monLandD(machine: DsaOperationMachine, bank: DsaBank): void {
  if (!machine.filters.monsterMoveFilterActive) return;
  const idx = bank.stack.pop() >>> 0;
  if (idx > 98) return;
  const p = machine.parameters();
  bank.setVar(idx, 1024 * p[1]! + 32 * p[2]! + p[3]!);
  const distance = Math.abs(p[2]! - p[6]!) + Math.abs(p[3]! - p[7]!);
  bank.setVar(idx + 1, distance - 1);
}

/**
 * The monsters: `EX_AMPERSAND`'s cases (`doc/CSBwin-src/DSA.cpp:2497-2512`, `:3359`,
 * `:3993-4127`, `:4626` and `:4769`), in the order the port's switch had them.
 */
export const monsterOperations: ReadonlyMap<StkOp, DsaOperation> = new Map<StkOp, DsaOperation>([
  [StkOp.DEL_MON, (bank, _exPkt, machine) => {
    // `doc/CSBwin-src/DSA.cpp:2497-2504`, `EX_DELMON` (`:1742-1749`).
    bank.noFilter();
    const indx = bank.stack.pop();
    const locr = locationRelFromInteger(bank.stack.pop());
    machine.ctx.systems.monsterDamage.deleteMonsterInGroup(locr, indx >>> 0);
  }],
  [StkOp.INS_MON, (bank, _exPkt, machine) => {
    // `DSA.cpp:2505-2512`, `EX_INSMON` (`:1751-1758`).
    bank.noFilter();
    const posMask = bank.stack.pop();
    const locr = locationRelFromInteger(bank.stack.pop());
    machine.ctx.systems.monsterDamage.insertMonsterInGroup(locr, posMask >>> 0);
  }],
  [StkOp.MON_POSS, (bank, _exPkt, machine) => {
    monPoss(machine, bank);
  }],
  [StkOp.MONSTER_FETCH, (bank, _exPkt, machine) => {
    monsterFetch(machine, bank);
  }],
  [StkOp.MONSTER_STORE, (bank, _exPkt, machine) => {
    monsterStore(machine, bank);
  }],
  [StkOp.MON_BLK, (bank, _exPkt, machine) => {
    // `DSA.cpp:4626-4639`.
    const flags = bank.stack.pop();
    const inhibit = machine.ctx.systems.monsterAI.monsterMoveInhibit;
    inhibit[0] = flags & 1;
    inhibit[1] = flags & 2;
    inhibit[2] = flags & 4;
    inhibit[3] = flags & 8;
  }],
  [StkOp.MON_LAND_D, (bank, _exPkt, machine) => {
    monLandD(machine, bank);
  }],
]);
