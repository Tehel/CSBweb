import { amigaSoundSamples, SNDexpand } from '../core/compression';
import { div } from '../core/intCast';
import type { GraphicsLoader } from '../data/GraphicsLoader';
import { amigaSoundRate, buildSoundCatalog, ratesDefault, type SoundInfo } from './soundsIndex';
import {
  amigaSoundsByAtariItem, compareVolumes, type AmigaSoundData, type AmigaSoundTables, type SoundVolume,
} from '../data/tables/AmigaSoundTables';
import type { SoundTableEntry } from '../data/tables/UITables';

/** `SNDHEAD`'s `nSamplesPerSecond` in `SOUNDDATA::Decode` (`doc/CSBwin-src/Sound.cpp:343`). */
const CUSTOM_SOUND_RATE = 11025;

/**
 * The `Period` A22E plays the entrance's door rattle at, `F0060_SOUND_Play_CPSX(C02_SOUND_DOOR_RATTLE,
 * 145, 0x4040)` (ReDMCSB `ENTRANCE.C:160`): the Atari's second rate variant
 * (`timerDataToRateIndex`), the Atari's 145 too.
 */
const AMIGA_ENTRANCE_DOOR_PERIOD = 145;

/** Both channels at Paula's full volume, the `0x4040` of A22E's direct `F0060_SOUND_Play_CPSX` (`ENTRANCE.C:160`). */
const AMIGA_FULL_VOLUME: SoundVolume = { left: 64, right: 64 };
/** CSBWin's quiet sound, a DSA's `&SOUND` at volume 0, 18 times quieter (`doc/CSBwin-src/Sound.cpp:668`), on both channels. */
const AMIGA_QUIET_VOLUME: SoundVolume = { left: 64 / 18, right: 64 / 18 };

/** One of A22E's two voices, a pair of Paula's channels: the sound it plays and its volume. */
interface Voice {
  source: AudioBufferSourceNode | null;
  /** `G1024_as_SoundVolume[i]`, the volume of the sound it was last given. */
  volume: SoundVolume;
}

/**
 * `SOUNDDATA::Decode(volume)`'s samples (`doc/CSBwin-src/Sound.cpp:320-364`), without
 * DirectX: each unsigned 8-bit sample through the volume table, which divides its
 * distance from 128 by `volume`, rounded to the nearest, a half away from 128
 * (`:326-334`).
 */
export function soundDataDecode(sound: Uint8Array, volume: number): Uint8Array {
  const volTable = new Uint8Array(256);
  for (let i = 0; i < 128; i++) volTable[i] = div(i - 128 - div(volume, 2), volume) + 128;
  for (let i = 128; i < 256; i++) volTable[i] = div(i - 128 + div(volume, 2), volume) + 128;
  return sound.map((sample) => volTable[sample]!);
}

interface SoundVariant {
  name: string;
  rate: number;
  duration: number;
  buffer: AudioBuffer;
}

/** `count` samples at `rate`, each held until the next, at the context's own rate. */
function variant(
  context: AudioContext,
  name: string,
  rate: number,
  count: number,
  sample: (k: number) => number,
): SoundVariant {
  const rateTarget = context.sampleRate;
  const duration = count / rate;
  const sampleCount = Math.max(1, Math.floor(duration * rateTarget));
  const buffer = context.createBuffer(1, sampleCount, rateTarget);
  const channel = buffer.getChannelData(0);
  const factor = rateTarget / rate;
  for (let i = 0; i < sampleCount; i++) {
    const k = Math.floor(i / factor);
    channel[i] = k < count ? sample(k) : 0;
  }
  return { name, rate, duration, buffer };
}

export class SoundManager {
  private audioContext: AudioContext | null;
  private gainNode: GainNode | null = null;
  private cache = new Map<number, SoundVariant[]>();
  private enabled = true;
  private volume = 0.8;
  private soundCatalog: Record<number, SoundInfo> = buildSoundCatalog();
  private recordings = new Map<string, AudioBuffer>();
  /** The Amiga's sound for each Atari SND item, in a set that carries the table item. */
  private amigaSounds = new Map<number, AmigaSoundData>();
  /** The Amiga's tables, in a set that carries the table item. */
  private amigaTables: AmigaSoundTables | null = null;
  /** The Amiga's sounds by their graphic and period, as `playAmigaSound` plays them. */
  private amigaCache = new Map<string, SoundVariant>();
  /** `Sound1` and `Sound2`, A22E's two voices (ReDMCSB `EXEC.C:478-520`). */
  private readonly voices: [Voice, Voice] = [
    { source: null, volume: { left: 0, right: 0 } },
    { source: null, volume: { left: 0, right: 0 } },
  ];

  constructor(private graphics: GraphicsLoader) {
    const hasAudio = typeof globalThis !== 'undefined' && 'AudioContext' in globalThis;
    this.audioContext = hasAudio ? new AudioContext() : null;
    if (this.audioContext) {
      this.gainNode = this.audioContext.createGain();
      this.gainNode.gain.value = this.volume;
      this.gainNode.connect(this.audioContext.destination);
    }
  }

  isAvailable(): boolean {
    return this.audioContext !== null;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (this.gainNode) {
      this.gainNode.gain.value = enabled ? this.volume : 0;
    }
  }

  getVolume(): number {
    return this.volume;
  }

  setVolume(volume: number): void {
    const clamped = Math.max(0, Math.min(1, volume));
    this.volume = clamped;
    if (this.gainNode && this.enabled) {
      this.gainNode.gain.value = clamped;
    }
  }

  /**
   * Ask the browser to let the sound play, and say whether it does. Without a user
   * activation the context stays suspended, and `resume` may reject or never settle.
   */
  async unlock(): Promise<boolean> {
    if (!this.audioContext) return false;
    if (this.audioContext.state === 'suspended') await this.audioContext.resume().catch(() => undefined);
    return this.isRunning();
  }

  /** Whether the browser lets the sound play. */
  isRunning(): boolean {
    return this.audioContext?.state === 'running';
  }

  preloadAll(): void {
    for (const key of Object.keys(this.soundCatalog)) {
      const id = Number(key);
      const info = this.soundCatalog[id];
      if (!info) continue;
      this.preloadSound(id, info);
    }
  }

  /**
   * Item `id`'s variants, one per rate: the Atari's 4-bit sound at the port's rates (H), or
   * where the set has the Amiga's, its 8-bit recording at its entry's `Period`, then the
   * entrance door's.
   */
  preloadSound(id: number, info: SoundInfo): void {
    const context = this.audioContext;
    if (!context) return;
    if (this.cache.has(id)) return;

    const rates = info.rates ?? ratesDefault;
    const amiga = this.amigaSounds.get(id);
    const variants: SoundVariant[] = [];
    if (amiga) {
      rates.forEach((_, i) => {
        variants.push(this.amigaVariant(context, amiga.graphicIndex, i === 0 ? amiga.period : AMIGA_ENTRANCE_DOOR_PERIOD));
      });
    } else {
      const data = SNDexpand(this.graphics.getRawGraphic(id));
      for (const rate of rates) {
        variants.push(variant(context, `${info.name} (${rate} Hz)`, rate, data.length, (k) => (data[k]! - 127.5) / 127.5));
      }
    }
    this.cache.set(id, variants);
  }

  /** The Amiga's 8-bit recording in item `graphicIndex`, at Paula's `period`. */
  private amigaVariant(context: AudioContext, graphicIndex: number, period: number): SoundVariant {
    const key = `${graphicIndex}/${period}`;
    let found = this.amigaCache.get(key);
    if (!found) {
      const samples = amigaSoundSamples(this.graphics.getRawGraphic(graphicIndex));
      const rate = amigaSoundRate(period);
      found = variant(context, `Item ${graphicIndex} (Amiga, ${rate.toFixed(1)} Hz)`, rate, samples.length, (k) => samples[k]! / 128);
      this.amigaCache.set(key, found);
    }
    return found;
  }

  /**
   * A22E's `F0060_SOUND_Play_CPSX` (ReDMCSB `SOUND.C:1057-1114`): sound `soundIndex` of the
   * Amiga's table at `period`, on a voice. The first voice if it is free, else the second
   * if it is; with both busy, the second if the first's sound is the louder
   * (`compareVolumes`), else the first, whose sound stops (`ADCMD_FINISH`, its control
   * request without `ADIOF_SYNCCYCLE`, `EXEC.C:481`). Its left channel plays on the left,
   * its right on the right, each at its volume of Paula's 64.
   */
  playAmigaSound(soundIndex: number, period: number, volume: SoundVolume): void {
    if (!this.audioContext || !this.enabled) return;
    const sound = this.amigaTables?.sounds[soundIndex];
    if (!sound) return;
    this.playOnVoice(this.amigaVariant(this.audioContext, sound.graphicIndex, period).buffer, volume);
  }

  private playOnVoice(buffer: AudioBuffer, volume: SoundVolume): void {
    const context = this.audioContext;
    if (!context || !this.gainNode) return;
    const [voice1, voice2] = this.voices;
    let voice: Voice;
    if (!voice1.source) voice = voice1;
    else if (!voice2.source) voice = voice2;
    else voice = compareVolumes(voice1.volume, voice2.volume) === 1 ? voice2 : voice1;
    voice.volume = volume;
    voice.source?.stop();

    const source = context.createBufferSource();
    source.buffer = buffer;
    const merger = context.createChannelMerger(2);
    const left = context.createGain();
    const right = context.createGain();
    left.gain.value = volume.left / 64;
    right.gain.value = volume.right / 64;
    source.connect(left);
    source.connect(right);
    left.connect(merger, 0, 0);
    right.connect(merger, 0, 1);
    merger.connect(this.gainNode);
    // `CheckIO`: the voice is free once its sound has played out.
    source.onended = () => {
      if (voice.source === source) voice.source = null;
    };
    voice.source = source;
    source.start();
  }

  /**
   * `StartSound(SoundBytes, timerData, highVolume)` (`doc/CSBwin-src/Sound.cpp:652`): a
   * quiet sound, `highVolume` 0, is attenuated 18 times (`:668`). `QueueSound` decides
   * which from its ordinal's table entry; a direct `StartSound` plays loud. In a set with
   * the Amiga's sounds it is A22E's direct `F0060_SOUND_Play_CPSX`, on a voice at full
   * volume (`playOnVoice`); `QueueSound`'s sounds go to `playAmigaSound`, which places them.
   */
  playSound(id: number, rateIdx = 0, highVolume = 1): void {
    if (!this.audioContext) return;
    if (!this.enabled) return;

    if (!this.cache.has(id)) {
      const info = this.soundCatalog[id] ?? { name: `Sound ${id}` };
      this.preloadSound(id, info);
    }

    const variants = this.cache.get(id);
    const entry = variants?.[rateIdx];
    if (!entry) return;
    if (this.amigaSounds.has(id)) {
      this.playOnVoice(entry.buffer, highVolume === 0 ? AMIGA_QUIET_VOLUME : AMIGA_FULL_VOLUME);
      return;
    }

    const source = this.audioContext.createBufferSource();
    source.buffer = entry.buffer;
    if (!this.gainNode) return;
    const gain = this.audioContext.createGain();
    gain.gain.value = highVolume === 0 ? 1 / 18 : 1;
    source.connect(gain);
    gain.connect(this.gainNode);
    source.start();
  }

  /**
   * `PlayCustomSound`'s sound of `CSBgraphics.dat` (`doc/CSBwin-src/Sound.cpp:1064-1067`),
   * which plays nothing with the sound off: `Decode(volume)`'s samples (`soundDataDecode`)
   * at its 11025 Hz.
   */
  playCustomSound(sound: Uint8Array, volume: number): void {
    if (!this.audioContext || !this.gainNode || !this.enabled) return;
    if (sound.length === 0) return;
    const samples = soundDataDecode(sound, volume);
    const buffer = this.audioContext.createBuffer(1, samples.length, CUSTOM_SOUND_RATE);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) channel[i] = (samples[i]! - 128) / 128;
    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gainNode);
    source.start();
  }

  /**
   * A sound that is no `graphics.dat` sample but a recording, an audio file's bytes: the
   * FTL logo's swoosh, which the Atari played on its sound chip
   * (`doc/ATARI_ST_DISK_REFERENCE.md` → "The sound as PCM, and a recording of the logo").
   */
  async loadRecording(name: string, file: ArrayBuffer): Promise<void> {
    if (!this.audioContext) return;
    this.recordings.set(name, await this.audioContext.decodeAudioData(file));
  }

  /**
   * Play a recording now, or not at all: a context the browser still holds suspended
   * would keep the sound until the first click resumed it, and play it then.
   */
  playRecording(name: string): void {
    const buffer = this.recordings.get(name);
    if (!this.audioContext || !this.gainNode || !this.enabled || !buffer) return;
    if (this.audioContext.state !== 'running') return;
    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gainNode);
    source.start();
  }

  /** The set's sound table, and the Amiga's tables where its `graphics.dat` carries them. */
  setSoundTable(soundTable?: SoundTableEntry[], amiga?: AmigaSoundTables | null): void {
    this.soundCatalog = buildSoundCatalog(soundTable);
    this.amigaTables = soundTable && amiga ? amiga : null;
    this.amigaSounds = soundTable && amiga ? amigaSoundsByAtariItem(soundTable, amiga) : new Map();
    this.cache.clear();
    this.amigaCache.clear();
  }

  getSoundCatalog(): Record<number, SoundInfo> {
    return this.soundCatalog;
  }

}
