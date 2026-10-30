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
   - **faithful**: the Atari, CSBWin and the port all have it. Not debt. Fixing it is the
     author's call, either a deliberate divergence (`DEBT.md` H, under `CLAUDE.md`'s test:
     obviously wrong, and costing the player something the game means to give) or an
     extra behind a setting (`DEBT.md` X), as X18 is for `BUG0_00`'s scents.
   - **CSBWin's fix**: the Atari releases have it, CSBWin does not, and the port follows
     CSBWin. Where ReDMCSB's Atari branch and CSBWin behave differently, ReDMCSB wins
     (`CLAUDE.md`), so each one is an item for `DEBT.md` C, or an H entry if the author
     keeps the fix.
   - **port diverges**: the port is not what CSBWin does, an item for `DEBT.md` C.
   - **absent**: none of the three has it, because an Atari release CSBWin follows fixed it.
   - **n/a**: nothing in the port matches the code: the hardware, the floppy disk, or
     code with no effect.

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
| BUG0_00 | 0 | No perceptible symptom while playing the game | partly (CHANGE2_06) | — | — | — |
| BUG0_01 | 0 | No perceptible symptom while playing the game | never | — | — | — |
| BUG0_02 | 1 | After playing a single game for hundreds of hours (in one row or across multiple save/load … | never | — | — | — |
| BUG0_03 | 0 | Graphical glitch | CSB 2.0 (CHANGE7_01) | — | — | — |
| BUG0_04 | 7 | Some creatures may be drawn with unexpected colors in Dungeon Master | never (DM's creature table only) | — | — | — |
| BUG0_05 | 7 | A champion portrait sensor on a wall square is visible on all sides of the wall | never | — | — | — |
| BUG0_06 | 7 | Graphical glitch when drawing projectiles or explosions | never | — | — | — |
| BUG0_07 | 7 | Graphical glitch when drawing explosions | 1.1 EN (CHANGE2_02) | — | — | — |
| BUG0_08 | 2 | Objects disappear in the dungeon and data is corrupted in memory | never | — | — | — |
| BUG0_09 | 2 | The game may trigger a sensor and cause an undesired effect when discarding a thing from a … | CSB 2.0 (CHANGE7_17) | — | — | — |
| BUG0_10 | 2 | No perceptible symptom when playing the game | CSB 2.0 (CHANGE7_18) | — | — | — |
| BUG0_11 | 3 | Data corruption in memory | never | — | — | — |
| BUG0_12 | 3 | An object is cloned and appears at two different locations in the dungeon and/or inventory | partly (CHANGE8_09) | — | — | — |
| BUG0_13 | 3 | The game may crash when Lord Order or Grey Lord cast spells | never (DM only) | — | — | — |
| BUG0_14 | 1 | While life is frozen, creature reaction events are not ignored as they should | 1.2 EN (CHANGE3_04) | — | — | — |
| BUG0_15 | 3 | The game hangs when you close a door on Lord Chaos | 1.1 EN (CHANGE2_03) | — | — | — |
| BUG0_16 | 2 | An object disappears when it is thrown or shot by a champion or launched by a projectile … | CSB 2.1 (CHANGE8_00) | — | — | — |
| BUG0_17 | 2 | The game crashes after the Fuse action is performed while looking at a wall on a map boundary | 1.3a FR (CHANGE5_02) | — | — | — |
| BUG0_18 | 1 | A projectile stays immobile in the air, an explosion remains forever on a square, a spell … | 1.2 EN (CHANGE3_05) | — | — | — |
| BUG0_19 | 1 | The game crashes when an object launcher sensor is triggered | never | — | — | — |
| BUG0_20 | 1 | Game crash when a launcher sensor is triggered | never | — | — | — |
| BUG0_21 | 1 | Projectiles created by launcher sensors never run out of kinetic energy and move until they … | CSB 2.1 (CHANGE8_01) | — | — | — |
| BUG0_22 | 3 | When a teleporter or pit opens, the game hangs or some things are not moved correctly | CSB 2.0 (CHANGE7_22) | — | — | — |
| BUG0_23 | 1 | A Fluxcage explosion remains on a square forever | never | — | — | — |
| BUG0_24 | 1 | Lord Chaos becomes invisible | 1.1 EN (CHANGE2_07) | — | — | — |
| BUG0_25 | 1 | When a champion dies, no bones object is created so it is not possible to bring the … | CSB 2.1 (CHANGE8_03) | — | — | — |
| BUG0_26 | 2 | An explosion may fall in a pit | never | — | — | — |
| BUG0_27 | 5 | The dungeon view is drawn during a fall while the party is sleeping | 1.2 EN (CHANGE3_06) | — | — | — |
| BUG0_28 | 5 | When falling through multiple pits the dungeon view is updated to show each traversed map … | CSB 2.1 (CHANGE8_04) | — | — | — |
| BUG0_29 | 2 | An explosion can trigger a floor sensor | never | — | — | — |
| BUG0_30 | 2 | A floor sensor is not triggered when you put an object on the floor if a levitating … | never | — | — | — |
| BUG0_31 | 2 | Floor sensors to detect the party on a stairs square are never triggered | CSB 2.1 (CHANGE8_05) | — | — | — |
| BUG0_32 | 4 | The load of a champion with no objects in his inventory is not 0 | never | — | — | — |
| BUG0_33 | 6 | The highlighted box around the acting champion's action hand is not cleared when clicking … | 1.1 EN (CHANGE2_08) | — | — | — |
| BUG0_34 | 6 | Graphical glitch when you quickly move the mouse into the action area after clicking on a … | never | — | — | — |
| BUG0_35 | 8 | The closed chest icon is drawn when the chest is opened | 1.1 EN (CHANGE2_10) | — | — | — |
| BUG0_36 | 8 | A champion icon may be missing in the upper right corner of the screen after loading a … | 1.2 EN (CHANGE3_07) | — | — | — |
| BUG0_37 | 8 | The contents of a chest are refreshed when grabbing or putting a Rabbit's Foot anywhere in … | CSB 2.0 (CHANGE7_25) | — | — | — |
| BUG0_38 | 4 | A champion is much luckier than expected during combat when equipped with at least 4 cursed … | never | — | — | — |
| BUG0_39 | 8 | In the leader inventory, the Food/Water/Poisoned panel is briefly drawn when replacing a … | never | — | — | — |
| BUG0_40 | 4 | If a champion has The Firestaff in the action hand then skill modifiers from other objects … | 1.2 EN (CHANGE3_09) | — | — | — |
| BUG0_41 | 4 | The Antifire and Antimagic statistics are completely ignored | never | — | — | — |
| BUG0_42 | 8 | The action icons are not drawn in the action area after you unfreeze the game | 1.2 EN (CHANGE3_10) | — | — | — |
| BUG0_43 | 6 | The game does not end if the last living champion in the party is killed while looking at a … | never | — | — | — |
| BUG0_44 | 4 | A champion may take much more damage than expected after a Black Flame attack or an impact … | 1.2 EN (CHANGE3_12) | — | — | — |
| BUG0_45 | 4 | Champions with a high vitality are more likely to get wounded | never | — | — | — |
| BUG0_46 | 4 | You can run into a projectile shot by a champion | CSB 2.1 (CHANGE8_07) | — | — | — |
| BUG0_47 | 8 | Graphical glitch when you open a scroll | never | — | — | — |
| BUG0_48 | 8 | The contents of a chest are reorganized when an object with a statistic modifier is placed … | CSB 2.0 (CHANGE7_27) | — | — | — |
| BUG0_49 | 8 | When examining an 'Empty Flask' the description string shows an undesired symbol | never | — | — | — |
| BUG0_50 | 5 | When a champion is brought back to life at a Vi Altar, his current stamina is lower than … | CSB 2.1 (CHANGE8_10) | — | — | — |
| BUG0_51 | 5 | Throwing the object in the leader hand does not stop the wait for player input in the main loop | CSB 2.1 (CHANGE8_11) | — | — | — |
| BUG0_52 | 8 | Graphical glitches and crashes | CSB 2.0 (CHANGE7_02) | — | — | — |
| BUG0_53 | 6 | It is possible to sleep while the inventory of a candidate champion is open | 1.1 EN (CHANGE2_15) | — | — | — |
| BUG0_54 | 4 | The defense modifier of an action is permanent | never | — | — | — |
| BUG0_55 | 4 | A champion in the back row may perform a melee attack even if there is another champion … | 1.2 EN (CHANGE3_14) | — | — | — |
| BUG0_56 | 5 | You can climb down a pit with the rope even if there is a group levitating over it | 1.3b FR (CHANGE6_00) | — | — | — |
| BUG0_57 | 6 | The object in the leader hand disappears after saving the game | 1.0b EN (CHANGE1_02) | — | — | — |
| BUG0_58 | 0 | The game stops with message 'SYSTEM ERROR 41' when you click Resume on the entrance screen … | 1.1 EN (CHANGE2_19) | — | — | — |
| BUG0_59 | 6 | The game hangs when using the Fuse action on Lord Chaos | 1.1 EN (CHANGE2_20) | — | — | — |
| BUG0_60 | 6 | On the Reincarnate/Resurrect screen, the 'Arrow' mouse pointer is replaced by the 'Hand' … | never | — | — | — |
| BUG0_61 | 0 | The game stops with message 'SYSTEM ERROR 60' right after restarting from a saved game | 1.1 EN (CHANGE2_05) | — | — | — |
| BUG0_62 | 0 | The game stops with message 'SYSTEM ERROR 41' if the game disk is removed from the floppy … | CSB 2.0 (CHANGE7_39) | — | — | — |
| BUG0_63 | 5 | The behavior of groups and the directions of individual creatures in groups are not … | never | — | — | — |
| BUG0_64 | 7 | Floor ornaments are drawn over open pits | never | — | — | — |
| BUG0_65 | 2 | Torches created by object generator or projectile launcher sensors have no charges | never | — | — | — |
| BUG0_66 | 3 | Smoke is placed on the source map instead of the destination map when a creature dies by … | never | — | — | — |
| BUG0_67 | 3 | A group that is not on the party map may wrongly move or not move into a teleporter | never | — | — | — |
| BUG0_68 | 3 | A group moves or acts with a wrong timing | never | — | — | — |
| BUG0_69 | 3 | Memory corruption when you close a door on Lord Chaos | CSB 2.0 (CHANGE7_19) | — | — | — |
| BUG0_70 | 3 | A projectile impact on a creature may be ignored | never | — | — | — |
| BUG0_71 | 0 | Some timings are too short on fast computers | never | — | — | — |
| BUG0_72 | 4 | The party moves very slowly even though no champion 'Load' value is drawn in red | never | — | — | — |
| BUG0_73 | 5 | A mouse click may be ignored | never | — | — | — |
| BUG0_74 | 7 | Creatures are drawn with wrong colors when viewed through a wall with the 'Thieve's Eye' spell | never | — | — | — |
| BUG0_75 | 6 | Multiple champion portraits are drawn (one at a time) then the game crashes | never | — | — | — |
| BUG0_76 | 7 | The same text is drawn on multiple sides of a wall square | never | — | — | — |
| BUG0_77 | 5 | The party moves forward when using the rope in front of a closed pit | never | — | — | — |
| BUG0_78 | 1 | A closing horizontal door wounds champions to the head instead of to the hands | never | has it: mask 4 (`Timer.cpp:1302`) | has it (`TimerSystem.ts:735`) | faithful |
| BUG0_79 | 5 | Stamina is decreased and experience is gained even when the Climb Down action fails | never | — | — | — |
| BUG0_80 | 6 | Data is corrupted in memory and the game eventually crashes | never | — | — | — |
| BUG0_81 | 4 | A weak champion may inflict high damage | never | — | — | — |
| BUG0_82 | 0 | LZW compressed data fails to decompress | never | — | — | — |
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
