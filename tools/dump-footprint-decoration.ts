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
 * Run: `npx tsx tools/dump-footprint-decoration.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Position } from '../src/core/types';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { DungeonState } from '../src/engine/DungeonState';
import { PartyFootprints } from '../src/engine/PartyFootprints';
import { GraphicRoomType, RoomType, type SummarizeRoomData } from '../src/renderer/bytecode/Types';
import { summarizeRoomInfoCsbwin } from '../src/renderer/csbwin/SummarizeRoomInfo';
import { check, finish } from './lib/check';

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

  finish();
}

main();
