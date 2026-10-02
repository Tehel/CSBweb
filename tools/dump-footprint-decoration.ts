/**
 * The magic footprint decoration: `SummarizeRoomInfo`'s `tag00a984` arm
 * (`doc/CSBwin-src/Codea59a.cpp:401-418`), `summarizeRoomInfoCsbwin`.
 *
 * Where `cfD4` is still set by the room-type switch (an open floor, a teleporter, a door,
 * an open false wall, a pit whose flag bit 0 is set: `:263-392`), the newest print on the
 * cell (`SearchFootprints`, `CSBCode.cpp:7066`), if its index lies in
 * `[d.IndexOfFirstMagicFootprint, d.IndexOfLastMagicFootprint)`, sets bit 15 of the floor
 * decoration, which the cell program draws as the footprint graphic. Stairs clear `cfD4`
 * (`:373`), so a print there never shows. An open false wall falls through into `roomOPEN`
 * and so on to `cfD4 = 1` (`:296-308`), whatever its bit 8.
 *
 * The trail is a real `PartyFootprints` walked over real cells of level 0 of
 * `dm-atari/dungeon.dat`: one print before YA BRO ROS's mark (`markMagicFootprints`,
 * `Magic.cpp:1333-1342`), the rest after it, as `MoveObject` records them.
 *
 * Then the drawing. `DrawFloorDecorations` draws the bit as ordinal 16
 * (`CSBCode.cpp:3984-3987`), slot 15 of `d.LoadedFloorDecorations`, which no level fills:
 * `ReadTablesFromGraphicsFile` sets it once to graphic 241 and rectangle set 1
 * (`:10270-10273`). The canary for both numbers: graphics 241-246 are the sizes of set 1's
 * nine rectangles and of no other set's. And a frame of the real renderer with a magic
 * print on the cell ahead differs from the frame without it, inside that cell's rectangle.
 *
 * Run: `npx tsx tools/dump-footprint-decoration.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Position } from '../src/core/types';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { DungeonState } from '../src/engine/DungeonState';
import { PartyFootprints } from '../src/engine/PartyFootprints';
import { GraphicRoomType, RoomType, type SummarizeRoomData } from '../src/renderer/bytecode/Types';
import type { IndexedBitmap } from '../src/renderer/csbwin/CanvasBlitter';
import { summarizeRoomInfoCsbwin } from '../src/renderer/csbwin/SummarizeRoomInfo';
import { getCachedGraphicBitmap } from '../src/renderer/ViewportGraphics';
import { ViewportRenderer } from '../src/renderer/ViewportRenderer';
import { check, finish } from './lib/check';
import { graphicsTablesOf, stockGraphics } from './lib/game';

function main(): void {
  const loader = new DungeonLoader();
  loader.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/dungeon.dat'))));
  const data = loader.getData();
  if (!data) throw new Error('dungeon.dat did not load');
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
      rn2: 0xfffe,
      decorations: [0, 0, 0],
      text: [0xfffe, 0xfffe, 0xfffe],
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

  drawing();
  finish();
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
  const loader = new DungeonLoader();
  loader.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/dungeon.dat'))));
  const data = loader.getData();
  if (!data) throw new Error('dungeon.dat did not load');
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
    footprints,
  });
  const frame = (): Uint8Array => {
    renderer.selectLevel(0);
    renderer.draw(at!, 0, false, false);
    return renderer.buffer.pixels.slice();
  };
  const without = frame();
  const slots = renderer.context.loadedFloorDecorations!;
  const toc = map.floorDecorationTOC ?? [];
  console.log(`  d.LoadedFloorDecorations: ${slots.map(([graphic, set]) => `${graphic}/${set}`).join(' ')}`);
  check(slots.length === 16 && slots[15]![0] === 241 && slots[15]![1] === 1, 'slot 15 is graphic 241 in set 1');
  check(toc.length > 0 && toc.length < 16 && toc.every((d, i) => slots[i]![0] === 247 + 6 * d && slots[i]![1] === tables.objects.floorDecorationRectSetIndex[d]),
    `the level's ${toc.length} slots are 247 + 6 * its FloorDecorationTOC, in Byte4110's set`);
  footprints.markMagicFootprints(4);
  footprints.recordPartyMove(100, 0, at.x, at.y - 1, true);
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
