/**
 * The `dm-amiga` set plays the Amiga's 8-bit sounds at their Paula rate
 * (`doc/AMIGA_DISK_REFERENCE.md` → "The sounds, played"):
 *
 * - its `graphics.dat` carries the table item, 598, and `dm-atari`'s does not;
 * - each of the 34 sounds the table names is a word, then the samples: A22E plays the
 *   item's length less 2 bytes from its third (`F0503_SOUND_LoadAll`, ReDMCSB
 *   `SOUND.C:1433-1446`), and the word, which it never reads, is 2 to 4 less than the
 *   item's length in all 34;
 * - a sound plays at PAL `3546895 / trunc(72800 / Period)` Hz (`SOUND.C:1107`): 112 at
 *   5456.8, 138 at 6730.4, 150 at 7313.2, and the entrance door's 145 at 7065.5
 *   (`ENTRANCE.C:160`);
 * - the Atari's 21 SND items each map, through the 22 ordinals the two tables share, to
 *   the built item holding the Amiga's recording of it, at its entry's period: 112 for all
 *   but the wall bump's, ordinal 18, at 138;
 * - the port's `SoundManager`, on an `AudioContext` that records what it is handed, plays
 *   those recordings, signed, for a set with the table, and the Atari's 4-bit sounds at
 *   their rates (`doc/PROVEN_FACTS.md` → "Audio sample rates") for one without.
 *
 * Run: `npm test -- --only=amiga-sounds.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { SoundManager } from '../../src/audio/SoundManager';
import { amigaSoundRate } from '../../src/audio/soundsIndex';
import { SoundIndex } from '../../src/core/constants';
import { amigaSoundSamples, SNDexpand } from '../../src/core/compression';
import { GraphicsLoader } from '../../src/data/GraphicsLoader';
import { AMIGA_SOUND_COUNT, amigaSoundsByAtariItem } from '../../src/data/tables/AmigaSoundTables';
import { check, finish } from '../lib/check';
import { gameTablesOf, stockGraphics } from '../lib/game';

const AMIGA = 'tools/fixtures/gamefiles/dm-amiga/graphics.dat';
/** The context's rate, the one Chrome gives on most machines. */
const CONTEXT_RATE = 48000;
/** Where the built file holds the Amiga's recordings of the Atari's 533-555 (`amiga-graphics.ts`). */
const AMIGA_RECORDINGS = 563;

/** An `AudioContext` that hands back every buffer a source is started with. */
class RecordingContext {
  readonly sampleRate = CONTEXT_RATE;
  readonly destination = {};
  readonly state = 'running';
  readonly started: { length: number; sampleRate: number; data: Float32Array }[] = [];
  createGain() {
    return { gain: { value: 1 }, connect: () => undefined };
  }
  createBuffer(_channels: number, length: number, sampleRate: number) {
    const data = new Float32Array(length);
    return { length, sampleRate, data, getChannelData: () => data };
  }
  createBufferSource() {
    const started = this.started;
    return {
      buffer: null as null | { length: number; sampleRate: number; data: Float32Array },
      connect: () => undefined,
      start() {
        if (this.buffer) started.push(this.buffer);
      },
    };
  }
}

const hz = (rate: number) => rate.toFixed(1);

function main(): void {
  const graphics = new GraphicsLoader();
  graphics.loadFromArray(new Uint8Array(readFileSync(resolve(AMIGA))));
  const tables = gameTablesOf(graphics);
  const atari = gameTablesOf(stockGraphics());
  check(atari.amigaSounds === null, 'dm-atari\'s graphics.dat carries no table item');
  const amiga = tables.amigaSounds;
  check(amiga !== null && amiga.sounds.length === AMIGA_SOUND_COUNT, 'dm-amiga\'s carries one, its 34 sounds');
  if (!amiga) return finish();

  // The 34 sounds, decoded.
  console.log('ordinal item bytes word period paula Hz ms min max');
  let headersFit = true;
  let samplesFit = true;
  for (const [ordinal, sound] of amiga.sounds.entries()) {
    const raw = graphics.getRawGraphic(sound.graphicIndex);
    const word = (raw[0]! << 8) | raw[1]!;
    const samples = amigaSoundSamples(raw);
    const rate = amigaSoundRate(sound.period);
    let min = 0;
    let max = 0;
    for (const s of samples) { min = Math.min(min, s); max = Math.max(max, s); }
    console.log(`${ordinal} ${sound.graphicIndex} ${raw.length} ${word} ${sound.period} ${Math.trunc(72800 / sound.period)} `
      + `${hz(rate)} ${Math.round((samples.length / rate) * 1000)} ${min} ${max}`);
    if (word < raw.length - 4 || word > raw.length - 2) headersFit = false;
    if (samples.length !== raw.length - 2 || samples.some((s, k) => s !== ((raw[k + 2]! << 24) >> 24))) samplesFit = false;
  }
  check(headersFit, 'each of the 34 items begins with a word 2 to 4 less than its length');
  check(samplesFit, 'each decodes to its length less 2 samples, its bytes from the third, signed');

  check(hz(amigaSoundRate(112)) === '5456.8' && hz(amigaSoundRate(138)) === '6730.4' && hz(amigaSoundRate(150)) === '7313.2'
    && hz(amigaSoundRate(145)) === '7065.5', 'the periods 112, 138, 150 and 145 play at 5456.8, 6730.4, 7313.2 and 7065.5 Hz');

  // The Atari's items, mapped.
  const byItem = amigaSoundsByAtariItem(tables.sound1772, amiga);
  console.log('Atari item -> Amiga item, period: '
    + [...byItem].map(([item, s]) => `${item} -> ${s.graphicIndex} ${s.period}`).join(', '));
  check(byItem.size === 21 && [...byItem].every(([item, s]) => s.graphicIndex === AMIGA_RECORDINGS + item - 533),
    'the Atari\'s 21 SND items each map to the Amiga\'s recording of it, built item 563 + (item - 533)');
  check(tables.sound1772.every((entry, ordinal) => byItem.get(entry.word0) === amiga.sounds[ordinal]
    || (byItem.get(entry.word0)?.graphicIndex === amiga.sounds[ordinal]!.graphicIndex
      && byItem.get(entry.word0)?.period === amiga.sounds[ordinal]!.period)),
    'every one of the 22 ordinals plays through the map what the Amiga\'s entry names, 5 and 20 alike');
  check([...byItem].every(([item, s]) => s.period === (item === SoundIndex.WALL_BUMP ? 138 : 112)),
    'every sound plays at period 112 but the wall bump\'s, ordinal 18, at 138');

  // The SoundManager, on both sets.
  const context = new RecordingContext();
  (globalThis as { AudioContext?: unknown }).AudioContext = function () { return context; };
  const manager = new SoundManager(graphics);
  manager.setSoundTable(tables.sound1772, amiga);
  const wallBump = graphics.getRawGraphic(byItem.get(SoundIndex.WALL_BUMP)!.graphicIndex);
  manager.playSound(SoundIndex.WALL_BUMP);
  const bump = context.started.at(-1)!;
  const bumpLength = Math.floor(((wallBump.length - 2) / amigaSoundRate(138)) * CONTEXT_RATE);
  console.log(`dm-amiga's wall bump: ${bump.length} samples at ${bump.sampleRate} Hz, starting ${[...bump.data.subarray(0, 4)].join(' ')}`);
  check(bump.length === bumpLength && bump.data[0] === ((wallBump[2]! << 24) >> 24) / 128,
    `dm-amiga's wall bump plays the Amiga's ${wallBump.length - 2} samples at 6730.4 Hz, signed`);
  manager.playSound(SoundIndex.DOOR, 1);
  const door = context.started.at(-1)!;
  const doorSamples = graphics.getRawGraphic(byItem.get(SoundIndex.DOOR)!.graphicIndex).length - 2;
  check(door.length === Math.floor((doorSamples / amigaSoundRate(145)) * CONTEXT_RATE),
    'dm-amiga\'s entrance door, the second variant, plays the Amiga\'s rattle at 7065.5 Hz');

  const stock = stockGraphics();
  const atariManager = new SoundManager(stock);
  atariManager.setSoundTable(atari.sound1772, atari.amigaSounds);
  atariManager.playSound(SoundIndex.WALL_BUMP);
  const atariBump = context.started.at(-1)!;
  const atariSamples = SNDexpand(stock.getRawGraphic(SoundIndex.WALL_BUMP)).length;
  console.log(`dm-atari's wall bump: ${atariBump.length} samples at ${atariBump.sampleRate} Hz`);
  check(atariBump.length === Math.floor((atariSamples / 5486) * CONTEXT_RATE),
    `dm-atari's wall bump plays its ${atariSamples} 4-bit samples at 5486 Hz`);
  finish();
}

main();
