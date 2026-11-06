---
name: champion-slots-past-the-party
description: CSBWin reads d.CH16482[0..3] whatever d.NumCharacter is; the port's party.champions stops at the count, and only some readers go through vacantCharacters
metadata:
  type: project
---

CSBWin reads `d.CH16482[i].HP()` and other fields of all four slots in many places without checking `d.NumCharacter` (about 18 `CH16482[...].HP()` reads, `grep -n 'CH16482\[.*\]\.HP()' doc/CSBwin-src/*.cpp`). A slot past the party holds zeros, or the record of a champion who left it, and a candidate turned away by the Hall of Champions' Cancel keeps their HP (`CSBCode.cpp:6699`; `doc/PROVEN_FACTS.md` → "A `CHARDESC` slot past the party…"). The port keeps those records in `PartyState.vacantCharacters` (`vacantHealth`, `vacantPossession` in `src/data/CsbwinCharacters.ts`), but a reader written over `party.champions` / `getPartyChampion` sees nothing there.

**Why:** Conflux's line-51958 drift (`DEBT.md` F24) was the random-target loop of `MonsterAttacks` striking a cancelled candidate in CSBWin and champion 0 in the port. The other readers are not audited.

**How to apply:** when a drift involves a champion index or a "live champion" search and the party has fewer than four, compare CSBWin's loop bound with the port's and check whether the port reads `vacantCharacters`.
