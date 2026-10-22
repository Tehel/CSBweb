# 3D2D1D: a complete walkthrough

**Spoilers: this is the whole solution.** How the puzzles work is in
[`3D2D1D_ANALYSIS.md`](3D2D1D_ANALYSIS.md). Read that first if you want to understand them rather than
just get through.

This route was computed with a model of CSBWin's movement, built from its source (see
`3D2D1D_ANALYSIS.md`), not by playing. It needs vertical moves and gravity, which the port and
the 2019 `CSBwin.exe` the dungeon ships with both play. `tools/watch-3d2d1d-gravity.ts`
plays its first two legs through the port's engine. `npx tsx tools/solve-3d2d1d.ts solve` recomputes the key blocks, and
`npx tsx tools/solve-3d2d1d.ts replay` checks this file against the model.

## How to read it

- **Directions are compass directions**: N, E, S, W, plus `Dn` (the `-` key) and `Up`
  (the `+` key). Gravity does not care which way the party faces, and turning does not
  start it. The easy way: **face north and stay facing north.** Then N is forward, S is
  back, W is sidestep left and E is sidestep right. Turn only to click something, then turn
  back to north.
- **`E→0:8,0`** means: press E once. The party slides, then comes to rest on map 0 at
  (8,0). Every press is one step followed by a slide. Wait for the slide to stop before the
  next press: keys pressed during a slide are thrown away.
- **`!`** after a direction (`S!`, `Up!`) marks a refused press: a wall, or no shaft for
  `Dn`/`Up`. The party does not move, but its gravity is re-aimed. These bumps are part of
  the route, and each costs up to 1 HP.
- **Click** means: empty hand, facing the wall named, click the switch, lever or keyhole.
- **Follow the legs in order, without reloading in between.** Each route depends on the
  directions the party last moved in, and the previous leg leaves those exactly as the
  next one needs. A saved game may not restore them (`3D2D1D_ANALYSIS.md`, "Gravity", point 6).
  Save if you like, but after a reload the route from there may no longer work.
- After a switch that opens a door, a false wall or a teleporter, **wait** for it to
  finish before pressing anything.

## 1. The champion

```
  1  E→0:8,0     W→0:7,0     S→0:3,2     E→0:5,3     N→0:9,2
```

At (9,2), face east and click the mirror. Resurrect (or reincarnate) **AIRWING**, then
face north again.

## 2. Open the 3D maze

```
  1  W→0:7,0     E→0:8,0     S!→0:8,0    W→0:7,3
```

At (7,3), face west and click the small switch. The false wall south of you, (7,4), opens
after a moment.

## 3. The 3D maze: the ruby key

**3a. To the green button on map 7.**

```
  1  S→0:7,7     Dn→2:7,11   N→3:7,7     Up→2:7,7    E→2:9,7     Dn→4:9,5    Up→3:9,5    W→2:7,5
  9  E→1:9,3     S→1:11,7    W→1:9,7     N→1:5,5     Dn→4:5,5    E→4:7,5     S→5:7,7     N→5:7,5
 17  W→6:5,5     S→6:5,7     E→7:7,7     W→7:1,13    E→7:5,13    N→7:7,7     W→7:5,7     S→7:3,9
 25  Up!→7:3,9   N→6:3,3     E→5:5,3     W→5:3,3     S→5:3,7     E→4:5,7     W→3:3,11    E→2:5,11
 33  N→2:5,9     W→1:1,3     S→1:1,5     E→1:9,11    N→1:9,9     Dn→2:11,9   S→5:13,13   W→6:9,13
 41  N→7:7,9     S→7:7,13    E→7:11,13
```

At map 7 (11,13), face north and click the green button **once**. The chest with the ruby
key, out of reach on (13,13), is teleported to map 5 (9,3).

**3b. To the generator switch on map 6.**

```
  1  W→7:7,13    N→7:7,9     Up→6:7,9    S→6:7,11    E→4:13,13   N→3:13,11   Dn→4:13,11  W→4:11,11
  9  Up→1:9,9    S→1:5,11    N→1:1,3     S→1:1,5     Dn!→1:1,5   E→3:5,11    W→3:3,11    N→4:3,7
 17  E→5:5,7     W→5:3,3     E→6:5,3     W→6:3,3     S→7:3,9     E→7:5,13    N→7:7,7     Up→6:7,7
 25  W→5:5,5     E→5:7,5     S→4:7,7     N→4:7,5     W→1:5,5     E→1:9,3     Dn→2:9,3    S→2:13,5
 33  W→3:7,5     E→6:9,9     N→6:13,5    W→6:11,5
```

At map 6 (11,5), face north and click the tiny switch **once**. Then, **without waiting**:

```
  1  S→6:9,9
```

**3c. Wait for the Screamers.** On map 6 (9,9), face north. The hint "THE SCREAMERS CAN
HELP" is on your right, on the east wall. One to four Screamers appear at the far end of the
corridor and drift slowly towards you. **Wait until they stand on
the square in front of you, (9,8).** Don't kill them. They hit weakly, and you can heal or
eat while you wait.

**3d. Up to the chest.** With the Screamers on (9,8):

```
  1  N→6:9,9     Up→5:9,3
```

The first N is refused by the Screamers: you do not move, but gravity now points north.
`Up` lifts you into map 5 and the slide carries you up the column to (9,3). Pick up the
chest, open it and take the **ruby key**.

**3e. Back to the start.** The Screamers no longer matter:

```
  1  S→4:9,7     N→2:7,5     Dn→3:7,5    E→4:9,5     Up→3:9,5    S→2:9,7     W→1:7,9     N→0:7,5
  9  N→0:3,2
```

At map 0 (3,2), face west and use the ruby key on the ruby keyhole. The door at (5,4)
opens.

**3f. Gold key 1.**

```
  1  E→0:8,0     W→0:7,0     S→0:3,2     E→0:5,3     S→0:5,5
```

The **first gold key** lies on (5,5), with Paul's note about his balsa-wood puzzle.

## 4. The 2D maze: gold key 2

```
  1  N→0:9,2     S→0:10,4    E→0:11,4
```

At (11,4), face east and click the small switch. A moment later you are teleported to map 8
(29,20), facing north.

**The maze**, 189 presses with 22 bumps. There is no shorter route. Take it slowly and
check each resting square:

```
  1  N→8:30,15   W→8:29,13   E→8:30,10   W→8:29,10   S→8:23,13   N→8:23,12   E→8:30,1    S→8:30,5
  9  W!→8:30,5   N→8:27,3    S!→8:27,3   E→8:30,8    W→8:29,8    N→8:27,7    S→8:20,9    N→8:20,8
 17  E→8:21,2    W→8:11,1    S→8:1,7     E→8:10,17   W→8:9,17    N!→8:9,17   E→8:10,15   W→8:8,12
 25  E→8:10,12   S→8:10,13   W→8:6,17    N→8:1,15    S→8:1,16    E→8:2,18    W→8:1,22    E→8:5,29
 33  W→8:4,29    N→8:1,26    S→8:1,27    E→8:2,30    W→8:1,30    N→8:1,29    E→8:3,25    S→8:5,26
 41  N→8:16,23   S→8:25,30   N→8:25,28   W→8:24,27   S→8:21,30   N→8:21,29   E→8:26,19   W→8:8,1
 49  E→8:9,1     S!→8:9,1    W→8:7,4     N→8:1,1     E→8:3,1     S→8:10,3    W→8:6,9     E→8:7,9
 57  N→8:13,6    S→8:13,7    W→8:9,10    E→8:10,10   N→8:13,9    S→8:13,10   W→8:12,13   E!→8:12,13
 65  N→8:15,12   S!→8:15,12  W→8:14,14   E→8:19,17   W!→8:19,17  N→8:16,16   S!→8:16,16  E→8:21,23
 73  W→8:20,23   N→8:17,21   S→8:17,22   E→8:20,28   W→8:19,28   N→8:14,25   S→8:14,26   E→8:15,26
 81  N→8:19,24   S!→8:19,24  W→8:15,30   E→8:17,30   N!→8:17,30  W→8:12,28   S!→8:12,28  E→8:13,30
 89  W→8:11,30   N→8:7,28    S→8:7,30    E→8:8,30    N→8:11,29   W→8:7,24    E→8:8,24    S→8:10,25
 97  W→8:8,27    N!→8:8,27   E→8:11,22   W→8:10,20   S→8:7,22    N→8:7,21    E→8:8,18    W→8:7,18
105  S→8:4,19    E→8:5,21    W→8:2,25    N→8:1,24    E→8:2,20    S→8:6,23    N!→8:6,23   W→8:4,21
113  E→8:5,18    W→8:4,15    E→8:7,13    W→8:6,11    S→8:2,13    N!→8:2,13   E→8:4,10    W!→8:4,10
121  S→8:1,11    N→8:1,9     E→8:6,1     W→8:5,1     S→8:3,2     E→8:5,4     W→8:4,8     E!→8:4,8
129  N→8:14,3    S→8:16,4    W→8:15,7    E→8:17,11   W→8:16,11   N→8:15,9    E→8:16,6    S→8:21,12
137  W→8:18,12   N!→8:18,12  E→8:19,10   W→8:18,7    E→8:19,4    S→8:26,6    W→8:24,6    N→8:17,5
145  S!→8:17,5   E→8:19,7    N→8:26,4    W→8:22,1    E→8:23,1    S→8:26,2    N→8:26,1    W→8:25,1
153  S→8:20,3    E→8:23,10   W→8:22,10   N!→8:22,10  E→8:23,7    S→8:27,8    W→8:26,12   E→8:27,14
161  W→8:26,16   E→8:28,18   W→8:27,18   N!→8:27,18  E→8:28,16   W→8:26,14   S→8:21,16   E→8:23,21
169  W→8:22,21   N→8:20,18   S→8:18,19   N→8:15,18   S!→8:15,18  E→8:16,20   N→8:18,18   S→8:20,20
177  N→8:25,17   S!→8:25,17  W→8:24,19   E→8:25,22   N→8:28,21   S→8:28,22   W→8:27,25   E→8:28,25
185  N→8:30,24   S→8:30,26   W→8:27,30   E→8:28,30   N→8:30,29
```

The **second gold key** lies on (30,29). Then back to the exit:

```
  1  W→8:24,22   E→8:26,19   W→8:8,1     E→8:9,1     S!→8:9,1    W→8:7,4     N→8:1,1     E→8:3,1
  9  S→8:10,3    W→8:6,9     E→8:7,9     N→8:13,6    S→8:13,7    W→8:9,10    E→8:10,10   N→8:13,9
 17  S→8:13,10   W→8:12,13   E!→8:12,13  N→8:15,12   S!→8:15,12  W→8:14,14   E→8:19,17   N→8:21,14
 25  S→8:30,20
```

At (30,20), face south and click the door's button. When the door is open, press **S**
(into the doorway) and **S** again (onto the teleporter). You arrive on map 0 (3,2) and
slide on to **(10,4)**. Do not press E there: (11,4) is still a live teleporter into the
2D maze.

## 5. The 1D corridor: gold key 3

```
  1  W→0:9,6     E→0:10,7    N→0:15,6    N→0:15,5
```

At (15,5), face north and click the small switch. A moment later you are on map 9 (1,5),
facing north. In the corridor, "lever" means: face north, click the lever on the wall in
front of you, face north again (you already do). All levers start down. One click puts a
lever up.

```
  N                 → (1,4)          the corridor's west end
  lever             up
  E                 → teleported to 9
  E                 → teleported to 11
  lever             up
  E                 → teleported to 19
  E                 → teleported to 21
  lever             up
  E                 → teleported to 29
  S                 → slides (29,5), (30,5), (30,6)
```

The **third gold key** lies on (30,6). Then home:

```
  N                 → (30,5)
  W                 → (29,5)
  N                 → (29,4)
  lever             up (29's lever)
  W                 → teleported to 21
  lever             down (21's lever, which you put up on the way in)
  W                 → teleported to 19
  W                 → teleported to 1
  S                 → slides (1,5), (0,5)
```

At (0,5), face south and click the door's button. When it is open, press **S** (into the
doorway) and **S** (onto the teleporter): you are back on map 0 (3,2).

## 6. The three gold locks

```
  1  E→0:5,3     N→0:9,2     S→0:10,4    W→0:9,6     E→0:10,7    N→0:15,6    S!→0:15,6   W→0:12,7
```

At (12,7), face west and put a gold key in the gold keyhole. The door south of you opens.
At (15,6) the route bumps south on purpose. Never press N there: (15,5) is now a live
teleporter into the 1D corridor.

```
  1  S→0:12,9
```

At (12,9), face south and put the second gold key in the keyhole. The door east of you
opens.

```
  1  E→0:14,9
```

At (14,9), face south and put in the last gold key. The door east of you opens.

```
  1  E→0:17,9
```

On (17,9), read the end.
