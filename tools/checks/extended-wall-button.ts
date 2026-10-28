/**
 * The wall in front is viewport button 5 whatever draws its decoration, `CSBgraphics.dat`
 * included.
 *
 * `DrawWallDecoration` copies the front wall's rectangle into `d.ViewportObjectButtons[5]`
 * under `if (graphicIndex >= 0)` (`doc/CSBwin-src/CSBCode.cpp:3355-3372`). An extended
 * decoration, a DSA's `0x10000 | ParameterA` (`Codea59a.cpp:113-127`), has a
 * `graphicIndex` of 0x10000 and up, so it passes, with its own rectangle,
 * `pExtWallRects[12]` (`:3257-3262`); it is no alcove, and never the ornate alcove nor the
 * fountain. A click on the wall holding an object reaches `TouchWallF1` only through
 * button 5 (`Mouse.cpp:1181-1229`), and an empty-handed one too (`:1097-1129`).
 *
 * Conflux 3.5 puts one on each of its four guild locks beside the start: on map 0, the
 * west faces of (22,25), (22,26), (22,29) and (22,30) hold a lock, a SHURIKEN, a CORBUM, a
 * MONK STAFF and a MACE, then a DSA whose graphic is drawn over it. Each lock sets a bit of
 * the combination at (23,27), which opens the door at (22,27) when all four are set.
 *
 *   1. each lock's face, summarised, shows the DSA's extended decoration, not the lock's;
 *   2. drawn from the square west of it, facing east, with Conflux's `CSBgraphics.dat`,
 *      button 5 is that decoration's rectangle 12, and the party faces no alcove;
 *   3. a click at its centre with the lock's item in hand, through `handleMouseButton`,
 *      takes the item;
 *   4. once the four are taken, the door at (22,27) opens.
 *
 * Run: `npm test -- --only=extended-wall-button.ts`
 */
import { readFileSync } from 'node:fs';

import { DBType, OBJECT_ID_EOF, OBJECT_ID_NULL, Position, type ObjectID } from '../../src/core/types';
import { CSBGraphicsLoader } from '../../src/data/CSBGraphicsLoader';
import { DungeonLoader } from '../../src/data/DungeonLoader';
import { GraphicsLoader } from '../../src/data/GraphicsLoader';
import type { SummarizeRoomData } from '../../src/renderer/bytecode/Types';
import { summarizeRoomInfoCsbwin } from '../../src/renderer/csbwin/SummarizeRoomInfo';
import { handleMouseButton } from '../../src/renderer/ui/Mouse';
import { VIEWPORT_Y } from '../../src/renderer/ViewportGraphics';
import { ViewportRenderer } from '../../src/renderer/ViewportRenderer';
import { check, finish } from '../lib/check';
import { graphicsStoreOf, graphicsTablesOf, newGame } from '../lib/game';
import { newUIState } from '../lib/ui';

const DIR = 'tools/fixtures/gamefiles/conflux-3.5-b8';
const EAST = 1;
const WEST = 3;
const DOOR = new Position(22, 27, 0);
/** Each lock's square, and a square of map 0 where its item lies. */
const LOCKS: Array<{ lock: Position; item: Position; name: string }> = [
  { lock: new Position(22, 25, 0), item: new Position(11, 2, 0), name: 'SHURIKEN' },
  { lock: new Position(22, 26, 0), item: new Position(14, 7, 0), name: 'CORBUM' },
  { lock: new Position(22, 29, 0), item: new Position(14, 4, 0), name: 'MONK STAFF' },
  { lock: new Position(22, 30, 0), item: new Position(21, 5, 0), name: 'MACE' },
];

const data = new DungeonLoader().loadDungeonDat(new Uint8Array(readFileSync(`${DIR}/dungeon.dat`)));
if (!data) throw new Error('Conflux 3.5 dungeon.dat did not load');
const graphics = new GraphicsLoader();
graphics.loadFromArray(new Uint8Array(readFileSync(`${DIR}/graphics.dat`)));
const csbGraphics = new CSBGraphicsLoader();
csbGraphics.loadFromArray(new Uint8Array(readFileSync(`${DIR}/CSBgraphics.dat`)));

const game = newGame(data, graphics, { trace: () => {} });
const dungeon = game.ctx.dungeon;
const party = game.ctx.party.state;
party.cursorOwner = 0;

const store = graphicsStoreOf(graphics);
const tables = graphicsTablesOf(graphics);
const renderer = new ViewportRenderer({
  graphicsLoader: graphics,
  csbGraphicsLoader: csbGraphics,
  dungeonState: dungeon,
  viewportTables: tables.viewport,
  objectTables: tables.objects,
  palette552: tables.ui.graphic232.palette552,
  graphics: store,
  getGraphicBitmap: (n) => store.basicGraphic(n),
  trace: () => {},
});
renderer.selectLevel(0);
const ui = newUIState(graphics, game.ctx);

/** The first weapon or misc item of `at`, taken off the floor. */
function takeItem(at: Position): ObjectID {
  for (let rn = dungeon.findFirstObject(at); rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) {
    const type = dungeon.rnMaps.dbType(rn);
    if (type === DBType.WEAPON || type === DBType.MISC) {
      dungeon.removeObjectFromCell(at, rn);
      return rn;
    }
  }
  throw new Error(`no item at (${at.x},${at.y})`);
}

/** `roomData`'s front face of `lock`, seen facing east: its decoration ordinal. */
function frontDecoration(lock: Position): number {
  const rslt: SummarizeRoomData = {
    x: lock.x, y: lock.y, relativeCellNumber: 17, skinNumber: 0, roomType: 0, championPortraitOrdinal: 0,
    graphicRoomType: 0, rn2: OBJECT_ID_EOF, decorations: [0, 0, 0], text: [OBJECT_ID_EOF, OBJECT_ID_EOF, OBJECT_ID_EOF],
  };
  summarizeRoomInfoCsbwin(rslt, dungeon, lock, EAST, tables.objects);
  return rslt.decorations[1]!;
}

const doorState = (): number => dungeon.getMap(0)!.cellFlags[DOOR.x]![DOOR.y]! & 7;
console.log(`door (22,27) state ${doorState()}`);
check(doorState() === 4, 'the door at (22,27) starts closed');

for (const { lock, item, name } of LOCKS) {
  const ordinal = frontDecoration(lock);
  const ext = csbGraphics.getWallDecoration(ordinal & 0xffff);
  const rect = ext?.desc[12];
  check((ordinal & 0x10000) !== 0 && rect !== undefined,
    `1. (${lock.x},${lock.y})'s west face shows extended decoration 0x${(ordinal & 0xffff).toString(16)}, in CSBgraphics.dat`);

  const at = new Position(lock.x - 1, lock.y, 0);
  party.position = at;
  party.facing = EAST;
  ui.picking = renderer.draw(at, EAST, false, false);
  const button = ui.picking.viewportObjectButtons[5]!;
  console.log(`(${lock.x},${lock.y}) ${name}: decoration 0x${ordinal.toString(16)}, button 5 ${button.x1}-${button.x2} x ${button.y1}-${button.y2}, rectangle 12 ${rect?.x1}-${rect?.x2} x ${rect?.y1}-${rect?.y2}`);
  check(rect !== undefined && button.x1 === rect.x1 && button.x2 === rect.x2 && button.y1 === rect.y1 && button.y2 === rect.y2 && !ui.picking.facingAlcove,
    `2. button 5 is its rectangle 12, and no alcove`);

  const object = takeItem(item);
  party.objectInHand = object;
  handleMouseButton(ui, 80, (button.x1 + button.x2) >> 1, ((button.y1 + button.y2) >> 1) + VIEWPORT_Y);
  check(party.objectInHand === OBJECT_ID_NULL, `3. a click on it with a ${name} in hand: the lock on its ${['north', 'east', 'south', 'west'][WEST]} face takes it`);
  for (let i = 0; i < 3; i++) game.gameTick();
}

for (let i = 0; i < 20; i++) game.gameTick();
console.log(`door (22,27) state ${doorState()}`);
check(doorState() === 0, '4. with the four taken, the door at (22,27) is open');

finish();
