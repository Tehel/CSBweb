import { getChampionPossession, type Champion, type Skill } from './gameTypes';
import type { CsbRandom } from '../core/random';
import type { GameContext } from './GameContext';
import type { ObjectID } from '../core/types';
import { applyLimits } from '../core/intCast';
import { AttributeIndex, incrAttributeMaximum } from './attributes';
import { recordMasteryGain } from './MasteryGains';
import {
    OBJNI_EKKHARD_CROSS,
    OBJNI_GEM_OF_AGES,
    OBJNI_MOONSTONE,
    OBJNI_PENDANT_FERAL,
    OBJNI_SCEPTRE_OF_LYF,
    OBJNI_THE_FIRESTAFF_A,
    OBJNI_THE_FIRESTAFF_B,
} from '../core/objectNameIndex';

const SKILL_EXPERIENCE_LIMIT = 0x10000000;
const SUBSKILL_START = 4;
const SUBSKILLS_PER_BASE = 4;
const TOTAL_SKILLS = 20;
const MAX_HP = 999;
const MAX_STAMINA = 9999;
const MAX_MANA = 900;

export enum AdjustSkillsWhy {
  Unknown = 0,
  PhysicalAttack = 1,
  WarCryEtc = 2,
  Attack = 3,
  CastSpell1 = 4,
  CastSpell2 = 5,
  MonsterDamagesCharacter = 6,
  SkillIncreaser1 = 7,
  SkillIncreaser2 = 8,
  ThrowByCharacter = 9,
}

export interface DetermineMasteryOptions {
  partySleeping?: boolean;
  getObjectNameIndex?: (objectId: ObjectID) => number | null;
}

export interface AdjustSkillsFilterParams {
  chIdx: number;
  skillNumber: number;
  experience: number;
  why: AdjustSkillsWhy;
}

export interface AdjustSkillsFilterResult {
  chIdx: number;
  skillNumber: number;
  experience: number;
}

export interface AdjustSkillsResult {
  chIdx: number;
  skillNumber: number;
  experienceApplied: number;
  leveledUp: boolean;
}

export function createEmptySkills(): Skill[] {
  const skills: Skill[] = [];
  for (let i = 0; i < TOTAL_SKILLS; i++) {
    skills.push({ tempAdjust: 0, experience: 0 });
  }
  return skills;
}

export function limitSkillExperience(experience: number): number {
  return experience > SKILL_EXPERIENCE_LIMIT ? SKILL_EXPERIENCE_LIMIT : experience;
}

export function createSkillsFromSubskillLevels(levels: number[], allowNeophyte = false): Skill[] {
  const skills = createEmptySkills();
  for (let i = 0; i < 16; i++) {
    const rawLevel = levels[i] ?? 0;
    const level = Math.max(0, Math.min(17, rawLevel | 0));
    if (level === 0 && !allowNeophyte) continue;
    const experience = limitSkillExperience(125 << level);
    skills[SUBSKILL_START + i].experience = experience;
  }
  populateBaseSkillExperience(skills);
  return skills;
}

export function populateBaseSkillExperience(skills: Skill[]): void {
  for (let base = 0; base < 4; base++) {
    let total = 0;
    const start = SUBSKILL_START + base * SUBSKILLS_PER_BASE;
    for (let i = 0; i < SUBSKILLS_PER_BASE; i++) {
      total += skills[start + i]?.experience ?? 0;
    }
    skills[base].experience = limitSkillExperience(total);
  }
}

export function ensureSkills(skills: Skill[] | null | undefined): Skill[] {
  if (!skills || skills.length < TOTAL_SKILLS) {
    const next = createEmptySkills();
    if (skills) {
      for (let i = 0; i < skills.length && i < TOTAL_SKILLS; i++) {
        const entry = skills[i];
        if (!entry) continue;
        next[i].tempAdjust = entry.tempAdjust | 0;
        next[i].experience = entry.experience | 0;
      }
    }
    return next;
  }
  return skills;
}

export function determineMastery(
  champion: Champion,
  skill: number,
  options: DetermineMasteryOptions = {},
): number {
  if (options.partySleeping) return 1;

  const ignoreTempAdjust = (skill & 0x8000) !== 0;
  const ignorePossessions = (skill & 0x4000) !== 0;
  const skillIndex = skill & 0x3fff;

  const skills = ensureSkills(champion.skills ?? []);
  let experience = 0;
  if (skillIndex >= 0 && skillIndex < skills.length) {
    const entry = skills[skillIndex];
    experience = entry?.experience ?? 0;
    if (!ignoreTempAdjust) experience += entry?.tempAdjust ?? 0;
  }

  if (skillIndex > 3) {
    const baseIndex = Math.floor((skillIndex - 4) / 4);
    const base = skills[baseIndex];
    experience += base?.experience ?? 0;
    if (!ignoreTempAdjust) experience += base?.tempAdjust ?? 0;
    experience = Math.floor(experience / 2);
  }

  let mastery = 1;
  let expValue = experience;
  while (expValue >= 500) {
    expValue = Math.floor(expValue / 2);
    mastery++;
  }

  if (!ignorePossessions && options.getObjectNameIndex) {
    const weaponNameIndex = getPossessionNameIndex(champion, 1, options.getObjectNameIndex);
    if (weaponNameIndex === OBJNI_THE_FIRESTAFF_A) {
      mastery++;
    } else if (weaponNameIndex === OBJNI_THE_FIRESTAFF_B) {
      mastery += 2;
    }

    const neckNameIndex = getPossessionNameIndex(champion, 10, options.getObjectNameIndex);
    switch (skillIndex) {
      case 3:
        if (neckNameIndex === OBJNI_PENDANT_FERAL) mastery++;
        break;
      case 15:
        if (neckNameIndex === OBJNI_EKKHARD_CROSS) mastery++;
        break;
      case 13:
        if (neckNameIndex === OBJNI_GEM_OF_AGES || weaponNameIndex === OBJNI_SCEPTRE_OF_LYF) {
          mastery++;
        }
        break;
      case 14:
        if (neckNameIndex === OBJNI_MOONSTONE) mastery++;
        break;
    }
  }

  return mastery;
}

/**
 * `AdjustSkills` (`doc/CSBwin-src/Magic.cpp:188`). As in CSBWin, every caller gets the
 * Adjust Skills Filter DSA and, when a mastery is gained, `LevelUp` and its message.
 *
 * `experienceMultiplier` is CSBWin's `d.pCurLevelDesc->experienceMultiplier()`, the loaded
 * level's, which the caller knows.
 */
export function adjustSkills(
  ctx: GameContext,
  chIdx: number,
  skillNumber: number,
  experience: number,
  why: AdjustSkillsWhy,
  experienceMultiplier: number,
): AdjustSkillsResult {
  const party = ctx.party.state;
  const champions = party.champions;
  const champ = champions[chIdx];
  if (!champ || skillNumber < 0 || skillNumber >= TOTAL_SKILLS) {
    return { chIdx, skillNumber, experienceApplied: 0, leveledUp: false };
  }

  const time = ctx.state.tickCount;
  const lastMonsterAttackTime = party.lastMonsterAttackTime;
  // `DetermineMastery` reports 1 while the party sleeps (`Code17818.cpp:28-35`).
  const partySleeping = party.sleeping;
  let adjustedExp = experience | 0;

  if (skillNumber >= 4 && skillNumber <= 11) {
    if (lastMonsterAttackTime < time - 150) {
      adjustedExp = Math.trunc(adjustedExp / 2);
    }
  }

  if (experienceMultiplier !== 0) {
    adjustedExp = adjustedExp * experienceMultiplier;
  }

  if (skillNumber >= 4) {
    if (lastMonsterAttackTime > time - 25) {
      adjustedExp = adjustedExp * 2;
    }
  }

  // `pcA2`, `basicSkill`, `oldMastery` and `psA3` are all taken before the filter
  // (`Magic.cpp:236-253`), and the experience goes where they point whatever the filter
  // answers. Only the `skillNumber >= 4` test, `newMastery` and `LevelUp` see its
  // `chIdx` and `skillNumber` (`:335`, `:344`, `:357`).
  const basicSkill = skillNumber >= 4 ? Math.floor((skillNumber - 4) / 4) : skillNumber;
  const oldMastery = determineMastery(champ, basicSkill | 0xc000, { partySleeping });
  const skills = ensureSkills(champ.skills ?? []);
  champ.skills = skills;
  const skillEntry = skills[skillNumber];

  const filtered = ctx.systems.dsa.processAdjustSkillsFilter({
    chIdx,
    skillNumber,
    experience: adjustedExp,
    why,
  });
  if (filtered) {
    chIdx = filtered.chIdx & 0x3;
    skillNumber = ((filtered.skillNumber % TOTAL_SKILLS) + TOTAL_SKILLS) % TOTAL_SKILLS;
    adjustedExp = filtered.experience & 0xfffff;
  }

  if (adjustedExp === 0) {
    return { chIdx, skillNumber, experienceApplied: 0, leveledUp: false };
  }

  skillEntry.experience = limitSkillExperience((skillEntry.experience ?? 0) + adjustedExp);
  if (skillEntry.tempAdjust < 32000) {
    const inc = applyLimits(1, Math.trunc(adjustedExp / 8), 100);
    skillEntry.tempAdjust = (skillEntry.tempAdjust + inc) | 0;
  }

  if (skillNumber >= 4) {
    const base = skills[basicSkill];
    base.experience = limitSkillExperience((base.experience ?? 0) + adjustedExp);
  }

  // A filter may name a champion who is not there: an empty `CHARDESC`, whose mastery
  // of 1 is never a gain.
  const target = champions[chIdx];
  let leveledUp = false;
  if (target && determineMastery(target, basicSkill | 0xc000, { partySleeping }) > oldMastery) {
    recordMasteryGain(target, basicSkill, levelUp(target, basicSkill, ctx.random));
    printLevelUp(ctx, chIdx, basicSkill);
    leveledUp = true;
  }

  return { chIdx, skillNumber, experienceApplied: adjustedExp, leveledUp };
}

/**
 * `AddToSkill` (`doc/CSBwin-src/Magic.cpp:363`): `AdjustSkills` without the time terms, the
 * multiplier or the filter. Its one caller is `&EXPERIENCE+` (`DSA.cpp:4543-4558`). The
 * experience is added as `(UI16)(experience)` (`Magic.cpp:412`, `:428`).
 */
export function addToSkill(
  ctx: GameContext,
  chIdx: number,
  skillNumber: number,
  experience: number,
): AdjustSkillsResult {
  const champ = ctx.party.state.champions[chIdx];
  if (!champ || skillNumber < 0 || skillNumber >= TOTAL_SKILLS) {
    return { chIdx, skillNumber, experienceApplied: 0, leveledUp: false };
  }
  if (experience <= 0) {
    return { chIdx, skillNumber, experienceApplied: 0, leveledUp: false };
  }

  const partySleeping = ctx.party.state.sleeping;
  const basicSkill = skillNumber >= 4 ? Math.floor((skillNumber - 4) / 4) : skillNumber;
  const oldMastery = determineMastery(champ, basicSkill | 0xc000, { partySleeping });

  const skills = ensureSkills(champ.skills ?? []);
  const skillEntry = skills[skillNumber];
  skillEntry.experience = limitSkillExperience((skillEntry.experience ?? 0) + (experience & 0xffff));
  if (skillNumber >= 4) {
    const base = skills[basicSkill];
    base.experience = limitSkillExperience((base.experience ?? 0) + (experience & 0xffff));
  }
  champ.skills = skills;

  const newMastery = determineMastery(champ, basicSkill | 0xc000, { partySleeping });

  let leveledUp = false;
  if (newMastery > oldMastery) {
    recordMasteryGain(champ, basicSkill, levelUp(champ, basicSkill, ctx.random));
    printLevelUp(ctx, chIdx, basicSkill);
    leveledUp = true;
  }

  return { chIdx, skillNumber, experienceApplied: experience, leveledUp };
}

/**
 * The tail of CSBWin `LevelUp` (`doc/CSBwin-src/Magic.cpp:175-179`): a linefeed, then four
 * fragments in the champion's own colour, `d.Byte1386[chIdx]`, flowing onto one line.
 */
function printLevelUp(ctx: GameContext, chIdx: number, basicSkill: number): void {
  const champ = ctx.party.state.champions[chIdx];
  const labels = ['FIGHTER', 'NINJA', 'PRIEST', 'WIZARD']; // d.Pointer16596
  const color = ctx.tables.byte1386[chIdx];
  const messages = ctx.host.messages;
  messages.printLinefeed();
  messages.quePrintLines(color, champ.name);
  messages.quePrintLines(color, ' JUST GAINED A ');
  messages.quePrintLines(color, labels[basicSkill]);
  messages.quePrintLines(color, ' LEVEL');
}

/**
 * CSBWin's `LevelUp` (`doc/CSBwin-src/Magic.cpp:82`) before its message (`printLevelUp`). Returns the
 * attributes whose maximum it raised, a bit per `AttributeIndex` (`recordMasteryGain`).
 */
export function levelUp(champion: Champion, basicSkill: number, rng: CsbRandom): number {
  // CSBWin's `LevelUp` draws from three different generators, in a fixed order
  // (doc/CSBwin-src/Magic.cpp:82-163). They are not interchangeable — each advances
  // the seed once but keeps different bits — so the mapping is kept explicit here.
  const randInt = (maxExclusive: number): number => rng.below(maxExclusive); // STRandom(n)
  const randBool = (): number => rng.bool(); // STRandomBool()
  const rand0_3 = (): number => rng.zeroTo3(); // STRandom0_3()

  // The attributes whose maximum the gain raised, for an extra (`MasteryGains.ts`).
  let raised = 0;
  const raise = (index: AttributeIndex, increment: number): void => {
    incrAttributeMaximum(champion.attributes.stats[index], increment);
    if (increment > 0) raised |= 1 << index;
  };

  let newMastery = determineMastery(champion, basicSkill | 0xc000, {});
  let maxManaIncrement = newMastery;
  const minorAttributeMaxIncrement = randBool();
  const majorAttributeMaxIncrement = randBool() + 1;
  let maxVitalityIncrement = randBool();
  if (basicSkill !== 2) {
    maxVitalityIncrement &= newMastery;
  }

  // `IncrMaximum`, not `IncrCurrent`: a level gain raises the ceiling and leaves the
  // current value where it was, which is exactly what turns the stats line and the box
  // around the eye red (`doc/CSBwin-src/Magic.cpp:101-151`).
  raise(AttributeIndex.Vitality, maxVitalityIncrement);

  const antiFireIncrement = randBool() & (~newMastery);
  raise(AttributeIndex.AntiFire, antiFireIncrement);

  let maxStaminaIncrement = 0;
  switch (basicSkill) {
    case 0: {
      maxStaminaIncrement = Math.trunc(champion.attributes.maxStamina / 16);
      newMastery = newMastery * 3;
      raise(AttributeIndex.Strength, majorAttributeMaxIncrement);
      raise(AttributeIndex.Dexterity, minorAttributeMaxIncrement);
      break;
    }
    case 1: {
      maxStaminaIncrement = Math.trunc(champion.attributes.maxStamina / 21);
      newMastery = newMastery * 2;
      raise(AttributeIndex.Strength, minorAttributeMaxIncrement);
      raise(AttributeIndex.Dexterity, majorAttributeMaxIncrement);
      break;
    }
    case 2: {
      maxStaminaIncrement = Math.trunc(champion.attributes.maxStamina / 25);
      champion.attributes.maxMana = clampMax(champion.attributes.maxMana + newMastery, MAX_MANA);
      newMastery = newMastery + Math.trunc((newMastery + 1) / 2);
      raise(AttributeIndex.Wisdom, minorAttributeMaxIncrement);
      maxManaIncrement = Math.min(rand0_3(), maxManaIncrement - 1);
      if (champion.attributes.maxMana + maxManaIncrement > MAX_MANA) {
        champion.attributes.maxMana = MAX_MANA;
      } else {
        champion.attributes.maxMana += maxManaIncrement;
      }
      raise(AttributeIndex.AntiMagic, randInt(3));
      break;
    }
    case 3: {
      maxStaminaIncrement = Math.trunc(champion.attributes.maxStamina / 32);
      const manaAdd = newMastery + Math.trunc(newMastery / 2);
      if (champion.attributes.maxMana + manaAdd <= MAX_MANA) {
        champion.attributes.maxMana += manaAdd;
      } else {
        champion.attributes.maxMana = MAX_MANA;
      }
      raise(AttributeIndex.Wisdom, majorAttributeMaxIncrement);
      maxManaIncrement = Math.min(rand0_3(), maxManaIncrement - 1);
      if (champion.attributes.maxMana + maxManaIncrement > MAX_MANA) {
        champion.attributes.maxMana = MAX_MANA;
      } else {
        champion.attributes.maxMana += maxManaIncrement;
      }
      raise(AttributeIndex.AntiMagic, randInt(3));
      break;
    }
  }

  const maxHPIncrement = newMastery + randInt(Math.trunc(newMastery / 2) + 1);
  champion.attributes.maxHealth = clampMax(champion.attributes.maxHealth + maxHPIncrement, MAX_HP);

  if (maxStaminaIncrement === 0) {
    maxStaminaIncrement = 1;
  } else {
    maxStaminaIncrement += randInt(Math.trunc(maxStaminaIncrement / 2)) + 1;
  }
  champion.attributes.maxStamina = clampMax(champion.attributes.maxStamina + maxStaminaIncrement, MAX_STAMINA);
  return raised;
}

function clampMax(value: number, max: number): number {
  if (value > max) return max;
  return value | 0;
}

/**
 * `pChar->Possession(slot).NameIndex()`. An empty slot holds `RNnul`, whose `NameIndex`
 * is `objNI_NotAnObject` (`doc/CSBwin-src/CSBCode.cpp:1259`), so no guard is needed.
 */
function getPossessionNameIndex(
  champion: Champion,
  slot: number,
  getObjectNameIndex: (objectId: ObjectID) => number | null,
): number | null {
  return getObjectNameIndex(getChampionPossession(champion, slot));
}
