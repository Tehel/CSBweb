/**
 * CSBWin `TIMERTYPE` (doc/CSBwin-src/CSB.h:1741-1797).
 *
 * The negative entries are not real queue entries — `ProcessTimers29to41` rewrites
 * its incoming function code into one of them to say *why* it was woken
 * (doc/CSBwin-src/Monster.cpp:3405+), and `InitialChecks` maps `TT_M3` back to
 * `TT_29` (doc/CSBwin-src/Monster.cpp:3022).
 */
export enum TimerFunction {
  TT_M3 = -3, // Monster damaged by a cloud or a door
  TT_M2 = -2, // Monster damaged
  TT_M1 = -1, // Monster attacked, or the party bumped into it
  TT_EMPTY = 0,
  TT_DOOR_STEP = 1,
  TT_MISSILE0 = 48,
  TT_MISSILE = 49,
  TT_OPENROOM = 5,
  TT_STONEROOM = 6,
  TT_FALSEWALL = 7,
  TT_TELEPORTER = 8,
  TT_PIT = 9,
  TT_DOOR = 10,
  TT_11 = 11,
  TT_VI_ALTAR = 13,
  // Monster AI. 29-31 are movement wake-ups, 32-36 the "A" attack group and its four
  // individuals, 37-41 the "B" group and its four. `ProcessTimers29to41` handles the
  // whole span; `TT_31` specifically means the party ran into the monster.
  TT_FIRST_MONSTER_AI = 29,
  TT_29 = 29,
  TT_30 = 30,
  TT_31 = 31,
  TT_MONSTER_AGROUP = 32,
  TT_MONSTER_A0 = 33,
  TT_MONSTER_A1 = 34,
  TT_MONSTER_A2 = 35,
  TT_MONSTER_A3 = 36,
  TT_MONSTER_BGROUP = 37,
  TT_MONSTER_B0 = 38,
  TT_MONSTER_B1 = 39,
  TT_MONSTER_B2 = 40,
  TT_MONSTER_B3 = 41,
  TT_LAST_MONSTER_AI = 41,
  // A monster that could not be placed — the destination held the party or another
  // monster — waits in "abeyance" on one of these and retries every 5 ticks
  // (`ProcessTimer60and61`, doc/CSBwin-src/Timer.cpp:2566). TT_61 is the audible
  // variant, which buzzes on arrival.
  TT_60 = 60,
  TT_61 = 61,
  TT_REACTIVATE_GENERATOR = 65,
  TT_LIGHT = 70,
  TT_71 = 71,
  TT_73 = 73,
  TT_74 = 74,
  TT_77 = 77,
  TT_78 = 78,
  TT_79 = 79,
  TT_PARAMETER_MESSAGE = 101,
  TT_DESSAGE = 102,
}

export interface TimerEntry {
  index: number;
  time: number;
  level: number;
  function: number;
  uByte5: number;
  uByte6: number;
  uByte7: number;
  uByte8: number;
  uByte9: number;
  sequence: number;
  timerWord8: number;
  timerWord6: number;
  object?: number;
}

export class TimerQueue {
  private queue: TimerEntry[] = [];
  private nextSequence = 0;
  private nextIndex = 0;
  private indexMap = new Map<number, TimerEntry>();
  private deleteDuplicateTimers = true; // CSBWin deleteDuplicateTimers default

  getTimers(): readonly TimerEntry[] {
    return this.queue;
  }

  peekNext(): TimerEntry | undefined {
    return this.queue[0];
  }

  shiftNext(): TimerEntry | undefined {
    return this.queue.shift();
  }

  clear(): void {
    this.queue = [];
    this.nextSequence = 0;
    this.nextIndex = 0;
    this.indexMap.clear();
  }

  createTimer(
    functionType: number,
    x: number,
    y: number,
    pos: number,
    action: number,
    time: number,
    level: number,
    object?: number,
    timerWord8 = 0,
    timerWord6 = 0,
  ): TimerEntry {
    const entry: TimerEntry = {
      index: this.nextIndex++,
      time: time >>> 0,
      level: level & 0xff,
      function: functionType & 0xff,
      uByte5: 0,
      uByte6: x & 0xff,
      uByte7: y & 0xff,
      uByte8: pos & 0xff,
      uByte9: action & 0xff,
      sequence: this.nextSequence++,
      timerWord8: timerWord8 & 0xffff,
      timerWord6: normalizeWord6(timerWord6),
      object,
    };
    return this.addTimer(entry);
  }

  createTimerWithUByte5(
    functionType: number,
    x: number,
    y: number,
    pos: number,
    action: number,
    time: number,
    level: number,
    uByte5: number,
    object?: number,
    timerWord8 = 0,
    timerWord6 = 0,
  ): TimerEntry {
    const entry: TimerEntry = {
      index: this.nextIndex++,
      time: time >>> 0,
      level: level & 0xff,
      function: functionType & 0xff,
      uByte5: uByte5 & 0xff,
      uByte6: x & 0xff,
      uByte7: y & 0xff,
      uByte8: pos & 0xff,
      uByte9: action & 0xff,
      sequence: this.nextSequence++,
      timerWord8: timerWord8 & 0xffff,
      timerWord6: normalizeWord6(timerWord6),
      object,
    };
    return this.addTimer(entry);
  }

  addTimer(entry: TimerEntry): TimerEntry {
    const deduped = this.applyDuplicateTimerRules(entry);
    if (deduped) return deduped;
    if (!this.indexMap.has(entry.index)) this.indexMap.set(entry.index, entry);
    const idx = this.queue.findIndex((existing) => compareTimers(entry, existing) < 0);
    if (idx === -1) {
      this.queue.push(entry);
    } else {
      this.queue.splice(idx, 0, entry);
    }
    return entry;
  }

  getTimer(index: number): TimerEntry | null {
    return this.indexMap.get(index) ?? null;
  }

  getTimerWord8(index: number): number | null {
    const entry = this.indexMap.get(index);
    return entry ? entry.timerWord8 & 0xffff : null;
  }

  setTimerWord8(index: number, value: number): void {
    const entry = this.indexMap.get(index);
    if (!entry) return;
    entry.timerWord8 = value & 0xffff;
  }

  /**
   * `TIMER_SEARCH::AdjustTimerPriority` (`doc/CSBwin-src/Code11f52.cpp:1194`).
   *
   * Re-sort one timer in place after its sort key changed. The function code is part
   * of the ordering (see `compareTimers`), so renumbering a monster's per-member AI
   * timer moves it in the queue — CSBWin adjusts the position rather than removing
   * and re-inserting, and this does the same so that the duplicate-timer rules and
   * the entry's `sequence` are both left alone.
   */
  reprioritizeTimer(index: number): void {
    const entry = this.indexMap.get(index);
    if (!entry) return;
    const at = this.queue.indexOf(entry);
    if (at < 0) return;
    this.queue.splice(at, 1);
    const insertAt = this.queue.findIndex((existing) => compareTimers(entry, existing) < 0);
    if (insertAt === -1) this.queue.push(entry);
    else this.queue.splice(insertAt, 0, entry);
  }

  deleteTimer(index: number): void {
    const entry = this.indexMap.get(index);
    if (!entry) return;
    this.indexMap.delete(index);
    const idx = this.queue.indexOf(entry);
    if (idx >= 0) this.queue.splice(idx, 1);
  }

  private applyDuplicateTimerRules(entry: TimerEntry): TimerEntry | null {
    if (this.isMapTimer(entry.function)) {
      if (this.deleteDuplicateTimers) {
        let toDelete: TimerEntry | null = null;
        for (const existing of this.queue) {
          if (this.isMapTimer(existing.function)) {
            if (!this.matchTimeLevelWord6(entry, existing)) continue;
            if (existing.function === TimerFunction.TT_STONEROOM && existing.uByte8 !== entry.uByte8) continue;
            toDelete = existing;
            break;
          }
          if (existing.function !== TimerFunction.TT_DOOR_STEP) continue;
          if (!this.matchTimeLevelWord6(entry, existing)) continue;
          if ((entry.uByte9 & 0xff) === 2) {
            entry.uByte9 = 1 - (existing.uByte9 & 0xff);
          }
          toDelete = existing;
          break;
        }
        if (toDelete) this.deleteTimer(toDelete.index);
      }
      return null;
    }

    if (entry.function === TimerFunction.TT_DOOR_STEP) {
      let toDelete: TimerEntry | null = null;
      for (const existing of this.queue) {
        if (!this.matchTimeLevelWord6(entry, existing)) continue;
        if (existing.function === TimerFunction.TT_DOOR) {
          if ((existing.uByte9 & 0xff) === 2) {
            entry.uByte9 = 1 - (entry.uByte9 & 0xff);
          }
          toDelete = existing;
          break;
        }
        if (existing.function === TimerFunction.TT_DOOR_STEP) {
          toDelete = existing;
          break;
        }
      }
      if (toDelete) this.deleteTimer(toDelete.index);
    }

    return null;
  }

  private matchTimeLevelWord6(a: TimerEntry, b: TimerEntry): boolean {
    return a.time === b.time
      && a.level === b.level
      && a.uByte6 === b.uByte6
      && a.uByte7 === b.uByte7;
  }

  private isMapTimer(functionType: number): boolean {
    return functionType >= TimerFunction.TT_OPENROOM && functionType <= TimerFunction.TT_DOOR;
  }
}

function normalizeWord6(value: number): number {
  return (value << 16) >> 16;
}

function compareTimers(a: TimerEntry, b: TimerEntry): number {
  if (a.time !== b.time) return a.time - b.time;

  const aParam = a.function === TimerFunction.TT_PARAMETER_MESSAGE;
  const bParam = b.function === TimerFunction.TT_PARAMETER_MESSAGE;
  if (aParam || bParam) {
    if (aParam && !bParam) return -1;
    if (!aParam && bParam) return 1;
    if (a.uByte5 !== b.uByte5) return a.uByte5 - b.uByte5;
    return a.sequence - b.sequence;
  }

  if (a.function !== b.function) return b.function - a.function;
  if (a.uByte5 !== b.uByte5) return b.uByte5 - a.uByte5;
  return a.sequence - b.sequence;
}
