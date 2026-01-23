import type { Skill } from './gameTypes';

const SKILL_EXPERIENCE_LIMIT = 0x10000000;
const SUBSKILL_START = 4;
const SUBSKILLS_PER_BASE = 4;
const TOTAL_SKILLS = 20;

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
