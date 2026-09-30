/**
 * The page's data sets (`src/data/DataSets.ts`): every set's files load, its tables build
 * from its own `graphics.dat`, and a `Game` stands up on its `dungeon.dat`.
 *
 * Item 0x231 is 0x7d4 bytes in DM's `graphics.dat` and 0x804 in CSB's, whose tail is
 * `d.Buttons16932`; CSBWin supplies four hardcoded buttons for the short form only
 * (doc/CSBwin-src/CSBCode.cpp:10135-10151). The canary: CSB's four, read from its file,
 * are CSBWin's four word for word, so the long form's tail sits where `parseGraphic231`
 * reads it, after every table before it.
 *
 * Run: `npx tsx tools/dump-data-sets.ts`
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DATA_SETS, DEFAULT_DATA_SET, dataSetFor, type DataSet } from '../src/data/DataSets';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import type { GameTables } from '../src/engine/GameTables';
import { extractUITables } from '../src/renderer/csbwin/UITables';
import { MISSING_PRISON_DOOR_BUTTONS } from '../src/renderer/intro/PrisonDoor';
import { check, finish } from './lib/check';
import { gameTablesOf, newGame } from './lib/game';

/** A file of `set`, where the page's root is `static/`. */
function fileOf(set: DataSet, name: string): string {
  return resolve('static' + set.dir, name);
}

const BUTTON_FIELDS = ['word0', 'x1', 'x2', 'y1', 'y2', 'button'] as const;

function main(): void {
  check(dataSetFor(null) === DEFAULT_DATA_SET && DEFAULT_DATA_SET.id === 'dm-atari', 'no ?dungeon= plays dm-atari');
  check(dataSetFor('nowhere') === DEFAULT_DATA_SET, 'an unknown id plays the default');
  check(new Set(DATA_SETS.map((s) => s.id)).size === DATA_SETS.length, 'the ids are distinct');

  const tablesOf = new Map<string, GameTables>();
  for (const set of DATA_SETS) {
    console.log(`== ${set.id}: ${set.name}, ${set.dir} ==`);
    check(dataSetFor(set.id) === set, `?dungeon=${set.id} plays it`);
    check(existsSync(fileOf(set, 'CSBgraphics.dat')) === set.csbGraphics,
      `${set.id}: csbGraphics says whether the folder holds a CSBgraphics.dat`);

    const dungeon = new DungeonLoader().loadDungeonDat(new Uint8Array(readFileSync(fileOf(set, 'dungeon.dat'))));
    const graphics = new GraphicsLoader();
    graphics.loadFromArray(new Uint8Array(readFileSync(fileOf(set, 'graphics.dat'))));
    const tables = gameTablesOf(graphics);
    tablesOf.set(set.id, tables);
    const size231 = graphics.getRawGraphic(0x231).length;
    const buttons = extractUITables(graphics).graphic231.buttons.buttons16932;
    console.log(`  dungeon.dat: ${dungeon.maps.length} maps; graphics.dat: ${graphics.getItemCount()} items, ` +
      `0x231 is 0x${size231.toString(16)} bytes, Buttons16932 from the file: ${buttons.length}`);
    check(size231 === 0x7d4 || size231 === 0x804, `${set.id}: 0x231 has one of the two sizes CSBWin asserts`);
    if (size231 === 0x7d4) {
      check(buttons.length === 0, `${set.id}: the short form carries no Buttons16932, so CSBWin's are used`);
    } else {
      const same = buttons.length === 4 && MISSING_PRISON_DOOR_BUTTONS.every((b, i) =>
        BUTTON_FIELDS.every((f) => buttons[i]![f] === b[f]));
      for (const b of buttons) console.log(`    ${BUTTON_FIELDS.map((f) => `${f} ${b[f]}`).join(', ')}`);
      check(same, `${set.id}: the long form's Buttons16932 are CSBWin's four, word for word (the canary)`);
    }

    const game = newGame(dungeon, graphics);
    check(game.ctx.tables === tables, `${set.id}: a Game over the set runs on the set's tables`);
    check(game.ctx.dungeon.getMapCount() === dungeon.maps.length, `${set.id}: and on its dungeon`);
  }

  // Each set's tables are its own file's: CSB's differ from DM's in the six tables its
  // graphics.dat changes, and in no other.
  const dm = tablesOf.get('dm-atari') as unknown as Record<string, unknown>;
  const csb = tablesOf.get('csb') as unknown as Record<string, unknown>;
  const differing = Object.keys(dm).filter((k) => JSON.stringify(dm[k]) !== JSON.stringify(csb[k]));
  console.log(`== tables that differ between dm-atari and csb: ${differing.join(', ')} ==`);
  const expected = ['monsterDesc', 'textDecode', 'experienceForAttacking', 'skillNumber', 'byte20046', 'spells'];
  check(differing.length === expected.length && expected.every((k) => differing.includes(k)),
    'csb builds its own monsters, spells, skill tables and text decoding, and every other table as DM does');

  finish();
}

main();
