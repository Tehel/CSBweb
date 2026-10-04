/**
 * The monster attack filter (`doc/CSBwin-src/Monster.cpp:1125-1171`), which `MonsterAttacks`
 * runs between filling in its parameter block and acting on it, with DSAs on its square,
 * against a genuine save (`csbgame7.dat`). A group on the party's level, made a Mummy,
 * attacks the party, which stands north of it.
 *
 * 1. **Every DSA at the location runs**, each with a count of 20 and the
 *    `ATTACK_PARAMETERES` block (`:1164-1165`), in the struct's order (`:917-938`):
 *    the monster's RN, type, index in the group and level, its square, its corner, the
 *    missile's corner, range, damage and decay, the direction and distance to the party,
 *    the missile, the two flags, the champion to hit, the sound, `disableTime` and
 *    `supressPoison` -1.
 * 2. **A DSA's rewrite is what the next one sees, and what the attack does**: the blow goes
 *    to the champion it names, and only to that one.
 * 3. **Each DSA runs on parameters of its own** (`NEWDSAPARAMETERS`, `:1153`): the caller's
 *    are as they were.
 * 4. **A launch the filter asks for** throws the missile it names, from the group's square
 *    (`:1180-1204`). `missileType` is a `ui32`, so -128 is not `RNFireball`'s 0xff80, and
 *    nothing is thrown.
 * 5. **Champion 4 is the leader**, `d.HandChar` (`:1215-1217`): whoever holds the cursor.
 * 6. **The block outlives the attack**: `disableTime`, which `MonsterAttacks` never writes,
 *    is what the last filter left there.
 *
 * Run: `npx tsx tools/dump-monster-attack-filter.ts`
 */
import { DBType, OBJECT_ID_EOF, Position, type ObjectID } from '../src/core/types';
import { RN_FIREBALL } from '../src/core/spellRn';
import { StkOp } from '../src/engine/DsaSystem';
import type { Game } from '../src/engine/Game';
import { attackParametersToWords } from '../src/engine/MonsterAttack';
import { MonsterType } from '../src/engine/monsterTypes';
import { UNSET, freshGame, globalStore, int, op, varFetch, varStore, withFilterDsas } from './lib/dsa';
import { check, finish } from './lib/check';

/** `ESL_MONSTERATTACKFILTER` (`doc/CSBwin-src/CSB.h:1535`). */
const ESL_MONSTERATTACKFILTER = 0;
const WORDS = 20;

/** The parameter count, then the block, into globals `to` on. */
const report = (to: number): number[] => [
  op(StkOp.NUM_PARAM), globalStore(to),
  ...int(WORDS), ...int(10), op(StkOp.PARAM_FETCH),
  ...Array.from({ length: WORDS }, (_, i) => [varFetch(10 + i), globalStore(to + 1 + i)]).flat(),
];
/** The block fetched, word `index` set to `value`, and stored back. */
const setWord = (index: number, value: number): number[] => [
  ...int(WORDS), ...int(10), op(StkOp.PARAM_FETCH),
  ...int(value), varStore(10 + index), ...int(WORDS), ...int(10), op(StkOp.PARAM_STORE),
];

/** A group on the party's level that neither throws nor steals: its RN and square. */
function group(game: Game): { rn: ObjectID; at: Position } {
  const dungeon = game.ctx.dungeon;
  const z = game.ctx.party.state.position.z;
  for (const slot of dungeon.getItem16Pool()) {
    if (slot.word0 < 0) continue;
    const rec = dungeon.getCreatureRecordByIndex(slot.word0);
    if (!rec) continue;
    const rn = dungeon.rnMaps.rn(DBType.CREATURE, slot.word0);
    const at = new Position(slot.uByte10, slot.uByte11, z);
    // A Mummy hits and throws nothing (`word14_12_15` 1), and picks the nearest champion.
    rec.creatureType = MonsterType.mon_Mummy;
    return { rn, at };
  }
  throw new Error('no group on the party\'s level');
}

/** The group attacks the party north of it; the attack's result and the missiles it threw. */
function attack(game: Game): { attacked: boolean; thrown: ObjectID[] } {
  const { rn, at } = group(game);
  const dungeon = game.ctx.dungeon;
  const position = game.ctx.party.state.position;
  position.x = at.x;
  position.y = at.y - 1;
  const missiles = (): Map<ObjectID, ObjectID> => {
    const found = new Map<ObjectID, ObjectID>();
    for (let m = dungeon.findFirstObject(at); m !== OBJECT_ID_EOF; m = dungeon.getDBRecordLink(m)) {
      if (dungeon.rnMaps.dbType(m) === DBType.MISSILE) found.set(m, dungeon.getMissileRecord(m)!.projectileObject);
    }
    return found;
  };
  const before = missiles();
  for (const c of game.ctx.party.state.champions) c.maxRecentDamage = 0;
  const attacked = game.systems.monsterAttack.monsterAttacks(rn, dungeon.getCreatureRecord(rn)!, at.x, at.y, 0, {
    level: at.z, primaryDirectionToParty: 0, orthogonalDistanceToParty: 1,
  });
  const thrown = [...missiles()].filter(([m]) => !before.has(m)).map(([, o]) => o);
  return { attacked, thrown };
}

/** The champions the attack reached: those whose `maxRecentDamage` it set. */
const hit = (game: Game): number[] =>
  game.ctx.party.state.champions.flatMap((c, i) => (c.maxRecentDamage > 0 ? [i] : []));

const hex = (v: number): string => '0x' + (v >>> 0).toString(16);

/* ------------------------------- the attack without a filter -------------------- */
const plainGame = freshGame();
const plain = attack(plainGame);
const nearest = plainGame.systems.monsterAttack.attackParameters.heroToDamage;
console.log(`no filter: attacked ${plain.attacked}, champion ${nearest} to hit, hit ${hit(plainGame).join(', ')}`);
check(plain.attacked && hit(plainGame).join() === String(nearest), 'with no filter the blow goes to the nearest champion');
const other = (nearest + 1) & 3;

/* ------------------------------- 1, 2, 3. two DSAs ----------------------------- */
{
  const game = withFilterDsas(ESL_MONSTERATTACKFILTER, [
    [...report(0), ...setWord(16, other), ...setWord(17, 0)],
    report(30),
  ]);
  const dsa = game.systems.dsa;
  dsa.setParameters(3, [7, 8, 9]);
  const { rn, at } = group(game);
  const result = attack(game);
  const g = dsa.getGlobalVariables();
  const p = game.systems.monsterAttack.attackParameters;
  const block = attackParametersToWords(p);
  console.log(`1. the first DSA saw [${g.slice(0, 21).join(', ')}]`);
  console.log(`   the second saw [${g[30] === UNSET ? 'nothing' : g.slice(30, 51).join(', ')}]`);
  const seen = g.slice(1, 21);
  check(g[0] === WORDS, 'a count of 20');
  check(seen[0] === rn && seen[1] === MonsterType.mon_Mummy && seen[2] === 0 && seen[3] === at.z
    && seen[4] === at.x && seen[5] === at.y, 'the monster\'s RN, type, index and level, and its square');
  check(seen[10] === 8 && seen[11] === 0 && seen[12] === 1, 'a decay of 8, then the direction and the distance to the party');
  check(seen[13] === 0xffff && seen[14] === 0 && seen[15] === 0, 'no missile (RNnul, 0xffff), no launch, no theft');
  check(seen[16] === nearest && seen[18] === 0 && seen[19] === -1, 'the nearest champion, disableTime 0, supressPoison -1');
  const rewritten = seen.map((w, i) => (i === 16 ? other : i === 17 ? 0 : w));
  check(g.slice(31, 51).join() === rewritten.join(), '2. the second DSA runs too, on the block the first rewrote');
  check(block.join() === rewritten.join(), 'and the block is the rewritten one');
  console.log(`2. attacked ${result.attacked}, hit ${hit(game).join(', ')}`);
  check(result.attacked && hit(game).join() === String(other), 'the blow goes to the champion the filter named, and only to it');
  check([0, 1, 2].map((i) => dsa.getParameter(i)).join() === '7,8,9', '3. the caller\'s parameters are as they were');
}

/* ------------------------------- 4. a launch ----------------------------------- */
for (const missile of [RN_FIREBALL, -128]) {
  const game = withFilterDsas(ESL_MONSTERATTACKFILTER, [[...setWord(14, 1), ...setWord(13, missile)]]);
  const result = attack(game);
  console.log(`4. launch, missileType ${hex(missile)}: thrown [${result.thrown.map(hex).join(', ')}], hit ${hit(game).join(', ') || 'nobody'}`);
  if (missile === RN_FIREBALL) {
    check(result.thrown.length === 1 && result.thrown[0] === RN_FIREBALL && hit(game).length === 0,
      'a fireball is thrown from the group\'s square, and no blow is struck');
  } else {
    check(result.thrown.length === 0 && hit(game).length === 0 && result.attacked,
      '0xffffff80 is not RNFireball: nothing is thrown, no blow is struck, and the attack still counts');
  }
}

/* ------------------------------- 5. the leader --------------------------------- */
{
  const game = withFilterDsas(ESL_MONSTERATTACKFILTER, [setWord(16, 4)]);
  const party = game.ctx.party.state;
  const leader = (nearest + 2) & 3;
  party.cursorOwner = leader;
  party.selectedCharacterIndex = (leader + 1) & 3;
  attack(game);
  console.log(`5. champion 4, the cursor with champion ${leader}: hit ${hit(game).join(', ')}`);
  check(hit(game).join() === String(leader), 'the blow goes to the champion holding the cursor');
}

/* ------------------------------- 6. disableTime outlives the attack ------------- */
{
  const game = withFilterDsas(ESL_MONSTERATTACKFILTER, [[...report(0), ...setWord(18, 77)]]);
  attack(game);
  const first = game.systems.dsa.getGlobalVariables()[19];
  attack(game);
  const second = game.systems.dsa.getGlobalVariables()[19];
  console.log(`6. disableTime seen by the first attack's filter ${first}, by the second's ${second}`);
  check(first === 0 && second === 77, 'the second attack\'s filter sees the disableTime the first left');
}

finish();
