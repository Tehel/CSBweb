/**
 * A `dungeon.dat` written with its Extended Features block (`buildDungeonFile`), read back
 * as a new game reads it (`DungeonLoader.loadDungeonDat`, `ReadDatabases`,
 * doc/CSBwin-src/SaveGame.cpp:2558-2586).
 *
 * The canary is the original dungeon. Read, written and read again, the world must come
 * back whole: the header, every level, every cell flag and per-level table, the object
 * list and its column index, the text, every record of every database, and the object
 * index itself, slot for slot. Written again, the bytes must be the same, so the form is
 * a fixed point rather than drifting a little with each pass.
 *
 * Two things are not carried, and both are a save's rules too. A free record's second RN
 * (a scroll's text, a chest's or a monster's possession, a missile's object) is written
 * `RNnul`, because the reader drops it (`writtenSecondary`): `dm-atari`'s free scroll 33
 * keeps its text only until the write. And the block's own fields a file without one
 * leaves absent come back empty: no DSA level entry, no hint key, no spell filter, no
 * extended wall decorations.
 *
 * And the form is CSBWin's own: `dm-windows/dungeon.dat` is DM's dungeon written by CSBWin's
 * side (`doc/PROVEN_FACTS.md` → "DM's two `dungeon.dat` files"), and read and written
 * again it comes back with the same object index maps and the same image, byte for byte,
 * but for the word free scroll 33 holds its text in and the checksum that sums it. Its
 * block differs only where the file says what the port has no use for: 32 bytes of game
 * information ("No game information was provided"), `editingOptions` 12 and the flag bit
 * 0x02 that `EXTENDEDFEATURESBLOCK::FLAGS` does not name (`doc/CSBwin-src/CSB.h:472-481`).
 *
 * Then a new game on each, the same seed, the same champion and the same moves: the two
 * must play alike, tick for tick, to the whole runtime state. And the block's `DMRules`
 * gives the rule the data set's `dmRules` gave the file without one.
 *
 * The stock dungeon, and any `dungeon.dat` named after it with the `graphics.dat` beside
 * it (`npm test -- --only=dump-dungeon-file.ts <dungeon.dat> <graphics.dat>`), as a
 * player's own set is checked before it is merged or edited.
 *
 * Run: `npm test -- --only=dump-dungeon-file.ts`
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DungeonLoader } from '../src/data/DungeonLoader';
import { buildDungeonFile } from '../src/data/DungeonFileWriter';
import { buildDungeonImageSections } from '../src/data/CsbwinDungeonImageWriter';
import { dbEntrySize } from '../src/data/DungeonImageLayout';
import { readExtendedFeatures, EF_FLAGS } from '../src/data/CsbwinExtendedFeatures';
import { DBType } from '../src/core/types';
import { objectIndexOf } from '../src/data/CsbwinObjectIndex';
import type { DungeonData } from '../src/data/dungeonTypes';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import type { Game } from '../src/engine/Game';
import { MovementAction } from '../src/engine/gameTypes';
import { check, finish } from './lib/check';
import { testChampion } from './lib/champion';
import { newGame, runVbl, STOCK_DIR, TICK_DUE } from './lib/game';

const read = (path: string): Uint8Array => new Uint8Array(readFileSync(resolve(path)));
const load = (bytes: Uint8Array): DungeonData => new DungeonLoader().loadDungeonDat(bytes);

const NO_GAME_INFO = 'No game information was provided';
/** The secondary RNs a free record does not carry through a write (`writtenSecondary`). */
const SECONDARY = ['possession', 'textObject', 'textReference', 'containedObject', 'projectileObject'];
/** The block's fields, as a world read from a file without one lacks them. */
const EMPTY_BLOCK_FIELDS: Record<string, (v: unknown) => boolean> = {
  // 64 levels of 32 selectors, 0xffff each: as numbers in a world, base64 in a snapshot.
  dsaLevelIndex: (v) => Array.isArray(v) && v.every((level: unknown) => typeof level === 'string'
    ? Buffer.from(level, 'base64').every((b) => b === 0xff)
    : Array.isArray(level) && level.every((n) => n === 0xffff)),
  extendedWallDecorations: (v) => v === false,
  spellFilterLocation: (v) => v === 0,
  hintKey: (v) => v === 'AAAAAAAAAAA=' || (v instanceof Uint8Array && v.every((b) => b === 0)),
  // A size of 0 written, which `ReadGameInfo` reads as its own string (`SaveGame.cpp:249-255`).
  gameInfo: (v) => {
    const info = v as { size?: number; text?: Uint8Array | string } | null;
    const text = typeof info?.text === 'string' ? Buffer.from(info.text, 'base64') : info?.text;
    return info?.size === 32 && text !== undefined && Buffer.from(text).toString('latin1') === NO_GAME_INFO;
  },
};

/** JSON, a free record without its secondary RN and an empty block field as absent. */
const json = (v: unknown): string => JSON.stringify(v, (k, x) => {
  if (x instanceof Uint8Array && k !== 'hintKey' && k !== 'text') return Array.from(x);
  if (x instanceof Uint16Array) return Array.from(x);
  if (k in EMPTY_BLOCK_FIELDS && (x === null || EMPTY_BLOCK_FIELDS[k](x))) return undefined;
  if (x && typeof x === 'object' && (x as { nextObject?: number }).nextObject === 0xffff) {
    return Object.fromEntries(Object.entries(x).filter(([key]) => !SECONDARY.includes(key)));
  }
  return x;
});

/** The parts of a world a file carries, by name. */
function parts(data: DungeonData): Record<string, unknown> {
  const index = objectIndexOf(data.rnMaps);
  return {
    header: data.header,
    maps: data.maps,
    columnIndex: data.columnIndex,
    levelIndex: data.levelIndex,
    objectList: data.objectList,
    indirectTextIndex: data.indirectTextIndex,
    compressedText: data.compressedText,
    expool: data.expool,
    dsaIndex: data.dsaIndex,
    typeMap: index.typeMap,
    indexMap: index.indexMap,
    ...Object.fromEntries(Object.entries(data.databases).map(([k, v]) => [`db.${k}`, v.records])),
  };
}

/** The runtime state hashed as `json` reads it, without `GAMEBLOCK1` (`d.RandomGameID`). */
function hash(game: Game): string {
  const { game: state, ...rest } = game.getRuntimeSaveState();
  const text = json({ ...rest, game: { ...state, block1: 0 } });
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

/**
 * A new game on `data`: a champion, a turn each way and three steps forward, then
 * `ticks` more ticks. The state's hash every eighth tick.
 */
function play(data: DungeonData, graphics: GraphicsLoader, dmRules: boolean, ticks: number): { game: Game; hashes: string[] } {
  const game = newGame(data, graphics);
  // What `main.ts` sets before a file is read; a file's block then sets its own.
  game.ctx.rules.dmRulesDesignOption = dmRules;
  game.readNewGame(data);
  game.setRandomSeed(0x2468ace0);
  game.systems.hallOfChampions.addChampion(testChampion(0));
  const moves = [MovementAction.TURN_RIGHT, MovementAction.TURN_LEFT,
    MovementAction.MOVE_FORWARD, MovementAction.MOVE_FORWARD, MovementAction.MOVE_FORWARD];
  const hashes: string[] = [];
  for (let n = 0; n < moves.length * 8 + ticks; n++) {
    if (n % 8 === 0) {
      hashes.push(hash(game));
      if (n / 8 < moves.length) game.enqueueMovement(moves[n / 8]);
    }
    runVbl(game, TICK_DUE);
  }
  hashes.push(hash(game));
  return { game, hashes };
}

function roundTrip(name: string, dungeonPath: string, graphicsPath: string): void {
  console.log(`=== ${name}: ${dungeonPath} ===`);
  const original = read(dungeonPath);
  const graphics = new GraphicsLoader();
  graphics.loadFromArray(read(graphicsPath));
  const dmRules = true;

  const before = load(original);
  const written = buildDungeonFile(before, { dmRules });
  const after = load(written);
  const ef = readExtendedFeatures(written);
  console.log(['original', original.length, 'bytes, written', written.length, 'block and maps', ef.offset,
    'slots', ef.objectIndex?.length, 'flags', ef.header?.flags.toString(16),
    'xflags', ef.header?.extendedFlags.toString(16)].join(' '));
  check(ef.header !== undefined && ef.objectIndex !== undefined, 'the file opens with a block and the object index');
  check(((ef.header?.flags ?? 0) & EF_FLAGS.DMRules) !== 0, 'the block carries DMRules');

  const a = parts(before);
  const b = parts(after);
  const differ = Object.keys({ ...a, ...b }).filter((k) => json(a[k]) !== json(b[k]));
  console.log(`parts compared ${Object.keys(a).length}, differing: ${differ.join(', ') || '-'}`);
  check(differ.length === 0, 'read back, the world is the one written');
  // A world with no game information writes a size of 0, which reads back as
  // `ReadGameInfo`'s string; without it, the world writes the same bytes again.
  check(json(buildDungeonFile({ ...after, gameInfo: before.gameInfo }, { dmRules })) === json(written),
    'and written again, the same bytes, but for the game information a size of 0 reads as');

  const { game: playedBefore, hashes: hashesBefore } = play(load(original), graphics, dmRules, 200);
  const { game: playedAfter, hashes: hashesAfter } = play(load(written), graphics, dmRules, 200);
  const parted = hashesBefore.findIndex((h, i) => h !== hashesAfter[i]);
  const pa = playedBefore.ctx.party.state;
  const pb = playedAfter.ctx.party.state;
  console.log(['new game', 'original at', json(pa.position), 'facing', pa.facing, 'tick', playedBefore.ctx.state.tickCount,
    hash(playedBefore), '| written at', json(pb.position), 'facing', pb.facing, hash(playedAfter),
    '| states compared', hashesBefore.length, 'first apart', parted].join(' '));
  check(json(playedBefore.ctx.rules) === json(playedAfter.ctx.rules), 'the two games run under the same rules');
  check(parted === -1 && hashesBefore.length === hashesAfter.length,
    'and play alike: the whole runtime state matches every eighth tick, to the 240th');
  console.log('');
}

/** `dm-windows/dungeon.dat`, CSBWin's, read and written again. */
function csbwinsOwn(): void {
  console.log('=== CSBWin\'s own: static/gamefiles/dm-windows/dungeon.dat ===');
  const file = read('static/gamefiles/dm-windows/dungeon.dat');
  const world = load(file);
  const written = buildDungeonFile(world, { dmRules: true });
  const a = readExtendedFeatures(file);
  const b = readExtendedFeatures(written);
  const mapsLength = 3 * (a.objectIndex?.length ?? 0);
  const sameMaps = json(file.subarray(512, 512 + mapsLength)) === json(written.subarray(512, 512 + mapsLength));
  const imageA = file.subarray(a.offset);
  const imageB = written.subarray(b.offset);
  const differing: number[] = [];
  for (let i = 0; i < Math.max(imageA.length, imageB.length); i++) if (imageA[i] !== imageB[i]) differing.push(i);

  // Where free scroll 33's text word lies: the databases, then the records before it.
  const options = { indirectText: true, bigActuators: true, newScrolls: true };
  const sections = buildDungeonImageSections(world, options);
  let scroll = sections.header.length + sections.levelDescriptors.length + sections.columnIndex.length +
    sections.objectList.length + sections.indirectTextIndex.length + sections.text.length;
  for (let db = 0; db < DBType.SCROLL; db++) scroll += dbEntrySize(db, options) * world.header.objectCounts[db];
  scroll += dbEntrySize(DBType.SCROLL, options) * 33 + 2;
  const expected = [scroll, scroll + 1, imageA.length - 2, imageA.length - 1];
  console.log(['file', file.length, 'written', written.length, 'slots', a.objectIndex?.length, b.objectIndex?.length,
    'image', imageA.length, imageB.length, 'differing at', differing.join(' '), 'scroll 33 text word at', scroll,
    'its records', world.databases.scrolls.records[33].nextObject.toString(16)].join(' '));
  check(sameMaps && a.objectIndex?.length === b.objectIndex?.length, 'the object index maps are CSBWin\'s, byte for byte');
  check(imageA.length === imageB.length && json(differing) === json(expected),
    'and so is the image, but for free scroll 33\'s text word and the checksum');
  // The block's bytes but its checksum (32), flags (37), editing options (40) and game
  // information size (44): the sentinel, the maps' length and checksums, the version, the
  // DSA count, and 48-511.
  const range = (f: Uint8Array) => [...f.subarray(0, 32), f[36], f[38], f[39], ...f.subarray(48, 512)].join(',');
  const blockSame = range(file) === range(written);
  check(blockSame && (file[37] ?? 0) === ((written[37] ?? 0) | 0x02) && a.header?.editingOptions === 12 &&
    a.header?.gameInfoSize === 32, 'and the block, but for game information, editing options and the unnamed bit 0x02');
  console.log('');
}

function main(): void {
  csbwinsOwn();
  roundTrip('stock', `${STOCK_DIR}/dungeon.dat`, `${STOCK_DIR}/graphics.dat`);
  const [dungeon, graphics] = process.argv.slice(2);
  if (dungeon) roundTrip('given', dungeon, graphics ?? `${STOCK_DIR}/graphics.dat`);
  finish();
}

main();
