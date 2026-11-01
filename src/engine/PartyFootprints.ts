/**
 * The party's footprint trail — how monsters smell you.
 *
 * Ports CSBWin's `d.PartyFootprints[24]` / `d.Byte13220[24]` pair
 * (`doc/CSBwin-src/Data.h:796`) and the three functions that maintain them:
 * `AddFootprintEntry` (`doc/CSBwin-src/Code11f52.cpp:4383`), `DeleteFootprintEntry`
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
 * The strengths follow one of three rules (`ScentRule`), which the engine's behaviour
 * chooses (`scentRule`):
 *
 * - `'meant'`, what FTL meant, on every set (`DEBT.md` H, "The scents are what FTL
 *   meant"): a step adds the time spent on the square left to the strengths of its prints,
 *   each its own, up to 80, and the new print is at 24; the ten-second decay spares the
 *   newest print and the party's square's.
 * - `'release'`, the release's own code, before level 2 (`releaseScentLoops`). The Atari's
 *   program throws its comparisons with the square away, so every strength changes; with
 *   the Amiga's tables the trail is A22E's (`doc/AMIGA_DISK_REFERENCE.md` → "A22E's own
 *   code, classed"), whose comparisons count. Both compare print `k` and write strength
 *   `N-1-k`, strength 0 included, and the decay goes on after a drop
 *   (`doc/ATARI_ST_DISK_REFERENCE.md` → "The scents in the program").
 * - `'csbwin'`, CSBWin's loops, which a CSBWin version's profile plays
 *   (`csbwinScentLoops`): the Atari's, but strength 0 is never written and the decay
 *   stops after a drop. Paul Stevens' own comment on `AddFootprintEntry` reads "I think
 *   this is much hogwash. Does nothing useful. Is full of errors. Perhaps an old,
 *   abandoned debug trace" (`doc/CSBwin-src/Code11f52.cpp:4384-4386`).
 */

import type { Position } from '../core/types';
import type { Behaviour } from './Behaviour';

/**
 * How a step and the ten-second decay change the strengths: what FTL meant, the release's
 * loops, or CSBWin's (the class's comment).
 */
export type ScentRule = 'meant' | 'release' | 'csbwin';

/** The rule `behaviour` plays the scents by. */
export function scentRule(behaviour: Behaviour): ScentRule {
  if (behaviour.csbwinScentLoops) return 'csbwin';
  if (behaviour.releaseScentLoops) return 'release';
  return 'meant';
}

/** `d.PartyFootprints` and `d.Byte13220` are both 24 entries (`Data.h:796`). */
const MAX_FOOTPRINT_ENTRIES = 24;

/** The new print's strength, `AddFootprintEntry(newX, newY, 0x8018)`'s 24 (`Code11f52.cpp:3281`). */
const NEW_PRINT_STRENGTH = 0x18;

export class PartyFootprints {
  /**
   * @param byLocation the release's trail is the Amiga's, whose comparisons count: a game
   *   with the Amiga's tables (`GameTables.amigaSounds`).
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
   * `oldX`, `oldY` is the square left, -1 for a party placed from nowhere, on `oldLevel`,
   * which the release's trail reads only on the Amiga's tables, and what FTL meant always.
   * The Amiga's two calls compare on `level`, the map the party arrives on, which is A22E's
   * current map then (ReDMCSB `MOVESENS.C:574`, `:643`, `:772`); what FTL meant, on the
   * level left.
   */
  recordPartyMove(
    time: number,
    level: number,
    newX: number,
    newY: number,
    magicFootprintsActive: boolean,
    oldX = -1,
    oldY = -1,
    oldLevel = level,
    rule: ScentRule = 'meant',
  ): void {
    // CSBWin's `for (D6W=d.NumFootprintEnt; D6W>=24; D6W--) DeleteFootprintEntry(0);`
    // leaves D6W as the index the new print goes into.
    let index = this.count;
    while (index >= MAX_FOOTPRINT_ENTRIES) {
      this.deleteFootprintEntry(0);
      index--;
    }
    const timeSpent = (time - this.lastPartyMoveTime) & 0xffff;
    if (index !== 0) {
      if (rule === 'meant') {
        if (oldX >= 0) this.addTimeSpent(packLocation(oldLevel, oldX, oldY), timeSpent);
      } else if (rule === 'csbwin') {
        this.addFootprintEntryCsbwin(timeSpent);
      } else {
        this.addFootprintEntry(oldX, oldY, level, timeSpent);
      }
    }
    this.lastPartyMoveTime = time;
    this.count++;
    if (magicFootprintsActive) this.indexOfLastMagic = this.count;

    this.prints[index] = packLocation(level, newX, newY);
    if (rule === 'meant') {
      this.ages[index] = NEW_PRINT_STRENGTH;
    } else {
      this.ages[index] = 0;
      if (rule === 'csbwin') this.addFootprintEntryCsbwin(0x8018);
      else this.addFootprintEntry(newX, newY, level, 0x8018);
    }
  }

  /**
   * What FTL meant of `AddFootprintEntry`'s first call: every print at `location`, the
   * square left, gains the time spent there on its own strength, up to 80
   * (`doc/CSBwin-src/Code11f52.cpp:4405`'s `Smaller(80, deltaTime + strength)`).
   */
  private addTimeSpent(location: number, timeSpent: number): void {
    const cycles = timeSpent & 0x7fff;
    for (let k = 0; k < this.count; k++) {
      if (this.prints[k] === location) this.ages[k] = Math.min(80, (this.ages[k] ?? 0) + cycles);
    }
  }

  /**
   * `DeleteFootprintEntry` (`doc/CSBwin-src/Code11f52.cpp:4356`): the entries above `at`
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
   * `AddFootprintEntry` (`doc/CSBwin-src/Code11f52.cpp:4383`), ReDMCSB's
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

  /**
   * CSBWin's `AddFootprintEntry` (`doc/CSBwin-src/Code11f52.cpp:4383-4410`), the
   * square not compared: `while (index-- != 1)` writes the strengths from the newest down
   * to 1, never 0.
   */
  private addFootprintEntryCsbwin(cycleCount: number): void {
    let index = this.count;
    if (index === 0) return;
    const merge = (cycleCount & 0x8000) !== 0;
    let deltaTime = cycleCount & 0x7fff;
    let defined = false;
    while (index-- !== 1) {
      if (!defined) {
        defined = true;
        const strength = this.ages[index] ?? 0;
        deltaTime = merge ? Math.max(strength, deltaTime) : Math.min(80, deltaTime + strength);
      }
      this.ages[index] = deltaTime & 0xff;
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
   * at 0x3c60), where CSBWin's `break`s. What FTL meant, and the Amiga's, spare the print
   * on the party's square, `party`; the Atari's compares each print with it and throws
   * the result away, as CSBWin does (its `SearchWordNE`, commented out).
   */
  ageFootprints(party: Position, rule: ScentRule = 'meant'): void {
    if (rule === 'csbwin') {
      for (let i = 0; i < this.count - 1; i++) {
        const strength = Math.max(0, (this.ages[i] ?? 0) - 1);
        this.ages[i] = strength;
        if (strength !== 0) continue;
        if (i !== 0) continue;
        this.deleteFootprintEntry(0);
        break;
      }
      return;
    }
    const spareParty = rule === 'meant' || this.byLocation;
    const location = packLocation(party.z, party.x, party.y);
    let i = 0;
    while (i < this.count - 1) {
      if (!spareParty || this.prints[i] !== location) {
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
