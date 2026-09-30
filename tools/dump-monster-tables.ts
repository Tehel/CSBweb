/**
 * Dump the monster and attack tables extracted at runtime from `graphics.dat`.
 *
 * Phase 12 widened `MONSTERDESC` from 4 fields to the full 26-byte record
 * (doc/CSBwin-src/CSB.h:2256) and reached into the attack tables that
 * `parseGraphic230` used to skip past (doc/CSBwin-src/Data.h:638-651). Neither is
 * verifiable by eye in the running game, so this prints them for inspection.
 *
 * The attack names are the canary: if the graphic 0x230 offsets are right they read
 * as "BLOCK", "CHOP", "PUNCH", … in ATTACKTYPE order.
 *
 * Run: `npx tsx tools/dump-monster-tables.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { GraphicsLoader } from '../src/data/GraphicsLoader';
import {
  monsterBravery,
  monsterCanSeeInDark,
  monsterHorizontalSize,
  monsterInvincible,
  monsterLevitating,
  monsterNonMaterial,
  monsterSee360,
  monsterSightDistance,
  monsterSmellingDistance,
  monsterVerticalSize,
} from '../src/data/tables/MonsterDesc';
import { AttackType, MonsterType } from '../src/engine/monsterTypes';
import { check, finish } from './lib/check';
import { graphicsTablesOf } from './lib/game';

const DEFAULT_GRAPHICS = 'static/gamefiles/dm-atari/graphics.dat';

function main(): void {
  const path = resolve(process.cwd(), process.argv[2] ?? DEFAULT_GRAPHICS);
  const graphics = new GraphicsLoader();
  graphics.loadFromArray(new Uint8Array(readFileSync(path)));

  const objectTables = graphicsTablesOf(graphics).objects;
  const uiTables = graphicsTablesOf(graphics).ui;
  const g230 = uiTables.graphic230;

  console.log('=== MONSTERDESC[27] (graphics.dat 0x22f) ===');
  console.log(
    ['mt', 'snd', 'move', 'atkT', 'def', 'hp', 'atk', 'psn', 'dex', 'sight', 'smell', 'brave', 'hSz', 'vSz', 'flags']
      .map((h) => h.padStart(6))
      .join('')
  );
  objectTables.monsterDesc.forEach((d, i) => {
    const flags = [
      monsterNonMaterial(d) ? 'nonMat' : '',
      monsterInvincible(d) ? 'invinc' : '',
      monsterLevitating(d) ? 'levit' : '',
      monsterSee360(d) ? 'see360' : '',
      monsterCanSeeInDark(d) ? 'dark' : '',
    ].filter(Boolean).join(',');
    const cells = [
      i, d.attackSound, d.movementTicks06, d.attackTicks07, d.defense08, d.baseHealth09,
      d.attack10, d.poisonAttack11, d.dexterity12, monsterSightDistance(d),
      monsterSmellingDistance(d), monsterBravery(d), monsterHorizontalSize(d), monsterVerticalSize(d),
    ];
    console.log(cells.map((c) => String(c).padStart(6)).join('') + '  ' + flags);
  });

  console.log('\n=== Attack tables (graphics.dat 0x230), indexed by ATTACKTYPE ===');
  console.log(['#', 'name', 'skill', 'exp', 'b20090', 'b20046', 'b20002', 'b19958', 'b19914'].join('\t'));
  for (let i = 0; i < 44; i++) {
    console.log([
      i,
      g230.attackNames[i] ?? '<none>',
      g230.skillNumber[i],
      g230.experienceForAttacking[i],
      g230.byte20090[i],
      g230.byte20046[i],
      g230.byte20002[i],
      g230.byte19958[i],
      g230.byte19914[i],
    ].join('\t'));
  }

  console.log(`\nattackNames parsed: ${g230.attackNames.length}`);

  console.log('\n=== legalAttacks[44] (attack class -> up to 3 attack options) ===');
  g230.legalAttacks.forEach((la, i) => {
    const named = [0, 1, 2].map((k) => {
      const t = la[k] ?? 255;
      if (t === 255) return '-';
      const mastery = k === 0 ? '' : `@${(la[k + 3] ?? 0) & 0x7f}${((la[k + 3] ?? 0) & 0x80) ? '+charges' : ''}`;
      return `${g230.attackNames[t] ?? `?${t}`}${mastery}`;
    });
    console.log(`class ${String(i).padStart(2)}: [${Array.from(la).map((b) => String(b).padStart(3)).join(' ')}]  ${named.join(' / ')}`);
  });

  console.log('');

  // The canary. These names are the strongest evidence the graphic 0x230 offsets are
  // right: a wrong offset gives plausible-looking numbers everywhere else, but it
  // cannot spell BLOCK at ATTACKTYPE 1 and FUSE at 43. They are spread across the
  // whole table on purpose — a shifted base would move all of them together.
  const NAME_CANARY: [AttackType, string][] = [
    [AttackType.atk_BLOCK, 'BLOCK'],
    [AttackType.atk_CHOP, 'CHOP'],
    [AttackType.atk_PUNCH, 'PUNCH'],
    [AttackType.atk_KICK, 'KICK'],
    [AttackType.atk_FIREBALL, 'FIREBALL'],
    [AttackType.atk_MELEE, 'MELEE'],
    [AttackType.atk_FLUXCAGE, 'FLUXCAGE'],
    [AttackType.atk_FUSE, 'FUSE'],
  ];
  for (const [type, want] of NAME_CANARY) {
    check(g230.attackNames[type] === want,
      `attackNames[${AttackType[type] ?? type}] is '${want}' (got '${g230.attackNames[type] ?? '<none>'}')`);
  }

  check(g230.legalAttacks.length === 44, `legalAttacks has 44 classes (got ${g230.legalAttacks.length})`);
  check(objectTables.monsterDesc.length === 27, `MONSTERDESC has 27 entries (got ${objectTables.monsterDesc.length})`);

  // A second canary, in the other table: the Ant Man's sight distance is what
  // tools/dump-monster-perception.ts measures the AI against.
  const antMan = objectTables.monsterDesc[MonsterType.mon_AntMan];
  check(antMan !== undefined && monsterSightDistance(antMan) === 3,
    `Ant Man sightDistance is 3 (got ${antMan ? monsterSightDistance(antMan) : 'no record'})`);

  finish();
}

main();
