/**
 * A pressed crack switch stays where it was on the wall.
 *
 * Level 4, the east face of (13,29), seen from (14,29) facing west: two once-only wall switches. The first shows
 * Crack Switch (In) and rotates the actuator list (local action 1); the second shows
 * Crack Switch (Out) and opens the grid at (13,28). A wall shows its *last* actuator's
 * ornament (`doc/CSBwin-src/Codea59a.cpp:136-139`), so the button is out until the click,
 * and `RotateActuatorList` (`doc/CSBwin-src/Code11f52.cpp:3465`) then brings the "In"
 * actuator last.
 *
 * `graphics.dat` gives the two ornaments different coordinate sets — 2 (low on the wall)
 * and 0 (eye level) — for bitmaps of the same size, so CSBWin draws the pressed crack
 * higher up the wall. `correctCrackSwitchInPlacement` is the port's one-byte correction
 * (`doc/PROVEN_FACTS.md`, "Crack Switch (In) placement"). This tool proves that the
 * defect is in the data, that only that byte changes, and that the crack drawn after the
 * click lands where the one before it did.
 *
 * Run: `npx tsx tools/dump-crack-switch.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DBType, OBJECT_ID_EOF, OBJECT_ID_NULL, Position, decodeObjectID } from '../src/core/types';
import type { ObjectID } from '../src/core/types';
import { DungeonLoader } from '../src/data/DungeonLoader';
import type { Game } from '../src/engine/Game';
import type { SummarizeRoomData } from '../src/renderer/bytecode/Types';
import {
  WALL_ORNAMENT_CRACK_SWITCH_IN,
  WALL_ORNAMENT_CRACK_SWITCH_OUT,
  extractObjectTables,
  readWallDecorationRectSetIndex,
} from '../src/data/tables/ObjectTables';
import { summarizeRoomInfoCsbwin } from '../src/renderer/csbwin/SummarizeRoomInfo';
import { extractViewportTables } from '../src/data/tables/ViewportTables';
import { check, finish } from './lib/check';
import { newGame, stockGraphics } from './lib/game';

const PARTY = new Position(14, 29, 4);
const FACING_WEST = 3;
const WALL = new Position(13, 29, 4);
const EAST_FACE = 1;

/** `d.WallDecorationsForLevel[i][0]` — the first of an ornament's two graphics (`Code390e.cpp:208`). */
const ornamentGraphic = (ornament: number): number => 121 + 2 * ornament;

/** The renderer's tables, extracted as `main.ts` extracts them. */
const objectTables = extractObjectTables(stockGraphics(), extractViewportTables(stockGraphics()).wallRectanglesOffset);

function makeGame(): Game {
  const loader = new DungeonLoader();
  loader.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/dungeon.dat'))));
  const data = loader.getData();
  if (!data) throw new Error('dungeon.dat did not load');
  return newGame(data, stockGraphics());
}

/** The actuators on the east face of the wall, first to last. */
function faceActuators(game: Game): ObjectID[] {
  const out: ObjectID[] = [];
  for (let rn = game.ctx.dungeon.findFirstObject(WALL); rn !== OBJECT_ID_EOF; rn = game.ctx.dungeon.getDBRecordLink(rn)) {
    const d = decodeObjectID(rn);
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
  const raw = readWallDecorationRectSetIndex(graphics.getRawGraphic(0x22e), extractViewportTables(graphics).wallRectanglesOffset);
  const fixed = objectTables.wallDecorationRectSetIndex;

  // --- the data -------------------------------------------------------------------
  // Canaries that the 60 bytes are Byte4100: the three alcoves (1-3) share set 1, the
  // three amalgam ornaments (56-58) set 6, the Lord Order (59) set 7.
  console.log(['ornament', 'raw set', 'port set', 'front bitmap', 'side bitmap'].join('\t'));
  for (const n of [WALL_ORNAMENT_CRACK_SWITCH_OUT, WALL_ORNAMENT_CRACK_SWITCH_IN]) {
    const side = graphics.getImage(ornamentGraphic(n));
    const front = graphics.getImage(ornamentGraphic(n) + 1);
    console.log([n, raw[n], fixed[n], `${front.width}x${front.height}`, `${side.width}x${side.height}`].join('\t'));
  }
  check([1, 2, 3].every((n) => raw[n] === 1) && [56, 57, 58].every((n) => raw[n] === 6) && raw[59] === 7,
    'canary: alcoves in set 1, amalgams in set 6, Lord Order in set 7 — the bytes are Byte4100');
  check(raw[WALL_ORNAMENT_CRACK_SWITCH_OUT] === 2, 'graphics.dat: Crack Switch (Out) is in set 2, low on the wall');
  check(raw[WALL_ORNAMENT_CRACK_SWITCH_IN] === 0, 'graphics.dat: Crack Switch (In) is in set 0, at eye level — the defect');
  for (const g of [0, 1]) {
    const a = graphics.getImage(ornamentGraphic(WALL_ORNAMENT_CRACK_SWITCH_OUT) + g);
    const b = graphics.getImage(ornamentGraphic(WALL_ORNAMENT_CRACK_SWITCH_IN) + g);
    check(a.width === b.width && a.height === b.height, `the ${g ? 'front' : 'side'} bitmaps of Out and In are the same size`);
  }
  check(fixed[WALL_ORNAMENT_CRACK_SWITCH_IN] === 2, 'the port reads Crack Switch (In) in set 2, as its Out twin');
  const changed = [...raw.keys()].filter((i) => raw[i] !== fixed[i]);
  check(changed.length === 1 && changed[0] === WALL_ORNAMENT_CRACK_SWITCH_IN, `only entry 55 differs from graphics.dat (differs: ${changed.join(',')})`);

  // --- the wall, before and after the click ----------------------------------------
  const game = makeGame();
  game.ctx.party.state.position = PARTY;
  game.ctx.party.state.facing = FACING_WEST;
  game.ctx.party.state.cursorOwner = 0;
  game.ctx.party.state.objectInHand = OBJECT_ID_NULL;

  const before = faceActuators(game);
  const seenBefore = ornamentAhead(game);
  const touched = game.handleWallClick();
  const after = faceActuators(game);
  const seenAfter = ornamentAhead(game);

  console.log('');
  console.log(['', 'face actuators', 'ornament seen', 'set'].join('\t'));
  console.log(['before', before.map((rn) => decodeObjectID(rn).index).join(','), seenBefore, fixed[seenBefore]].join('\t'));
  console.log(['after', after.map((rn) => decodeObjectID(rn).index).join(','), seenAfter, fixed[seenAfter]].join('\t'));

  check(before.length === 2, 'two actuators on the east face');
  check(seenBefore === WALL_ORNAMENT_CRACK_SWITCH_OUT, 'before the click the party sees Crack Switch (Out)');
  check(touched, 'the click touches the wall');
  check(after.length === 2 && after[0] === before[1] && after[1] === before[0], 'RotateActuatorList swaps the two actuators');
  check(seenAfter === WALL_ORNAMENT_CRACK_SWITCH_IN, 'after it the party sees Crack Switch (In)');
  check(fixed[seenBefore] === fixed[seenAfter], 'and draws it with the same coordinate set: the crack does not move');

  finish();
}

main();
