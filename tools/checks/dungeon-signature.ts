/**
 * A dungeon's signature, and the catalogue of the known dungeons' (`DungeonSignature.ts`).
 *
 * A save names no dungeon, so a file on its way into the store is told by its walls: a
 * digest per level of the width, the height and a bit per cell, stone or not
 * (`doc/SAVES.md` → "An import is checked against the dungeon"). Nothing of it shows until a
 * save is refused in its own dungeon, or taken into another's. So:
 *
 * 1. The digest's input, on a level made by hand: the bytes, written out here, and the
 *    digest against `node:crypto`'s of those bytes.
 * 2. The catalogue against the files here: every data set's `dungeon.dat`, and CSB's
 *    `mini.dat`, is a catalogue dungeon that lists the set, whole; no entry is left
 *    without its file, and no two dungeons share a digest but a release and the dungeon
 *    it is a variant of: Dungeon Master 1.0, of Dungeon Master.
 * 3. Each committed save, early ones and late ones, is its own dungeon's, whole, and
 *    matches no level of any other.
 * 4. The port's own save of a new game is its dungeon's.
 * 5. What the signature sees and what it does not, on the late save's world: a cell's
 *    attributes and objects, and its type among those that are not stone, change
 *    nothing; a wall opened or a cell walled changes its level's digest alone, and the
 *    save is then most of Dungeon Master, not the whole of it.
 * 6. What a save's walls are to a data set (`checkDungeon`): held against the set's own
 *    dungeons, its `dungeon.dat` and CSB's `mini.dat`, where their levels' shapes are
 *    the same, the set's own, a slightly different dungeon, or another, refused; and
 *    otherwise against the catalogue's dungeons of the other sets, with a set the
 *    catalogue does not list, a player's own or a published one, among them; the
 *    published sets' dungeons, whose levels' sizes break a tie, and the server's answer
 *    that gives them (`parsePublishedDungeons`); and Dungeon Master 1.0 against
 *    Dungeon Master, each in a set of the other.
 *
 * With a path, the digests of that file, a `dungeon.dat` or a save, are printed first,
 * as the catalogue lists them: that is how a dungeon is added to it.
 *
 * Run: `npm test -- --only=dungeon-signature.ts [file]`
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

import { loadCsbwinWorld } from '../../src/data/CsbwinDungeonImage';
import { readCsbwinSaveInfo } from '../../src/data/CsbwinSaveInfo';
import { DungeonLoader } from '../../src/data/DungeonLoader';
import {
  checkDungeon, dungeonSignature, dungeonWalls, identifyDungeon, KNOWN_DUNGEONS, levelWalls, parsePublishedDungeons, type DungeonWalls, type KnownDungeon,
} from '../../src/data/DungeonSignature';
import type { DungeonData, MapData } from '../../src/data/dungeonTypes';
import { buildSaveFile } from '../../src/engine/SaveGameFile';
import { DATA_SETS } from '../lib/dataSets';
import { check, finish } from '../lib/check';
import { stockDungeon, stockGame } from '../lib/game';
import { genuineSaves, savePath } from '../lib/saves';

const DM = 'Dungeon Master';
const DM_10 = 'Dungeon Master 1.0';
const CSB = 'Chaos Strikes Back';

/** CSB's game is not its `dungeon.dat`, the prison, but this save (`doc/PROVEN_FACTS.md` → "A compressed `dungeon.dat`: CSB's prison"). */
const MINI = 'tools/fixtures/gamefiles/csb/mini.dat';
const CSB_SAVE = 'tools/fixtures/gamefiles/csb/csbgame2.dat';

const read = (path: string): Uint8Array => new Uint8Array(readFileSync(resolve(path)));
const hex = (bytes: Uint8Array): string => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(' ');
const dungeonDat = (path: string): DungeonData => new DungeonLoader().loadDungeonDat(read(path));

function known(name: string): KnownDungeon {
  const dungeon = KNOWN_DUNGEONS.find((d) => d.name === name);
  if (!dungeon) throw new Error(`the catalogue has no ${name}`);
  return dungeon;
}

/** `n/of` for each catalogue dungeon: how many of its levels the signature matches. */
function againstEach(signature: readonly string[]): number[] {
  return KNOWN_DUNGEONS.map((d) => d.signature.filter((digest, level) => digest === signature[level]).length);
}

/** `maps` with the cells of level `level` put through `change`. */
function withCells(dungeon: DungeonData, change: (flag: number, level: number, x: number, y: number) => number): DungeonData {
  const maps = dungeon.maps.map((map, level): MapData => ({
    ...map,
    cellFlags: map.cellFlags.map((column, x) => column.map((flag, y) => change(flag, level, x, y))),
  }));
  return { ...dungeon, maps };
}

/* ------------------------------------------------------------- 1. the input --- */

async function checkInput(dm: DungeonData): Promise<void> {
  console.log('=== 1. what a level\'s digest is taken of (`levelWalls`) ===');
  // Five columns of two cells. Stone is type 0 whatever its low bits hold: 0x10 is a
  // wall with objects, 0x0f a wall with every attribute bit.
  const cellFlags = [
    [0x00, 0x20], // stone, open
    [0x10, 0x80], // stone with objects, door
    [0x48, 0x0f], // pit, stone with attributes
    [0xa0, 0xc0], // teleporter, false wall
    [0x60, 0x00], // stairs, stone
  ];
  const map: MapData = { ...dm.maps[0], descriptor: { ...dm.maps[0].descriptor, width: 5, height: 2 }, cellFlags };
  const walls = levelWalls(map);
  console.log(`  a 5x2 level, column by column: ${hex(walls)}`);
  // 0 1 0 1 1 0 1 1 | 1 0: the cells in the file's order, the first in the high bit.
  check(hex(walls) === '05 02 5b 80', `the input is the width, the height and a bit per cell, set for any cell but stone (got ${hex(walls)})`);
  const [digest] = await dungeonSignature({ ...dm, maps: [map] });
  const nodes = createHash('sha256').update(walls).digest('hex');
  console.log(`  its digest: ${digest}`);
  check(digest === nodes, `the digest is SHA-256 of those bytes, in hexadecimal (node:crypto gives ${nodes})`);

  console.log('  Dungeon Master\'s levels:');
  console.log(['level', 'size', 'bytes', 'not stone', 'digest'].join('\t'));
  const signature = await dungeonSignature(dm);
  dm.maps.forEach((level, i) => {
    const bytes = levelWalls(level);
    const { width, height } = level.descriptor;
    let open = 0;
    for (const byte of bytes.subarray(2)) for (let bit = 0; bit < 8; bit++) open += (byte >> bit) & 1;
    console.log([i, `${width}x${height}`, bytes.length, open, signature[i]].join('\t'));
    check(level.cellFlags.length === width && level.cellFlags.every((column) => column.length === height),
      `level ${i}: the cells are the descriptor's ${width}x${height}`);
    check(bytes.length === 2 + Math.ceil((width * height) / 8), `level ${i}: two bytes and a bit per cell`);
  });
}

/* --------------------------------------------------------- 2. the catalogue --- */

async function checkCatalogue(): Promise<void> {
  console.log('\n=== 2. the catalogue against the files here ===');
  console.log(['file', 'levels', 'dungeon', 'matching', 'whole'].join('\t'));
  const reached = new Set<KnownDungeon>();
  const files: Array<{ label: string; set: string; dungeon: DungeonData }> = DATA_SETS.map((set) => ({
    label: `${set.id}/dungeon.dat`, set: set.id, dungeon: dungeonDat(`${set.dir}/dungeon.dat`),
  }));
  files.push({ label: 'csb/mini.dat', set: 'csb', dungeon: loadCsbwinWorld(read(MINI)).dungeon });
  for (const file of files) {
    const signature = await dungeonSignature(file.dungeon);
    const match = identifyDungeon(signature);
    console.log([file.label, signature.length, match?.dungeon.name ?? '-', match?.levels ?? 0, match?.whole ?? false].join('\t'));
    check(match?.whole === true, `${file.label}: the catalogue holds its dungeon, every level of it`);
    check(match?.dungeon.dataSets.includes(file.set) === true, `${file.label}: and that dungeon lists the set ${file.set}`);
    if (match?.whole) reached.add(match.dungeon);
    else for (const digest of signature) console.log(`            '${digest}',`);
  }
  check(identifyDungeon(await dungeonSignature(loadCsbwinWorld(read(MINI)).dungeon))?.dungeon === known(CSB),
    `mini.dat is ${CSB}, and the set's dungeon.dat is not`);

  const ids = new Set(DATA_SETS.map((set) => set.id));
  const digests = KNOWN_DUNGEONS.flatMap((d) => d.signature);
  for (const dungeon of KNOWN_DUNGEONS) {
    check(dungeon.dataSets.every((id) => ids.has(id)), `${dungeon.name}: its data sets are data sets (${dungeon.dataSets.join(', ')})`);
    // A dungeon the port cannot play has no file here to hold it to.
    check(dungeon.dataSets.length === 0 || reached.has(dungeon), `${dungeon.name}: a file here is this dungeon`);
    check(dungeon.signature.every((digest) => /^[0-9a-f]{64}$/.test(digest)), `${dungeon.name}: each digest is 64 hexadecimal digits`);
  }
  check(DATA_SETS.every((set) => KNOWN_DUNGEONS.some((d) => d.dataSets.includes(set.id))), 'every data set plays a catalogue dungeon');
  console.log(`  ${KNOWN_DUNGEONS.length} dungeons, ${digests.length} levels`);
  // A dungeon may repeat a digest, as The Towers of Chaos does its unused levels: a match
  // is level by level. Two dungeons may not share one, but for a release and the dungeon
  // it is a variant of.
  const owners = new Map<string, Set<string>>();
  for (const dungeon of KNOWN_DUNGEONS) {
    for (const digest of dungeon.signature) owners.set(digest, (owners.get(digest) ?? new Set()).add(dungeon.name));
  }
  check([...owners.values()].every((names) => names.size === 1 || (names.size === 2 && [...names].some((name) => variants(name, [...names])))),
    'no two dungeons of the catalogue have a level with one digest, but a variant and its dungeon');
  check(KNOWN_DUNGEONS.every((d) => d.variantOf === undefined || KNOWN_DUNGEONS.some((o) => o.name === d.variantOf && o.variantOf === undefined)),
    'a variant names a catalogue dungeon, itself no variant');
  const v10 = known(DM_10);
  const shared = v10.signature.filter((digest, level) => digest === known(DM).signature[level]).length;
  console.log(`  ${DM_10}: ${shared} of its ${v10.signature.length} levels are ${DM}'s`);
  check(v10.variantOf === DM && shared === 13 && v10.signature[5] !== known(DM).signature[5],
    `${DM_10} is ${DM} but for its level 6, which 1.1 gave the skeleton closets`);
}

/** Whether `name` is a variant of the other of `names`, a pair. */
function variants(name: string, names: string[]): boolean {
  return known(name).variantOf === names.find((other) => other !== name);
}

/* ------------------------------------------------------------- 3. the saves --- */

async function checkSaves(): Promise<void> {
  console.log('\n=== 3. each committed save against every known dungeon ===');
  console.log(['save', 'level', 'd.Time', ...KNOWN_DUNGEONS.map((d) => d.name), 'is'].join('\t'));
  const saves = [
    ...genuineSaves().map((path) => ({ path, own: DM })),
    { path: resolve(MINI), own: CSB },
    { path: resolve(CSB_SAVE), own: CSB },
  ];
  const times: number[] = [];
  for (const { path, own } of saves) {
    const name = basename(path);
    const bytes = read(path);
    const info = readCsbwinSaveInfo(bytes);
    const signature = await dungeonSignature(loadCsbwinWorld(bytes).dungeon);
    const counts = againstEach(signature);
    const match = identifyDungeon(signature);
    console.log([
      name, info?.level ?? '?', info?.time ?? '?',
      ...KNOWN_DUNGEONS.map((d, i) => `${counts[i]}/${d.signature.length}`), match?.dungeon.name ?? '-',
    ].join('\t'));
    check(match?.dungeon === known(own) && match.whole, `${name}: it is ${own}'s, every level`);
    check(KNOWN_DUNGEONS.every((d, i) => d === known(own) || d.variantOf === own || counts[i] === 0),
      `${name}: and no level of it is another dungeon's, but a variant's`);
    if (own === DM && info) times.push(info.time);
  }
  check(saves.length === 10, `ten saves are read (got ${saves.length})`);
  const early = Math.min(...times);
  const late = Math.max(...times);
  console.log(`  Dungeon Master's saves run from d.Time ${early} to ${late}`);
  check(early < 1000 && late > 100000, 'they are early saves and late ones');
}

/* ------------------------------------------------------ 4. the port's save --- */

async function checkOwnSave(): Promise<void> {
  console.log('\n=== 4. the port\'s own save ===');
  const game = stockGame();
  const bytes = buildSaveFile(game);
  const match = identifyDungeon(await dungeonSignature(loadCsbwinWorld(bytes).dungeon));
  console.log(`  a new game saved, ${bytes.length} bytes: ${match?.dungeon.name ?? '-'}, ${match?.levels ?? 0} levels`);
  check(match?.dungeon === known(DM) && match.whole, `the file the port writes is ${DM}'s`);
}

/* ------------------------------------------------- 5. what the signature sees --- */

async function checkCoarseness(): Promise<void> {
  console.log('\n=== 5. what the signature sees, on csbgame7.dat\'s world ===');
  const dm = known(DM);
  const world = loadCsbwinWorld(read(savePath('csbgame7.dat'))).dungeon;
  const own = await dungeonSignature(world);
  const differing = (signature: readonly string[]): number[] =>
    own.map((digest, level) => (digest === signature[level] ? -1 : level)).filter((level) => level >= 0);
  const report = (what: string, signature: readonly string[]): void => {
    const match = identifyDungeon(signature);
    console.log(`  ${what}: levels ${differing(signature).join(' ') || 'none'} differ; `
      + `${match ? `${match.dungeon.name}, ${match.levels} of ${signature.length}${match.whole ? ', whole' : ''}` : 'no known dungeon'}`);
  };

  // What it does not see.
  const lowBits = await dungeonSignature(withCells(world, (flag) => flag ^ 0x1f));
  report('every cell\'s attributes and has-objects bit flipped', lowBits);
  check(differing(lowBits).length === 0, 'a cell\'s attributes and objects are not in the signature');
  const allOpen = await dungeonSignature(withCells(world, (flag) => (flag >> 5 === 0 ? flag : 0x20 | (flag & 0x1f))));
  report('every cell that is not stone made a plain floor', allOpen);
  check(differing(allOpen).length === 0, 'nor is a cell\'s type, among those that are not stone');

  // What it sees: one cell, one level.
  const stone = world.maps[3].cellFlags.flat().findIndex((flag) => flag >> 5 === 0);
  const floor = world.maps[5].cellFlags.flat().findIndex((flag) => flag >> 5 !== 0);
  const at = (level: number, cell: number, x: number, y: number): boolean => cell === x * world.maps[level].descriptor.height + y;
  const opened = await dungeonSignature(withCells(world, (flag, level, x, y) => (level === 3 && at(3, stone, x, y) ? 0x20 : flag)));
  report('one wall of level 3 opened', opened);
  check(differing(opened).join() === '3', 'a wall opened changes its level\'s digest, and no other');
  const walled = await dungeonSignature(withCells(world, (flag, level, x, y) => (level === 5 && at(5, floor, x, y) ? 0x00 : flag)));
  report('one cell of level 5 walled', walled);
  check(differing(walled).join() === '5', 'a cell walled changes its level\'s digest, and no other');
  const most = identifyDungeon(opened);
  check(most?.dungeon === dm && most.levels === 13 && !most.whole, `such a save is most of ${DM}, 13 levels, and not the whole`);

  // The size is in the digest: level 4's bits, column by column, in a level of its
  // height by its width.
  const { width, height } = world.maps[4].descriptor;
  const flat = world.maps[4].cellFlags.flat();
  const turned: MapData = {
    ...world.maps[4],
    descriptor: { ...world.maps[4].descriptor, width: height, height: width },
    cellFlags: Array.from({ length: height }, (_, x) => flat.slice(x * width, (x + 1) * width)),
  };
  const resized = await dungeonSignature({ ...world, maps: world.maps.map((map, level) => (level === 4 ? turned : map)) });
  report(`level 4's ${width}x${height} cells as ${height}x${width}`, resized);
  check(hex(levelWalls(turned).subarray(2)) === hex(levelWalls(world.maps[4]).subarray(2)), 'the two levels have the same bits');
  check(differing(resized).join() === '4', 'and not the same digest: the size is in it');

  // The count of levels, and each level against the one of its own number.
  const short = own.slice(0, 13);
  report('the last level left out', short);
  const shortMatch = identifyDungeon(short);
  check(shortMatch?.dungeon === dm && shortMatch.levels === 13 && !shortMatch.whole, 'thirteen levels of fourteen are not the whole dungeon');
  const long = [...own, own[0]];
  report('a fifteenth level', long);
  const longMatch = identifyDungeon(long);
  check(longMatch?.dungeon === dm && longMatch.levels === 14 && !longMatch.whole, 'nor are fourteen of fifteen');
  const shifted = [own[13], ...own.slice(0, 13)];
  report('each level one further down', shifted);
  check(identifyDungeon(shifted) === null, 'a level counts against the level of its own number, and a save that matches none has no dungeon');
  check(identifyDungeon([]) === null, 'nor has a dungeon of no level');

  // A dungeon that is another's first levels.
  const longer: KnownDungeon = { name: 'longer', dataSets: [], signature: long };
  const exact: KnownDungeon = { name: 'exact', dataSets: [], signature: own };
  const first = identifyDungeon(own, [longer, exact]);
  check(first?.dungeon === exact && first.whole, 'the dungeon a save is the whole of comes before one it is the first levels of');
  const only = identifyDungeon(own, [longer]);
  check(only?.dungeon === longer && only.levels === 14 && !only.whole, 'which alone is what it looks like, and not its dungeon');
}

/* ------------------------------------------- 6. a save and a data set --- */

async function checkAgainstDataSet(): Promise<void> {
  console.log('\n=== 6. what a save\'s walls are to a data set (`checkDungeon`) ===');
  const save = await dungeonWalls(loadCsbwinWorld(read(savePath('csbgame7.dat'))).dungeon);
  const dm = await dungeonWalls(dungeonDat('tools/fixtures/gamefiles/dm-atari/dungeon.dat'));
  const mini = await dungeonWalls(loadCsbwinWorld(read(MINI)).dungeon);
  const prison = await dungeonWalls(dungeonDat('tools/fixtures/gamefiles/csb/dungeon.dat'));
  const csbOwn = [prison, mini];
  const { shapes, signature } = save;
  // Thirteen levels the same and one not: a wall moved on level 13, its shape kept.
  const most: DungeonWalls = { shapes, signature: [...signature.slice(0, 13), signature[0]] };
  const say = (what: string, walls: DungeonWalls, set: string, own: readonly DungeonWalls[], elsewhere = false,
    known?: readonly KnownDungeon[]): string => {
    const result = checkDungeon(walls, set, own, elsewhere, known);
    const line = result.kind === 'other' ? `other, ${result.dungeon.name}` : result.kind;
    console.log(`  ${what}, in ${set}${elsewhere ? ', elsewhere' : ''}: ${line}`);
    return line;
  };
  check(dm.shapes.length === 14 && dm.shapes.every(([w, h], level) => w === shapes[level][0] && h === shapes[level][1]),
    'a level\'s shape is its width and height: the save\'s are dungeon.dat\'s');
  for (const set of known(DM).dataSets) {
    check(say('a save of Dungeon Master', save, set, [dm]) === 'own', `in ${set}, a save of ${DM} is the set's own, against its dungeon.dat`);
  }
  check(say('thirteen of its levels and one that is not', most, 'dm-atari', [dm]) === 'different',
    'the same levels, the same shapes and some of the digests: a slightly different dungeon');
  check(say('the same shapes, no digest the same', { shapes, signature: [signature[13], ...signature.slice(0, 13)] }, 'dm-atari', [dm]) === 'unknown',
    'the same levels and shapes and no digest the same is another dungeon, refused');
  const turned = shapes.map(([w, h], level) => (level === 4 ? [h, w] as const : [w, h] as const));
  check(say('level 4 turned a quarter', { shapes: turned, signature }, 'dm-atari', [dm]) === 'unknown'
    && say('one level of it', { shapes: shapes.slice(0, 1), signature: signature.slice(0, 1) }, 'dm-atari', [dm]) === 'unknown',
    'a level of another shape, or another number of levels, is not the set\'s: the catalogue does not name the set\'s own dungeon');
  check(say('the same, elsewhere', most, 'dm-atari', [dm], true) === 'unknown',
    'nor does LOOK FOR A BETTER MATCH: the other sets alone are looked at');
  check(say('a save of Dungeon Master', save, 'dm-atari', []) === 'unknown',
    'a set whose dungeon.dat does not read has no own dungeon, and the catalogue still leaves its own out');
  check(say('a save of Dungeon Master', save, 'csb', csbOwn) === `other, ${DM}` && say('thirteen of its levels', most, 'csb', csbOwn) === `other, ${DM}`,
    'in another set, the whole of it or most of it is another dungeon\'s');
  check(say('mini.dat', mini, 'csb', csbOwn) === 'own' && say('the prison', prison, 'csb', csbOwn) === 'own',
    'the csb set has two dungeons of its own, its dungeon.dat and mini.dat');
  check(say('mini.dat', mini, 'dm-atari', [dm]) === `other, ${CSB}`, `and in Dungeon Master ${CSB} is another dungeon's`);
  // Dungeon Master 1.0, a variant: a save of one release in a set of the other is a slightly
  // different dungeon; neither release is the other's "other" dungeon, as neither is the
  // running set's; in another game it is the release it is the whole of.
  const v10 = await dungeonWalls(dungeonDat('tools/fixtures/gamefiles/dm-atari-1.0a/dungeon.dat'));
  check(say('Dungeon Master 1.0', v10, 'dm-atari-1.2', [dm]) === 'different' && say('a save of Dungeon Master', save, 'dm-atari-1.0a', [v10]) === 'different',
    `${DM_10} and ${DM} are slightly different dungeons, in a set of either`);
  check(say('level 4 turned a quarter', { shapes: turned, signature }, 'dm-atari-1.0a', [v10]) === 'unknown',
    `nor does the catalogue name ${DM} in a set of ${DM_10}, its release`);
  check(say('Dungeon Master 1.0', v10, 'csb', csbOwn) === `other, ${DM_10}` && say('a save of Dungeon Master', save, 'csb', csbOwn) === `other, ${DM}`,
    'in another game, each release is told by its walls');
  const unplayed: KnownDungeon = { name: 'unplayed', dataSets: [], signature };
  const result = checkDungeon(save, 'local:x', [], false, [unplayed]);
  check(say('a dungeon no data set plays', save, 'local:x', [], false, [unplayed]) === 'other, unplayed'
    && result.kind === 'other' && result.dungeon.dataSets.length === 0,
    'a known dungeon no data set plays is another dungeon\'s, with no set to switch to');

  // A set the catalogue does not list: a player's own, or a published one.
  const SET = 'conflux-2';
  check(say('a save of Dungeon Master', save, SET, []) === `other, ${DM}` && say('a save of Dungeon Master, the set holding it', save, SET, [dm]) === 'own',
    'a set that holds Dungeon Master\'s dungeon has its saves, which the catalogue alone calls another dungeon\'s');
  check(say('thirteen of its levels', most, SET, [dm]) === 'different' && say('the same, elsewhere', most, SET, [dm], true) === `other, ${DM}`,
    'part of it is a slightly different dungeon, and LOOK FOR A BETTER MATCH finds the catalogue\'s');
  check(say('a save of Dungeon Master, the set holding thirteen of its levels', save, SET, [most]) === 'different',
    'the other way round too: the set\'s dungeon moved since the save');
  check(say('mini.dat', mini, SET, [dm]) === `other, ${CSB}`, 'and a dungeon of other shapes goes on to the other sets');

  // A published set's dungeon, whose levels' sizes the server keeps (`parsePublishedDungeons`).
  const nothing = '0'.repeat(64);
  const published = (...dungeons: KnownDungeon[]): KnownDungeon[] => [...KNOWN_DUNGEONS, ...dungeons];
  const mod: KnownDungeon = { name: 'a published mod', dataSets: ['a-mod'], shapes, signature: [...signature.slice(0, 13), nothing] };
  check(say('a save of Dungeon Master, a mod of it published', save, 'csb', csbOwn, false, published(mod)) === `other, ${DM}`
    && say('thirteen of its levels, the mod published', most, 'csb', csbOwn, false, published(mod)) === 'other, a published mod',
    'a published set is named where it matches the most levels: a save of Dungeon Master is still Dungeon Master\'s, and one of the mod\'s, the mod\'s');
  const other = 'f'.repeat(64);
  const tied: DungeonWalls = { shapes, signature: [...signature.slice(0, 12), other, other] };
  const sizes = { ...mod, name: 'a mod of its sizes', dataSets: ['sized'], signature: [...signature.slice(0, 12), nothing, nothing] };
  check(say('twelve of its levels, a mod of its sizes published', tied, 'csb', csbOwn, false, published(sizes)) === 'other, a mod of its sizes'
    && say('the same, the mod\'s level 4 turned', tied, 'csb', csbOwn, false, published({ ...sizes, shapes: turned })) === `other, ${DM}`,
    'between two that match as many levels, the one whose levels are the save\'s in number and size: as an own dungeon is, where the sizes are known');
  check(say('in the mod itself, its dungeon.dat not read', most, 'a-mod', [], false, published(mod)) === `other, ${DM}`, 'and the running set\'s own entry is never named');
  const parsed = parsePublishedDungeons(JSON.stringify({ dataSets: [{ id: 'a-mod', name: 'A mod', shapes, signature: mod.signature }] }));
  check(parsed.length === 1 && parsed[0].name === 'A mod' && parsed[0].dataSets.join() === 'a-mod' && parsed[0].signature.join() === mod.signature.join()
    && JSON.stringify(parsed[0].shapes) === JSON.stringify(shapes), 'the server\'s answer reads as the dungeons the sets play');
  const refused = [
    'nonsense', '{}', JSON.stringify({ dataSets: [{ name: 'x', shapes, signature }] }),
    JSON.stringify({ dataSets: [{ id: 'x', name: 'x', shapes, signature: ['beef'] }] }),
    JSON.stringify({ dataSets: [{ id: 'x', name: 'x', shapes: shapes.slice(1), signature }] }),
    JSON.stringify({ dataSets: [{ id: 'x', name: 'x', shapes: [[0, 1], ...shapes.slice(1)], signature }] }),
  ].filter((text) => {
    try {
      parsePublishedDungeons(text);
      return false;
    } catch {
      return true;
    }
  });
  check(refused.length === 6, 'one that is not JSON, has no list, a set without an id, a digest that is not one, or a size missing or of zero throws');
}

async function printFile(path: string): Promise<void> {
  const bytes = read(path);
  let dungeon: DungeonData;
  try {
    dungeon = loadCsbwinWorld(bytes).dungeon;
  } catch {
    dungeon = new DungeonLoader().loadDungeonDat(bytes);
  }
  const signature = await dungeonSignature(dungeon);
  const match = identifyDungeon(signature);
  console.log(`=== ${path}: ${match ? `${match.dungeon.name}, ${match.levels} of ${signature.length} levels` : 'no known dungeon'} ===`);
  for (const digest of signature) console.log(`            '${digest}',`);
  console.log('');
}

async function main(): Promise<void> {
  const path = process.argv[2];
  if (path) await printFile(path);
  await checkInput(stockDungeon());
  await checkCatalogue();
  await checkSaves();
  await checkOwnSave();
  await checkCoarseness();
  await checkAgainstDataSet();
  finish();
}

main();
