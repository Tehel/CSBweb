# CSBWin Champion Lifecycle Reference

Everything a champion is between joining the party and being resurrected from bones:
the attribute model, `AddCharacter` and the Hall of Champions, death, the Vi altar,
reincarnation, potions, and the small pieces of state those all share.

Sources are `doc/CSBwin-src/<File>.cpp:<line>`. Only facts read from that source are
recorded here.

## 1. The `ATTRIBUTE` triple

`CHARDESC.Attributes[7]` (`CSB.h:2565`) is seven **(maximum, current, minimum)**
byte-triples (`CSB.h:2409-2435`), indexed by (`CSB.h:628-634`):

| 0 | 1 | 2 | 3 | 4 | 5 | 6 |
| --- | --- | --- | --- | --- | --- | --- |
| Luck | Strength | Dexterity | Wisdom | Vitality | AntiMagic | AntiFire |

The three are not interchangeable, and which one a piece of code touches is the whole
point:

- **Current** is what gameplay reads: `MaxLoad` (`Code11f52.cpp:4286`), `Quickness`
  (`Character.cpp:2220`), throwing distance (`:2278`), the armour term (`:2438`),
  spell success (`Magic.cpp:1223`, `Code17818.cpp:218`), `IsCharacterLucky` (`:2188`),
  and the attribute-scaled damage reduction `TAG016426` (`:2047`).
- **Maximum** is what a **level gain** raises — `LevelUp` calls `IncrMaximum` and never
  `IncrCurrent` (`Magic.cpp:98-148`). Current stays where it was, which is exactly what
  turns the stats line and the box around the eye red.
- **Minimum** is the floor a drain cannot pass (`AdjustCurrentAttribute`,
  `Character.cpp:3927-3931`), and it is itself moved by worn items — a cursed object
  shifts all three by −3 (`Character.cpp:1774-1776`).

### Byte semantics (`data.cpp:1695-1741`)

All three are stored as unsigned bytes **that are allowed to wrap**, and every getter
reads anything above 240 as zero. CSBWin's own comment explains why: the Luck minimum
starts at 10, four cursed objects take it to −2, and the byte holds 254 — which still
exports to an Atari save file bit-for-bit while reading back as 0 in play.

### Where the values come from (`Character.cpp:640-659`)

`AddCharacter` reads seven two-digit values off the mirror's text and, for each:

```
Attributes[i].Minimum(30);            // …then Attributes[Luck].Minimum(10)
if (value > 224) value = 224;
Attributes[i].Maximum(value);
Attributes[i].Current(value);
```

### `AdjustCurrentAttribute` (`Character.cpp:3900-3934`)

The function every potion goes through. It is deliberately lopsided:

- a **gain** is taxed once Current is already high — halved above 120, quartered above
  150, then one point handed back — and is capped so Current never passes 170;
- a **loss** is bounded only by the attribute's own Minimum;
- neither direction touches Maximum.

### Where Current vs Maximum shows on screen

- The **stats panel** colours each of attributes 1..6 (Luck is never listed):
  red (`COLOR_8`) when Current < Maximum, green (`COLOR_7`) when Current > Maximum,
  `COLOR_13` otherwise (`Character.cpp:4609-4626`).
- The **box around the eye** in the open inventory is graphic **34** when *any* of
  attributes 1..6 has Current < Maximum, and graphic **33** otherwise
  (`Character.cpp:1379-1392`). The matching **box around the mouth** is graphic 34 when
  `food < 0`, `water < 0`, or the champion is poisoned, else 33 (`:1363-1377`).

  This is what "a red square on the eye after a level gain" is: a level gain raises the
  maxima, Current falls behind, and the box turns red until the champion rests.

## 2. Hall of Champions — `AddCharacter` (`Character.cpp:456`)

Reached from a wall click on actuator type **127** whose state lacks `PORTRAIT_InActive`
(`Mouse.cpp:513-519`); only one champion may be added per click.

1. Refuses if the cursor holds an object, or the party is already four (`:478-479`).
2. Copies the portrait — graphic 26 for `charID <= 23`, an external portrait
   otherwise (`:487-509`).
3. Assigns a **fingerprint**: `(partyLevel<<10)|(partyX<<5)|partyY`, incremented until
   unused (`:514-518`). This is the key the bones record later resolves through.
4. Takes the champion's corner of the cell as the first free one, starting from the
   party's facing (`:522-528`).
5. Food and water are `random & 0xff + 1500` (`:533-534`).
6. Decodes name, title, gender, HP/stamina/mana, the seven attributes and sixteen
   sub-skills from the `dbTEXT` object in the party's own cell (`:536-700`). A hero
   string that fails validation falls back to the built-in `legalHero` string.
7. Sets `d.PotentialCharacterOrdinal = NumCharacter + 1` and increments `NumCharacter`
   (`:704-705`) — the champion is *provisionally* in the party.
8. Collects every object in the **mirror's** cell (the cell in front, at the opposite
   position) into the champion's possessions (`:715-790`).
9. Opens the inventory on the Resurrect/Reincarnate/Cancel screen (`:792`).

`d.PotentialCharacterOrdinal` is the "almost but not quite added" flag (`Data.h:933`).
While it is non-zero the mouth is inert (`:4061`), the eye shows the menu rather than
food/water (`TAG0189d4`, `:3856`), and the champion is skipped when looking for a living
party member (`:2675`).

## 3. Resurrect / Reincarnate / Cancel (`CSBCode.cpp:6615`)

Graphic **40** is the three-button menu, drawn by `TAG0189a8` (`Character.cpp:3837`),
which also sets `d.DisplayResurrectChestOrScroll = 5`.

- **Cancel (button 162)**: hide the inventory, clear `PotentialCharacterOrdinal`,
  `NumCharacter--`, `SetHandOwner(-1)` if that was the only champion, and clear the
  champion's boxes on screen.
- **Resurrect (160) / Reincarnate (161)**, both first: drop every possession into the
  mirror's cell, then disable the first active portrait actuator at that wall and — 
  unless it `BlockDisables()` — every actuator there (`:6668-6734`).
- **Reincarnate only** (`:6736-6784`): `ReIncarnate()`, zero all 20 skills, and (when
  `DM_rules` is off) apply `reincarnateAttributePenalty`/`reincarnateStatPenalty`,
  both read from the hero's own text. Each of attributes 1..6 loses
  `v * penalty / 16`, floored at its Minimum, and Maximum is set to the result.
  HP/stamina/mana maxima are scaled by `(16 - statPenalty)/16`. Then **12 random
  attribute points**: `Attributes[random % 7]` gains 1 to both Current and Maximum.
- Both then: `SetHandOwner(0)` and `SelectMagicCaster(0)` if this is the only champion,
  and print "`<name> RESURRECTED`" or "` REINCARNATED`".

## 4. Death — `KillCharacter` (`Character.cpp:2526`)

1. Run the **character-death filter** DSA if one exists: the `ESL_CHARDEATHFILTER`
   special location, actuator type 47, with `pDSAparameters[1] = chIdx` (`:2535-2589`).
2. `HP(0)`, mark the portrait changed.
3. If this champion is selected, cancel eye/mouth pressing and hide the inventory.
4. `DropAllPossessions` (`:2497`).
5. Create a `DB10` bones record: `miscType = misc_BonesOfHero`, `important = true`,
   **`value = 2`** ("these are a dead champion's bones"), placed at the champion's own
   `charPosition` in the party's cell, and registered with
   `expool.AddChampionBonesRecord(bones, fingerPrint)` (`:2626-2646`).
6. Clear the incantation, face the party's direction, zero `maxRecentDamage`, and
   `CurePoison` if poisoned.
7. Find a living champion that is not the potential one. **If there is none,
   `d.GameIsLost = 1`**; otherwise hand the cursor on with `SetHandOwner` and, if the
   dead champion was the caster, `SelectMagicCaster` (`:2670-2694`).

`RemoveCharacter` (`:5256`) is the same tail without the bones, for a champion who
leaves the party alive.

## 5. Bones and the Vi altar

The bones' **name** is the champion's name prefixed to the object name, resolved
through `CopyChampionBonesRecord` → `CHARDESC::CopyCharacter(fingerprint)`, and only
when the record's `value != 0` (`Character.cpp:3549-3580`). `CopyCharacter` (`:5239`)
searches the party first, then `GetFromWings` for champions no longer in it.

Dropping bones into an **alcove** while `d.FacingViAltar` is set schedules a
`TT_ViAltar` timer with `packedState = 2` (`Mouse.cpp:894-960`). `d.FacingViAltar` is
set when the decoration in front is the ornate alcove (`CSBCode.cpp:3301`).

`ProcessTT_ViAltar` (`Timer.cpp:2709`) runs three states downward:

- **2** — `CreateCloud(RNffe4, …)` over the bones, `Time += 5`, reschedule at state 1.
- **1** — find the bones again in the cell, resolve the champion (by fingerprint, or by
  the record's `value` as a champion index when there is no bones record), refuse if
  they are not dead, remove and delete the bones, `Time += 1`, reschedule at state 0
  with `packedPos = chIndex`. A champion found only in the wings is healed to
  `MaxHP/2` and saved back, and the timer stops there.
- **0** — `BringCharacterToLife(packedPos)`.

`BringCharacterToLife` (`Character.cpp:804`) moves the champion to a free
`charPosition` if theirs is taken, then:

```
MaxHP = Larger(25, MaxHP - MaxHP/64 - 1);
HP    = MaxHP / 2;
```

and faces them the party's way. **The reduced-HP rule is a permanent cut to MaxHP**, not
a temporary one.

## 6. Feeding, drinking and potions (`Character.cpp:4020-4470`)

The mouth handler does not apply anything directly. It fills a `FEEDPARAMETERS` block
(`:3940`), hands it to the Feeding Filter DSA to amend, and applies the result. With an
empty hand and `DisplayResurrectChestOrScroll != 0` it instead just shows food/water.

Potions read `DB8.strength()` and derive three terms (`:4144-4148`):

```
w_30 = 32 + (strength + 1) / 8
w_14 = ((511 - strength) / w_30) / 2
w_12 = strength / 25 + 8
```

| Potion | Effect |
| --- | --- |
| Ros | `dexterityAdjust = w_12` |
| Ku | `strengthAdjust = strength/35 + 5` |
| Dane | `wisdomAdjust = w_12` |
| Neta | `vitalityAdjust = w_12` |
| Anti-venin | `CurePoison` |
| Mon | stamina += `Smaller(MaxStamina - Stamina, MaxStamina / w_14)` |
| Ya | shield += `w_12 + w_12/2` (quartered if `shieldStrength > 50`), for `w_12²` ticks |
| Ee | mana → `Smaller(900, Mana + 2*w_12 - 8)`, halving the excess above MaxMana |
| Vi | HP += `MaxHP / w_14`, capped at MaxHP; heals `Larger(strength/42, 1)` wounds |
| Water flask | water += 1600 |

Every one of them ends with `emptyFlask = true`. The four attribute potions go through
`AdjustCurrentAttribute`, so they raise **Current** only — which is why drinking a Ku
potion turns the strength line red rather than raising the ceiling.

Food is `d.FoodValue[nameIndex - objNI_Apple]`, with the chew animation and a gulp.

## 7. Pit falls (`Code11f52.cpp:3016-3086`)

When the party falls through an active pit:

- with `d.SupressPitDamage` set (they climbed down a rope, `Attack.cpp:2031`), each
  living champion instead loses `AdjustStamina(chIdx, 25*load/MaxLoad + 1)`;
- otherwise `DamageAllCharacters(20, 48, 2)`, and sound 6 if anyone was hurt.

`d.SupressPitDamage` is cleared immediately afterwards.

`AdjustStamina` (`Code11f52.cpp:4413`) subtracts `decrement` — so a negative value
restores — clamps the result to `[0, MaxStamina]`, and converts any overshoot below zero
into `DamageCharacter(chIdx, overshoot/2, 0, 0)`, with mask and kind both zero. That is
the path by which exhaustion kills.

## 8. Poison

Poison is a **chain of timers**, not a number sitting on the champion.

`PoisonCharacter(chIdx, strength)` (`CSBCode.cpp:7211`) treats `strength` as a *tick
count*:

1. a champion still in a Hall of Champions mirror is immune;
2. `DamageCharacter(chIdx, Larger(1, strength/64), 0, 0)` — mask and kind both zero, so
   it bypasses armour and cannot wound;
3. `strength--`; if anything is left, `poisonCount++` and a `TT_75` timer is armed for
   `d.Time + 36` on the party's level, carrying the champion in `timerUByte5` and the
   remaining count in `timerWord6`.

`TT_75` (`CSBCode.cpp:6554`) decrements `poisonCount` and calls straight back into
`PoisonCharacter` with the remaining count, so the count hovers at **1** for the whole
illness and reaches 0 on the last tick. That is what the portrait's poison indicator
reads, and why it is a flag rather than a severity.

`CurePoison` (`Character.cpp:3007`) deletes every `TT_75` timer for the champion and
zeroes the count. `KillCharacter` (`:2663`) and the anti-venin potion both call it.

## 9. Party-slot indices

`d.HandChar`, `d.MagicCaster` and `d.SelectedCharacterOrdinal - 1` are all indices into
`d.CH16482[]` — the champion's **slot**, which is their box in the top bar and never
moves. `CHARDESC.charPosition` is a different thing: the corner of the cell they stand
in, which `MoveObject` rotates every time the party turns
(`doc/CSBwin-src/Code11f52.cpp:4085`).

`KillCharacter` relies on the two being distinct: it passes the *same* slot index to
`SetHandOwner` and `SelectMagicCaster` (`:2688-2692`), while reading `charPosition`
separately to decide where the bones land (`:2634`).
