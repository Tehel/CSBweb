/**
 * A pressed crack switch stays where it was on the wall.
 *
 * Level 4, the east face of (13,29), seen from (14,29) facing west: two once-only wall switches. The first shows
 * Crack Switch (In) and rotates the actuator list (local action 1); the second shows
 * Crack Switch (Out) and opens the grid at (13,28). A wall shows its *last* actuator's
 * ornament (`doc/CSBwin-src/Codea59a.cpp:136-139`), so the button is out until the click,
 * and `RotateActuatorList` (`doc/CSBwin-src/Code11f52.cpp:3500`) then brings the "In"
 * actuator last.
 *
 * CSBWin's `graphics.dat` (`dm-windows/`) gives the two ornaments different coordinate
 * sets — 2 (low on the wall) and 0 (eye level) — for bitmaps of the same size, so CSBWin
 * draws the pressed crack higher up the wall. The Atari ST 1.2 disk's holds 2 for both,
 * and `dm-atari/graphics.dat` carries 1.2's item (`tools/dump-dm-atari-graphics.ts`,
 * `doc/PROVEN_FACTS.md` → "`dm-atari/graphics.dat` is CSBWin's with three items from the 1.2 disk"). The port reads the table as it
 * stands, as CSBWin does. This tool proves that the defect is in CSBWin's data only, that
 * the port reads `dm-atari/`'s table unchanged, and that there the crack drawn after the
 * click lands where the one before it did.
 *
 * Run: `npm test -- --only=dump-crack-switch.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DBType, OBJECT_ID_EOF, OBJECT_ID_NULL, Position } from '../src/core/types';
import type { ObjectID } from '../src/core/types';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import type { Game } from '../src/engine/Game';
import type { SummarizeRoomData } from '../src/renderer/bytecode/Types';
import { readWallDecorationRectSetIndex } from '../src/data/tables/ObjectTables';
import { summarizeRoomInfoCsbwin } from '../src/renderer/csbwin/SummarizeRoomInfo';
import { check, finish } from './lib/check';
import { graphicsTablesOf, newGame, stockGraphics, stockDungeon } from './lib/game';

/** Wall ornaments 50 and 55: one crack switch, button out and button pushed in. */
const WALL_ORNAMENT_CRACK_SWITCH_OUT = 50;
const WALL_ORNAMENT_CRACK_SWITCH_IN = 55;

const PARTY = new Position(14, 29, 4);
const FACING_WEST = 3;
const WALL = new Position(13, 29, 4);
const EAST_FACE = 1;

/** `d.WallDecorationsForLevel[i][0]` — the first of an ornament's two graphics (`Code390e.cpp:208`). */
const ornamentGraphic = (ornament: number): number => 121 + 2 * ornament;

/** The renderer's tables, extracted as `main.ts` extracts them. */
const objectTables = graphicsTablesOf(stockGraphics()).objects;

function makeGame(): Game {
  const data = stockDungeon();
  return newGame(data, stockGraphics());
}

/** The actuators on the east face of the wall, first to last. */
function faceActuators(game: Game): ObjectID[] {
  const out: ObjectID[] = [];
  for (let rn = game.ctx.dungeon.findFirstObject(WALL); rn !== OBJECT_ID_EOF; rn = game.ctx.dungeon.getDBRecordLink(rn)) {
    const d = game.ctx.dungeon.rnMaps.decode(rn);
    if (d.category === DBType.ACTUATOR && d.position === EAST_FACE) out.push(rn);
  }
  return out;
}

/** The global ornament the party sees on the wall ahead, through the port's `SummarizeRoomInfo`. */
function ornamentAhead(game: Game): number {
  const rslt: SummarizeRoomData = {
    x: WALL.x,
    y: WALL.y,
    relativeCellNumber: 17,
    skinNumber: 0,
    roomType: 0,
    championPortraitOrdinal: 0,
    graphicRoomType: 0,
    rn2: 0xfffe,
    decorations: [0, 0, 0],
    text: [0xfffe, 0xfffe, 0xfffe],
  };
  summarizeRoomInfoCsbwin(rslt, game.ctx.dungeon, game.ctx.party.state.position, FACING_WEST, objectTables);
  // decorations[1] is relative position 2, the face turned toward the party.
  const ordinal = rslt.decorations[1] | 0;
  const toc = game.ctx.dungeon.getMap(WALL.z)?.wallDecorationTOC ?? [];
  return ordinal > 0 ? (toc[ordinal - 1] ?? -1) : -1;
}

function main(): void {
  const graphics = stockGraphics();
  const raw = readWallDecorationRectSetIndex(graphics.getRawGraphic(0x22e), graphicsTablesOf(graphics).viewport.wallRectanglesOffset);
  const port = objectTables.wallDecorationRectSetIndex;
  const csbwin = new GraphicsLoader();
  csbwin.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-windows/graphics.dat'))));
  const csbwinRaw = readWallDecorationRectSetIndex(csbwin.getRawGraphic(0x22e), graphicsTablesOf(csbwin).viewport.wallRectanglesOffset);

  // --- the data -------------------------------------------------------------------
  // Canaries that the 60 bytes are Byte4100: the three alcoves (1-3) share set 1, the
  // three amalgam ornaments (56-58) set 6, the Lord Order (59) set 7.
  console.log(['ornament', 'CSBWin set', 'dm-atari set', 'port set', 'front bitmap', 'side bitmap'].join('\t'));
  for (const n of [WALL_ORNAMENT_CRACK_SWITCH_OUT, WALL_ORNAMENT_CRACK_SWITCH_IN]) {
    const side = graphics.getImage(ornamentGraphic(n));
    const front = graphics.getImage(ornamentGraphic(n) + 1);
    console.log([n, csbwinRaw[n], raw[n], port[n], `${front.width}x${front.height}`, `${side.width}x${side.height}`].join('\t'));
  }
  for (const [name, table] of [['CSBWin', csbwinRaw], ['dm-atari', raw]] as const) {
    check([1, 2, 3].every((n) => table[n] === 1) && [56, 57, 58].every((n) => table[n] === 6) && table[59] === 7,
      `canary (${name}): alcoves in set 1, amalgams in set 6, Lord Order in set 7 — the bytes are Byte4100`);
  }
  check(csbwinRaw[WALL_ORNAMENT_CRACK_SWITCH_OUT] === 2, 'CSBWin\'s graphics.dat: Crack Switch (Out) is in set 2, low on the wall');
  check(csbwinRaw[WALL_ORNAMENT_CRACK_SWITCH_IN] === 0, 'CSBWin\'s graphics.dat: Crack Switch (In) is in set 0, at eye level — the defect');
  check(raw[WALL_ORNAMENT_CRACK_SWITCH_OUT] === 2 && raw[WALL_ORNAMENT_CRACK_SWITCH_IN] === 2,
    'dm-atari\'s graphics.dat holds 1.2\'s byte: both cracks in set 2');
  check([...raw.keys()].every((i) => raw[i] === port[i]), 'so the port reads dm-atari\'s table unchanged');
  const csbwinPort = graphicsTablesOf(csbwin).objects.wallDecorationRectSetIndex;
  check([...csbwinRaw.keys()].every((i) => csbwinRaw[i] === csbwinPort[i]), 'and CSBWin\'s unchanged too: no correction, as in CSBWin');
  for (const g of [0, 1]) {
    const a = graphics.getImage(ornamentGraphic(WALL_ORNAMENT_CRACK_SWITCH_OUT) + g);
    const b = graphics.getImage(ornamentGraphic(WALL_ORNAMENT_CRACK_SWITCH_IN) + g);
    check(a.width === b.width && a.height === b.height, `the ${g ? 'front' : 'side'} bitmaps of Out and In are the same size`);
  }

  // --- the wall, before and after the click ----------------------------------------
  const game = makeGame();
  game.ctx.party.state.position = PARTY;
  game.ctx.party.state.facing = FACING_WEST;
  game.ctx.party.state.cursorOwner = 0;
  game.ctx.party.state.objectInHand = OBJECT_ID_NULL;

  const before = faceActuators(game);
  const seenBefore = ornamentAhead(game);
  const touched = game.systems.mouse.handleWallClick();
  const after = faceActuators(game);
  const seenAfter = ornamentAhead(game);

  console.log('');
  console.log(['', 'face actuators', 'ornament seen', 'set'].join('\t'));
  console.log(['before', before.map((rn) => game.ctx.dungeon.rnMaps.idx(rn)).join(','), seenBefore, port[seenBefore]].join('\t'));
  console.log(['after', after.map((rn) => game.ctx.dungeon.rnMaps.idx(rn)).join(','), seenAfter, port[seenAfter]].join('\t'));

  check(before.length === 2, 'two actuators on the east face');
  check(seenBefore === WALL_ORNAMENT_CRACK_SWITCH_OUT, 'before the click the party sees Crack Switch (Out)');
  check(touched, 'the click touches the wall');
  check(after.length === 2 && after[0] === before[1] && after[1] === before[0], 'RotateActuatorList swaps the two actuators');
  check(seenAfter === WALL_ORNAMENT_CRACK_SWITCH_IN, 'after it the party sees Crack Switch (In)');
  check(port[seenBefore] === port[seenAfter], 'and draws it with the same coordinate set: the crack does not move');

  finish();
}

main();
