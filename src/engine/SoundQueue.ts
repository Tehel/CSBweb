/**
 * `QueueSound` — the engine's way of asking for a sound.
 *
 * Port of CSBWin's `QueueSound(soundNum, mapX, mapY, deltaTime)`
 * (`doc/CSBwin-src/CSBCode.cpp:1819`). The engine names sounds by **ordinal** into
 * `graphic232`'s sound table, not by raw SND item — `d.sound1772[soundNum]` — and
 * the table entry supplies the item number, the playback rate and the two distance
 * thresholds that decide how loud it is (or whether it plays at all).
 *
 * This exists because the engine previously had two unrelated habits: passing raw
 * SND ids from `SoundIndex` straight through, and (in the renderer) resolving an
 * ordinal by hand. The monster code is written against ordinals throughout, so the
 * resolution belongs in one place.
 *
 * Two parts of CSBWin's version are **not ported**:
 *
 * - `deltaTime > 1` schedules the sound as a `TT_20` timer rather than playing it
 *   (`doc/CSBwin-src/CSBCode.cpp:1832-1848`); here it plays immediately.
 * - `SoundFilter` can hand the sound to a DSA instead (`doc/CSBwin-src/Sound.cpp:670`).
 *
 * Both are recorded in PLAN.md Phase 12.
 */
import type { SoundTableEntry } from '../renderer/csbwin/UITables';

export interface SoundQueueContext {
  /** `d.sound1772` — the sound table from `graphics.dat` item `0x232`. */
  soundTable?: ArrayLike<SoundTableEntry>;
  /** The party's map position, for the distance calculation. */
  getPartyPosition: () => { x: number; y: number; z: number };
  /** The level whose sounds are audible — CSBWin's `d.LoadedLevel`. */
  getLoadedLevel: () => number;
  play?: (soundId: number, rateIdx?: number, distance?: number) => void;
}

export class SoundQueue {
  constructor(private ctx: SoundQueueContext) {}

  setSoundTable(soundTable: ArrayLike<SoundTableEntry>): void {
    this.ctx.soundTable = soundTable;
  }

  /**
   * `QueueSound(ordinal, mapX, mapY, deltaTime)`.
   *
   * A non-zero `deltaTime` means the sound is only audible when the loaded level is
   * the party's (`doc/CSBwin-src/CSBCode.cpp:1827-1830`). Volume comes from the
   * total *orthogonal* distance `|dx| + |dy|` compared against the entry's `byte6`
   * (fully loud at or below) and `byte7` (silent at or above).
   */
  queueSound(ordinal: number, mapX: number, mapY: number, deltaTime: number): void {
    const play = this.ctx.play;
    if (!play) return;
    const entry = this.ctx.soundTable?.[ordinal];
    if (!entry) return;

    if (deltaTime !== 0 && this.ctx.getLoadedLevel() !== this.ctx.getPartyPosition().z) return;

    const party = this.ctx.getPartyPosition();
    const distance = Math.abs(mapX - party.x) + Math.abs(mapY - party.y);
    if (distance >= (entry.byte7 & 0xff)) return; // CSBWin's LOCAL_12 = -1: inaudible

    const soundId = entry.word0 | 0;
    if (!soundId) return;
    // `rateIdx` selects among the decoded variants a SND item may have; it is not
    // CSBWin's `byte3` playback rate, which `StartSound` consumes inside the audio
    // layer (doc/CSBwin-src/Sound.cpp:647). Everything else in the port passes 0.
    play(soundId, 0, distance);
  }
}
