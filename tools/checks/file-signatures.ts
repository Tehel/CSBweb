/**
 * The graphics files' signatures, and CSBWin's checks of them (`src/engine/FileSignatures.ts`).
 *
 * 1. **MD5** (`src/core/md5.ts`) agrees with Node's on the RFC's vectors and on every game
 *    file here.
 * 2. **`Signature`** (`doc/CSBwin-src/data.cpp:1956-1979`) is the digest's first eight bytes
 *    as two little-endian longwords, and the fold `(n | n >> 16) & 0xffff`. Printed for
 *    every `graphics.dat` and `CSBgraphics.dat`, with what each `dungeon.dat` and genuine
 *    save names of them: its `EDBT_RuntimeFileSignatures` records and its Extended
 *    Features block's expected pairs. Every one reads under its own data set's files.
 * 3. **`openGraphicsFile` at a read** (`SaveGame.cpp:1966-2025`, `Graphics.cpp:1830-1840`):
 *    a world whose `EXPOOL` names this `graphics.dat` reads, one that names another dies
 *    with `0x3c6c`, the page told first and nothing installed, and a record of 0 or one
 *    under a nonzero `EDBT_Debuging` is no check. The same through a save's read.
 * 4. **`OpenCSBgraphicsFile` at the first section read** (`Graphics.cpp:1864-1920`): before
 *    any read it opens; under a world naming its fold it opens, under one naming another
 *    it dies and the file is refused from there; once open it is not checked again. A
 *    file that is not there traces "Cannot find" once and dies with `0xbad` only where an
 *    Extended Features block expected one.
 * 5. **A `dungeon.dat` that does not read** is covered by `tools/checks/bad-saved-game.ts`.
 *
 * Run: `npm test -- --only=file-signatures.ts`
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { md5 } from '../../src/core/md5';
import { CSBGraphicsLoader } from '../../src/data/CSBGraphicsLoader';
import { loadCsbwinWorld } from '../../src/data/CsbwinDungeonImage';
import { Expool, readRuntimeFileSignatures, type ExpoolDatabase } from '../../src/data/CsbwinExpool';
import { DungeonLoader } from '../../src/data/DungeonLoader';
import { foldedSignature, Signature, type FileSignature } from '../../src/data/FileSignature';
import { GraphicsLoader } from '../../src/data/GraphicsLoader';
import { Die } from '../../src/core/Die';
import { csbGraphicsOpener } from '../../src/engine/FileSignatures';
import { buildSaveFile } from '../../src/engine/SaveGameFile';
import { applySaveBytes } from '../../src/engine/SaveGameFile';
import { DATA_SETS } from '../lib/dataSets';
import { check, finish } from '../lib/check';
import { newGame, stockGraphics } from '../lib/game';
import { genuineSaves } from '../lib/saves';

const read = (path: string): Uint8Array => new Uint8Array(readFileSync(resolve(path)));
const hex = (n: number): string => (n >>> 0).toString(16).padStart(8, '0');
const sig = (s: FileSignature): string => `${hex(s.signature2)} ${hex(s.signature1)} (fold ${foldedSignature(s)})`;

/** `(EDT_Database << 24) + (edbt << 16) + i` (`doc/CSBwin-src/CSB.h:1555-1559`). */
const edbtKey = (edbt: number, i: number): number => ((5 << 24) + (edbt << 16) + i) >>> 0;
const EDBT_RUNTIME_FILE_SIGNATURES = 2;
const EDBT_DEBUGING = 3;

/** What `run` threw, or 'ok'. */
function outcome(run: () => void): unknown {
  try {
    run();
    return 'ok';
  } catch (error) {
    return error;
  }
}
const isDie = (result: unknown, errorNum: number): result is Die => result instanceof Die && result.errorNum === errorNum;
const describe = (result: unknown): string =>
  result instanceof Die ? `die 0x${result.errorNum.toString(16)}: ${result.message.split('\n').slice(1).join(' / ')}` : String(result);

/* ------------------------------------------------------------------ 1. MD5 ---- */

console.log('=== MD5 ===');
const vectors: [string, string][] = [
  ['', 'd41d8cd98f00b204e9800998ecf8427e'],
  ['abc', '900150983cd24fb0d6963f7d28e17f72'],
  ['message digest', 'f96b697d7cb7938d525a2f31aaf161d0'],
  ['12345678901234567890123456789012345678901234567890123456789012345678901234567890', '57edf4a22be3c955ac49da2e2107b67a'],
];
const digestHex = (bytes: Uint8Array): string => Array.from(md5(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
check(vectors.every(([text, want]) => digestHex(new TextEncoder().encode(text)) === want), 'the RFC 1321 test vectors');
// Every length around a block's padding boundary.
const ramp = Uint8Array.from({ length: 200 }, (_, i) => (i * 37) & 0xff);
check(Array.from({ length: 200 }, (_, n) => n).every((n) => digestHex(ramp.subarray(0, n)) === createHash('md5').update(ramp.subarray(0, n)).digest('hex')),
  'Node\'s digest for every length from 0 to 199');
const gameFiles = DATA_SETS.flatMap((set) => [`${set.dir}/graphics.dat`, `${set.dir}/dungeon.dat`, ...(set.csbGraphics ? [`${set.dir}/CSBgraphics.dat`] : [])]);
gameFiles.push('tools/fixtures/gamefiles/conflux-3.5-b8/CSBgraphics.dat', 'tools/fixtures/gamefiles/conflux-3.5-b8/graphics.dat');
check(gameFiles.every((path) => digestHex(read(path)) === createHash('md5').update(read(path)).digest('hex')),
  `Node's digest for all ${gameFiles.length} game files`);

/* ------------------------------------------- 2. the signatures, and who names them ---- */

console.log('');
console.log('=== Signature: signature2 signature1 (fold) ===');
const abc = Signature(new TextEncoder().encode('abc'));
check(abc.signature1 === 0x98500190 && abc.signature2 === 0xb04fd23c, 'the digest\'s bytes 0-3 and 4-7, little-endian (abc: 98500190, b04fd23c)');
check(foldedSignature({ signature1: 0x12340000, signature2: 0x00005678 }) === (0x1234 | 0x5678), 'the fold ORs the two longwords, then their halves');

const graphicsOf = new Map<string, GraphicsLoader>();
for (const set of DATA_SETS) {
  const graphics = new GraphicsLoader();
  graphics.loadFromArray(read(`${set.dir}/graphics.dat`));
  graphicsOf.set(set.id, graphics);
  console.log(`  ${set.id.padEnd(16)} graphics.dat    ${sig(graphics.getSignature())}`);
  if (set.csbGraphics) {
    const csb = new CSBGraphicsLoader();
    csb.loadFromArray(read(`${set.dir}/CSBgraphics.dat`));
    console.log(`  ${set.id.padEnd(16)} CSBgraphics.dat ${sig(csb.getSignature()!)}`);
  }
}
const confluxCsb = new CSBGraphicsLoader();
confluxCsb.loadFromArray(read('tools/fixtures/gamefiles/conflux-3.5-b8/CSBgraphics.dat'));
const confluxGraphics = new GraphicsLoader();
confluxGraphics.loadFromArray(read('tools/fixtures/gamefiles/conflux-3.5-b8/graphics.dat'));
console.log(`  ${'conflux-3.5-b8'.padEnd(16)} graphics.dat    ${sig(confluxGraphics.getSignature())}`);
console.log(`  ${'conflux-3.5-b8'.padEnd(16)} CSBgraphics.dat ${sig(confluxCsb.getSignature()!)}`);

console.log('');
console.log('=== what each game names: EDBT debuging / CSBgraphics / graphics; expected pairs ===');
const named = (world: ExpoolDatabase & { extendedFeatures?: { graphicsSignature1: number; graphicsSignature2: number; csbGraphicsSignature1: number; csbGraphicsSignature2: number } }): string => {
  const r = readRuntimeFileSignatures(world);
  const efb = world.extendedFeatures;
  const expected = efb ? `${hex(efb.graphicsSignature2)} ${hex(efb.graphicsSignature1)} / ${hex(efb.csbGraphicsSignature2)} ${hex(efb.csbGraphicsSignature1)}` : 'no block';
  return `EDBT ${r.debuging} / ${r.csbGraphicsSignature} / ${r.graphicsSignature}; expected ${expected}`;
};
for (const set of DATA_SETS) {
  const data = new DungeonLoader().loadDungeonDat(read(`${set.dir}/dungeon.dat`));
  console.log(`  ${set.id.padEnd(16)} ${named(data)}`);
  const game = newGame(data, graphicsOf.get(set.id)!);
  const result = outcome(() => game.readDungeonDat(read(`${set.dir}/dungeon.dat`)));
  check(result === 'ok', `${set.id}: its dungeon.dat reads under its own graphics.dat (${describe(result)})`);
}
console.log(`  ${'conflux-3.5-b8'.padEnd(16)} ${named(new DungeonLoader().loadDungeonDat(read('tools/fixtures/gamefiles/conflux-3.5-b8/dungeon.dat')))}`);
for (const path of genuineSaves()) {
  const world = loadCsbwinWorld(read(path));
  console.log(`  ${path.split('/').pop()!.padEnd(30)} ${named(Object.assign(world.dungeon, { extendedFeatures: world.save.extendedFeatures }))}`);
  const game = newGame(new DungeonLoader().loadDungeonDat(read('tools/fixtures/gamefiles/csb/dungeon.dat')), graphicsOf.get('csb')!);
  const result = outcome(() => applySaveBytes(game, read(path)));
  check(result === 'ok', `${path}: reads under CSB's graphics.dat (${describe(result)})`);
}

/* ----------------------------------------------- 3. openGraphicsFile at a read ---- */

console.log('');
console.log('=== openGraphicsFile at a read ===');
const graphics = stockGraphics();
const fold = foldedSignature(graphics.getSignature());
const dungeonBytes = read('tools/fixtures/gamefiles/dm-atari/dungeon.dat');

/** dm-atari's dungeon.dat with `records` written into its `EXPOOL`. */
function worldNaming(records: [number, number][]): ReturnType<DungeonLoader['loadDungeonDat']> {
  const data = new DungeonLoader().loadDungeonDat(dungeonBytes);
  const expool = new Expool(data);
  for (const [key, value] of records) expool.write(key, [value]);
  return data;
}

/** A new game read of `records`' world into a game over CSB's prison. */
function readNaming(records: [number, number][]): { result: unknown; told: unknown[]; levels: number } {
  const told: unknown[] = [];
  const game = newGame(new DungeonLoader().loadDungeonDat(read('tools/fixtures/gamefiles/csb/dungeon.dat')), graphics, { die: (error) => { told.push(error); } });
  const result = outcome(() => game.readNewGame(worldNaming(records)));
  return { result, told, levels: game.ctx.dungeon.getData().maps.length };
}

const same = readNaming([[edbtKey(EDBT_RUNTIME_FILE_SIGNATURES, 1), fold]]);
console.log(`  naming ${fold}: ${describe(same.result)}, ${same.levels} levels`);
check(same.result === 'ok' && same.levels === 14, 'a world naming this graphics.dat\'s fold reads');
const other = readNaming([[edbtKey(EDBT_RUNTIME_FILE_SIGNATURES, 1), fold ^ 1]]);
console.log(`  naming ${fold ^ 1}: ${describe(other.result)}, page told ${other.told.length}x, ${other.levels} levels`);
check(isDie(other.result, 0x3c6c) && other.result.message.endsWith(`Incorrect Graphics File signature\nActuatl Signature = ${fold}`),
  'one naming another dies, 0x3c6c, with CSBWin\'s message and the actual fold');
check(other.told.length === 1 && other.told[0] === other.result, 'the page is told before the throw, so a caller that catches it cannot hide it');
check(other.levels === 2, 'and nothing of the world is installed: the prison\'s two levels stand');
const zero = readNaming([[edbtKey(EDBT_RUNTIME_FILE_SIGNATURES, 1), 0]]);
check(zero.result === 'ok', 'a record of 0 names nothing');
const debugging = readNaming([[edbtKey(EDBT_RUNTIME_FILE_SIGNATURES, 1), fold ^ 1], [edbtKey(EDBT_DEBUGING, 0), 1]]);
check(debugging.result === 'ok', 'nor does one under a nonzero EDBT_Debuging, which skips the signatures\' records');
const csbOnly = readNaming([[edbtKey(EDBT_RUNTIME_FILE_SIGNATURES, 0), 1234]]);
check(csbOnly.result === 'ok', 'a world naming only a CSBgraphics.dat reads: graphics.dat is not checked against it');

// A save's read: the save of a world naming another graphics.dat.
{
  const source = newGame(worldNaming([]), graphics);
  source.readNewGame(worldNaming([[edbtKey(EDBT_RUNTIME_FILE_SIGNATURES, 1), fold]]));
  const goodSave = buildSaveFile(source);
  new Expool(source.ctx.dungeon.getData()).write(edbtKey(EDBT_RUNTIME_FILE_SIGNATURES, 1), [fold ^ 1]);
  const badSave = buildSaveFile(source);
  const told: unknown[] = [];
  const target = newGame(new DungeonLoader().loadDungeonDat(read('tools/fixtures/gamefiles/csb/dungeon.dat')), graphics, { die: (error) => { told.push(error); } });
  const bad = outcome(() => applySaveBytes(target, badSave));
  const levelsAfterBad = target.ctx.dungeon.getData().maps.length;
  const good = outcome(() => applySaveBytes(target, goodSave));
  console.log(`  save naming another: ${describe(bad)}, ${levelsAfterBad} levels; save naming this one: ${describe(good)}`);
  check(isDie(bad, 0x3c6c) && told.length === 1 && levelsAfterBad === 2, 'a save naming another graphics.dat dies at its read, nothing installed');
  check(good === 'ok' && target.ctx.dungeon.getData().maps.length === 14, 'and the save naming this one reads');
  check(target.ctx.runtimeFileSignatures.graphicsSignature === fold, 'its records are the game\'s from there');
}

/* ------------------------------------------- 4. OpenCSBgraphicsFile at first need ---- */

console.log('');
console.log('=== OpenCSBgraphicsFile at the first section read ===');
const csbBytes = read('tools/fixtures/gamefiles/csbgraphics/CSBgraphics.dat');
const csbFold = foldedSignature(Signature(csbBytes)) || 1;

/** A game over dm-atari, with the fixture CSBgraphics.dat opened through the game's checks. */
function csbGame(records: [number, number][] | null, present = true): { game: ReturnType<typeof newGame>; csb: CSBGraphicsLoader; told: unknown[]; traces: string[] } {
  const told: unknown[] = [];
  const traces: string[] = [];
  const game = newGame(worldNaming([]), graphics, { die: (error) => { told.push(error); }, trace: (line) => { traces.push(line); } });
  if (records) game.readNewGame(worldNaming(records));
  const csb = new CSBGraphicsLoader();
  if (present) csb.loadFromArray(csbBytes);
  csb.opener = csbGraphicsOpener(game.ctx);
  return { game, csb, told, traces };
}
const firstRead = (csb: CSBGraphicsLoader): unknown => outcome(() => csb.importBitmap(0));

const boot = csbGame(null);
check(boot.game.ctx.runtimeFileSignatures.csbGraphicsSignature === 0xffffffff && firstRead(boot.csb) === 'ok',
  'before any read, EDBT_CSBGraphicsSignature_data 0xffffffff and EDBT_Debuging_data 0xffffffff: it opens unchecked');
const match = csbGame([[edbtKey(EDBT_RUNTIME_FILE_SIGNATURES, 0), csbFold]]);
check(firstRead(match.csb) === 'ok', `a world naming its fold, ${csbFold}, opens it`);
const mismatch = csbGame([[edbtKey(EDBT_RUNTIME_FILE_SIGNATURES, 0), csbFold ^ 1]]);
const died = firstRead(mismatch.csb);
console.log(`  naming ${csbFold ^ 1}: ${describe(died)}; then ${describe(firstRead(mismatch.csb))}, a wall decoration ${mismatch.csb.getWallDecoration(1)}`);
check(isDie(died, 0x3c6c) && died.message.endsWith(`Incorrect CSBGraphics File signature\nActual Signature = ${csbFold}`) && mismatch.told.length === 1,
  'one naming another dies, 0x3c6c, the page told first');
check(firstRead(mismatch.csb) === 'ok' && mismatch.csb.importBitmap(0) === null && mismatch.told.length === 1,
  'and the file is refused from there: every read is null, and dies no more');
const debugCsb = csbGame([[edbtKey(EDBT_RUNTIME_FILE_SIGNATURES, 0), csbFold ^ 1], [edbtKey(EDBT_DEBUGING, 0), 1]]);
check(firstRead(debugCsb.csb) === 'ok', 'a nonzero EDBT_Debuging skips the check');
// Open once: a later read naming another is not checked.
{
  const { game, csb, told } = csbGame([[edbtKey(EDBT_RUNTIME_FILE_SIGNATURES, 0), csbFold]]);
  firstRead(csb);
  game.readNewGame(worldNaming([[edbtKey(EDBT_RUNTIME_FILE_SIGNATURES, 0), csbFold ^ 1]]));
  check(firstRead(csb) === 'ok' && told.length === 0 && game.ctx.runtimeFileSignatures.csbGraphicsSignature === (csbFold ^ 1),
    'once open the file is not checked again, though a later read names another');
}
// A file that is not there.
{
  const absent = csbGame([], false);
  const results = [firstRead(absent.csb), firstRead(absent.csb)];
  const cannot = absent.traces.filter((line) => line === "Cannot find 'CSBgraphics.dat'");
  check(results.every((r) => r === 'ok') && cannot.length === 1 && absent.told.length === 0 && absent.csb.importBitmap(0) === null,
    'a file that is not there: "Cannot find" traced once, no die where no block expected one, and nothing read');
  const expecting = csbGame([], false);
  expecting.game.ctx.signatures.expectedCSBgraphicSignature1 = 0x12345678;
  const result = firstRead(expecting.csb);
  console.log(`  not there, a block expecting one: ${describe(result)}`);
  check(isDie(result, 0xbad) && result.message.endsWith("Cannot find 'CSBgraphics.dat'") && expecting.told.length === 1,
    'and die(0xbad) where an Extended Features block expected one');
}

finish();
