/**
 * Who a blow at the party hits: `GetCharacterToDamage`
 * (`doc/CSBwin-src/CSBCode.cpp:6950-6975`) walks `DetermineAttackOrder`'s four corners and
 * takes `CharacterAtPosition`'s answer for each, the first *living* champion there
 * (`Code11f52.cpp:4084-4105`). A recruit takes a corner among the living only
 * (`findFreeCharPosition`), so a dead champion and a living one can share a corner: the
 * blow hits the living one, not the next corner's champion.
 *
 * Run: `npm test -- --only=dump-character-to-damage.ts`
 */
import { check, finish } from './lib/check';
import { testChampion } from './lib/champion';
import { newGame, stockDungeon, stockGraphics } from './lib/game';

const SEED = 0x1234;
const game = newGame(stockDungeon(), stockGraphics());
const party = game.ctx.party.state;
const attack = game.systems.monsterAttack;
const { x, y } = party.position;

// The order a blow from the square to the north, side 0, walks the corners in.
game.setRandomSeed(SEED);
const order = attack.determineAttackOrder(x, y, x, y - 1, 0);
const first = order[0]!;
const second = order[1]!;

// A dead champion in the first corner, a living recruit beside them, and a third in the second.
const dead = testChampion(first);
dead.attributes.health = 0;
party.champions = [dead, testChampion(first), testChampion(second)];

game.setRandomSeed(SEED);
const hit = attack.getCharacterToDamage(x, y - 1, 0);
console.log(`corners in order ${order.join(',')}; a dead champion and a living one in ${first}, a third in ${second}: hit ${hit}`);
check(hit === 1, 'the blow hits the living champion who shares the dead one\'s corner');

// With nobody living in the first corner, the next corner's champion.
party.champions = [dead, testChampion(second)];
game.setRandomSeed(SEED);
const next = attack.getCharacterToDamage(x, y - 1, 0);
console.log(`the dead one alone in ${first}: hit ${next}`);
check(next === 1, 'and a corner of the dead alone passes to the next');

finish();
