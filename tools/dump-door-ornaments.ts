/**
 * The door ornament tables, and the canaries that place them in `graphics.dat` item 0x22e.
 *
 * `TAG004b26` (`doc/CSBwin-src/CSBCode.cpp:4058-4124`) draws a door's ornament onto the
 * door's bitmap from four tables: `d.Byte5070` (with `Byte5058` after it), an ornament's
 * rectangle per position set and nearness; `d.Byte4122`, an ornament's position set; and
 * the colour maps `d.Byte4172` (F3) and `d.Byte4188` (F2). None of them names its bytes,
 * so this proves them against the graphics they describe:
 *
 * - each ornament's F1 rectangle is exactly its graphic's size, 303 + the ornament
 *   (`Code390e.cpp:278-284`), and slots 15 and 16, graphics 301 and 302, use set 1
 *   (`CSBCode.cpp:10375-10386`);
 * - set 1 is the whole door: its three rectangles are the three door graphics' sizes;
 * - both colour maps keep colour 9, the transparent one, as 9.
 *
 * And, for `dm-atari/dungeon.dat`, that no door names an ornament past its level's
 * `DoorDecorationTOC`, so no door reads a slot another level left behind.
 *
 * Run: `npm test -- --only=dump-door-ornaments.ts`
 */
import { OBJECT_ID_EOF, Position, RoomType } from '../src/core/types';
import { check, finish } from './lib/check';
import { graphicsTablesOf, newGame, stockGraphics, stockDungeon } from './lib/game';

const NEARNESS = ['F3', 'F2', 'F1'];

function main(): void {
  const graphics = stockGraphics();
  const tables = graphicsTablesOf(graphics).objects;
  const sets = tables.doorOrnamentRectSets;

  console.log('Byte5070 / Byte5058: x1 x2 y1 y2 widthBytes height');
  sets.forEach((set, s) =>
    set.forEach((r, n) => console.log(`  set ${s} ${NEARNESS[n]}: ${r.x1} ${r.x2} ${r.y1} ${r.y2} ${r.widthBytes} ${r.height}`))
  );
  console.log(`Byte4122: ${Array.from(tables.doorOrnamentRectSetIndex).join(' ')}`);
  console.log(`Byte4172: ${Array.from(tables.doorOrnamentColorMapF3).join(' ')}`);
  console.log(`Byte4188: ${Array.from(tables.doorOrnamentColorMapF2).join(' ')}`);

  const f1Fits = (graphicNum: number, set: number): boolean => {
    const image = graphics.getImage(graphicNum);
    const f1 = sets[set][2];
    console.log(`  graphic ${graphicNum}: ${image.width}x${image.height}, set ${set} F1 ${2 * f1.widthBytes}x${f1.height}`);
    return image.width === 2 * f1.widthBytes && image.height === f1.height && f1.x2 - f1.x1 + 1 === image.width;
  };
  console.log('Ornaments at F1:');
  for (let ornament = 0; ornament < 12; ornament++) {
    const set = tables.doorOrnamentRectSetIndex[ornament];
    check(set < 4 && f1Fits(303 + ornament, set), `canary: ornament ${ornament}'s F1 rectangle in set ${set} is graphic ${303 + ornament}'s size`);
  }
  check(f1Fits(301, 1) && f1Fits(302, 1), 'canary: the bashed and See-Thru-Walls ornaments fit set 1 at F1');

  // Door graphics 108-110 are door type 0 at F3, F2, F1 (`Code390e.cpp:182-196`).
  for (let n = 0; n < 3; n++) {
    const image = graphics.getImage(108 + n);
    const r = sets[1][n];
    check(r.x1 === 0 && r.y1 === 0 && r.x2 + 1 === image.width && r.y2 + 1 === image.height && 2 * r.widthBytes === image.width,
      `canary: set 1 at ${NEARNESS[n]} is the whole door, ${image.width}x${image.height}`);
  }
  check(tables.doorOrnamentColorMapF3[9] === 90 && tables.doorOrnamentColorMapF2[9] === 90,
    'both colour maps keep the transparent colour 9 (ShrinkBLT reads an entry as colour * 10)');

  const data = stockDungeon();
  const dungeon = newGame(data, graphics).ctx.dungeon;
  let past = 0;
  let ornate = 0;
  data.maps.forEach((map, z) => {
    const count = map.doorDecorationTOC?.length ?? 0;
    for (let x = 0; x < map.descriptor.width; x++) {
      for (let y = 0; y < map.descriptor.height; y++) {
        if (map.cellFlags[x][y] >> 5 !== RoomType.DOOR) continue;
        const rn = dungeon.findFirstDoor(new Position(x, y, z));
        if (rn === OBJECT_ID_EOF) continue;
        const door = dungeon.getDoorRecordByIndex(dungeon.rnMaps.idx(rn));
        if (!door || door.ornateNumber === 0) continue;
        ornate++;
        if (door.ornateNumber > count) past++;
      }
    }
  });
  console.log(`dm-atari: ${ornate} doors with an ornament, ${past} past their level's count`);
  check(past === 0, 'no door in dm-atari names an ornament past its level\'s DoorDecorationTOC');
}

main();
finish();
