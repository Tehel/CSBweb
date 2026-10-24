/**
 * An extra (`DEBT.md` X), not CSBWin's: what a champion's THROW or SHOOT sent off comes
 * back to them when the party arrives on the square it lies on (`src/engine/ThrownWeapons.ts`).
 *
 * Every scenario goes through the real engine: the attack (`executeAttack`), the
 * missile's flight (`gameTick`), the party's arrival (`WorldMove.moveParty`), and checks
 * the champion's slots, the floor chain and the load.
 *
 *  1. **THROW at a wall**: the dagger comes back into the weapon hand on the square it
 *     fell on, not before; it comes off the floor through the pads
 *     (`ActuatorSystem.triggerObjectMove`); the load is what it was.
 *  2. **SHOOT**: the bow reloads from the quiver as CSBWin's does, so the arrow shot finds
 *     the ready hand taken and goes back into the quiver, in slot 7, which only small
 *     weapons fit, not 12, which a club fits too.
 *  3. **The extras off**: the game is CSBWin's, and the dagger stays on the floor, tagged.
 *     Turned on, the next arrival gathers it.
 *  4. **A dead thrower** gathers nothing; the dagger stays, tagged.
 *  5. **No room**: the dagger stays, tagged, until a pack slot is freed, and then goes there.
 *  6. **Thrown from the cursor**: never gathered.
 *  7. **Picked up by hand** (`tryPickViewportObject`): the tag goes.
 *  8. **A record handed out again** under the dagger's `ObjectID` does not inherit its tag.
 *  9. **A monster** that absorbs daggers keeps it, drops it when it dies, and the party
 *     gathers it there.
 * 10. **Arriving on a level** (`Game.loadNewPartyLevel`, as after stairs or a pit)
 *     gathers too.
 * 11. **A club among daggers**, lying after them: each goes back to the slot it left
 *     while that is free, then the club, which fits one quiver slot only, takes it, and
 *     the daggers fill the three small ones before the pack.
 *
 * Run: `npm test -- --only=checks/watch-thrown-weapons.ts`
 */
import { OBJECT_ID_EOF, OBJECT_ID_NULL, Position, RoomType, type ObjectID } from '../../src/core/types';
import type { Game } from '../../src/engine/Game';
import { getChampionPossession } from '../../src/core/charDesc';
import type { Champion } from '../../src/engine/gameTypes';
import { AttackType } from '../../src/engine/monsterTypes';
import { DescIndex } from '../../src/engine/objectIndex';
import { tagThrownWeapon } from '../../src/engine/ThrownWeapons';
import { tryPickViewportObject } from '../../src/renderer/ui/ViewportPicking';
import { VIEWPORT_Y } from '../../src/renderer/ViewportGraphics';
import { check, finish } from '../lib/check';
import { testChampion } from '../lib/champion';
import { createMonsterAt } from '../lib/createMonster';
import { stockGame, stockGraphics } from '../lib/game';
import { newUIState } from '../lib/ui';
import { NO_EXTRAS } from '../../src/engine/GameContext';

const WEAPON_DAGGER = 8;
const WEAPON_BOW = 25;
const WEAPON_ARROW = 27;
const WEAPON_ROCK = 30;
const WEAPON_CLUB = 23;
const MONSTER_MUMMY = 10;
const EAST = 1;

/** Map 0's corridor, row 9: open from x 6 to 17, stone at 18. */
const CORRIDOR = new Position(7, 9, 0);

function makeGame(extras = true, at = CORRIDOR): Game {
  const game = stockGame();
  game.setRandomSeed(0x13579bdf);
  game.systems.hallOfChampions.addChampion(testChampion(0, {
    name: 'THROWER',
    attributes: { health: 900, maxHealth: 900, stamina: 900, maxStamina: 900, mana: 0, maxMana: 0 },
  }));
  game.ctx.extras = { ...NO_EXTRAS, gatherThrownWeapons: extras };
  const party = game.ctx.party.state;
  party.position = at;
  game.ctx.party.setFacing(EAST);
  game.systems.monsters.loadPartyLevelIfChanged();
  return game;
}

const thrower = (game: Game): Champion => game.ctx.party.state.champions[0]!;

/** A new weapon record of `weaponType`, not in any cell. */
function weapon(game: Game, weaponType: number): ObjectID {
  return game.ctx.dungeon.findEmptyDBEntry('weapons', {
    nextObject: OBJECT_ID_EOF, weaponType, charges: 0, litTorch: false,
    important: false, cursed: false, poisoned: false, broken: false,
  });
}

function give(game: Game, slot: number, object: ObjectID): void {
  game.systems.character.addCharacterPossession(0, object, slot);
}

const load = (game: Game): number => game.systems.characterStats.characterLoad(thrower(game));

/** Ticks until no missile flies and the thrower is free again (a bow reloads then). */
function fly(game: Game): void {
  const missiles = game.ctx.dungeon.getData().databases.missiles.records;
  for (let tick = 0; tick < 80; tick++) {
    game.gameTick();
    const flying = missiles.some((m) => m.nextObject !== OBJECT_ID_NULL);
    if (!flying && thrower(game).busyTimerIndex === -1) return;
  }
  check(false, 'the missile lands and the thrower is free within 80 ticks');
}

function onFloor(game: Game, at: Position, object: ObjectID): boolean {
  const dungeon = game.ctx.dungeon;
  for (let rn = dungeon.findFirstObject(at); rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) {
    if (rn === object) return true;
  }
  return false;
}

/** The square of the party's level `object` lies on, or null. */
function whereLies(game: Game, object: ObjectID): Position | null {
  const z = game.ctx.party.state.position.z;
  const map = game.ctx.dungeon.getMap(z)!;
  for (let x = 0; x < map.descriptor.width; x++) {
    for (let y = 0; y < map.descriptor.height; y++) {
      const at = new Position(x, y, z);
      if (onFloor(game, at, object)) return at;
    }
  }
  return null;
}

/** One step of the party to `x` on its row. */
function step(game: Game, x: number): void {
  const at = game.ctx.party.state.position;
  game.systems.worldMove.moveParty(at.x, at.y, x, at.y);
}

/**
 * The party walks east to `to`, one square at a time. Returns the square it stood on when
 * `object` left the floor, or null.
 */
function walkTo(game: Game, to: Position, object: ObjectID, lying: Position): Position | null {
  while (game.ctx.party.state.position.x < to.x) {
    step(game, game.ctx.party.state.position.x + 1);
    if (!onFloor(game, lying, object)) return game.ctx.party.state.position;
  }
  return null;
}

/**
 * THROW a dagger from the weapon hand, and let it land. Returns the dagger, where it
 * lies, and the load before the throw.
 */
function throwDagger(game: Game): { dagger: ObjectID; lying: Position; loadBefore: number } {
  const dagger = weapon(game, WEAPON_DAGGER);
  give(game, 1, dagger);
  const loadBefore = load(game);
  game.systems.character.executeAttack(0, AttackType.atk_THROW);
  fly(game);
  const lying = whereLies(game, dagger);
  check(lying !== null, 'the thrown dagger lands on the floor');
  return { dagger, lying: lying ?? CORRIDOR, loadBefore };
}

const where = (p: Position | null): string => (p ? `(${p.x},${p.y}) map ${p.z}` : 'nowhere');

/* ---------------------------------------------------------- 1. THROW at a wall ---- */
{
  console.log('=== 1. THROW at a wall ===');
  const game = makeGame();
  const { dagger, lying, loadBefore } = throwDagger(game);
  console.log(`dagger ${dagger} lies at ${where(lying)}, tagged ${game.ctx.thrownWeapons.has(dagger)}`);
  check(lying.y === CORRIDOR.y && lying.x > CORRIDOR.x + 1, '1. the dagger lands down the corridor, two squares off or more');
  check(getChampionPossession(thrower(game), 1) === OBJECT_ID_NULL, '1. the weapon hand is empty after the throw');
  const pads: string[] = [];
  const actuators = game.systems.actuators;
  const trigger = actuators.triggerObjectMove.bind(actuators);
  actuators.triggerObjectMove = (position, object, place, unchangedRoom, facing) => {
    if (object === dagger) pads.push(`${where(position)} ${place ? 'placed' : 'removed'}`);
    return trigger(position, object, place, unchangedRoom, facing);
  };
  const gatheredAt = walkTo(game, lying, dagger, lying);
  console.log(`gathered at ${where(gatheredAt)}; the pads felt: ${pads.join(', ') || 'nothing'}`);
  check(gatheredAt?.x === lying.x, '1. gathered on the square it lies on, not before');
  check(getChampionPossession(thrower(game), 1) === dagger, '1. back in the weapon hand');
  check(pads.length === 1 && pads[0] === `${where(lying)} removed`, '1. it came off the floor through the pads, as a pick-up does');
  check(!game.ctx.thrownWeapons.has(dagger), '1. the tag is gone');
  check(load(game) === loadBefore, `1. the load is what it was (${load(game)})`);
}

/* ------------------------------------------------------------------ 2. SHOOT ------ */
{
  console.log('\n=== 2. SHOOT, and the bow reloads from the quiver ===');
  const game = makeGame();
  const arrow = weapon(game, WEAPON_ARROW);
  const spare = weapon(game, WEAPON_ARROW);
  give(game, 1, weapon(game, WEAPON_BOW));
  give(game, 0, arrow);
  give(game, 12, spare);
  const loadBefore = load(game);
  game.systems.character.executeAttack(0, AttackType.atk_SHOOT);
  fly(game);
  const lying = whereLies(game, arrow);
  console.log(`arrow ${arrow} lies at ${where(lying)}; ready hand ${getChampionPossession(thrower(game), 0)}, quiver ${getChampionPossession(thrower(game), 12)}`);
  check(lying !== null && game.ctx.thrownWeapons.get(arrow)?.slot === 0, '2. the arrow shot lies on the floor, tagged from the ready hand');
  check(getChampionPossession(thrower(game), 0) === spare && getChampionPossession(thrower(game), 12) === OBJECT_ID_NULL,
    '2. the bow reloaded from the quiver');
  if (lying) walkTo(game, lying, arrow, lying);
  check(getChampionPossession(thrower(game), 7) === arrow,
    '2. the ready hand taken, the arrow goes back into the quiver, its narrowest slot first');
  check(lying !== null && !onFloor(game, lying, arrow), '2. it is off the floor');
  check(load(game) === loadBefore, `2. the load is what it was (${load(game)})`);
}

/* ------------------------------------------------------------- 3. extras off ------ */
{
  console.log('\n=== 3. the extras off, then on ===');
  const game = makeGame(false);
  const { dagger, lying } = throwDagger(game);
  walkTo(game, lying, dagger, lying);
  console.log(`off: on the floor ${onFloor(game, lying, dagger)}, tagged ${game.ctx.thrownWeapons.has(dagger)}`);
  check(game.ctx.party.state.position.x === lying.x && onFloor(game, lying, dagger), '3. off, the party stands on it and it stays');
  check(game.ctx.thrownWeapons.has(dagger), '3. off, it keeps its tag');
  game.ctx.extras = { ...NO_EXTRAS, gatherThrownWeapons: true };
  step(game, lying.x - 1);
  step(game, lying.x);
  check(getChampionPossession(thrower(game), 1) === dagger, '3. on, the next arrival gathers it');
}

/* --------------------------------------------------------- 4. a dead thrower ------ */
{
  console.log('\n=== 4. a dead thrower ===');
  const game = makeGame();
  const { dagger, lying } = throwDagger(game);
  thrower(game).attributes.health = 0;
  walkTo(game, lying, dagger, lying);
  check(onFloor(game, lying, dagger) && game.ctx.thrownWeapons.has(dagger), '4. the dagger stays where it lies, tagged');
}

/* ----------------------------------------------------------------- 5. no room ----- */
{
  console.log('\n=== 5. no room ===');
  const game = makeGame();
  const { dagger, lying } = throwDagger(game);
  const rocks = new Map<number, ObjectID>();
  for (let slot = 0; slot < 30; slot++) {
    if (getChampionPossession(thrower(game), slot) !== OBJECT_ID_NULL) continue;
    const rock = weapon(game, WEAPON_ROCK);
    give(game, slot, rock);
    rocks.set(slot, rock);
  }
  walkTo(game, lying, dagger, lying);
  check(onFloor(game, lying, dagger) && game.ctx.thrownWeapons.has(dagger), '5. with every slot taken it stays, tagged');
  game.systems.character.removeCharacterPossession(0, 20);
  step(game, lying.x - 1);
  step(game, lying.x);
  console.log(`slot 20 freed: it holds ${getChampionPossession(thrower(game), 20)}, the dagger is ${dagger}`);
  check(getChampionPossession(thrower(game), 20) === dagger, '5. a pack slot freed, it goes there');
}

/* --------------------------------------------------- 6. thrown from the cursor ---- */
{
  console.log('\n=== 6. thrown from the cursor ===');
  const game = makeGame();
  const party = game.ctx.party.state;
  const dagger = weapon(game, WEAPON_DAGGER);
  party.cursorOwner = 0;
  party.objectInHand = dagger;
  check(game.systems.mouse.throwObjectFromCursor(0), '6. the cursor throws the dagger');
  fly(game);
  const lying = whereLies(game, dagger);
  check(lying !== null && !game.ctx.thrownWeapons.has(dagger), '6. it lands untagged');
  if (lying) walkTo(game, lying, dagger, lying);
  check(lying !== null && onFloor(game, lying, dagger), '6. and is never gathered');
}

/* ------------------------------------------------------- 7. picked up by hand ----- */
{
  console.log('\n=== 7. picked up by hand ===');
  const game = makeGame(false);
  const party = game.ctx.party.state;
  const { dagger, lying } = throwDagger(game);
  walkTo(game, lying, dagger, lying);
  party.cursorOwner = 0;
  party.objectInHand = OBJECT_ID_NULL;
  const ui = newUIState(stockGraphics(), game.ctx);
  const button = { x1: 10, x2: 20, y1: 10, y2: 20 };
  const none = { x1: 255, x2: 0, y1: 0, y2: 0 };
  ui.context.viewportObjectButtons = [button, none, none, none, none, none];
  ui.context.viewportObjectRNs = [dagger, OBJECT_ID_EOF, OBJECT_ID_EOF, OBJECT_ID_EOF, OBJECT_ID_EOF];
  check(tryPickViewportObject(ui, 15, 15 + VIEWPORT_Y) && party.objectInHand === dagger, '7. the dagger is picked up into the hand');
  check(!game.ctx.thrownWeapons.has(dagger), '7. the tag is gone');
  // Laid down again by hand, it is a dropped object like any other.
  party.objectInHand = OBJECT_ID_NULL;
  game.ctx.dungeon.addObjectToCell(lying, dagger);
  game.ctx.extras = { ...NO_EXTRAS, gatherThrownWeapons: true };
  step(game, lying.x - 1);
  step(game, lying.x);
  check(onFloor(game, lying, dagger), '7. and it is never gathered again');
}

/* ------------------------------------------------ 8. a record handed out again ---- */
{
  console.log('\n=== 8. a record handed out again ===');
  const game = makeGame();
  const dungeon = game.ctx.dungeon;
  const { dagger, lying } = throwDagger(game);
  dungeon.removeObjectFromCell(lying, dagger);
  dungeon.deleteDBEntry(dagger);
  const rock = weapon(game, WEAPON_ROCK);
  console.log(`the dagger was ${dagger}; the next weapon record is ${rock}`);
  check(rock === dagger, '8. the freed record is handed out again under the same ObjectID');
  dungeon.addObjectToCell(lying, rock);
  walkTo(game, lying, rock, lying);
  check(onFloor(game, lying, rock), '8. the new object does not inherit the tag');
}

/* --------------------------------------------- 9. a monster that absorbs daggers -- */
{
  console.log('\n=== 9. a monster absorbs the dagger, and drops it as it dies ===');
  const level = 1;
  const scout = makeGame();
  const map = scout.ctx.dungeon.getMap(level)!;
  const open = (x: number, y: number): boolean => {
    const flags = map.cellFlags[x]?.[y] ?? 0;
    return ((flags >> 5) & 7) === RoomType.OPEN && (flags & 0x10) === 0;
  };
  let from: Position | null = null;
  for (let y = 1; y < map.descriptor.height - 1 && !from; y++) {
    for (let x = 1; x < map.descriptor.width - 2 && !from; x++) {
      if (open(x, y) && open(x + 1, y)) from = new Position(x, y, level);
    }
  }
  check(from !== null, '9. map 1 has two empty open squares side by side');
  if (from) {
    const game = makeGame(true, from);
    const monster = createMonsterAt(game, {
      value: MONSTER_MUMMY, hitPointMultiplier: 50, numMonM1: 0, facing: 3,
      mapX: from.x + 1, mapY: from.y, level, invisible: false, drawAsSize4: false,
    });
    check(monster !== null, `9. a mummy stands at (${from.x + 1},${from.y})`);
    const group = monster !== null ? game.ctx.dungeon.getCreatureRecord(monster) : null;
    const dagger = weapon(game, WEAPON_DAGGER);
    give(game, 1, dagger);
    game.systems.character.executeAttack(0, AttackType.atk_THROW);
    fly(game);
    console.log(`the mummy carries ${group?.possession}; the dagger is ${dagger}`);
    check(group?.possession === dagger, '9. the mummy absorbed the dagger');
    check(game.ctx.thrownWeapons.has(dagger), '9. it keeps its tag there');
    if (group) {
      game.systems.monsterDamage.damageMonsterGroup(group, level, from.x + 1, from.y, 10000, true, false);
    }
    const there = new Position(from.x + 1, from.y, level);
    check(game.ctx.dungeon.findFirstMonster(there) === OBJECT_ID_EOF && onFloor(game, there, dagger), '9. the mummy dies and drops it');
    step(game, from.x + 1);
    check(getChampionPossession(thrower(game), 1) === dagger, '9. the party walks there and gathers it');
  }
}

/* ------------------------------------------------------ 10. arriving on a level --- */
{
  console.log('\n=== 10. arriving on a level ===');
  const game = makeGame();
  const dungeon = game.ctx.dungeon;
  const dagger = weapon(game, WEAPON_DAGGER);
  tagThrownWeapon(game.ctx, dagger, 0, 1);
  // An empty open square of map 1: where stairs or a pit could set the party down.
  const map = dungeon.getMap(1)!;
  let at: Position | null = null;
  for (let x = 1; x < map.descriptor.width - 1 && !at; x++) {
    for (let y = 1; y < map.descriptor.height - 1 && !at; y++) {
      const flags = map.cellFlags[x]?.[y] ?? 0;
      if (((flags >> 5) & 7) === RoomType.OPEN && (flags & 0x10) === 0) at = new Position(x, y, 1);
    }
  }
  check(at !== null, '10. map 1 has an empty open square');
  const square = at ?? CORRIDOR;
  dungeon.addObjectToCell(square, dungeon.rnMaps.setPos(dagger, 0));
  game.ctx.party.state.position = new Position(square.x, square.y, 0);
  game.ctx.loop.newPartyLevel = 1;
  game.loadNewPartyLevel();
  console.log(`the party arrives on ${where(game.ctx.party.state.position)}`);
  check(game.ctx.party.state.position.z === 1, '10. the party is on map 1');
  check(getChampionPossession(thrower(game), 1) === dagger && !onFloor(game, square, dagger), '10. the arrival gathers the dagger');
}

/* ------------------------------------------------------ 11. a club among daggers --- */
{
  console.log('\n=== 11. a club among daggers ===');
  const game = makeGame();
  const dungeon = game.ctx.dungeon;
  const tables = game.ctx.tables;
  const club = weapon(game, WEAPON_CLUB);
  const fits = (object: ObjectID, slot: number): boolean =>
    ((tables.objDescWord4[DescIndex(dungeon, object)] ?? 0) & (tables.carryLocation[slot] ?? 0)) !== 0;
  check(fits(club, 12) && ![7, 8, 9].some((slot) => fits(club, slot)), '11. the club fits quiver slot 12, not 7-9');
  const daggers = Array.from({ length: 5 }, () => weapon(game, WEAPON_DAGGER));
  check([7, 8, 9, 12].every((slot) => fits(daggers[0]!, slot)), '11. a dagger fits every quiver slot');
  const square = new Position(CORRIDOR.x + 2, CORRIDOR.y, 0);
  for (const object of [...daggers, club]) {
    tagThrownWeapon(game.ctx, object, 0, 1);
    dungeon.addObjectToCell(square, dungeon.rnMaps.setPos(object, 0));
  }
  const chain: ObjectID[] = [];
  for (let rn = dungeon.findFirstObject(square); rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) chain.push(rn);
  check(chain.indexOf(club) > Math.max(...daggers.map((d) => chain.indexOf(d))), '11. the club lies after every dagger');
  const slots = [1, 7, 8, 9, 12, 13];
  check(slots.every((slot) => getChampionPossession(thrower(game), slot) === OBJECT_ID_NULL), '11. the hand, the quiver and the pack start empty');
  step(game, square.x - 1);
  step(game, square.x);
  const held = slots.map((slot) => getChampionPossession(thrower(game), slot));
  const name = (o: ObjectID): string => (o === club ? 'club' : o === OBJECT_ID_NULL ? '-' : `dagger ${daggers.indexOf(o) + 1}`);
  console.log(slots.map((slot, i) => `${slot}: ${name(held[i]!)}`).join(', '));
  check(![...daggers, club].some((o) => onFloor(game, square, o)), '11. all six are gathered');
  check(held[0] === daggers[0], '11. the first dagger goes back to the hand it left');
  check(held[4] === club, '11. the club takes quiver slot 12');
  check([1, 2, 3].every((i) => daggers.slice(1, 4).includes(held[i]!)), '11. daggers 2-4 fill slots 7-9');
  check(held[5] === daggers[4], '11. the last dagger goes to the pack');
}

finish();
