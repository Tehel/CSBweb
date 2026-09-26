import { OBJECT_ID_NULL, type ObjectID } from '../core/types';
import { sw } from '../core/intCast';

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
  TT_BASH_DOOR = 2, // `HitDoor`'s delayed arm: the door shatters when this fires
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
  /**
   * The cloud's life (`ProcessTT_25`, doc/CSBwin-src/Timer.cpp:436). One tick at a
   * time: deal the cloud's damage, shrink it, and reschedule — or fall out of the
   * switch and delete the cloud. Without it a cloud renders at full size forever.
   */
  TT_25 = 25,
  /**
   * Remove an object from its cell and free its record
   * (`doc/CSBwin-src/CSBCode.cpp:6494`). A general expiry timer; the Fluxcage is what
   * uses it, with a 100-tick life. Suppressed once the game is won.
   */
  TT_24 = 24,
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
  /**
   * A champion's own shield wears off (`doc/CSBwin-src/CSBCode.cpp:6520`). `uByte5` is
   * the champion, `timerWord6` the amount to take back off `shieldStrength`. Armed by
   * a Ya potion.
   */
  TT_72 = 72,
  TT_73 = 73,
  TT_74 = 74,
  /**
   * One tick of poison (`doc/CSBwin-src/CSBCode.cpp:6554`). `uByte5` is the champion,
   * `timerWord6` how many ticks are left; the handler decrements `poisonCount` and
   * calls `PoisonCharacter` again, which re-arms the timer until the count runs out.
   */
  TT_75 = 75,
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
  object?: ObjectID;
}

/**
 * The timer index a missile's record holds while `MissileTimer` moves it
 * (`pDBMissile->timerIndex(0xffff)`, `doc/CSBwin-src/Timer.cpp:224-226`), which
 * `getTimer` answers with `missileFilterTimer`.
 */
export const MISSILE_FILTER_TIMER_INDEX = 0xffff;

export class TimerQueue {
  /**
   * `missileFilterObject` and `missileFilterTimer` (`doc/CSBwin-src/Timer.cpp:176-177`):
   * the missile `MissileTimer` is moving, and its copy of the timer. Only
   * `TimerSystem.processMissileTimer` writes them. Every exit puts the object back to
   * `RNnul` and leaves the copy, so `missileFilterTimer` is the last missile timer run,
   * and `MissileEncounterFilter` reads its direction (`Code11f52.cpp:1681`) for every
   * encounter, whatever caused it. `null` is the zeroed global, before any missile has
   * flown.
   */
  missileFilterObject = OBJECT_ID_NULL;
  missileFilterTimer: TimerEntry | null = null;
  private queue: TimerEntry[] = [];
  /** `m_timerSequence` (`Data.h:1542`), a `ui16`: the stamp the next queued timer takes. */
  private nextSequence = 0;
  /**
   * `m_firstAvailTimer` (`doc/CSBwin-src/Data.h:1540`) — the lowest slot of the timer
   * array that holds no live timer, and the one the next `SetTimer` will take.
   *
   * It is a cursor, not a counter: `deleteTimer` lowers it whenever a slot below it
   * frees, and `addTimer` walks it forward past whatever is occupied. The invariant is
   * that it is always the *lowest* free slot, which is why `restore` can derive it
   * rather than needing the `gb2.FirstAvailTimer` the file carries.
   */
  private firstAvailTimer = 0;
  private indexMap = new Map<number, TimerEntry>();
  private deleteDuplicateTimers = true; // CSBWin deleteDuplicateTimers default

  getTimers(): readonly TimerEntry[] {
    return this.queue;
  }

  peekNext(): TimerEntry | undefined {
    return this.queue[0];
  }

  /**
   * `GameTimers::GetNextTimerEntry` (`doc/CSBwin-src/Timer.cpp:1222`) — take the head
   * of the queue and **free its slot**, which is what the `DeleteTimer(*index)` on its
   * last line does. The entry is handed back by value, as CSBWin `memcpy`s it out
   * before deleting, so a handler still sees the timer it was woken by.
   *
   * This used to pop the queue and leave `indexMap` alone, so a fired timer's index
   * stayed live to `getTimer` and its slot was never reused.
   */
  shiftNext(): TimerEntry | undefined {
    const entry = this.queue.shift();
    if (!entry) return undefined;
    this.releaseIndex(entry.index);
    return entry;
  }

  clear(): void {
    this.queue = [];
    this.nextSequence = 0;
    this.firstAvailTimer = 0;
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
    object?: ObjectID,
    timerWord8 = 0,
    timerWord6 = 0,
  ): TimerEntry {
    const entry: TimerEntry = {
      index: -1, // assigned by addTimer, which is the one place indices are minted
      time: time >>> 0,
      level: level & 0xff,
      function: functionType & 0xff,
      uByte5: 0,
      uByte6: x & 0xff,
      uByte7: y & 0xff,
      uByte8: pos & 0xff,
      uByte9: action & 0xff,
      sequence: 0, // stamped by addTimer, if it is queued at all
      timerWord8: timerWord8 & 0xffff,
      timerWord6: sw(timerWord6),
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
    object?: ObjectID,
    timerWord8 = 0,
    timerWord6 = 0,
  ): TimerEntry {
    const entry: TimerEntry = {
      index: -1, // assigned by addTimer
      time: time >>> 0,
      level: level & 0xff,
      function: functionType & 0xff,
      uByte5: uByte5 & 0xff,
      uByte6: x & 0xff,
      uByte7: y & 0xff,
      uByte8: pos & 0xff,
      uByte9: action & 0xff,
      sequence: 0, // stamped by addTimer, if it is queued at all
      timerWord8: timerWord8 & 0xffff,
      timerWord6: sw(timerWord6),
      object,
    };
    return this.addTimer(entry);
  }

  /**
   * `GameTimers::SetTimer(TIMER *)` — queue a timer and return the queued entry.
   *
   * **The entry is copied**, exactly as CSBWin copies the struct into its timer array.
   * Callers legitimately reuse one `TimerEntry` as a template across a loop — CSBWin's
   * `MaybeDelTimers_Fear6_TurnIndividuals` does it for every member of a monster group
   * (`doc/CSBwin-src/Monster.cpp:1476-1553`) — and storing the object by reference put
   * the *same* entry in the queue several times, so each later mutation rewrote entries
   * already queued. That left the queue unsorted, and since `processTimers` stops at the
   * first entry that is not yet due, everything behind the misplaced one stalled
   * forever. Read the returned entry, never the argument, for the queued `index`.
   */
  addTimer(entry: TimerEntry): TimerEntry {
    const deduped = this.applyDuplicateTimerRules(entry);
    if (deduped) return deduped;

    // `D5L = m_firstAvailTimer` (`doc/CSBwin-src/Timer.cpp:1129`), stamped with
    // `m_timerSequence++` (`:1189`) — so a duplicate dropped above consumes no number, and
    // a timer queued again gets a fresh one — then walk the cursor forward to the next
    // empty entry (`Timer.cpp:1195-1198`). The counter is a `ui16` (`Data.h:1542`): the
    // timer that finds it at 0xffff repacks the stamps in use, takes 0xffff itself, and
    // leaves it at 0.
    if (this.nextSequence === 0xffff) this.repackSequences();
    const stored: TimerEntry = { ...entry, index: this.firstAvailTimer, sequence: this.nextSequence };
    this.nextSequence = (this.nextSequence + 1) & 0xffff;
    this.indexMap.set(stored.index, stored);
    while (this.indexMap.has(this.firstAvailTimer)) this.firstAvailTimer++;
    const idx = this.queue.findIndex((existing) => compareTimers(stored, existing) < 0);
    if (idx === -1) {
      this.queue.push(stored);
    } else {
      this.queue.splice(idx, 0, stored);
    }
    return stored;
  }

  /**
   * `SetTimer`'s repack (`doc/CSBwin-src/Timer.cpp:1136-1188`). The stamps are cut into
   * pages of 32; the pages some queued timer's stamp is in are renumbered 0, 1, 2… in
   * their order, and each stamp keeps its place in its page. The order of the stamps is
   * kept, so the queue's order is too. The counter is not reset: the timer being queued
   * still takes 0xffff, and the next one 0, below every repacked stamp.
   */
  private repackSequences(): void {
    const PAGE = 32; // `TimerSequencePageSize` (`Timer.cpp:1135`)
    const used = new Set<number>();
    for (const timer of this.queue) used.add(Math.floor(timer.sequence / PAGE));
    const pageTranslate = new Map<number, number>();
    for (const page of [...used].sort((a, b) => a - b)) pageTranslate.set(page, pageTranslate.size);
    for (const timer of this.queue) {
      const page = pageTranslate.get(Math.floor(timer.sequence / PAGE))!;
      timer.sequence = ((timer.sequence % PAGE) + page * PAGE) & 0xffff;
    }
  }

  /**
   * Replace the whole queue with a saved one.
   *
   * `LoadGame` restores CSBWin's timer array and its queue verbatim and then **does not
   * re-sort** (`doc/CSBwin-src/SaveGame.cpp:1687-1723`). ⚠️ That queue is CSBWin's binary
   * heap, not the sorted list this class keeps, so the order taken here is not the firing
   * order (`DEBT.md` C51). This takes the order as given rather than re-inserting through
   * `addTimer`, which would also run the duplicate-timer rules over a set of timers that
   * legitimately coexist — two door steps on the same cell at different times, say — and
   * quietly drop some.
   *
   * `nextSequence` is `gb2.TimerSequence`, the counter CSBWin hands to the next timer it
   * queues. Indices are kept as the file numbered them, because other saved state points
   * at them: `CHARDESC.busyTimerIndex` names a champion's pending action, and
   * `DungeonState`'s `timerWord8` lookup is by index.
   *
   * The free cursor is restored too — CSBWin saves it as `gb2.FirstAvailTimer` and reads
   * it straight back (`doc/CSBwin-src/SaveGame.cpp:1023,1640`). Since the cursor is
   * always the lowest free slot, deriving it from the holes in the restored table is the
   * same value, and costs the save format nothing.
   *
   * It used to mint new timers above the highest restored index instead, on the grounds
   * that it "costs nothing but the numbering". It cost more than that: `LoadGame` is
   * followed by `reloadAfterSaveGame`, whose `processMonstersOnLevel` deletes and
   * re-creates the movement timers of every monster group on the party's level, so each
   * load abandoned one slot per re-created timer. A quick-save/quick-load cycle on a
   * level with monsters grew the table by two slots every time, for ever.
   */
  restore(entries: readonly TimerEntry[], nextSequence: number): void {
    this.queue = entries.map((entry) => ({ ...entry }));
    this.indexMap.clear();
    for (const entry of this.queue) this.indexMap.set(entry.index, entry);
    this.firstAvailTimer = 0;
    while (this.indexMap.has(this.firstAvailTimer)) this.firstAvailTimer++;
    this.nextSequence = nextSequence & 0xffff;
  }

  /** `gameTimers.TimerSequence()` — what the next queued timer will be stamped with. */
  getNextSequence(): number {
    return this.nextSequence;
  }

  /**
   * `gameTimers.FirstAvailTimer()` — the cursor above. `SaveGame` writes it into
   * `GAMEBLOCK2` offset 26 (`doc/CSBwin-src/SaveGame.cpp:1023`).
   */
  getFirstAvailTimer(): number {
    return this.firstAvailTimer;
  }

  /**
   * `GameTimers::pTimer` (`doc/CSBwin-src/Timer.cpp:700-714`): the timer in slot `index`,
   * or, for `MISSILE_FILTER_TIMER_INDEX`, the copy of the missile timer that is running.
   * CSBWin dies on that index outside `MissileTimer`; the port answers `null`, as for any
   * slot that holds no timer.
   */
  getTimer(index: number): TimerEntry | null {
    if (index === MISSILE_FILTER_TIMER_INDEX) {
      return this.missileFilterObject !== OBJECT_ID_NULL ? this.missileFilterTimer : null;
    }
    return this.indexMap.get(index) ?? null;
  }

  getTimerWord8(index: number): number | null {
    const entry = this.getTimer(index);
    return entry ? entry.timerWord8 & 0xffff : null;
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
    const idx = this.queue.indexOf(entry);
    if (idx >= 0) this.queue.splice(idx, 1);
    this.releaseIndex(index);
  }

  /**
   * `DeleteMonsterMovementTimers` (`doc/CSBwin-src/Monster.cpp:1297`) — drop every
   * timer of type 29-41 on this level at this square. `trace` receives CSBWin's
   * `AITraceActive` line.
   */
  deleteMonsterMovementTimers(mapX: number, mapY: number, level: number, trace?: (line: string) => void): void {
    trace?.(`      MAI Delete all Monster Timers at (${mapX},${mapY})`);
    const doomed: number[] = [];
    for (const timer of this.queue) {
      if (timer.level !== (level & 0xff)) continue;
      if (timer.function < TimerFunction.TT_FIRST_MONSTER_AI) continue;
      if (timer.function > TimerFunction.TT_LAST_MONSTER_AI) continue;
      if (timer.uByte6 !== (mapX & 0xff)) continue;
      if (timer.uByte7 !== (mapY & 0xff)) continue;
      doomed.push(timer.index);
    }
    for (const index of doomed) this.deleteTimer(index);
  }

  /**
   * The tail of `GameTimers::DeleteTimer` (`doc/CSBwin-src/Timer.cpp:965-969`): the slot
   * becomes `TT_EMPTY` and the free cursor drops to it if it is lower.
   */
  private releaseIndex(index: number): void {
    this.indexMap.delete(index);
    if (index < this.firstAvailTimer) this.firstAvailTimer = index;
  }

  /**
   * `TIMER_SEARCH`'s order: a snapshot of the queue (`CreateSearchList`,
   * `doc/CSBwin-src/Timer.cpp:1209-1215`) walked from its **end** (`FindNextTimer`,
   * `:2924-2933`). It is a snapshot, so deleting the current entry does not disturb the
   * walk. ⚠️ CSBWin's queue is a heap, so its walk starts at the heap's last array entry;
   * this sorted array starts it at the timer due last (`DEBT.md` C51).
   */
  searchOrder(): TimerEntry[] {
    return this.queue.slice().reverse();
  }

  /**
   * The duplicate-timer rules at the top of `GameTimers::SetTimer`
   * (`doc/CSBwin-src/Timer.cpp:1011-1125`). A clash with a timer already queued mostly
   * **keeps the old one**: it takes the new `uByte9` (or, for a `TT_DOOR`, a flipped one)
   * and is returned in place of the new timer, which is dropped. Only a map timer meeting
   * a `TT_1`, and a `TT_BASH_DOOR`, delete the old ones and queue the new.
   */
  private applyDuplicateTimerRules(entry: TimerEntry): TimerEntry | null {
    if (this.isMapTimer(entry.function)) {
      if (this.deleteDuplicateTimers) {
        for (const existing of this.searchOrder()) {
          if (this.isMapTimer(existing.function)) {
            if (!this.matchTimeLevelWord6(entry, existing)) continue;
            if (existing.function === TimerFunction.TT_STONEROOM && existing.uByte8 !== entry.uByte8) continue;
            existing.uByte9 = entry.uByte9 & 0xff;
            return existing;
          }
          if (existing.function !== TimerFunction.TT_DOOR_STEP) continue;
          if (!this.matchTimeLevelWord6(entry, existing)) continue;
          if ((entry.uByte9 & 0xff) === 2) {
            entry.uByte9 = (1 - (existing.uByte9 & 0xff)) & 0xff;
          }
          this.deleteTimer(existing.index);
          break;
        }
      }
      return null;
    }

    if (entry.function === TimerFunction.TT_DOOR_STEP) {
      for (const existing of this.searchOrder()) {
        if (!this.matchTimeLevelWord6(entry, existing)) continue;
        if (existing.function === TimerFunction.TT_DOOR) {
          if ((existing.uByte9 & 0xff) === 2) {
            existing.uByte9 = (1 - (entry.uByte9 & 0xff)) & 0xff;
          }
          return existing;
        }
        if (existing.function === TimerFunction.TT_DOOR_STEP) {
          existing.uByte9 = entry.uByte9 & 0xff;
          return existing;
        }
      }
      return null;
    }

    // A bashed door cancels every door timer on its cell, whenever it was due
    // (`doc/CSBwin-src/Timer.cpp:1102-1123`).
    if (entry.function === TimerFunction.TT_BASH_DOOR) {
      const doomed = this.queue.filter((existing) =>
        existing.level === entry.level
        && existing.uByte6 === entry.uByte6
        && existing.uByte7 === entry.uByte7
        && (existing.function === TimerFunction.TT_DOOR_STEP || existing.function === TimerFunction.TT_DOOR));
      for (const existing of doomed) this.deleteTimer(existing.index);
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
