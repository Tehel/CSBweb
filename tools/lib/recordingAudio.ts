/**
 * An `AudioContext` that records what `SoundManager` hands it: each sound started, its
 * samples, and where its graph sends it, so a tool reads what the page would play.
 * `install` puts it in Node's `globalThis`, which has no `AudioContext` of its own.
 */

/** A sound a source was started with. */
export interface StartedSound {
  readonly length: number;
  readonly sampleRate: number;
  readonly data: Float32Array;
  /** The gain to the left channel and to the right, through a channel merger; `null` for a mono sound. */
  readonly left: number | null;
  readonly right: number | null;
  /** Whether it was stopped before it played out. */
  stopped: boolean;
  /** The sound played out: its source's `onended`. */
  end(): void;
}

interface RecordedBuffer {
  length: number;
  sampleRate: number;
  data: Float32Array;
}

interface Target {
  node: unknown;
  input: number;
}

class RecordingGain {
  readonly gain = { value: 1 };
  readonly targets: Target[] = [];
  connect(node: unknown, _output = 0, input = 0): void {
    this.targets.push({ node, input });
  }
}

class RecordingMerger {
  connect(): void {}
}

export class RecordingContext {
  readonly sampleRate = 48000;
  readonly destination = {};
  readonly state = 'running';
  readonly started: StartedSound[] = [];

  createGain(): RecordingGain {
    return new RecordingGain();
  }

  createChannelMerger(): RecordingMerger {
    return new RecordingMerger();
  }

  createBuffer(_channels: number, length: number, sampleRate: number) {
    const data = new Float32Array(length);
    return { length, sampleRate, data, getChannelData: () => data };
  }

  createBufferSource() {
    const started = this.started;
    const outputs: unknown[] = [];
    return {
      buffer: null as RecordedBuffer | null,
      onended: null as (() => void) | null,
      record: null as StartedSound | null,
      connect(node: unknown): void {
        outputs.push(node);
      },
      start(): void {
        if (!this.buffer) return;
        const channel = (input: number): number | null => {
          for (const node of outputs) {
            if (!(node instanceof RecordingGain)) continue;
            const target = node.targets.find((t) => t.node instanceof RecordingMerger && t.input === input);
            if (target) return node.gain.value;
          }
          return null;
        };
        const source = this;
        this.record = {
          ...this.buffer,
          left: channel(0),
          right: channel(1),
          stopped: false,
          end: () => source.onended?.(),
        };
        started.push(this.record);
      },
      stop(): void {
        if (this.record) this.record.stopped = true;
        this.onended?.();
      },
    };
  }
}

/** A `RecordingContext` that every `new AudioContext()` from here on returns. */
export function installRecordingContext(): RecordingContext {
  const context = new RecordingContext();
  (globalThis as { AudioContext?: unknown }).AudioContext = function () { return context; };
  return context;
}
