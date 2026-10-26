/**
 * `DM_rules` and `DMRulesDesignOption`: CSBWin's two process-wide flags for DM's rules,
 * set by every file whose Extended Features block is present, forced at the boot, and
 * written back to a save.
 *
 * - `ReadExtendedFeatures` sets `DMRulesDesignOption` from `flags & DMRules` (0x40) and
 *   `DM_rules` from `extendedFlags & DMRulesOption` (0x08)
 *   (`doc/CSBwin-src/SaveGame.cpp:394-400`). Every committed CSBWin save must load its own
 *   two bits, whatever the game held before.
 * - A file with no block leaves both as they were: `mini.dat`, CSB's Atari-era save.
 * - `_ShowPrisonDoor` forces `DM_rules` on from `DMRulesDesignOption` alone
 *   (`CSBCode.cpp:10796-10800`).
 * - The data set's `dmRules` (`DataSet.dmRules`) is the design option's value before any
 *   file is read: DM's Atari files, which have no block, boot with `DM_rules` on.
 * - `SaveGame` writes both back (`SaveGame.cpp:975-980`), and the port's own save carries
 *   them in its block through a load.
 * - `_ResurrectReincarnateCancel` charges the reincarnation penalties only
 *   `if (!DM_rules)` (`CSBCode.cpp:6799`, `:6820`); `checks/hall-of-champions.ts` shows
 *   both sides at a mirror.
 *
 * Run: `npm test -- --only=dm-rules.ts`
 */
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

import { applyCsbwinSave } from '../../src/engine/CsbwinSaveGame';
import { loadCsbwinWorld } from '../../src/data/CsbwinDungeonImage';
import { GraphicsLoader } from '../../src/data/GraphicsLoader';
import type { Game } from '../../src/engine/Game';
import { applySaveBytes, buildSaveFile } from '../../src/engine/SaveGameFile';
import { newGame, stockGame } from '../lib/game';
import { check, finish } from '../lib/check';
import { genuineSaves } from '../lib/saves';
import { STOCK_DATA_SET } from '../lib/dataSets';

/** `fn` without the loaders' progress lines. */
function quiet<T>(fn: () => T): T {
  const log = console.log;
  console.log = () => {};
  try {
    return fn();
  } finally {
    console.log = log;
  }
}

/** A new game on a fresh parse of DM's `dungeon.dat`. */
function dmGame(): Game {
  return quiet(() => stockGame());
}

function rulesOf(game: Game): string {
  const { dmRules, dmRulesDesignOption } = game.ctx.rules;
  return `DM_rules ${dmRules}, DMRulesDesignOption ${dmRulesDesignOption}`;
}

/* ------------------------------------------------------------- a new game ----- */

console.log('=== a new game on dm-atari/dungeon.dat (no Extended Features block) ===');
const fresh = dmGame();
console.log(`  ${rulesOf(fresh)}`);
check(!fresh.ctx.rules.dmRules && !fresh.ctx.rules.dmRulesDesignOption,
  'both start false (data.cpp:252, CSBUI.cpp:148)');
fresh.forceDMRulesAtBoot();
check(!fresh.ctx.rules.dmRules, 'and the boot forces nothing without the design option');

/* ------------------------------------------------------- every committed save ----- */

console.log('');
console.log('=== every committed CSBWin save, loaded over the opposite flags ===');
let withBoth = 0;
for (const path of genuineSaves()) {
  const file = basename(path);
  const bytes = new Uint8Array(readFileSync(path));
  const header = quiet(() => loadCsbwinWorld(bytes)).save.extended.header;
  if (!header) { check(false, `${file}: carries an Extended Features block`); continue; }
  const design = (header.flags & 0x40) !== 0;
  const option = (header.extendedFlags & 0x08) !== 0;
  if (design && option) withBoth++;
  const game = dmGame();
  game.ctx.rules.dmRules = !option;
  game.ctx.rules.dmRulesDesignOption = !design;
  quiet(() => applyCsbwinSave(game, bytes));
  console.log(`  ${file.padEnd(34)} flags 0x${header.flags.toString(16)} ` +
    `extendedFlags 0x${header.extendedFlags.toString(16)} -> ${rulesOf(game)}`);
  check(game.ctx.rules.dmRules === option && game.ctx.rules.dmRulesDesignOption === design,
    `${file}: loads its own two bits`);
}
check(withBoth === 8, `all eight committed saves carry both DMRules and DMRulesOption (${withBoth})`);

/* ------------------------------------------------------ a file with no block ----- */

console.log('');
console.log('=== mini.dat, an Atari-era save with no block, leaves both as they were ===');
const csbGraphics = new GraphicsLoader();
quiet(() => csbGraphics.loadFromArray(new Uint8Array(readFileSync(resolve('tools/fixtures/gamefiles/csb/graphics.dat')))));
const mini = new Uint8Array(readFileSync(resolve('tools/fixtures/gamefiles/csb/mini.dat')));
for (const value of [false, true]) {
  const game = quiet(() => newGame(loadCsbwinWorld(mini).dungeon, csbGraphics));
  game.ctx.rules.dmRules = value;
  game.ctx.rules.dmRulesDesignOption = value;
  quiet(() => applyCsbwinSave(game, mini));
  console.log(`  held ${value}: ${rulesOf(game)}`);
  check(game.ctx.rules.dmRules === value && game.ctx.rules.dmRulesDesignOption === value,
    `mini.dat keeps both ${value}`);
}

/* ----------------------------------------------------------- the boot ----- */

console.log('');
console.log('=== the boot forces DM_rules from DMRulesDesignOption alone ===');
const booted = dmGame();
booted.ctx.rules.dmRulesDesignOption = true;
booted.forceDMRulesAtBoot();
console.log(`  ${rulesOf(booted)}`);
check(booted.ctx.rules.dmRules, 'DMRules forces DM_rules on (CSBCode.cpp:10796-10800)');

console.log('');
console.log('=== the default data set, DM on the Atari files, plays by DM\'s rules ===');
const dm = STOCK_DATA_SET;
const ofSet = dmGame();
ofSet.ctx.rules.dmRulesDesignOption = dm.dmRules;
quiet(() => ofSet.readDungeonDat(new Uint8Array(readFileSync(resolve(dm.dir, 'dungeon.dat')))));
ofSet.forceDMRulesAtBoot();
console.log(`  ${dm.id}: dmRules ${dm.dmRules}; ${rulesOf(ofSet)}`);
check(dm.id === 'dm-atari' && dm.dmRules, 'the manifest gives dm-atari dmRules');
check(ofSet.ctx.rules.dmRules && ofSet.ctx.rules.dmRulesDesignOption,
  'its new game keeps the design option through the read, and the boot turns DM_rules on');

/* ------------------------------------------------- written and read back ----- */

console.log('');
console.log('=== a written save carries both bits, and a load reads them ===');
for (const [dmRules, dmRulesDesignOption] of [[false, false], [true, false], [false, true], [true, true]]) {
  const source = dmGame();
  source.ctx.rules.dmRules = dmRules;
  source.ctx.rules.dmRulesDesignOption = dmRulesDesignOption;
  const file = buildSaveFile(source);
  const header = quiet(() => loadCsbwinWorld(file)).save.extended.header;
  const flags = header?.flags ?? -1;
  const extendedFlags = header?.extendedFlags ?? -1;
  console.log(`  DM_rules ${dmRules}, design ${dmRulesDesignOption}: ` +
    `flags 0x${flags.toString(16)}, extendedFlags 0x${extendedFlags.toString(16)}`);
  check(flags === (dmRulesDesignOption ? 0xe9 : 0xa9), '  flags are 0xa9, plus DMRules for the design option');
  check((extendedFlags & 0x08) === (dmRules ? 0x08 : 0), '  extendedFlags carry DMRulesOption for DM_rules');

  const target = dmGame();
  target.ctx.rules.dmRules = !dmRules;
  target.ctx.rules.dmRulesDesignOption = !dmRulesDesignOption;
  quiet(() => applySaveBytes(target, file));
  check(target.ctx.rules.dmRules === dmRules && target.ctx.rules.dmRulesDesignOption === dmRulesDesignOption,
    '  the port\'s own save loads them back');
}

finish();
