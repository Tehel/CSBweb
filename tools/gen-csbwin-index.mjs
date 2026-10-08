#!/usr/bin/env node
// Build doc/CSBWIN_SYMBOL_INDEX.tsv: every CSBWin symbol -> File.cpp:line.
//
// Why: doc/CSBwin-src/ is ~120k lines and is the authoritative spec, so every port
// starts with "where does CSBWin do X?". Grepping the tree, peeking at the hit, then
// peeking again to find the enclosing function is three round trips per lookup. One
// grep of this index is one.
//
//   npx tsx tools/gen-csbwin-index.mjs        (or: node tools/gen-csbwin-index.mjs)
//   grep -P '^ProcessMissileEncounter\t' doc/CSBWIN_SYMBOL_INDEX.tsv
//
// The index is derived from doc/CSBwin-src/; regenerate it if that tree changes.

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'doc/CSBwin-src');
const OUT = join(ROOT, 'doc/CSBWIN_SYMBOL_INDEX.tsv');

if (!existsSync(SRC)) {
  console.error(`No ${SRC}. Restore the C++ reference before indexing.`);
  process.exit(1);
}

const SOURCE_EXT = /\.(cpp|c|h|inl)$/;
// A leading return type, then either CLASS::name( or a bare name(.
const METHOD = /^([A-Za-z_][A-Za-z0-9_ \t*&:<>,]*?)\b([A-Za-z_][A-Za-z0-9_]*)::(~?[A-Za-z_][A-Za-z0-9_]*)\s*\(/;
const FUNCTION = /^([A-Za-z_][A-Za-z0-9_]*(?:\s*[*&]|\s+)[ \t*&]*)([A-Za-z_][A-Za-z0-9_]*)\s*\(/;
const TYPE = /^(class|struct|union)\s+([A-Za-z_][A-Za-z0-9_]*)/;
const DEFINE = /^#define\s+([A-Za-z_][A-Za-z0-9_]*)/;
const ENUM_OPEN = /\benum\b[^;]*$/;
const ENUM_MEMBER = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(=|,|$)/;
// Keywords that look like a return type but start a statement, not a definition.
const NOT_A_TYPE = new Set([
  'if', 'for', 'while', 'switch', 'return', 'else', 'do', 'case', 'sizeof',
  'typedef', 'extern', 'using', 'namespace', 'template', 'friend', 'operator',
]);

const rows = [];
const add = (symbol, kind, file, line, sig) =>
  rows.push([symbol, kind, `${file}:${line}`, sig.replace(/\s+/g, ' ').trim().slice(0, 160)]);

for (const file of readdirSync(SRC).filter((f) => SOURCE_EXT.test(f)).sort()) {
  const lines = readFileSync(join(SRC, file), 'latin1').split('\n');
  let inEnum = false;
  let enumDepth = 0;

  // A function-shaped line is a definition only if its parameter list is followed by
  // '{' rather than ';'. Signatures wrap over many lines (CSBWin comments each argument),
  // so walk the paren depth to the real end of the list, then read the next token.
  const opensABody = (i) => {
    let depth = 0;
    let seen = false;
    for (let j = i; j < Math.min(i + 60, lines.length); j++) {
      const l = lines[j].replace(/\/\/.*$/, '');
      for (const ch of l) {
        if (ch === '(') { depth++; seen = true; continue; }
        if (ch === ')') { depth--; continue; }
        if (!seen || depth > 0) continue;
        if (ch === '{') return true;
        if (ch === ';' || ch === ',') return false;
      }
    }
    return false;
  };

  lines.forEach((raw, i) => {
    const n = i + 1;
    const line = raw.replace(/\/\/.*$/, '').trimEnd();
    if (!line.trim()) return;

    // --- enum bodies: their constants (TT_*, atk_*, OBJNI_*) are what we grep for most
    if (!inEnum && ENUM_OPEN.test(line) && !/^\s*\/\*/.test(line)) {
      const m = line.match(/\benum\s+(?:class\s+)?([A-Za-z_][A-Za-z0-9_]*)?/);
      if (m?.[1]) add(m[1], 'enum', file, n, line);
      if (line.includes('{')) { inEnum = true; enumDepth = 1; }
      else if (!line.includes(';')) { inEnum = true; enumDepth = 0; }
      return;
    }
    if (inEnum) {
      if (enumDepth === 0 && line.includes('{')) enumDepth = 1;
      else if (line.includes('}')) { inEnum = false; enumDepth = 0; return; }
      const m = line.match(ENUM_MEMBER);
      if (m && enumDepth === 1) add(m[1], 'enumerator', file, n, line.trim());
      return;
    }

    if (raw[0] === '#') {
      const m = line.match(DEFINE);
      if (m) add(m[1], 'define', file, n, line);
      return;
    }

    // Definitions live at column 0; anything indented is a body or a member.
    if (/^\s/.test(raw)) return;

    const t = line.match(TYPE);
    if (t) { add(t[2], t[1], file, n, line); return; }

    const m = line.match(METHOD);
    if (m && !NOT_A_TYPE.has(m[1].trim().split(/\s+/)[0])) {
      const kind = opensABody(i) ? 'method' : 'prototype';
      add(`${m[2]}::${m[3]}`, kind, file, n, line);
      add(m[3], kind, file, n, line); // also findable by bare name
      return;
    }

    const f = line.match(FUNCTION);
    if (f) {
      const first = f[1].trim().split(/[\s*&]+/)[0];
      if (NOT_A_TYPE.has(first) || NOT_A_TYPE.has(f[2])) return;
      // Prototypes are still worth indexing, just ranked below the real definition.
      add(f[2], opensABody(i) ? 'function' : 'prototype', file, n, line);
    }
  });
}

// Definitions before prototypes, so the first grep hit is the real one.
const RANK = { function: 0, method: 0, class: 1, struct: 1, union: 1, enum: 2, enumerator: 3, define: 4, prototype: 5 };
rows.sort((a, b) => a[0].localeCompare(b[0]) || (RANK[a[1]] ?? 9) - (RANK[b[1]] ?? 9) || a[2].localeCompare(b[2]));

const header = [
  '# CSBWin symbol index — generated by tools/gen-csbwin-index.mjs, do not edit.',
  `# ${rows.length} symbols from doc/CSBwin-src/ (CSBWin 20230608). Columns: symbol, kind, file:line, signature.`,
  '# Definitions sort before prototypes, so the first hit for a name is the real one.',
  "# Lookup:  grep -P '^SummarizeRoomInfo\\t' doc/CSBWIN_SYMBOL_INDEX.tsv",
].join('\n');

writeFileSync(OUT, `${header}\n${rows.map((r) => r.join('\t')).join('\n')}\n`);

const byKind = rows.reduce((a, r) => ((a[r[1]] = (a[r[1]] ?? 0) + 1), a), {});
console.log(`${OUT}: ${rows.length} symbols`);
for (const [k, v] of Object.entries(byKind).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(11)} ${v}`);
