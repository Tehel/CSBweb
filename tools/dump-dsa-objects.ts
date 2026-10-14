/**
 * The DSA operations on an object's fields (the objects family), each run
 * through `DsaSystem.execute` as one program of a test DSA, against the possessions of a
 * genuine save (`csbgame7.dat`).
 *
 * 1. **The getters** `&CHARGES@`, `&CURSE@`, `&BROKEN@`, `&POISONED@`, `&SUBTYPE@`
 *    (`doc/CSBwin-src/DSA.cpp:3412-3440`, `:3459-3484`, `:3512-3537`, `:3565-3596`,
 *    `:3630-3652`): a potion's charges are its strength, a misc object's its `value()`;
 *    only a weapon is poisoned, only a misc object has a subtype; a database without the
 *    field, or an invalid slot, reads 0.
 * 2. **The setters** `&CHARGES!`, `&BROKEN!`, `&POISONED!`, `&SUBTYPE!` (`:3485-3511`,
 *    `:3538-3564`, `:3597-3629`, `:3653-3676`) cut the value to the field's width
 *    (`SETWBITS`, `CSB.h:749-777`), and touch neither the other bits nor another
 *    database.
 * 3. **`&CURSE!`** is `SetCursed` (`Character.cpp:1787-1821`): on a carried weapon it
 *    costs 3 Luck at once, and gives it back when lifted. CSBWin does so only for the
 *    last champion, whose slot its search alone keeps; the port for every champion
 *    (`DEBT.md` H), so a curse laid and the weapon taken off leaves the Luck as it was.
 *
 * Run: `npm test -- --only=dump-dsa-objects.ts`
 */
import { type ObjectID } from '../src/core/types';
import { StkOp } from '../src/engine/DsaSystem';
import { freshGame, globalStore, int, op, run } from './lib/dsa';
import { check, finish } from './lib/check';

const base = freshGame();
const champions = base.ctx.party.state.champions;
const dungeon = base.ctx.dungeon;
const slot = (ch: number, i: number): ObjectID => champions[ch]!.possessions[i]!;

const weapon = slot(0, 12);   // charges 14
const clothing = slot(0, 0);
const potion = slot(0, 13);   // strength 175
const misc = slot(2, 22);     // value 2
const scroll = slot(0, 18);
const lastWeapon = slot(3, 1);
const firstWeapon = slot(0, 1);
console.log(`csbgame7.dat: weapon ${weapon}, clothing ${clothing}, potion ${potion}, misc ${misc}, `
  + `scroll ${scroll}; the last champion's weapon ${lastWeapon}, the first's ${firstWeapon}`);
check(dungeon.getWeaponRecord(weapon)?.charges === 14 && dungeon.getPotionRecord(potion)?.power === 175
  && dungeon.getMiscRecord(misc)?.specialState === 2 && dungeon.rnMaps.dbType(scroll) === 7,
  'the save holds the objects the checks expect');

/* ---------------------------------------------- 1. the getters ------------------ */
{
  const get = (obj: number, stkop: StkOp, g: number): number[] => [...int(obj), op(stkop), globalStore(g)];
  const { g } = run([
    ...get(weapon, StkOp.GET_CHARGES, 0),
    ...get(clothing, StkOp.GET_CHARGES, 1),
    ...get(potion, StkOp.GET_CHARGES, 2),
    ...get(misc, StkOp.GET_CHARGES, 3),
    ...get(scroll, StkOp.GET_CHARGES, 4),
    ...get(-1, StkOp.GET_CHARGES, 5),
    ...get(potion, StkOp.GET_CURSE, 6),
    ...get(clothing, StkOp.GET_POISONED, 7),
    ...get(weapon, StkOp.GET_SUB_TYPE, 8),
    ...get(misc, StkOp.GET_BROKEN, 9),
  ]);
  console.log(`1. charges: weapon ${g[0]}, clothing ${g[1]}, potion ${g[2]}, misc ${g[3]}, scroll ${g[4]}, `
    + `slot -1 ${g[5]}; a potion's curse ${g[6]}, clothing's poison ${g[7]}, a weapon's subtype ${g[8]}, `
    + `a misc object's breakage ${g[9]}`);
  check(g.slice(0, 4).join() === '14,0,175,2', 'charges are a weapon\'s and clothing\'s, a potion\'s strength, a misc value');
  check(g.slice(4, 10).every((v) => v === 0), 'a database without the field, or an invalid slot, reads 0');
}

/* ---------------------------------------------- 2. the setters ------------------ */
{
  const set = (obj: number, stkop: StkOp, value: number): number[] => [...int(obj), ...int(value), op(stkop)];
  const get = (obj: number, stkop: StkOp, g: number): number[] => [...int(obj), op(stkop), globalStore(g)];
  const { g, game } = run([
    ...set(weapon, StkOp.SET_CHARGES, 0x13), ...get(weapon, StkOp.GET_CHARGES, 0),
    ...set(clothing, StkOp.SET_CHARGES, -1), ...get(clothing, StkOp.GET_CHARGES, 1),
    ...set(potion, StkOp.SET_CHARGES, 0x1ff), ...get(potion, StkOp.GET_CHARGES, 2),
    ...set(misc, StkOp.SET_CHARGES, 5), ...get(misc, StkOp.GET_CHARGES, 3),
    ...set(misc, StkOp.SET_SUB_TYPE, 0x25), ...get(misc, StkOp.GET_SUB_TYPE, 4),
    ...set(clothing, StkOp.SET_BROKEN, 7), ...get(clothing, StkOp.GET_BROKEN, 5),
    ...set(firstWeapon, StkOp.SET_POISONED, 2), ...get(firstWeapon, StkOp.GET_POISONED, 6),
    ...set(misc, StkOp.SET_CURSE, 1), ...get(misc, StkOp.GET_CURSE, 7),
    ...set(scroll, StkOp.SET_CHARGES, 3), ...set(potion, StkOp.SET_SUB_TYPE, 3),
    ...set(potion, StkOp.SET_BROKEN, 1), ...set(-1, StkOp.SET_CHARGES, 3),
  ]);
  console.log(`2. after the setters: charges ${g.slice(0, 4).join(' ')}, subtype ${g[4]}, broken ${g[5]}, `
    + `poisoned ${g[6]}, misc curse ${g[7]}`);
  check(g.slice(0, 8).join() === '3,15,255,1,5,1,1,1', 'a setter cuts its value to the field\'s width');
  const d = game.ctx.dungeon;
  const w = d.getWeaponRecord(weapon)!;
  const m = d.getMiscRecord(misc)!;
  const p = d.getPotionRecord(potion)!;
  check(w.weaponType === 16 && !w.cursed && !w.broken && !w.poisoned, 'the weapon\'s other bits are untouched');
  check(m.miscType === 1 && m.specialState === 1 && m.subType === 5, 'the misc object\'s value and subtype are separate fields');
  check(p.potionType === 20 && p.power === 255, 'a potion has no subtype and cannot break');
}

/* ---------------------------------------------- 3. &CURSE! ---------------------- */
{
  const luck = (game: typeof base, ch: number): string => {
    const s = game.ctx.party.state.champions[ch]!.attributes.stats[0]!;
    return `${s.current}/${s.minimum}/${s.maximum}`;
  };
  const curse = (obj: number, on: number): number[] => [...int(obj), ...int(on), op(StkOp.SET_CURSE)];
  const last = run(curse(lastWeapon, 1));
  const lifted = run([...curse(lastWeapon, 1), ...curse(lastWeapon, 0)]);
  const first = run(curse(firstWeapon, 1));
  // The cursed weapon taken out of the first champion's hand, slot 1.
  const removed = run(curse(firstWeapon, 1));
  removed.game.ctx.systems.character.removeCharacterPossession(0, 1);
  console.log(`3. Luck of the last champion ${luck(base, 3)}: cursed ${luck(last.game, 3)}, lifted `
    + `${luck(lifted.game, 3)}; of the first ${luck(base, 0)}: cursed ${luck(first.game, 0)}, `
    + `the weapon then taken off ${luck(removed.game, 0)}`);
  const before = base.ctx.party.state.champions[3]!.attributes.stats[0]!.current;
  check(last.game.ctx.party.state.champions[3]!.attributes.stats[0]!.current === before - 3,
    'a curse on the last champion\'s weapon costs 3 Luck at once');
  check(luck(lifted.game, 3) === luck(base, 3), 'lifting it gives the Luck back');
  check(last.game.ctx.dungeon.getWeaponRecord(lastWeapon)!.cursed
    && first.game.ctx.dungeon.getWeaponRecord(firstWeapon)!.cursed, 'both weapons are cursed');
  const firstBefore = base.ctx.party.state.champions[0]!.attributes.stats[0]!.current;
  check(first.game.ctx.party.state.champions[0]!.attributes.stats[0]!.current === firstBefore - 3,
    'so does a curse on the first champion\'s: the port passes the slot found, not CSBWin\'s 30');
  check(luck(removed.game, 0) === luck(base, 0), 'the cursed weapon taken off gives the Luck back, and no more');
}

finish();
