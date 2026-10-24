/**
 * A monster's blow, softened by the defender's defend mastery, the Firestaff in hand
 * included.
 *
 * `MonsterDamagesCharacter` takes `2*DetermineMastery(chIdx, 7)` off the blow
 * (`doc/CSBwin-src/Monster.cpp:4576`), the plain skill number, so `DetermineMastery` adds
 * the possessions' bonuses: the Firestaff in the weapon hand adds 1 to every skill, the
 * complete one 2 (`doc/CSBwin-src/Code17818.cpp:73-147`). The same champion, the same
 * monster and the same seeds, with and without the Firestaff in hand, so take less in
 * all with it, and some blow less.
 *
 * Run: `npm test -- --only=monster-blow-mastery.ts`
 */
import { DBType, OBJECT_ID_NULL, type ObjectID } from '../../src/core/types';
import { OBJNI_THE_FIRESTAFF_A } from '../../src/core/objectNameIndex';
import { nameIndexOf } from '../../src/engine/GameContext';
import { check, finish } from '../lib/check';
import { testChampion } from '../lib/champion';
import { newGame, stockDungeon, stockGraphics } from '../lib/game';

const SEEDS = 200;
const game = newGame(stockDungeon(), stockGraphics());
game.systems.hallOfChampions.addChampion(testChampion(0));
const ctx = game.ctx;
const champ = ctx.party.state.champions[0]!;

// The Firestaff of DM's dungeon, by its name index.
let firestaff: ObjectID = OBJECT_ID_NULL;
const weapons = ctx.dungeon.getData().databases.weapons.records;
for (let i = 0; i < weapons.length && firestaff === OBJECT_ID_NULL; i++) {
  const rn = ctx.dungeon.rnMaps.rn(DBType.WEAPON, i);
  if (nameIndexOf(ctx, rn) === OBJNI_THE_FIRESTAFF_A) firestaff = rn;
}
check(firestaff !== OBJECT_ID_NULL, 'DM\'s dungeon holds the Firestaff');

const monster = ctx.dungeon.getCreatureRecordByIndex(0)!;
check(monster !== null, 'a creature record to strike with');

/** Each seed's blow at a fresh champion holding `inHand`, the damage it did. */
function blows(inHand: ObjectID): number[] {
  const out: number[] = [];
  for (let seed = 1; seed <= SEEDS; seed++) {
    const fresh = testChampion(0);
    champ.skills = fresh.skills;
    champ.attributes = fresh.attributes;
    champ.possessions[1] = inHand;
    ctx.party.state.lastMonsterAttackTime = -200;
    game.setRandomSeed(seed);
    out.push(game.systems.monsterAttack.monsterDamagesCharacter(monster, 0, true));
  }
  return out;
}

const bare = blows(OBJECT_ID_NULL);
const held = blows(firestaff);
const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
const softened = bare.filter((d, i) => held[i]! < d).length;
const harder = bare.filter((d, i) => held[i]! > d).length;
console.log(`creature type ${monster.creatureType}, ${SEEDS} seeds: ${sum(bare)} damage bare-handed, ` +
  `${sum(held)} with the Firestaff; ${softened} blows softer, ${harder} harder`);
check(sum(held) < sum(bare), 'the Firestaff in hand softens the blows in all');
check(softened > 0, 'and some blow in particular');

finish();
