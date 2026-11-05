---
name: levels-count-from-0
description: Levels are numbered from 0 everywhere the player sees them; "map" and "level" are synonyms; the Hall of Champions is level 0
metadata:
  type: user
---

The author's convention, settled 2026-11-05 after a long confusion: in DM the Hall of Champions is **level 0**, and every number the player sees counts from 0, as the map's descriptor does (`descriptor.level`): the save menu's LEVEL, the map dialog's title (`mapTitle`), the map info's `L<n> (x,y)` links (`CellInfo.levelName`), the statistics page's deaths per level, a recording's "From a saved game, level N" and FROM/TO labels. "Map" and "level" mean the same thing in this context.

**Why:** a `+ 1` for display crept into some screens and not others, and the two numberings kept being confused in reports and code reviews.

**How to apply:** never add 1 to a level for display; a new screen, label, doc or check that names a level uses the descriptor's number. A doc sentence saying "LEVEL 1, the first" is a bug.
