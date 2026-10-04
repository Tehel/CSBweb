/**
 * `AdjustSkills` (`doc/CSBwin-src/Magic.cpp:185`) is one function for every caller: each
 * one runs the Adjust Skills Filter DSA (`:252-311`), and a mastery gained calls `LevelUp`,
 * which prints "<NAME> JUST GAINED A <SKILL> LEVEL" in the champion's colour
 * (`:172-176`). `DetermineMastery` reports 1 while the party sleeps
 * (`doc/CSBwin-src/Code17818.cpp:28-35`), so a sleeping champion never levels up.
 *
 * The case that tells them apart is a monster's blow (`MonsterDamagesCharacter`,
 * `doc/CSBwin-src/Monster.cpp:4535`), which trains the Fighter's defence skill 7: it must
 * go through the filter and announce the level like any other caller.
 *
 * A filter may answer another champion or skill, but CSBWin has already taken the
 * champion, the skill it credits and the old mastery (`Magic.cpp:233-250`): only the basic
 * skill's `skillNumber >= 4` test, the new mastery and `LevelUp` see the answer.
 *
 *   npx tsx tools/dump-adjust-skills.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Position } from '../src/core/types';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { addCharacterDefaults } from '../src/engine/AddCharacter';
import { makeAddCharacterAttributes } from '../src/engine/attributes';
import type { Champion } from '../src/engine/gameTypes';
import { emptyPossessions } from '../src/engine/gameTypes';
import type { MessageSink } from '../src/engine/GameHost';
import { adjustSkills, AdjustSkillsWhy, createEmptySkills, determineMastery } from '../src/engine/skills';
import { monsterWord16_8_11 } from '../src/data/tables/MonsterDesc';
import { newGame, stockGraphics } from './lib/game';
import { check, finish } from './lib/check';

function champion(i: number): Champion {
  return {
    ...addCharacterDefaults(),
    name: `HERO${i}`,
    attributes: {
      health: 999, maxHealth: 999, stamina: 100, maxStamina: 100, mana: 50, maxMana: 50,
      stats: makeAddCharacterAttributes([60, 60, 50, 50, 50, 20, 20]),
    },
    incantation: [], food: 1500, water: 1500,
    skills: createEmptySkills(),
    possessions: emptyPossessions(),
    partyPosition: i,
  };
}

const loader = new DungeonLoader();
loader.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/dungeon.dat'))));
const data = loader.getData();
if (!data) throw new Error('dungeon.dat did not load');
const graphics = stockGraphics();

const printed: string[] = [];
const colours: number[] = [];
const messages: MessageSink = {
  printLinefeed: () => { printed.push('\n'); },
  quePrintLines: (color, text) => { printed.push(text); colours.push(color); },
  printLines: () => {},
  setNewSpeed: () => {},
  resetTime: () => {},
  clockTick: () => {},
  printNextQueued: () => {},
  vblInterrupt: () => {},
  discardText: () => {},
};
const game = newGame(data, graphics, { messages });
game.setRandomSeed(0x12345678);
game.systems.hallOfChampions.addChampion(champion(0));
const ctx = game.ctx;
const party = ctx.party.state;
party.position = new Position(6, 14, 2);

const filtered: number[] = [];
const dsa = ctx.systems.dsa;
dsa.processAdjustSkillsFilter = (params) => { filtered.push(params.why); return null; };

/** One point short of Fighter mastery 2: 500 experience halves once (`DetermineMastery`). */
function primeFighter(): void {
  const skills = party.champions[0].skills;
  for (const s of skills) { s.experience = 0; s.tempAdjust = 0; }
  skills[0].experience = 499;
  printed.length = 0;
  colours.length = 0;
  filtered.length = 0;
}
const fighter = (): number => determineMastery(party.champions[0], 0xc000);
const levelLine = 'HERO0 JUST GAINED A FIGHTER LEVEL';
const announced = (): string => printed.join('').trim();

// --- a monster's blow ---
let blowType = -1;
for (let t = 0; t < ctx.tables.monsterDesc.length; t++) {
  if (monsterWord16_8_11(ctx.tables.monsterDesc[t]) > 0) { blowType = t; break; }
}
check(blowType >= 0, 'a creature type whose blow trains defence (MONSTERDESC word16 bits 8-11)');
const monster = game.ctx.dungeon.getCreatureRecordByIndex(0);
check(monster !== null, 'a creature record to strike with');
if (monster && blowType >= 0) {
  monster.creatureType = blowType;
  primeFighter();
  party.lastMonsterAttackTime = ctx.state.tickCount; // within 25 ticks: doubled, not halved
  check(fighter() === 1, 'Fighter mastery 1 before the blow');
  game.systems.monsterAttack.monsterDamagesCharacter(monster, 0, true);
  console.log(`=== a blow from creature type ${blowType} ===`);
  console.log(`  Fighter mastery ${fighter()}, filter calls [${filtered.join(',')}], printed ${JSON.stringify(announced())}`);
  check(fighter() === 2, 'the blow trains defence past the first Fighter threshold');
  check(filtered.join() === String(AdjustSkillsWhy.MonsterDamagesCharacter),
    'the blow runs the Adjust Skills Filter once, with ASW_MonsterDamagesCharacter');
  check(announced() === levelLine, `LevelUp announces "${levelLine}"`);
  check(printed[0] === '\n', 'after a linefeed (Magic.cpp:172)');
  check(colours.length === 4 && colours.every((c) => c === ctx.tables.byte1386[0]),
    'in the champion\'s own colour, d.Byte1386[0]');
}

// --- the same experience, awake and asleep ---
for (const sleeping of [false, true]) {
  primeFighter();
  party.sleeping = sleeping;
  party.lastMonsterAttackTime = ctx.state.tickCount;
  const result = adjustSkills(ctx, 0, 7, 4, AdjustSkillsWhy.SkillIncreaser1, 0);
  party.sleeping = false;
  console.log(`=== AdjustSkills(0, 7, 4), ${sleeping ? 'asleep' : 'awake'} ===`);
  console.log(`  applied ${result.experienceApplied}, levelled ${result.leveledUp}, Fighter mastery ${fighter()}, printed ${JSON.stringify(announced())}`);
  check(result.experienceApplied === 8, `${sleeping ? 'asleep' : 'awake'}: 4 experience doubled by the recent attack`);
  check(party.champions[0].skills[0].experience === 507, `${sleeping ? 'asleep' : 'awake'}: the basic skill takes it too`);
  check(filtered.length === 1, `${sleeping ? 'asleep' : 'awake'}: the filter runs`);
  if (sleeping) {
    check(!result.leveledUp && announced() === '', 'asleep: DetermineMastery reports 1 before and after, so no LevelUp');
  } else {
    check(result.leveledUp && announced() === levelLine, 'awake: the level is gained and announced');
  }
}

// --- a filter that retargets: the experience stays where `psA3` and `pcA2` point ---
// (`Magic.cpp:233-250` before the filter, `:304-305` its answer, `:332`/`:341`/`:354` after.)
game.systems.hallOfChampions.addChampion(champion(1));
const skillsOf = (i: number): number[] => party.champions[i].skills.map((s) => s.experience);
const retarget = (answer: { chIdx: number; skillNumber: number }, champ1Fighter: number): ReturnType<typeof adjustSkills> => {
  primeFighter();
  for (const s of party.champions[1].skills) { s.experience = 0; s.tempAdjust = 0; }
  party.champions[1].skills[0].experience = champ1Fighter;
  party.lastMonsterAttackTime = ctx.state.tickCount;
  dsa.processAdjustSkillsFilter = (params) => {
    filtered.push(params.why);
    return { chIdx: answer.chIdx, skillNumber: answer.skillNumber, experience: params.experience };
  };
  return adjustSkills(ctx, 0, 7, 4, AdjustSkillsWhy.SkillIncreaser1, 0);
};
{
  const r = retarget({ chIdx: 1, skillNumber: 4 }, 0);
  console.log(`=== filter answers champion 1, skill 4 ===`);
  console.log(`  champion 0 ${skillsOf(0).join(',')} | champion 1 ${skillsOf(1).join(',')} | levelled ${r.leveledUp}`);
  check(skillsOf(0)[7] === 8 && skillsOf(0)[0] === 507, 'the experience still goes to champion 0\'s skill 7 and its basic skill');
  check(skillsOf(1).every((e) => e === 0), 'champion 1 gets none of it');
  check(!r.leveledUp && announced() === '', 'newMastery is champion 1\'s Fighter, 1: no LevelUp though champion 0 crossed');
}
{
  const r = retarget({ chIdx: 0, skillNumber: 2 }, 0);
  console.log(`=== filter answers champion 0, skill 2 ===`);
  console.log(`  champion 0 ${skillsOf(0).join(',')} | levelled ${r.leveledUp}`);
  check(skillsOf(0)[7] === 8 && skillsOf(0)[2] === 0, 'the experience goes to skill 7, not skill 2');
  check(skillsOf(0)[0] === 499, 'skill 2 is basic, so the `skillNumber >= 4` test credits no basic skill');
  check(!r.leveledUp, 'so Fighter is unchanged and nobody levels');
}
{
  const r = retarget({ chIdx: 1, skillNumber: 4 }, 600);
  console.log(`=== filter answers champion 1, whose Fighter is already mastery 2 ===`);
  console.log(`  levelled ${r.leveledUp}, printed ${JSON.stringify(announced())}`);
  check(r.leveledUp && announced() === 'HERO1 JUST GAINED A FIGHTER LEVEL',
    'LevelUp(chIdx, basicSkill) goes to the filter\'s champion when its mastery beats champion 0\'s old one');
}

finish();
