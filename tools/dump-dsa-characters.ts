/**
 * The DSA operations on the champions (the characters family), each run
 * through `DsaSystem.execute` as one program of a test DSA, against the party of a
 * genuine save (`csbgame7.dat`).
 *
 * 1. **`&PARTY@`** writes twelve of the party's globals to the variables
 *    (`doc/CSBwin-src/DSA.cpp:4128-4166`), and nothing when `index + num` passes 100.
 * 2. **`&CHAR@`** writes a champion's 59 fields (`:4167-4242`): HP less the pending
 *    damage, the attributes packed minimum, maximum, current, the skills in pairs.
 *    Champion 4 is the hand's owner; an index past the party, or a fingerprint nobody in
 *    the wings has, reads zeros (the wings are `dump-wings.ts`'s).
 * 3. **`&CHPOSS`** (`:3331-3358`): an empty slot is -1, a negative champion the hand, a
 *    slot past 29 slot 0. A champion slot past the party is read too: 0 on
 *    `csbgame-early-1hero.dat`, whose slots 1 to 3 are the zero bytes `DBank::Initialize`
 *    leaves, and a cancelled candidate's own possessions.
 * 4. **`&MASTERY`** (`:3390-3411`): flags 1 and 2 are `DetermineMastery`'s 0x4000 and
 *    0x8000; a champion or skill out of range is 0.
 * 5. **`&WHOHASTALENT`, `&WHEREISCHAR`, `&TALENTS@`, `&TALENTS!`** (`:4243-4413`): a
 *    fingerprint in the party is its index, one with a 25-longword `EDT_Character` record
 *    in `EXPOOL` 5, any other 4.
 * 6. **`&COUNTINJURY`** (`:4799-4819`) counts the wounds of the living champions the
 *    mask names.
 * 7. **`&ISCARRIED`** (`:1521-1642`): where a particular object is, a chest's contents
 *    searched, the hand as 255; how many of a basic type are carried.
 * 8. **`&CHAR!`** (`:4427-4542`) writes food, water, mana, stamina and the attributes
 *    clamped; an HP below the champion's is pending damage, one above it HP; a dead
 *    champion's HP and the potential champion are left alone.
 * 9. **`&EXPERIENCE+`** adds `(UI16)experience` (`Magic.cpp:412`), and nothing to a dead
 *    champion; **`&CAUSEPOISON`** is `PoisonCharacter` (`CSBCode.cpp:7270`).
 *
 * Run: `npm test -- --only=dump-dsa-characters.ts`
 */
import { readFileSync } from 'node:fs';

import { DBType, OBJECT_ID_EOF, OBJECT_ID_NULL, type ObjectID } from '../src/core/types';
import { Expool } from '../src/data/CsbwinExpool';
import { StkOp } from '../src/engine/dsa/DsaTypes';
import type { Game } from '../src/engine/Game';
import type { Champion } from '../src/engine/gameTypes';
import { attributeCurrent, attributeMaximum, attributeMinimum } from '../src/engine/attributes';
import { determineMastery } from '../src/engine/skills';
import { nameIndexOf } from '../src/engine/GameContext';
import { GetBasicObjectType } from '../src/engine/objectIndex';
import { TimerFunction } from '../src/engine/TimerQueue';
import { freshGame, globalStore, int, op, report, run, varFetch, varStore } from './lib/dsa';
import { savePath } from './lib/saves';
import { check, finish } from './lib/check';


const base = freshGame();
const party = base.ctx.party.state;
const champions = party.champions;
console.log(`csbgame7.dat: ${champions.length} champions (${champions.map((c) => c.name).join(', ')}), `
  + `hand owner ${party.cursorOwner}, hand ${party.objectInHand}`);
check(champions.length === 4, 'the save has four champions');

/* ---------------------------------------------- 1. &PARTY@ ---------------------- */
{
  const { g } = run([...int(0), ...int(12), op(StkOp.PARTY_FETCH), ...report(0, 12)]);
  const expected = [
    4, party.position.z, party.position.x, party.position.y, party.facing, party.sleeping ? 1 : 0,
    party.seeThruWalls, party.magicFootprintsActive, party.cursorOwner, party.invisible,
    party.fireShield, party.spellShield,
  ];
  console.log(`1a. &PARTY@ 0 12: ${g.slice(0, 12).join(' ')}`);
  check(g.slice(0, 12).join() === expected.join(), '&PARTY@ writes the twelve party globals');

  const over = run([...int(90), ...int(11), op(StkOp.PARTY_FETCH), ...report(90, 1)]);
  console.log(`1b. &PARTY@ 90 11: V90 = ${over.g[0]}`);
  check(over.g[0] === 0, 'index + num past 100 writes nothing');
}

/* ---------------------------------------------- 2. &CHAR@ ----------------------- */
function charFetchExpected(game: Game, chIdx: number): number[] {
  const pc: Champion = game.ctx.party.state.champions[chIdx]!;
  const r = [
    pc.facing, pc.food,
    Math.max(pc.attributes.health - (game.ctx.party.state.pendingDamage[chIdx] ?? 0), 0),
    game.systems.characterStats.characterLoad(pc), pc.attributes.mana, pc.wounds, pc.partyPosition,
    pc.shieldStrength, pc.attributes.stamina, pc.water,
  ];
  for (const a of pc.attributes.stats) r.push((attributeMinimum(a) << 16) | (attributeMaximum(a) << 8) | attributeCurrent(a));
  for (const s of pc.skills) r.push(s.tempAdjust, s.experience);
  r.push(pc.fingerprint, pc.talents);
  return r;
}
{
  const prepare = (game: Game): void => {
    game.ctx.party.state.pendingDamage[1] = 5;
    game.ctx.party.state.champions[1]!.talents = 0x80000003;
  };
  const a = run([...int(1), ...int(0), ...int(59), op(StkOp.CHAR_FETCH), ...report(0, 59)], prepare);
  const expected = charFetchExpected(a.game, 1);
  console.log(`2a. &CHAR@ 1 0 59: ${a.g.slice(0, 10).join(' ')} … ${a.g.slice(57, 59).join(' ')}`);
  check(expected.length === 59 && a.g.slice(0, 59).join() === expected.map((v) => v | 0).join(),
    '&CHAR@ writes the 59 fields, HP less the pending damage');

  const owner = party.cursorOwner;
  const h = run([...int(4), ...int(0), ...int(59), op(StkOp.CHAR_FETCH), ...report(0, 59)]);
  check(owner >= 0 && h.g.slice(0, 59).join() === charFetchExpected(h.game, owner).map((v) => v | 0).join(),
    `&CHAR@ of champion 4 is the hand's owner, champion ${owner}`);

  const tail = run([...int(0), ...int(95), ...int(59), op(StkOp.CHAR_FETCH), ...report(95, 5)]);
  check(tail.g.slice(0, 5).join() === '0,0,0,0,0', 'index + num past 100 writes no variable');

  for (const chIdx of [7, -2, 0x10000 | champions[0]!.fingerprint]) {
    const z = run([...int(chIdx), ...int(0), ...int(59), op(StkOp.CHAR_FETCH), ...report(0, 59)]);
    check(z.g.slice(0, 59).every((v) => v === 0), `&CHAR@ of 0x${(chIdx >>> 0).toString(16)} writes zeros`);
  }
}

/* ---------------------------------------------- 3. &CHPOSS ---------------------- */
{
  const slotOf = (c: Champion, full: boolean): number => c.possessions.findIndex((p) => (p !== OBJECT_ID_NULL) === full);
  const c0 = champions[0]!;
  const full = slotOf(c0, true);
  const empty = slotOf(c0, false);
  const { g } = run([
    ...int(0), ...int(full), op(StkOp.CH_POSS), globalStore(0),
    ...int(0), ...int(empty), op(StkOp.CH_POSS), globalStore(1),
    ...int(-3), ...int(0), op(StkOp.CH_POSS), globalStore(2),
    ...int(0), ...int(40), op(StkOp.CH_POSS), globalStore(3),
    ...int(9), ...int(full), op(StkOp.CH_POSS), globalStore(4),
  ]);
  console.log(`3. &CHPOSS 0 ${full}, 0 ${empty}, -3 0, 0 40, 9 ${full}: ${g.slice(0, 5).join(' ')}`);
  check(g[0] === c0.possessions[full], 'a full slot is its object');
  check(g[1] === -1, 'an empty slot is -1');
  check(g[2] === (party.objectInHand === OBJECT_ID_NULL ? -1 : party.objectInHand), 'a negative champion is the hand');
  check(g[3] === (c0.possessions[0] === OBJECT_ID_NULL ? -1 : c0.possessions[0]), 'a slot past 29 is slot 0');
  check(g[4] === g[0], 'a champion past 4 is champion 0');
}
{
  // `d.CH16482[chindex].Possession(possindex)` for any slot up to 3 (`DSA.cpp:3346-3348`).
  const oneHero = new Uint8Array(readFileSync(savePath('csbgame-early-1hero.dat')));
  const { g } = run([
    ...int(1), ...int(0), op(StkOp.CH_POSS), globalStore(0),
    ...int(3), ...int(29), op(StkOp.CH_POSS), globalStore(1),
  ], () => {}, oneHero);
  console.log(`3b. &CHPOSS 1 0, 3 29 on csbgame-early-1hero.dat: ${g.slice(0, 2).join(' ')}`);
  check(g[0] === 0 && g[1] === 0, 'a slot no champion has filled is zero bytes, so RN 0, not -1');

  const c3 = champions[3]!;
  const full = c3.possessions.findIndex((p) => p !== OBJECT_ID_NULL);
  const left = run([...int(3), ...int(full), op(StkOp.CH_POSS), globalStore(0)], (game) => {
    // What a Cancel leaves: the record in its slot, one fewer champion counted.
    const p = game.ctx.party.state;
    p.vacantCharacters[3] = p.champions.pop()!;
  });
  console.log(`3c. &CHPOSS 3 ${full} with champion 3 left behind: ${left.g[0]}`);
  check(left.g[0] === c3.possessions[full], "a slot a champion has left reads that champion's possessions");
}

/* ---------------------------------------------- 4. &MASTERY --------------------- */
{
  const { g, game } = run([
    ...int(2), ...int(3), ...int(0), op(StkOp.MASTERY), globalStore(0),
    ...int(2), ...int(3), ...int(3), op(StkOp.MASTERY), globalStore(1),
    ...int(9), ...int(3), ...int(0), op(StkOp.MASTERY), globalStore(2),
    ...int(2), ...int(20), ...int(0), op(StkOp.MASTERY), globalStore(3),
  ]);
  const c2 = game.ctx.party.state.champions[2]!;
  const names = { getObjectNameIndex: (rn: ObjectID) => nameIndexOf(game.ctx, rn) };
  console.log(`4. &MASTERY 2 3 0, 2 3 3, 9 3 0, 2 20 0: ${g.slice(0, 4).join(' ')}`);
  check(g[0] === determineMastery(c2, 3, names) && g[0]! > 1, 'flags 0 is DetermineMastery of the skill');
  check(g[1] === determineMastery(c2, 3 | 0xc000, names), 'flags 3 sets 0x4000 and 0x8000');
  check(g[2] === 0 && g[3] === 0, 'a champion or a skill out of range is 0');
}

/* ---------------------------------------------- 5. talents and fingerprints ----- */
{
  const wings = 0x7777;
  const prepare = (game: Game): void => {
    const cs = game.ctx.party.state.champions;
    cs[0]!.talents = 0x5;
    cs[1]!.talents = 0x4;
    cs[2]!.talents = 0xd;
    cs[3]!.talents = 0x80000000;
    new Expool(game.ctx.dungeon.getData()).write(((8 << 24) | wings) >>> 0, new Array<number>(25).fill(0));
  };
  const { g, game } = run([
    ...int(5), op(StkOp.WHO_HAS_TALENT), globalStore(0),
    ...int(0x80000000), op(StkOp.WHO_HAS_TALENT), globalStore(1),
    ...int(champions[2]!.fingerprint), op(StkOp.WHERE_IS_CHAR), globalStore(2),
    ...int(wings), op(StkOp.WHERE_IS_CHAR), globalStore(3),
    ...int(0x7778), op(StkOp.WHERE_IS_CHAR), globalStore(4),
    ...int(2), op(StkOp.TALENTS_FETCH), globalStore(5),
    ...int(0x10000 | wings), op(StkOp.TALENTS_FETCH), globalStore(6),
    ...int(0x1234), ...int(1), op(StkOp.TALENTS_STORE),
    ...int(1), op(StkOp.TALENTS_FETCH), globalStore(7),
  ], prepare);
  console.log(`5. WHOHASTALENT 5, 0x80000000; WHEREISCHAR c2, wings, other; TALENTS@ 2, wings; after TALENTS! 1: `
    + g.slice(0, 8).map((v) => (v >>> 0).toString(16)).join(' '));
  check(g[0] === 0b0101, '&WHOHASTALENT sets the bit of every champion with all the talents');
  check(g[1] === 0b1000, '&WHOHASTALENT compares the talents unsigned');
  check(g[2] === 2 && g[3] === 5 && g[4] === 4, '&WHEREISCHAR: the party index, 5 for the wings, else 4');
  check(g[5] === 0xd && g[6] === 0, '&TALENTS@ reads a champion, and nobody in the wings');
  check(g[7] === 0x1234 && game.ctx.party.state.champions[1]!.talents === 0x1234, '&TALENTS! writes them');
}

/* ---------------------------------------------- 6. &COUNTINJURY ----------------- */
{
  const prepare = (game: Game): void => {
    const cs = game.ctx.party.state.champions;
    cs[0]!.wounds = 0x3f;
    cs[1]!.wounds = 0x05;
    cs[2]!.wounds = 0x01;
    cs[2]!.attributes.health = 0;
    cs[3]!.wounds = 0x02;
  };
  const { g } = run([
    ...int(0b1111), ...int(0x07), op(StkOp.COUNT_INJURY), globalStore(0),
    ...int(0b1010), ...int(0xff), op(StkOp.COUNT_INJURY), globalStore(1),
  ], prepare);
  console.log(`6. &COUNTINJURY 0b1111 0x07, 0b1010 0xff: ${g[0]} ${g[1]}`);
  check(g[0] === 3 + 2 + 1, 'the masked wounds of the living champions the mask names');
  check(g[1] === 2 + 1, 'champions 1 and 3 only');
}

/* ---------------------------------------------- 7. &ISCARRIED ------------------- */
{
  const dungeon = base.ctx.dungeon;
  // A chest in a pack, and something in it.
  let chestAt: { ch: number; slot: number; inside: ObjectID } | null = null;
  champions.forEach((c, ch) => c.possessions.forEach((rn, slot) => {
    if (chestAt || rn === OBJECT_ID_NULL || dungeon.rnMaps.decode(rn).category !== DBType.CHEST) return;
    const inside = dungeon.getContainerRecord(rn)!.containedObject;
    if (inside !== OBJECT_ID_EOF) chestAt = { ch, slot, inside };
  }));
  const c3 = champions[3]!;
  const slot3 = c3.possessions.findIndex((p) => p !== OBJECT_ID_NULL);
  const type = GetBasicObjectType(dungeon, base.ctx.tables.objDescObjectType, c3.possessions[slot3]!);
  let carriedOfType = 0;
  const countIn = (rn: ObjectID): void => {
    if (rn === OBJECT_ID_NULL) return;
    if (GetBasicObjectType(dungeon, base.ctx.tables.objDescObjectType, rn) === type) carriedOfType++;
    if (dungeon.rnMaps.decode(rn).category === DBType.CHEST) {
      for (let o = dungeon.getContainerRecord(rn)!.containedObject; o !== OBJECT_ID_EOF; o = dungeon.getDBRecordLink(o)) countIn(o);
    }
  };
  champions.forEach((c, ch) => {
    c.possessions.forEach(countIn);
    if (ch === party.cursorOwner) countIn(party.objectInHand);
  });
  const found = chestAt as { ch: number; slot: number; inside: ObjectID } | null;
  check(found !== null, 'a champion carries a chest with something in it');
  const { g } = run([
    ...int(3), ...int(c3.possessions[slot3]!), op(StkOp.IS_CARRIED), globalStore(0),
    ...int(5), ...int(c3.possessions[slot3]!), op(StkOp.IS_CARRIED), globalStore(1),
    ...int(0), ...int(c3.possessions[slot3]!), op(StkOp.IS_CARRIED), globalStore(2),
    ...int(5), ...int(found?.inside ?? 0), op(StkOp.IS_CARRIED), globalStore(3),
    ...int(5), ...int(type === 0 ? -1 : -type), op(StkOp.IS_CARRIED), globalStore(4),
  ]);
  console.log(`7. &ISCARRIED 3/5/0 c3[${slot3}], 5 in-chest, 5 type ${type}: ${g.slice(0, 5).join(' ')}`);
  check(g[0] === 3 * 256 + slot3 && g[1] === g[0], 'a particular object is 256 * chIdx + its slot');
  check(g[2] === -1, 'an object the champion asked about does not carry is -1');
  check(found !== null && g[3] === found.ch * 256 + found.slot, 'what a chest holds is found at the chest\'s slot');
  check(g[4] === carriedOfType && carriedOfType > 0, `a basic type counts every one carried (${carriedOfType})`);

  // The hand's owner's first object, moved to the hand.
  const owner = party.cursorOwner;
  const ownerSlot = champions[owner]!.possessions.findIndex((p) => p !== OBJECT_ID_NULL);
  const held = champions[owner]!.possessions[ownerSlot]!;
  const h = run([...int(4), ...int(held), op(StkOp.IS_CARRIED), globalStore(0)], (game) => {
    const ps = game.ctx.party.state;
    ps.objectInHand = held;
    ps.champions[owner]!.possessions[ownerSlot] = OBJECT_ID_NULL;
  });
  console.log(`7b. &ISCARRIED 4 (hand owner ${owner}) for the object in hand: ${h.g[0]}`);
  check(h.g[0] === owner * 256 + 255, 'the object in hand is at 255');
}

/* ---------------------------------------------- 8. &CHAR! ----------------------- */
{
  // CHAR@ 0 into V0-V58, then change what the test writes, and CHAR! it back.
  const store = (chIdx: number, sets: Array<[number, number]>, n = 59): number[] => [
    ...int(chIdx), ...int(0), ...int(59), op(StkOp.CHAR_FETCH),
    ...sets.flatMap(([v, value]) => [...int(value), varStore(v)]),
    ...int(chIdx), ...int(0), ...int(n), op(StkOp.CHAR_STORE),
    varFetch(2), globalStore(0),
  ];
  const before = champions[0]!;
  const hp = before.attributes.health;
  const a = run(store(0, [[1, 5000], [2, hp - 10], [4, 30000], [8, -4], [9, -2000], [11, (1 << 16) | (90 << 8) | 80], [58, 0x42]]));
  const pc = a.game.ctx.party.state.champions[0]!;
  const st = pc.attributes.stats[1]!;
  console.log(`8a. &CHAR! 0: food ${pc.food}, HP ${pc.attributes.health} pending ${a.game.ctx.party.state.pendingDamage[0]}, `
    + `mana ${pc.attributes.mana}/${pc.attributes.maxMana}, stamina ${pc.attributes.stamina}, water ${pc.water}, `
    + `strength ${st.minimum}/${st.maximum}/${st.current}, talents ${pc.talents}`);
  check(pc.food === 2048 && pc.water === -1023, 'food and water are clamped to -1023..2048');
  check(pc.attributes.health === hp && a.game.ctx.party.state.pendingDamage[0] === 10, 'a lower HP is pending damage');
  check(pc.attributes.mana === pc.attributes.maxMana && pc.attributes.stamina === 0, 'mana and stamina are clamped');
  check(st.minimum === 1 && st.maximum === 90 && st.current === 80, 'an attribute is written minimum, maximum, current');
  check(pc.talents === 0x42, 'the talents are written');

  const b = run(store(0, [[2, 30000]]));
  const pb = b.game.ctx.party.state.champions[0]!;
  console.log(`8b. &CHAR! HP 30000: HP ${pb.attributes.health}/${pb.attributes.maxHealth}, V2 ${b.g[0]}`);
  check(pb.attributes.health === pb.attributes.maxHealth && b.g[0] === pb.attributes.maxHealth,
    'a higher HP is clamped to MaxHP, in the variable too');

  const c = run(store(0, [[1, 77], [2, 1]], 2));
  const pcc = c.game.ctx.party.state.champions[0]!;
  check(pcc.food === 77 && pcc.attributes.health === hp, 'num 2 writes the food alone');

  const d = run(store(1, [[2, 50], [4, 1]]), (game) => { game.ctx.party.state.pendingDamage[1] = game.ctx.party.state.champions[1]!.attributes.health; });
  const pd = d.game.ctx.party.state.champions[1]!;
  check(d.game.ctx.party.state.pendingDamage[1] === champions[1]!.attributes.health && pd.attributes.mana === Math.min(1, pd.attributes.maxMana),
    'a champion the pending damage kills keeps their HP, and the rest is written');

  const e = run(store(2, [[1, 9]]), (game) => { game.ctx.party.state.potentialChampionIndex = 2; });
  check(e.game.ctx.party.state.champions[2]!.food === champions[2]!.food, 'the potential champion is left alone');
}

/* ---------------------------------------------- 9. &EXPERIENCE+, &CAUSEPOISON --- */
{
  const skill = 4;
  const exp0 = champions[1]!.skills[skill]!.experience;
  const basic0 = champions[1]!.skills[0]!.experience;
  const a = run([...int(1), ...int(skill), ...int(0x10005), op(StkOp.EXPERIENCE_PLUS)]);
  const s = a.game.ctx.party.state.champions[1]!.skills;
  console.log(`9a. &EXPERIENCE+ 1 ${skill} 0x10005: skill ${exp0} -> ${s[skill]!.experience}, basic ${basic0} -> ${s[0]!.experience}`);
  check(s[skill]!.experience === exp0 + 5 && s[0]!.experience === basic0 + 5, 'the experience is added as a ui16, to the basic skill too');

  const dead = run([...int(1), ...int(skill), ...int(100), op(StkOp.EXPERIENCE_PLUS)], (game) => {
    game.ctx.party.state.champions[1]!.attributes.health = 0;
  });
  check(dead.game.ctx.party.state.champions[1]!.skills[skill]!.experience === exp0, 'a dead champion gains nothing');

  const p = run([...int(128), ...int(0), op(StkOp.CAUSE_POISON)]);
  const ps = p.game.ctx.party.state;
  const poison = p.game.ctx.timers.getTimers().filter((t) => t.function === TimerFunction.TT_75 && t.uByte5 === 0);
  console.log(`9b. &CAUSEPOISON 0 128: pending ${ps.pendingDamage[0]}, poisonCount ${ps.champions[0]!.poisonCount}, TT_75s ${poison.length}`);
  check(ps.pendingDamage[0] === 2 && ps.champions[0]!.poisonCount === champions[0]!.poisonCount + 1 && poison.length >= 1,
    '&CAUSEPOISON deals strength/64 and arms a TT_75');
  const out = run([...int(128), ...int(4), op(StkOp.CAUSE_POISON)]);
  check(out.game.ctx.party.state.pendingDamage.every((v) => v === 0), 'a champion past the party is not poisoned');
}

finish();
