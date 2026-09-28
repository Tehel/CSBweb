import { SNDexpand } from '../core/compression';
import type { GraphicsLoader } from '../data/GraphicsLoader';
import { buildSoundCatalog, ratesDefault, type SoundInfo, type SoundTableEntry } from './soundsIndex';

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

  async unlock(): Promise<void> {
    if (!this.audioContext) return;
    if (this.audioContext.state !== 'suspended') return;
    await this.audioContext.resume();
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
   * `StartSound(SoundBytes, timerData, highVolume)` (`doc/CSBwin-src/Sound.cpp:647`): a
   * quiet sound, `highVolume` 0, is attenuated 18 times (`:663`). `QueueSound` decides
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

  setSoundTable(soundTable?: SoundTableEntry[]): void {
    this.soundCatalog = buildSoundCatalog(soundTable);
  }

  getSoundCatalog(): Record<number, SoundInfo> {
    return this.soundCatalog;
  }

}
