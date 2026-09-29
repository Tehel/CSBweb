---
name: peek-dungeon
description: Look at what the dungeon data holds, without running the game — a level drawn in ASCII, one square with its flag byte and every object on it, or where an item, monster or text is. Use for questions like "what is on (18,1) of map 11?", "where is the Firestaff?", "which levels have Oitus?", or before reasoning about a behaviour tied to a place (a monster vanishing, a door that won't open). Reads dungeon.dat, a CSBWin save or a .dmweb.json.
---

# Peeking into the dungeon

`tools/peek-dungeon.ts` answers "what is there?" from the data files alone: no dev server,
no browser, about a second per call. Use it rather than writing a throwaway script. If it
can't show what you need, extend it.

```bash
npx tsx tools/peek-dungeon.ts levels                  # one line per map
npx tsx tools/peek-dungeon.ts map 11                  # ASCII map + teleporters, stairs, pits, monsters, items
npx tsx tools/peek-dungeon.ts cell 11 18 1            # neighbourhood, flag byte decoded, the object chain
npx tsx tools/peek-dungeon.ts cell 11 18 1 6          # …with a radius-6 neighbourhood
npx tsx tools/peek-dungeon.ts find "dragon"           # items, monsters (and what they carry), texts
npx tsx tools/peek-dungeon.ts --file static/gamefiles/saves/csbgame7.dat cell 6 26 23
```

## Coordinates

`map` is the map index (`party.state.position.z`), `x` the column and `y` the row, with
north up and `y` growing south, which is how CSBWin and `Position` count. The level
numbers the author uses while playing are usually 1-based (map 11 = level 12), so check
before answering.

## Sources

- **`dungeon.dat`** (the default is `static/gamefiles/dm-atari/`): the world as a new game
  starts it. It has no timers, and monsters sit where the designer put them.
- **A CSBWin save** (`static/gamefiles/saves/*.dat`): the world as it was saved. It shows
  the party (`@`), the monsters where they really are, and, in `cell`, the square's live
  timers.
- **A `.dmweb.json`**: the port's own save. Its world is read from its `raw` CSBWin file.
  The author's saves are untracked but readable. Pass `--graphics` with the matching
  `graphics.dat` for another game (e.g. `static/gamefiles/csb/`).

## Reading the output honestly

- The flag byte is decoded per room type from `CSBTypes.h:177-209`, so that decoding is
  settled.
- An actuator line gives `type` and `value`, then the fields "if read as a target". Many
  actuator types reuse `word4`/`word6` for other things, so the target is only a reading.
  Check the type against `doc/ACTUATORS.md` before trusting it. The raw words are printed
  too.
- When the type compares its `value` with an object, the line names that object in
  brackets after the value: the key a lock wants, the coin or gem a slot takes, the
  mirror an eye wants, what a torch holder holds, what the party must carry over a pad.
  This depends on the square: the same type means one thing on a floor and another in
  a wall. It is read from `PressurePadOrAlcove` and `TouchWall`, so it can be trusted.
  A wall line cannot tell whether the wall is an alcove, so it gives both readings. A
  "normally closed" flag on the line inverts it: the actuator then fires when the
  object does not match.
  `find GOLD KEY` lists every lock the key opens as well as the keys.
- `cell` lists the timers whose `uByte6`/`uByte7` are the square. Door, actuator,
  monster and abeyance (`TT_60`/`TT_61`) timers use that convention. A missile's position
  is in `timerWord8`, so missile timers do not match here.
- Item names come from `NameIndex` over `graphics.dat` and monster names from
  `MonsterType`. `groupIndex` is an `ITEM16` slot only while the group is on the party's
  level (see `CreatureRecord`).

This is **not evidence**. It shows what the data holds. It does not show what the engine
does with it. Once the data explains a behaviour, prove the behaviour in a
`tools/dump-*.ts`, as usual.
