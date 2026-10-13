/**
 * The page's data sets (`src/data/DataSets.ts`): the manifest parses, refuses what is
 * malformed with a message that says why, and names folders that hold the files its flags
 * promise. Every set's files load, its tables build from its own `graphics.dat`, and a
 * `Game` stands up on its `dungeon.dat`.
 *
 * Item 0x231 is 0x7d4 bytes in DM's `graphics.dat` and 0x804 in CSB's, whose tail is
 * `d.Buttons16932`; CSBWin supplies four hardcoded buttons for the short form only
 * (doc/CSBwin-src/CSBCode.cpp:10259-10276). The canary: CSB's four, read from its file,
 * are CSBWin's four word for word, so the long form's tail sits where `parseGraphic231`
 * reads it, after every table before it.
 *
 * Run: `npx tsx tools/dump-data-sets.ts`
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { chooserSets, dataSetNamed, parseManifest, type DataSet } from '../src/data/DataSets';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import type { GameTables } from '../src/engine/GameTables';
import { MISSING_PRISON_DOOR_BUTTONS } from '../src/renderer/intro/PrisonDoor';
import { check, finish } from './lib/check';
import { DATA_SETS, DEFAULT_DATA_SET, MANIFEST, MANIFEST_FILE } from './lib/dataSets';
import { gameTablesOf, graphicsTablesOf, newGame } from './lib/game';

/** A file of `set`. */
function fileOf(set: DataSet, name: string): string {
  return resolve(set.dir, name);
}

/** The message `text` is refused with, or `null` if it parses. */
function refusal(text: string): string | null {
  try {
    parseManifest(text, 'gamefiles');
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** The parser: folders resolved under the manifest's, and each kind of malformed manifest refused, saying why. */
function checkParser(): void {
  const set = (fields: Record<string, unknown> = {}) =>
    ({ id: 'a', name: 'A', ...fields });
  const manifest = (fields: Record<string, unknown> = {}) => JSON.stringify({ default: 'a', dataSets: [set()], ...fields });

  const parsed = parseManifest(manifest({ swoosh: 'logo/st', dataSets: [set({ miniDat: true, hintOracle: false, dmRules: true }), set({ id: 'b', dir: 'b/c' })] }), 'gamefiles');
  console.log(`  parsed: ${parsed.dataSets.map((s) => `${s.id} in ${s.dir}`).join(', ')}; default ${parsed.defaultSet.id}; FTL logo in ${parsed.swooshDir}`);
  check(parsed.dataSets[1]!.dir === 'gamefiles/b/c' && parsed.swooshDir === 'gamefiles/logo/st' && parsed.defaultSet === parsed.dataSets[0],
    'a folder is resolved under the manifest\'s, and the default is one of the sets');
  check(parsed.dataSets[0]!.miniDat && !parsed.dataSets[0]!.hintOracle && parsed.dataSets[0]!.dmRules, 'the flags are read as written');
  const bare = parsed.dataSets[1]!;
  check(parsed.dataSets[0]!.dir === 'gamefiles/a' && !bare.csbGraphics && !bare.miniDat && !bare.hintOracle && !bare.dmRules && !bare.hidden,
    'a set\'s "dir" left out is its "id", and a flag left out is false');
  check(parseManifest(manifest(), '').swooshDir === null && parseManifest(manifest({ swoosh: null }), '').swooshDir === null,
    'a manifest that names no FTL logo, or null, has none');
  check(dataSetNamed(parsed, null) === null && dataSetNamed(parsed, 'nowhere') === null
    && dataSetNamed(parsed, 'b') === parsed.dataSets[1], 'no ?dungeon=, or an unknown one, is the welcome page; a known one plays itself');

  // A hidden set: out of the welcome page's grid, but played by its ?dungeon=.
  const hiding = parseManifest(manifest({ dataSets: [set(), set({ id: 'b', dir: 'b', hidden: true }), set({ id: 'c', dir: 'c', hidden: false })] }), '');
  const [a, b, c] = hiding.dataSets as [DataSet, DataSet, DataSet];
  const listed = chooserSets(hiding).map((s) => s.id).join(',');
  console.log(`  hidden: ${hiding.dataSets.map((s) => `${s.id} ${s.hidden}`).join(', ')}; the welcome page lists ${listed}`);
  check(!a.hidden && b.hidden && !c.hidden, '"hidden" is read as written, and left out it is false');
  check(listed === 'a,c', 'the welcome page leaves a hidden set out');
  check(dataSetNamed(hiding, 'b') === b, 'a hidden set is played by its ?dungeon=');

  // A moderator's answer (`server/dataSets.ts`): the welcome page lists the hidden sets too.
  const moderating = parseManifest(manifest({ moderator: true, dataSets: [set(), set({ id: 'b', dir: 'b', hidden: true })] }), '');
  const moderated = chooserSets(moderating).map((s) => s.id).join(',');
  console.log(`  moderator: ${hiding.moderator} without the flag, ${moderating.moderator} with it; the welcome page lists ${moderated}`);
  check(!hiding.moderator && !parseManifest(manifest({ moderator: false }), '').moderator && moderating.moderator,
    '"moderator" is read as written, and left out it is false');
  check(moderated === 'a,b', 'to a moderator, the welcome page lists the hidden sets too');

  // A pending set: the server's answer to its owner and the moderators (`server/dataSets.ts`).
  const statuses = parseManifest(manifest({ dataSets: [set(), set({ id: 'b', status: 'pending' }), set({ id: 'c', status: 'approved' })] }), '');
  console.log(`  status: ${statuses.dataSets.map((s) => `${s.id} ${s.pending ? 'pending' : 'approved'}`).join(', ')}`);
  check(statuses.dataSets.map((s) => s.pending).join() === 'false,true,false', '"status" is read as written, and left out it is "approved"');

  const malformed: Array<[string, string]> = [
    ['{"default": "a", ', 'not JSON'],
    ['[]', 'not an object'],
    [manifest({ dataSets: [] }), '"dataSets" is not a list'],
    [manifest({ dataSets: [set(), 'b'] }), 'data set 1 is not an object'],
    [manifest({ dataSets: [set({ id: '' })] }), 'data set 0 has no "id"'],
    [manifest({ dataSets: [set({ name: 7 })] }), `data set 'a' has no "name"`],
    [manifest({ dataSets: [set({ dir: '/gamefiles/a' })] }), `data set 'a' has no "dir"`],
    [manifest({ dataSets: [set({ dir: '../a' })] }), `data set 'a' has no "dir"`],
    [manifest({ dataSets: [set({ dir: 'a/' })] }), `data set 'a' has no "dir"`],
    [manifest({ dataSets: [set({ dir: null })] }), `data set 'a' has no "dir"`],
    [manifest({ dataSets: [set({ hintOracle: 'yes' })] }), `data set 'a' has a "hintOracle" that is neither true nor false`],
    [manifest({ dataSets: [set({ hidden: 'yes' })] }), `data set 'a' has a "hidden" that is neither true nor false`],
    [manifest({ dataSets: [set({ status: 'waiting' })] }), `data set 'a' has a "status" that is neither "approved" nor "pending"`],
    [manifest({ dataSets: [set(), set({ dir: 'b' })] }), `two data sets are 'a'`],
    [manifest({ moderator: 'yes' }), '"moderator" is neither true nor false'],
    [manifest({ default: 'b' }), '"default" names none'],
    [manifest({ default: undefined }), '"default" names none'],
    [manifest({ swoosh: '..' }), '"swoosh" is neither null nor a folder'],
  ];
  for (const [text, why] of malformed) {
    const message = refusal(text);
    console.log(`  refused: ${message}`);
    check(message !== null && message.startsWith(`The data sets' manifest is not usable: `) && message.includes(why),
      `a manifest whose fault is "${why}" is refused, and the message says so`);
  }
}

const BUTTON_FIELDS = ['word0', 'x1', 'x2', 'y1', 'y2', 'button'] as const;

function main(): void {
  console.log('== the manifest\'s parser ==');
  checkParser();

  console.log(`== ${MANIFEST_FILE}: ${DATA_SETS.length} sets, default ${DEFAULT_DATA_SET.id}, FTL logo in ${MANIFEST.swooshDir} ==`);
  check(DEFAULT_DATA_SET.id === 'dm-atari', 'the tools play dm-atari where they name no set');
  check(MANIFEST.swooshDir !== null && existsSync(resolve(MANIFEST.swooshDir, 'swoosh.img')) && existsSync(resolve(MANIFEST.swooshDir, 'swoosh.wav')),
    'the FTL logo\'s folder holds swoosh.img and swoosh.wav');

  const tablesOf = new Map<string, GameTables>();
  for (const set of DATA_SETS) {
    console.log(`== ${set.id}: ${set.name}, ${set.dir} ==`);
    check(dataSetNamed(MANIFEST, set.id) === set, `?dungeon=${set.id} plays it`);
    check(existsSync(fileOf(set, 'graphics.dat')) && existsSync(fileOf(set, 'dungeon.dat')),
      `${set.id}: the folder holds a graphics.dat and a dungeon.dat`);
    check(existsSync(fileOf(set, 'CSBgraphics.dat')) === set.csbGraphics,
      `${set.id}: csbGraphics says whether the folder holds a CSBgraphics.dat`);
    check(existsSync(fileOf(set, 'mini.dat')) === set.miniDat,
      `${set.id}: miniDat says whether the folder holds a mini.dat`);
    check((existsSync(fileOf(set, 'hcsb.hct')) && existsSync(fileOf(set, 'hcsb.dat'))) === set.hintOracle,
      `${set.id}: hintOracle says whether the folder holds hcsb.hct and hcsb.dat`);

    const dungeon = new DungeonLoader().loadDungeonDat(new Uint8Array(readFileSync(fileOf(set, 'dungeon.dat'))));
    // A block sets the rules its own way (`readRulesOptions`), so only a file without one
    // takes the set's.
    check(!set.dmRules || !dungeon.extendedFeatures,
      `${set.id}: dmRules is given only where dungeon.dat has no Extended Features block`);
    const graphics = new GraphicsLoader();
    graphics.loadFromArray(new Uint8Array(readFileSync(fileOf(set, 'graphics.dat'))));
    const tables = gameTablesOf(graphics);
    tablesOf.set(set.id, tables);
    const size231 = graphics.getRawGraphic(0x231).length;
    const buttons = graphicsTablesOf(graphics).ui.graphic231.buttons.buttons16932;
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

    // The food/water words are read at their own width (`drawFoodWaterPanel`), which is
    // right only if each fills its rectangle: 48, 48 and 96 in English, NOURRITURE 96.
    const g232 = graphicsTablesOf(graphics).ui.graphic232;
    const words: [number, { x1: number; x2: number }][] = [[30, g232.wRectPos950], [31, g232.wRectPos958], [32, g232.wRectPos966]];
    for (const [index, rect] of words) {
      const raw = graphics.getRawGraphic(index);
      const width = (raw[0]! << 8) | raw[1]!;
      check(rect.x2 - rect.x1 + 1 <= width,
        `${set.id}: graphic ${index} (${width} wide) covers its rectangle (x ${rect.x1}-${rect.x2})`);
    }

    const game = newGame(dungeon, graphics);
    check(game.ctx.tables === tables, `${set.id}: a Game over the set runs on the set's tables`);
    check(game.ctx.dungeon.getMapCount() === dungeon.maps.length, `${set.id}: and on its dungeon`);
  }

  // Each set's tables are its own file's: CSB's differ from DM's in the six tables its
  // graphics.dat changes, and in no other. The file's signature is not a table, and is
  // left out: it differs between any two files.
  const tableKeys = (tables: Record<string, unknown>) => Object.keys(tables).filter((k) => k !== 'graphicsSignature');
  // The tables by name, to compare every one of them without naming it.
  const byName = (set: string): Record<string, unknown> => ({ ...tablesOf.get(set) });
  const dm = byName('dm-atari');
  const csb = byName('csb');
  const differing = tableKeys(dm).filter((k) => JSON.stringify(dm[k]) !== JSON.stringify(csb[k]));
  console.log(`== tables that differ between dm-atari and csb: ${differing.join(', ')} ==`);
  const expected = ['monsterDesc', 'textDecode', 'experienceForAttacking', 'skillNumber', 'byte20046', 'spells'];
  check(differing.length === expected.length && expected.every((k) => differing.includes(k)),
    'csb builds its own monsters, spells, skill tables and text decoding, and every other table as DM does');

  // The French 1.3 file is 1.2's translated: its 0x230 is 100 bytes longer, all of it
  // attack names, so its spells and legal attacks, read after them, must be 1.2's (the
  // canary for the names' length), and only the words differ.
  const en = byName('dm-atari-1.2');
  const fr = byName('dm-atari-1.3-fr');
  const translated = tableKeys(en).filter((k) => JSON.stringify(en[k]) !== JSON.stringify(fr[k]));
  console.log(`== tables that differ between dm-atari-1.2 and dm-atari-1.3-fr: ${translated.join(', ')} ==`);
  check(translated.length === 2 && translated.includes('attackNames') && translated.includes('textDecode'),
    'dm-atari-1.3-fr differs from 1.2 in its attack names and text decoding only: its spells are 1.2\'s');
  const names = tablesOf.get('dm-atari-1.3-fr')!.attackNames;
  check(names[1] === 'FENDRE' && names[43] === 'FUSIONNER' && names.length === 44 + 20,
    'dm-atari-1.3-fr: 44 attack names, FENDRE to FUSIONNER, then the padding');

  finish();
}

main();
