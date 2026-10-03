/**
 * A `dungeon.dat` that opens with an Extended Features block: the DM Windows package's
 * (`static/gamefiles/dm-windows/`), read by `DungeonLoader.loadDungeonDat` as
 * `ReadDatabases` reads it (doc/CSBwin-src/SaveGame.cpp:2346-2374): `ReadExtendedFeatures`
 * first, then the image behind the block, in the shape the block declares.
 *
 * The canary is the world itself. The file is DM's dungeon re-saved by CSBWin
 * (doc/PROVEN_FACTS.md → "DM's two `dungeon.dat` files"), so read through the block it
 * must come out as `dm-atari`'s after `convertOriginalDungeon`, differing only where that
 * entry says: 18 mirrors' `Position`, scroll debris, one EXPOOL record. A wrong offset, shape or
 * object map would scramble every database, not three.
 *
 * Then the rules: a new game takes `DMRulesDesignOption` from the block's `DMRules` and
 * `DM_rules` from `DMRulesOption` (`:392-398`), at boot and after a lost game, and a file
 * with no block leaves them.
 *
 * And a compressed body behind a block, which no shipped file has: a block built with
 * `buildExtendedFeaturesPrefix` in front of CSB's compressed `dungeon.dat` reads as CSB's
 * own, the body taken from byte 8 plus the block's size (`:2362-2369`). The `'@'` case,
 * whose body starts at byte 8 of the file, inside the block, is transcribed but has no
 * file that exercises it.
 *
 * Run: `npx tsx tools/dump-extended-dungeon.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DungeonLoader, emptyDungeonData } from '../src/data/DungeonLoader';
import { buildExtendedFeaturesPrefix, EF_FLAGS, type ExtendedFeaturesBlock } from '../src/data/CsbwinExtendedFeatures';
import type { Databases, DungeonData } from '../src/data/dungeonTypes';
import { check, finish } from './lib/check';
import { newGame, stockGraphics } from './lib/game';

const read = (path: string): Uint8Array => new Uint8Array(readFileSync(resolve(path)));
const load = (bytes: Uint8Array): DungeonData => new DungeonLoader().loadDungeonDat(bytes);

const json = (v: unknown): string => JSON.stringify(v, (_k, x) => (x instanceof Uint8Array ? Array.from(x) : x));

/** The indices of the records of one database that differ between two worlds. */
function differing(a: Databases, b: Databases, key: keyof Databases): number[] {
  const ra: unknown[] = a[key].records;
  const rb: unknown[] = b[key].records;
  const out: number[] = [];
  for (let i = 0; i < Math.max(ra.length, rb.length); i++) if (json(ra[i]) !== json(rb[i])) out.push(i);
  return out;
}

function main(): void {
  const atari = load(read('static/gamefiles/dm-atari/dungeon.dat'));
  const windows = load(read('static/gamefiles/dm-windows/dungeon.dat'));
  const ef = windows.extendedFeatures;

  console.log('== the block ==');
  check(atari.extendedFeatures === undefined, 'dm-atari opens with no block');
  check(ef !== undefined, 'dm-windows opens with one');
  if (!ef) return;
  console.log(`  version '${String.fromCharCode(ef.version)}', flags 0x${ef.flags.toString(16)}, ` +
    `extendedFlags 0x${ef.extendedFlags.toString(16)}, cellFlagArraySize ${ef.cellFlagArraySize}`);
  check(ef.flags === 0xeb && ef.extendedFlags === 0xf0, 'flags 0xeb and extendedFlags 0xf0, as PROVEN_FACTS records');
  check(windows.bigActuators === true && windows.indirectText === true && windows.newScrolls === true,
    'the image is read save-shaped: big actuators, indirect text, six-byte scrolls');
  check(windows.extendedWallDecorations === true, 'ExtendedWallDecorations is taken from the block');
  check(windows.word22592 === undefined, 'the body behind the block is not compressed');

  console.log('== the world against dm-atari converted ==');
  check(json(windows.header) === json({ ...atari.header, objectCounts: windows.header.objectCounts }),
    'the header, but for the object counts');
  const counts = windows.header.objectCounts.map((n, i) => n - atari.header.objectCounts[i]!);
  console.log(`  object counts, dm-windows less dm-atari: ${counts.join(' ')}`);
  check(counts.every((n, i) => n === (i === 11 ? 1 : 0)), 'the counts differ by the one EXPOOL record');
  check(json(windows.maps) === json(atari.maps), 'every level descriptor and cell flag');
  check(json(windows.objectList) === json(atari.objectList) && json(windows.columnIndex) === json(atari.columnIndex),
    'the object list and its column index');
  check(json(windows.indirectTextIndex) === json(atari.indirectTextIndex)
    && json(windows.compressedText) === json(atari.compressedText), 'all the text');
  for (const key of Object.keys(atari.databases) as (keyof Databases)[]) {
    const diff = differing(windows.databases, atari.databases, key);
    console.log(`  ${key}: ${windows.databases[key].records.length} records, ${diff.length} differ`);
    if (key === 'actuators') {
      // The Windows file's mirrors keep `Position`, word6 bits 12-13, on 18 of the 24;
      // today's `ExtendPortraits` zeroes it on dm-atari's. The other bits it clears
      // match, and the six mirrors at position 0 come out identical.
      const onlyPosition = diff.every((i) => {
        const w = windows.databases.actuators.records[i]!;
        const a = atari.databases.actuators.records[i]!;
        return (w.word2 & 0x7f) === 127 && json({ ...w, word6: w.word6 & ~0x3000 }) === json(a);
      });
      check(diff.length === 18 && onlyPosition, 'actuators: the 18 that differ are mirrors, in word6 bits 12-13 alone');
    } else if (key === 'scrolls') {
      const debrisOnly = diff.filter((i) => {
        const { word4Bits1_15: _w, ...rest } = windows.databases.scrolls.records[i]!;
        const { word4Bits1_15: _a, ...restA } = atari.databases.scrolls.records[i]!;
        return json(rest) !== json(restA);
      });
      console.log(`    beyond m_word4's debris: record(s) ${debrisOnly.join(', ') || 'none'}`);
      // The CSBWin that wrote the file left the free record 33 unconverted, so 34's text
      // took the slot `convertScrolls` gives 33's here (doc/PROVEN_FACTS.md → "A free
      // scroll's text in a CSBWin file").
      const text34 = (w: DungeonData) => {
        const { category, index, position } = w.rnMaps.decode(w.databases.scrolls.records[34]!.textObject!);
        return `${category}:${index}@${position}`;
      };
      check(debrisOnly.join() === '33,34' && windows.databases.scrolls.records[33]!.textObject === 0xffff
        && text34(windows) === text34(atari),
        'scrolls: all but the free record 33, whose text is RNnul, and 34, whose text is the same in another '
        + 'slot, differ in m_word4 bits 1-15 alone');
    } else {
      check(diff.length === 0, `${key}: identical`);
    }
  }
  check(windows.expool?.length === 256 && atari.expool === undefined, 'the EXPOOL record is kept, 256 bytes');

  console.log('== the rules ==');
  const graphics = stockGraphics();
  // The page's boot: a `Game` over the empty world, and `dungeon.dat` read after ENTER.
  const boot = newGame(emptyDungeonData(), graphics);
  check(boot.readDungeonDat(read('static/gamefiles/dm-windows/dungeon.dat')), 'the boot reads dm-windows');
  console.log(`  a new game on dm-windows: dmRulesDesignOption ${boot.ctx.rules.dmRulesDesignOption}, dmRules ${boot.ctx.rules.dmRules}`);
  check(boot.ctx.rules.dmRulesDesignOption && !boot.ctx.rules.dmRules,
    'DMRules sets DMRulesDesignOption, and DM_rules stays off without DMRulesOption');
  boot.forceDMRulesAtBoot();
  check(boot.ctx.rules.dmRules, "and _ShowPrisonDoor's force turns DM_rules on");

  const restart = newGame(load(read('static/gamefiles/dm-atari/dungeon.dat')), graphics);
  restart.ctx.rules.dmRules = true;
  restart.ctx.rules.dmRulesDesignOption = true;
  restart.readNewGame(load(read('static/gamefiles/dm-atari/dungeon.dat')));
  check(restart.ctx.rules.dmRules && restart.ctx.rules.dmRulesDesignOption,
    'readNewGame on a file with no block leaves the rules as they were');
  restart.readNewGame(load(read('static/gamefiles/dm-windows/dungeon.dat')));
  check(restart.ctx.rules.dmRulesDesignOption && !restart.ctx.rules.dmRules,
    'readNewGame on dm-windows takes both flags from its block');

  console.log('== a compressed body behind a block ==');
  const header: ExtendedFeaturesBlock = {
    // `LevelDSAInfoPresent`, since the builder always writes the level index's terminator.
    version: 0x41, flags: EF_FLAGS.LevelDSAInfoPresent, numDSA: 0, editingOptions: 0, gameInfoSize: 0, cellFlagArraySize: 0,
    graphicsSignature1: 0, graphicsSignature2: 0, spellFilterLocation: 0, extendedFlags: 0,
    overlayOrdinal: 0, overlayP1: 0, overlayP2: 0, overlayP3: 0, overlayP4: 0,
    csbGraphicsSignature1: 0, csbGraphicsSignature2: 0, hintKey: new Uint8Array(8),
  };
  const prefix = buildExtendedFeaturesPrefix({ header, typeMap: new Uint8Array(0), indexMap: new Uint16Array(0) });
  const csbFile = read('static/gamefiles/csb/dungeon.dat');
  const withBlock = new Uint8Array(prefix.length + csbFile.length);
  withBlock.set(prefix);
  withBlock.set(csbFile, prefix.length);
  const csb = load(csbFile);
  const behind = load(withBlock);
  console.log(`  a ${prefix.length}-byte prefix before CSB's ${csbFile.length}-byte file; Word22592 ${behind.word22592}`);
  check(behind.word22592 === 12 && behind.extendedFeatures !== undefined, 'the body is expanded, Word22592 12');
  const { extendedFeatures: _e, extendedWallDecorations: _x, spellFilterLocation: _s, dsaLevelIndex, ...rest } = behind;
  check(dsaLevelIndex?.every((row) => row.every((v) => v === 0xffff)) === true, 'the block\'s empty DSA level index');
  check(json(rest) === json(csb), "the world is CSB's own");

  finish();
}

main();
