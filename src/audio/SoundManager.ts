import { SNDexpand } from '../core/compression';
import { div } from '../core/intCast';
import type { GraphicsLoader } from '../data/GraphicsLoader';
import { buildSoundCatalog, ratesDefault, type SoundInfo, type SoundTableEntry } from './soundsIndex';

/** `SNDHEAD`'s `nSamplesPerSecond` in `SOUNDDATA::Decode` (`doc/CSBwin-src/Sound.cpp:343`). */
const CUSTOM_SOUND_RATE = 11025;

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
  return sound.map((sample) => volTable[sample]);
}

interface SoundVariant {
  name: string;
  rate: number;
  duration: number;
  buffer: AudioBuffer;
}

export class SoundManager {
  private audioContext: AudioContext | null;
  private gainNode: GainNode | null = null;
  private cache = new Map<number, SoundVariant[]>();
  private enabled = true;
  private volume = 0.8;
  private soundCatalog: Record<number, SoundInfo> = buildSoundCatalog();
  private recordings = new Map<string, AudioBuffer>();

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

  preloadSound(id: number, info: SoundInfo): void {
    if (!this.audioContext) return;
    if (this.cache.has(id)) return;

    const raw = this.graphics.getRawGraphic(id);
    const data = SNDexpand(raw);
    const rateTarget = this.audioContext.sampleRate;

    const variants: SoundVariant[] = [];
    for (const rate of info.rates ?? ratesDefault) {
      const duration = data.length / rate;
      const sampleCount = Math.max(1, Math.floor(duration * rateTarget));
      const buffer = this.audioContext.createBuffer(1, sampleCount, rateTarget);
      const channel = buffer.getChannelData(0);
      const factor = rateTarget / rate;
      for (let i = 0; i < sampleCount; i++) {
        const src = data[Math.floor(i / factor)] ?? 0;
        channel[i] = (src - 127.5) / 127.5;
      }

      const name = `${info.name} (${rate} Hz)`;
      variants.push({
        name,
        rate,
        duration,
        buffer,
      });
    }

    this.cache.set(id, variants);
  }

  /**
   * `StartSound(SoundBytes, timerData, highVolume)` (`doc/CSBwin-src/Sound.cpp:652`): a
   * quiet sound, `highVolume` 0, is attenuated 18 times (`:668`). `QueueSound` decides
   * which from its ordinal's table entry; a direct `StartSound` plays loud.
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
    for (let i = 0; i < samples.length; i++) channel[i] = (samples[i] - 128) / 128;
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

  setSoundTable(soundTable?: SoundTableEntry[]): void {
    this.soundCatalog = buildSoundCatalog(soundTable);
  }

  getSoundCatalog(): Record<number, SoundInfo> {
    return this.soundCatalog;
  }

}
