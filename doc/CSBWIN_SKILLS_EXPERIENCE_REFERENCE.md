# CSBWin Skills and Experience Reference (Verified)

This document lists skill/experience behavior directly visible in the CSBWin C++ source. Every item below is backed by explicit code or data declarations.

## Data model and indices

- `SKILL` stores `tempAdjust` (i16) and `experience` (i32); `LimitSkillExperience` clamps to `0x10000000` (`doc/CSBwin-src/CSB.h`).
- `CHARDESC` holds `skills92[20]` (4 base skills + 16 subskills) (`doc/CSBwin-src/CSB.h`).
- Base skill indices are 0..3: Fighter, Ninja, Priest, Wizard (`doc/CSBwin-src/CSB.h`).
- Subskills are indices 4..19 (four per base class) and are populated from hero data (`doc/CSBwin-src/Character.cpp`).

## Initial skill loading (heroes)

- Character creation reads skill letters for indices 4..19. Each letter is `A`..`R` (0..17) and maps to experience `125 << level`, clamped with `LimitSkillExperience` (`doc/CSBwin-src/Character.cpp`).
- `neophyteSkills` allows level 0 skills to be accepted even when the letter is `A` (0); otherwise 0-level entries are skipped (`doc/CSBwin-src/Character.cpp`, `doc/CSBwin-src/Recording.cpp`, `doc/CSBwin-src/data.cpp`).
- After subskills are populated, base skills (0..3) are set to the sum of their four subskills, clamped with `LimitSkillExperience` (`doc/CSBwin-src/Character.cpp`).

## Mastery calculation (`DetermineMastery`)

- Returns mastery 1 when `PartySleeping` is non-zero (`doc/CSBwin-src/Code17818.cpp`).
- Skill flags:
  - `0x8000` disables `tempAdjust` contribution.
  - `0x4000` disables possession bonuses.
  - After stripping flags, mastery uses the underlying skill index (`doc/CSBwin-src/Code17818.cpp`).
- For subskills (>3), mastery includes base-skill experience (and tempAdjust unless ignored) and halves the total after combination (`doc/CSBwin-src/Code17818.cpp`).
- Mastery starts at 1 and increments while `experience >= 500`, shifting experience right by 1 each step (log2-style scale) (`doc/CSBwin-src/Code17818.cpp`).
- Possession bonuses (skipped when `0x4000` is set):
  - Firestaff A (+1) or Firestaff B (+2) if equipped in weapon hand (`doc/CSBwin-src/Code17818.cpp`).
  - Pendant Feral adds +1 for Wizard base skill (index 3) (`doc/CSBwin-src/Code17818.cpp`).
  - Ekkhard Cross adds +1 for priest subskill index 15 (`doc/CSBwin-src/Code17818.cpp`).
  - Gem of Ages or Sceptre of Lyf adds +1 for priest subskill index 13 (`doc/CSBwin-src/Code17818.cpp`).
  - Moonstone adds +1 for priest subskill index 14 (`doc/CSBwin-src/Code17818.cpp`).

## Skill adjustment pipeline (`AdjustSkills` / `AddToSkill`)

- `AdjustSkills` accepts a skill index, experience, and a reason code (ASW_*). It asserts skill index 0..19 (`doc/CSBwin-src/Magic.cpp`).
- Scaling before addition:
  - If skill is 4..11 and the last monster attack was more than 150 ticks ago, experience is halved (`doc/CSBwin-src/Magic.cpp`).
  - If the current level has a non-zero experience multiplier, experience is multiplied by that value (`doc/CSBwin-src/Magic.cpp`, `doc/CSBwin-src/CSB.h`).
  - If skill is a subskill (>=4) and the last monster attack was within 25 ticks, experience is doubled (`doc/CSBwin-src/Magic.cpp`).
- `LastMonsterAttackTime` is updated when `MonsterAttacks` runs (`doc/CSBwin-src/Monster.cpp:982`) and drives the timing gates above.
- The Adjust Skills DSA filter (`ESL_ADJUSTSKILLSFILTER`) can mutate `(chIdx, skillNumber, experience, why)` and uses `adjustSkillsParameters[5]` as extra args (`doc/CSBwin-src/Magic.cpp`, `doc/CSBwin-src/DSA.cpp`, `doc/CSBwin-src/data.cpp`).
- After scaling (and DSA filter), experience is added to the target skill and clamped via `LimitSkillExperience` (`doc/CSBwin-src/Magic.cpp`).
- `tempAdjust` increases by `ApplyLimits(1, experience/8, 100)` when under 32000 (`doc/CSBwin-src/Magic.cpp`).
- If the adjusted skill is a subskill (>=4), the same experience is also added to its base skill (index `(skill-4)/4`) (`doc/CSBwin-src/Magic.cpp`).
- Base mastery is checked using `DetermineMastery(chIdx, base | 0xc000)` (ignore temp + possessions). If mastery increases, `LevelUp` is invoked (`doc/CSBwin-src/Magic.cpp`).
- `AddToSkill` is a simplified path (used by DSA) that adds experience without scaling or tempAdjust changes but still updates the base skill and triggers `LevelUp` if mastery rises (`doc/CSBwin-src/Magic.cpp`, `doc/CSBwin-src/DSA.cpp`).

## Level-up effects (`LevelUp`)

- `LevelUp` uses `DetermineMastery(chIdx, base | 0xc000)` to compute `newMastery` (ignoring temp/possessions) and applies class-specific stat increases (`doc/CSBwin-src/Magic.cpp`).
- Common adjustments:
  - Vitality max increases by a random bit; for priest (`basicSkill == 2`) it is further masked by `newMastery`.
  - AntiFire max increases by `STRandomBool() & (~newMastery)`.
  - Max HP increases by `newMastery + STRandom(newMastery/2 + 1)`, clamped to 999.
  - Max Stamina increases by a derived increment (class-specific divisor plus random), clamped to 9999.
- Class-specific adjustments:
  - Fighter: MaxStamina/16, Strength major increment, Dexterity minor; `newMastery *= 3` for HP scaling.
  - Ninja: MaxStamina/21, Dexterity major increment, Strength minor; `newMastery *= 2` for HP scaling.
  - Priest: MaxStamina/25, MaxMana increases by `newMastery` plus a smaller random add, Wisdom minor, AntiMagic increases by `STRandom(3)`.
  - Wizard: MaxStamina/32, MaxMana increases by `newMastery + newMastery/2`, Wisdom major, AntiMagic increases by `STRandom(3)`.
- On level-up, `CHARFLAG_statsChanged` is set, the character UI redraws, and the message “JUST GAINED A {CLASS} LEVEL” is queued (`doc/CSBwin-src/Magic.cpp`).

## Skill effects on actions (attack + magic)

### Attacks and combat actions

- Attack setup uses `SkillNumber[attackType]` and `experienceForAttacking[attackType]` (arrays of length 44) to determine skill and base exp for the action (`doc/CSBwin-src/Attack.cpp`, `doc/CSBwin-src/Data.h`).
- Wizard-type attacks (skill indices 3, 16..19) compute `neededMana = 7 - min(6, DetermineMastery(skill))` (`doc/CSBwin-src/Attack.cpp`).
- Physical attack damage: after hit resolution, `DetermineMastery` gives a chance (`random(64) < mastery`) to add +10 damage (`doc/CSBwin-src/Attack.cpp`).
- Physical attack skill gain: `DeterminePhysicalAttackDamage` computes `skillAdjust = (damage * monsterDesc.word16_8_11 / 16) + 3`, and `PhysicalAttackFilter` applies `AdjustSkills` for that value (`doc/CSBwin-src/Attack.cpp`).
- If a physical attack fails, `experienceGained` and `disableTime` are halved (`doc/CSBwin-src/Attack.cpp`).
- `AttackWithSpell` halves experience on failure, scales range down if not enough mana, and can still consume charges (`doc/CSBwin-src/Attack.cpp`).
- Warcry/Calm/Brandish/Blowhorn:
  - `WarCryEtc` sets a base mastery and skillIncrement, adds `DetermineMastery(14)`, and can halve skillIncrement on failure before `AdjustSkills` (`doc/CSBwin-src/Attack.cpp`).
- `Shoot` uses `DetermineMastery(11)` in its damage calculation and zeroes experience when no ammo is present (`doc/CSBwin-src/Attack.cpp`).
- `Heal` uses `DetermineMastery(13)` to cap HP increments and increases experience by 2 for each mana-spend loop (`doc/CSBwin-src/Attack.cpp`).
- `Window` (see-through walls) uses `DetermineMastery` to randomize the timer duration (`doc/CSBwin-src/Attack.cpp`).
- `ThrowByCharacter`:
  - Uses `DetermineMastery(10)` for range/damage calculations.
  - Grants skill 10 experience via `AdjustSkills` based on item type and weight (`doc/CSBwin-src/Mouse.cpp`).
- `MonsterDamagesCharacter` awards skill 7 experience based on `monsterDesc.word16_8_11()` (`doc/CSBwin-src/Monster.cpp`).

### Spellcasting (spell menu)

- `CastSpell` uses `DetermineMastery(chIdx, spellByte5)` vs `skillRequired + spellPower` to gate casting. If mastery is lower, a wisdom-based random test can fail the cast (`doc/CSBwin-src/Magic.cpp`).
- Failed cast awards reduced experience: `AdjustSkills(spellByte5, w_4 >> (required - mastery), ASW_CastSpell1)` and displays the failure message (`doc/CSBwin-src/Magic.cpp`).
- Successful casts always award experience: `AdjustSkills(spellByte5, w_4, ASW_CastSpell2)` (`doc/CSBwin-src/Magic.cpp`).

## Timed effects and decay

- `TenSecondUpdate` (called every ~10 seconds / 2.5 seconds while sleeping) uses `DetermineMastery(Wizard) + DetermineMastery(Priest)` and Wisdom to drive mana regeneration, while reducing `tempAdjust` by 1 for each skill each update (`doc/CSBwin-src/Code17818.cpp`).

## DSA and scripting hooks

- `STKOP_SetAdjustSkillsParameters` updates the global `adjustSkillsParameters[5]` array, which is read during `AdjustSkills` DSA filtering (`doc/CSBwin-src/DSA.cpp`, `doc/CSBwin-src/data.cpp`).
- `STKOP_ExperiencePlus` calls `AddToSkill(charnum, skillnum, experience)` (`doc/CSBwin-src/DSA.cpp`, `doc/CSBwin-src/Magic.cpp`).
- DSA’s `DetermineMastery` opcode can set flags 0x4000/0x8000 via its `flags` argument before calling `DetermineMastery` (`doc/CSBwin-src/DSA.cpp`, `doc/CSBwin-src/Code17818.cpp`).

## Persistence (save/load)

- Save-game serialization swaps `skills92[].tempAdjust` (i16) and `skills92[].experience` (i32) on load/save (`doc/CSBwin-src/SaveGame.cpp`).
