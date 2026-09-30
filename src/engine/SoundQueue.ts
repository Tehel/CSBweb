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
 * `deltaTime > 1` does not play the sound: it sets a `TT_20` timer, which
 * `TimerSystem` answers with `QueueSound(ordinal, x, y, 1)` on the timer's level.
 *
 * `SoundFilter`, which can hand the sound to a DSA instead
 * (`doc/CSBwin-src/Sound.cpp:670`), is **not ported** (`DEBT.md` G2).
 */
import type { SoundTableEntry } from '../data/tables/UITables';
import type { GameHost } from './GameHost';
import type { GameState } from './gameTypes';
import type { Party } from './Party';
import { TimerFunction, type TimerQueue } from './TimerQueue';

export class SoundQueue {
  /**
   * @param sound1772 `d.sound1772` — the sound table from `graphics.dat` item `0x232`.
   * @param host where a sample goes (`GameHost.playSound`).
   * @param state `state.tickCount` is `d.Time`, the clock a delayed sound is due by.
   * @param timers where a delayed sound's `TT_20` goes.
   */
  constructor(
    private readonly party: Party,
    private readonly sound1772: ArrayLike<SoundTableEntry>,
    private readonly host: Pick<GameHost, 'playSound'>,
    private readonly state: Pick<GameState, 'tickCount'>,
    private readonly timers: TimerQueue,
  ) {}

  /**
   * `QueueSound(ordinal, mapX, mapY, deltaTime)`, on `level`, CSBWin's `d.LoadedLevel`.
   *
   * A non-zero `deltaTime` means the sound is only audible when the loaded level is
   * the party's (`doc/CSBwin-src/CSBCode.cpp:1827-1830`). The volume, `LOCAL_12`, comes
   * from the total *orthogonal* distance `|dx| + |dy|` against the ordinal's own entry:
   * loud at or below `byte6`, quiet above it, silent at or above `byte7`
   * (`:1867-1878`). The host is handed that choice, not the distance (`:1894-1896`).
   */
  queueSound(ordinal: number, mapX: number, mapY: number, deltaTime: number, level: number): void {
    const entry = this.sound1772[ordinal];
    if (!entry) return;

    if (deltaTime !== 0 && level !== this.party.state.position.z) return;

    if (deltaTime > 1) {
      // `doc/CSBwin-src/CSBCode.cpp:1832-1848`: due at `d.Time + deltaTime - 1`, the
      // entry's `byte4` in `timerUByte5`, the ordinal in `timerWord8` (bytes 8-9).
      const time = (this.state.tickCount + (deltaTime & 0xffff) - 1) >>> 0;
      this.timers.createTimerWithUByte5(
        TimerFunction.TT_20, mapX, mapY, (ordinal >> 8) & 0xff, ordinal & 0xff, time, level,
        entry.byte4, undefined, ordinal,
      );
      return;
    }

    const party = this.party.state.position;
    const distance = Math.abs(mapX - party.x) + Math.abs(mapY - party.y);
    let highVolume = distance <= (entry.byte6 & 0xff) ? 1 : 0;
    if (distance >= (entry.byte7 & 0xff)) highVolume = -1;
    if (highVolume < 0) return;

    const soundId = entry.word0 | 0;
    if (!soundId) return;
    // `rateIdx` selects among the decoded variants a SND item may have; it is not
    // CSBWin's `byte3` playback rate, which `StartSound` consumes inside the audio
    // layer (doc/CSBwin-src/Sound.cpp:647). Everything else in the port passes 0.
    this.host.playSound(soundId, 0, highVolume);
  }
}
