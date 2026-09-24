/**
 * A missile reaching a monster: which member it hits, and how hard.
 *
 * `ProcessMissileEncounter`'s monster arm (`doc/CSBwin-src/Code11f52.cpp:1960-2042`):
 *
 *   - the victim is `OrdinalOfMonsterAtPosition(group, objectPos)` — the member standing
 *     in the corner the missile arrived at. Nobody there lets the missile fly on, unless
 *     the group is `drawAsSize4`, when member 1 takes it;
 *   - a fireball reaching a Black Flame heals it by `DetermineMagicDamage`, capped at
 *     1000, and the missile is simply gone — no damage, no explosion;
 *   - otherwise the damage is `64 * DetermineMagicDamage(...)`, cut to 16 bits, divided
 *     by the descriptor's `defense08`, plus `DeterminePoisonDamage(type, d.Word12962)`;
 *   - `RNprojectile` is still the *potion* all through the switch: a thrown Ven or Ful
 *     potion only becomes its cloud in the shared tail (`:2060-2063`). So the blow a
 *     bomb lands before it explodes is a thrown object's — weight and a random 0-3 —
 *     for a monster and for a champion alike.
 *
 * The port used to hand the missile's raw `damageRemaining` to `DamageMonster`, hit the
 * first living member whatever the corner, and turn a potion into its cloud before the
 * switch. Each scenario below records `DetermineMagicDamage`, `DeterminePoisonDamage`
 * and `DamageMonster` as the real engine calls them, and checks the arithmetic.
 *
 * Run: `npx tsx tools/dump-missile-monster.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { PotionType } from '../src/core/constants';
import { sw } from '../src/core/intCast';
import { RN_FIREBALL } from '../src/core/spellRn';
import { DBType, OBJECT_ID_EOF, Position, RoomType, decodeObjectID, encodeObjectID } from '../src/core/types';
import type { ObjectID } from '../src/core/types';
import type { CreatureRecord } from '../src/data/dungeonTypes';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { Game } from '../src/engine/Game';
import { makeAddCharacterAttributes } from '../src/engine/attributes';
import type { Champion } from '../src/engine/gameTypes';
import { MonsterType } from '../src/engine/monsterTypes';
import {
  extractObjectTables, monsterAbsorbsDaggersEtc, monsterHorizontalSize, monsterInvincible,
  monsterNonMaterial, type MonsterDesc,
} from '../src/renderer/csbwin/ObjectTables';
import { extractViewportTables } from '../src/renderer/csbwin/ViewportTables';
import { extractUITables } from '../src/renderer/csbwin/UITables';
import { check, fail, finish } from './lib/check';
import { createMonsterAt } from './lib/createMonster';

const WEAPON_FALCHION = 9;
const EAST = 1;

function champion(i: number): Champion {
  return {
    name: `HERO${i}`,
    attributes: {
      health: 500, maxHealth: 500, stamina: 500, maxStamina: 500, mana: 0, maxMana: 0,
      stats: makeAddCharacterAttributes([60, 60, 50, 50, 50, 20, 20]),
      experience: 0, fighter: 0, ninja: 0, priest: 0, wizard: 0,
    },
    alive: true, incantation: [], food: 1500, water: 1500,
    skills: [],
    possessions: new Array(30).fill(null),
    partyPosition: i,
  };
}

const loader = new DungeonLoader();
loader.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/dungeon.dat'))));
const graphics = new GraphicsLoader();
graphics.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/graphics.dat'))));
const viewportTables = extractViewportTables(graphics);
const objectTables = extractObjectTables(graphics, viewportTables.wallRectanglesOffset);
const uiTables = extractUITables(graphics);

function makeGame(): Game {
  // A fresh copy of the dungeon each time: every scenario mutates it.
  const fresh = new DungeonLoader();
  fresh.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/dungeon.dat'))));
  const data = fresh.getData();
  if (!data) throw new Error('dungeon.dat did not load');
  const game = new Game(
    data,
    {
      roomTimerFunctions: uiTables.graphic232.byte1596,
      monsterDesc: objectTables.monsterDesc,
      objDescObjectType: objectTables.objDescObjectType,
      weaponDesc: objectTables.weaponDesc,
      weaponWeights: objectTables.weaponWeights,
      clothingWeights: objectTables.clothingWeights,
      miscWeights: objectTables.miscWeights,
    },
    {
      monsterDesc: objectTables.monsterDesc,
      word1074: uiTables.graphic232.word1074,
      soundTable: uiTables.graphic232.soundTable,
      doorCharacteristics: objectTables.doorCharacteristics,
      monsterDroppings: objectTables.monsterDroppings,
      facingReplication: objectTables.facingReplication,
      monsterAttackSounds: objectTables.monsterAttackSounds,
      uByte590: uiTables.graphic232.uByte590,
      byte586: uiTables.graphic232.byte586,
      clothingArmour: objectTables.clothingArmour,
      clothingFlags: objectTables.clothingFlags,
      byte1412: uiTables.graphic232.byte1412,
    },
  );
  game.setRandomSeed(0x2468ace0);
  game.addChampion(champion(0));
  return game;
}

const roomType = (flags: number): number => (flags >> 5) & 0x7;

/**
 * A target cell with an open, empty neighbour to the west to fire from, and a third open
 * cell on another row for the party to stand in, out of the missile's way.
 */
function findRange(game: Game, level: number): { target: Position; party: Position } | null {
  const map = game.dungeonState.getMap(level);
  if (!map) return null;
  let target: Position | null = null;
  for (let x = 2; x < map.descriptor.width - 1 && !target; x++) {
    for (let y = 1; y < map.descriptor.height - 1; y++) {
      const here = map.cellFlags[x]?.[y] ?? 0;
      const west = map.cellFlags[x - 1]?.[y] ?? 0;
      if (roomType(here) !== RoomType.OPEN || roomType(west) !== RoomType.OPEN) continue;
      if ((here & 0x10) !== 0 || (west & 0x10) !== 0) continue; // both start empty
      target = new Position(x, y, level);
      break;
    }
  }
  if (!target) return null;
  for (let x = 1; x < map.descriptor.width - 1; x++) {
    for (let y = 1; y < map.descriptor.height - 1; y++) {
      if (Math.abs(y - target.y) < 3) continue;
      const here = map.cellFlags[x]?.[y] ?? 0;
      if (roomType(here) === RoomType.OPEN && (here & 0x10) === 0) {
        return { target, party: new Position(x, y, level) };
      }
    }
  }
  return null;
}

/** A plain fighter: one corner wide, material, mortal, and not a dagger-swallower. */
function plainMonster(desc: MonsterDesc | undefined, type: number): boolean {
  return !!desc && type !== MonsterType.mon_BlackFlame && monsterHorizontalSize(desc) === 0 &&
    !monsterNonMaterial(desc) && !monsterInvincible(desc) && !monsterAbsorbsDaggersEtc(desc) &&
    desc.defense08 > 1;
}

type Arena = {
  game: Game;
  target: Position;
  launch: Position;
  group: CreatureRecord;
  desc: MonsterDesc;
};

/** A two-member group of a plain monster type the level allows, in the target cell. */
function makeArena(members: number): Arena | null {
  const game = makeGame();
  for (let level = 0; level < game.dungeonState.getMapCount(); level++) {
    for (let type = 0; type < objectTables.monsterDesc.length; type++) {
      const desc = objectTables.monsterDesc[type];
      if (!plainMonster(desc, type)) continue;
      if (!game.dungeonState.monsterAllowedOnLevel(type, level)) continue;
      const range = findRange(game, level);
      if (!range) continue;
      game.party.state.position = range.party;
      game.monsterSystem.loadPartyLevel(level);
      const rn = createMonsterAt(game, {
        value: type, hitPointMultiplier: 1, numMonM1: members - 1, facing: 0,
        mapX: range.target.x, mapY: range.target.y, level, invisible: false, drawAsSize4: false,
      });
      if (rn === null) continue;
      const group = game.dungeonState.getCreatureRecord(rn)!;
      for (let i = 0; i < members; i++) group.hp[i] = 900;
      // Keep the target where it is: without its movement timers the group cannot walk
      // out of the cell before the missile arrives.
      game.timerQueue.deleteMonsterMovementTimers(range.target.x, range.target.y, level);
      return {
        game, target: range.target, desc: desc!,
        launch: new Position(range.target.x - 1, range.target.y, level), group,
      };
    }
  }
  return null;
}

type Magic = { projectile: number; damage: number; poisonStrength: number };
type Hit = { index: number; damage: number };

/** Record what the encounter asks for, as the real engine asks it. */
function spy(game: Game): { magic: Magic[]; poison: number[]; hits: Hit[] } {
  const log = { magic: [] as Magic[], poison: [] as number[], hits: [] as Hit[] };
  const ts = game.timerSystem;
  const magic = ts.determineMagicDamage.bind(ts);
  ts.determineMagicDamage = (missile, projectile) => {
    const r = magic(missile, projectile);
    log.magic.push({ projectile, damage: r.damage, poisonStrength: r.poisonStrength });
    return r;
  };
  const md = game.monsterDamage;
  const poison = md.determinePoisonDamage.bind(md);
  md.determinePoisonDamage = (type, strength) => {
    const r = poison(type, strength);
    log.poison.push(r);
    return r;
  };
  const damage = md.damageMonster.bind(md);
  md.damageMonster = (monster, index, ...rest) => {
    log.hits.push({ index, damage: rest[3] });
    return damage(monster, index, ...rest);
  };
  return log;
}

function fly(game: Game, projectile: number, launch: Position): void {
  game.timerSystem.launchThrownMissile(projectile, launch, 0, EAST, 255, 255, 0, game.state.tickCount);
  for (let i = 0; i < 4; i++) {
    game.state.tickCount++;
    game.timerSystem.processTimers(game.state.tickCount);
  }
}

/** `D0L = 64 * (magic & 0xffff); D5W = sw((D0L & 0xffff) / defense08)` — `:2006-2012`. */
function monsterBlow(magic: number, defense08: number): number {
  return sw(Math.trunc(((64 * (magic & 0xffff)) & 0xffff) / (defense08 === 0 ? 1 : defense08)));
}

function newRecord<T>(game: Game, db: 'weapons' | 'potions', category: number, record: T): ObjectID {
  const database = game.dungeonState.getData().databases[db] as unknown as { records: T[]; count: number };
  database.records.push(record);
  database.count++;
  return encodeObjectID(0, category, database.records.length - 1) as ObjectID;
}

function cloudsIn(game: Game, cell: Position): number {
  let n = 0;
  for (let rn = game.dungeonState.findFirstObject(cell); rn !== OBJECT_ID_EOF; rn = game.dungeonState.getDBRecordLink(rn)) {
    if (decodeObjectID(rn).category === DBType.CLOUD) n++;
  }
  return n;
}

function main(): void {
  /* ----------------------- 1. a thrown weapon, into the member in that corner ------- */
  console.log('=== 1. a thrown falchion reaches a group of two ===');
  {
    const arena = makeArena(2);
    if (!arena) { fail('no level allows a plain monster with room to fire'); finish(); return; }
    const { game, group, desc, launch, target } = arena;
    // Member 0 in the south-west corner, member 1 in the north-west one — where a missile
    // flying east along the north row arrives.
    game.dungeonState.getAttachedItem16(group)!.positions = 3 | (0 << 2);
    const log = spy(game);
    const falchion = newRecord(game, 'weapons', DBType.WEAPON, {
      nextObject: OBJECT_ID_EOF, broken: false, charges: 0, litTorch: false, poisoned: false,
      cursed: false, important: false, weaponType: WEAPON_FALCHION,
    });
    console.log(`${MonsterType[group.creatureType]} x2 at (${target.x},${target.y}) level ${target.z}, defense08 ${desc.defense08}`);
    fly(game, falchion, launch);
    console.log(`DetermineMagicDamage: ${JSON.stringify(log.magic)}`);
    console.log(`DeterminePoisonDamage: ${JSON.stringify(log.poison)}`);
    console.log(`DamageMonster: ${JSON.stringify(log.hits)}   hp now [${group.hp.slice(0, 2)}]`);
    check(log.magic.length === 1 && log.magic[0]!.projectile === falchion,
      'the monster arm asks DetermineMagicDamage once, for the falchion');
    check(log.hits.length === 1, 'and DamageMonster once');
    check(log.hits[0]?.index === 1, 'member 1, the one in the corner the missile reached — not member 0');
    const expected = monsterBlow(log.magic[0]?.damage ?? 0, desc.defense08) + (log.poison[0] ?? 0);
    console.log(`expected 64*${log.magic[0]?.damage}/${desc.defense08} + ${log.poison[0] ?? 0} = ${expected}`);
    check(log.hits[0]?.damage === expected, 'for 64 * magic / defense08 + poison, not the raw damageRemaining');
    check(group.hp[1] === 900 - expected && group.hp[0] === 900, 'the hit points agree');
  }

  /* ----------------------- 2. an empty corner lets it fly on ------------------------ */
  console.log('');
  console.log('=== 2. nobody in the corner the missile reaches ===');
  {
    const arena = makeArena(2)!;
    const { game, group, launch } = arena;
    // Both members on the south row: the north row is empty.
    game.dungeonState.getAttachedItem16(group)!.positions = 3 | (2 << 2);
    const log = spy(game);
    const falchion = newRecord(game, 'weapons', DBType.WEAPON, {
      nextObject: OBJECT_ID_EOF, broken: false, charges: 0, litTorch: false, poisoned: false,
      cursed: false, important: false, weaponType: WEAPON_FALCHION,
    });
    fly(game, falchion, launch);
    console.log(`DamageMonster: ${JSON.stringify(log.hits)}   hp now [${group.hp.slice(0, 2)}]`);
    check(log.hits.length === 0 && group.hp[0] === 900 && group.hp[1] === 900,
      'OrdinalOfMonsterAtPosition says 0 and the group is not drawAsSize4: nobody is hit');
  }

  /* ----------------------- 3. a fireball feeds a Black Flame ------------------------ */
  console.log('');
  console.log('=== 3. a fireball reaching a Black Flame ===');
  {
    const arena = makeArena(1)!;
    const { game, group, launch, target } = arena;
    group.creatureType = MonsterType.mon_BlackFlame;
    group.hp[0] = 100;
    const log = spy(game);
    fly(game, RN_FIREBALL, launch);
    const magic = log.magic[0]?.damage ?? 0;
    console.log(`DetermineMagicDamage: ${JSON.stringify(log.magic)}   hp 100 -> ${group.hp[0]}`);
    check(log.magic.length === 1, 'the heal is one DetermineMagicDamage');
    check(group.hp[0] === Math.min(1000, 100 + magic), 'the Black Flame gains exactly that many hit points');
    check(log.hits.length === 0, 'and takes no damage');
    check(cloudsIn(game, target) === 0, 'and the fireball does not explode');
  }

  /* ----------------------- 4. a Ful bomb is a thrown potion until the tail ---------- */
  console.log('');
  console.log('=== 4. a thrown Ful bomb ===');
  {
    const arena = makeArena(1)!;
    const { game, group, desc, launch } = arena;
    const bomb = newRecord(game, 'potions', DBType.POTION, {
      nextObject: OBJECT_ID_EOF, important: false, potionType: PotionType.FUL_BOMB, power: 40,
    });
    const log = spy(game);
    fly(game, bomb, launch);
    console.log(`DetermineMagicDamage: ${JSON.stringify(log.magic)}`);
    console.log(`DamageMonster: ${JSON.stringify(log.hits)}`);
    check(log.magic[0]?.projectile === bomb, 'at a monster, the blow is DetermineMagicDamage of the potion, not RNFireball');
    const expected = monsterBlow(log.magic[0]?.damage ?? 0, desc.defense08) + (log.poison[0] ?? 0);
    check(log.hits[0]?.damage === expected, 'through the same 64 / defense08 formula');
    check(log.hits.length >= 2, 'and then the fireball it becomes explodes on the group');
    check(group.hp[0] === 900 - log.hits.reduce((sum, h) => sum + h.damage, 0), 'the hit points agree');
  }
  {
    const game = makeGame();
    const range = findRange(game, 0)!;
    game.party.state.position = range.target;
    game.monsterSystem.loadPartyLevel(range.target.z);
    game.party.state.champions[0]!.partyPosition = 0;
    const bomb = newRecord(game, 'potions', DBType.POTION, {
      nextObject: OBJECT_ID_EOF, important: false, potionType: PotionType.FUL_BOMB, power: 40,
    });
    const log = spy(game);
    fly(game, bomb, new Position(range.target.x - 1, range.target.y, range.target.z));
    console.log(`at the party, DetermineMagicDamage: ${JSON.stringify(log.magic)}`);
    check(log.magic[0]?.projectile === bomb, 'at a champion too, the blow is the potion\'s');
  }

  finish();
}

main();
