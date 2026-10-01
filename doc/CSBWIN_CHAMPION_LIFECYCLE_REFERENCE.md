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

### The eye and mouth boxes (`Character.cpp:1363-1392`)

Inside the `CHARFLAG_statsChanged` block, with the inventory open, two blits of the same
shape choose between graphic **33** (plain) and **34** (marked):

| Box | Rectangle | Marked when |
| --- | --- | --- |
| Mouth | `d.Word1398` | `food < 0`, `water < 0`, or `poisonCount != 0` |
| Eye | `d.Word1406` | any of `Attributes[1..6]` has `Current() < Maximum()` |

The eye loop is `for (D4W=1; D4W<=6; D4W++)`, so **Luck (index 0) can never mark it**.

This is the "red square that appears on a level gain", and it has nothing to do with
levels: `LevelUp` raises the *maxima* (`Magic.cpp:98-148`) and leaves Current where it
was, so the gap opens. A champion drained by a monster shows exactly the same box.

Both are `BLT2Viewport(…, 16, 12)`, which reads **16 bytes of source per line** — 32
pixels, an 18-pixel row padded up to whole bitplane groups — with **12 as the
transparent colour**, so the eye or mouth beneath shows through the frame. The
destination rectangles are 18x18. The 16 and the 12 are a stride and a colour, not a
width and a height.

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
5. Food and water are `random & 0xff + 1500` (`:533-534`) — two separate `STRandom`
   draws, so they differ.
6. Decodes name, title, gender, HP/stamina/mana, the seven attributes and sixteen
   sub-skills from the `dbTEXT` object in the party's own cell (`:536-700`) — the first
   one in the chain, at any position. A hero string that fails validation falls back to
   the built-in `legalHero` string. `charID` therefore selects **only the portrait
   bitmap**: which champion you get is decided by where the party is standing.

   Every number in that string is `DecodeCharacterValue` (`:414-431`): one hex nibble
   per character, each of which must be `'A'`..`'P'`. Anything else returns -1 and makes
   the hero illegal. HP, stamina and mana are then clamped to MAXHP 999 / MAXSTAMINA
   9999 / MAXMANA 900 (`CSB.h:2452-2454`), and each clamp also sets `illegalHero`.
   After the sixteen skill letters come three `GetOneValue` reads (`:433-437`, `'A'`..
   `'Z'` or 0xff): `reincarnateAttributePenalty` (fallback 2 above 16),
   `reincarnateStatPenalty` (fallback 8) and `randomPoints` (fallback 3). All 24
   shipped DM heroes stop at the skills, so all three take their fallbacks.
7. Sets `d.PotentialCharacterOrdinal = NumCharacter + 1` and increments `NumCharacter`
   (`:704-705`) — the champion is *provisionally* in the party.
8. Collects every object in the **mirror's** cell (the cell in front, at the opposite
   position) into the champion's possessions (`:715-790`). The slot search is a
   `switch` with two `goto case9`s: clothing takes the first of body slots 2..5 its
   carry mask allows, a weapon takes slot 1, a scroll or potion takes slot 11, and
   anything left over takes the neck (10) if it is legal and free, otherwise the next
   backpack slot from 13 up. Two details are load-bearing: a scroll or potion whose
   slot 11 is taken sets `LOCAL_6 = 6` and then falls through to `case9`, which
   overwrites it — **slot 6 is never used**; and `AddCharacterPossession` (`:1936`)
   does *not* remove the object from the room, see section 3.

   `AddCharacter` only reaches this code with `dbType() > dbACTUATOR`, and then has no
   `default:` arm, so a creature, missile or cloud lying in the mirror leaves `LOCAL_6`
   at the previous iteration's value. That is undefined behaviour rather than
   behaviour; our port skips those categories.
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
- **Resurrect (160) / Reincarnate (161)**, both first: `RemoveObjectFromRoom` every
  possession **out of** the mirror's cell, then disable the first active portrait
  actuator at that wall and — unless it `BlockDisables()` — every actuator there
  (`:6668-6734`).

  This is the other half of the trick in section 2 step 8: `AddCharacterPossession`
  (`Character.cpp:1936`) never unlinked those objects from the room, so between the add
  and the answer each one is in two places at once. Confirming unlinks them; **Cancel
  leaves them exactly where they were**, which is what makes the undo clean and is why
  neither half can be written without the other.

  Both mapX/mapY are recomputed from the party's *current* position, not from where the
  mirror was clicked. CSBWin does not stop the party walking away with the menu up, so
  answering it after a move takes the possessions out of — and disables the actuators
  of — whatever the party is facing now. Quirk, faithfully preserved.
- **Reincarnate only** (`:6736-6784`): `ReIncarnate()` — see the section below — **then**
  zero all 20 skills, and (when `DM_rules` is off) apply `reincarnateAttributePenalty`/`reincarnateStatPenalty`,
  both read from the hero's own text. Each of attributes 1..6 loses
  `v * penalty / 16`, floored at its Minimum, and Maximum is set to the result.
  HP/stamina/mana maxima are scaled by `(16 - statPenalty)/16`. Then **12 random
  attribute points**: `Attributes[random % 7]` gains 1 to both Current and Maximum.
  Twelve is hardcoded at `:6779`; the `randomPoints` field `AddCharacter` parses out of
  the hero text (`Character.cpp:686`) is **never read** by this path.
  Luck (index 0) is outside the penalty loop, so it can only gain.
- Both then: `SetHandOwner(0)` and `SelectMagicCaster(0)` if this is the only champion,
  and print "`<name> RESURRECTED`" or "` REINCARNATED`".

The menu is modal by click gating, not by a mode flag: while `PotentialCharacterOrdinal`
is non-zero the dispatcher drops clicks on the portrait boxes (ids 12-15), the inventory
buttons (7-11), the magic panel (100) and the attack panel (111)
(`Mouse.cpp:1578-1650`). Ids 83 (the cursor owner's inventory), 70 (mouth), 71 (eye) and
81 (the eye panel itself) are *not* gated there — the mouth stops itself at
`Character.cpp:4061` instead. `_TAG01a6ea` (`CSBCode.cpp:8500`) is what turns a click on
id 81 into a menu button, switching on `d.DisplayResurrectChestOrScroll`: 4 sends it to
`HandleClothingClick` for an open chest, 5 to `SearchButtonList(d.Buttons18372)` and
`_ResurrectReincarnateCancel`, and only with an empty cursor.

## 3a. The name-entry screen — `_ReIncarnate` (`Code13ea4.cpp:20`)

The first thing button 161 does, before a single penalty is charged. It sets
`keyboardMode = 2`, blanks `pChar->name` and `pChar->title`, blanks the viewport's name
strip (viewport `(3,3)-(170,8)`, colour 12), blits graphic **27** into `d.wRectPos926`
(72-byte source line, transparent colour 4) and draws seven underscores at screen
(177, 91) and nineteen at (105, 109). Then it loops until a name is accepted; there is
**no cancel**.

Two fields, `D6W` = 1 for the name and 2 for the title, `D7W` characters typed:

- letters `A`-`Z`, `.`, `,`, `;`, `:` and space are taken; lower case is folded up.
  A **space is refused as the first character** of either field;
- the name is full at **7** and advances to the title by itself — no return needed;
  the title stops dead at **19**;
- **Return** ends the name (only if non-empty) and does nothing in the title;
- **Backspace** rubs out a character; off the front of the title it steps back into the
  name and lands *on* its last character, so that character is lost too (`:311-318`);
- **OK** (screen `197..215 x 147..155`) is refused while the name is empty. It trims
  trailing spaces from the name, then compares against every champion **but the last** —
  the last is the one being named. A duplicate is refused silently: the screen simply
  stays up.

### The letter grid (`:174-210`)

Screen `107..215 x 116..144`, three rows of eleven cells on a 10-pixel pitch. The
arithmetic has three traps:

1. the pixels *between* the keys are dead — a click needs `(x+4) % 10 != 0` and
   `(y+5) % 10 != 0`;
2. the exception is the **tall carriage-return key**, which spans the last cell of rows
   1 and 2 and owns the grid line between them: `(x >= 207) && (y == 135)`;
3. the letter is `'A' + 11 * ((y-116)/10) + (x-107)/10`, and **codes 86 and 97 are both
   that CR key**; every code `>= 87` then shifts **down by one** to close the gap it
   leaves, and anything past `'Z'` indexes `d.SpecialChars` — comma, period, semi-colon,
   colon, space (`Data.h:1422`).

Get (3) wrong and the keyboard still works, it just types the wrong letter from `W` on.
The check that catches it is reading every key centre out in order and requiring the
unbroken alphabet.

`d.Byte1414` is a one-character string holding `'_'`, drawn in colour 9 to mark where
the next character goes and in 13 to take the mark away; `d.Byte1416` is the same thing
holding the character just typed.

## 4. Death — `KillCharacter` (`Character.cpp:2526`)

A blow does not kill where it lands: `DamageCharacter` adds to `d.PendingDamage`, and the
tick's `DisplayCharacterDamage` (`CSBCode.cpp:7084`, called at `:657`) calls
`KillCharacter` when the sum takes the HP to 0 or below (`doc/PROVEN_FACTS.md` →
"`DamageCharacter` only adds to `d.PendingDamage`").

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
- **1** — find the bones again in the cell, resolve the champion, refuse if they are
  not dead, remove and delete the bones, `Time += 1`, reschedule at state 0 with
  `packedPos = chIndex`. A champion found only in the wings is healed to `MaxHP/2` and
  saved back, and the timer stops there.

  **Resolving the champion has two arms, and they read `value` differently.** With an
  expool bones record (bones left by a death), the fingerprint in that record names the
  champion and `value` is the *kind* of bones — 0 inert, 1 named, **2 a dead
  champion's** (`CSB.h:1258-1264`). With no expool record (bones the dungeon author
  placed), `chIndex = DB10A2->value()` — `value` *is* the champion index
  (`Timer.cpp:2788`, and `Objects.h:192` says so in the enum itself).

  The record is looked for with `GetChampionBonesRecord`, which takes it out of the pool
  (`Timer.cpp:2750`), before the champion is looked at. Bones the first arm then refuses
  stay where they are with no record, and a later offering reads them by the second arm.

  The drop-into-the-alcove handler that schedules the timer has the **same two arms**
  (`Mouse.cpp:894-960`), and the asymmetry matters there too: the fingerprint arm
  additionally requires `value() == 2`, and the `value`-as-index arm has no such test —
  it requires only `chIdx < d.NumCharacter` and a dead champion.
- **0** — `BringCharacterToLife(packedPos)`.

`BringCharacterToLife` (`Character.cpp:804`) moves the champion to a free
`charPosition` if theirs is taken, then:

The order is the subtle part. The corner is settled **before** the champion is alive
again, and `CharacterAtPosition` (`Code11f52.cpp:4046`) returns an index only for a
champion whose `HP() != 0` — a corner held by a corpse counts as free. So the champion
being revived never collides with themselves, and the unbounded search
`for (D7W=0; CharacterAtPosition(D7W)!=-1; D7W++)` always terminates: at most three of
four champions can be living while it runs. The same rule is why `AddCharacter` may
seat a new champion in a dead one's corner (`:522-528`).


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

Every one of them ends with `emptyFlask = true`, including the types with no case of
their own — but nothing happens for those, because the apply step is gated on
`performFeeding`. The four attribute potions go through `AdjustCurrentAttribute`, so they
raise **Current** only, which is why drinking a Ku potion turns the strength line green
rather than raising the ceiling.

Food is `d.FoodValue[nameIndex - objNI_Apple]`, with the chew animation and a gulp.

The apply block runs in this order (`:4348-4430`), and the order matters:

1. `AdjustCurrentAttribute` for attributes 1..6;
2. `CurePoison` if `antiVenin`;
3. `AdjustStamina(chIdx, -staminaAdjust)` — negated, because a gain is a negative cost;
4. the shield, which also arms a `TT_72` for `shieldDuration` ticks to take it back off
   (`CSBCode.cpp:6520`);
5. mana, then hit points — and a champion killed here never reaches the wound heal;
6. the wound heal, which is not "heal N wounds": the mask is AND-ed with `healCount`
   fresh random words, retried up to ten times, stopping at the first pass that changed
   anything;
7. water and food, both `LIMIT(-1023, …, 2048)`;
8. the stamina and hit-point ceilings.

Steps 5 and 6 are skipped for the unconfirmed champion in a mirror, so a bad potion
cannot kill them.

**What the shipped dungeon contains.** Only these potion types exist as records in
`dungeon.dat`: 2 (Des), 3 (Ven), 6 (Ros), 7 (Ku), 8 (Dane), 9 (Neta), 10 (Anti-venin),
12 (Ya), 14 (Vi), 15 (Water flask), 19 (Ful bomb), 20 (Empty flask). There is no Mon or
Ee potion anywhere in the dungeon — both only ever come from their spells.

## 7. Pit falls (`Code11f52.cpp:3016-3106`)

The branch fires only for an active pit that `PitGoesSomewhere` (`:2777`, which is just
`IncrementLevel(level, 1, …) >= 0`) says leads somewhere, and only for something that is
not levitating.

When the **party** falls:

- with `d.SupressPitDamage` set (they climbed down a rope, `Attack.cpp:2031`), each
  *living* champion instead loses `AdjustStamina(chIdx, 25*load/MaxLoad + 1)`, so an
  unladen champion pays the floor of 1 and a half-loaded one pays 13;
- otherwise `DamageAllCharacters(20, 48, 2)` — mask 48 is legs and feet, kind 2 halves
  the armour — and sound 6 if anyone was hurt.

`d.SupressPitDamage` is cleared by the fall itself, not by the caller, so a rope onto a
stack of pits is free for the first drop only.

When a **monster group** falls: `DamageMonsterGroup(pDB4, oldX, oldY, 20, 0,
!item16Attached, …)` (`:3097`). `oldX, oldY` is the cell it fell *from* — `MoveObject`
has not relinked anything yet, so the group is still there.

Note what `kind == 2` means in `DamageCharacter`: it halves the **armour**, not the
damage (`Character.cpp:2780`). And the scaling that follows,
`ScaledMultiply(damage, 6, 130 - armour)`, is neutral at armour 65 — below that it
*amplifies*, so an unarmoured champion takes roughly double the nominal 20.

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
