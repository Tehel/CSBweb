import { OBJECT_ID_NULL, type ObjectID } from '../core/types';
import { sw } from '../core/intCast';

/**
 * CSBWin `TIMERTYPE` (doc/CSBwin-src/CSB.h:1804-1860).
 *
 * The negative entries are not real queue entries — `ProcessTimers29to41` rewrites
 * its incoming function code into one of them to say *why* it was woken
 * (doc/CSBwin-src/Monster.cpp:3413+), and `InitialChecks` maps `TT_M3` back to
 * `TT_29` (doc/CSBwin-src/Monster.cpp:3026).
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
  /**
   * The end of the damage shown over a champion's name (`TAG011366`,
   * doc/CSBwin-src/Timer.cpp:2686): `uByte5` is the champion. `DisplayCharacterDamage`
   * arms it five ticks on (`CSBCode.cpp:7231-7261`).
   */
  TT_12 = 12,
  TT_VI_ALTAR = 13,
  /**
   * A delayed sound (`QueueSound` with `deltaTime > 1`, doc/CSBwin-src/CSBCode.cpp:1861-1877):
   * `timerWord8` is the ordinal, played with `QueueSound(ordinal, x, y, 1)` on the
   * timer's level when it fires (`:6544-6551`).
   */
  TT_20 = 20,
  /**
   * The cloud's life (`ProcessTT_25`, doc/CSBwin-src/Timer.cpp:436). One tick at a
   * time: deal the cloud's damage, shrink it, and reschedule — or fall out of the
   * switch and delete the cloud. Without it a cloud renders at full size forever.
   */
  TT_25 = 25,
  /**
   * Remove an object from its cell and free its record
   * (`doc/CSBwin-src/CSBCode.cpp:6553`). A general expiry timer; the Fluxcage is what
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
   * A champion's own shield wears off (`doc/CSBwin-src/CSBCode.cpp:6579`). `uByte5` is
   * the champion, `timerWord6` the amount to take back off `shieldStrength`. Armed by
   * a Ya potion.
   */
  TT_72 = 72,
  TT_73 = 73,
  TT_74 = 74,
  /**
   * One tick of poison (`doc/CSBwin-src/CSBCode.cpp:6613`). `uByte5` is the champion,
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

/** What `createTimer` is given: the function, the time and the level, and any other field set. */
export type NewTimer = Pick<TimerEntry, 'function' | 'time' | 'level'>
  & Partial<Pick<TimerEntry, 'uByte5' | 'uByte6' | 'uByte7' | 'uByte8' | 'uByte9' | 'timerWord8' | 'timerWord6' | 'object'>>;

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
   * and `MissileEncounterFilter` reads its direction (`Code11f52.cpp:1716`) for every
   * encounter, whatever caused it. `null` is the zeroed global, before any missile has
   * flown.
   */
  missileFilterObject = OBJECT_ID_NULL;
  missileFilterTimer: TimerEntry | null = null;
  /**
   * `m_timerQueue` (`doc/CSBwin-src/Data.h:1550`), `m_numTimer` entries long: the live
   * timers as CSBWin's binary min-heap over `timerLess`. The head, `queue[0]`, is the next
   * timer due, and each entry is not `timerLess` than its parent at `(i - 1) >> 1`. The
   * rest of the array is in no firing order, and the order it is in is CSBWin's, because
   * every insertion, deletion and re-sort moves entries as `AdjustTimerQueue` does. A save
   * writes this array as the queue and a load reads it back.
   */
  private queue: TimerEntry[] = [];
  /** `m_timerSequence` (`Data.h:1557`), a `ui16`: the stamp the next queued timer takes. */
  private nextSequence = 0;
  /**
   * `m_firstAvailTimer` (`doc/CSBwin-src/Data.h:1555`) — the slot the next `SetTimer`
   * will take.
   *
   * It is a cursor, not a counter: `deleteTimer` lowers it whenever a slot below it
   * frees, and `addTimer` walks it forward past whatever is occupied, so it is the
   * lowest free slot, until the table fills: then `addTimer` moves it to the old
   * `maxTimers`, past every hole, and the holes below it wait for a delete to lower it.
   */
  private firstAvailTimer = 0;
  /**
   * `m_maxTimers`, a `ui16`: the timer table's size. A new game allocates it
   * (`allocate`), a save carries it as `gb2.MaxTimers`, and `addTimer` enlarges it.
   */
  private maxTimers = 0;
  private indexMap = new Map<number, TimerEntry>();
  /**
   * `deleteDuplicateTimers` (`doc/CSBwin-src/data.cpp:65`), a global: whether a new map
   * timer merges into a matching one (`applyDuplicateTimerRules`). Every read of a game
   * sets it from its world's `EXPOOL` (`readDeleteDuplicateTimers`), true where the pool
   * has no record of it.
   */
  deleteDuplicateTimers = true;

  /** The live timers in `m_timerQueue`'s heap order, not their firing order. */
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
   */
  shiftNext(): TimerEntry | undefined {
    const entry = this.queue[0];
    if (!entry) return undefined;
    this.deleteTimer(entry.index);
    return entry;
  }

  /**
   * A `TIMER` filled as a caller of `SetTimer` fills one, by its fields (`timer.Function`,
   * `timer.timerUByte6`, …), and queued (`addTimer`). A byte or word left out is 0.
   */
  createTimer(timer: NewTimer): TimerEntry {
    return this.addTimer({
      index: -1, // assigned by addTimer, which is the one place indices are minted
      time: timer.time >>> 0,
      level: timer.level & 0xff,
      function: timer.function & 0xff,
      uByte5: (timer.uByte5 ?? 0) & 0xff,
      uByte6: (timer.uByte6 ?? 0) & 0xff,
      uByte7: (timer.uByte7 ?? 0) & 0xff,
      uByte8: (timer.uByte8 ?? 0) & 0xff,
      uByte9: (timer.uByte9 ?? 0) & 0xff,
      sequence: 0, // stamped by addTimer, if it is queued at all
      timerWord8: (timer.timerWord8 ?? 0) & 0xffff,
      timerWord6: sw(timer.timerWord6 ?? 0),
      object: timer.object,
    });
  }

  /**
   * `GameTimers::SetTimer(TIMER *)` — queue a timer and return the queued entry.
   *
   * **The entry is copied**, exactly as CSBWin copies the struct into its timer array.
   * Callers legitimately reuse one `TimerEntry` as a template across a loop — CSBWin's
   * `MaybeDelTimers_Fear6_TurnIndividuals` does it for every member of a monster group
   * (`doc/CSBwin-src/Monster.cpp:1480-1557`) — and storing the object by reference would put
   * the *same* entry in the queue several times, so each later mutation would rewrite
   * entries already queued and break the heap. Read the returned entry, never the
   * argument, for the queued `index`.
   */
  addTimer(entry: TimerEntry): TimerEntry {
    // A table within five of full jumps its cursor past every hole and grows by a
    // quarter, before the duplicate rules (`doc/CSBwin-src/Timer.cpp:999-1008`).
    if (this.queue.length >= this.maxTimers - 5) {
      if (this.maxTimers >= 5000) throw new Error('TimerQueue: No empty Timer entries'); // die(45)
      this.firstAvailTimer = this.maxTimers;
      this.allocate(Math.trunc((this.maxTimers + 10) * 5 / 4));
    }
    const deduped = this.applyDuplicateTimerRules(entry);
    if (deduped) return deduped;

    // `D5L = m_firstAvailTimer` (`doc/CSBwin-src/Timer.cpp:1129`), stamped with
    // `m_timerSequence++` (`:1189`) — so a duplicate dropped above consumes no number, and
    // a timer queued again gets a fresh one — then walk the cursor forward to the next
    // empty entry (`Timer.cpp:1195-1198`). The counter is a `ui16` (`Data.h:1557`): the
    // timer that finds it at 0xffff repacks the stamps in use, takes 0xffff itself, and
    // leaves it at 0.
    if (this.nextSequence === 0xffff) this.repackSequences();
    const stored: TimerEntry = { ...entry, index: this.firstAvailTimer, sequence: this.nextSequence };
    this.nextSequence = (this.nextSequence + 1) & 0xffff;
    this.indexMap.set(stored.index, stored);
    while (this.indexMap.has(this.firstAvailTimer)) this.firstAvailTimer++;
    // `m_timerQueue[m_numTimer] = D5W; m_numTimer++; AdjustTimerQueue(m_numTimer-1)`
    // (`Timer.cpp:1200-1202`).
    this.queue.push(stored);
    this.adjustTimerQueue(this.queue.length - 1);
    return stored;
  }

  /**
   * `GameTimers::Allocate` (`doc/CSBwin-src/Timer.cpp:657-685`): the table is `numEnt`
   * slots, if that is more than it has. The new slots are empty.
   */
  allocate(numEnt: number): void {
    if (this.maxTimers >= numEnt) return;
    this.maxTimers = numEnt & 0xffff;
  }

  /** `gameTimers.MaxTimer()`, the table's size, which a save writes as `gb2.MaxTimers`. */
  getMaxTimers(): number {
    return this.maxTimers;
  }

  /**
   * `GameTimers::AdjustTimerQueue` (`doc/CSBwin-src/Timer.cpp:831-896`): move the entry at
   * `timerQueueIndex` up the heap while it is `timerLess` than its parent and, if it did
   * not move up, down while the lesser of its children is `timerLess` than it.
   */
  private adjustTimerQueue(timerQueueIndex: number): void {
    const numTimer = this.queue.length;
    if (numTimer === 1) return;
    let d7 = timerQueueIndex;
    const moving = this.queue[d7]!;
    let swapped = false;
    while (d7 !== 0) {
      const d6 = (d7 - 1) >> 1;
      if (!timerLess(moving, this.queue[d6]!)) break;
      this.queue[d7] = this.queue[d6]!;
      d7 = d6;
      swapped = true;
    }
    if (!swapped) {
      const lastParent = Math.trunc((numTimer - 2) / 2);
      while (d7 <= lastParent) {
        let d6 = 2 * d7 + 1;
        if (d6 + 1 < numTimer && timerLess(this.queue[d6 + 1]!, this.queue[d6]!)) d6++;
        if (!timerLess(this.queue[d6]!, moving)) break;
        this.queue[d7] = this.queue[d6]!;
        d7 = d6;
      }
    }
    this.queue[d7] = moving;
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
   * `LoadGame` restores CSBWin's timer array and its queue verbatim
   * (`doc/CSBwin-src/SaveGame.cpp:1813-1879`): the queue is the heap as the save left it,
   * so this takes it as given. Re-inserting through `addTimer` would build another heap
   * array, and would also run the duplicate-timer rules over a set of timers that
   * legitimately coexist — two door steps on the same cell at different times, say — and
   * quietly drop some.
   *
   * `nextSequence` is `gb2.TimerSequence`, the counter CSBWin hands to the next timer it
   * queues. Indices are kept as the file numbered them, because other saved state points
   * at them: `CHARDESC.busyTimerIndex` names a champion's pending action, and
   * `DungeonState`'s `timerWord8` lookup is by index.
   *
   * The table's size and the free cursor come back as `LoadGame` reads them,
   * `gb2.MaxTimers` and `gb2.FirstAvailTimer` (`doc/CSBwin-src/SaveGame.cpp:1762-1764`),
   * into a table that is not first allocated as a new game's.
   *
   * New timers are not minted above the highest restored index: `LoadGame` is followed
   * by `reloadAfterSaveGame`, whose `processMonstersOnLevel` deletes and re-creates the
   * movement timers of every monster group on the party's level, so each load would
   * abandon one slot per re-created timer, and a save/load cycle on a level with
   * monsters would grow the table for ever.
   */
  restore(entries: readonly TimerEntry[], nextSequence: number, maxTimers: number, firstAvailTimer: number): void {
    this.queue = entries.map((entry) => ({ ...entry }));
    this.indexMap.clear();
    for (const entry of this.queue) this.indexMap.set(entry.index, entry);
    this.maxTimers = maxTimers & 0xffff;
    this.firstAvailTimer = firstAvailTimer;
    this.nextSequence = nextSequence & 0xffff;
  }

  /** `gameTimers.TimerSequence()` — what the next queued timer will be stamped with. */
  getNextSequence(): number {
    return this.nextSequence;
  }

  /**
   * `gameTimers.FirstAvailTimer()` — the cursor above. `SaveGame` writes it into
   * `GAMEBLOCK2` offset 26 (`doc/CSBwin-src/SaveGame.cpp:1048`).
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
   * `TIMER_SEARCH::AdjustTimerPriority` (`doc/CSBwin-src/Timer.cpp:913-916`), as
   * `Code11f52.cpp:1229` calls it: `AdjustTimerQueue` at the timer's queue position,
   * after its sort key changed. The function code is part of the ordering (see
   * `timerLess`), so renumbering a monster's per-member AI timer moves it in the heap.
   * The timer is not removed and queued again, so the duplicate-timer rules and its
   * `sequence` are both left alone.
   */
  reprioritizeTimer(index: number): void {
    const entry = this.indexMap.get(index);
    if (!entry) return;
    const at = this.queue.indexOf(entry);
    if (at < 0) return;
    this.adjustTimerQueue(at);
  }

  /**
   * `GameTimers::DeleteTimer` (`doc/CSBwin-src/Timer.cpp:959-984`): free the slot, then
   * move the heap's last entry into the hole the timer leaves and `AdjustTimerQueue` it.
   */
  deleteTimer(index: number): void {
    const entry = this.indexMap.get(index);
    if (!entry) return;
    this.releaseIndex(index);
    const qPos = this.queue.indexOf(entry);
    const last = this.queue.pop()!;
    if (qPos !== this.queue.length) {
      this.queue[qPos] = last;
      this.adjustTimerQueue(qPos);
    }
  }

  /**
   * `DeleteMonsterMovementTimers` (`doc/CSBwin-src/Monster.cpp:1301`) — drop every
   * timer of type 29-41 on this level at this square, in `searchOrder`. `trace` receives
   * CSBWin's `AITraceActive` line.
   */
  deleteMonsterMovementTimers(mapX: number, mapY: number, level: number, trace?: (line: string) => void): void {
    trace?.(`      MAI Delete all Monster Timers at (${mapX},${mapY})`);
    const matches = (timer: TimerEntry): boolean =>
      timer.level === (level & 0xff)
      && timer.function >= TimerFunction.TT_FIRST_MONSTER_AI
      && timer.function <= TimerFunction.TT_LAST_MONSTER_AI
      && timer.uByte6 === (mapX & 0xff)
      && timer.uByte7 === (mapY & 0xff);
    // The walk reads the queue itself up to the first timer it deletes, and the snapshot
    // `searchOrder` would have given from there on: the entries not walked yet.
    let first = this.queue.length - 1;
    while (first >= 0 && !matches(this.queue[first]!)) first--;
    if (first < 0) return;
    for (const timer of this.queue.slice(0, first + 1).reverse()) {
      if (matches(timer)) this.deleteTimer(timer.index);
    }
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
   * `:2924-2933`), which starts at the heap's last array entry. It is a snapshot, so
   * deleting the current entry does not disturb the walk. Where the walk deletes or
   * re-sorts timers, its order decides the heap array it leaves.
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
      for (const existing of this.searchOrder()) {
        if (existing.uByte6 !== entry.uByte6 || existing.uByte7 !== entry.uByte7) continue;
        if (existing.level !== entry.level) continue;
        if (existing.function !== TimerFunction.TT_DOOR_STEP && existing.function !== TimerFunction.TT_DOOR) continue;
        this.deleteTimer(existing.index);
      }
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

/**
 * `TIMER::operator<` (`doc/CSBwin-src/Timer.cpp:765-810`), with `SEQUENCED_TIMERS`
 * defined (`stdafx.h:17`): the earlier time first; at the same time a parameter message
 * before anything else, and two of them by the lower `uByte5`; any other pair by the
 * higher function, then the higher `uByte5`; then the lower sequence. The last test,
 * `&timer2 >= this`, orders the timers' slots, so a timer is `timerLess` than itself.
 */
export function timerLess(a: TimerEntry, b: TimerEntry): boolean {
  if (a.time < b.time) return true;
  if (a.time > b.time) return false;
  if (a.function === TimerFunction.TT_PARAMETER_MESSAGE) {
    if (b.function !== TimerFunction.TT_PARAMETER_MESSAGE) return true;
    if (a.uByte5 < b.uByte5) return true;
    if (a.uByte5 > b.uByte5) return false;
    if (a.sequence < b.sequence) return true;
    if (a.sequence > b.sequence) return false;
    return b.index >= a.index;
  }
  if (b.function === TimerFunction.TT_PARAMETER_MESSAGE) return false;
  if (a.function > b.function) return true;
  if (a.function < b.function) return false;
  if (a.uByte5 > b.uByte5) return true;
  if (a.uByte5 < b.uByte5) return false;
  if (a.sequence < b.sequence) return true;
  if (a.sequence > b.sequence) return false;
  return b.index >= a.index;
}
