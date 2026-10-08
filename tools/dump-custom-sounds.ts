/**
 * The sounds of `CSBgraphics.dat` a DSA's `&SOUND` plays with a number from 0 up
 * (`PlayCustomSound`, `doc/CSBwin-src/Sound.cpp:1048-1071`), through
 * `SoundQueue.playCustomSound` on a game with each file here.
 *
 * 1. **Every `CGT_Sound` section plays** (`SOUNDDATA::ReadSound`, `:998-1034`): its bytes
 *    summed with the one before, the count at byte 40, the samples from 44. The canary is
 *    the header the sum leaves: a WAV file's, mono, 8-bit, at 11025 Hz, `Decode`'s rate
 *    (`:343`), and its `data` chunk's size the count. One section of each file, 705, has a
 *    `fact` chunk there instead, and plays its `data` chunk, after the `fact` one: a
 *    deliberate divergence from CSBWin, which plays the `fact` chunk's four bytes
 *    (`DEBT.md` H).
 * 2. **A section that is not there** plays nothing, "Cannot find Sound" the first time
 *    only (`:1012-1017`).
 * 3. **A section shorter than its count** plays nothing, "Sound too short" every time
 *    (`:1025-1029`).
 * 4. **The volume is `Decode`'s divisor**, 1 for a volume of 0 (`:1066`), and
 *    `soundDataDecode` its table (`:326-334`), wrapping to a byte as `(ui8)` does.
 *
 * Run: `npx tsx tools/dump-custom-sounds.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { soundDataDecode } from '../src/audio/SoundManager';
import { readU16LE, readU32LE } from '../src/core/bytes';
import { CSBGraphicType, CSBGraphicsLoader } from '../src/data/CSBGraphicsLoader';
import type { Game } from '../src/engine/Game';
import { check, finish } from './lib/check';
import { newGame, stockGraphics, stockDungeon } from './lib/game';

/** The two `CSBgraphics.dat` here, with how many sound sections each holds. */
const FILES: [string, number][] = [
  ['static/gamefiles/conflux-3.5-b8/CSBgraphics.dat', 611],
  ['static/gamefiles/dm-atari/CSBgraphics.dat', 618],
];

const ascii = (bytes: Uint8Array, from: number, to: number): string => String.fromCharCode(...bytes.subarray(from, to));

interface Scene {
  game: Game;
  /** `[sample count, volume]` of each sound handed to the host. */
  played: [number, number][];
  /** The samples of each sound handed to the host. */
  sounds: Uint8Array[];
  traced: string[];
}

const graphics = stockGraphics();
const data = stockDungeon();

function scene(): Scene {
  const played: [number, number][] = [];
  const sounds: Uint8Array[] = [];
  const traced: string[] = [];
  const game = newGame(data!, graphics, {
    playCustomSound: (sound, volume) => {
      played.push([sound.length, volume]);
      sounds.push(sound);
    },
    trace: (line) => traced.push(line),
  });
  return { game, played, sounds, traced };
}

/* ----------------------------- 1. every section ------------------------------------ */
for (const [file, expected] of FILES) {
  const loader = new CSBGraphicsLoader();
  loader.loadFromArray(new Uint8Array(readFileSync(resolve(file))));
  const { game, played, sounds, traced } = scene();
  // The section as `ReadSound` leaves it: the reader sums the bytes in place.
  let read: Uint8Array | null = null;
  game.ctx.sounds.csbGraphics = {
    readSection: (type, id, minimumSize) => (read = loader.readSection(type, id, minimumSize)),
  };
  let sections = 0;
  let wav = 0;
  const wrong: number[] = [];
  const fact: number[] = [];
  let factPlayed = '';
  for (let soundNum = 0; soundNum < 1024; soundNum++) {
    read = null;
    const before = played.length;
    game.ctx.sounds.playCustomSound(soundNum, 0);
    const bytes = read as Uint8Array | null;
    if (!bytes) continue;
    sections++;
    let count = readU32LE(bytes, 40);
    const header = ascii(bytes, 0, 4) + ascii(bytes, 8, 16);
    const format = `${readU16LE(bytes, 20)}/${readU16LE(bytes, 22)}/${readU32LE(bytes, 24)}/${readU16LE(bytes, 34)}`;
    if (header === 'RIFFWAVEfmt ' && format === '1/1/11025/8') {
      if (ascii(bytes, 36, 40) === 'data') wav++;
      else if (ascii(bytes, 36, 40) === 'fact' && count === 4 && ascii(bytes, 48, 52) === 'data') {
        // The `fact` chunk's four bytes, then the `data` chunk's header, then its samples.
        fact.push(soundNum);
        count = readU32LE(bytes, 52);
        const sound = sounds[before];
        factPlayed += `${soundNum}: ${count} samples from byte 56 of ${bytes.length}` +
          `${sound && sound.every((sample, i) => sample === bytes[56 + i]) ? ', played' : ', not played'}`;
      }
    }
    if (played.length !== before + 1 || played[before]![0] !== count || played[before]![1] !== 1) wrong.push(soundNum);
  }
  console.log(`1. ${file}: ${sections} sections, ${played.length} played, ${wav} a WAV's header and data, ` +
    `${fact.length} a WAV's with a fact chunk (${fact.join(' ')}); traced ${JSON.stringify(traced)}`);
  check(sections === expected, `${file}: its ${expected} sound sections`);
  check(wrong.length === 0, `${file}: each played whole, its count of samples at a divisor of 1 (wrong: ${wrong.join(' ')})`);
  check(wav === expected - 1 && fact.length === 1, `${file}: every section a WAV file once summed, one with a fact chunk`);
  console.log(`   ${factPlayed}`);
  check(factPlayed === '705: 4574 samples from byte 56 of 4630, played',
    `${file}: sound 705 plays its data chunk's 4574 samples, not its fact chunk's 4 bytes`);
  check(JSON.stringify(traced) === '["Cannot find Sound"]', `${file}: the numbers with no section said once`);
}

/* ----------------------------- 2. a section not there ------------------------------ */
{
  const loader = new CSBGraphicsLoader();
  loader.loadFromArray(new Uint8Array(readFileSync(resolve(FILES[0]![0]))));
  const { game, played, traced } = scene();
  game.ctx.sounds.csbGraphics = loader;
  game.ctx.sounds.playCustomSound(0, 5);
  game.ctx.sounds.playCustomSound(219, 5);
  console.log(`2. sounds 0 and 219: played ${played.length}; traced ${JSON.stringify(traced)}`);
  check(played.length === 0 && JSON.stringify(traced) === '["Cannot find Sound"]', 'a missing sound plays nothing, said once');
}

/* ----------------------------- 3. a section too short ------------------------------ */
{
  const { game, played, traced } = scene();
  // 48 bytes summing to a count of 5 at byte 40: four samples follow it.
  game.ctx.sounds.csbGraphics = {
    readSection: (type) => {
      const bytes = new Uint8Array(48);
      bytes[40] = 5;
      bytes[41] = 0x100 - 5;
      return type === CSBGraphicType.Sound ? bytes : null;
    },
  };
  game.ctx.sounds.playCustomSound(3, 5);
  game.ctx.sounds.playCustomSound(3, 5);
  console.log(`3. a count of 5 over 4 samples: played ${played.length}; traced ${JSON.stringify(traced)}`);
  check(played.length === 0 && JSON.stringify(traced) === '["Sound too short","Sound too short"]',
    'a short sound plays nothing, said every time');
}

/* ----------------------------- 4. the volume --------------------------------------- */
{
  const { game, played } = scene();
  game.ctx.sounds.csbGraphics = {
    readSection: () => {
      const bytes = new Uint8Array(46);
      bytes[40] = 2;
      bytes[41] = 0x100 - 2;
      return bytes;
    },
  };
  for (const volume of [0, 1, 5, -3]) game.ctx.sounds.playCustomSound(0, volume);
  console.log(`4. volumes 0 1 5 -3 give divisors ${played.map(([, volume]) => volume).join(' ')}`);
  check(JSON.stringify(played) === '[[2,1],[2,1],[2,5],[2,-3]]', 'the volume is the divisor, 1 for 0');

  const all = Uint8Array.from({ length: 256 }, (_, i) => i);
  const one = soundDataDecode(all, 1);
  const two = soundDataDecode(all, 2);
  const eighteen = soundDataDecode(all, 18);
  const minusOne = soundDataDecode(all, -1);
  const at = (table: Uint8Array) => [0, 1, 127, 128, 129, 255].map((i) => table[i]).join(' ');
  console.log(`   Decode at 0 1 127 128 129 255: /2 ${at(two)}; /18 ${at(eighteen)}; /-1 ${at(minusOne)}`);
  check(one.every((sample, i) => sample === i), 'a divisor of 1 keeps every sample');
  check(at(two) === '64 64 127 128 129 192', 'a divisor of 2 halves the distance from 128, a half away from it');
  check(at(eighteen) === '121 121 128 128 128 135', 'a divisor of 18');
  check(at(minusOne) === '0 255 129 128 127 1', 'a divisor of -1 turns the wave over, wrapping 0 to a byte');
}

finish();
