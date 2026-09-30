/**
 * `hcsb.hct`, the Hint Oracle's data, through `parseHintOracle`
 * (`src/data/HintOracleLoader.ts`; the format is in `doc/CSBWIN_HINT_ORACLE_REFERENCE.md`).
 *
 * It checks the file's own consistency (the chunks end where the file ends, a hint's
 * later chunks are empty), the two limits CSBWin's Oracle has (`f.Byte12792` holds 2240
 * bytes, the menu `MAXHINTINDICES` titles), and two known hints: the first record's pages,
 * and the menu on a square of level 0.
 *
 * Run: `npx tsx tools/dump-hint-oracle.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
    HINT_ANYWHERE, HINT_TEXT_BUFFER_SIZE, MAXHINTINDICES, hintsAtPosition, parseHintOracle,
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

finish();
