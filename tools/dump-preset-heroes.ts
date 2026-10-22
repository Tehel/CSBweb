/**
 * The heroes behind every data set's mirrors, read as `AddCharacter` reads them
 * (`doc/CSBwin-src/Character.cpp:536-702`): the first `dbTEXT` in the cell the mirror faces,
 * through `DecodeText(…, 0x8002, 990)` with the data set's own escape tables, then the
 * hero text's checks, with `legalHero` in place of a text that fails one.
 *
 * Checks:
 * - every hero of the shipped sets is legal, and DM has its 24. Conflux 3.5 is the
 *   exception: 249 of its 307 portraits face a square with no hero text, most of them
 *   none at all and the rest a message such as "ENTER THE WELL AND SAVE THE CITY", and
 *   58 are heroes;
 * - SYRA's French title is "L}ENFANT DE SAUVAGE": `%H` is 1.3-fr's `d.Byte10016` entry
 *   H, "}", and the title is nineteen characters, the most a title may have;
 * - the limits, on hero texts built to meet and to pass them;
 * - a mirror click in the 1.3-fr game recruits SYRA with that title, so the engine reads
 *   the text the same way.
 *
 * `--out <file>` writes every set's heroes as JSON.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Position, type Direction } from '../src/core/types';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import type { PresetHero } from '../src/data/HeroExtractor';
import { readHeroText } from '../src/data/HeroExtractor';
import { check, finish } from './lib/check';
import { newGame, presetHeroesOf } from './lib/game';

const SETS = ['dm-atari', 'dm-atari-1.2', 'dm-atari-1.3-fr', 'dm-windows', 'csb', 'kids-dungeon-24', '3D2D1D', 'towers-of-chaos-3.3', 'conflux-3.5-b8'];
const DELTA_X = [0, 1, 0, -1];
const DELTA_Y = [-1, 0, 1, 0];

const outIndex = process.argv.indexOf('--out');
const out = outIndex >= 0 ? process.argv[outIndex + 1] : undefined;

const read = (set: string, file: string): Uint8Array =>
  new Uint8Array(readFileSync(resolve('tools/fixtures/gamefiles', set, file)));

function load(set: string) {
  const data = new DungeonLoader().loadDungeonDat(read(set, 'dungeon.dat'));
  const graphics = new GraphicsLoader();
  graphics.loadFromArray(read(set, 'graphics.dat'));
  return { data, graphics };
}

const all: Record<string, PresetHero[]> = {};
for (const set of SETS) {
  const { data, graphics } = load(set);
  const heroes = presetHeroesOf(data, graphics);
  all[set] = heroes;
  console.log(`${set}: ${heroes.length} heroes`);
  for (const h of heroes) {
    const at = `${h.location.map}:${h.location.x},${h.location.y}/${h.location.wall}`;
    console.log(`  ${String(h.portraitIndex).padStart(2)}  ${at.padEnd(12)} ${h.name.padEnd(7)} ${JSON.stringify(h.title).padEnd(22)}`
      + ` ${h.male ? 'M' : 'F'} ${h.health}/${h.stamina}/${h.mana} pen ${h.reincarnateAttributePenalty},${h.reincarnateStatPenalty}`
      + ` text ${h.textRecordIndex}${h.illegal ? '  ILLEGAL' : ''}`);
  }
  const illegal = heroes.filter((h) => h.illegal).length;
  if (set === 'conflux-3.5-b8') {
    check(heroes.length === 307 && illegal === 249, `${set}: 249 of 307 hero texts are illegal (${illegal} of ${heroes.length})`);
  } else {
    check(illegal === 0, `${set}: every hero text is legal`);
  }
}
check(all['dm-atari']!.length === 24, `dm-atari has 24 heroes (got ${all['dm-atari']!.length})`);

const syraFr = all['dm-atari-1.3-fr']!.find((h) => h.name === 'SYRA');
check(syraFr?.title === 'L}ENFANT DE SAUVAGE',
  `1.3-fr SYRA's title is "L}ENFANT DE SAUVAGE", nineteen characters (got ${JSON.stringify(syraFr?.title)})`);

// The limits (`Character.cpp:559`, `:581`, `:592-689`), on texts as `DecodeText` leaves them.
console.log('');
const text = (s: string): Uint8Array => Uint8Array.from(s + '\0', (c) => c.charCodeAt(0));
const hero = (name: string, title1: string, title2 = '', tail = 'CCCCCCCCCCCCCCCC'): Uint8Array =>
  text(`${name}\n${title1}\n${title2}\nF\nABAAABAAABAA\nCACACACACACACA\n${tail}`);
const cases: Array<[string, Uint8Array | null, string, string]> = [
  ['no text in the cell', null, 'BOGUS', 'ILLEGAL HERO'],
  ['a seven-letter name', hero('ABCDEFG', 'T'), 'ABCDEFG', 'T'],
  ['an eight-letter name', hero('ABCDEFGH', 'T'), 'BOGUS', 'ILLEGAL HERO'],
  ['a nineteen-letter title on two lines', hero('N', 'ABCDEFGHIJ', 'KLMNOPQRS'), 'N', 'ABCDEFGHIJKLMNOPQRS'],
  ['a twenty-letter title', hero('N', 'ABCDEFGHIJKLMNOPQRST'), 'BOGUS', 'ILLEGAL HERO'],
  ['a health past 999', text('N\nT\n\nM\nAPAAAEAAAEAA\nCACACACACACACA\nCCCCCCCCCCCCCCCC'), 'BOGUS', 'ILLEGAL HERO'],
  ['a gender neither M nor F', text('N\nT\n\nX\nAEAAAEAAAEAA\nCACACACACACACA\nCCCCCCCCCCCCCCCC'), 'BOGUS', 'ILLEGAL HERO'],
  ['a skill letter past R', hero('N', 'T', '', 'CCCCCCCCCCCCCCCS'), 'BOGUS', 'ILLEGAL HERO'],
  ['a skill line cut short', hero('N', 'T', '', 'CCCC'), 'BOGUS', 'ILLEGAL HERO'],
];
for (const [what, bytes, name, title] of cases) {
  const h = readHeroText(bytes);
  console.log(`${what.padEnd(38)} ${h.name.padEnd(8)} ${JSON.stringify(h.title)}`);
  check(h.name === name && h.title === title, `${what}: ${name} / ${title}`);
}
const bogus = readHeroText(null);
check(bogus.male && bogus.health === 0x11 && bogus.luck === 1 && bogus.skillLevels.every((l) => l === 2) && bogus.illegal,
  'legalHero: male, 17 health, attributes of 1, every skill at level 2');
const tail = readHeroText(hero('N', 'T', '', 'CCCCCCCCCCCCCCCCDEFAB'));
// `DecodeCharacterValue` shifts before it tests a letter, so "AB" cut short by the NUL is 0x10.
check(tail.reincarnateAttributePenalty === 3 && tail.reincarnateStatPenalty === 4 && tail.talents === 0x10,
  `after the skills: penalties 3 and 4, randomPoints skipped, talents "AB" cut short at the NUL as 0x10 (got ${tail.reincarnateAttributePenalty}, ${tail.reincarnateStatPenalty}, ${tail.talents})`);

// The engine reads the text at the click, from the party's cell, with the game's tables.
console.log('');
{
  const { data, graphics } = load('dm-atari-1.3-fr');
  const game = newGame(data, graphics);
  const syra = presetHeroesOf(data, graphics).find((h) => h.name === 'SYRA')!;
  const facing = (syra.location.wall + 2) & 3;
  const party = game.ctx.party.state;
  party.position = new Position(syra.location.x - DELTA_X[facing]!, syra.location.y - DELTA_Y[facing]!, syra.location.map);
  party.facing = facing as Direction;
  game.systems.mouse.handleWallClick();
  const recruit = party.champions[0];
  console.log(`a click on SYRA's mirror in 1.3-fr: ${recruit?.name} ${JSON.stringify(recruit?.title)}`);
  check(recruit?.name === 'SYRA' && recruit.title === 'L}ENFANT DE SAUVAGE', 'the mirror click recruits SYRA with the French title');
}

if (out) {
  writeFileSync(resolve(out), JSON.stringify(all, null, 2));
  console.log(`Wrote ${out}`);
}
finish();
