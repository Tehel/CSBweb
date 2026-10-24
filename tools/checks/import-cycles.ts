/**
 * No value-import cycle in `src/`, and no value import up from its two bottom layers.
 *
 * A module that imports a value from a module that imports one back works only while
 * neither reads the other's value at load time: which of the two loads first depends on
 * the entry point (a tool entering at `MonsterAttack` rather than `Game`), and a table
 * built at one's top level would then read the other's `undefined`. Type-only imports
 * vanish from the JavaScript (`isolatedModules`), so only the value edges count: an
 * `import` or `export … from` that names a value, or a module for its side effects.
 *
 * The tool reads every `.ts` file under `src/`, draws each value edge between two of
 * them, and fails on every strongly connected set of more than one module, printing it.
 *
 * And on every value edge up from the layers the rest stands on: `src/core/` imports a
 * value only from itself, and `src/data/`, the readers, only from itself and `core`, never
 * from the engine that runs what they read. A type may still name the engine's shapes
 * (`Champion`), since it vanishes from the JavaScript.
 *
 * Run: `npm test -- --only=import-cycles.ts`
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { check, finish } from '../lib/check';

const SRC = resolve('src');

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sources(path));
    else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) out.push(path);
  }
  return out;
}

/** The module a relative specifier names, or null for a package or a non-module file. */
function resolveSpecifier(from: string, spec: string, known: Set<string>): string | null {
  if (!spec.startsWith('.')) return null;
  const base = resolve(dirname(from), spec.replace(/\?.*$/, ''));
  for (const path of [base, `${base}.ts`, join(base, 'index.ts')]) if (known.has(path)) return path;
  return null;
}

/** Whether an import clause brings in any value: not `import type`, nor all `type` names. */
function namesAValue(clause: string): boolean {
  const c = clause.trim();
  if (c.startsWith('type ')) return false;
  const braces = c.match(/\{([^}]*)\}/);
  const outside = c.replace(/\{[^}]*\}/, '').replace(/,/g, '').trim();
  // A default or namespace import is a value.
  if (outside.length > 0) return true;
  if (!braces) return true;
  const names = braces[1]!.split(',').map((n) => n.trim()).filter((n) => n.length > 0);
  return names.some((n) => !n.startsWith('type '));
}

/** The value edges of one file. */
function valueEdges(path: string, known: Set<string>): string[] {
  // Comments out first, so that an import quoted in a comment draws no edge.
  const text = readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const out: string[] = [];
  const add = (spec: string): void => {
    const to = resolveSpecifier(path, spec, known);
    if (to && to !== path) out.push(to);
  };
  for (const m of text.matchAll(/^\s*(import|export)\s+([^'";]*?)\s+from\s+['"]([^'"]+)['"]/gm)) {
    if (m[1] === 'export' && m[2]!.trim().startsWith('type ')) continue;
    if (m[1] === 'import' && !namesAValue(m[2]!)) continue;
    if (m[1] === 'export' && m[2]!.includes('{') && !namesAValue(m[2]!)) continue;
    add(m[3]!);
  }
  for (const m of text.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)) add(m[1]!);
  return out;
}

/** Tarjan's strongly connected components. */
function components(graph: Map<string, string[]>): string[][] {
  let index = 0;
  const indices = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const out: string[][] = [];
  const visit = (v: string): void => {
    indices.set(v, index);
    low.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);
    for (const w of graph.get(v) ?? []) {
      if (!indices.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v)!, indices.get(w)!));
      }
    }
    if (low.get(v) === indices.get(v)) {
      const scc: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        scc.push(w);
      } while (w !== v);
      out.push(scc);
    }
  };
  for (const v of graph.keys()) if (!indices.has(v)) visit(v);
  return out;
}

function main(): void {
  const files = sources(SRC);
  const known = new Set(files);
  const graph = new Map<string, string[]>();
  let edges = 0;
  for (const file of files) {
    const to = valueEdges(file, known);
    graph.set(file, to);
    edges += to.length;
  }
  const name = (path: string): string => relative(SRC, path);
  console.log(`${files.length} modules, ${edges} value imports between them`);
  check(files.length > 100 && edges > 500, 'the tool should find the source and its imports');

  // The canary: an edge the tool must see (`getRuntimeSaveState`), and a type-only one it
  // must not (`GameTables`).
  const game = graph.get(resolve(SRC, 'engine/Game.ts'))!;
  check(game.includes(resolve(SRC, 'engine/RuntimeSave.ts')), 'Game imports a value from RuntimeSave');
  check(!game.includes(resolve(SRC, 'engine/GameTables.ts')), 'Game imports only types from GameTables');

  const cycles = components(graph).filter((scc) => scc.length > 1);
  for (const scc of cycles) console.log(`  cycle: ${scc.map(name).sort().join(', ')}`);
  check(cycles.length === 0, `no value-import cycle in src/ (${cycles.length} found)`);

  // The layers: what each bottom directory may import a value from.
  const layers: [string, string[]][] = [['core/', ['core/']], ['data/', ['data/', 'core/']]];
  for (const [layer, below] of layers) {
    const up: string[] = [];
    let count = 0;
    for (const [from, to] of graph) {
      if (!name(from).startsWith(layer)) continue;
      count++;
      for (const t of to) if (!below.some((dir) => name(t).startsWith(dir))) up.push(`${name(from)} -> ${name(t)}`);
    }
    for (const edge of up) console.log(`  up from ${layer}: ${edge}`);
    check(count > 10 && up.length === 0, `src/${layer} (${count} modules) imports a value only from ${below.map((dir) => `src/${dir}`).join(' and ')} (${up.length} edges up)`);
  }

  finish();
}

main();
