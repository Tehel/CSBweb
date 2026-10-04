/**
 * The text the party finds on a square it enters.
 *
 * `PlaceOrRemoveObjectInRoom` decodes a text on the square with `DecodeText(text, …, 1,
 * 990)` and queues it with `QuePrintLines(15, text)` (`doc/CSBwin-src/Code11f52.cpp:3950-3963`).
 * `DecodeText` expands codes 29 and 30 through `d.Byte10080` and `d.Byte10016` for any
 * text but a wall's (`doc/CSBwin-src/CSBCode.cpp:5559-5574`), which is how the dungeon
 * stores "THE ", "YOU " and "!".
 *
 * In `dm-atari/dungeon.dat` the one visible text on a square that is not a wall is on
 * level 0 at (9, 1). The tool lists every such text, then stands the party there and
 * reads what the square's pads queued.
 *
 * Run: `npx tsx tools/dump-room-text.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DBType, OBJECT_ID_EOF, OBJECT_ID_NULL, Position, RoomType } from '../src/core/types';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { newGame } from './lib/game';
import { check, finish } from './lib/check';

const loader = new DungeonLoader();
loader.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/dungeon.dat'))));
const data = loader.getData();
if (!data) throw new Error('dungeon.dat did not load');
const graphics = new GraphicsLoader();
graphics.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/graphics.dat'))));

const queued: Array<{ color: number; text: string }> = [];
const game = newGame(data, graphics, {
  messages: {
    printLinefeed: () => {},
    quePrintLines: (color, text) => { queued.push({ color, text }); },
    printLines: () => {},
    setNewSpeed: () => {},
    resetTime: () => {},
    clockTick: () => {},
    printNextQueued: () => {},
    vblInterrupt: () => {},
    discardText: () => {},
  },
});
const dungeon = game.ctx.dungeon;

// Every text on a square that is not a wall, and whether it shows.
const visible: Position[] = [];
let hidden = 0;
for (let z = 0; z < data.maps.length; z++) {
  const map = dungeon.getMap(z)!;
  for (let x = 0; x < map.cellFlags.length; x++) {
    for (let y = 0; y < map.cellFlags[x]!.length; y++) {
      const p = new Position(x, y, z);
      if (((map.cellFlags[x]![y]! >> 5) & 0x7) === RoomType.STONE) continue;
      for (let rn = dungeon.findFirstObject(p); rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) {
        if (game.ctx.dungeon.rnMaps.dbType(rn) !== DBType.TEXT) continue;
        if (dungeon.getTextRecord(rn)!.visible) visible.push(p);
        else hidden++;
      }
    }
  }
}
console.log(`texts on open squares: ${visible.length} visible, ${hidden} hidden`);
check(visible.length === 1 && visible[0]!.z === 0 && visible[0]!.x === 9 && visible[0]!.y === 1,
  'the one visible text on a square that is not a wall is on level 0 at (9, 1)');

// The party enters that square: its pads decode the text and queue it.
const square = new Position(9, 1, 0);
game.ctx.party.state.position = square;
game.ctx.systems.actuators.triggerObjectMove(square, OBJECT_ID_NULL, true, false, game.ctx.party.state.facing);
for (const { color, text } of queued) console.log(`queued (colour ${color}): ${JSON.stringify(text)}`);
check(queued.length === 1 && queued[0]!.color === 15, 'entering it queues one text, in colour 15');
check(queued[0]?.text === '\nIT IS TOO BAD YOU DID NOT DISCOVER THE TRUE SECRET OF THE FIRESTAFF. ' +
  'NOW THAT I HAVE IT I HAVE NO FURTHER NEED FOR YOU!',
  'with its linefeed first, and the two "THE "s and the "!" its escapes stand for (CSBCode.cpp:5559-5574)');

finish();
