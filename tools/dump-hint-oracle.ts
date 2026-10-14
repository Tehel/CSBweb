/**
 * `hcsb.hct` and `hcsb.dat`, the Hint Oracle's data, through `parseHintOracle` and
 * `parseHcsbDat` (`src/data/HintOracleLoader.ts`; the formats are in
 * `doc/CSBWIN_HINT_ORACLE_REFERENCE.md`).
 *
 * It checks the file's own consistency (the chunks end where the file ends, a hint's
 * later chunks are empty), the two limits CSBWin's Oracle has (`f.Byte12792` holds 2240
 * bytes, the menu `MAXHINTINDICES` titles), and two known hints: the first record's pages,
 * and the menu on a square of level 0.
 *
 * Of `hcsb.dat` it checks the four items' sizes, the two pictures' dimensions, every word
 * of item 0 that `Hint.cpp` reads, and two canaries: the font's glyphs sit where
 * `TAG004962` takes them, in the one ink item 0's word 8 names, and the backdrop's three
 * bottom buttons sit in `s20_16208`'s rectangles.
 *
 * Run: `npm test -- --only=dump-hint-oracle.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { GraphicsLoader } from '../src/data/GraphicsLoader';
import {
    HINT_ANYWHERE, HINT_TEXT_BUFFER_SIZE, MAXHINTINDICES, hintsAtPosition, parseHcsbDat, parseHintOracle,
} from '../src/data/HintOracleLoader';
import { check, finish } from './lib/check';

const file = new Uint8Array(readFileSync(resolve('static/gamefiles/csb/hcsb.hct')));
const oracle = parseHintOracle(file);
const { locations, hints, chunkLengths } = oracle;

const pageCount = hints.reduce((n, h) => n + h.pages.length, 0);
console.log(`${locations.length} locations, ${hints.length} hints, ${pageCount} pages, ${chunkLengths.length} chunks`);
check(locations.length === 4663 && hints.length === 210 && chunkLengths.length === 492,
    'the three tables hold 4663, 210 and 492 records');

// The chunks run to the last byte: nothing is left over or missing.
const headerEnd = file.length - chunkLengths.reduce((n, l) => n + l, 0);
check(headerEnd === 34438, `the chunks start at byte 34438 (got ${headerEnd})`);

// One chunk per page, the pages all in the first: the others are empty.
let chunk = 0;
for (const [id, h] of hints.entries()) {
    check(h.chunk === chunk, `hint ${id} starts at chunk ${chunk} (got ${h.chunk})`);
    check(chunkLengths[h.chunk]! > 0, `hint ${id}'s first chunk has data`);
    for (let i = 1; i < h.pages.length; i++) check(chunkLengths[h.chunk + i] === 0, `hint ${id}'s chunk ${i} is empty`);
    check(h.pages.every((p) => p.length > 0), `hint ${id} has no empty page`);
    check(h.expandedLength <= HINT_TEXT_BUFFER_SIZE, `hint ${id} fits f.Byte12792 (${h.expandedLength} bytes)`);
    chunk += h.pages.length;
}
check(chunk === chunkLengths.length, 'the hints use every chunk');
console.log(`longest expanded hint: ${Math.max(...hints.map((h) => h.expandedLength))} of ${HINT_TEXT_BUFFER_SIZE} bytes`);

// Fifteen records are all zero, the last sixteen but one (one record of level 1 sits
// among them). CSBWin does not skip them, so they would match (0,0) of level 0: stone in
// the CSB dungeon, where no party stands.
const isZero = (l: { x: number; y: number; level: number; hint: number }): boolean =>
    l.x === 0 && l.y === 0 && l.level === 0 && l.hint === 0;
const zeros = locations.flatMap((l, i) => (isZero(l) ? [i] : []));
console.log(`zero records: ${zeros.join(' ')}`);
check(zeros.length === 15 && zeros[0] === 4647, 'fifteen zero records, from record 4647 on');
const used = locations.filter((l) => !isZero(l));
check(!used.some((l) => l.x === 0 && l.y === 0 && l.level === 0), 'no other record is (0,0) of level 0');
check(used.every((l) => (l.x === HINT_ANYWHERE) === (l.y === HINT_ANYWHERE)), 'x and y are 0xff together or not at all');
check(used.every((l) => l.level <= 9), 'every record is on levels 0-9');

// The menu shows MAXHINTINDICES titles; no square the party can stand on offers more.
let most = 0;
const squares = new Set(used.filter((l) => l.x !== HINT_ANYWHERE).map((l) => `${l.level},${l.x},${l.y}`));
for (const key of squares) {
    const [level, x, y] = key.split(',').map(Number) as [number, number, number];
    most = Math.max(most, hintsAtPosition(oracle, level, x, y).length);
}
console.log(`${squares.size} squares with a hint; the most hints on one square: ${most}`);
check(most <= MAXHINTINDICES, `no square offers more than ${MAXHINTINDICES} hints`);

// The first record, and the menu on one of its squares.
const first = hints[0]!;
console.log(`hint 0: ${first.title}`);
for (const page of first.pages) console.log(`  | ${page}`);
check(first.title === 'FULYA PIT' && first.pages.length === 3, 'hint 0 is FULYA PIT, three pages');
check(first.pages[1] === 'Throw the Corbum over the pit into the flame ring. You will need to destroy all four to foil Chaos\' plan.',
    'FULYA PIT\'s second page');
const menu = hintsAtPosition(oracle, 0, 3, 23);
console.log(`level 0 (3,23): ${menu.map((i) => hints[i]!.title).join(' / ')}`);
check(menu.join() === '197,178,0', 'level 0 (3,23) offers CREATURES, THE MAZE, FULYA PIT, in that order');

console.log('=== hcsb.dat ===');
const datFile = new Uint8Array(readFileSync(resolve('static/gamefiles/csb/hcsb.dat')));
const index = new GraphicsLoader().loadFromArray(datFile);
console.log(`items: ${index.entries.map((e) => `${e.compressedSize}/${e.decompressedSize}`).join(' ')}`);
check(index.itemCount === 4, 'four items');
check(index.entries.map((e) => e.decompressedSize).join() === '100,29146,1497,32', 'the items are 100, 29146, 1497 and 32 bytes');
check(index.entries.every((e) => e.compressedSize === e.decompressedSize), 'every item is stored, not compressed');
check(2 + 4 * index.itemCount + index.entries.reduce((n, e) => n + e.compressedSize, 0) === datFile.length,
    'the index and the items are the whole file');

const dat = parseHcsbDat(datFile);
const { segment1, backdrop, font, palette } = dat;
const hex = (w: number): string => w.toString(16).padStart(3, '0');
console.log(`segment1: ${segment1.map((w, i) => `${i}:${hex(w)}`).join(' ')}`);
console.log(`palette: ${palette.map(hex).join(' ')}`);
// Every word `Hint.cpp` reads, with its retail value (the reference doc's "Item 0").
const read: Array<[number, number]> = [
    [0, 2], [1, 0x620], [2, 1], [3, 0x770], [4, 1], [6, 9], [7, 10], [8, 9], [9, 3],
    [10, 1], [11, 1], [12, 2], [13, 6], [32, 10],
    [36, 0x310], [37, 0x300], [38, 0x410], [39, 0x400], [40, 0x510],
    [41, 0x500], [42, 0x510], [43, 0x400], [44, 0x410], [45, 0x300],
];
for (const [i, value] of read) check(segment1[i] === value, `item 0 word ${i} is ${hex(value)} (got ${hex(segment1[i]!)})`);
check(palette.every((w) => (w & 0xf888) === 0), 'the palette is sixteen Atari 0RGB words, three bits a component');

console.log(`backdrop ${backdrop.width}x${backdrop.height}, font ${font.width}x${font.height}`);
check(backdrop.width === 320 && backdrop.height === 200, 'item 1 is 320x200');
check(font.width === 256 && font.height === 27, 'item 2 is 256x27, 3456 bytes at four bits a pixel');

// TAG004962 (`Hint.cpp:4138-4169`): character c is the 8x9 cell at
// (8 * ((c - 32) & 31), 9 * ((c - 32) / 32)), colour 12 transparent.
const TRANSPARENT = 12;
const glyph = (c: string): string[] => {
    const k = c.charCodeAt(0) - 32;
    const gx = 8 * (k & 31), gy = 9 * (k >> 5);
    return Array.from({ length: 9 }, (_, y) => Array.from({ length: 8 }, (_, x) => {
        const p = font.pixels[(gy + y) * font.width + gx + x]!;
        return p === TRANSPARENT ? '.' : '#';
    }).join(''));
};
const ink = new Set(font.pixels);
console.log(`font colours: ${[...ink].sort((a, b) => a - b).join(' ')}`);
// `TAG004a22_26(P1, word 10, word 8)` at load (`:4778-4780`) takes word 8 as the ink the
// font is drawn in: a word at the wrong offset would not name it.
check(ink.size === 2 && ink.has(TRANSPARENT) && ink.has(segment1[8]!), 'the font is drawn in colour 12 and item 0\'s word 8 alone');
check(glyph(' ').every((row) => row === '........'), 'the space is an empty cell');
const letterA = glyph('A');
for (const row of letterA) console.log(`  A | ${row}`);
check(letterA.join('/') === '.####.../...###../..##.#../..#####./.##...#./.##...##/####...#/......../........',
    '\'A\' is the cell at (8, 9)');
const blank = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789?'].filter((c) => glyph(c).every((row) => row === '........'));
check(blank.length === 0, `every letter, digit and '?' has a glyph (empty: ${blank.join('')})`);

// `s20_16208`'s bottom row (`Hint.cpp:546-568`): three buttons at x 33-100, 127-194 and
// 221-289, y 179-192. Each one's middle is the same colour, and the field above is not.
const at = (x: number, y: number): number => backdrop.pixels[y * backdrop.width + x]!;
const buttons = [[33, 100], [127, 194], [221, 289]].map(([x1, x2]) => at((x1! + x2!) >> 1, (179 + 192) >> 1));
console.log(`button middles: ${buttons.join(' ')}, field ${at(160, 100)}`);
check(buttons.every((c) => c === buttons[0]) && buttons[0] !== at(160, 100), 'the three bottom buttons are in the backdrop where s20_16208 puts them');

finish();
