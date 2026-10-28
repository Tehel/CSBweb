/**
 * The party's footprint trail — how monsters smell you.
 *
 * Ports CSBWin's `d.PartyFootprints[24]` / `d.Byte13220[24]` pair
 * (`doc/CSBwin-src/Data.h:796`) and the three functions that maintain them:
 * `AddFootprintEntry` (`doc/CSBwin-src/Code11f52.cpp:4381`), `DeleteFootprintEntry`
 * (`:4357`), and `SearchFootprints` (`doc/CSBwin-src/CSBCode.cpp:7125`). The trail is
 * appended to on every party move (`Code11f52.cpp:3260-3282`).
 *
 * Two consumers: `GetBestMonsterFacingP1` sniffs it to decide which way to turn when
 * it cannot see the party (`doc/CSBwin-src/Monster.cpp:617-627`), and the Magic
 * Footprints spell draws the tail of it.
 *
 * `PartyFootprints[i]` packs a location as `[level:6][y:5][x:5]`. `Byte13220[i]` is
 * the parallel "age" byte, and the smaller it is the fresher the print — a monster
 * compares `Random(0..3) + age` against `30 - 2 * smellingDistance`.
 *
 * About `AddFootprintEntry`: Paul Stevens' own comment on it reads "I think this is
 * much hogwash. Does nothing useful. Is full of errors. Perhaps an old, abandoned
 * debug trace" (`doc/CSBwin-src/Code11f52.cpp:4382-4384`). The Atari's program throws
 * its comparison with the square away, and the ten-second decay's too, so every strength
 * changes; that is the Atari's, and ported. Its two loops are not CSBWin's: they write
 * strength 0, and the decay goes on after a drop (`doc/ATARI_ST_DISK_REFERENCE.md` →
 * "The scents in the program"; `DEBT.md` H).
 *
 * With the Amiga's tables, the trail is A22E's (`doc/AMIGA_DISK_REFERENCE.md` → "A22E's own
 * code, classed"): `F0317_CHAMPION_AddScentStrength` changes only the strengths of the
 * prints on the square it is given, and the ten-second decay spares the print on the
 * party's square. Its loops are the Atari's.
 */

import type { Position } from '../core/types';

/** `d.PartyFootprints` and `d.Byte13220` are both 24 entries (`Data.h:796`). */
const MAX_FOOTPRINT_ENTRIES = 24;

export class PartyFootprints {
  /**
   * @param byLocation the Amiga's trail, whose comparisons count: a game with the Amiga's
   *   tables (`GameTables.amigaSounds`).
   */
  constructor(private readonly byLocation = false) {}

  /** `d.PartyFootprints[24]` — packed `[level:6][y:5][x:5]`. */
  private prints: number[] = [];

  /** `d.Byte13220[24]` — the parallel age bytes. */
  private ages: number[] = [];

  /** `d.NumFootprintEnt`. */
  private count = 0;

  /** `d.LastPartyMoveTime`. */
  private lastPartyMoveTime = 0;

  /** `d.IndexOfFirstMagicFootprint` / `d.IndexOfLastMagicFootprint`. */
  private indexOfFirstMagic = 0;
  private indexOfLastMagic = 0;

  getCount(): number {
    return this.count;
  }

  getPrint(index: number): number {
    return this.prints[index] ?? 0;
  }

  getAge(index: number): number {
    return this.ages[index] ?? 0;
  }

  getIndexOfFirstMagicFootprint(): number {
    return this.indexOfFirstMagic;
  }

  getIndexOfLastMagicFootprint(): number {
    return this.indexOfLastMagic;
  }

  /** The map X of a packed entry — `BITS0_4` (`doc/CSBwin-src/Monster.cpp:624`). */
  static printX(packed: number): number {
    return packed & 0x1f;
  }

  /** The map Y of a packed entry — `BITS5_9` (`doc/CSBwin-src/Monster.cpp:625`). */
  static printY(packed: number): number {
    return (packed >> 5) & 0x1f;
  }

  static printLevel(packed: number): number {
    return (packed >> 10) & 0x3f;
  }

  /**
   * `SearchFootprints` (`doc/CSBwin-src/CSBCode.cpp:7125`) — the **newest** entry at
   * this square, searched from the end backwards, returned as a 1-based index (0 =
   * no print here).
   *
   * Note CSBWin does not mask `mapY` here even though it masks `mapX`; a `mapY` of
   * 32 or more would therefore corrupt the level field. Preserved, since map heights
   * never reach 32.
   */
  searchFootprints(level: number, mapX: number, mapY: number): number {
    const searchValue = (((level & 0x3f) << 10) | (mapY << 5) | (mapX & 0x1f)) & 0xffff;
    for (let index = this.count - 1; index >= 0; index--) {
      if (this.prints[index] === searchValue) return index + 1;
    }
    return 0;
  }

  /**
   * Record a party move, mirroring `MoveObject`'s footprint block
   * (`doc/CSBwin-src/Code11f52.cpp:3260-3282`).
   *
   * The order is load-bearing: the trail is first trimmed to 23 entries or fewer,
   * then the *departed* square's age is written by `addFootprintEntry` (unless the trail
   * is empty), then the count grows, then the *new* square is stored, and finally
   * `addFootprintEntry` is called again with the sentinel `0x8018`.
   *
   * `oldX`, `oldY` is the square left, -1 for a party placed from nowhere, which only the
   * Amiga's trail reads. Both its calls compare on `level`, the map the party arrives on,
   * which is A22E's current map then (ReDMCSB `MOVESENS.C:574`, `:643`, `:772`).
   */
  recordPartyMove(
    time: number,
    level: number,
    newX: number,
    newY: number,
    magicFootprintsActive: boolean,
    oldX = -1,
    oldY = -1,
  ): void {
    // CSBWin's `for (D6W=d.NumFootprintEnt; D6W>=24; D6W--) DeleteFootprintEntry(0);`
    // leaves D6W as the index the new print goes into.
    let index = this.count;
    while (index >= MAX_FOOTPRINT_ENTRIES) {
      this.deleteFootprintEntry(0);
      index--;
    }
    if (index !== 0) {
      this.addFootprintEntry(oldX, oldY, level, (time - this.lastPartyMoveTime) & 0xffff);
    }
    this.lastPartyMoveTime = time;
    this.count++;
    if (magicFootprintsActive) this.indexOfLastMagic = this.count;

    this.prints[index] = packLocation(level, newX, newY);
    this.ages[index] = 0;
    this.addFootprintEntry(newX, newY, level, 0x8018);
  }

  /**
   * `DeleteFootprintEntry` (`doc/CSBwin-src/Code11f52.cpp:4357`): the entries above `at`
   * move down one, prints and ages alike. CSBWin's `MemMove` takes its source first
   * (`MemMove(src, dest, byteCount)`, `doc/CSBwin-src/CSBCode.cpp:834`), so
   * `MemMove(&d.PartyFootprints[P1+1], &d.PartyFootprints[P1], …)` copies `[P1+1]` onto `[P1]`.
   */
  private deleteFootprintEntry(at: number): void {
    this.count--;
    const n = this.count - at;
    if (n > 0) {
      for (let i = 0; i < n; i++) {
        this.prints[at + i] = this.prints[at + 1 + i] ?? 0;
        this.ages[at + i] = this.ages[at + 1 + i] ?? 0;
      }
    }
    if (at < this.indexOfFirstMagic) this.indexOfFirstMagic--;
    if (at < this.indexOfLastMagic) this.indexOfLastMagic--;
  }

  /**
   * `AddFootprintEntry` (`doc/CSBwin-src/Code11f52.cpp:4381`), ReDMCSB's
   * `F0317_CHAMPION_AddScentStrength(mapX, mapY, cycleCount)` (`CHAMPION.C:1472-1525`).
   *
   * Bit 15 of `cycleCount` selects how the first strength it changes combines with what
   * is already there: set means `max(existing, cycles)`, clear means
   * `min(80, cycles + existing)`. Every later one it changes is overwritten with the
   * result. Its pointer walks the prints up from the oldest while its index walks the
   * strengths down from the newest, so it compares print `k` and writes strength `N-1-k`,
   * strength 0 included: the index is tested before it is decremented, in the Atari's
   * program (`START.PAK` 1.2 at `$168e4`) and in the Amiga's (`dm`'s hunk 17 at 0x3066),
   * where CSBWin's `while (index-- != 1)` stops before 0. The Atari's throws the
   * comparison away, so the whole trail ends up holding one value; the Amiga's changes a
   * strength only where the print is the square's, on the current map.
   */
  private addFootprintEntry(mapX: number, mapY: number, level: number, cycleCount: number): void {
    let index = this.count;
    if (index === 0) return;
    const merge = (cycleCount & 0x8000) !== 0;
    let cycles = cycleCount & 0x7fff;
    const location = packLocation(level, mapX, mapY);
    let cycleCountDefined = false;
    for (let k = 0; index-- !== 0; k++) {
      if (this.byLocation && this.prints[k] !== location) continue;
      if (!cycleCountDefined) {
        cycleCountDefined = true;
        const strength = this.ages[index] ?? 0;
        cycles = merge ? Math.max(strength, cycles) : Math.min(80, strength + cycles);
      }
      this.ages[index] = cycles & 0xff;
    }
  }

  /** `d.LastPartyMoveTime` — `TenSecondUpdate` reads it to eat more when idle. */
  getLastPartyMoveTime(): number {
    return this.lastPartyMoveTime;
  }

  /**
   * The footprint half of `TenSecondUpdate` (`doc/CSBwin-src/Code17818.cpp:181-195`,
   * ReDMCSB `CHAMPION.C:2311-2330`): every strength but the newest ticks one step toward
   * zero, and the moment the *oldest* one reaches zero it is dropped, and the walk goes
   * on with the new oldest at the same index (`START.PAK` 1.2 at `$17642`; `dm`'s hunk 17
   * at 0x3c60), where CSBWin's `break`s. The Atari's compares each print with the party's
   * square and throws the result away (CSBWin's `SearchWordNE`, commented out); the
   * Amiga's spares the print on the party's square, `party`.
   */
  ageFootprints(party: Position): void {
    const location = packLocation(party.z, party.x, party.y);
    let i = 0;
    while (i < this.count - 1) {
      if (!this.byLocation || this.prints[i] !== location) {
        const strength = Math.max(0, (this.ages[i] ?? 0) - 1);
        this.ages[i] = strength;
        if (strength === 0 && i === 0) {
          this.deleteFootprintEntry(0);
          continue;
        }
      }
      i++;
    }
  }

  /**
   * YA BRO ROS's mark (`doc/CSBwin-src/Magic.cpp:1335-1344`): the magic range starts at
   * the trail's end, and a weak spell closes it there too. A spell of power 3 or more
   * sets the end to 0, which only the next party move (`recordPartyMove`) raises.
   */
  markMagicFootprints(spellPower: number): void {
    this.indexOfFirstMagic = this.count;
    if (spellPower < 3) {
      this.indexOfLastMagic = this.indexOfFirstMagic;
    } else {
      this.indexOfLastMagic = 0;
    }
  }

  /**
   * The whole trail, for the state a read restores. Monsters that cannot see the party smell
   * this, so a restore that dropped it would make every hunting monster lose the
   * scent at exactly the moment the game was reloaded.
   */
  capture(): FootprintsSnapshot {
    return {
      prints: [...this.prints],
      ages: [...this.ages],
      count: this.count,
      lastPartyMoveTime: this.lastPartyMoveTime,
      indexOfFirstMagic: this.indexOfFirstMagic,
      indexOfLastMagic: this.indexOfLastMagic,
    };
  }

  restore(snapshot: FootprintsSnapshot): void {
    this.prints = [...snapshot.prints];
    this.ages = [...snapshot.ages];
    this.count = snapshot.count;
    this.lastPartyMoveTime = snapshot.lastPartyMoveTime;
    this.indexOfFirstMagic = snapshot.indexOfFirstMagic;
    this.indexOfLastMagic = snapshot.indexOfLastMagic;
  }
}

/** A print's `[level:6][y:5][x:5]`, A22E's `SCENT.Location` (`MOVESENS.C:778-780`). */
function packLocation(level: number, mapX: number, mapY: number): number {
  return (((level & 0x3f) << 10) | ((mapY & 0x1f) << 5) | (mapX & 0x1f)) & 0xffff;
}

/** `PartyFootprints.capture()`'s payload. */
export interface FootprintsSnapshot {
  prints: number[];
  ages: number[];
  count: number;
  lastPartyMoveTime: number;
  indexOfFirstMagic: number;
  indexOfLastMagic: number;
}
