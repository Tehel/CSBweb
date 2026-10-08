# CSBWin Magic Casting Reference (Sourced)

This document captures the casting pipeline and spell effects from the CSBWin C++ source under `doc/CSBwin-src/`.

## Entry points and flow

- UI "Cast" button (magic panel) calls `MagicSelection` with button `108`, which calls `CastMagic()` after flashing the button (`doc/CSBwin-src/Magic.cpp:TAG019d90`).
- `CastMagic()` builds `SPELL_PARAMETERS`, runs `CallSpellFilter()` (DSA spell filter), then calls `CastSpell()`. If `CastSpell()` returns `3` (missing flask), it keeps the incantation; otherwise it clears the incantation and redraws the magic panel (`doc/CSBwin-src/Magic.cpp:TAG01c826`).
- DSA can cast spells directly via `DSACastSpell(filter)` which optionally routes through `CallSpellFilter()` and then `CastSpell()` (`doc/CSBwin-src/Magic.cpp:DSACastSpell`).

## Spell parameters and filters

- `FillSpellParameters()` populates `SPELL_PARAMETERS` from the active caster, including `facing`, `locationAbs`, and a numeric `incantation` value computed as digits (1..6) per rune position (`doc/CSBwin-src/Magic.cpp:FillSpellParameters`).
- `CallSpellFilter()` only runs if `spellFilterLocation` has bit 31 set; it scans actuators at that location, and for actuator type `47` executes a DSA filter that can mutate `SPELL_PARAMETERS` (`doc/CSBwin-src/Magic.cpp:CallSpellFilter`).
- `spellFilterLocation` is stored in the extended features block and uses bit 31 as the “valid” flag (`doc/CSBwin-src/CSB.h:EXTENDEDFEATURESBLOCK`, `doc/CSBwin-src/SaveGame.cpp:ReadExtendedFeatures`).
- `SPELL_PARAMETERS.action` encodes early aborts and messaging (0 = proceed; 1/2/3/4/5/6/7 = abort with message). If a message path is taken, `CastSpell()` can still apply `disableTime` (`doc/CSBwin-src/CSB.h:SPELL_PARAMETERS`, `doc/CSBwin-src/Magic.cpp:CastSpell`).

## Incantation decoding

- `Incantation2Spell()` requires at least two runes (`incantation[1] != 0`), packs up to 4 incantation bytes into a 24-bit value, and matches against `d.Spells[25]` (`doc/CSBwin-src/Magic.cpp:Incantation2Spell`).
- `CastSpell()` derives `spellPower` from the first rune: `incantation[0] - 95` (valid 1..6). This is the "power rune" (`doc/CSBwin-src/Magic.cpp:CastSpell`).
- When a numeric incantation override is supplied (DSA), `CastSpell()` reconstructs the rune bytes by decoding decimal digits into the rune tables (`0x60 + 6*pos + (digit-1)`), with digit `0` meaning "no rune" (`doc/CSBwin-src/Magic.cpp:CastSpell`).

## Spell data source

- `d.Spells[25]` is loaded from graphic `0x230` and endian-swapped via `fixSpell()` (`doc/CSBwin-src/CSBCode.cpp:ReadTablesFromGraphicsFile`, `doc/CSBwin-src/CSBCode.cpp:fixSpell`).
- `SPELL.word6` bit layout:
  - bits 0-3 = spell class (1 potion, 2 missile, 3 light/utility)
  - bits 4-9 = missile type
  - bits 10-15 = disable time after casting
  (`doc/CSBwin-src/CSB.h:SPELL`)

## Casting gate and experience

- Required mastery is `pSpell->skillRequired + spellPower`. If current mastery is lower, a wisdom-based random test is repeated `(required - mastery)` times; a failure prints "needs more practice", awards reduced experience (`w_4 >> (required-mastery)`), and aborts the spell (`doc/CSBwin-src/Magic.cpp:CastSpell`).
- `w_4` (experience) is computed from random + skill/power terms:
  - `D4 = skillRequired + spellPower`
  - `w_4 = (rand&7) + 16*D4 + 8*(spellPower-1)*skillRequired + D4*D4`
  (`doc/CSBwin-src/Magic.cpp:CastSpell`)
- Successful casts always call `AdjustSkills(spellByte5, w_4, ASW_CastSpell2)` (`doc/CSBwin-src/Magic.cpp:CastSpell`).

## Spell class effects

### Class 1 (potion)

- Requires an empty flask in either hand; otherwise returns `3` so `CastMagic()` keeps the incantation (`doc/CSBwin-src/Magic.cpp:CastSpell`, `doc/CSBwin-src/Magic.cpp:GetFlaskInHand`).
- Potion type is derived from `word6 >> 4`, strength is `40*spellPower + STRandom(16)` (clamped to 8-bit), and character load/UI are updated (`doc/CSBwin-src/Magic.cpp:CastSpell`).

### Class 2 (missile)

- Ensures caster facing matches party facing and then throws a spell missile with:
  - `RN.CreateSpell(missileType)` (missile type from `word6` bits 4-9)
  - `range = ApplyLimits(21, (2*mastery + 4)*(spellPower+2), 255)`
  - `requiredMana = 0` (mana already spent at rune selection)
  (`doc/CSBwin-src/Magic.cpp:CastSpell`)
- If `missileType == 4` (torch), mastery used in range is doubled (`doc/CSBwin-src/Magic.cpp:CastSpell`).

### Class 3 (light/utility)

- Light (missileType 0): increases `d.Brightness` by `Word1074[D6W]` and schedules a brightness timer that later subtracts the same amount (`SetBrightnessTimer`) (`doc/CSBwin-src/Magic.cpp:CastSpell`, `doc/CSBwin-src/Magic.cpp:SetBrightnessTimer`).
- Darkness (missileType 1): decreases `d.Brightness` and schedules a short timer to restore it (`doc/CSBwin-src/Magic.cpp:CastSpell`).
- See-thru walls (missileType 2): increments `d.SeeThruWalls` and schedules `TT_73` for duration `D6W^2` (`doc/CSBwin-src/Magic.cpp:CastSpell`).
- Invisibility (missileType 3): increments `d.Invisible` and schedules `TT_71` for duration `D6W` (`doc/CSBwin-src/Magic.cpp:CastSpell`).
- Party shield (missileType 4): increments `d.PartyShield`, schedules `TT_74`, and marks portraits dirty (`doc/CSBwin-src/Magic.cpp:CastSpell`).
- Magic footprints (missileType 6): increments `d.MagicFootprintsActive`, updates footprint indices, schedules `TT_79` (`doc/CSBwin-src/Magic.cpp:CastSpell`).
- Zokathra spell (missileType 7): creates a `misc_ZokathraSpell` object, equips it if a hand is free, otherwise drops it into the party cell (`doc/CSBwin-src/Magic.cpp:CastSpell`).
- Fire shield (missileType 8): calls `MagicShield()` to update `d.FireShield` and schedule a decay timer (`doc/CSBwin-src/Magic.cpp:CastSpell`, `doc/CSBwin-src/Attack.cpp:MagicShield`).

## Timer expiry effects

- `TT_71` decrements `d.Invisible` (`doc/CSBwin-src/CSBCode.cpp:6578`).
- `TT_73` decrements `d.SeeThruWalls` (`doc/CSBwin-src/CSBCode.cpp:6608`).
- `TT_74` subtracts `timerWord6` from `d.PartyShield` and marks portraits dirty (`doc/CSBwin-src/CSBCode.cpp:6609-6623`).
- `TT_77` subtracts `timerWord6` from `d.SpellShield` and marks portraits dirty (`doc/CSBwin-src/CSBCode.cpp:6624-6627`).
- `TT_78` subtracts `timerWord6` from `d.FireShield` and marks portraits dirty (`doc/CSBwin-src/CSBCode.cpp:6628-6630`).
- `TT_79` decrements `d.MagicFootprintsActive` (`doc/CSBwin-src/CSBCode.cpp:6631`).

None of the six has a floor, and each counter is signed: `doc/PROVEN_FACTS.md` → "The
spell counters have no floor".

## Missile launch path

- `CharacterThrowsSpell()` checks mana, subtracts it, sets stats-changed, computes `decayRate` from `MaxMana/8`, and calls `LaunchObject()` (`doc/CSBwin-src/Magic.cpp:CharacterThrowsSpell`).
- `LaunchObject()` computes the launch position from party facing + character position, then calls `LaunchMissile()` (`doc/CSBwin-src/Magic.cpp:LaunchObject`).
- `LaunchMissile()` allocates a DB14 missile record, writes range/damage, adds it to the room (no teleporter handling here), and schedules a `TT_Missile0` or `TT_Missile` timer. `timerWord8` packs X/Y/dir/decay rate bits (`doc/CSBwin-src/Magic.cpp:LaunchMissile`).

## Action disable time

- `CastSpell()` calls `DisableCharacterAction()` using `word6` bits 10-15 (unless overridden by `spellParameters.disableTime`), which sets a `TT_11` timer and updates character attack-disable flags (`doc/CSBwin-src/Magic.cpp:CastSpell`, `doc/CSBwin-src/Magic.cpp:DisableCharacterAction`).
