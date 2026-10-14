/**
 * A player's own data set (`src/data/LocalDataSets.ts`) plays as the manifest's set it was
 * made from: the same files read, the same game, tick for tick.
 *
 * Each record here is built in memory, as the store would hold it, from a manifest set's
 * files on disk: DM with `dungeon.dat` alone, playing its base set's `graphics.dat`;
 * Conflux with its `CSBgraphics.dat`; CSB with its Hint Oracle. Each is read through
 * `recordFiles` and the manifest's set through its folder, by the page's own
 * `loadGameFiles`, then both games read `dungeon.dat` as the boot does, are wired as
 * `main.ts` wires them, and play the same ticks from one seed.
 *
 * Also: the id's prefix, which no manifest set may take; a set's flags from its files;
 * a record missing a file; and the form's check (`checkLocalDataSet`): the record it
 * writes is the one played here, and it refuses what the boot would die of, file by file,
 * and a dungeon it cannot start in;
 * which file a dropped one is, told by what it holds (`identifyLocalDataSetFile`);
 * a PC `dungeon.dat`, little-endian, taken as the Atari file it is the twin of (`recordFile`);
 * and what it shows the dungeon holds (`dungeonCensus`), every record in use counted
 * once, through a square's chain, a monster's possessions or a container. Node has no IndexedDB, so the store itself
 * (`BrowserDataSetStore`) is not run here.
 *
 *   npx tsx tools/dump-local-data-set.ts
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

import { LOCAL_DATA_SET_PREFIX, parseManifest, type DataSet } from '../src/data/DataSets';
import { loadGameFiles, type DataSetFiles, type GameFiles } from '../src/data/DataSetFiles';
import { Expool } from '../src/data/CsbwinExpool';
import { buildDungeonImage, buildImageChecksum } from '../src/data/CsbwinDungeonImageWriter';
import { buildExtendedFeaturesPrefix, EF_FLAGS, readExtendedFeatures, type ExtendedFeaturesBlock } from '../src/data/CsbwinExtendedFeatures';
import { dungeonSignature } from '../src/data/DungeonSignature';
import { DungeonLoader, emptyDungeonData } from '../src/data/DungeonLoader';
import { foldedSignature, Signature } from '../src/data/FileSignature';
import { isLittleEndianDungeonDat, littleEndianDungeonDat } from '../src/data/LittleEndianDungeon';
import {
  checkLocalDataSet, identifyLocalDataSetFile, isLocalDataSetId, localDataSet, recordFile, recordFiles,
  type LocalDataSetDraft, type LocalDataSetFile, type LocalDataSetRecord,
} from '../src/data/LocalDataSets';
import type { DungeonData } from '../src/data/dungeonTypes';
import { dungeonCensus, ITEM_KINDS, operationsUsed, type DungeonCensus } from '../src/engine/DungeonCensus';
import type { Game } from '../src/engine/Game';
import { csbGraphicsOpener } from '../src/engine/FileSignatures';
import { check, finish } from './lib/check';
import { DATA_SETS, dataSetNamed, diskFiles, GAMEFILES_DIR } from './lib/dataSets';
import { genuineSaves } from './lib/saves';
import { newGame, runVbl, TICK_DUE } from './lib/game';

const SEED = 0x5eed1234;
const TICKS = 200;

const blobOf = (bytes: Uint8Array): Blob => new Blob([bytes.slice()]);
const same = (a: Uint8Array | null, b: Uint8Array | null): boolean =>
  a !== null && b !== null && a.length === b.length && a.every((byte, i) => byte === b[i]);
const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value, (_, v: unknown) =>
  ArrayBuffer.isView(v) ? Array.from(v as Uint8Array) : v instanceof Map ? [...v] : v instanceof Set ? [...v] : v)).digest('hex').slice(0, 16);

/** A record of `from`'s files `names`, as the form would write it. */
async function recordOf(from: DataSet, id: string, names: LocalDataSetFile[], baseSet: string | null): Promise<LocalDataSetRecord> {
  const disk = diskFiles(from);
  const files: Partial<Record<LocalDataSetFile, Blob>> = {};
  for (const name of names) files[name] = blobOf((await disk.read(name))!);
  const signatureGame = newGame(emptyDungeonData(), (await loadGameFiles(from, disk)).graphicsLoader);
  signatureGame.readDungeonDat((await disk.read('dungeon.dat'))!);
  return {
    id: `${LOCAL_DATA_SET_PREFIX}${id}`, name: `My ${from.name}`, description: 'A test set.', authors: ['A Player'],
    dmRules: from.dmRules, baseSet, files, dungeonSignature: await dungeonSignature(signatureGame.ctx.dungeon.getData()),
    createdAt: 1_760_000_000_000,
  };
}

/** A new game of `set`, its files read through `files` and wired as `main.ts` wires them, after `TICKS` ticks from `SEED`. */
async function play(set: DataSet, files: DataSetFiles): Promise<{ loaded: GameFiles; game: Game; dungeonDat: Uint8Array }> {
  // A stream left unseeded draws its seed from `Math.random` (`CsbRandom`): Conflux's
  // DSAs' does. Each game is given the same.
  let state = SEED;
  Math.random = () => ((state = (Math.imul(state, 1103515245) + 12345) >>> 0) / 0x100000000);
  const loaded = await loadGameFiles(set, files);
  const game = newGame(emptyDungeonData(), loaded.graphicsLoader);
  loaded.csbGraphicsLoader.opener = csbGraphicsOpener(game.ctx);
  game.ctx.sounds.csbGraphics = loaded.csbGraphicsLoader;
  game.ctx.overlay.csbGraphics = loaded.csbGraphicsLoader;
  loaded.csbGraphicsLoader.cannotOpen = () => { game.ctx.overlay.active = false; };
  game.ctx.rules.dmRulesDesignOption = set.dmRules;
  const dungeonDat = (await files.read('dungeon.dat'))!;
  game.readDungeonDat(dungeonDat);
  game.ctx.random.setSeed(SEED);
  for (let t = 0; t < TICKS; t++) runVbl(game, TICK_DUE);
  return { loaded, game, dungeonDat };
}

/**
 * What a game's world holds: the dungeon's every database and square, the party, the
 * clock. Not its playthrough, which a new game draws afresh (`GameSaves.newGameRead`).
 */
function world(game: Game): string {
  const { position, facing, champions } = game.ctx.party.state;
  return digest([game.ctx.dungeon.getData(), position, facing, champions.length, game.ctx.state.tickCount]);
}

async function checkPlays(from: DataSet, names: LocalDataSetFile[], baseSet: string | null): Promise<void> {
  const record = await recordOf(from, `my-${from.id}`, names, baseSet);
  const local = localDataSet(record);
  const base = baseSet === null ? null : diskFiles(dataSetNamed(baseSet));
  const files = recordFiles(record, base);
  console.log(`=== ${record.id}: ${names.join(', ')}${baseSet ? `, ${baseSet}'s graphics.dat` : ''} ===`);
  console.log(`  flags: csbGraphics ${local.csbGraphics}, hintOracle ${local.hintOracle}, miniDat ${local.miniDat}, dmRules ${local.dmRules}, hidden ${local.hidden}`);
  check(local.id === record.id && local.name === record.name && isLocalDataSetId(local.id), 'the set is the record\'s, under its local id');
  check(local.csbGraphics === from.csbGraphics && local.hintOracle === from.hintOracle && local.dmRules === from.dmRules && !local.hidden,
    `its flags follow from its files, as ${from.id}'s manifest gives them`);
  check(!local.miniDat, 'and it has no mini.dat: no RISE');

  const mine = await play(local, files);
  const theirs = await play(from, diskFiles(from));
  const graphics = [await files.read('graphics.dat'), await diskFiles(from).read('graphics.dat')];
  console.log(`  graphics.dat from ${files.where('graphics.dat')}: ${mine.loaded.graphicsLoader.getItemCount()} items, ${same(graphics[0]!, graphics[1]!) ? 'the same bytes' : 'OTHER BYTES'}`);
  check(same(graphics[0]!, graphics[1]!) && mine.loaded.graphicsLoader.getItemCount() === theirs.loaded.graphicsLoader.getItemCount(),
    `graphics.dat is ${from.id}'s, read ${baseSet ? 'from the base set\'s folder' : 'from the record'}`);
  check(same(mine.dungeonDat, theirs.dungeonDat), 'dungeon.dat is read from the record, the folder\'s bytes');
  const overlay = [mine.loaded.csbGraphicsLoader.getSignature(), theirs.loaded.csbGraphicsLoader.getSignature()];
  check(JSON.stringify(overlay[0]) === JSON.stringify(overlay[1]), `CSBgraphics.dat ${overlay[0] ? 'is the folder\'s' : 'is absent from both'}`);
  const oracle = [mine.loaded.hintOracle, theirs.loaded.hintOracle];
  check((oracle[0] === null && oracle[1] === null) || (same(oracle[0]!.hct, oracle[1]!.hct) && digest(oracle[0]!.dat) === digest(oracle[1]!.dat)),
    `the Hint Oracle ${oracle[0] ? 'is the folder\'s' : 'is absent from both'}`);
  const worlds = [world(mine.game), world(theirs.game)];
  console.log(`  after ${TICKS} ticks from one seed: world ${worlds[0]} and ${worlds[1]}, tick ${mine.game.ctx.state.tickCount}`);
  check(worlds[0] === worlds[1] && mine.game.ctx.state.tickCount === TICKS, `the two games play the same ${TICKS} ticks`);
  check(digest(record.dungeonSignature) === digest(await dungeonSignature(mine.game.ctx.dungeon.getData())),
    'the record\'s signature is its dungeon\'s');
}


/** A draft of `from`'s files `names`, as the form gives it: base set `baseSet` where `names` holds no graphics.dat. */
async function draftOf(from: DataSet, id: string, names: LocalDataSetFile[], baseSet = 'dm-atari'): Promise<LocalDataSetDraft> {
  const disk = diskFiles(from);
  const files: Partial<Record<LocalDataSetFile, Blob>> = {};
  for (const name of names) files[name] = blobOf((await disk.read(name))!);
  return { id, name: ` My ${from.name} `, description: 'A test set.', authors: ['A Player', ' ', ' Another '], dmRules: from.dmRules, baseSet, files };
}

/** `(EDT_Database << 24) + (edbt << 16) + i` (`doc/CSBwin-src/CSB.h:1555-1559`): the records `readRuntimeFileSignatures` reads. */
const CSB_GRAPHICS = ((5 << 24) + (2 << 16) + 0) >>> 0;
const GRAPHICS = ((5 << 24) + (2 << 16) + 1) >>> 0;
const DEBUGING = ((5 << 24) + (3 << 16) + 0) >>> 0;

const base = (set: string): DataSetFiles | null => set === 'dm-atari' || set === 'csb' ? diskFiles(dataSetNamed(set)) : null;
const CREATED = 1_760_000_000_000;

/** What `checkLocalDataSet` says of `draft`, its problems as `about: text`, printed under `label`. */
async function problemsOf(label: string, draft: LocalDataSetDraft, taken: string[] = []): Promise<string[]> {
  const { problems, record } = await checkLocalDataSet(draft, new Set(taken), base, CREATED);
  const lines = problems.map(({ about, text }) => `${about}: ${text}`);
  console.log(`  ${label}: ${lines.length === 0 ? 'none' : lines.join(' | ')}${record ? ', a record' : ''}`);
  return lines;
}

async function checkForm(): Promise<void> {
  console.log('=== the form\'s check ===');
  const dm = dataSetNamed('dm-atari'), conflux = dataSetNamed('conflux-3.5'), csb = dataSetNamed('csb');
  {
    // The form checks at every key the player types: each file is read once, whatever
    // the fields do, and the same files give the same verdict.
    const draft = await draftOf(conflux, 'counted', ['dungeon.dat', 'graphics.dat', 'CSBgraphics.dat']);
    const reads = new Map<string, number>();
    for (const [name, blob] of Object.entries(draft.files) as [LocalDataSetFile, Blob][]) {
      const counted = new Blob([blob], { type: blob.type });
      const arrayBuffer = counted.arrayBuffer.bind(counted);
      counted.arrayBuffer = () => {
        reads.set(name, (reads.get(name) ?? 0) + 1);
        return arrayBuffer();
      };
      draft.files[name] = counted;
    }
    const first = await checkLocalDataSet(draft, new Set(), base, CREATED);
    const second = await checkLocalDataSet({ ...draft, name: 'Another name', id: '' }, new Set(), base, CREATED);
    const third = await checkLocalDataSet({ ...draft, name: 'A third name' }, new Set(), base, CREATED);
    console.log(`  three checks of conflux's files: ${[...reads].map(([name, n]) => `${name} read ${n}`).join(', ')}`);
    check(reads.size === 3 && [...reads.values()].every((n) => n === 1),
      'three checks of the same files, the fields changed between them, read each file once');
    check(first.record !== null && second.record === null && second.problems.map((p) => p.about).join() === 'id'
      && digest({ ...third.record, name: first.record.name, files: Object.keys(third.record!.files) }) === digest({ ...first.record, files: Object.keys(first.record.files) })
      && digest(third.census) === digest(first.census),
      'and give the same verdict on them each time');
  }
  for (const [from, names, baseSet] of [
    [dm, ['dungeon.dat'], 'dm-atari'],
    [conflux, ['dungeon.dat', 'graphics.dat', 'CSBgraphics.dat'], null],
    [csb, ['dungeon.dat', 'graphics.dat', 'hcsb.hct', 'hcsb.dat'], null],
  ] as const) {
    const draft = await draftOf(from, `my-${from.id}`, [...names], baseSet ?? 'dm-atari');
    const { problems, record } = await checkLocalDataSet(draft, new Set(['local:other']), base, CREATED);
    const expected = await recordOf(from, `my-${from.id}`, [...names], baseSet);
    console.log(`  ${from.id}: ${problems.length} problems, record ${record ? digest({ ...record, files: Object.keys(record.files) }) : 'none'}`);
    check(problems.length === 0 && record !== null && digest({ ...record, name: expected.name, description: expected.description, authors: expected.authors, files: Object.keys(record.files) })
      === digest({ ...expected, files: Object.keys(expected.files) }),
      `${from.id}'s files make the record the games above play: its id, base set, flags and signature`);
    check(record!.name === `My ${from.name}` && record!.authors.join() === 'A Player,Another' && Object.keys(record!.files).every((name) => record!.files[name as LocalDataSetFile] === draft.files[name as LocalDataSetFile]),
      'its name and authors trimmed, the empty author dropped, its files the Blobs given');
  }

  const good = await draftOf(dm, 'mine', ['dungeon.dat']);
  check((await problemsOf('no id', { ...good, id: '' })).join() === 'id: Give it an id.', 'an id is needed');
  for (const id of ['Mine', 'my set', '-mine', 'a/b', '..', 'x'.repeat(41)]) {
    check((await problemsOf(`id '${id.length > 20 ? `${id.slice(0, 8)}…` : id}'`, { ...good, id })).every((line) => line.startsWith('id: An id is')),
      `'${id.length > 20 ? `${id.length} characters` : id}' is not an id`);
  }
  check((await problemsOf('id dm-atari-1.2', { ...good, id: 'dm-atari-1.2' })).length === 0, 'a manifest\'s id is an id: the prefix keeps them apart');
  check((await problemsOf('a taken id', good, ['local:mine'])).join() === 'id: One of your dungeons already has this id.', 'an id one of the player\'s sets has is refused');
  check((await problemsOf('no name', { ...good, name: '  ' })).join() === 'name: Give it a name.', 'a name is needed');

  check((await problemsOf('no dungeon.dat', { ...good, files: {} })).join() === 'dungeon.dat: A dungeon.dat is needed.', 'a dungeon.dat is needed');
  const notDungeon = await problemsOf('a graphics.dat as dungeon.dat', { ...good, files: { 'dungeon.dat': (await draftOf(dm, 'x', ['graphics.dat'])).files['graphics.dat']! } });
  check(notDungeon.length === 1 && notDungeon[0].startsWith('dungeon.dat: It does not read: '), 'a dungeon.dat that does not read is refused: the boot\'s die(0xbad)');
  const enciphered = await problemsOf('Conflux\'s enciphered dungeon.dat, with its files', await draftOf(conflux, 'cx', ['dungeon.dat', 'graphics.dat', 'CSBgraphics.dat']));
  check(enciphered.length === 0, 'an enciphered dungeon.dat reads');
  // A dungeon the boot reads but cannot start in: a header of zeros, no level; and
  // dm-windows' dungeon.dat with the party's start square moved off its first level.
  check((await problemsOf('a dungeon.dat of 44 zeros', { ...good, files: { 'dungeon.dat': blobOf(new Uint8Array(44)) } })).join()
    === 'dungeon.dat: It has no level.', 'a dungeon.dat of zeros reads as no level, and is refused');
  const startingAt = (x: number, y: number): Blob => {
    const file = new Uint8Array(readFileSync('static/gamefiles/dm-windows/dungeon.dat'));
    const ef = readExtendedFeatures(file);
    const data = new DungeonLoader().loadDungeonDat(file);
    data.header.startPosition.x = x;
    data.header.startPosition.y = y;
    const image = buildDungeonImage(data, { bigActuators: ef.bigActuators, newScrolls: ef.version >= 0x42, indirectText: ef.indirectText });
    return new Blob([file.slice(0, ef.offset), new Uint8Array(image), new Uint8Array(buildImageChecksum(image))]);
  };
  check((await problemsOf('a start on the first level\'s last square', { ...good, files: { 'dungeon.dat': startingAt(18, 18) } })).length === 0,
    'a start on the first level\'s last column and row is taken');
  check((await problemsOf('a start past its last column', { ...good, files: { 'dungeon.dat': startingAt(19, 3) } })).join()
    === 'dungeon.dat: The party starts at (19, 3), off the first level, which is 19 by 19.', 'a start past its last column is refused');
  check((await problemsOf('a start past its last row', { ...good, files: { 'dungeon.dat': startingAt(1, 19) } })).length === 1,
    'and past its last row');

  const notGraphics = await problemsOf('a dungeon.dat as graphics.dat', { ...good, files: { ...good.files, 'graphics.dat': good.files['dungeon.dat']! } });
  check(notGraphics.length === 1 && notGraphics[0].startsWith('graphics.dat: It is not a graphics.dat: '), 'a graphics.dat that does not parse is refused');
  check((await problemsOf('an unknown base set', { ...good, baseSet: 'nowhere' })).join() === "baseSet: The graphics.dat of 'nowhere' cannot be read.",
    'without a graphics.dat, the base set\'s must read');
  check((await problemsOf('Conflux on DM\'s graphics.dat', await draftOf(conflux, 'cx', ['dungeon.dat', 'CSBgraphics.dat']))).length === 0,
    'a dungeon that names no graphics.dat plays any');
  check((await problemsOf('Conflux without its CSBgraphics.dat', await draftOf(conflux, 'cx', ['dungeon.dat', 'graphics.dat']))).length === 0,
    'a dungeon whose block expects no CSBgraphics.dat plays without one, as CSBWin does: the overlay does not open');

  // What no shipped dungeon does: name its graphics files. dm-windows' dungeon.dat, its
  // EXPOOL given `EDBT_RuntimeFileSignatures` records and written back behind its block;
  // and a block expecting a CSBgraphics.dat, before CSB's compressed dungeon.dat.
  const dmGraphics = (await diskFiles(dm).read('graphics.dat'))!;
  const fold = foldedSignature(Signature(dmGraphics));
  const fixtureBytes = new Uint8Array(readFileSync('tools/fixtures/csbgraphics/CSBgraphics.dat'));
  const fixture = blobOf(fixtureBytes);
  const csbFold = foldedSignature(Signature(fixtureBytes)) || 1;
  const naming = (records: [number, number][]): Blob => {
    const file = new Uint8Array(readFileSync('static/gamefiles/dm-windows/dungeon.dat'));
    const ef = readExtendedFeatures(file);
    const data = new DungeonLoader().loadDungeonDat(file);
    for (const [key, value] of records) new Expool(data).write(key, [value]);
    const image = buildDungeonImage(data, { bigActuators: ef.bigActuators, newScrolls: ef.version >= 0x42, indirectText: ef.indirectText });
    return new Blob([file.slice(0, ef.offset), new Uint8Array(image), new Uint8Array(buildImageChecksum(image))]);
  };
  const named = (records: [number, number][], files: Partial<Record<LocalDataSetFile, Blob>> = {}, baseSet = 'dm-atari'): LocalDataSetDraft =>
    ({ ...good, baseSet, files: { 'dungeon.dat': naming(records), ...files } });
  check((await problemsOf('a dungeon naming DM\'s graphics.dat, on DM\'s', named([[GRAPHICS, fold]]))).length === 0,
    'a dungeon naming its graphics.dat plays on it');
  check((await problemsOf('…on CSB\'s', named([[GRAPHICS, fold]], {}, 'csb')))[0]?.startsWith('baseSet: The dungeon was made for another graphics.dat (signature '),
    'and is refused another base set\'s: the boot\'s die(0x3c6c)');
  check((await problemsOf('…on CSB\'s, given', named([[GRAPHICS, fold]], { 'graphics.dat': (await draftOf(csb, 'x', ['graphics.dat'])).files['graphics.dat']! })))[0]
    ?.startsWith('graphics.dat: The dungeon was made for another graphics.dat'), 'or another graphics.dat given');
  check((await problemsOf('…on CSB\'s, under EDBT_Debuging', named([[GRAPHICS, fold], [DEBUGING, 1]], {}, 'csb'))).length === 0,
    'a nonzero EDBT_Debuging checks no signature');
  check((await problemsOf('a dungeon naming the fixture\'s CSBgraphics.dat, with it', named([[CSB_GRAPHICS, csbFold]], { 'CSBgraphics.dat': fixture }))).length === 0,
    'a dungeon naming its CSBgraphics.dat plays with it');
  check((await problemsOf('…naming another', named([[CSB_GRAPHICS, csbFold ^ 1]], { 'CSBgraphics.dat': fixture })))[0]
    ?.startsWith('CSBgraphics.dat: The dungeon was made for another CSBgraphics.dat'), 'and is refused another: the boot\'s die(0x3c6c)');
  const header: ExtendedFeaturesBlock = {
    version: 0x41, flags: EF_FLAGS.LevelDSAInfoPresent, numDSA: 0, editingOptions: 0, gameInfoSize: 0, cellFlagArraySize: 0,
    graphicsSignature1: 0, graphicsSignature2: 0, spellFilterLocation: 0, extendedFlags: 0,
    overlayOrdinal: 0, overlayP1: 0, overlayP2: 0, overlayP3: 0, overlayP4: 0,
    csbGraphicsSignature1: 1, csbGraphicsSignature2: 0, hintKey: new Uint8Array(8),
  };
  const expecting = new Blob([new Uint8Array(buildExtendedFeaturesPrefix({ header, typeMap: new Uint8Array(0), indexMap: new Uint16Array(0) })),
    readFileSync('static/gamefiles/csb/dungeon.dat')]);
  check((await problemsOf('a block expecting a CSBgraphics.dat, without', { ...good, files: { 'dungeon.dat': expecting } })).join()
    === 'CSBgraphics.dat: The dungeon needs its CSBgraphics.dat.', 'a dungeon whose block expects a CSBgraphics.dat needs one: the boot\'s die(0xbad)');
  check((await problemsOf('…with one', { ...good, files: { 'dungeon.dat': expecting, 'CSBgraphics.dat': fixture } })).length === 0, 'and plays with one');
  const notOverlay = await problemsOf('DM with a dungeon.dat as CSBgraphics.dat', { ...good, files: { ...good.files, 'CSBgraphics.dat': good.files['dungeon.dat']! } });
  check(notOverlay.length === 1 && notOverlay[0].startsWith('CSBgraphics.dat: It is not a CSBgraphics.dat: '), 'a CSBgraphics.dat that does not parse is refused');

  const csbFull = await draftOf(csb, 'c', ['dungeon.dat', 'graphics.dat', 'hcsb.hct', 'hcsb.dat']);
  const { 'hcsb.dat': _dat, ...noDat } = csbFull.files;
  const { 'hcsb.hct': _hct, ...noHct } = csbFull.files;
  check((await problemsOf('hcsb.hct alone', { ...csbFull, files: noDat })).join() === 'hcsb.dat: The Hint Oracle needs hcsb.dat beside hcsb.hct.', 'hcsb.hct alone is refused');
  check((await problemsOf('hcsb.dat alone', { ...csbFull, files: noHct })).join() === 'hcsb.hct: The Hint Oracle needs hcsb.hct beside hcsb.dat.', 'hcsb.dat alone is refused');
  const notOracle = await problemsOf('a dungeon.dat as hcsb.dat', { ...csbFull, files: { ...csbFull.files, 'hcsb.dat': csbFull.files['dungeon.dat']! } });
  check(notOracle.length === 1 && notOracle[0].startsWith("hcsb.dat: It is not the Hint Oracle's hcsb.dat: "), 'an hcsb.dat that does not parse is refused');

  const png = new Blob([readFileSync('static/gamefiles/csb/csb-thumbnail.png')], { type: 'image/png' });
  check((await problemsOf('a PNG thumbnail', { ...good, files: { ...good.files, thumbnail: png } })).length === 0, 'an image is a thumbnail');
  check((await problemsOf('a .dat thumbnail', { ...good, files: { ...good.files, thumbnail: good.files['dungeon.dat']! } })).join() === 'thumbnail: It is not an image.',
    'a file that is not an image is no thumbnail');
}

/** `census` on one line: levels, items by kind, monsters, DSAs. */
function censusLine(census: DungeonCensus): string {
  const { dsa } = census;
  return `${census.maps} maps on ${census.levels} levels; ${ITEM_KINDS.map((kind) => `${kind} ${census.items[kind]}`).join(', ')}; `
    + `${census.monsters} monsters in ${census.groups} groups of ${census.monsterTypes} types; `
    + `${dsa.dsas} DSAs, ${dsa.programs} programs, ${dsa.undecoded} undecoded, ${operationsUsed(dsa).length} operations`;
}

/**
 * The records of `data`'s item and monster databases whose link is not `RNnul`: a free
 * slot's is (`DeleteDBEntry`), so these are the records the dungeon uses, counted without
 * walking a chain.
 */
function inUse(data: DungeonData): string {
  const { databases: db } = data;
  const used = (records: { nextObject: number }[]): number => records.filter((record) => record.nextObject !== 0xffff).length;
  return [db.weapons, db.clothing, db.scrolls, db.potions, db.containers, db.misc, db.creatures].map((d) => used(d.records)).join();
}

/**
 * The form tells a dropped file by what it holds (`identifyLocalDataSetFile`), whatever
 * its name: every game file of every manifest set is the file it is, and a save, a sound,
 * an image or a set's other files are none.
 */
async function checkIdentify(): Promise<void> {
  console.log('=== a file told by what it holds ===');
  const names: LocalDataSetFile[] = ['dungeon.dat', 'graphics.dat', 'CSBgraphics.dat', 'hcsb.hct', 'hcsb.dat'];
  let told = 0, wrong: string[] = [];
  for (const set of DATA_SETS) {
    for (const name of names) {
      const path = `${set.dir}/${name}`;
      if (!existsSync(path)) continue;
      const kind = await identifyLocalDataSetFile(blobOf(new Uint8Array(readFileSync(path))));
      told++;
      if (kind !== name) wrong.push(`${path}: ${kind}`);
    }
  }
  console.log(`  ${told} game files of ${DATA_SETS.length} sets${wrong.length ? `, wrong: ${wrong.join(', ')}` : ', each the file it is'}`);
  check(wrong.length === 0 && told >= DATA_SETS.length * 2, 'every game file of every set is told by what it holds');
  const csb = dataSetNamed('csb').dir;
  const others = [...genuineSaves(), `${csb}/mini.dat`, `${csb}/utility-portraits.dat`, `${csb}/csb-thumbnail.png`,
    `${GAMEFILES_DIR}/swoosh/swoosh.img`, `${GAMEFILES_DIR}/swoosh/swoosh.wav`];
  wrong = [];
  for (const path of others) {
    const kind = await identifyLocalDataSetFile(blobOf(new Uint8Array(readFileSync(path))));
    if (kind !== null) wrong.push(`${path}: ${kind}`);
  }
  console.log(`  ${others.length} other files${wrong.length ? `, told: ${wrong.join(', ')}` : ', none of them told'}`);
  check(wrong.length === 0, 'a save, the RISE dungeon, the utility\'s portraits, an image, the swoosh and a sound are none of them');
}

/**
 * A PC `dungeon.dat` is the Atari one with its words' bytes the other way round
 * (`src/data/LittleEndianDungeon.ts`). The PC's own files are not the project's to ship,
 * so the twin here is made from DM's, with and without the checksum word: the form takes
 * it as DM's file, byte for byte, where it would not read as it is. Nothing else is told:
 * no set's game file, and no save.
 */
async function checkPcDungeon(): Promise<void> {
  console.log('=== a PC dungeon.dat ===');
  const atari = new Uint8Array(readFileSync(`${dataSetNamed('dm-atari').dir}/dungeon.dat`));
  let sum = 0;
  for (const byte of atari) sum = (sum + byte) & 0xffff;
  const summed = new Uint8Array([...atari, sum >> 8, sum & 0xff]);
  check(new DungeonLoader().loadDungeonDat(summed) !== null, "DM's dungeon.dat with its checksum word reads");
  for (const [label, image] of [['without a checksum', atari], ['with its checksum', summed]] as const) {
    const pc = littleEndianDungeonDat(image)!;
    const given = new File([pc.slice()], 'DUNGEON.DAT');
    const kept = await recordFile(given);
    const keptBytes = new Uint8Array(await kept.arrayBuffer());
    console.log(`  ${label}: told ${isLittleEndianDungeonDat(pc)}, as given ${await identifyLocalDataSetFile(given)}, `
      + `kept ${await identifyLocalDataSetFile(kept)} under ${kept.name}, ${same(keptBytes, image) ? "DM's bytes" : 'OTHER BYTES'}`);
    check(pc !== null && isLittleEndianDungeonDat(pc) && !same(pc, image), `${label}: DM's PC twin is told`);
    check(await identifyLocalDataSetFile(given) === null, `${label}: as it is, it reads as none of a set's files`);
    check(kept.name === 'DUNGEON.DAT' && same(keptBytes, image) && await identifyLocalDataSetFile(kept) === 'dungeon.dat',
      `${label}: the form keeps DM's dungeon.dat, byte for byte, under the name it was given`);
  }
  const broken = littleEndianDungeonDat(summed)!;
  broken[100] ^= 1;
  check(!isLittleEndianDungeonDat(broken), 'a PC twin whose checksum word is wrong is not told');
  const others = [...DATA_SETS.flatMap((set) => ['dungeon.dat', 'graphics.dat', 'CSBgraphics.dat', 'hcsb.dat']
    .map((name) => `${set.dir}/${name}`).filter((path) => existsSync(path))), ...genuineSaves()];
  const told: string[] = [];
  for (const path of others) {
    const file = new File([readFileSync(path)], path);
    if (isLittleEndianDungeonDat(new Uint8Array(await file.arrayBuffer())) || await recordFile(file) !== file) told.push(path);
  }
  console.log(`  ${others.length} game files and saves${told.length ? `, told: ${told.join(', ')}` : ', none of them told, each kept as it is'}`);
  check(told.length === 0, 'no set\'s game file and no save is told a PC dungeon.dat, and each is kept as it is');
}

async function checkCensus(): Promise<void> {
  console.log('=== what the dungeon holds ===');
  const expected: Record<string, string> = {
    'dm-atari': '14 maps on 14 levels; weapons 106, clothing 121, scrolls 34, potions 55, containers 12, misc 278; '
      + '303 monsters in 182 groups of 25 types; 0 DSAs, 0 programs, 0 undecoded, 0 operations',
    'conflux-3.5': '64 maps on 64 levels; weapons 478, clothing 310, scrolls 405, potions 621, containers 160, misc 1615; '
      + '2289 monsters in 1252 groups of 27 types; 131 DSAs, 4646 programs, 0 undecoded, 118 operations',
    'kids-dungeon': '3 maps on 3 levels; weapons 37, clothing 46, scrolls 3, potions 25, containers 3, misc 44; '
      + '4 monsters in 4 groups of 2 types; 0 DSAs, 0 programs, 0 undecoded, 0 operations',
  };
  for (const [set, line] of Object.entries(expected)) {
    const data = new DungeonLoader().loadDungeonDat((await diskFiles(dataSetNamed(set)).read('dungeon.dat'))!);
    const census = dungeonCensus(data);
    console.log(`  ${set}: ${censusLine(census)}`);
    check(censusLine(census) === line, `${set}'s census`);
    check(inUse(data) === [...ITEM_KINDS.map((kind) => census.items[kind]), census.groups].join(),
      `${set}: every item and monster record in use is reached once, and nothing else`);
  }
  const dm = dataSetNamed('dm-atari');
  const good = await draftOf(dm, 'mine', ['dungeon.dat']);
  const taken = await checkLocalDataSet(good, new Set(['local:mine']), base, CREATED);
  check(taken.record === null && taken.census !== null && censusLine(taken.census) === expected['dm-atari'],
    'the form shows what a dungeon.dat holds wherever it reads, whatever else is wrong');
  const unread = await checkLocalDataSet({ ...good, files: { 'dungeon.dat': (await draftOf(dm, 'x', ['graphics.dat'])).files['graphics.dat']! } },
    new Set(), base, CREATED);
  check(unread.census === null && (await checkLocalDataSet({ ...good, files: {} }, new Set(), base, CREATED)).census === null,
    'and nothing where it does not read, or is not given');
}

async function main(): Promise<void> {
  console.log('=== the id ===');
  check(isLocalDataSetId('local:mine') && !isLocalDataSetId('dm-atari') && !isLocalDataSetId(null) && !isLocalDataSetId('LOCAL:mine'),
    'a local id is one with the prefix `local:`');
  let refused = '';
  try {
    parseManifest(JSON.stringify({ default: 'local:x', dataSets: [{ id: 'local:x', name: 'X' }] }), 'gamefiles');
  } catch (error) {
    refused = error instanceof Error ? error.message : String(error);
  }
  console.log(`  a manifest set 'local:x': ${refused || 'TAKEN'}`);
  check(/an id of a player's own set/.test(refused), 'no manifest set may take the prefix, so a local set never shadows one');

  await checkPlays(dataSetNamed('dm-atari'), ['dungeon.dat'], 'dm-atari');
  await checkPlays(dataSetNamed('conflux-3.5'), ['dungeon.dat', 'graphics.dat', 'CSBgraphics.dat'], null);
  await checkPlays(dataSetNamed('csb'), ['dungeon.dat', 'graphics.dat', 'hcsb.hct', 'hcsb.dat'], null);

  console.log('=== a record missing a file ===');
  const dm = dataSetNamed('dm-atari');
  const bare = await recordOf(dm, 'bare', ['dungeon.dat'], null);
  let failed = '';
  try {
    await loadGameFiles(localDataSet(bare), recordFiles(bare, null));
  } catch (error) {
    failed = error instanceof Error ? error.message : String(error);
  }
  console.log(`  no graphics.dat and no base set: ${failed || 'LOADED'}`);
  check(failed === 'Failed to load local:bare/graphics.dat', 'with no graphics.dat and no base set, the set does not load, and the error names the file');
  const noDungeon = { ...bare, files: { 'graphics.dat': bare.files['dungeon.dat']! } };
  check(await recordFiles(noDungeon, null).read('dungeon.dat') === null, 'a file the record does not hold is read as none: the boot\'s die(50)');
  const halfOracle = await recordOf(dataSetNamed('csb'), 'half', ['dungeon.dat', 'graphics.dat', 'hcsb.hct'], null);
  check(!localDataSet(halfOracle).hintOracle, 'one of the Oracle\'s two files is no Hint Oracle');
  const withThumbnail = { ...bare, files: { ...bare.files, thumbnail: blobOf(new Uint8Array([0x89, 0x50, 0x4e, 0x47])) } };
  check(await recordFiles(withThumbnail, diskFiles(dm)).read('thumbnail') === null, 'the thumbnail is not one of the game\'s files');
  await checkForm();
  await checkIdentify();
  await checkPcDungeon();
  await checkCensus();
  finish();
}

void main();
