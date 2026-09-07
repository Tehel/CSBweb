/**
 * The party's footprint trail — how monsters smell you.
 *
 * Ports CSBWin's `d.PartyFootprints[24]` / `d.Byte13220[24]` pair
 * (`doc/CSBwin-src/Data.h:781`) and the three functions that maintain them:
 * `AddFootprintEntry` (`doc/CSBwin-src/Code11f52.cpp:4343`), `DeleteFootprintEntry`
 * (`:4319`), and `SearchFootprints` (`doc/CSBwin-src/CSBCode.cpp:7066`). The trail is
 * appended to on every party move (`:3225-3247`).
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
 * debug trace" (`doc/CSBwin-src/Code11f52.cpp:4344-4346`). It is ported anyway,
 * errors and all, because it is what writes the age bytes that the smelling check
 * then reads — and it is the only thing that writes them.
 */

/** `d.PartyFootprints` and `d.Byte13220` are both 24 entries (`Data.h:781`). */
export const MAX_FOOTPRINT_ENTRIES = 24;

export class PartyFootprints {
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
   * `SearchFootprints` (`doc/CSBwin-src/CSBCode.cpp:7066`) — the **newest** entry at
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
   * (`doc/CSBwin-src/Code11f52.cpp:3225-3247`).
   *
   * The order is load-bearing: the trail is first trimmed to 23 entries or fewer,
   * then the *departed* square's age is written by `addFootprintEntry`, then the
   * count grows, then the *new* square is stored, and finally `addFootprintEntry` is
   * called again with the sentinel `0x8018`.
   */
  recordPartyMove(
    time: number,
    level: number,
    newX: number,
    newY: number,
    magicFootprintsActive: boolean,
  ): void {
    // CSBWin's `for (D6W=d.NumFootprintEnt; D6W>=24; D6W--) DeleteFootprintEntry(0);`
    // leaves D6W as the index the new print goes into.
    let index = this.count;
    while (index >= MAX_FOOTPRINT_ENTRIES) {
      this.deleteFootprintEntry(0);
      index--;
    }
    if (index === 0) {
      // CSBWin skips the whole block when the trail is empty, so the very first move
      // after the party appears records nothing.
      this.lastPartyMoveTime = time;
      return;
    }

    this.addFootprintEntry((time - this.lastPartyMoveTime) & 0xffff);
    this.lastPartyMoveTime = time;
    this.count++;
    if (magicFootprintsActive) this.indexOfLastMagic = this.count;

    this.prints[index] = (((level & 0x3f) << 10) | ((newY & 0x1f) << 5) | (newX & 0x1f)) & 0xffff;
    this.ages[index] = 0;
    this.addFootprintEntry(0x8018);
  }

  /**
   * `DeleteFootprintEntry` (`doc/CSBwin-src/Code11f52.cpp:4319`).
   *
   * ⚠️ CSBWin's `MemMove` here copies **forwards**, from `[P1]` to `[P1+1]` — i.e. it
   * shifts the tail *up*, not down, which is not what removing an entry would
   * normally do. Reproduced exactly; the trail is cosmetic plus a smell hint, and
   * diverging would desynchronise the age bytes from CSBWin's.
   */
  private deleteFootprintEntry(at: number): void {
    this.count--;
    const n = this.count - at;
    if (n > 0) {
      for (let i = n - 1; i >= 0; i--) {
        this.prints[at + 1 + i] = this.prints[at + i] ?? 0;
        this.ages[at + 1 + i] = this.ages[at + i] ?? 0;
      }
    }
    if (at < this.indexOfFirstMagic) this.indexOfFirstMagic--;
    if (at < this.indexOfLastMagic) this.indexOfLastMagic--;
  }

  /**
   * `AddFootprintEntry` (`doc/CSBwin-src/Code11f52.cpp:4343`) — walk the trail from
   * the newest end towards the oldest, writing `deltaTime` into every age byte.
   *
   * Bit 15 of `deltaTime` selects how the first entry it touches combines with what
   * is already there: set means `max(existing, deltaTime)`, clear means
   * `min(80, deltaTime + existing)`. Every subsequent entry is overwritten with the
   * result, which is the part of this that Stevens calls hogwash — the whole tail
   * ends up holding one value.
   */
  private addFootprintEntry(deltaTime: number): void {
    let index = this.count;
    if (index === 0) return;
    const negative = (deltaTime & 0x8000) !== 0;
    let delta = deltaTime & 0x7fff;
    let combined = false;
    while (index-- !== 1) {
      if (!combined) {
        combined = true;
        const existing = this.ages[index] ?? 0;
        delta = negative ? Math.max(existing, delta) : Math.min(80, delta + existing);
      }
      this.ages[index] = delta & 0xff;
    }
  }

  /** Reset the trail — used when a save game is restored. */
  reset(): void {
    this.prints = [];
    this.ages = [];
    this.count = 0;
    this.lastPartyMoveTime = 0;
    this.indexOfFirstMagic = 0;
    this.indexOfLastMagic = 0;
  }
}
