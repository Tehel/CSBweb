/**
 * The magic footprint decoration: `SummarizeRoomInfo`'s `tag00a984` arm
 * (`doc/CSBwin-src/Codea59a.cpp:401-426`), `summarizeRoomInfoCsbwin`.
 *
 * Where `cfD4` is still set by the room-type switch (an open floor, a teleporter, a door,
 * an open false wall, a pit whose flag bit 0 is set: `:263-392`), the newest print on the
 * cell (`SearchFootprints`, `CSBCode.cpp:7125`), if its index lies in
 * `[d.IndexOfFirstMagicFootprint, d.IndexOfLastMagicFootprint)`, sets bit 15 of the floor
 * decoration, which the cell program draws as the footprint graphic. Stairs clear `cfD4`
 * (`:373`), so a print there never shows. An open false wall falls through into `roomOPEN`
 * and so on to `cfD4 = 1` (`:296-308`), whatever its bit 8.
 *
 * The trail is a real `PartyFootprints` walked over real cells of level 0 of
 * `dm-atari/dungeon.dat`: one print before YA BRO ROS's mark (`markMagicFootprints`,
 * `Magic.cpp:1335-1344`), the rest after it, as `MoveObject` records them.
 *
 * The same bit is set where prints can show by the cell's extended cell flag
 * `ECF_FOOTPRINTS` (bit 0), once `d.Time > 0` (`:419-425`): `GetExtendedCellFlag`
 * (`data.cpp:1682-1692`) reads the cell's row bit of longword 0 of the column's `EXPOOL`
 * record, `(EDT_ExtendedCellFlags << 24) + (level << 5) + x`, which a DSA's `&ECF!` writes,
 * and finds nothing in a record shorter than eight longwords.
 *
 * Then the drawing. `DrawFloorDecorations` draws the bit as ordinal 16
 * (`CSBCode.cpp:4049-4052`), slot 15 of `d.LoadedFloorDecorations`, which no level fills:
 * `ReadTablesFromGraphicsFile` sets it once to graphic 241 and rectangle set 1
 * (`:10394-10397`). The canary for both numbers: graphics 241-246 are the sizes of set 1's
 * nine rectangles and of no other set's. And a frame of the real renderer with a magic
 * print on the cell ahead differs from the frame without it, inside that cell's rectangle,
 * the trail having been round its ring of 24 and the party having walked on from the print.
 *
 * Run: `npm test -- --only=footprint-decoration.ts`
 */
import { OBJECT_ID_EOF, Position, RoomType } from '../../src/core/types';
import { DungeonState, extendedCellFlagsKey } from '../../src/engine/DungeonState';
import { PartyFootprints } from '../../src/engine/PartyFootprints';
import { GraphicRoomType, type SummarizeRoomData } from '../../src/renderer/bytecode/Types';
import type { IndexedBitmap } from '../../src/renderer/csbwin/CanvasBlitter';
import { summarizeRoomInfoCsbwin } from '../../src/renderer/csbwin/SummarizeRoomInfo';
import { getCachedGraphicBitmap } from '../../src/renderer/ViewportGraphics';
import { ViewportRenderer } from '../../src/renderer/ViewportRenderer';
import { check, finish } from '../lib/check';
import { graphicsTablesOf, stockGraphics, stockDungeon } from '../lib/game';

function main(): void {
  const data = stockDungeon();
  const dungeon = new DungeonState(data);
  const map = dungeon.getMap(0);
  if (!map) throw new Error('no level 0');

  // The first cells of level 0 of each room type the scenarios need.
  const cellsOf = (type: RoomType): Position[] => {
    const out: Position[] = [];
    for (let x = 0; x < map.descriptor.width; x++) {
      for (let y = 0; y < map.descriptor.height; y++) {
        if ((map.cellFlags[x]![y]! >> 5) === type) out.push(new Position(x, y, 0));
      }
    }
    return out;
  };
  const open = cellsOf(RoomType.OPEN);
  const doors = cellsOf(RoomType.DOOR);
  const stairs = cellsOf(RoomType.STAIRS);
  check(open.length >= 4 && doors.length > 0 && stairs.length > 0,
    `level 0 has four open cells, a door and stairs (${open.length}, ${doors.length}, ${stairs.length})`);
  const [plain, magic, untrodden, falseWall] = open as [Position, Position, Position, Position];
  const door = doors[0]!;
  const stair = stairs[0]!;
  // An open false wall with bit 8 clear: `:293-296` leave `cfD4` 0 until `tag00a85c`.
  map.cellFlags[falseWall.x]![falseWall.y] = (RoomType.FALSEWALL << 5) | 4;

  const footprints = new PartyFootprints();
  let time = 100;
  const walk = (p: Position, magicActive: boolean): void => {
    footprints.recordPartyMove((time += 5), 0, p.x, p.y, magicActive);
  };
  walk(plain, false);
  footprints.markMagicFootprints(4);
  for (const p of [magic, door, stair, falseWall]) walk(p, true);
  console.log(`  trail of ${footprints.getCount()}, magic [${footprints.getIndexOfFirstMagicFootprint()}, ${footprints.getIndexOfLastMagicFootprint()})`);

  const summarize = (p: Position): SummarizeRoomData => {
    const rslt: SummarizeRoomData = {
      x: p.x,
      y: p.y,
      relativeCellNumber: 0,
      skinNumber: 0,
      roomType: RoomType.STONE,
      championPortraitOrdinal: 0,
      graphicRoomType: GraphicRoomType.STONE,
      rn2: OBJECT_ID_EOF,
      decorations: [0, 0, 0],
      text: [OBJECT_ID_EOF, OBJECT_ID_EOF, OBJECT_ID_EOF],
    };
    summarizeRoomInfoCsbwin(rslt, dungeon, new Position(0, 0, 0), 0, undefined, footprints);
    return rslt;
  };

  const expect = (p: Position, shown: boolean, what: string): void => {
    const decoration = summarize(p).decorations[2];
    const bit = (decoration & 0x8000) !== 0;
    console.log(`  ${what} (${p.x},${p.y}): decorations[2] = 0x${decoration.toString(16)}`);
    check(bit === shown, `${what}: the footprint bit is ${shown ? 'set' : 'clear'}`);
  };
  expect(plain, false, 'a print before the mark');
  expect(magic, true, 'a magic print on open floor');
  expect(untrodden, false, 'open floor with no print');
  expect(door, true, 'a magic print on a door');
  expect(stair, false, 'a magic print on stairs');
  expect(falseWall, true, 'a magic print on an open false wall');

  // Without the trail the arm has nothing to search: the same magic print is not drawn.
  const bare = summarize(magic);
  summarizeRoomInfoCsbwin(bare, dungeon, new Position(0, 0, 0), 0);
  check((bare.decorations[2] & 0x8000) === 0, 'no trail, no footprint bit');

  // A record is a column's, so each scenario takes an open cell in a column of its own.
  const columns = new Set([stair.x]);
  const fresh = open.filter((p) => !columns.has(p.x) && columns.add(p.x));
  check(fresh.length >= 3, `level 0 has open cells in three more columns (${fresh.length})`);
  extendedCellFlags(dungeon, fresh.slice(0, 3) as [Position, Position, Position], stair);
  drawing();
  finish();
}

/** `ECF_FOOTPRINTS`, on cells no print has reached. */
function extendedCellFlags(dungeon: DungeonState, [cell, others, short]: [Position, Position, Position], stair: Position): void {
  const flagged = (p: Position, time: number): boolean => {
    const rslt: SummarizeRoomData = {
      x: p.x,
      y: p.y,
      relativeCellNumber: 0,
      skinNumber: 0,
      roomType: RoomType.STONE,
      championPortraitOrdinal: 0,
      graphicRoomType: GraphicRoomType.STONE,
      rn2: OBJECT_ID_EOF,
      decorations: [0, 0, 0],
      text: [OBJECT_ID_EOF, OBJECT_ID_EOF, OBJECT_ID_EOF],
    };
    summarizeRoomInfoCsbwin(rslt, dungeon, new Position(0, 0, 0), 0, undefined, undefined, time);
    return (rslt.decorations[2] & 0x8000) !== 0;
  };
  const record = (p: Position, flags: number[]): void => {
    dungeon.writeExpoolRecord(extendedCellFlagsKey({ l: 0, x: p.x, y: p.y, p: 0 }), flags.map((f) => (f << p.y) >>> 0));
    console.log(`  (${p.x},${p.y}): a record of ${flags.length}, flags ${flags.join('')}`);
  };
  check(!flagged(cell, 1), 'open floor without a record: the footprint bit is clear');
  record(cell, [1, 0, 0, 0, 0, 0, 0, 0]);
  check(flagged(cell, 1), 'ECF_FOOTPRINTS on open floor, d.Time 1: the footprint bit is set');
  check(!flagged(cell, 0), 'the same at d.Time 0: clear');
  record(stair, [1, 0, 0, 0, 0, 0, 0, 0]);
  check(!flagged(stair, 1), 'ECF_FOOTPRINTS on stairs: clear');
  record(others, [0, 1, 1, 1, 1, 1, 1, 1]);
  check(!flagged(others, 1), 'every flag but ECF_FOOTPRINTS: clear');
  record(short, [1, 0, 0, 0, 0, 0, 0]);
  check(!flagged(short, 1), 'ECF_FOOTPRINTS in a record of seven longwords: clear');
}

/** The footprint graphic's slot, and a frame that shows it. */
function drawing(): void {
  const graphics = stockGraphics();
  const tables = graphicsTablesOf(graphics);
  const sets = tables.objects.floorDecorationDescSets;
  const increment = tables.objects.relativeCellGraphicIncrement;

  // Graphic 241 + `d.RelativeCellGraphicIncrement[cell]` in each set's rectangle for the cell.
  const fits = (set: number): boolean => sets[set]!.every((r, cell) => {
    const image = graphics.getImage(241 + increment[cell]!);
    return image.width === 2 * r.widthBytes && image.height === r.height && r.x2 - r.x1 + 1 <= image.width;
  });
  sets[1]!.forEach((r, cell) => {
    const image = graphics.getImage(241 + increment[cell]!);
    console.log(`  cell ${cell}: graphic ${241 + increment[cell]!} ${image.width}x${image.height}, set 1 ${2 * r.widthBytes}x${r.height} at ${r.x1}-${r.x2}, ${r.y1}-${r.y2}`);
  });
  check(fits(1) && !fits(0) && !fits(2), 'canary: graphics 241-246 are the sizes of set 1\'s rectangles, and of no other set\'s');

  // A fresh level 0: the scenarios above turned one of its cells into a false wall.
  const data = stockDungeon();
  const dungeon = new DungeonState(data);
  const map = dungeon.getMap(0)!;
  const isOpen = (x: number, y: number): boolean => y >= 0 && (map.cellFlags[x]![y]! >> 5) === RoomType.OPEN;
  let at: Position | null = null;
  for (let x = 0; x < map.descriptor.width && !at; x++) {
    for (let y = 1; y < map.descriptor.height && !at; y++) {
      if (isOpen(x, y) && isOpen(x, y - 1)) at = new Position(x, y, 0);
    }
  }
  if (!at) throw new Error('level 0 has no open cell with an open cell north of it');

  const footprints = new PartyFootprints();
  const graphicCache = new Map<string, IndexedBitmap>();
  const renderer = new ViewportRenderer({
    graphicsLoader: graphics,
    dungeonState: dungeon,
    viewportTables: tables.viewport,
    objectTables: tables.objects,
    palette552: tables.ui.graphic232.palette552,
    graphicCache,
    getGraphicBitmap: (graphicNum) => getCachedGraphicBitmap(graphics, graphicCache, graphicNum),
    trace: (line) => console.log(line),
    footprints,
  });
  const frame = (): Uint8Array => {
    renderer.selectLevel(0);
    renderer.draw(at!, 0, false, false);
    return renderer.buffer.pixels.slice();
  };
  // The trail as a game has it: round its ring of 24 already, on squares of another level.
  for (let i = 0; i < 30; i++) footprints.recordPartyMove(10 + i, 5, i, 1, false);
  const without = frame();
  const slots = renderer.context.loadedFloorDecorations!;
  const toc = map.floorDecorationTOC ?? [];
  console.log(`  d.LoadedFloorDecorations: ${slots.map(([graphic, set]) => `${graphic}/${set}`).join(' ')}`);
  check(slots.length === 16 && slots[15]![0] === 241 && slots[15]![1] === 1, 'slot 15 is graphic 241 in set 1');
  check(toc.length > 0 && toc.length < 16 && toc.every((d, i) => slots[i]![0] === 247 + 6 * d && slots[i]![1] === tables.objects.floorDecorationRectSetIndex[d]),
    `the level's ${toc.length} slots are 247 + 6 * its FloorDecorationTOC, in Byte4110's set`);
  // The party casts, steps on the cell ahead, then back to where the frame is seen from.
  footprints.markMagicFootprints(4);
  footprints.recordPartyMove(100, 0, at.x, at.y - 1, true);
  footprints.recordPartyMove(105, 0, at.x, at.y, true);
  const withPrint = frame();

  // The cell ahead is relative cell 7, the middle of the nearest row.
  const rect = sets[1]![7]!;
  let changed = 0;
  let outside = 0;
  for (let i = 0; i < without.length; i++) {
    if (without[i] === withPrint[i]) continue;
    changed++;
    const x = i % renderer.buffer.width;
    const y = Math.floor(i / renderer.buffer.width);
    if (x < rect.x1 || x > rect.x2 || y < rect.y1 || y > rect.y2) outside++;
  }
  console.log(`  from (${at.x},${at.y}) facing north, a magic print on (${at.x},${at.y - 1}): ${changed} pixels changed, ${outside} outside ${rect.x1}-${rect.x2}, ${rect.y1}-${rect.y2}`);
  check(changed > 0, 'a magic print on the cell ahead is drawn');
  check(outside === 0, 'and only inside set 1\'s rectangle for that cell');
}

main();
