# The Atari's known bugs, checked against CSBWin and the port

ReDMCSB lists 93 bugs of the Atari ST releases, DM 1.0a to 1.3b and CSB 2.0 and 2.1
(`doc/ReDMCSB-src/Documentation/BugsAndChanges.htm` → "Bugs",
<http://dmweb.free.fr/Stuff/ReDMCSB/Documentation/BugsAndChanges.htm#Bugs>). Each is named
`BUGv_nn`, `v` the release that brought it in, and its source tags every line it lives on
with that name, and every fix with its `CHANGEv_nn`. This file says, bug by bug, whether
CSBWin has it and whether the port does. It is `DEBT.md` F25's record: a row is filled
when its step is checked, and a row still at "—" is not checked yet.

## Checking a bug

1. **The Atari.** `command grep -n BUG0_78 doc/ReDMCSB-src/*.C` (the shell's `grep`
   skips the git-ignored tree), and the bug's text in the list. For a bug an Atari
   release fixed, grep its `CHANGE` too: the `#ifdef MEDIAnnn` around each line says
   which releases compile it.
2. **CSBWin.** ReDMCSB's names (`F0324_CHAMPION_DamageAll_GetDamagedChampionCount`) are
   not CSBWin's (`DamageAllCharacters`): find the counterpart by a call, a constant or a
   message the two share, through `doc/CSBWIN_SYMBOL_INDEX.tsv`. An open-ended search
   goes to an `Explore` subagent (`CLAUDE.md` → "Working economically"), which reports
   where the code is; the verdict is made here, against the source.
3. **The port.** It keeps CSBWin's names, so a grep of `src/` for them finds it.
4. **The row.** CSBWin's cell and the port's cite their `File:line`, and the verdict is
   one of:
   - **faithful**: the Atari, CSBWin and the port all have it. Unless it is game-breaking
     (below), not debt: fixing it is the author's call, bug by bug, either a deliberate
     divergence (`DEBT.md` H) or an extra behind a setting (`DEBT.md` X), as X18 is for
     `BUG0_00`'s scents.
   - **CSBWin's fix**: the Atari releases have it, CSBWin does not, and the port follows
     CSBWin. Where ReDMCSB's Atari branch and CSBWin behave differently, ReDMCSB wins
     (`CLAUDE.md`), so each one is an item for `DEBT.md` C, or an H entry if the author
     keeps the fix. A game-breaking one keeps CSBWin's fix, an H entry.
   - **port diverges**: the port is not what CSBWin does, an item for `DEBT.md` C.
   - **absent**: none of the three has it, because an Atari release CSBWin follows fixed it.
   - **n/a**: nothing in the port matches the code: the hardware, the floppy disk, or
     code with no effect.

**A game-breaking bug is fixed**, the author's rule, even where the Atari and CSBWin
share it: a crash or a hang, corrupted data, an object cloned or lost, and what follows
from them. Such a row's verdict says so (**faithful, game-breaking**), it becomes a
`DEBT.md` C item to fix, and its fix an H entry that cites both readings. Every other bug
is decided with the author one by one.

Which Atari release CSBWin follows is not known: the "V2.0" its dialogs print may come
from its data. So the eight bugs CSB 2.1 alone fixes (`CHANGE8_*`) are each checked
against CSBWin, not assumed.

## The steps

Grouped by subsystem, so a session reads each CSBWin file once. Step 0 is the bugs with
nothing to compare in a port, done in a pass.

| Step | Subsystem | Bugs |
| --- | --- | --- |
| 0 | Hardware, floppy, no symptom | 00 01 03 58 61 62 71 82 |
| 1 | The timeline (`TIMELINE.C`, `GAMELOOP.C`) | 02 14 18 19 20 21 23 24 25 78 |
| 2 | Things, projectiles and sensors (`DUNGEON.C`, `PROJEXPL.C`, `MOVESENS.C`) | 08 09 10 16 17 26 29 30 31 65 |
| 3 | Groups (`GROUP.C`) | 11 12 13 15 22 66 67 68 69 70 |
| 4 | Champions' statistics and combat (`CHAMPION.C`, `MENU.C`) | 32 38 40 41 44 45 46 54 55 72 81 |
| 5 | Actions, movement and pits (`MENU.C`, `CLIKMENU.C`, `MOVESENS.C`, `NEWMAP.C`) | 27 28 50 51 56 63 73 77 79 85 |
| 6 | Champions joined, revived, lost, saved (`REVIVE.C`, `LOADSAVE.C`, `STARTUP2.C`, `ENDGAME.C`) | 33 34 43 53 57 59 60 75 80 86 87 |
| 7 | The dungeon view (`DUNVIEW.C`) | 04 05 06 07 64 74 76 83 7_01 |
| 8 | The interface and its panels (`CHAMDRAW.C`, `PANEL.C`, `COMMAND.C`, `OBJECT.C`) | 35 36 37 39 42 47 48 49 52 88 2_00 5_00 7_00 84 |

A number alone is `BUG0_nn`.

## The bugs

"Fixed by the Atari" names the first Atari release without the bug and its change;
"never" is a bug every Atari release in its range keeps.

| Bug | Step | What the player sees | Fixed by the Atari | CSBWin | Port | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| BUG0_00 | 0 | No perceptible symptom while playing the game | partly (CHANGE2_06) | n/a: code with no effect, but the scents' comparison, which has one (X18) | n/a, but the scents (X18) | n/a |
| BUG0_01 | 0 | No perceptible symptom while playing the game | never | n/a: errors with no effect | n/a | n/a |
| BUG0_02 | 1 | After playing a single game for hundreds of hours (in one row or across multiple save/load … | never | fixed: a timer's time is 32 bits since 12.4 (`m_time`, `CSB.h:1881-1884`), a read save's 24-bit times are widened (`SaveGame.cpp:1879-1882`), and a save is written with `ExtendedTimers` (`:991`) | fixed: 32-bit times, read from any of the three forms (`parseTimers`, `src/data/SaveFile.ts`) and written in the 16-byte one (`SaveGameFile.ts:122`) | CSBWin's fix, game-breaking: kept (`DEBT.md` H) |
| BUG0_03 | 0 | Graphical glitch | CSB 2.0 (CHANGE7_01) | n/a: no vertical blank interrupt switches its palette | n/a: each frame is composed with both palettes (`ScreenComposer`) | n/a |
| BUG0_04 | 7 | Some creatures may be drawn with unexpected colors in Dungeon Master | never (DM's creature table only) | — | — | — |
| BUG0_05 | 7 | A champion portrait sensor on a wall square is visible on all sides of the wall | never | — | — | — |
| BUG0_06 | 7 | Graphical glitch when drawing projectiles or explosions | never | — | — | — |
| BUG0_07 | 7 | Graphical glitch when drawing explosions | 1.1 EN (CHANGE2_02) | — | — | — |
| BUG0_08 | 2 | Objects disappear in the dungeon and data is corrupted in memory | never | fixed: `AddObjectToRoom` grows `d.objectList` by 50 entries once fewer than 5 are free (`Code11f52.cpp:445-462`) | fixed: the list has no fixed size, and an entry is spliced in (`addObjectToCell`, `DungeonState.ts:361`; `doc/PROVEN_FACTS.md` → "The column index is saved state") | CSBWin's fix, game-breaking: kept (`DEBT.md` H) |
| BUG0_09 | 2 | The game may trigger a sensor and cause an undesired effect when discarding a thing from a … | CSB 2.0 (CHANGE7_17) | fixed: `MakeMoreRoomInDB` leaves a square at its first actuator that is not disabled (`Character.cpp:261-265`) | fixed: the same (`makeMoreRoomInDB`, `MakeMoreRoomInDB.ts:64-67`) | CSBWin's fix, as CSB 2.0's: kept (`DEBT.md` H) |
| BUG0_10 | 2 | No perceptible symptom when playing the game | CSB 2.0 (CHANGE7_18) | n/a: no bit 15, the bones' `important` is an argument of its own (`FindEmptyDBEntry`, `data.cpp:921`; `FindEmptyDB10Entry`, `CSBCode.cpp:5105`) | n/a: the same (`findEmptyDBEntry`, `DungeonState.ts:491`) | n/a: no symptom |
| BUG0_11 | 3 | Data corruption in memory | never | fixed: `AttachItem16ToMonster` grows `d.Item16` by 50 when none is free, up to 1050, and gives up past it (`CSBCode.cpp:6102-6137`) | fixed: the same growth (`attachItem16ToMonster`, `MonsterSystem.ts:157-164`), but past 1050 the group is left without one | CSBWin's fix, game-breaking: kept (`DEBT.md` H) |
| BUG0_12 | 3 | An object is cloned and appears at two different locations in the dungeon and/or inventory | partly (CHANGE8_09) | fixed: `ShowChestContents` clears each shown object's link and the chest's (`Character.cpp:3093-3106`) | fixed: the same (`showChestContents`, `OpenChest.ts:41-46`) | CSBWin's fix, game-breaking: kept (`DEBT.md` H) |
| BUG0_13 | 3 | The game may crash when Lord Order or Grey Lord cast spells | never (DM only) | fixed: `missile = RNnul` before the switch (`Monster.cpp:1045`), and no missile is launched for it (`:1181-1196`) | fixed: the same (`chooseMissile`, `MonsterAttack.ts:317-320`; `:109`) | CSBWin's fix, game-breaking: kept (`DEBT.md` H) |
| BUG0_14 | 1 | While life is frozen, creature reaction events are not ignored as they should | 1.2 EN (CHANGE3_04) | fixed: a reaction (`timeFunc < TT_EMPTY`) is dropped while life is frozen (`Monster.cpp:3000-3014`) | fixed: the same test (`MonsterAI.ts:1449`) | absent |
| BUG0_15 | 3 | The game hangs when you close a door on Lord Chaos | 1.1 EN (CHANGE2_03) | fixed: the loop needs `w_54 != -1` (`Process_Invincible_And_Finish`, `Monster.cpp:1945`) | fixed: the same (`processInvincibleAndFinish`, `MonsterAI.ts:1118`) | absent |
| BUG0_16 | 2 | An object disappears when it is thrown or shot by a champion or launched by a projectile … | CSB 2.1 (CHANGE8_00) | has it: `LaunchMissile` returns -1 without a missile record (`Magic.cpp:33-34`), once the database holds 8000 (`CSB.h:1649`) and `MakeMoreRoomInDB` finds none outside the party's 11×11 squares, and its callers lose what they took (`Mouse.cpp:744`, `Timer.cpp:1985`, `:1997`, `:2067`) | has it (`launchMissile`, `MagicSystem.ts:62`), but a throw from the cursor puts the object back in the hand (`MouseSystem.ts:188`), as no release does | faithful, game-breaking: to fix (`DEBT.md` C198) |
| BUG0_17 | 2 | The game crashes after the Fuse action is performed while looking at a wall on a map boundary | 1.3a FR (CHANGE5_02) | fixed: `_Fusion` returns off the map (`Attack.cpp:150-157`) | fixed: the same (`fusion`, `Fusion.ts:113-114`) | absent |
| BUG0_18 | 1 | A projectile stays immobile in the air, an explosion remains forever on a square, a spell … | 1.2 EN (CHANGE3_05) | fixed: `SetTimer` dies with error 45, but only at 5000 timers, growing the table by a quarter before (`Timer.cpp:1001-1010`), where the Atari stops at the dungeon's count | the same (`TimerQueue.ts:287-290`) | absent; the table's growth kept (`DEBT.md` H) |
| BUG0_19 | 1 | The game crashes when an object launcher sensor is triggered | never | fixed: the object launcher's walks end at `RNeof`, "Original had RNnul" (`Timer.cpp:1919-1933`, `:1939-1953`) | fixed: the same walk (`takeObject`, `TimerSystem.ts:1287`) | CSBWin's fix, game-breaking: kept (`DEBT.md` H) |
| BUG0_20 | 1 | Game crash when a launcher sensor is triggered | never | has it: no bound is checked (`Timer.cpp:1982-1983`), so `AddObjectToRoom` places the missile nowhere at x -1 (`Code11f52.cpp:465`) and reads past the level's columns or a column's cells elsewhere | fixed: the bound is checked before the launcher takes anything from its square or makes anything, and it launches nothing (`TimerSystem.ts:1283`, `tools/checks/missile-launcher.ts`) | faithful, game-breaking: fixed (`DEBT.md` H) |
| BUG0_21 | 1 | Projectiles created by launcher sensors never run out of kinetic energy and move until they … | CSB 2.1 (CHANGE8_01) | has it: `decayRate` 0 (`Timer.cpp:1993`, `:2005`) | fixed: CSB 2.1's step energy, the author's choice, on every set (`TimerSystem.ts:1271`, `tools/checks/missile-launcher.ts`) | CSB 2.1's fix: kept (`DEBT.md` H) |
| BUG0_22 | 3 | When a teleporter or pit opens, the game hangs or some things are not moved correctly | CSB 2.0 (CHANGE7_22) | fixed: the group is moved first, then as many objects as were counted beyond it (`WiggleEverything`, `Timer.cpp:2446-2470`) | fixed: the same (`wiggleEverything`, `TimerSystem.ts:1735-1751`) | CSBWin's fix, as CSB 2.0's, game-breaking: kept (`DEBT.md` H) |
| BUG0_23 | 1 | A Fluxcage explosion remains on a square forever | never | fixed: an opened pit or teleporter moves every `TT_25` and `TT_24` naming the cloud (`WiggleEverything`, `Timer.cpp:2497-2498`), and a DSA's move too (`MoveObject.cpp:238`) | fixed: the same two (`wiggleEverything`, `TimerSystem.ts:1779`; `src/engine/dsa/ops/move.ts:266`) | CSBWin's fix, game-breaking: kept (`DEBT.md` H) |
| BUG0_24 | 1 | Lord Chaos becomes invisible | 1.1 EN (CHANGE2_07) | fixed: Lord Chaos tries a random adjacent square one time in four (`ProcessTimer60and61`, `Timer.cpp:2597-2623`) | fixed: the same (`processAbeyanceTimer`, `MonsterSystem.ts:699`) | absent |
| BUG0_25 | 1 | When a champion dies, no bones object is created so it is not possible to bring the … | CSB 2.1 (CHANGE8_03) | fixed: the altar deletes the bones it takes (`ProcessTT_ViAltar`, `Timer.cpp:2762`, `:2781`, `:2793`) | fixed: the same (`processViAltar`, `TimerSystem.ts:1044-1045`; `reviveInWings`, `:1071-1072`) | CSBWin's fix, as CSB 2.1's, game-breaking: kept (`DEBT.md` H) |
| BUG0_26 | 2 | An explosion may fall in a pit | never | has it: `Levitating` is false for a cloud, its test commented out (`Code11f52.cpp:2452-2475`), so `MoveObject`'s pit takes it | has it (`levitating`, `WorldMove.ts:551`; `allowFall`, `:211`) | faithful |
| BUG0_27 | 5 | The dungeon view is drawn during a fall while the party is sleeping | 1.2 EN (CHANGE3_06) | — | — | — |
| BUG0_28 | 5 | When falling through multiple pits the dungeon view is updated to show each traversed map … | CSB 2.1 (CHANGE8_04) | — | — | — |
| BUG0_29 | 2 | An explosion can trigger a floor sensor | never | has it: `MoveObject` sets a missile down with `AddObjectToRoom`, and anything else, a cloud too, with `PlaceOrRemoveObjectInRoom`, which presses the pads (`Code11f52.cpp:3462-3483`) | has it (`moveObject`, `WorldMove.ts:227`) | faithful |
| BUG0_30 | 2 | A floor sensor is not triggered when you put an object on the floor if a levitating … | never | has it: a type 1 pad does nothing while a group is on its square (`PressurePadOrAlcove`, `Code11f52.cpp:3782`), flying or not (`:3981`) | has it (`ActuatorSystem.ts:414`, `:569`) | faithful |
| BUG0_31 | 2 | Floor sensors to detect the party on a stairs square are never triggered | CSB 2.1 (CHANGE8_05) | has it: a type 5 pad never acts (`Code11f52.cpp:3827-3828`) | has it (`ActuatorSystem.ts:438-440`) | faithful |
| BUG0_32 | 4 | The load of a champion with no objects in his inventory is not 0 | never | fixed: a read leaves `d.HandChar` as saved, "the Atari code added the weight of the object in hand already", so `SetHandOwner` returns at once (`CSBCode.cpp:6394-6411`, `:8483`), "patch has been put into the Atari code" | fixed: the load is summed from the possessions and the object in hand, counted once (`characterLoad`, `CharacterStats.ts:110`) | CSBWin's fix: to decide (`DEBT.md` F25) |
| BUG0_33 | 6 | The highlighted box around the acting champion's action hand is not cleared when clicking … | 1.1 EN (CHANGE2_08) | — | — | — |
| BUG0_34 | 6 | Graphical glitch when you quickly move the mouse into the action area after clicking on a … | never | — | — | — |
| BUG0_35 | 8 | The closed chest icon is drawn when the chest is opened | 1.1 EN (CHANGE2_10) | — | — | — |
| BUG0_36 | 8 | A champion icon may be missing in the upper right corner of the screen after loading a … | 1.2 EN (CHANGE3_07) | — | — | — |
| BUG0_37 | 8 | The contents of a chest are refreshed when grabbing or putting a Rabbit's Foot anywhere in … | CSB 2.0 (CHANGE7_25) | — | — | — |
| BUG0_38 | 4 | A champion is much luckier than expected during combat when equipped with at least 4 cursed … | never | fixed: an attribute's getters read a byte above 240 as 0 (`ATTRIBUTE::Minimum`, `data.cpp:1719-1729`), so a luck minimum wrapped by four cursed objects bounds nothing (`IsCharacterLucky`, `Character.cpp:2193-2201`) | fixed: the same getters (`readByte`, `attributes.ts:61`; `isCharacterLucky`, `ChampionDamage.ts:429`) | CSBWin's fix: to decide (`DEBT.md` F25) |
| BUG0_39 | 8 | In the leader inventory, the Food/Water/Poisoned panel is briefly drawn when replacing a … | never | — | — | — |
| BUG0_40 | 4 | If a champion has The Firestaff in the action hand then skill modifiers from other objects … | 1.2 EN (CHANGE3_09) | fixed: the Firestaff's bonus adds to the neck's (`DetermineMastery`, `Code17818.cpp:76-148`) | fixed: the same (`possessionMasteryBonus`, `skills.ts:162`) | absent |
| BUG0_41 | 4 | The Antifire and Antimagic statistics are completely ignored | never | fixed: `TAG016426` reads the statistic, `170 - w_10`, after a forum discussion with ReDMCSB's author (`Character.cpp:2062`, `:2063-2146`): antifire, antimagic and vitality count, against fire, magic, wounds and a creature's poison (`:2772`, `:2779`, `:2800`; `Monster.cpp:4603`) | fixed: the same (`attributeScaledReduction`, `ChampionDamage.ts:449`; `MonsterAttack.ts:400`) | CSBWin's fix: to decide, with `BUG0_45` (`DEBT.md` F25) |
| BUG0_42 | 8 | The action icons are not drawn in the action area after you unfreeze the game | 1.2 EN (CHANGE3_10) | — | — | — |
| BUG0_43 | 6 | The game does not end if the last living champion in the party is killed while looking at a … | never | — | — | — |
| BUG0_44 | 4 | A champion may take much more damage than expected after a Black Flame attack or an impact … | 1.2 EN (CHANGE3_12) | fixed: a blow at or below 0 after the fire shield returns 0 before it is scaled (`DamageCharacter`, `Character.cpp:2792`) | fixed: the same (`damageCharacter`, `ChampionDamage.ts:145`) | absent |
| BUG0_45 | 4 | Champions with a high vitality are more likely to get wounded | never | has it, and shows it, since it reads vitality (`BUG0_41`): the wound threshold is `TAG016426` of vitality, smaller the higher vitality is (`Character.cpp:2799-2812`) | has it (`damageCharacter`, `ChampionDamage.ts:156`) | faithful to CSBWin, unseen on the Atari: to decide, with `BUG0_41` (`DEBT.md` F25) |
| BUG0_46 | 4 | You can run into a projectile shot by a champion | CSB 2.1 (CHANGE8_07) | has it: only a throw locks the move ahead, `d.Word11712 = 4` (`Mouse.cpp:754`); `LaunchObject`, which shoots and casts, does not (`Magic.cpp:452-466`) | has it (`launchObject`, `MagicSystem.ts:556`; the throw's lock, `MouseSystem.ts:255`) | faithful |
| BUG0_47 | 8 | Graphical glitch when you open a scroll | never | — | — | — |
| BUG0_48 | 8 | The contents of a chest are reorganized when an object with a statistic modifier is placed … | CSB 2.0 (CHANGE7_27) | — | — | — |
| BUG0_49 | 8 | When examining an 'Empty Flask' the description string shows an undesired symbol | never | — | — | — |
| BUG0_50 | 5 | When a champion is brought back to life at a Vi Altar, his current stamina is lower than … | CSB 2.1 (CHANGE8_10) | — | — | — |
| BUG0_51 | 5 | Throwing the object in the leader hand does not stop the wait for player input in the main loop | CSB 2.1 (CHANGE8_11) | — | — | — |
| BUG0_52 | 8 | Graphical glitches and crashes | CSB 2.0 (CHANGE7_02) | — | — | — |
| BUG0_53 | 6 | It is possible to sleep while the inventory of a candidate champion is open | 1.1 EN (CHANGE2_15) | — | — | — |
| BUG0_54 | 4 | The defense modifier of an action is permanent | never | fixed: an attack sets `word64` to its modifier and its end clears it, "instead of adding and subtracting" (`Character.cpp:4995`, `Timer.cpp:2652`, `CSB.h:2599-2621`), so a failed Climb Down, which leaves the action enabled (`Attack.cpp:2039`), keeps its −15 only until the next action | fixed: the same (`CharacterSystem.ts:282`, `TimerSystem.ts:276`) | CSBWin's fix: to decide (`DEBT.md` F25) |
| BUG0_55 | 4 | A champion in the back row may perform a melee attack even if there is another champion … | 1.2 EN (CHANGE3_14) | fixed: the back right checks the front right and the back left the front left (`Attack.cpp:1097-1116`) | fixed: the same (`AttackSystem.ts:584`) | absent |
| BUG0_56 | 5 | You can climb down a pit with the rope even if there is a group levitating over it | 1.3b FR (CHANGE6_00) | — | — | — |
| BUG0_57 | 6 | The object in the leader hand disappears after saving the game | 1.0b EN (CHANGE1_02) | — | — | — |
| BUG0_58 | 0 | The game stops with message 'SYSTEM ERROR 41' when you click Resume on the entrance screen … | 1.1 EN (CHANGE2_19) | n/a: the floppy disk | n/a | n/a |
| BUG0_59 | 6 | The game hangs when using the Fuse action on Lord Chaos | 1.1 EN (CHANGE2_20) | — | — | — |
| BUG0_60 | 6 | On the Reincarnate/Resurrect screen, the 'Arrow' mouse pointer is replaced by the 'Hand' … | never | — | — | — |
| BUG0_61 | 0 | The game stops with message 'SYSTEM ERROR 60' right after restarting from a saved game | 1.1 EN (CHANGE2_05) | fixed: `TAG021028` resets `d.WatchdogTime` (`CSBCode.cpp:10610`) at the start (`:10801`) and at a restart (`Code1f9e6.cpp:318`) | fixed: every read makes `watchdogTime` 0xffffffff (`initializeGameContext`, `src/engine/GameContext.ts`), and every start and restart follows a read (`tools/checks/watchdog.ts`) | absent |
| BUG0_62 | 0 | The game stops with message 'SYSTEM ERROR 41' if the game disk is removed from the floppy … | CSB 2.0 (CHANGE7_39) | n/a: the floppy disk | n/a | n/a |
| BUG0_63 | 5 | The behavior of groups and the directions of individual creatures in groups are not … | never | — | — | — |
| BUG0_64 | 7 | Floor ornaments are drawn over open pits | never | — | — | — |
| BUG0_65 | 2 | Torches created by object generator or projectile launcher sensors have no charges | never | has it: `ConstructPredefinedMissile` charges a torch only if it is lit (`Mouse.cpp:163-168`), and a new record is cleared (`data.cpp:991`) | has it: no charges (`constructPredefinedMissile`, `missileHelpers.ts:81-82`) | faithful |
| BUG0_66 | 3 | Smoke is placed on the source map instead of the destination map when a creature dies by … | never | has it: a fall hurts the group on its source level at its source square (`Code11f52.cpp:3129-3132`), where its death cloud is made (`:1299`, `:1304`) | has it (`monsterFallsIntoPit`, `WorldMove.ts:530-533`; `MonsterDamage.ts:553-556`) | faithful: unseen, the cloud falls through the pit (`BUG0_26`) |
| BUG0_67 | 3 | A group that is not on the party map may wrongly move or not move into a teleporter | never | fixed: `d.LastMonsterMoved` is the group before any move (`Monster.cpp:2796`), which `PossibleMove`'s teleporter test reads, "I have patched the Atari code" (`:736-741`) | fixed: the test reads the group moved (`possibleMove`, `MonsterPerception.ts:467`) | CSBWin's fix: kept (`DEBT.md` H) |
| BUG0_68 | 3 | A group moves or acts with a wrong timing | never | fixed: the timer's `uByte8` is 0, "also patched into the Atari binary" (`Monster.cpp:2880-2891`) | fixed: 0 (`MonsterAI.ts:1387`) | CSBWin's fix: kept (`DEBT.md` H) |
| BUG0_69 | 3 | Memory corruption when you close a door on Lord Chaos | CSB 2.0 (CHANGE7_19) | fixed: the double move's directions are drawn at random (`Process_Invincible_And_Finish`, `Monster.cpp:1950-1952`) | fixed: the same (`processInvincibleAndFinish`, `MonsterAI.ts:1121-1122`) | CSBWin's fix, as CSB 2.0's, game-breaking: kept (`DEBT.md` H) |
| BUG0_70 | 3 | A projectile impact on a creature may be ignored | never | has it: `CheckMonsterVersusMissiles` compares a missile's corner with the whole positions byte (`Monster.cpp:4491`), as the corner move passes it (`:3974`) | has it (`checkMonsterVersusMissiles`, `MonsterAI.ts:1268`) | faithful |
| BUG0_71 | 0 | Some timings are too short on fast computers | never | paced: the zoom's `VBLDelay(2)` and the `VBLDelay(20)` after it (`CSBCode.cpp:9451`, `:9476`), the doors' six VBLs a step (`:9550`), the fusion's `testdelay` (`Attack.cpp:19`, `:2312`); no view drawn in a fall (`Code11f52.cpp:3068`) | the same: `TitleSequence.ts:127`, `PrisonDoor.ts:66`, `Fusion.ts:20`, and `WorldMove.ts` draws nothing | n/a: no ST to outrun |
| BUG0_72 | 4 | The party moves very slowly even though no champion 'Load' value is drawn in red | never | has it: `MaxLoad > load` is the fast branch (`TimeToMove`, `CSBCode.cpp:7071`), where the load is drawn red only above it (`Character.cpp:1427`) | has it (`timeToMove`, `CharacterStats.ts:170`) | faithful |
| BUG0_73 | 5 | A mouse click may be ignored | never | — | — | — |
| BUG0_74 | 7 | Creatures are drawn with wrong colors when viewed through a wall with the 'Thieve's Eye' spell | never | — | — | — |
| BUG0_75 | 6 | Multiple champion portraits are drawn (one at a time) then the game crashes | never | — | — | — |
| BUG0_76 | 7 | The same text is drawn on multiple sides of a wall square | never | — | — | — |
| BUG0_77 | 5 | The party moves forward when using the rope in front of a closed pit | never | — | — | — |
| BUG0_78 | 1 | A closing horizontal door wounds champions to the head instead of to the hands | never | has it: mask 4 (`Timer.cpp:1302`) | has it (`TimerSystem.ts:736`) | faithful |
| BUG0_79 | 5 | Stamina is decreased and experience is gained even when the Climb Down action fails | never | — | — | — |
| BUG0_80 | 6 | Data is corrupted in memory and the game eventually crashes | never | — | — | — |
| BUG0_81 | 4 | A weak champion may inflict high damage | never | fixed: `D6W = 0` when the throwing distance is 0, "Tiggy 'Bashing' with a stone club" (`DeterminePhysicalAttackDamage`, `Attack.cpp:707-709`) | fixed: the same (`AttackSystem.ts:479`) | CSBWin's fix: to decide (`DEBT.md` F25) |
| BUG0_82 | 0 | LZW compressed data fails to decompress | never | has it: `Graphics.cpp:2764`, and the Hint Oracle's `Hint.cpp:3070` | has it: `compression.ts:132`, both files' one decoder | faithful: the three decode alike, so a file reads here as on the Atari |
| BUG0_83 | 7 | The hole created by the Window action or the Thieve's Eye spell moves with opening doors | never | — | — | — |
| BUG0_84 | 8 | The ending screen with champion portraits is displayed with an incorrect color palette that … | never | — | — | — |
| BUG0_85 | 5 | Movement over a group is not blocked if there are no champions in the party | never | — | — | — |
| BUG0_86 | 6 | Champion portraits, resurrect/reincarnate and rename panel graphics are missing/garbage and … | never | — | — | — |
| BUG0_87 | 6 | The same champion may be resurrected/reincarnated multiple times | never | — | — | — |
| BUG0_88 | 8 | Text is displayed outside of the scroll bitmap | never | — | — | — |
| BUG2_00 | 8 | The closed scroll icon is drawn when the scroll is open | never | — | — | — |
| BUG5_00 | 8 | When looking at a champion's dead bones by pressing the eye, the name in the panel only … | never (1.3 FR only) | — | — | — |
| BUG7_00 | 8 | When holding a champion's dead bones in hand, a space character is missing between the … | never | — | — | — |
| BUG7_01 | 7 | Some creatures may be drawn with unexpected colors in Chaos Strikes Back | never | — | — | — |
