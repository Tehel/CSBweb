/**
 * `QueueSound` — the engine's way of asking for a sound.
 *
 * Port of CSBWin's `QueueSound(soundNum, mapX, mapY, deltaTime)`
 * (`doc/CSBwin-src/CSBCode.cpp:1819`). The engine names sounds by **ordinal** into
 * `graphic232`'s sound table, not by raw SND item — `d.sound1772[soundNum]` — and
 * the table entry supplies the item number, the playback rate and the two distance
 * thresholds that decide how loud it is (or whether it plays at all). Every engine
 * sound goes through here; nothing in `src/engine/` names a SND item.
 *
 * CSBWin's sound is on `d.LoadedLevel`, the level its caller has loaded. The port loads
 * no level, so every caller passes it as `level`: a timer's own level for anything a
 * timer does (`ProcessTimers` loads it, `doc/CSBwin-src/CSBCode.cpp:6416-6417`), the
 * square's for a missile or a group, the party's for a mouse handler.
 *
 * Two parts of CSBWin's version are **not ported**:
 *
 * - `deltaTime > 1` schedules the sound as a `TT_20` timer rather than playing it
 *   (`doc/CSBwin-src/CSBCode.cpp:1832-1848`); here it plays immediately (`DEBT.md` C66).
 * - `SoundFilter` can hand the sound to a DSA instead (`doc/CSBwin-src/Sound.cpp:670`,
 *   `DEBT.md` G2).
 */
import type { SoundTableEntry } from '../renderer/csbwin/UITables';
import type { GameHost } from './GameHost';
import type { Party } from './Party';

export class SoundQueue {
  /**
   * @param soundTable `d.sound1772` — the sound table from `graphics.dat` item `0x232`.
   * @param host where a sample goes (`GameHost.playSound`).
   */
  constructor(
    private readonly party: Party,
    private readonly soundTable: ArrayLike<SoundTableEntry>,
    private readonly host: Pick<GameHost, 'playSound'>,
  ) {}

  /**
   * `QueueSound(ordinal, mapX, mapY, deltaTime)`, on `level`, CSBWin's `d.LoadedLevel`.
   *
   * A non-zero `deltaTime` means the sound is only audible when the loaded level is
   * the party's (`doc/CSBwin-src/CSBCode.cpp:1827-1830`). Volume comes from the
   * total *orthogonal* distance `|dx| + |dy|` compared against the entry's `byte6`
   * (fully loud at or below) and `byte7` (silent at or above).
   */
  queueSound(ordinal: number, mapX: number, mapY: number, deltaTime: number, level: number): void {
    const entry = this.soundTable[ordinal];
    if (!entry) return;

    if (deltaTime !== 0 && level !== this.party.state.position.z) return;

    const party = this.party.state.position;
    const distance = Math.abs(mapX - party.x) + Math.abs(mapY - party.y);
    if (distance >= (entry.byte7 & 0xff)) return; // CSBWin's LOCAL_12 = -1: inaudible

    const soundId = entry.word0 | 0;
    if (!soundId) return;
    // `rateIdx` selects among the decoded variants a SND item may have; it is not
    // CSBWin's `byte3` playback rate, which `StartSound` consumes inside the audio
    // layer (doc/CSBwin-src/Sound.cpp:647). Everything else in the port passes 0.
    this.host.playSound(soundId, 0, distance);
  }
}
