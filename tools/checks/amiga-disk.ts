/**
 * The Amiga 2.2 English program, `tools/fixtures/gamefiles/amiga-2.2/dm`: its tables sit
 * where `tools/lib/amigaDm.ts` says (`doc/AMIGA_DISK_REFERENCE.md` → "`dm`, the program").
 *
 * Each table's bytes, read at its offset in the data hunk, are the initializer of
 * ReDMCSB's A22E branch, parsed from `doc/ReDMCSB-src/` (`npm run fetch-redmcsb-src`): the
 * dungeon view's six palettes, the 34 sounds, the 27 creatures, the 11 creature attack
 * sounds and the 25x25 volume grid. The source is read through a small preprocessor that
 * keeps the lines a `MEDIA*` macro naming `A22E` guards, so that a table with a branch per
 * release is read as A22E's.
 *
 * Run: `npm test -- --only=amiga-disk.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { check, finish } from '../lib/check';
import { DM, DM_DATA_HUNK, DM_TABLES, dmHunks, dmTable } from '../lib/amigaDm';

const REDMCSB = 'doc/ReDMCSB-src';

/**
 * The lines `from`-`to` of a ReDMCSB file that A22E compiles, by their number. The range
 * must start outside any conditional. A `MEDIA*` `#ifdef` holds when its name has `A22E`
 * among its `_`-separated parts; `#ifndef NOCOPYPROTECTION` holds; any other conditional
 * met in compiled code is an error, so that nothing is guessed.
 */
function a22eLines(file: string, from: number, to: number): [number, string][] {
  const lines = readFileSync(resolve(REDMCSB, file), 'utf8').split('\n');
  const stack: boolean[] = [];
  const kept: [number, string][] = [];
  for (let n = from; n <= to; n++) {
    const line = lines[n - 1];
    const live = stack.every((on) => on);
    const directive = /^#\s*(\w+)\s*(\S*)/.exec(line);
    if (!directive) {
      if (live) kept.push([n, line]);
      continue;
    }
    const [, keyword, name] = directive;
    if (keyword === 'endif') stack.pop();
    else if (keyword === 'else') stack.push(!stack.pop());
    else if (keyword === 'ifdef' && name.startsWith('MEDIA')) stack.push(name.split('_').includes('A22E'));
    else if (keyword === 'ifndef' && name === 'NOCOPYPROTECTION') stack.push(true);
    else if (keyword === 'define' || keyword === 'include') { if (live) kept.push([n, line]); }
    else if (!live && (keyword === 'if' || keyword === 'ifdef' || keyword === 'ifndef')) stack.push(false);
    else throw new Error(`${file}:${n}: #${keyword} ${name} in A22E's code`);
  }
  if (stack.length !== 0) throw new Error(`${file}:${from}-${to} ends inside a conditional`);
  return kept;
}

/** The numbers of an initializer's data lines (a row in braces, or a list of numbers), comments aside. */
function initializerNumbers(lines: [number, string][]): number[][] {
  return lines
    .map(([, line]) => line.replace(/\/\*.*?\*\//g, '').trim())
    .filter((line) => /^(\{|0x|\d)/i.test(line))
    .map((line) => (line.match(/0x[0-9a-f]+|\d+/gi) ?? []).map(Number));
}

/** The values, packed big-endian into fields of the given byte sizes. */
function pack(values: number[], sizes: readonly number[]): number[] {
  if (values.length !== sizes.length) throw new Error(`${values.length} values for ${sizes.length} fields`);
  return values.flatMap((value, i) => (sizes[i] === 2 ? [(value >> 8) & 0xff, value & 0xff] : [value & 0xff]));
}

function compare(name: keyof typeof DM_TABLES, expected: number[], where: string): void {
  const bytes = [...dmTable(dm, name)];
  const first = bytes.findIndex((b, i) => b !== expected[i]);
  check(bytes.length === expected.length && first === -1,
    `${name} (data hunk +${DM_TABLES[name].offset}, ${bytes.length} bytes) is ${where}`
    + (first === -1 ? '' : `: byte ${first} is ${bytes[first]}, not ${expected[first]}`));
}

const dm = new Uint8Array(readFileSync(resolve(DM)));

function checkDm(): void {
  const version = Buffer.from(dm).indexOf('V2.2\0');
  console.log(`dm: ${dm.length} bytes, "V2.2" at file byte ${version}`);
  check(version >= 0, 'dm holds its version string, V2.2');
  const hunks = dmHunks(dm);
  const data = hunks[DM_DATA_HUNK];
  console.log(`dm: ${hunks.length} hunks; hunk ${DM_DATA_HUNK}: ${data.type}, ${data.storedSize} bytes stored at file byte ${data.fileOffset}, ${data.memorySize} in memory`);
  check(hunks.filter((h) => h.type === 'data').length === 1 && data.type === 'data', `hunk ${DM_DATA_HUNK} is the program's one data hunk`);

  const palettes = initializerNumbers(a22eLines('DATA.C', 832, 846)).flat();
  check(palettes.length === 96, 'DATA.C:833-845 gives 6 palettes of 16 colours');
  compare('dungeonViewPalettes', pack(palettes, palettes.map(() => 2)), "G0021_aaui_Graphic562_Palette_DungeonView, DATA.C:833-845");

  const sounds = initializerNumbers(a22eLines('DATA.C', 1156, 1202));
  check(sounds.length === 34, 'DATA.C:1165-1201 gives 34 SOUND_DATA');
  compare('sounds', sounds.flatMap((row) => pack(row, [2, 1, 1, 1, 1, 1, 1])), 'G0060_as_Graphic562_Sounds, DATA.C:1165-1201');

  const dungeon = a22eLines('DUNGEON.C', 438, 558);
  const creatures = initializerNumbers(dungeon.filter(([n]) => n <= 499));
  check(creatures.length === 27 && creatures.every((row, i) => row[0] === i), 'DUNGEON.C:439-499 gives the 27 creatures, in order');
  const creatureFields = [1, 1, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 1];
  const info = dmTable(dm, 'creatureInfo');
  // bUnreferenced, CREATURE_INFO's last byte, has no initializer: zero, as the compiler leaves it.
  compare('creatureInfo', creatures.flatMap((row) => [...pack(row, creatureFields), 0]), 'G0243_as_Graphic559_CreatureInfo, DUNGEON.C:439-499');
  console.log(`creatures' AttackSoundOrdinal: ${[...Array(27).keys()].map((i) => info[i * 26 + 1]).join(' ')}`);

  const defines = new Map(a22eLines('DEFS.H', 49, 133)
    .map(([, line]) => /^#define\s+(\w+)\s+(-?\d+)/.exec(line))
    .filter((m): m is RegExpExecArray => m !== null)
    .map(([, name, value]) => [name, Number(value)]));
  check(defines.get('M513_SOUND_COUNT') === 34, 'DEFS.H:56: A22E has 34 sounds');
  const attackNames = dungeon.filter(([n]) => n >= 500 && n <= 517).map(([, line]) => line.trim().replace(/[,}; ].*$/, '')).filter((name) => /_SOUND_/.test(name));
  const attackSounds = attackNames.map((name) => defines.get(name) ?? -1);
  check(attackSounds.length === 11 && !attackSounds.includes(-1), `DUNGEON.C:503-517 names 11 sounds DEFS.H defines: ${attackSounds.join(', ')}`);
  compare('creatureAttackSounds', attackSounds, 'G0244_auc_Graphic559_CreatureAttackSounds, DUNGEON.C:503-517');

  const volume = initializerNumbers(a22eLines('SOUND.C', 54, 110));
  check(volume.length === 25 && volume.every((row) => row.length === 25), 'SOUND.C:55-81 gives 25 rows of 25');
  compare('distanceToSoundVolume', volume.flat(), 'G1028_aauc_DistanceToSoundVolume, SOUND.C:55-81');
  check(volume[12][12] === 64 && volume[11][12] === 58 && volume[13][12] === 41 && volume[12][13] === 58 && volume[12][11] === 6,
    'the grid: 64 on the party\'s square, 58 a square ahead, 41 a square behind, 58 and 6 a square to one side');
}

function main(): void {
  checkDm();
  finish();
}

main();
