/**
 * `ProcessMonsterDeleteFilter` (`doc/CSBwin-src/Code11f52.cpp:961-1055`), which every site
 * that deletes a group, or kills a member of one, runs first, against a genuine save
 * (`csbgame7.dat`), with DSAs at the filter's location.
 *
 * 1. **The kill is counted** in `expool`'s record `(EDT_Statistics << 24) |
 *    (ESTAT_NumMonsterKilled << 16) | (why << 8) | monsterType`, a longword per
 *    `alternateGraphics` (`:978-997`): a record of four when there is none, else the
 *    count is raised where the record stands, and the pool keeps its size.
 * 2. **Every DSA at the location runs**, each with a count of 8 and the block
 *    (`:1046-1047`): the group's RN, its level and square, the reason, `dropResidue`,
 *    `deathCloud`, and the member's index, -1 for the whole group (`CSB.h:2999-3006`).
 *    The second sees the block the first rewrote (`Code11f52.cpp:1049`), and both run on parameters of
 *    their own (`NEWDSAPARAMETERS`, `:963`).
 * 3. **`deathCloud` 2 shows no cloud, `dropResidue` 2 drops no remains**
 *    (`Code11f52.cpp:1149`, `:1159`, `:1150`, `:1166`). The group's last member drops them only for a
 *    `dropResidue` below 2, another member for anything but 2: so 3 drops a member's and
 *    not the last one's.
 * 4. **Each site gives its reason**: the party landing on a group (`DMW_Movement2`,
 *    `:3339`), a group on a level its type may not live on (`DMW_Movement1`, at its old
 *    square, `:3186-3194`), and `MakeMoreRoomInDB` (`DMW_MakeRoom`, `Character.cpp:281`).
 *
 * Run: `npm test -- --only=dump-delete-monster-filter.ts`
 */
import { DBType, OBJECT_ID_EOF, Position, type ObjectID } from '../src/core/types';
import { Expool } from '../src/data/CsbwinExpool';
import { StkOp } from '../src/engine/dsa/DsaTypes';
import type { Game } from '../src/engine/Game';
import { DeleteMonsterWhy } from '../src/engine/filterParameters';
import { makeMoreRoomInDB } from '../src/engine/MakeMoreRoomInDB';
import { MonsterType } from '../src/engine/monsterTypes';
import { UNSET, freshGame, globalStore, int, op, varFetch, varStore, withFilterDsas } from './lib/dsa';
import { standIn } from './lib/standIn';
import { check, finish } from './lib/check';

/** `ESL_DELETEMONSTERFILTER` (`doc/CSBwin-src/CSB.h:1545`). */
const ESL_DELETEMONSTERFILTER = 7;
const WORDS = 8;
const DROP_RESIDUE = 5;
const DEATH_CLOUD = 6;

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

/** The kill statistics' key (`doc/CSBwin-src/Code11f52.cpp:986`). */
const statsKey = (why: number, type: number): number => ((6 << 24) + (0 << 16) + (why << 8) + type) >>> 0;

/** Every group on the party's level: its RN and square. */
function groups(game: Game): { rn: ObjectID; at: Position }[] {
  const dungeon = game.ctx.dungeon;
  const z = game.ctx.party.state.position.z;
  return dungeon.getItem16Pool().filter((slot) => slot.word0 >= 0).map((slot) => ({
    rn: dungeon.rnMaps.rn(DBType.CREATURE, slot.word0),
    at: new Position(slot.uByte10, slot.uByte11, z),
  }));
}

/** The objects on `at`, by database. */
function census(game: Game, at: Position): { clouds: number; slices: number } {
  const dungeon = game.ctx.dungeon;
  let clouds = 0;
  let slices = 0;
  for (let rn = dungeon.findFirstObject(at); rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) {
    const type = dungeon.rnMaps.dbType(rn);
    if (type === DBType.CLOUD) clouds++;
    if (type === DBType.MISC) slices++;
  }
  return { clouds, slices };
}

/**
 * The first group made a lone Screamer, or a pair of them, which leave slices behind,
 * carrying nothing, and killed: member `index` of it, by a blow of 1000.
 */
function kill(game: Game, members: 1 | 2, index: number): { rn: ObjectID; at: Position } {
  const { rn, at } = groups(game)[0]!;
  const rec = game.ctx.dungeon.getCreatureRecord(rn)!;
  rec.creatureType = MonsterType.mon_Screamer;
  rec.possession = OBJECT_ID_EOF;
  rec.numMonM1 = members - 1;
  rec.hp = [50, 50, 0, 0];
  game.systems.monsterDamage.damageMonster(rec, index, at.z, at.x, at.y, 1000, true, false);
  return { rn, at };
}

const hex = (v: number): string => '0x' + (v >>> 0).toString(16);

/* ------------------------------- 1. the statistics ------------------------------ */
{
  const game = freshGame();
  const dungeon = game.ctx.dungeon;
  const [a, b] = groups(game);
  check(a !== undefined && b !== undefined, 'two groups on the party\'s level');
  const key = statsKey(DeleteMonsterWhy.DMW_Damage, MonsterType.mon_Mummy);
  const before = dungeon.locateExpoolRecord(key);
  const keys = (): number => new Expool(dungeon.getData()).keys().length;
  const sizes: number[] = [keys()];
  const counts: (number[] | null)[] = [];
  for (const { rn, at } of [a!, b!]) {
    const rec = dungeon.getCreatureRecord(rn)!;
    rec.creatureType = MonsterType.mon_Mummy;
    rec.alternateGraphics = 2;
    rec.numMonM1 = 0;
    rec.hp = [10, 0, 0, 0];
    game.systems.monsterDamage.damageMonster(rec, 0, at.z, at.x, at.y, 1000, true, false);
    counts.push(dungeon.locateExpoolRecord(key));
    sizes.push(keys());
  }
  console.log(`1. key ${hex(key)}: before ${before ? `[${before.join(', ')}]` : 'none'}, `
    + `after one Mummy [${counts[0]?.join(', ')}], after two [${counts[1]?.join(', ')}]; records ${sizes.join(' -> ')}`);
  const base = before ?? [0, 0, 0, 0];
  check(counts[0]?.join() === base.map((n, i) => n + (i === 2 ? 1 : 0)).join(), 'a kill of subtype 2 counts in longword 2');
  check(counts[1]?.join() === base.map((n, i) => n + (i === 2 ? 2 : 0)).join(), 'and the next one raises it');
  check(sizes[1] === sizes[0]! + (before === null ? 1 : 0) && sizes[2] === sizes[1],
    'one record is written where there was none, and the next kill writes none');
}

/* ------------------------------- 2, 3. two DSAs on a last member ----------------- */
{
  const plain = freshGame();
  const { at: plainAt } = kill(plain, 1, 0);
  const plainCensus = census(plain, plainAt);
  console.log(`no filter: a lone Screamer leaves ${plainCensus.clouds} cloud(s), ${plainCensus.slices} slice(s)`);
  check(plainCensus.clouds === 1 && plainCensus.slices > 0, 'with no filter there is a death cloud and slices');

  const game = withFilterDsas(ESL_DELETEMONSTERFILTER, [
    [...report(0), ...setWord(DEATH_CLOUD, 2), ...setWord(DROP_RESIDUE, 2)],
    report(30),
  ]);
  const dsa = game.systems.dsa;
  dsa.setParameters(3, [7, 8, 9]);
  const { rn, at } = kill(game, 1, 0);
  const g = dsa.getGlobalVariables();
  console.log(`2. the first DSA saw [${g.slice(0, 9).join(', ')}]`);
  console.log(`   the second saw [${g[30] === UNSET ? 'nothing' : g.slice(30, 39).join(', ')}]`);
  const seen = g.slice(1, 9);
  check(g[0] === WORDS, 'a count of 8');
  check(seen.join() === [rn, at.z, at.x, at.y, DeleteMonsterWhy.DMW_Damage, 0, 0, -1].join(),
    'the group\'s RN, level and square, DMW_Damage, the two defaults, and -1 for the whole group');
  const rewritten = seen.map((w, i) => (i === DEATH_CLOUD || i === DROP_RESIDUE ? 2 : w));
  check(g.slice(31, 39).join() === rewritten.join(), 'the second DSA runs too, on the block the first rewrote');
  check([0, 1, 2].map((i) => dsa.getParameter(i)).join() === '7,8,9', 'the caller\'s parameters are as they were');
  const after = census(game, at);
  console.log(`3. deathCloud 2, dropResidue 2: ${after.clouds} cloud(s), ${after.slices} slice(s)`);
  check(after.clouds === 0 && after.slices === 0, 'no death cloud, and no slices');
}

/* ------------------------------- 3. dropResidue 3, and a member ------------------ */
for (const [members, index, residue] of [[2, 1, 3], [1, 0, 3], [2, 1, 2]] as const) {
  const game = withFilterDsas(ESL_DELETEMONSTERFILTER, [[...report(0), ...setWord(DROP_RESIDUE, residue)]]);
  const { at } = kill(game, members, index);
  const g = game.systems.dsa.getGlobalVariables();
  const after = census(game, at);
  const who = members === 1 ? 'the last member' : `member ${index} of ${members}`;
  console.log(`3. ${who}, dropResidue ${residue}: index ${g[8]}, ${after.slices} slice(s), ${after.clouds} cloud(s)`);
  check(g[8] === (members === 1 ? -1 : index), `the DSA sees index ${members === 1 ? -1 : index}`);
  const drops = members === 1 ? residue < 2 : residue !== 2;
  check((after.slices > 0) === drops, `${who} drops ${drops ? 'its slices' : 'nothing'} for a dropResidue of ${residue}`);
  check(after.clouds === 1, 'and the death cloud is shown');
}

/* ------------------------------- 4. the other reasons ---------------------------- */
{
  const game = withFilterDsas(ESL_DELETEMONSTERFILTER, [report(0)]);
  const dungeon = game.ctx.dungeon;
  const { rn, at } = groups(game)[0]!;
  const rec = dungeon.getCreatureRecord(rn)!;
  const key = statsKey(DeleteMonsterWhy.DMW_Movement2, rec.creatureType);
  const before = dungeon.locateExpoolRecord(key);
  game.systems.worldMove.moveParty(-1, -1, at.x, at.y);
  const g = game.systems.dsa.getGlobalVariables();
  const counted = dungeon.locateExpoolRecord(key);
  console.log(`4. the party lands on the group: [${g.slice(1, 9).join(', ')}]; key ${hex(key)} `
    + `${before ? `[${before.join(', ')}]` : 'none'} -> [${counted?.join(', ')}]`);
  check(before === null && counted?.join() === [0, 1, 2, 3].map((i) => (i === rec.alternateGraphics ? 1 : 0)).join(),
    'a kill with no record yet writes one of four, the count in its subtype\'s longword');
  check(g.slice(1, 9).join() === [rn, at.z, at.x, at.y, DeleteMonsterWhy.DMW_Movement2, 0, 0, -1].join(),
    'DMW_Movement2, at the party\'s square');
  check(game.ctx.dungeon.findFirstMonster(at) === OBJECT_ID_EOF, 'and the group is gone');
}
{
  const game = withFilterDsas(ESL_DELETEMONSTERFILTER, [report(0)]);
  const dungeon = game.ctx.dungeon;
  const { rn, at } = groups(game)[0]!;
  standIn(dungeon, 'monsterAllowedOnLevel', () => false);
  const to = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => new Position(at.x + dx!, at.y + dy!, at.z))
    .find((p) => ((dungeon.getCellFlag(p) >> 5) & 7) === 1 && dungeon.findFirstMonster(p) === OBJECT_ID_EOF)!;
  game.systems.monsters.moveMonster(rn, at.x, at.y, to.x, to.y, at.z);
  const g = game.systems.dsa.getGlobalVariables();
  console.log(`4. a group sent where its type may not live: [${g.slice(1, 9).join(', ')}]`);
  check(g.slice(1, 9).join() === [rn, at.z, at.x, at.y, DeleteMonsterWhy.DMW_Movement1, 0, 0, -1].join(),
    'DMW_Movement1, at the square it left');
  check(dungeon.findFirstMonster(at) === OBJECT_ID_EOF && dungeon.findFirstMonster(to) === OBJECT_ID_EOF, 'and the group is gone');
}
{
  const game = withFilterDsas(ESL_DELETEMONSTERFILTER, [report(0)]);
  // A database that cannot grow, so a group is deleted to make room.
  standIn(game.ctx.dungeon, 'enlarge', () => -1);
  makeMoreRoomInDB(game.ctx, DBType.CREATURE);
  const g = game.systems.dsa.getGlobalVariables();
  console.log(`4. MakeMoreRoomInDB: [${g.slice(1, 9).join(', ')}]`);
  check(g[0] === WORDS && g[5] === DeleteMonsterWhy.DMW_MakeRoom && g[8] === -1, 'DMW_MakeRoom, for the whole group');
  const p = new Position(g[3]!, g[4]!, g[2]!);
  check(game.ctx.dungeon.findFirstMonster(p) === OBJECT_ID_EOF, 'and the group on the square it names is gone');
}

finish();
