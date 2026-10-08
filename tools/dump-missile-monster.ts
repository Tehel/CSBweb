/**
 * A missile reaching a monster: which member it hits, and how hard.
 *
 * `ProcessMissileEncounter`'s monster arm (`doc/CSBwin-src/Code11f52.cpp:1995-2077`):
 *
 *   - the victim is `OrdinalOfMonsterAtPosition(group, objectPos)` — the member standing
 *     in the corner the missile arrived at. Nobody there lets the missile fly on, unless
 *     the group is `drawAsSize4()` (bit 12, with the `drawAsSize4Monsters` design option
 *     on), when member 1 takes it;
 *   - a fireball reaching a Black Flame heals it by `DetermineMagicDamage`, capped at
 *     1000, and the missile is simply gone — no damage, no explosion;
 *   - otherwise the damage is `64 * DetermineMagicDamage(...)`, cut to 16 bits, divided
 *     by the descriptor's `defense08`, plus `DeterminePoisonDamage(type, d.Word12962)`;
 *   - `RNprojectile` is still the *potion* all through the switch: a thrown Ven or Ful
 *     potion only becomes its cloud in the shared tail (`:2095-2098`). So the blow a
 *     bomb lands before it explodes is a thrown object's — weight and a random 0-3 —
 *     for a monster and for a champion alike.
 *
 * The port used to hand the missile's raw `damageRemaining` to `DamageMonster`, hit the
 * first living member whatever the corner, and turn a potion into its cloud before the
 * switch. Each scenario below records `DetermineMagicDamage`, `DeterminePoisonDamage`
 * and `DamageMonster` as the real engine calls them, and checks the arithmetic.
 *
 * Scenario 5 is the other way round: a member of a group of two, on level 2, sidesteps
 * before it melees, and `CheckMonsterVersusMissiles` finds a missile in the group's
 * corner that kills that member. The encounter looks the group up on `d.LoadedLevel`
 * (`Code11f52.cpp:1800`), which during a monster's turn is the monster's own level
 * (`LoadLevel(timeEnt.Level())`, `CSBCode.cpp:6475-6476`). `d.MonsterDamageResult` is
 * then 1, some but not all died, and the sidestep leaves the corners as the encounter
 * left them (`Monster.cpp:3973-3984`).
 *
 * Scenario 6: `CheckMonsterVersusMissiles` skips every missile whose `pos()` is not the
 * group's whole positions byte (`Monster.cpp:4491`), which both callers pass unmasked
 * (`:3896`, `:3974`). A lone monster spread over its cell (255), or one whose byte still
 * holds another member's corner, meets no missile at all.
 *
 * Run: `npx tsx tools/dump-missile-monster.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { PotionType } from '../src/core/constants';
import { sw } from '../src/core/intCast';
import { RN_FIREBALL } from '../src/core/spellRn';
import { DBType, OBJECT_ID_EOF, Position, RoomType } from '../src/core/types';
import type { ObjectID } from '../src/core/types';
import type { CreatureRecord } from '../src/data/dungeonTypes';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { Game } from '../src/engine/Game';
import { makeAddCharacterAttributes } from '../src/engine/attributes';
import type { Champion } from '../src/engine/gameTypes';
import { MonsterType } from '../src/engine/monsterTypes';
import { MonsterDamageResult } from '../src/engine/MonsterDamage';
import type { AiConst, AiFrame } from '../src/engine/MonsterAI';
import { MmRecord } from '../src/engine/MmRecord';
import { TimerFunction } from '../src/engine/TimerQueue';
import {
  monsterAbsorbsDaggersEtc,
  monsterHorizontalSize,
  monsterInvincible,
  monsterNonMaterial,
  monsterWord2Bit3,
  monsterWord2Bit4,
  type MonsterDesc,
} from '../src/data/tables/MonsterDesc';
import { graphicsTablesOf, newGame } from './lib/game';
import { check, fail, finish } from './lib/check';
import { createMonsterAt } from './lib/createMonster';
import { emptyPossessions } from '../src/engine/gameTypes';
import { addCharacterDefaults } from '../src/engine/AddCharacter';

const WEAPON_FALCHION = 9;
const EAST = 1;

function champion(i: number): Champion {
  return {
    ...addCharacterDefaults(),
    name: `HERO${i}`,
    attributes: {
      health: 500, maxHealth: 500, stamina: 500, maxStamina: 500, mana: 0, maxMana: 0,
      stats: makeAddCharacterAttributes([60, 60, 50, 50, 50, 20, 20]),
    },
    incantation: [], food: 1500, water: 1500,
    skills: [],
    possessions: emptyPossessions(),
    partyPosition: i,
  };
}

const loader = new DungeonLoader();
loader.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/dungeon.dat'))));
const graphics = new GraphicsLoader();
graphics.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/graphics.dat'))));
const objectTables = graphicsTablesOf(graphics).objects;

function makeGame(): Game {
  // A fresh copy of the dungeon each time: every scenario mutates it.
  const fresh = new DungeonLoader();
  fresh.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/dungeon.dat'))));
  const data = fresh.getData();
  if (!data) throw new Error('dungeon.dat did not load');
  const game = newGame(data, graphics);
  game.setRandomSeed(0x2468ace0);
  game.systems.hallOfChampions.addChampion(champion(0));
  return game;
}

const roomType = (flags: number): number => (flags >> 5) & 0x7;

/**
 * A target cell with an open, empty neighbour to the west to fire from, and a third open
 * cell on another row for the party to stand in, out of the missile's way.
 */
function findRange(game: Game, level: number): { target: Position; party: Position } | null {
  const map = game.ctx.dungeon.getMap(level);
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
  for (let level = 0; level < game.ctx.dungeon.getMapCount(); level++) {
    for (let type = 0; type < objectTables.monsterDesc.length; type++) {
      const desc = objectTables.monsterDesc[type];
      if (!plainMonster(desc, type)) continue;
      if (!game.ctx.dungeon.monsterAllowedOnLevel(type, level)) continue;
      const range = findRange(game, level);
      if (!range) continue;
      game.ctx.party.state.position = range.party;
      game.systems.monsters.loadPartyLevel(level);
      const rn = createMonsterAt(game, {
        value: type, hitPointMultiplier: 1, numMonM1: members - 1, facing: 0,
        mapX: range.target.x, mapY: range.target.y, level, invisible: false, drawAsSize4: false,
      });
      if (rn === null) continue;
      const group = game.ctx.dungeon.getCreatureRecord(rn)!;
      for (let i = 0; i < members; i++) group.hp[i] = 900;
      // Keep the target where it is: without its movement timers the group cannot walk
      // out of the cell before the missile arrives.
      game.ctx.timers.deleteMonsterMovementTimers(range.target.x, range.target.y, level);
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
  const me = game.systems.missileEncounter;
  const magic = me.determineMagicDamage.bind(me);
  me.determineMagicDamage = (missile, projectile) => {
    const r = magic(missile, projectile);
    log.magic.push({ projectile, damage: r.damage, poisonStrength: r.poisonStrength });
    return r;
  };
  const md = game.systems.monsterDamage;
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

function fly(game: Game, projectile: ObjectID, launch: Position): void {
  game.systems.magic.launchThrownMissile(projectile, launch, 0, EAST, 255, 255, 0, game.ctx.state.tickCount);
  for (let i = 0; i < 4; i++) {
    game.systems.timer.processTimers();
    game.ctx.state.tickCount++;
  }
}

/** `D0L = 64 * (magic & 0xffff); D5W = sw((D0L & 0xffff) / defense08)` — `:2041-2047`. */
function monsterBlow(magic: number, defense08: number): number {
  return sw(Math.trunc(((64 * (magic & 0xffff)) & 0xffff) / (defense08 === 0 ? 1 : defense08)));
}

function newRecord<T>(game: Game, db: 'weapons' | 'potions', category: number, record: T): ObjectID {
  const database = game.ctx.dungeon.getData().databases[db] as unknown as { records: T[]; count: number };
  database.records.push(record);
  database.count++;
  return game.ctx.dungeon.rnMaps.rn(category, database.records.length - 1);
}

function cloudsIn(game: Game, cell: Position): number {
  let n = 0;
  for (let rn = game.ctx.dungeon.findFirstObject(cell); rn !== OBJECT_ID_EOF; rn = game.ctx.dungeon.getDBRecordLink(rn)) {
    if (game.ctx.dungeon.rnMaps.dbType(rn) === DBType.CLOUD) n++;
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
    game.ctx.dungeon.getAttachedItem16(group)!.positions = 3 | (0 << 2);
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
    game.ctx.dungeon.getAttachedItem16(group)!.positions = 3 | (2 << 2);
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
  // The same group with bit 12 set: `drawAsSize4()` is `drawAsSize4Monsters && bit 12`
  // (`CSB.h:1130`), so the bit lets member 1 take it only with the design option on.
  for (const option of [false, true]) {
    const arena = makeArena(2)!;
    const { game, group, launch } = arena;
    game.ctx.dungeon.getAttachedItem16(group)!.positions = 3 | (2 << 2);
    group.drawAsSize4 = true;
    game.ctx.rules.drawAsSize4Monsters = option;
    const log = spy(game);
    const falchion = newRecord(game, 'weapons', DBType.WEAPON, {
      nextObject: OBJECT_ID_EOF, broken: false, charges: 0, litTorch: false, poisoned: false,
      cursed: false, important: false, weaponType: WEAPON_FALCHION,
    });
    fly(game, falchion, launch);
    console.log(`bit 12, drawAsSize4Monsters ${option}: DamageMonster: ${JSON.stringify(log.hits)}`);
    check(option ? log.hits.length === 1 && log.hits[0]!.index === 0 : log.hits.length === 0,
      option ? 'drawn as size 4: member 1 takes it (Code11f52.cpp:2000-2001)' : 'the bit means nothing with the option off: nobody is hit');
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
    game.ctx.party.state.position = range.target;
    game.systems.monsters.loadPartyLevel(range.target.z);
    game.ctx.party.state.champions[0]!.partyPosition = 0;
    const bomb = newRecord(game, 'potions', DBType.POTION, {
      nextObject: OBJECT_ID_EOF, important: false, potionType: PotionType.FUL_BOMB, power: 40,
    });
    const log = spy(game);
    fly(game, bomb, new Position(range.target.x - 1, range.target.y, range.target.z));
    console.log(`at the party, DetermineMagicDamage: ${JSON.stringify(log.magic)}`);
    check(log.magic[0]?.projectile === bomb, 'at a champion too, the blow is the potion\'s');
  }

  /* ----------------------- 5. a sidestep onto a missile that kills one member ------- */
  console.log('');
  console.log('=== 5. member 0 sidesteps before meleeing, and a missile in its corner kills it ===');
  {
    const arena = makeArena(2)!;
    const { game, group, desc, target } = arena;
    const slot = game.ctx.dungeon.getAttachedItem16(group)!;
    // Member 0 in corner 2, member 1 in corner 0: the whole byte is 2, which is what the
    // scan compares a missile's corner with (scenario 6).
    slot.positions = 2 | (0 << 2);
    group.hp[0] = 1;
    const falchion = newRecord(game, 'weapons', DBType.WEAPON, {
      nextObject: OBJECT_ID_EOF, broken: false, charges: 0, litTorch: false, poisoned: false,
      cursed: false, important: false, weaponType: WEAPON_FALCHION,
    });
    game.systems.magic.launchThrownMissile(falchion, target, 2, EAST, 255, 255, 0, game.ctx.state.tickCount);
    check(!monsterWord2Bit3(desc) || !monsterWord2Bit4(desc),
      `${MonsterType[group.creatureType]} always passes the sidestep's die test, so no roll decides the scenario`);

    const encounter = game.systems.missileEncounter;
    const process = encounter.processMissileEncounter.bind(encounter);
    let leftByEncounter = -1;
    encounter.processMissileEncounter = (...args) => {
      const hit = process(...args);
      leftByEncounter = slot.positions;
      return hit;
    };

    // Facing north (0) from corner 2, the member turns to corner 1, which is empty
    // (Monster.cpp:3954-3972).
    const frame: AiFrame = {
      timer: {
        index: -1, time: game.ctx.state.tickCount, level: target.z, function: TimerFunction.TT_MONSTER_B0,
        uByte5: 0, uByte6: target.x, uByte7: target.y, uByte8: 0, uByte9: 0, sequence: 0,
        timerWord8: 0, timerWord6: 0,
      },
      i60: 0, sinceLastUpdate: 0, timePerMove: 0, bool36: false, d5: 0, secondaryDirection: 0,
    };
    const c: AiConst = {
      monsterRn: game.ctx.dungeon.findFirstMonster(target), monster: group, slot,
      slotIndex: group.groupIndex, desc, mapX: target.x, mapY: target.y, level: target.z,
      timeUntilAlternateUpdate: 0, indexOfLastMonster: 1, horizSize: 0, invincible: false,
      xDistance: 0, yDistance: 1, attackDistance: 1, timerFunction: TimerFunction.TT_MONSTER_B0,
      fearFactorIs6: false, processingATimer: true, mmr: new MmRecord(),
    };
    const ai = game.ctx.systems.monsterAI as unknown as {
      sidestepBeforeMeleeing(frame: AiFrame, c: AiConst, member: number, preferredDirection: number): boolean;
    };
    const turnOver = ai.sidestepBeforeMeleeing(frame, c, 0, 0);
    console.log(`result ${encounter.monsterDamageResult}, members left ${(group.numMonM1 & 3) + 1}, ` +
      `positions after the encounter ${leftByEncounter}, after the sidestep ${slot.positions}`);
    check(turnOver, 'the sidestep ends the turn');
    check(target.z !== 0, `the group is on level ${target.z}, where an encounter on level 0 would find nobody`);
    check(encounter.monsterDamageResult === MonsterDamageResult.SOME_NOT_ALL_MONSTERS_DIED && (group.numMonM1 & 3) === 0,
      `the falchion killed member 0 and not member 1: d.MonsterDamageResult is 1 (${encounter.monsterDamageResult})`);
    check(leftByEncounter >= 0 && slot.positions === leftByEncounter,
      `so the corners stay as the encounter left them (${leftByEncounter}), not moved to corner 1 (${slot.positions})`);
  }

  /* ----------------------- 6. the scan compares the whole positions byte ----------- */
  console.log('');
  console.log('=== 6. CheckMonsterVersusMissiles against a missile in corner 3 of a lone monster ===');
  {
    const arena = makeArena(1)!;
    const { game, group, desc, target } = arena;
    const slot = game.ctx.dungeon.getAttachedItem16(group)!;
    const falchion = newRecord(game, 'weapons', DBType.WEAPON, {
      nextObject: OBJECT_ID_EOF, broken: false, charges: 0, litTorch: false, poisoned: false,
      cursed: false, important: false, weaponType: WEAPON_FALCHION,
    });
    game.systems.magic.launchThrownMissile(falchion, target, 3, EAST, 255, 255, 0, game.ctx.state.tickCount);
    const missilesIn = (): number => {
      let n = 0;
      for (let rn = game.ctx.dungeon.findFirstObject(target); rn !== OBJECT_ID_EOF; rn = game.ctx.dungeon.getDBRecordLink(rn)) {
        if (game.ctx.dungeon.rnMaps.dbType(rn) === DBType.MISSILE && game.ctx.dungeon.rnMaps.pos(rn) === 3) n++;
      }
      return n;
    };
    check(missilesIn() === 1, 'the missile is parked in corner 3 of the group\'s cell');

    const c: AiConst = {
      monsterRn: game.ctx.dungeon.findFirstMonster(target), monster: group, slot,
      slotIndex: group.groupIndex, desc, mapX: target.x, mapY: target.y, level: target.z,
      timeUntilAlternateUpdate: 0, indexOfLastMonster: 0, horizSize: 0, invincible: false,
      xDistance: 0, yDistance: 1, attackDistance: 0, timerFunction: TimerFunction.TT_MONSTER_B0,
      fearFactorIs6: false, processingATimer: true, mmr: new MmRecord(),
    };
    const ai = game.ctx.systems.monsterAI as unknown as {
      checkMonsterVersusMissiles(c: AiConst): boolean;
    };
    const log = spy(game);
    // `objD6.pos() != position` (Monster.cpp:4491): RN::pos() is 0-3, so only a byte whose
    // bits 2-7 are all 0 can equal it. 255 is a centred lone monster, as the shuffle at
    // Monster.cpp:3869 leaves one; 7 is member 0 in corner 3 over a stale member-1 corner.
    for (const positions of [255, 3 | (1 << 2)]) {
      slot.positions = positions;
      ai.checkMonsterVersusMissiles(c);
      console.log(`positions ${positions}: DamageMonster ${JSON.stringify(log.hits)}, missiles in corner 3: ${missilesIn()}`);
      check(log.hits.length === 0 && missilesIn() === 1 && group.hp[0] === 900,
        `positions ${positions} is not the missile's corner 3: the scan passes it by`);
    }
    slot.positions = 3;
    ai.checkMonsterVersusMissiles(c);
    console.log(`positions 3: DamageMonster ${JSON.stringify(log.hits)}, missiles in corner 3: ${missilesIn()}`);
    check(log.hits.length === 1 && log.hits[0]?.index === 0 && missilesIn() === 0,
      'positions 3 is: the missile meets member 0 and is gone');
  }

  finish();
}

main();
