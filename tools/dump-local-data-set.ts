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
 * a record missing a file. Node has no IndexedDB, so the store itself
 * (`BrowserDataSetStore`) is not run here.
 *
 *   npx tsx tools/dump-local-data-set.ts
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { LOCAL_DATA_SET_PREFIX, parseManifest, type DataSet } from '../src/data/DataSets';
import { loadGameFiles, type DataSetFiles, type GameFiles } from '../src/data/DataSetFiles';
import { dungeonSignature } from '../src/data/DungeonSignature';
import { emptyDungeonData } from '../src/data/DungeonLoader';
import {
  isLocalDataSetId, localDataSet, recordFiles,
  type LocalDataSetFile, type LocalDataSetRecord,
} from '../src/data/LocalDataSets';
import type { Game } from '../src/engine/Game';
import { csbGraphicsOpener } from '../src/engine/FileSignatures';
import { check, finish } from './lib/check';
import { dataSetNamed } from './lib/dataSets';
import { newGame, runVbl, TICK_DUE } from './lib/game';

const SEED = 0x5eed1234;
const TICKS = 200;

/** `set`'s folder on disk, as `folderFiles` serves it to the page. */
function diskFiles(set: DataSet): DataSetFiles {
  return {
    async read(name) {
      try {
        return new Uint8Array(readFileSync(`${set.dir}/${name}`));
      } catch {
        return null;
      }
    },
    where: (name) => `${set.dir}/${name}`,
  };
}

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
  finish();
}

void main();
