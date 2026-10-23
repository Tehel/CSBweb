# 3D2D1D: what the dungeon holds and how its puzzles work

3D2D1D is Paul R. Stevens' puzzle dungeon for CSBWin. His page
(`https://dianneandpaul.net/CSBwin/Games/3D2D1D_Description.html`) insists it is "**NOT**
a game" but a puzzle for "pencil, paper, and hard work". The 2-D maze was the hardest of
several dozen machine-generated ones, and the 1-D puzzle took him about three hours with
no prior knowledge.

This file describes the dungeon and explains every mechanism, so it spoils the puzzles.
The step-by-step solution is in [`3D2D1D_WALKTHROUGH.md`](3D2D1D_WALKTHROUGH.md). The engine features the
dungeon needs (vertical moves, gravity, the two extended-feature bits that turn them on)
are in [`doc/3D2D1D.md`](../../../doc/3D2D1D.md). The port plays them.

Coordinates are `map (x,y)`, with north up and y growing south. A wall face is named by the
side of the wall it is on: "(6,3) east face" is seen from (7,3) looking west. Everything
here was read from `dungeon.dat` and `graphics.dat` with `tools/peek-dungeon.ts` (its
`dump` command lists every object of a map) and checked with a model of CSBWin's movement
(see [How this was worked out](#how-this-was-worked-out)).

## At a glance

| Map | Size | Role |
| --- | --- | --- |
| 0 | 32x32 (only an 18x10 corner is used) | The hub: start, champion, the three entrances, the locks, the end |
| 1-7 | 15x15 each | **3D**: a 7x7x7 cube of rooms joined by vertical shafts, entered from a shaft on map 0 |
| 8 | 32x32 | **2D**: a gravity maze on a single level |
| 9 | 32x8 | **1D**: a corridor of teleporters rewired by levers and scripts (DSAs) |

- The party starts on map 0 at (3,2), facing east, with no champion. The one mirror holds
  the one champion, AIRWING.
- No monster is placed anywhere. Maps 1-9 allow Screamers and Rockpiles, but the only way
  a monster appears is the Screamer generator on map 6.
- Each puzzle pays one **gold key**, and the hub's three gold locks open, one after the
  other, the corridor to the end. The 3D puzzle pays in two steps: a **ruby key**, which
  opens the door to the first gold key.

## The rules of motion

Two CSBWin features, switched on by this dungeon's header (`doc/3D2D1D.md`), change how
the party moves. Everything below is `doc/CSBwin-src/CSBCode.cpp` (`MoveParty`, 8031-8437)
and `doc/CSBwin-src/Mouse.cpp` (`GravityMove`, 1259-1370).

### Shafts and the `-`/`+` keys

Every pit in the dungeon is flagged open **and** imaginary (bit 0). `MoveObject` drops
nothing through an imaginary pit (`Code11f52.cpp:3050-3055`), so the party walks over them.
They are shafts, used with two keys:

- **`-` goes down** one level and needs a pit under the party.
- **`+` goes up** one level and needs a pit at the same x,y on the level above
  (`CSBCode.cpp:8269-8284`).
- x and y are kept: every map sits at offset (0,0), so `IncrementLevel`
  (`CSBCode.cpp:4774`) changes only the level. A shaft on level *k* is therefore the link
  between levels *k* and *k+1*. Every shaft on maps 0-6 has floor or another shaft under
  it.
- If a monster is on the target square, the move is refused without harm
  (`CSBCode.cpp:8286-8291`).
- With no shaft, the move counts as walking into stone: a **bump**, costing up to 1 HP
  (`DamageCharacter(…, 1, 24, 2)`, `CSBCode.cpp:8309-8377`).

### Gravity

After every step, CSBWin keeps moving the party, one square every two ticks, until
nothing moves. Meanwhile the mouse queue is emptied, so keys and clicks are thrown away
(`Mouse.cpp:1482-1491`). The rule:

- CSBWin remembers, for each of the three axes (east-west, north-south, up-down), **the
  direction the party last stepped along it**, and orders the axes from most to least
  recently stepped along (`moveHistory`, `CSBCode.cpp:8128-8164`, initially
  `{0,1,2,0}` = west, north, up; `data.cpp:246`).
- Each gravity step tries the axes **from the least recently used to the most recently
  used**, one square in the remembered direction, and takes the first that is possible:
  - Sideways, the target must be floor or a shaft. **Gravity never moves the party onto a
    door, a teleporter or a false wall**, open or not. The player can step onto them.
  - Down needs a shaft under the party, and up needs a shaft above.
  - A monster on the target rules that axis out.
- Gravity's own steps do not update the memory. Only the player's do.

What this means in play:

1. **It is not ice.** After a step east, the party first tries to keep going along the
   *other* two axes, in the directions remembered for them. The memory works like the tilt
   of a physical marble maze, with gravity pointing along all three axes at once. Paul's
   text on map 0 says he once built that puzzle in balsa wood and plastic.
2. **A refused step still re-aims gravity.** The memory is updated before the wall test
   (`CSBCode.cpp:8128-8164` comes before the wall test at `:8315`), so bumping into a wall is the way to change
   a direction without moving. It costs up to 1 HP. A refused step into a monster costs
   nothing.
3. **Facing does not matter.** Gravity works in absolute directions. Turning is not a
   move, so it never starts gravity.
4. **A teleport is followed by gravity when a step caused it** (the slide continues at the
   destination). It is not followed by gravity when a switch caused it: a teleporter that
   turns on under the party carries it by `WiggleEverything` (`Timer.cpp:2428`), which is
   not a party move.
5. **Gravity runs everywhere**, the hub included: one step east from the start slides the
   party along row 2, up column 7 and into the corner at (8,0).
6. Our source's `SaveGame` does not save the memory (`doc/3D2D1D.md`), so a reloaded game
   may not behave like the game that was saved. In CSBWin a load keeps the last game's
   memory; in the port every load starts from the program's, so the same save always
   slides the same way. Three moves, one along each axis, give either the same memory.

## Map 0: the hub

```
              11111111
    012345678901234567
  0 #######..#########       @  start, facing east
  1 #######.##########       D  door   F  false wall   O  shaft
  2 ###@......########       T  teleporter (t: inactive)
  3 #####.#.#.########
  4 #####D#F#..t######
  5 #####.#.#.#####t##
  6 #######.#.......##
  7 #######O##.#.#####
  8 ############D#####
  9 ############.D.D..
```

| Where | What |
| --- | --- |
| (3,1) south face | "REWARD FOR PERSISTENCE", read from the start square |
| (10,2) west face | The **mirror** (type 127). AIRWING, from the hidden text on (9,2) |
| (6,3) east face | Small switch (type 2, normally closed: fires when clicked empty-handed). Opens the **false wall (7,4)** after 10 ticks. "THREE" on (8,3) west face |
| (7,7) | The **shaft into the 3D maze**. "MINUS KEY MOVE DOWN" on (6,7) east face, "PLUS KEY MOVE UP" on (8,7) west face |
| (12,4) west face | Small switch, clicked from (11,4). Turns on the **teleporter (11,4)** after 6 ticks: party to map 8 (29,20), facing north. "TWO" on (11,3) south face |
| (15,4) south face | Small switch, clicked from (15,5). Turns on the **teleporter (15,5)** after 6 ticks: party to map 9 (1,5), facing north. "ONE" on (14,5) east face |
| (2,2) east face | **Ruby keyhole** (type 4, takes the key). Opens the **door (5,4)** after 6 ticks |
| (5,5) | **Gold key 1**, and "THAT IS AMAZING. YOU HAVE SOLVED AN ELECTRONIC VERSION OF A THREE DIMENSIONAL PUZZLE I BUILT OF BALSA WOOD AND PLASTIC FORTY YEARS AGO." |
| (11,7) east face | Gold keyhole, clicked from (12,7). Opens the door (12,8) |
| (12,10) north face | Gold keyhole, clicked from (12,9). Opens the door (13,9) |
| (14,10) north face | Gold keyhole, clicked from (14,9). Opens the door (15,9) |
| (17,9) | The end: "VERY NICELY DONE. TWENTY DOLLAR REWARD FOR EACH OF THE FIRST THREE PEOPLE TO CONVINCE ME THAT THEY HAVE SOLVED THIS PUZZLE.", and the author's e-mail address |
| (10,8) north face | A **water fountain**, seen from (10,7), where the waterskin lies |

The switches and the teleporters stay switched: once used, (11,4) and (15,5) are live
teleporters for the rest of the game, and stepping onto them sends the party back into
the 2D or the 1D puzzle. Food on map 0: dragon steaks at (8,0), (10,4), (15,6), (12,9) and
(14,9), and an apple at (7,6).

The wall ornaments come from the level's table, entry `ordinal - 1`
(`AsciiDump.cpp:822-830`). Map 0's table is: mirror (43), small switch (7), slime outlet
(12), gold keyhole (26), lever down (45), lever up (44), ruby keyhole (29), water fountain
(35). The names are `AsciiDump.cpp`'s. For 4 (hook), 33 (slime) and 34 (grate), which it
does not name, they are the Dungeon Master Encyclopaedia's (`doc/DUNGEON_DAT_FORMAT.md` →
"Not checked against CSBWin").

### The champion

The hidden text on (9,2) is AIRWING's definition. CSBWin decodes it in `AddCharacter`
(`doc/CSBwin-src/Character.cpp:592-688`, mirrored by `src/data/HeroExtractor.ts`). It
reads `AIRWING`, no title, `M`, then `AADC ABPE AADC` = health 50, stamina 500 (shown as 50),
mana 50, then `AK` + six times `DC` = luck 10 and 50 in strength, dexterity, wisdom,
vitality, anti-magic and anti-fire, then sixteen `A`: no skill at all. One plain champion,
alone, which the bumps and the Screamers will both wear down a little.

## The 3D maze (maps 1-7)

```
    map 1                 map 2                 map 3                 map 4
              11111                 11111                 11111                 11111
    012345678901234       012345678901234       012345678901234       012345678901234
  0 ###############     0 ###############     0 ###############     0 ###############
  1 #O...O#..O#...#     1 #.#O#...#..O#O#     1 #...#.....#.#.#     1 #O#..O#..O#..O#
  2 #####.#.#####.#     2 #.#.###.###.#.#     2 #.#######.###.#     2 #.#####.###.###
  3 #.#...#.#O#.#O#     3 #.#O#...#.#O#.#     3 #.#.#..O#.....#     3 #.....#.#...#O#
  4 #.#######.#.###     4 #.#######.###.#     4 ###.###########     4 #############.#
  5 #...#O....#...#     5 #..O#O#O......#     5 #...#O#..O#...#     5 #...#...#.#...#
  6 ###.#####.#.#.#     6 ###############     6 #.#######.#.#.#     6 #.#####.#.#.###
  7 #.#..O#.#...#.#     7 #.....#O.O#O..#     7 #.....#.#.#.#.#     7 #O#..O#O#O#...#
  8 #.#.###.#####.#     8 #.#####.#####.#     8 #####.#.#####.#     8 ###.#########.#
  9 #.#O..#O#O#..O#     9 #.#...#.#...#.#     9 #O#O#O#..O#...#     9 #.#.#..O#.....#
 10 #.###.###.#.###    10 #.###.#.###.###    10 #.#.###########    10 #.###.#########
 11 #O#O#.....#.#O#    11 #.#.#O#..O#O#.#    11 #.#...#O..#O#O#    11 #...#O#...#...#
 12 #.#.#######.#.#    12 #.#.#########.#    12 #.#####.#####.#    12 ###########.#.#
 13 #.#.....#O..#.#    13 #O#O#O....#O..#    13 #.#...#O#.....#    13 #O....#..O#.#O#
 14 ###############    14 ###############    14 ###############    14 ###############

    map 5                 map 6                 map 7
              11111                 11111                 11111
    012345678901234       012345678901234       012345678901234
  0 ###############     0 ###############     0 ###############
  1 #.#O#...#.....#     1 #O....#O......#     1 #.#.......#...#
  2 #.#####.###.###     2 #.#############     2 #.#.#####.#.#.#
  3 #O#..O#O#.#..O#     3 #.#...#.#....O#     3 #.#.#.....#.#.#
  4 ###.#####.#####     4 #.#.###.#.#####     4 #.#.#.#####.###
  5 #O#.#O..#.....#     5 #.#O#.#O#O#...#     5 #.#.#.#...#...#
  6 #.#.###.#.#.###     6 #####.#####.###     6 #.#.###########
  7 #.#...#.#.#.#O#     7 #...#..O#...#.#     7 #.#.#...#.....#
  8 #.#######.###.#     8 #.#.#####.###.#     8 ###.#.###.###.#
  9 #.....#.#O#...#     9 #O#...#O#.#O#.#     9 #.#...#.#.#...#
 10 ###.###.###.###    10 #####.#.###.#.#    10 #.###.#.#######
 11 #O#.#.#.....#.#    11 #.#O#.#...#...#    11 #...#.#.......#
 12 #.#.#######.#.#    12 #.#.#########.#    12 #####.#.#####D#
 13 #...#..O#.#O..#    13 #O#O#.....#.....#    13 #.....#.....#t#
 14 ###############    14 ###############    14 ###############
```

**Structure.** Each level is a 7x7 grid of rooms at odd coordinates, with the even
coordinates as walls or passages. That makes a 7x7x7 cube of 343 rooms. Shafts are always
in rooms: 15, 18, 11, 14, 12 and 12 on maps 1-6, and none on map 7, the bottom. The only
way in is map 0's shaft at (7,7), above room (7,7) of map 1.

**Landmarks.** Without coordinates on screen, the levels are told apart by their walls:

| Map | What marks it |
| --- | --- |
| 1 | City names on the walls: CHICAGO (10,1), GARY INDIANA (1,2), DETROIT (11,2), BOSTON (2,3), PHOENIX ARIZONA (7,4), MADISON WISCONSIN (1,6), DENVER COLORADO (7,6), MIAMI FLORIDA (2,13), HOUSTON TEXAS (8,13), LOS ANGELES CALIFORNIA (12,13) |
| 2 | One crack, (4,3) east face. A scroll on (1,1): "DEAD / END" |
| 3 | Six water fountains |
| 4 | Six hooks |
| 5 | Six wall rings |
| 6 | Five sets of manacles, the generator's tiny switch, and the hint "THE SCREAMERS CAN HELP" ((10,9) west face, read from (9,9)) |
| 7 | 23 slimes on north faces, six grates, and the green button |
| all | Slime outlets on the inner faces of the outer walls, marking the edge of the cube |

These are type-0 actuators carrying a wall ornament. The levels' tables are
`[33, 35, 12, …]`: 33 slime, 35 fountain, 12 slime outlet, then 11 crack, 4 hook, 6 wall
ring, 14 tiny switch / 36 manacles, or 34 grate / 15 green button.

**Items.** The rooms hold things to find but nothing the puzzle needs. Map 1: leather
boots, elven boots, blue pants, ghi trousers, tattered pants, leather jerkin, cape, wooden
shield, robe, cheese, a boulder. Map 2: armet, blue pants, casque 'n coif, boots of speed,
DANE and SAR potions, a Gor coin, an orange gem, an arrow, a claw bow, an empty chest.
Map 3: dexhelm, halter, choker, Biter, bread, a blue gem, a **compass** at (11,1). Map 4:
bones, corn, corbum, illumulet. Map 5: rapier, wooden shield, dragon shield, rabbit's foot,
silver coin, dragon steak. Map 6: mirror of dawn, magical box, Ekkhard cross, KU potion,
dagger, a boulder. Map 7: a second **compass** at (9,9).

### The goal, and why it needs a monster

The **ruby key** is in a chest on map 7 at (13,13), behind a door (13,12) that nothing
opens. (13,13) is also an inactive teleporter that takes items to **map 5 (9,3)**. The
**green button** on map 7, (11,12) south face, clicked from (11,13), toggles that
teleporter. Turning it on carries the chest off to map 5.

Map 5 (9,3) is the top of a dead-end column: (9,3) to (9,9), with a side exit east at
(9,5) and a shaft at the bottom. From the entrance, with no monster about, **the party can
never come to rest on it, nor even pass over it**. The model checked every combination of
square and gravity memory reachable from the shaft on map 0 (272 resting squares in all),
and none ends on map 5 (9,3).

The help is the hint on map 6:

- **The generator.** The tiny switch at map 6 (11,4), south face, clicked from (11,5),
  sets the generator on (13,5) after 4 ticks. The generator's delay field is 12, so it
  makes one group of `STRandom(4)+1`, i.e. one to four Screamers (`Timer.cpp:1773-1779`).
  It then sleeps for `64 x (204 - 126)` = 4992 ticks before it can make another group
  (`Timer.cpp:1806-1818`).
- **The Screamers' range.** A Screamer takes a step every 120 ticks (its `MONSTERDESC`
  movement time). On map 6 it can only walk nine squares: (13,5), (12,5), (11,5), (11,6),
  (11,7), (10,7), (9,7), (9,8), (9,9). A group off the party's level still wanders, one
  random step at a time (`doc/MONSTER_BEHAVIOUR.md`).
- **The use.** With the group on **(9,8)** or **(9,9)**, map 5 (9,3) becomes reachable.
  With it on any of the other seven squares, it does not. The natural way: wait on (9,9),
  where the hint is read. A group that comes for the party must stand on (9,8), the only
  way in. Then a step north is refused by the monster, which re-aims gravity north at no
  cost, and `+` lifts the party into map 5 (9,9) and up the column to (9,3).

The way back from map 5 (9,3) to the hub works wherever the Screamers are. The ruby key
opens the door to gold key 1 on map 0.

## The 2D maze (map 8)

```
              1111111111222222222233
    01234567890123456789012345678901
  0 ################################
  1 #...#..#..#.........##..#..##..#
  2 #.#....#.#....##......#....###.#
  3 #.###......#...#.#.#....###....#
  4 ##.#..#.#.##.#...#..#.#....#...#
  5 #..#.#.#.....##.#........#...#.#
  6 #.##.....#.#..#..##...##...#..##
  7 #......##.....#..#..#...###....#
  8 ##.#.#....#.##.#...#........#..#
  9 #..###..#.....#....#.##....#####
 10 #..#.####..#..#..#..##..##.##..#
 11 #....#..####.###..#.#.##.......#
 12 ####...#...#....##....#..#...#.#
 13 ##......#..#.#.########..##.#..#
 14 #######.#.####........####..#.##
 15 #..#.......#..#####.#......##..#
 16 #......###...#.#....#..###...#.#
 17 ##...#.##..#...##.#.##....##...#
 18 #..#..#..##..##....#...#.##..#.#
 19 #.##.....#######.#...#.#...##..#
 20 #..##..#.#.......##..#..#.###..#
 21 #..#..#..#.#..###...##..#....#D#
 22 #....##.....#.#.#.....##..#..#T#
 23 ##.....####......#.#..##.##.####
 24 #..##.#..#...###.#..##....#....#
 25 ##..#......#.#.....##..##.#..#.#
 26 #.#...#.#.#..#..#...##..#..##..#
 27 #....#.#...######......#.#....##
 28 ##....#.##.#......#..#....#..###
 29 #..#..#.....#.##.#.##..##.#....#
 30 #..####..##...#...###..#..#..#.#
 31 ################################
```

- **In.** The party arrives on (29,20) facing north.
- **Out.** (30,20), then the door (30,21), whose button is on the door, then the
  teleporter (30,22) back to map 0 (3,2). "RETURN TO TRY ANOTHER DAY" is on (31,20) west
  face, read from (30,20).
- **The goal.** **Gold key 2** on (30,29), with "UNBELIEVEABLE. I THOUGHT THIS MAZE WOULD
  STOP YOU. TAKE A KEY. RETURN FOR YOUR REWARD."
- **Supplies.** A dagger, three arrows and a claw bow on (29,15), a mail aketon on (29,19),
  and a rapier with an empty flask in the door square (30,21). Twenty-three dragon steaks
  are scattered through the maze.
- **No shafts.** Map 7 has none and map 8 has none, so the vertical axis never moves. This
  is plain two-axis gravity.

The goal sits nine rows below the entrance, but the shortest solution is **189 key
presses, 22 of them deliberate bumps**. No route needs fewer bumps, and the gravity memory
on arrival changes the count by at most one press. The way back to the exit is 25 presses
and 3 bumps. This is the machine-made maze Paul chose for being the hardest.

## The 1D corridor (map 9)

```
              1111111111222222222233
    01234567890123456789012345678901
  0 ################################
  1 ##T#T#T#T#T#T#T#T#T#T#T#T#T#T###    templates: visible
  2 ##T#T#T#T#T#T#T#T#T#T#T#T#T#T###    templates: invisible
  3 ################################    levers on the south faces of the odd columns
  4 #.TtTtT.TtTtTtTtT.TtTtT.TtTtTt##    the corridor
  5 ..###########################..#    controllers (odd x), copy machines (even x)
  6 D#T#T#T#T#T#T#T#T#T#T#T#T#T#T#.#    templates: invisible
  7 T#T#T#T#T#T#T#T#T#T#T#T#T#T#T###    templates: visible
```

The party arrives on (1,5) facing north. "RETURN TO START" is on (1,6), read facing south.
The way home is west to (0,5), through the door (0,6) by its button, and onto the
teleporter (0,7), which leads to map 0 (3,2). The goal is beyond the far end: (29,4) to
(29,5), (30,5) ("WOW. YOU DID IT. CONGRATULATIONS. THE REWARD IS NEAR.") and **gold key
3** on (30,6).

**The corridor.** Row 4 from x = 1 to 29.

- **Odd columns** are where the party stands. Each has a type-9 pad: party only, fires
  when the party arrives (`Code11f52.cpp:3840-3844`). The pad sends SET at corner 0 to
  that column's controller, at (x,5), or at (1,6) and (29,6) for the two ends. The odd
  squares are inactive item teleporters, except 1, 7, 17 and 23, which are plain floor.
- **Even columns** are teleporters, at first harmless: items only, sent to themselves.

**The controller** ("1-D Controller", DSA selector 4) keeps one state bit per column. On
SET at corner 0 it copies two templates over the even squares on either side:

| State | West neighbour (x-1,4) gets | East neighbour (x+1,4) gets |
| --- | --- | --- |
| 0 | the template on row 2 (invisible) | the template on row 6 (invisible) |
| 1 | the template on row 1 (visible) | the template on row 7 (visible) |

The copying is done by four one-line DSAs on each even (x,5): SET at corner 0/1/2/3
copies the teleporter from row 1/6/7/2 to (x,4). `EX_COPYTELEPORTER` copies the record and
the flag byte (`DSA.cpp:729`). Every DSA on a wall hears every message sent to that wall,
whatever its corner (`ProcessTT_STONEROOM`, `Timer.cpp:2222`). Every template is an active teleporter that takes
everything, so **every step off an odd square is a teleport**, to the odd square the
template names.

**The levers.** Each odd column has a lever on (x,3), facing the corridor, clicked from
(x,4) facing north. A click sends TOGGLE to the controller. The controller flips its state
and recopies at once (its `T0` column). The click also performs local action 2 on the
second actuator of the face, which rotates the two actuators (`RotateActuatorList`,
`Code11f52.cpp:3500`). The drawn ornament is the last actuator's (`Codea59a.cpp:134-153`),
so the lever shows the state: **down = 0** (as all start), **up = 1**. With the lever up,
both neighbours shimmer blue. With it down, they look like plain floor. "THERE ARE ONLY
FIFTEEN SWITCHES" ((0,4) east face, read from (1,4)) counts them.

**Where each step leads:**

| From | Lever down, West | Lever down, East | Lever up, West | Lever up, East |
| --- | --- | --- | --- | --- |
| 1 | wall | 7 | wall | 9 |
| 3 | 1 | 5 | 15 | 11 |
| 5 | 3 | 7 | 13 | 13 |
| 7 | 7 | 7 | 7 | 15 |
| 9 | 13 | 11 | 1 | 17 |
| 11 | 9 | 25 | 3 | 19 |
| 13 | 7 | 15 | 5 | 15 |
| 15 | 13 | 7 | 7 | 8 (see below) |
| 17 | 7 | 15 | 9 | 13 |
| 19 | 1 | 21 | 11 | 27 |
| 21 | 19 | 23 | 13 | 29 |
| 23 | 21 | 1 | 9 | 7 |
| 25 | 17 | 27 | 5 | 15 |
| 27 | 25 | 3 | 19 | 17 |
| 29 | 15 | wall | 21 | wall |

The one oddity is the template on (16,7), whose destination is the even square **8**. What
happens there depends on what 8 holds:

- If nothing was ever copied there (the party has not stood on 7 or 9 yet), it holds its
  first, items-only teleporter, and the party stays on 8.
- Otherwise the party teleports again, to 7, 15, 13 or 1, depending on whether 7's or 9's
  copy came last and on that lever.

**The pulses.** Each controller square also holds "S0 Causes pulse at A and B" (DSA
selector 5). Every arrival turns two odd item teleporters on for one tick, which moves
any item lying on them elsewhere in the corridor. Floor squares are not teleporters, so
the items on 1, 7, 17 and 23 stay put. "SAFE STORAGE AREA" (south of 7, 17 and 23) says
so. The pulses never move the party.

**Why it is hard.** Once the corridor is known, the shortest way through is five
teleports: 1 (lever up) east to 9, 9 (down) east to 11, 11 (up) east to 19, 19 (down) east
to 21, 21 (up) east to 29. But nothing in the corridor shows where the party is: every
square looks alike, half the teleporters are invisible, and items dropped as markers get
carried off by the pulses unless they lie on a safe square. Mapping fifteen squares, two
lever states and two directions blind is the three hours Paul spent.

## The DSA programs

The dungeon's six DSAs are all used on map 9, through the level's DSA index
`[1, 2, 3, 4, 0, 5]` (actuator selector to DSA). They use four commands only: MESSAGE,
OVERRIDE, COPYTELEPORTER and GOSUB (bit layouts in `doc/CSBwin-src/Data.h:1904-2140`). The
state lives in each actuator (`LocalState` 0). Columns are `3 x corner + {set 0, clear 1,
toggle 2}` (`ProcessDSATimer6`, `DSA.cpp:5416`), and a GOSUB's sub-state never becomes the
caller's state (`Execute`, `DSA.cpp:5054`).

| DSA | Selector | Description | Program |
| --- | --- | --- | --- |
| 0 | 4 | 1-D Controller | state 0: S0 `00c5` GOSUB 3; T0 `2105` GOSUB 4, go to state 1. State 1: S0 `0105` GOSUB 4; T0 `e0c5` GOSUB 3, go to state 0. Subroutine 3: `0242 0441 0642 0041` = SET B at corner 1, SET A at corner 3. Subroutine 4: `0042 0041 0442 0441` = SET A at corner 0, SET B at corner 2 |
| 1-4 | 0-3 | S0/S1/S2/S3 Copies Teleporter A to B immediately | `0104` = COPYTELEPORTER A to B, in column 0, 3, 6 or 9 |
| 5 | 5 | S0 Causes pulse at A and B | `0041 0441 0381 0001 0781 0001` = SET A, SET B, CLEAR A after 1, CLEAR B after 1 |

A and B are the actuator's parameters: `word4`/`word6` as `level<<10 | x<<5 | y`
(`DB3::ParameterA/B`, `data.cpp:1338-1346`). For DSA actuators, `peek-dungeon`'s "once",
"audible" and "target" readings of those words mean nothing.

The dungeon has no special locations, so there is no party-move filter and no spell
filter. Moves are plain `MoveParty`.

## How this was worked out

- **The data.** `npx tsx tools/peek-dungeon.ts --file tools/fixtures/gamefiles/3D2D1D/dungeon.dat
  --graphics tools/fixtures/gamefiles/3D2D1D/graphics.dat levels | map <m> | dump <m> | cell …`
- **The motion.** `tools/solve-3d2d1d.ts` (`solve`, `replay`, `table`, `reach`) re-implements `MoveParty`'s
  history update, its sideways, vertical and bump arms, `GravityMove`, teleporters with
  their scope and rotation, the type-9 pads, wall clicks, and the four DSA commands above.
  A shortest-path search over (square, gravity memory) produced every reachability claim
  here and every route in the walkthrough. Its 1D table matches a hand decoding of the
  131 actuators.
- **What the model does not cover.** The Screamers' AI is not simulated. A search places
  the group on one square and keeps it there. Timing is reduced to ordering. Stamina,
  food and the party's move delay are left out, since none of them changes where a move
  ends.
- **Which CSBWin.** The rules are those of CSBWin 20230608's source. The dungeon ships
  with a 2019 exe whose disassembly was checked only for the two flags (`doc/3D2D1D.md`).
- **One claim is not checked.** Paul's page says the dungeon shows off CSBuild's "Encrypt"
  feature. Whatever that protects, it is invisible here: the port's loader reads the file
  like any other.
