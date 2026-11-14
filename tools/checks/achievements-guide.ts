/**
 * The designers' guide, `doc/achievements-guide.html` (`doc/ACHIEVEMENTS.md` → "The file"),
 * which the author shares under `files/`: each of its examples read as a set's own
 * `achievements.txt` by the form's check (`achievementsProblems`, `checkLocalDataSet`), so
 * that the guide cannot drift from the format.
 *
 * An example is a `<pre class="example">`. One that does not open with a comment is a piece
 * of a file, and is read under the format's first line. It is checked against Dungeon
 * Master's objects, or Chaos Strikes Back's with `data-set="csb"`, as a moderator's file,
 * no family reserved, or as a player's with `data-player`, the site's own sets' families
 * reserved. An example must read with no problem, and every achievement it gives must exist
 * once laid over the common file: one naming a value it does not define would vanish. A
 * `refused` example must be refused with the problem the `<p class="verdict">` after it
 * says, word for word.
 *
 * And the page is one `FILES_POLICY` serves whole (`server/app.ts`): no script, no
 * stylesheet or font fetched, every image a `data:` URL.
 *
 * Run: `npm test -- --only=achievements-guide.ts`
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ACHIEVEMENTS_HEADER, mergeAchievements, readAchievementFile } from '../../src/engine/achievements/AchievementFile';
import { familyOf } from '../../src/engine/achievements/PageAchievements';
import { achievementsProblems } from '../../src/engine/LocalDataSetCheck';
import { GraphicsLoader } from '../../src/data/GraphicsLoader';
import { check, finish } from '../lib/check';
import { DATA_SETS, dataSetNamed } from '../lib/dataSets';
import { graphicsTablesOf } from '../lib/game';

const GUIDE = resolve(import.meta.dirname, '../../doc/achievements-guide.html');
const COMMON = readFileSync(resolve(import.meta.dirname, '../../src/engine/achievements/defs/common.txt'), 'utf8');

/** `html`'s text, its entities replaced. */
function unescape(html: string): string {
  return html.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

/** The object names of the set `id`'s `graphics.dat`, read once. */
const names = new Map<string, ReadonlySet<string>>();
function objectNamesOf(id: string): ReadonlySet<string> {
  let known = names.get(id);
  if (!known) {
    const graphics = new GraphicsLoader();
    graphics.loadFromArray(new Uint8Array(readFileSync(resolve(dataSetNamed(id).dir, 'graphics.dat'))));
    known = new Set(graphicsTablesOf(graphics).objects.objectNames);
    names.set(id, known);
  }
  return known;
}

/**
 * The families a player's set may not declare: each site's set's id and its file's family,
 * as the server reserves them (`SetAchievements.achievementsCheck`), every set of the
 * repository's manifest being the site's own.
 */
const RESERVED: ReadonlySet<string> = new Set(DATA_SETS.flatMap((set) => {
  const path = resolve(set.dir, 'achievements.txt');
  return [set.id, familyOf(set.id, existsSync(path) ? readFileSync(path, 'utf8') : null)];
}));

const commonRead = readAchievementFile(COMMON);
if (!commonRead.ok) throw new Error('common.txt does not read');

const html = readFileSync(GUIDE, 'utf8');

console.log('--- the page, as FILES_POLICY serves it');
check(!/<script\b/i.test(html), 'it holds no script');
check(!/<link\b/i.test(html) && !/@import\b/i.test(html), 'it fetches no stylesheet');
const sources = [...html.matchAll(/\bsrc\s*=\s*"([^"]*)"/gi)].map((m) => m[1] ?? '');
const urls = [...html.matchAll(/url\(\s*['"]?([^'")]*)/gi)].map((m) => m[1] ?? '');
check([...sources, ...urls].every((url) => url.startsWith('data:')), `every image and font it shows is a data: URL (${[...sources, ...urls].filter((u) => !u.startsWith('data:')).join(', ')})`);
check(/<title>[^<]+<\/title>/.test(html) && /prefers-color-scheme: dark/.test(html), 'it has a title, and a dark theme');

console.log('--- the examples');
const examples = [...html.matchAll(/<pre class="example( refused)?"([^>]*)>([\s\S]*?)<\/pre>(\s*<p class="verdict">([\s\S]*?)<\/p>)?/g)];
let read = 0;
let refused = 0;
for (const [, refusedClass, attributes = '', body = '', , verdict] of examples) {
  const raw = unescape(body.replace(/<[^>]+>/g, ''));
  const text = raw.startsWith('#') ? raw : `${ACHIEVEMENTS_HEADER}\n${raw}`;
  const set = /data-set="([^"]+)"/.exec(attributes)?.[1] ?? 'dm-atari';
  const player = /\bdata-player\b/.test(attributes);
  const problems = achievementsProblems(text, { common: COMMON, reservedFamilies: player ? RESERVED : new Set() }, objectNamesOf(set));
  const first = raw.split('\n').find((line) => line.startsWith('[')) ?? raw.split('\n')[0];
  if (refusedClass) {
    refused++;
    const said = verdict === undefined ? null : unescape(verdict.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
    console.log(`  refused  ${first}: ${problems.join(' | ')}`);
    check(said !== null, `${first}: a refused example is followed by its verdict`);
    check(said !== null && problems.includes(said), `${first} is refused with "${said}" (${problems.join(' | ')})`);
    continue;
  }
  read++;
  check(verdict === undefined, `${first}: an example that reads has no verdict`);
  check(problems.length === 0, `${first} reads with nothing wrong (${problems.join(' | ')})`);
  const file = readAchievementFile(text);
  if (!file.ok) continue;
  const merged = mergeAchievements(commonRead.file, file.file);
  const ids = file.file.defs.map((def) => def.id);
  console.log(`  read     ${ids.join(', ') || `disables ${file.file.disabled.join(', ') || 'nothing'}`}${file.file.family ? ` (family ${file.file.family})` : ''} [${set}${player ? ', a player' : ''}]`);
  for (const id of ids) check(merged.some((def) => def.id === id), `${id} exists once laid over the common file: every value it names is defined`);
}
console.log(`  ${read} read, ${refused} refused`);
check(read >= 20 && refused >= 5, `the guide has its examples, and its refused ones (${read}, ${refused})`);
check(examples.length === (html.match(/<pre class="example/g) ?? []).length, 'every example was found with its class');

console.log('--- the files it quotes');
/** A file's blocks, each `[id]` with its lines up to a blank line or a comment, by id and name. */
function blocksOf(text: string): { id: string; name: string; block: string }[] {
  return [...text.matchAll(/^\[([a-z0-9-]+)\]\n((?:[^\n#][^\n]*(?:\n|$))*)/gm)].map(([, id = '', block = '']) => ({
    id, name: /^name: (.*)$/m.exec(block)?.[1] ?? '', block: block.trim(),
  }));
}
// A block the guide gives with the id and the name of one of the FTL files' is that block,
// word for word: Dungeon Master's, Chaos Strikes Back's or the common file's.
const quotedFrom = [
  ['common.txt', COMMON],
  ['dungeon-master.txt', readFileSync(resolve(import.meta.dirname, '../achievements/dungeon-master.txt'), 'utf8')],
  ['csb.txt', readFileSync(resolve(import.meta.dirname, '../achievements/csb.txt'), 'utf8')],
] as const;
let quoted = 0;
for (const [, refusedClass, , body = ''] of examples) {
  if (refusedClass) continue;
  for (const shown of blocksOf(unescape(body))) {
    const origin = quotedFrom.flatMap(([file, text]) => blocksOf(text).filter((b) => b.id === shown.id && b.name === shown.name).map((b) => ({ file, ...b })));
    if (origin.length === 0) continue;
    quoted++;
    check(origin.some((b) => b.block === shown.block), `[${shown.id}] ${shown.name} is quoted as ${origin.map((b) => b.file).join(' and ')} has it`);
  }
}
console.log(`  ${quoted} blocks quoted from the FTL files`);
check(quoted >= 30, 'most examples are the FTL files\' own blocks');

finish();
