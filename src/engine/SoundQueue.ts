/**
 * `QueueSound` — the engine's way of asking for a sound.
 *
 * Port of CSBWin's `QueueSound(soundNum, mapX, mapY, deltaTime)`
 * (`doc/CSBwin-src/CSBCode.cpp:1848`). The engine names sounds by **ordinal** into
 * `graphic232`'s sound table, not by raw SND item — `d.sound1772[soundNum]` — and
 * the table entry supplies the item number, the playback rate and the two distance
 * thresholds that decide how loud it is (or whether it plays at all). Every engine
 * sound goes through here; nothing in `src/engine/` names a SND item.
 *
 * CSBWin's sound is on `d.LoadedLevel`, the level its caller has loaded. The port loads
 * no level, so every caller passes it as `level`: a timer's own level for anything a
 * timer does (`ProcessTimers` loads it, `doc/CSBwin-src/CSBCode.cpp:6475-6476`), the
 * square's for a missile or a group, the party's for a mouse handler.
 *
 * `deltaTime > 1` does not play the sound: it sets a `TT_20` timer, which
 * `TimerSystem` answers with `QueueSound(ordinal, x, y, 1)` on the timer's level.
 *
 * `SoundFilter` (`doc/CSBwin-src/Sound.cpp:675`) may hand the sound to the dungeon's DSAs
 * instead (`DsaSystem.soundFilter`).
 *
 * `PlayCustomSound`, a DSA's `&SOUND`, plays here too, at once and at no distance, a
 * sample of `graphics.dat` or a sound of `CSBgraphics.dat`.
 */
import { readU32LE } from '../core/bytes';
import { CSBGraphicType, type CSBGraphicsLoader } from '../data/CSBGraphicsLoader';
import type { SoundTableEntry } from '../data/tables/UITables';
import type { GameHost } from './GameHost';
import type { GameState } from './gameTypes';
import type { Party } from './Party';
import { TimerFunction, type TimerQueue } from './TimerQueue';

export class SoundQueue {
  /** `ReadSound`'s `firstTime`: "Cannot find Sound" is said once. */
  private customSoundMissingSaid = false;

  /**
   * `CSBgraphics.dat`, where `ReadSound` reads a sound numbered from 0. The page sets it
   * to its data set's; `null`, as a tool leaves it, is a data set without the file.
   */
  csbGraphics: Pick<CSBGraphicsLoader, 'readSection'> | null = null;

  /**
   * `SoundFilter(ordinal, highVolume, soundLocr)`, with the location as level, x and y:
   * `DsaSystem.soundFilter` once `Game` has one, 0 when a DSA took the sound. Until then,
   * and in a tool's context with no DSA system, 1, as for a dungeon with no filter.
   */
  soundFilter: (ordinal: number, highVolume: number, level: number, x: number, y: number) => number = () => 1;

  /**
   * @param sound1772 `d.sound1772` — the sound table from `graphics.dat` item `0x232`.
   * @param host where a sample goes (`GameHost.playSound`), and a sound of
   *   `CSBgraphics.dat` (`playCustomSound`), and `ReadSound`'s complaints (`trace`).
   * @param state `state.tickCount` is `d.Time`, the clock a delayed sound is due by.
   * @param timers where a delayed sound's `TT_20` goes.
   */
  constructor(
    private readonly party: Party,
    private readonly sound1772: ArrayLike<SoundTableEntry>,
    private readonly host: Pick<GameHost, 'playSound' | 'playCustomSound' | 'trace'>,
    private readonly state: Pick<GameState, 'tickCount'>,
    private readonly timers: TimerQueue,
  ) {}

  /**
   * `QueueSound(ordinal, mapX, mapY, deltaTime)`, on `level`, CSBWin's `d.LoadedLevel`.
   *
   * A non-zero `deltaTime` means the sound is only audible when the loaded level is
   * the party's (`doc/CSBwin-src/CSBCode.cpp:1856-1859`). The volume, `LOCAL_12`, comes
   * from the total *orthogonal* distance `|dx| + |dy|` against the ordinal's own entry:
   * loud at or below `byte6`, quiet above it, silent at or above `byte7`
   * (`:1896-1905`). The sound filter sees that choice, a silent sound included, and plays
   * nothing here if its DSAs took the sound (`:1906`). The host is handed the choice, not
   * the distance (`:1923-1925`).
   */
  queueSound(ordinal: number, mapX: number, mapY: number, deltaTime: number, level: number): void {
    const entry = this.sound1772[ordinal];
    if (!entry) return;

    if (deltaTime !== 0 && level !== this.party.state.position.z) return;

    if (deltaTime > 1) {
      // `doc/CSBwin-src/CSBCode.cpp:1861-1877`: due at `d.Time + deltaTime - 1`, the
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
    if (this.soundFilter(ordinal, highVolume, level, mapX, mapY) === 0) return;
    if (highVolume < 0) return;

    const soundId = entry.word0 | 0;
    if (!soundId) return;
    // `rateIdx` selects among the decoded variants a SND item may have; it is not
    // CSBWin's `byte3` playback rate, which `StartSound` consumes inside the audio
    // layer (doc/CSBwin-src/Sound.cpp:652). Everything else in the port passes 0.
    this.host.playSound(soundId, 0, highVolume);
  }

  /**
   * `PlayCustomSound(soundNum, volume, flags)` (`doc/CSBwin-src/Sound.cpp:1048-1069`), a
   * DSA's `&SOUND`. A negative number is `d.sound1772`'s entry `-soundNum - 1`, none past
   * the 22nd, played by `StartSound`, loud unless `volume` is 0 (`:652-672`). `flags` is
   * unused. A number from 0 up is a sound of `CSBgraphics.dat` (`readSound`), played
   * through `SOUNDDATA::Decode` with `volume` as its divisor, 1 for a volume of 0
   * (`:1066`). The game's volume and `NoSound` are the host's, which CSBWin checks
   * after the read, so a sound that cannot be read is said even with the sound off.
   */
  playCustomSound(soundNum: number, volume: number): void {
    if (soundNum < 0) {
      const ordinal = -soundNum - 1;
      if (ordinal > 21) return;
      const entry = this.sound1772[ordinal];
      if (!entry) return;
      this.host.playSound(entry.word0 | 0, 0, volume === 0 ? 0 : 1);
      return;
    }
    const sound = this.readSound(soundNum);
    if (!sound) return;
    this.host.playCustomSound(sound, volume ? volume : 1);
  }

  /**
   * `SOUNDDATA::ReadSound(soundNum)` (`doc/CSBwin-src/Sound.cpp:998-1034`): the
   * `CGT_Sound` section `soundNum`, of at least 44 bytes, each byte summed with the one
   * before it as that one now stands; the sample count is the word at byte 40, and the
   * samples follow from byte 44. Every such section of the two `CSBgraphics.dat` here is a
   * WAV file, its header included (`doc/PROVEN_FACTS.md` → "`CSBgraphics.dat`'s sounds are
   * WAV files, each byte stored as the change from the one before"). `null` for a section
   * that cannot be read, said the first time ("Cannot find Sound"), and for one shorter
   * than its count, said every time ("Sound too short").
   *
   * A deliberate divergence (`DEBT.md` H): the count and the samples are the `data`
   * chunk's, wherever a RIFF file's chunks put it (`wavDataChunk`). Bytes 40 and 44 are
   * that chunk's only after a 16-byte `fmt ` one, and sound 705, with a `fact` chunk
   * between them, would play that chunk's four bytes. A section that is not such a file
   * is read as CSBWin reads it.
   */
  private readSound(soundNum: number): Uint8Array | null {
    const fileData = this.csbGraphics?.readSection(CSBGraphicType.Sound, soundNum, 44) ?? null;
    if (!fileData) {
      if (this.customSoundMissingSaid) return null;
      this.customSoundMissingSaid = true;
      this.host.trace('Cannot find Sound');
      return null;
    }
    let prevByte = 0;
    for (let i = 0; i < fileData.length; i++) {
      const byte = (fileData[i]! + prevByte) & 0xff;
      fileData[i] = byte;
      prevByte = byte;
    }
    const [start, numSample] = wavDataChunk(fileData) ?? [44, readU32LE(fileData, 40)];
    if (numSample + start > fileData.length) {
      this.host.trace('Sound too short');
      return null;
    }
    return fileData.slice(start, start + numSample);
  }
}

/**
 * Where a RIFF `WAVE` file's first `data` chunk starts its bytes, and how many it holds:
 * the chunks walked from byte 12, each an id, a little-endian size and that many bytes,
 * padded to an even length. `null` for anything else, or a file whose chunks end first.
 */
function wavDataChunk(bytes: Uint8Array): [number, number] | null {
  const id = (at: number): string => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (id(0) !== 'RIFF' || id(8) !== 'WAVE') return null;
  for (let at = 12; at + 8 <= bytes.length;) {
    const size = readU32LE(bytes, at + 4);
    if (id(at) === 'data') return [at + 8, size];
    at += 8 + size + (size & 1);
  }
  return null;
}
