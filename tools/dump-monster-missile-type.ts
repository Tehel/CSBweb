/**
 * The missile a monster's attack names, in the parameter block the Monster Attack Filter
 * is handed.
 *
 * `MonsterAttacks` starts from `missile = RNnul`, lets the monster's type pick a spell
 * RN, and stores `attackParameters.missileType = missile.ConvertToInteger()`
 * (`doc/CSBwin-src/Monster.cpp:1041-1076`). So a monster that throws nothing reports
 * 0xffff, not 0. Walks every level, stands the party on it, and lets one group of each
 * monster type the dungeon holds attack once.
 *
 * A thrower's attack at range must also put the spell in flight: `LaunchMissile` takes
 * the spell RN as the projectile as it is (`doc/CSBwin-src/Monster.cpp:1194-1203`), so
 * the group's cell gains a missile whose projectile is that RN. The same holds for a
 * champion's spell attack, through `LaunchObject` (`doc/CSBwin-src/Magic.cpp:449-462`).
 *
 * The block is filled in CSBWin's order, which is the order of its random draws
 * (`doc/CSBwin-src/Monster.cpp:1035-1076`): whether to launch, then which missile. And a
 * `word2Bit4` monster that finds no live champion gives up there (`:1092`): no missile,
 * no range drawn, and false.
 *
 * Run: `npx tsx tools/dump-monster-missile-type.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DBType, OBJECT_ID_EOF, OBJECT_ID_NULL, Position, type ObjectID } from '../src/core/types';
import {
  RN_DISPELL_MISSILE, RN_FIREBALL, RN_LIGHTNING, RN_POISON, RN_POISON_CLOUD, RN_ZO_SPELL,
} from '../src/core/spellRn';
import { DungeonLoader } from '../src/data/DungeonLoader';
import type { Item16Record } from '../src/data/dungeonTypes';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { addCharacterDefaults } from '../src/engine/AddCharacter';
import { makeAddCharacterAttributes } from '../src/engine/attributes';
import { emptyPossessions, type Champion } from '../src/engine/gameTypes';
import { MonsterType } from '../src/engine/monsterTypes';
import { newGame } from './lib/game';
import { check, finish } from './lib/check';

/** The missiles each thrower may pick (`doc/CSBwin-src/Monster.cpp:1042-1075`). */
const THROWS: ReadonlyMap<number, readonly number[]> = new Map([
  [MonsterType.mon_Vexirk, [RN_FIREBALL, RN_DISPELL_MISSILE, RN_LIGHTNING, RN_POISON_CLOUD, RN_ZO_SPELL]],
  [MonsterType.mon_LordChaos, [RN_FIREBALL, RN_DISPELL_MISSILE, RN_LIGHTNING, RN_POISON_CLOUD, RN_ZO_SPELL]],
  [MonsterType.mon_SlimeDevil, [RN_POISON]],
  [MonsterType.mon_FlyingEye, [RN_LIGHTNING, RN_ZO_SPELL]],
  [MonsterType.mon_Zytaz, [RN_POISON_CLOUD, RN_FIREBALL]],
  [MonsterType.mon_Demon, [RN_FIREBALL]],
  [MonsterType.mon_Dragon, [RN_FIREBALL]],
]);

function champion(i: number): Champion {
  return {
    ...addCharacterDefaults(),
    name: `HERO${i}`,
    attributes: {
      health: 999, maxHealth: 999, stamina: 100, maxStamina: 100, mana: 0, maxMana: 0,
      stats: makeAddCharacterAttributes([60, 60, 50, 50, 50, 20, 20]),
    },
    incantation: [], food: 1500, water: 1500,
    skills: [],
    possessions: emptyPossessions(),
    partyPosition: i,
  };
}

const hex = (v: number): string => '0x' + (v >>> 0).toString(16).padStart(4, '0');

/** The missiles in a cell, each by its projectile. */
function missilesIn(game: ReturnType<typeof newGame>, at: Position): Map<ObjectID, ObjectID> {
  const dungeon = game.ctx.dungeon;
  const found = new Map<ObjectID, ObjectID>();
  for (let rn = dungeon.findFirstObject(at); rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) {
    if (game.ctx.dungeon.rnMaps.dbType(rn) !== DBType.MISSILE) continue;
    const missile = dungeon.getMissileRecord(rn);
    if (missile) found.set(rn, missile.projectileObject);
  }
  return found;
}

function main(): void {
  const loader = new DungeonLoader();
  loader.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/dungeon.dat'))));
  const data = loader.getData();
  if (!data) throw new Error('dungeon.dat did not load');
  const graphics = new GraphicsLoader();
  graphics.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/graphics.dat'))));

  const game = newGame(data, graphics);
  // A fixed seed, so the throwers' picks repeat run to run.
  game.setRandomSeed(0x12345678);
  for (let i = 0; i < 4; i++) game.systems.hallOfChampions.addChampion(champion(i));
  const dungeon = game.ctx.dungeon;

  console.log(['level', 'type', 'name', 'at', 'launch', 'missileType'].join('\t'));
  const seen = new Set<number>();
  let throwers = 0;
  let others = 0;
  for (let level = 0; level < data.maps.length; level++) {
    game.ctx.party.state.position = new Position(0, 0, level);
    game.systems.monsters.loadPartyLevel(level);
    for (const slot of dungeon.getItem16Pool()) {
      if (slot.word0 < 0) continue;
      const rec = dungeon.getCreatureRecordByIndex(slot.word0);
      if (!rec || seen.has(rec.creatureType)) continue;
      seen.add(rec.creatureType);

      const rn = game.ctx.dungeon.rnMaps.rn(DBType.CREATURE, slot.word0);
      const cell = new Position(slot.uByte10, slot.uByte11, level);
      const before = missilesIn(game, cell);
      game.systems.monsterAttack.monsterAttacks(rn, rec, slot.uByte10, slot.uByte11, 0, {
        level, primaryDirectionToParty: 0, orthogonalDistanceToParty: 2,
      });
      const p = game.systems.monsterAttack.attackParameters;
      const name = MonsterType[rec.creatureType] ?? String(rec.creatureType);
      console.log([
        level, rec.creatureType, name, `(${slot.uByte10},${slot.uByte11})`,
        p.monsterShouldLaunchMissile ? 1 : 0, hex(p.missileType),
      ].join('\t'));

      const picks = THROWS.get(rec.creatureType);
      if (picks) {
        throwers++;
        check(picks.includes(p.missileType), `${name} names one of its own missiles (${hex(p.missileType)})`);
        if (p.monsterShouldLaunchMissile) {
          const launched = [...missilesIn(game, cell)].filter(([m]) => !before.has(m)).map(([, o]) => o);
          check(
            launched.length === 1 && launched[0] === p.missileType,
            `${name} puts its ${hex(p.missileType)} in flight (launched: ${launched.map(hex).join(', ') || 'nothing'})`,
          );
        }
      } else {
        others++;
        check(p.missileType === OBJECT_ID_NULL, `${name}, which throws nothing, names RNnul (${hex(p.missileType)})`);
      }
    }
  }

  console.log('');
  check(throwers > 0, `the dungeon holds a monster that throws (${throwers} type(s))`);
  check(others > 0, `the dungeon holds a monster that throws nothing (${others} type(s))`);

  // A champion's spell attack (`CharacterThrowsSpell` -> `LaunchObject`) launches the
  // spell RN from the party's own cell.
  const partyCell = new Position(game.ctx.party.state.position.x, game.ctx.party.state.position.y, game.ctx.party.state.position.z);
  const before = missilesIn(game, partyCell);
  const ok = game.ctx.systems.magic.launchObject(0, RN_FIREBALL, 20, 90, 8);
  const launched = [...missilesIn(game, partyCell)].filter(([m]) => !before.has(m)).map(([, o]) => o);
  check(
    ok === 1 && launched.length === 1 && launched[0] === RN_FIREBALL,
    `LaunchObject puts a champion's fireball in flight (launched: ${launched.map(hex).join(', ') || 'nothing'})`,
  );

  // A group of the dungeon's made a Vexirk, which throws and hits a random champion
  // (`word2Bit4`), at corner 0, so no coin toss picks its side.
  let vexirk: { rn: ObjectID; slot: Item16Record; level: number } | null = null;
  for (let level = 0; level < data.maps.length && !vexirk; level++) {
    game.ctx.party.state.position = new Position(0, 0, level);
    game.systems.monsters.loadPartyLevel(level);
    const slot = dungeon.getItem16Pool().find((s) => s.word0 >= 0);
    if (slot) vexirk = { rn: game.ctx.dungeon.rnMaps.rn(DBType.CREATURE, slot.word0), slot, level };
  }
  if (!vexirk) throw new Error('no group in the dungeon');
  const vRec = dungeon.getCreatureRecordByIndex(vexirk.slot.word0)!;
  vRec.creatureType = MonsterType.mon_Vexirk;
  vexirk.slot.positions = 0;
  const vCell = new Position(vexirk.slot.uByte10, vexirk.slot.uByte11, vexirk.level);
  const random = game.ctx.random;
  /** `attack` with `STRandomBool` giving `bools`, `STRandom0_3` `quarters`, then 0; the `STRandom(n)` draws. */
  const scripted = (bools: number[], quarters: number[], attack: () => void): number => {
    let belowDraws = 0;
    random.bool = () => bools.shift() ?? 0;
    random.zeroTo3 = () => quarters.shift() ?? 0;
    random.below = () => { belowDraws++; return 0; };
    try {
      attack();
    } finally {
      delete (random as Partial<typeof random>).bool;
      delete (random as Partial<typeof random>).zeroTo3;
      delete (random as Partial<typeof random>).below;
    }
    return belowDraws;
  };
  const vexirkAttacks = (distance: number): boolean =>
    game.systems.monsterAttack.monsterAttacks(vexirk.rn, vRec, vCell.x, vCell.y, 0, {
      level: vexirk.level, primaryDirectionToParty: 0, orthogonalDistanceToParty: distance,
    });

  scripted([1, 0], [1, 0], () => vexirkAttacks(1));
  const p = game.systems.monsterAttack.attackParameters;
  console.log(`a Vexirk next to the party, tosses 1, 0 and quarters 1, 0: launch ${p.monsterShouldLaunchMissile}, missile ${hex(p.missileType)}`);
  check(p.monsterShouldLaunchMissile === 1 && p.missileType === RN_LIGHTNING,
    'the first toss decides the launch, the second and a quarter the missile: a lightning bolt');

  const champions = game.ctx.party.state.champions;
  const health = champions.map((c) => c.attributes.health);
  for (const c of champions) c.attributes.health = 0;
  const beforeDead = missilesIn(game, vCell);
  let attacked = true;
  const rangeDraws = scripted([1], [], () => { attacked = vexirkAttacks(2); });
  const thrown = [...missilesIn(game, vCell)].filter(([m]) => !beforeDead.has(m)).length;
  console.log(`a Vexirk at range, no champion alive: ${attacked}, ${thrown} missile(s), ${rangeDraws} range draw(s)`);
  check(!attacked && thrown === 0 && rangeDraws === 0,
    'a word2Bit4 monster that finds no live champion gives up: false, no missile, no range drawn');
  champions.forEach((c, i) => { c.attributes.health = health[i]!; });
  finish();
}

main();
