import { OBJECT_ID_NULL, type ObjectID } from '../../../core/types';
import { readU32LE, writeU32LE } from '../../../core/bytes';
import { getChampionPossession } from '../../../core/charDesc';
import { sw } from '../../../core/intCast';
import { vacantPossession } from '../../../data/CsbwinCharacters';
import { attributeCurrent, attributeMaximum, attributeMinimum, setAttributeCurrent, setAttributeMaximum, setAttributeMinimum } from '../../attributes';
import type { Champion, PartyState } from '../../gameTypes';
import { isAlive, masteryOf } from '../../rules';
import { addToSkill } from '../../skills';
import { swapCharacter } from '../../SwapCharacter';
import { getFromWings, locateInWings, saveToWings, wingsChampion } from '../../Wings';
import { StkOp } from '../DsaTypes';
import type { DsaBank } from '../DsaMachine';
import type { DsaOperation, DsaOperationMachine } from '../DsaOperations';
import { BIT_COUNTS } from './stack';

/** `talents`' offset in a `CHARDESC`, a longword `swapCharacter` leaves little-endian. */
const CHARDESC_TALENTS = 276;

/** `LIMIT(min, x, max)` (`doc/CSBwin-src/CSB.h:3168`): `max` is tested first. */
function limit(min: number, x: number, max: number): number {
  return x > max ? max : x < min ? min : x;
}

function getChampion(party: PartyState, index: number): Champion | null {
  if (index < 0 || index >= party.champions.length) return null;
  return party.champions[index] ?? null;
}

/**
 * `STKOP_CharStore` (`doc/CSBwin-src/DSA.cpp:4427-4542`): the variables from `index` on
 * written back over the fields `&CHAR@` reads, but for those CSBWin leaves alone.
 * `CHARFLAG_statsChanged` and `DrawCharacterState` have no counterpart: the panels are
 * redrawn every frame.
 */
function charStore(machine: DsaOperationMachine, bank: DsaBank): void {
  const party = machine.ctx.party.state;
  const num = bank.stack.pop() >>> 0;
  const index = bank.stack.pop() >>> 0;
  let charIdx = bank.stack.pop();
  if (charIdx === 4) charIdx = party.cursorOwner;
  bank.noFilter();
  if (((index + num) >>> 0) > 100) return;
  if (charIdx >= party.champions.length) return;
  if (charIdx < 0) return;
  if (party.potentialChampionIndex === charIdx) return;
  const pc = party.champions[charIdx]!;
  let n = Math.min(59, num);
  if (n > 100 - index) n = 100 - index;
  if (n > 1) pc.food = sw(limit(-1023, bank.getVar(1 + index), 2048));
  const pending = party.pendingDamage[charIdx] ?? 0;
  // "Nothing we can do about dead heroes!"
  if (pc.attributes.health - pending > 0 && n > 2) {
    if (bank.getVar(2 + index) < 0) bank.setVar(2 + index, 0);
    if (bank.getVar(2 + index) > pc.attributes.maxHealth) bank.setVar(2 + index, pc.attributes.maxHealth);
    if (bank.getVar(2 + index) < pc.attributes.health - pending) {
      party.pendingDamage[charIdx] = sw((pc.attributes.health - bank.getVar(2 + index)) & 0xffff);
    } else {
      pc.attributes.health = sw(bank.getVar(2 + index) + pending);
    }
  }
  if (n > 4) pc.attributes.mana = sw(limit(0, bank.getVar(4 + index), pc.attributes.maxMana));
  if (n > 8) pc.attributes.stamina = sw(limit(0, bank.getVar(8 + index), pc.attributes.maxStamina));
  if (n > 9) pc.water = sw(limit(-1023, bank.getVar(9 + index), 2048));
  for (let i = 0; i < 7; i++) {
    if (n <= i + 10) break;
    const value = bank.getVar(10 + index + i);
    const attr = pc.attributes.stats[i]!;
    setAttributeMinimum(attr, value >> 16);
    setAttributeMaximum(attr, (value >> 8) & 0xff);
    setAttributeCurrent(attr, value & 0xff);
  }
  if (n > 58) pc.talents = bank.getVar(index + 58) >>> 0;
}

/**
 * The champions and the party: `EX_AMPERSAND`'s cases (`doc/CSBwin-src/DSA.cpp:3331`,
 * `&MASTERY` at `:3390`, `:4128-4558`, and `&COUNTINJURY` at `:4799`), in the order the
 * port's switch had them.
 */
export const characterOperations: ReadonlyMap<StkOp, DsaOperation> = new Map<StkOp, DsaOperation>([
  [StkOp.CH_POSS, (bank, _exPkt, machine) => {
    // `doc/CSBwin-src/DSA.cpp:3331-3358`.
    const party = machine.ctx.party.state;
    let possIndex = bank.stack.pop() >>> 0;
    let chIndex = bank.stack.pop();
    if (chIndex > 4) chIndex = 0;
    if (chIndex === 4) chIndex = party.cursorOwner;
    if (possIndex > 29) possIndex = 0;
    let object: ObjectID;
    if (chIndex >= 0) {
      // A slot past `d.NumCharacter` is read all the same, from the record left there.
      const champ = getChampion(party, chIndex);
      object = champ ? getChampionPossession(champ, possIndex)
        : vacantPossession(party.vacantCharacters[chIndex]!, possIndex);
    } else {
      object = party.objectInHand;
    }
    bank.stack.push(object === OBJECT_ID_NULL ? -1 : object);
  }],
  [StkOp.MASTERY, (bank, _exPkt, machine) => {
    // `DSA.cpp:3390-3411`. The indices are `ui32`, so a negative one is out of range.
    const party = machine.ctx.party.state;
    const flags = bank.stack.pop();
    let skillIndex = bank.stack.pop() >>> 0;
    let chIndex = bank.stack.pop() >>> 0;
    if (chIndex === 4) chIndex = party.cursorOwner >>> 0;
    const champ = chIndex < party.champions.length ? party.champions[chIndex] : undefined;
    if (!champ || skillIndex >= 20) {
      bank.stack.push(0);
      return;
    }
    if (flags & 1) skillIndex |= 0x4000;
    if (flags & 2) skillIndex |= 0x8000;
    bank.stack.push(masteryOf(machine.ctx, champ, skillIndex));
  }],
  [StkOp.PARTY_FETCH, (bank, _exPkt, machine) => {
    // `DSA.cpp:4128-4166`.
    const party = machine.ctx.party.state;
    const num = bank.stack.pop() >>> 0;
    const index = bank.stack.pop() >>> 0;
    if (((index + num) >>> 0) > 100) return;
    const result = [
      party.champions.length,
      party.position.z,
      party.position.x,
      party.position.y,
      party.facing,
      party.sleeping ? 1 : 0,
      party.seeThruWalls,
      party.magicFootprintsActive,
      party.cursorOwner,
      party.invisible,
      party.fireShield,
      party.spellShield,
    ];
    const n = Math.min(result.length, num);
    for (let i = 0; i < n; i++) bank.setVar(index + i, result[i]!);
  }],
  [StkOp.CHAR_FETCH, (bank, _exPkt, machine) => {
    // `DSA.cpp:4167-4242`.
    const { ctx } = machine;
    const party = ctx.party.state;
    const num = bank.stack.pop() >>> 0;
    const index = bank.stack.pop() >>> 0;
    let charIdx = bank.stack.pop();
    if (charIdx === 4) charIdx = party.cursorOwner;
    const result = new Array<number>(59).fill(0);
    if (((index + num) >>> 0) > 100 || (charIdx < 0x10000 && charIdx >= party.champions.length) || charIdx < 0) {
      // `memset(result, 0, …)`.
    } else {
      // Bit 16 is a fingerprint in the wings (`GetFromWings`, testing only), where
      // nobody leaves the record `memset` to zero. An index of 0x20000 or more
      // without bit 16 reads nobody, as does `d.PendingDamage[charIdx]` past its
      // four (`DEBT.md` H).
      const inWings = (charIdx & 0x10000) !== 0;
      const character = inWings ? getFromWings(ctx.dungeon, charIdx & 0xffff, true) : null;
      const pc = inWings ? character && wingsChampion(character) : getChampion(party, charIdx);
      if (pc) {
        result[0] = pc.facing;
        result[1] = pc.food;
        result[2] = Math.max(pc.attributes.health - (inWings ? 0 : party.pendingDamage[charIdx] ?? 0), 0);
        // `pc->load`, which the port sums from a party champion's possessions
        // (`DEBT.md` H), and the record holds for one in the wings.
        result[3] = inWings ? pc.load : ctx.systems.characterStats.characterLoad(pc);
        result[4] = pc.attributes.mana;
        result[5] = pc.wounds;
        result[6] = pc.partyPosition;
        result[7] = pc.shieldStrength;
        result[8] = pc.attributes.stamina;
        result[9] = pc.water;
        for (let i = 0; i < 7; i++) {
          const attr = pc.attributes.stats[i]!;
          result[10 + i] = (attributeMinimum(attr) << 16) | (attributeMaximum(attr) << 8) | attributeCurrent(attr);
        }
        for (let i = 0; i < 40; i += 2) {
          const skill = pc.skills[i / 2];
          result[17 + i] = skill?.tempAdjust ?? 0;
          result[17 + i + 1] = skill?.experience ?? 0;
        }
        result[57] = pc.fingerprint;
        result[58] = pc.talents;
      }
    }
    const n = Math.min(59, num);
    for (let i = 0; i < n; i++) {
      if (index + i > 99) break;
      bank.setVar(index + i, result[i]!);
    }
  }],
  [StkOp.TALENTS_FETCH, (bank, _exPkt, machine) => {
    // `DSA.cpp:4243-4291`. Bit 16 is a fingerprint in the wings.
    const { ctx } = machine;
    const party = ctx.party.state;
    let charIdx = bank.stack.pop();
    if (charIdx === 4) charIdx = party.cursorOwner;
    if (charIdx >= 0 && charIdx & 0x10000) {
      const character = getFromWings(ctx.dungeon, charIdx & 0xffff, true);
      bank.stack.push(character ? readU32LE(character, CHARDESC_TALENTS) : 0);
      return;
    }
    const pc = getChampion(party, charIdx);
    bank.stack.push(pc ? pc.talents : 0);
  }],
  [StkOp.TALENTS_STORE, (bank, _exPkt, machine) => {
    // `DSA.cpp:4292-4348`. Bit 16 is a fingerprint in the wings, whose copy is saved
    // back when the talents change.
    const { ctx } = machine;
    const party = ctx.party.state;
    let charIdx = bank.stack.pop();
    const newTalents = bank.stack.pop() >>> 0;
    if (charIdx === 4) charIdx = party.cursorOwner;
    if (charIdx >= 0 && charIdx & 0x10000) {
      const character = getFromWings(ctx.dungeon, charIdx & 0xffff, true);
      if (character && readU32LE(character, CHARDESC_TALENTS) !== newTalents) {
        writeU32LE(character, CHARDESC_TALENTS, newTalents);
        saveToWings(ctx.dungeon, character);
      }
      return;
    }
    const pc = getChampion(party, charIdx);
    if (pc) pc.talents = newTalents;
  }],
  [StkOp.CAUSE_POISON, (bank, _exPkt, machine) => {
    // `DSA.cpp:4349-4363`.
    const charIdx = bank.stack.pop();
    const val = bank.stack.pop();
    bank.noFilter();
    if (charIdx >= machine.ctx.party.state.champions.length) return;
    if (charIdx < 0) return;
    machine.ctx.systems.championDamage.poisonCharacter(charIdx, val);
  }],
  [StkOp.WHO_HAS_TALENT, (bank, _exPkt, machine) => {
    // `DSA.cpp:4364-4383`.
    const talents = bank.stack.pop() >>> 0;
    let val = 0;
    machine.ctx.party.state.champions.forEach((champ, charIdx) => {
      if (((champ.talents & talents) >>> 0) === talents) val |= 1 << charIdx;
    });
    bank.stack.push(val);
  }],
  [StkOp.WHERE_IS_CHAR, (bank, _exPkt, machine) => {
    // `DSA.cpp:4384-4413`: the last champion with the fingerprint, else 5 when the
    // wings hold its first record, else 4.
    const fingerPrint = bank.stack.pop();
    let val = 4;
    machine.ctx.party.state.champions.forEach((champ, charIdx) => {
      if (champ.fingerprint === fingerPrint) val = charIdx;
    });
    if (val === 4 && locateInWings(machine.ctx.dungeon, fingerPrint) !== null) val = 5;
    bank.stack.push(val);
  }],
  [StkOp.SWAP_CHARACTER, (bank, _exPkt, machine) => {
    // `DSA.cpp:4414-4426`.
    bank.noFilter();
    const fingerPrint = bank.stack.pop();
    const index = bank.stack.pop();
    bank.stack.push(swapCharacter(machine.ctx, index, fingerPrint));
  }],
  [StkOp.CHAR_STORE, (bank, _exPkt, machine) => {
    charStore(machine, bank);
  }],
  [StkOp.EXPERIENCE_PLUS, (bank, _exPkt, machine) => {
    // `DSA.cpp:4543-4558`. A negative index reads nobody (`DEBT.md` H).
    const experience = bank.stack.pop();
    const skillnum = bank.stack.pop();
    const charnum = bank.stack.pop();
    const champ = getChampion(machine.ctx.party.state, charnum);
    if (champ && isAlive(champ)) addToSkill(machine.ctx, charnum, skillnum, experience);
  }],
  [StkOp.COUNT_INJURY, (bank, _exPkt, machine) => {
    // `DSA.cpp:4799-4819`.
    const injuryMask = bank.stack.pop();
    let chMask = bank.stack.pop();
    let count = 0;
    const champions = machine.ctx.party.state.champions;
    for (let chidx = 0; chidx < champions.length; chidx++, chMask >>= 1) {
      if ((chMask & 1) === 0) continue;
      if (!isAlive(champions[chidx]!)) continue;
      const injuries = champions[chidx]!.wounds & injuryMask;
      count += BIT_COUNTS[injuries & 15]! + BIT_COUNTS[(injuries >> 4) & 15]!
        + BIT_COUNTS[(injuries >> 8) & 15]! + BIT_COUNTS[(injuries >> 12) & 15]!;
    }
    bank.stack.push(count);
  }],
]);
