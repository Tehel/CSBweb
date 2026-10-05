/**
 * The two monster design options, `invisibleMonsters` and `drawAsSize4Monsters`: CSBWin's
 * process-wide flags that make a creature's bits 11 to 14 mean anything at all.
 *
 * - `ReadExtendedFeatures` sets them from `extendedFlags & InvisibleMonsters` (0x02) and
 *   `& DrawAsSize4Monsters` (0x04) (`doc/CSBwin-src/SaveGame.cpp:394-400`), and `SaveGame`
 *   writes them back (`:947-948`, `:958-959`). Conflux 3.5's `dungeon.dat` sets both.
 * - `DB4::invisible()` is `invisibleMonsters && bit 11`, and `drawAsSize4()`, `Unique()` and
 *   `Poisoned()` are `drawAsSize4Monsters && bits 12, 13, 14` (`CSB.h:1125-1132`). Off, every
 *   reader sees false whatever the bit says; on, the bit counts:
 *   - a group drawn as size 4 that dies one member at a time leaves no droppings
 *     (`Code11f52.cpp:1126-1127`), and shows a death cloud only for its last member, the
 *     size of the cell (`:1258-1264`);
 *   - an invisible creature is not drawn (`Code51a4.cpp:2205`), and a group drawn as size 4
 *     is drawn once, centred, as the member `DrawSize4Index` picks (`:323-348`, `:420-441`);
 *   - the missile half is in `tools/dump-missile-monster.ts`, scenario 2.
 *
 * Run: `npx tsx tools/dump-monster-design-options.ts`
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { getRoomType, OBJECT_ID_EOF, Position, RoomType } from '../src/core/types';
import { loadCsbwinWorld } from '../src/data/CsbwinDungeonImage';
import { EF_EXTENDED_FLAGS, readRulesOptions } from '../src/data/CsbwinExtendedFeatures';
import { DungeonLoader } from '../src/data/DungeonLoader';
import type { CreatureRecord } from '../src/data/dungeonTypes';
import { monsterHorizontalSize, monsterLeavesDroppings } from '../src/data/tables/MonsterDesc';
import type { Game } from '../src/engine/Game';
import type { RulesOptions } from '../src/engine/GameContext';
import { MonsterType } from '../src/engine/monsterTypes';
import { applySaveBytes, buildSaveFile } from '../src/engine/SaveGameFile';
import { DrawSize4Index } from '../src/renderer/bytecode/DrawRoomObjects';
import type { IndexedBitmap } from '../src/renderer/csbwin/CanvasBlitter';
import { getCachedGraphicBitmap } from '../src/renderer/ViewportGraphics';
import { ViewportRenderer } from '../src/renderer/ViewportRenderer';
import { check, fail, finish } from './lib/check';
import { createMonsterAt } from './lib/createMonster';
import { graphicsTablesOf, newGame, stockGraphics } from './lib/game';

const DM_DUNGEON = new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/dungeon.dat')));
const CONFLUX = 'static/gamefiles/conflux-3.5-b8/dungeon.dat';
const graphics = stockGraphics();
const EAST = 1;

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

function loadDungeon(bytes: Uint8Array) {
  return quiet(() => {
    const loader = new DungeonLoader();
    loader.loadFromArray(bytes);
    const data = loader.getData();
    if (!data) throw new Error('dungeon.dat did not load');
    return data;
  });
}

function dmGame(): Game {
  return quiet(() => newGame(loadDungeon(DM_DUNGEON), graphics));
}

function options(rules: RulesOptions): string {
  return `invisibleMonsters ${rules.invisibleMonsters}, drawAsSize4Monsters ${rules.drawAsSize4Monsters}`;
}

/** A level and a monster type it allows, `pick`ed, with an open square and the open one east of it. */
function findArena(game: Game, pick: (type: number) => boolean): { party: Position; target: Position; type: number } | null {
  const dungeon = game.ctx.dungeon;
  for (let z = 0; z < dungeon.getMapCount(); z++) {
    const type = Array.from(game.ctx.tables.monsterDesc).findIndex((d, t) => d && pick(t) && dungeon.monsterAllowedOnLevel(t, z));
    if (type < 0) continue;
    const { width, height } = dungeon.getMap(z)!.descriptor;
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 2; x++) {
        const open = (px: number) => getRoomType(dungeon.getCellFlag(new Position(px, y, z))) === RoomType.OPEN
          && dungeon.findFirstObject(new Position(px, y, z)) === OBJECT_ID_EOF;
        if (open(x) && open(x + 1) && open(x + 2)) {
          return { party: new Position(x, y, z), target: new Position(x + 1, y, z), type };
        }
      }
    }
  }
  return null;
}

/** A group on `arena.target`, its timers gone so it stays put. */
function placeGroup(game: Game, arena: { party: Position; target: Position; type: number }, members: number): CreatureRecord {
  game.ctx.party.state.position = arena.party;
  game.ctx.party.state.facing = EAST;
  game.systems.monsters.loadPartyLevel(arena.party.z);
  const { target } = arena;
  const rn = createMonsterAt(game, {
    value: arena.type, hitPointMultiplier: 1, numMonM1: members - 1, facing: 0,
    mapX: target.x, mapY: target.y, level: target.z, invisible: false, drawAsSize4: false,
  });
  if (rn === null) throw new Error(`no group of ${MonsterType[arena.type]} at (${target.x},${target.y})`);
  game.ctx.timers.deleteMonsterMovementTimers(target.x, target.y, target.z);
  return game.ctx.dungeon.getCreatureRecord(rn)!;
}

function main(): void {
  /* ----------------------------------------------------- read and written ----- */
  console.log('=== the options are read from a block, and written to a save ===');
  {
    const rules: RulesOptions = {
      dmRules: false, dmRulesDesignOption: false,
      invisibleMonsters: false, drawAsSize4Monsters: false, simpleEncipher: false,
    };
    const conflux = quiet(() => new DungeonLoader().loadDungeonDat(new Uint8Array(readFileSync(resolve(CONFLUX)))));
    readRulesOptions(rules, conflux.extendedFeatures, conflux.simpleEncipher);
    console.log(`  Conflux: extendedFlags 0x${conflux.extendedFeatures?.extendedFlags.toString(16)}: ${options(rules)}`);
    check(rules.invisibleMonsters && rules.drawAsSize4Monsters, 'Conflux sets both options (SaveGame.cpp:394-400)');
    readRulesOptions(rules, undefined, false);
    check(rules.invisibleMonsters && rules.drawAsSize4Monsters, 'a file with no block leaves them as they were');
    const fresh = dmGame();
    check(!fresh.ctx.rules.invisibleMonsters && !fresh.ctx.rules.drawAsSize4Monsters,
      'both are off at start, and DM\'s dungeon.dat, which has no block, leaves them off (data.cpp:77-78)');

    for (const [invisibleMonsters, drawAsSize4Monsters] of [[false, false], [true, false], [false, true], [true, true]]) {
      const source = dmGame();
      source.ctx.rules.invisibleMonsters = invisibleMonsters;
      source.ctx.rules.drawAsSize4Monsters = drawAsSize4Monsters;
      const file = buildSaveFile(source);
      const extendedFlags = quiet(() => loadCsbwinWorld(file)).save.extendedFeatures?.extendedFlags ?? -1;
      console.log(`  ${options(source.ctx.rules)}: extendedFlags 0x${extendedFlags.toString(16)}`);
      check((extendedFlags & EF_EXTENDED_FLAGS.InvisibleMonsters) !== 0 === invisibleMonsters
        && (extendedFlags & EF_EXTENDED_FLAGS.DrawAsSize4Monsters) !== 0 === drawAsSize4Monsters,
        '  the save carries InvisibleMonsters and DrawAsSize4Monsters for them (SaveGame.cpp:947, :958)');
      const target = dmGame();
      target.ctx.rules.invisibleMonsters = !invisibleMonsters;
      target.ctx.rules.drawAsSize4Monsters = !drawAsSize4Monsters;
      quiet(() => applySaveBytes(target, file));
      check(target.ctx.rules.invisibleMonsters === invisibleMonsters
        && target.ctx.rules.drawAsSize4Monsters === drawAsSize4Monsters, '  and a load reads them back');
    }
  }

  /* ----------------------------------------------- a member of a size-4 group dies ----- */
  console.log('');
  console.log('=== one member of a group with bit 12 dies: droppings and the death cloud ===');
  {
    const pick = (t: number) => {
      const d = dmGame().ctx.tables.monsterDesc[t];
      return !!d && monsterLeavesDroppings(d) && monsterHorizontalSize(d) === 0;
    };
    const arena = findArena(dmGame(), pick);
    if (!arena) { fail('no level allows a one-corner monster that leaves droppings'); finish(); return; }
    for (const [option, members] of [[false, 2], [true, 2], [false, 1], [true, 1]] as const) {
      const game = dmGame();
      game.ctx.rules.drawAsSize4Monsters = option;
      const group = placeGroup(game, arena, members);
      group.drawAsSize4 = true;
      const clouds: { size: number; posInCell: number }[] = [];
      const me = game.systems.missileEncounter;
      me.createDeathCloud = (_projectile, size, _position, posInCell) => { clouds.push({ size, posInCell }); };
      let drops = 0;
      const md = game.systems.monsterDamage;
      const drop = md.createAndDropObject.bind(md);
      md.createAndDropObject = (...args) => { drops++; return drop(...args); };
      const { target } = arena;
      md.damageMonster(group, 0, target.z, target.x, target.y, 9999, true, false);
      console.log(`  ${MonsterType[arena.type]} x${members}, drawAsSize4Monsters ${option}: `
        + `droppings ${drops}, death clouds ${JSON.stringify(clouds)}`);
      const size4 = option;
      if (members === 2) {
        check((drops > 0) === !size4, `  ${size4 ? 'no droppings: the group is drawn as size 4' : 'droppings: the bit means nothing with the option off'} (Code11f52.cpp:1126-1127)`);
        check(clouds.length === (size4 ? 0 : 1), `  ${size4 ? 'no death cloud while a member lives' : 'a death cloud for the member'} (:1258-1269)`);
      } else {
        check(clouds.length === 1 && (size4 ? clouds[0]!.size === 255 && clouds[0]!.posInCell === 255 : clouds[0]!.size === 110),
          `  the last member's cloud is ${size4 ? 'the cell\'s, size 255 in no corner' : 'a corner\'s, size 110'}`);
      }
    }
  }

  /* ------------------------------------------------------------ DrawSize4Index ----- */
  console.log('');
  console.log('=== DrawSize4Index picks the member drawn ===');
  {
    const group = (numMonM1: number, facing: number) => ({ numMonM1, facing }) as CreatureRecord;
    const statuses = (attacking: number) => Uint8Array.from([0, 1, 2, 3], (i) => (i === attacking ? 0x80 : 0));
    const cases: [string, number, number][] = [
      ['a lone monster', DrawSize4Index(group(0, 0), statuses(0), 0), 1],
      ['the first attacking member', DrawSize4Index(group(3, 2), statuses(2), 0), 3],
      ['no member attacks, the record faces the party', DrawSize4Index(group(3, 2), statuses(-1), 0), 1],
      // `(facingByte ^ monsterFacing) & mask` with both shifted per member, as written:
      // party facing 2 looks for 0, and a record facing 1 matches at member 1's mask.
      ['facing 1 against the party\'s 2: member 1\'s mask', DrawSize4Index(group(3, 1), statuses(-1), 2), 2],
      ['no match: the first', DrawSize4Index(group(3, 1), statuses(-1), 1), 1],
    ];
    for (const [what, got, want] of cases) {
      console.log(`  ${what}: ${got}`);
      check(got === want, `  ${what} is ordinal ${want}`);
    }
  }

  /* ---------------------------------------------------------------- the view ----- */
  console.log('');
  console.log('=== the view: an invisible creature, a group drawn as size 4 ===');
  {
    const pick = (t: number) => {
      const d = dmGame().ctx.tables.monsterDesc[t];
      return !!d && monsterHorizontalSize(d) === 0;
    };
    const arena = findArena(dmGame(), pick);
    if (!arena) { fail('no level allows a one-corner monster with room to see it'); finish(); return; }
    const tables = graphicsTablesOf(graphics);
    type View = { hash: string; minX: number; maxX: number };
    const view = (game: Game, empty?: Uint8Array): { view: View; pixels: Uint8Array } => {
      const graphicCache = new Map<string, IndexedBitmap>();
      const renderer = new ViewportRenderer({
        graphicsLoader: graphics,
        dungeonState: game.ctx.dungeon,
        gameState: game.ctx.state,
        rules: game.ctx.rules,
        viewportTables: tables.viewport,
        objectTables: tables.objects,
        palette552: tables.ui.graphic232.palette552,
        graphicCache,
        getGraphicBitmap: (n) => getCachedGraphicBitmap(graphics, graphicCache, n),
      });
      renderer.selectLevel(arena.party.z);
      renderer.draw(arena.party, EAST, false, false);
      const pixels = Uint8Array.from(renderer.buffer.pixels);
      let minX = Infinity, maxX = -Infinity;
      if (empty) {
        const width = renderer.buffer.width;
        pixels.forEach((p, i) => {
          if (p === empty[i]) return;
          minX = Math.min(minX, i % width);
          maxX = Math.max(maxX, i % width);
        });
      }
      return { view: { hash: createHash('sha256').update(pixels).digest('hex').slice(0, 16), minX, maxX }, pixels };
    };
    const emptyGame = dmGame();
    emptyGame.ctx.party.state.position = arena.party;
    emptyGame.ctx.party.state.facing = EAST;
    const empty = view(emptyGame);
    console.log(`  ${MonsterType[arena.type]} at (${arena.target.x},${arena.target.y}) level ${arena.target.z}, seen from the west; the empty view ${empty.view.hash}`);

    const scene = (setup: (game: Game, group: CreatureRecord) => void, members: number): View => {
      const game = dmGame();
      const group = placeGroup(game, arena, members);
      setup(game, group);
      return view(game, empty.pixels).view;
    };
    for (const option of [false, true]) {
      const seen = scene((game, group) => { game.ctx.rules.invisibleMonsters = option; group.invisible = true; }, 1);
      console.log(`  bit 11, invisibleMonsters ${option}: ${seen.hash}`);
      check((seen.hash === empty.view.hash) === option,
        `  ${option ? 'not drawn: invisible() (Code51a4.cpp:2205)' : 'drawn: the bit means nothing with the option off'}`);
    }

    // Both members on the party's left: the near and far north-west corners, seen facing east.
    const leftPair = (option: boolean) => (game: Game, group: CreatureRecord) => {
      game.ctx.rules.drawAsSize4Monsters = option;
      group.drawAsSize4 = true;
      game.ctx.dungeon.getAttachedItem16(group)!.positions = 0 | (1 << 2);
    };
    const corners = scene(leftPair(false), 2);
    const centred = scene(leftPair(true), 2);
    const centre = (v: View) => (v.minX + v.maxX) / 2;
    console.log(`  bit 12, drawAsSize4Monsters false: x ${corners.minX}-${corners.maxX}; true: x ${centred.minX}-${centred.maxX}`);
    check(centre(corners) < 112 - 8, '  off, the two are drawn in their corners, on the left');
    check(Math.abs(centre(centred) - 111.5) <= 4, '  on, one figure is drawn centred in the cell (Code51a4.cpp:465-499)');
  }

  finish();
}

main();
