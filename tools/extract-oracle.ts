/**
 * `hcsb.hct`, the Hint Oracle's data, written out as JSON to be read by a person.
 *
 * Every hint with its title, its pages, the squares it applies on and the levels it
 * applies anywhere on, then the location table itself, in file order (the menu's order).
 * The fifteen zero records are left out: they would only match (0,0) of level 0, which
 * is stone (`doc/CSBWIN_HINT_ORACLE_REFERENCE.md`).
 *
 * Like `peek-dungeon.ts`, this is **not evidence** and asserts nothing, so it is not in
 * `tools/run-checks.mjs`; `tools/dump-hint-oracle.ts` checks the same decoding.
 *
 * Run: `npx tsx tools/extract-oracle.ts [hcsb.hct] [out.json]`
 * (default: `static/gamefiles/csb/hcsb.hct` into `static/gamefiles/csb-oracle-hints.json`)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { HINT_ANYWHERE, parseHintOracle } from '../src/data/HintOracleLoader';

const input = process.argv[2] ?? 'static/gamefiles/csb/hcsb.hct';
const output = process.argv[3] ?? 'static/gamefiles/csb-oracle-hints.json';

const oracle = parseHintOracle(new Uint8Array(readFileSync(resolve(input))));
const used = oracle.locations.filter((l) => !(l.x === 0 && l.y === 0 && l.level === 0 && l.hint === 0));
const anywhere = (l: { x: number; y: number }): boolean => l.x === HINT_ANYWHERE && l.y === HINT_ANYWHERE;

const out = {
    source: 'hcsb.hct, Chaos Strikes Back Hint Oracle (FTL), decoded per CSBWin Hint.cpp',
    match: 'a hint applies when the party is on (level, x, y), or anywhere on a level in wholeLevels; level/x/y are the save\'s partyLevel/partyX/partyY',
    hints: oracle.hints.map((h, id) => {
        const mine = used.filter((l) => l.hint === id);
        return {
            id,
            title: h.title,
            pages: h.pages,
            wholeLevels: mine.filter(anywhere).map((l) => l.level),
            squares: mine.filter((l) => !anywhere(l)).map(({ level, x, y }) => ({ level, x, y })),
        };
    }),
    locationTable: used.map((l) => [l.level, l.x, l.y, l.hint]),
};

/** JSON with a one-space indent, and an array of numbers or an object of scalars on one line. */
function format(value: unknown, indent = ''): string {
    const inner = indent + ' ';
    if (Array.isArray(value)) {
        if (value.length === 0) return '[]';
        if (value.every((v) => typeof v === 'number')) return `[ ${value.join(', ')} ]`;
        return `[\n${value.map((v) => inner + format(v, inner)).join(',\n')}\n${indent}]`;
    }
    if (value !== null && typeof value === 'object') {
        const entries = Object.entries(value);
        if (entries.every(([, v]) => v === null || typeof v !== 'object')) {
            return `{ ${entries.map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(', ')} }`;
        }
        return `{\n${entries.map(([k, v]) => `${inner}${JSON.stringify(k)}: ${format(v, inner)}`).join(',\n')}\n${indent}}`;
    }
    return JSON.stringify(value);
}

writeFileSync(resolve(output), format(out));
console.log(`${out.hints.length} hints, ${out.hints.reduce((n, h) => n + h.pages.length, 0)} pages, `
    + `${out.locationTable.length} locations -> ${output}`);
