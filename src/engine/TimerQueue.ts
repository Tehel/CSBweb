export enum TimerFunction {
  TT_DOOR_STEP = 1,
  TT_MISSILE0 = 48,
  TT_MISSILE = 49,
  TT_OPENROOM = 5,
  TT_STONEROOM = 6,
  TT_FALSEWALL = 7,
  TT_TELEPORTER = 8,
  TT_PIT = 9,
  TT_DOOR = 10,
  TT_VI_ALTAR = 13,
  TT_REACTIVATE_GENERATOR = 65,
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
  object?: number;
}

export class TimerQueue {
  private queue: TimerEntry[] = [];
  private nextSequence = 0;
  private nextIndex = 0;
  private indexMap = new Map<number, TimerEntry>();

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
      object,
    };
    this.addTimer(entry);
    return entry;
  }

  addTimer(entry: TimerEntry): void {
    if (!this.indexMap.has(entry.index)) this.indexMap.set(entry.index, entry);
    const idx = this.queue.findIndex((existing) => compareTimers(entry, existing) < 0);
    if (idx === -1) {
      this.queue.push(entry);
    } else {
      this.queue.splice(idx, 0, entry);
    }
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

  deleteTimer(index: number): void {
    const entry = this.indexMap.get(index);
    if (!entry) return;
    this.indexMap.delete(index);
    const idx = this.queue.indexOf(entry);
    if (idx >= 0) this.queue.splice(idx, 1);
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
