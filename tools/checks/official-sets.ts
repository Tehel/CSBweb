/**
 * What `utils/install-official-sets.ts` takes an instance to hold of each official set of
 * the manifest, by its files (`holding`, `tools/lib/officialSets.ts`), and the duplicates
 * it names, held to the reference instance's own table, `REFERENCE`.
 *
 * Its sets were written by hand before the script, under ids of their own: its `dm-atari`
 * is the 1.2 disk's, and CSBWin's mix, the manifest's `dm-atari`, is its
 * `dungeon-master-csbwin`. A script that took an id for its files installed six sets a
 * second time, which the author then removed; this one finds each set's files under the id
 * that holds them, names the six pairs on the table that had them, and none on the table
 * the instance has now.
 *
 * Run: `npm test -- --only=official-sets.ts`
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { check, finish } from '../lib/check';
import { DATA_SETS } from '../lib/dataSets';
import { duplicates, GAME_FILES, gameFilesOf, holding, type GameDigests, type Holding, type InstanceSet } from '../lib/officialSets';

/** A row: its id, its folder, and its dungeon's, graphics' and `mini.dat`'s SHA-256, `null` for none or not listed. */
type Row = [id: string, dir: string, dungeon: string | null, graphics: string | null, mini?: string];

const H = {
  dm10a: ['f388d156d2533abb90efb1235194d9d4f90e041193d8190e6a1efab809acf681', 'e0daae7b956c10ae94c097e5294c6eb5fce5b3280bd1e29d96f2c2a51d5a863f'],
  dm10b: ['a43a07834444d868a6b67bbc414b1f2618973635caf505696ba86c1d30894ee8', '16180d645f9d9292cafd95a1a763ce0a7f893afba3c34619b618dfc368a1a20a'],
  dm11: ['a26f0edc4fb13e3d38551d91ad7c24f517257cfc689affe72d657f4e423853b2', '310eb7737e1756e67c7f16c048485c5c8b5bb8307fdcee695d199a065fda2003'],
  dm12: ['0db918d30a2cca24da067f72f8a050366a739cbbaf4bca50300e2556314f667e', 'b4ab5f43d06193d76976eaead3be4aa941a74367bc84a0f2a3b00ad44756aa30'],
  dm12de: ['85e2017ec6bec3d27389cca6d2b3fcd201025f6f9775363fa483ba2ef6355141', '650ff7f430ac1113cce08a14b0f56bd010400232e97adcd2659b4be9671c18a2'],
  dm13fr: ['e0f5696a5eb792b7ece238f5d5b49c3967ce64c268e0978b658d2bf67b54be3c', 'b14e87bb2fb4a6ecc051e8e160b20d5244d6293e71e01bd754d6aaa6d8bdee1a'],
  amiga: ['f89f51bdecf95a5f9b9b4f70afb6381bdd2b7f6b571379ab33118d4a8b3d5c8b', '94e16696e93f85e35e64745333cca8bbaa32f882ace7e08b4706285554341ba9'],
  csbwinMix: ['a26f0edc4fb13e3d38551d91ad7c24f517257cfc689affe72d657f4e423853b2', 'b5f238d299207b11107881ffa113c362685362c00c9c109116fe872ce6531ac5'],
  amigaKid: ['9bac133b4d8d6ca88abad70ff4a3a6436f264e3ae3a7503e0b40a8a6b4007730', 'b5f238d299207b11107881ffa113c362685362c00c9c109116fe872ce6531ac5'],
  windows: ['ac3f9a233a988c9ff7d8074a6736909ce13fc482555cd329b3a130f661f90da5', '196cb349827e8926e2763fa61ecbe8e10810003045ef72a435b7da4dded56d8e'],
  pickingItems: ['5bee1c9126495523f82e773c95cddf44bc68c2e4da9115ebc986177a774001b9', 'b5f238d299207b11107881ffa113c362685362c00c9c109116fe872ce6531ac5'],
  csb: ['3cafd2fb9f255df93e99ae27d4bf60ff22cc8e43cfa90de7d29c04172b2542ba', '7cceef26a20acec6c5f9de659a6a0c57cdb24908687a2ca3a58e3c62cc6b0593'],
} as const;
const CSB_MINI = '61d981061bbb7a81b9b7f4795e99c24a592ee329169eb0c195459ba4eb62e3a9';

/**
 * The reference instance's table, in its order, as `SELECT position, id, dir FROM
 * data_sets` and the folders' `sha256sum` gave it on 2026-11-01, after the old script's
 * run: the rows from `dm-atari-1.0a` on are the ones it wrote. The fans' sets', and
 * `kids-dungeon`'s, files were not listed.
 */
const REFERENCE: Row[] = [
  ['dm-atari', 'dm-atari@4', ...H.dm12],
  ['dungeon-master-amiga-2.2-english', 'dungeon-master-amiga-2.2-english', ...H.amiga],
  ['dm-atari-1.3-fr', 'dm-atari-1.3-fr@3', ...H.dm13fr],
  ['original-pc-german', 'original-pc-german@2', ...H.dm12de],
  ['dungeon-master-atari-st-1.0a-english', 'dungeon-master-atari-st-1.0a-english', ...H.dm10a],
  ['dungeon-master-atari-st-1.0b-english', 'dungeon-master-atari-st-1.0b-english', ...H.dm10b],
  ['dungeon-master-atari-st-1.1-english', 'dungeon-master-atari-st-1.1-english', ...H.dm11],
  ['csb', 'csb', ...H.csb, CSB_MINI],
  ['kids-dungeon', 'kids-dungeon-24@4', null, null],
  ['original-amiga-kid-dungeon', 'original-amiga-kid-dungeon@2', ...H.amigaKid],
  ...['conflux-3.5', 'conflux-of-events', 'towers-of-chaos', 'the-prison-of-dragoth', 'imprisoned-again', 'the-black-flame', 'therons-quest',
    'traps-and-monsters', 'dungeon-captive', 'csbwin-teleporter-puzzle', '3d2d1d', '3dmaze', '5dmaze', 'small-demo-dungeon']
    .map((id): Row => [id, id, null, null]),
  ['dungeon-master-csbwin', 'dungeon-master-csbwin', ...H.csbwinMix],
  ['dm-atari-1.0a', 'dm-atari-1.0a', ...H.dm10a],
  ['dm-atari-1.0b', 'dm-atari-1.0b', ...H.dm10b],
  ['dm-atari-1.1', 'dm-atari-1.1', ...H.dm11],
  ['dm-atari-1.2', 'dm-atari-1.2', ...H.dm12],
  ['dm-atari-1.2-de', 'dm-atari-1.2-de', ...H.dm12de],
  ['dm-amiga', 'dm-amiga', ...H.amiga],
  ['dm-windows', 'dm-windows', ...H.windows],
  ['dm-minimum-item-picking', 'dm-minimum-item-picking', ...H.pickingItems],
];
const BEFORE = REFERENCE.findIndex(([id]) => id === 'dm-atari-1.0a');
/** The six rows the old script wrote a second time, which the author removed from the instance, rows and folders. */
const REMOVED = new Set(['dm-atari-1.0a', 'dm-atari-1.0b', 'dm-atari-1.1', 'dm-atari-1.2', 'dm-atari-1.2-de', 'dm-amiga']);
/** The reference instance's table now: `REFERENCE` without them. */
const NOW = REFERENCE.filter(([id]) => !REMOVED.has(id));

const rowsOf = (rows: Row[]): InstanceSet[] => rows.map(([id, dir, dungeon, graphics, mini]) => ({
  id, dir, files: { 'dungeon.dat': dungeon, 'graphics.dat': graphics, 'CSBgraphics.dat': null, 'mini.dat': mini ?? null },
}));
const said = (held: Holding): string => held.kind === 'installed' ? `as ${held.as}` : held.kind === 'dir-taken' ? `dir of ${held.by}` : held.kind;

/** The manifest's official sets, each with its fetched folder's digests, as the script reads them. */
const official = DATA_SETS.filter((set) => set.official).map((set) => {
  const named = gameFilesOf(set);
  const files = Object.fromEntries(GAME_FILES.map((name) => [name, named.includes(name)
    ? createHash('sha256').update(readFileSync(join(set.dir, name))).digest('hex') : null])) as GameDigests;
  return { id: set.id, dir: set.dir.split('/').pop()!, files };
});

function table(rows: InstanceSet[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const set of official) {
    out[set.id] = said(holding(set, rows));
    console.log(`  ${set.id.padEnd(24)} ${out[set.id]}`);
  }
  return out;
}

console.log('=== 1. the reference instance before the old script\'s run ===');
const before = table(rowsOf(REFERENCE.slice(0, BEFORE)));
const wanted: Record<string, string> = {
  'dm-atari-1.0a': 'as dungeon-master-atari-st-1.0a-english',
  'dm-atari-1.0b': 'as dungeon-master-atari-st-1.0b-english',
  'dm-atari-1.1': 'as dungeon-master-atari-st-1.1-english',
  'dm-atari-1.2': 'as dm-atari',
  'dm-atari-1.2-de': 'as original-pc-german',
  'dm-atari-1.3-fr': 'as dm-atari-1.3-fr',
  'dm-amiga': 'as dungeon-master-amiga-2.2-english',
  'kids-dungeon': 'id-taken',
  'csb': 'as csb',
  'dm-atari': 'as dungeon-master-csbwin',
  'dm-windows': 'missing',
  'dm-minimum-item-picking': 'missing',
};
for (const [id, what] of Object.entries(wanted)) {
  check(before[id] === what, `before: ${id} is ${what} (got ${before[id]})`);
}
check(Object.keys(before).length === Object.keys(wanted).length, 'every official set of the manifest is one of these');
check(duplicates(rowsOf(REFERENCE.slice(0, BEFORE))).length === 0, 'before: the instance held no set twice');

console.log('=== 2. the reference instance as the old script left it ===');
const after = table(rowsOf(REFERENCE));
const written = new Set(REFERENCE.slice(BEFORE).map(([id]) => id));
for (const [id, what] of Object.entries(wanted)) {
  const now = written.has(id) ? `as ${id}` : what;
  check(after[id] === now, `after: ${id} is ${now}, its own row where it holds its files (got ${after[id]})`);
}
const twice = duplicates(rowsOf(REFERENCE));
for (const ids of twice) console.log(`  twice: ${ids.join(', ')}`);
check(JSON.stringify(twice) === JSON.stringify([
  ['dm-atari', 'dm-atari-1.2'],
  ['dungeon-master-amiga-2.2-english', 'dm-amiga'],
  ['original-pc-german', 'dm-atari-1.2-de'],
  ['dungeon-master-atari-st-1.0a-english', 'dm-atari-1.0a'],
  ['dungeon-master-atari-st-1.0b-english', 'dm-atari-1.0b'],
  ['dungeon-master-atari-st-1.1-english', 'dm-atari-1.1'],
]), 'the six sets the old script installed a second time, each after the row it duplicates');

console.log('=== 3. the reference instance now, its duplicates removed ===');
const now = table(rowsOf(NOW));
for (const [id, what] of Object.entries(wanted)) {
  const held = written.has(id) && !REMOVED.has(id) ? `as ${id}` : what;
  check(now[id] === held, `now: ${id} is ${held} (got ${now[id]})`);
}
check(duplicates(rowsOf(NOW)).length === 0, 'now: the instance holds no set twice');
check(Object.values(now).every((what) => what.startsWith('as ') || what === 'id-taken'), 'now: every official set is installed, but kids-dungeon, whose files the table does not list');

console.log('=== 4. an id or a folder that holds other files ===');
const dmAtari = official.find((set) => set.id === 'dm-atari')!;
const withoutMix = rowsOf(REFERENCE.slice(0, BEFORE).filter(([id]) => id !== 'dungeon-master-csbwin'));
console.log(`  dm-atari, CSBWin's mix nowhere: ${said(holding(dmAtari, withoutMix))}`);
check(holding(dmAtari, withoutMix).kind === 'id-taken', 'a set whose id the instance gives other files is not offered');
const clash = rowsOf([['someone-else', dmAtari.dir, ...H.windows]]);
check(said(holding(dmAtari, clash)) === 'dir of someone-else', 'nor one whose folder holds another set');
const csb = official.find((set) => set.id === 'csb')!;
const otherMini = rowsOf([['csb', 'csb', ...H.csb, 'f'.repeat(64)]]);
check(holding(csb, otherMini).kind === 'id-taken', 'a set\'s mini.dat is one of its files: CSB with another is another set');

finish();
