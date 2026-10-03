/**
 * The words on the wall the party stands against.
 *
 * `DrawWallDecoration` draws a text's lines itself when the wall is the one in front of
 * the party (`relativePosition == 12`, `doc/CSBwin-src/CSBCode.cpp:3245-3290`). A line is
 * the bytes up to one of 128 or more, 18 of them at most, centred: `x1 = 112 - 4*length`,
 * each glyph 8 pixels on, `y2 = d.Byte4196[line]`, `y1 = y2 - 7`. Each byte is blitted
 * from graphic 120 by `TAG0088b2(font, viewport, &rect, 8*code, 0, 144, 112, 10)`
 * (`:3278-3285`): source x `8*code` in lines of 144 bytes, 288 pixels, colour 10 left out.
 *
 * Nothing checks `code` against the font's 36 glyphs. `TAG0088b2` addresses its source as
 * `src + srcY*srcByteWidth + srcX/2` (`doc/CSBwin-src/Graphics.cpp:559`), so a code of 36
 * or more reads on into the rows below: glyph `code - 36`, one row up, its last row read
 * from past the graphic's end, where the port writes nothing. No wall text of `dm-atari`
 * or of the French 1.3 set holds such a code: the two French texts that decode to a 50,
 * `TEXT #44` and `#118` (`doc/ATARI_ST_DISK_REFERENCE.md` → "The French 1.3 disk"), are a
 * scroll's and the message of a square the party is sent to, not a wall's.
 *
 *   1. graphic 120 is 288x8 in both sets: 36 glyphs, and the 144 bytes a line CSBWin gives.
 *   2. every text on a wall of `dm-atari` and of `dm-atari-1.3-fr`, drawn by `drawWallText`
 *      and by the addressing above written out here, pixel for pixel; none has more
 *      lines than `d.Byte4196` has entries, a line over 18 glyphs or a code past the font.
 *   3. a code of 50 on its own: glyph 14's rows 1 to 7 in rows 0 to 6, and row 7 untouched.
 *
 * Run: `npx tsx tools/dump-wall-text.ts`
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DBType, OBJECT_ID_EOF, Position, RoomType, type ObjectID } from '../src/core/types';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { GraphicsLoader } from '../src/data/GraphicsLoader';
import { drawWallText } from '../src/renderer/bytecode/DrawDecorations';
import { ViewportDraw } from '../src/renderer/bytecode/ViewportDraw';
import { createPaletteIndexViewportBuffer, type IndexedBitmap } from '../src/renderer/csbwin/CanvasBlitter';
import { getCachedGraphicBitmap } from '../src/renderer/ViewportGraphics';
import { check, finish } from './lib/check';
import { graphicsTablesOf, newGame } from './lib/game';

const GLYPHS = 36;
/** The viewport cleared to 16, which is no colour, so every pixel drawn shows. */
const UNDRAWN = 16;

/** CSBWin's blit of one line, written from its addressing and nothing of the port's. */
function expectLine(font: IndexedBitmap, pixels: Uint8Array, codes: number[], y2: number): void {
  const length = Math.min(18, codes.length);
  const x1 = 112 - 4 * length;
  for (let i = 0; i < length; i++) {
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const at = row * 288 + 8 * codes[i]! + col;
        if (at >= font.pixels.length || font.pixels[at] === 10) continue;
        pixels[(y2 - 7 + row) * 224 + x1 + 8 * i + col] = font.pixels[at]!;
      }
    }
  }
}

/** A text's lines: the codes up to each byte of 128 or more, ending at 129. */
function linesOf(bytes: Uint8Array): number[][] {
  const lines: number[][] = [[]];
  for (const b of bytes) {
    if (b < 128) lines[lines.length - 1]!.push(b);
    else if (b === 129) break;
    else lines.push([]);
  }
  return lines;
}

for (const set of ['dm-atari', 'dm-atari-1.3-fr']) {
  console.log(`=== ${set} ===`);
  const loader = new DungeonLoader();
  loader.loadFromArray(new Uint8Array(readFileSync(resolve(`static/gamefiles/${set}/dungeon.dat`))));
  const data = loader.getData();
  if (!data) throw new Error(`${set}/dungeon.dat did not load`);
  const graphics = new GraphicsLoader();
  graphics.loadFromArray(new Uint8Array(readFileSync(resolve(`static/gamefiles/${set}/graphics.dat`))));
  const dungeon = newGame(data, graphics).ctx.dungeon;
  const tables = graphicsTablesOf(graphics).objects;
  const cache = new Map<string, IndexedBitmap>();
  const getGraphicBitmap = (n: number): IndexedBitmap | null => getCachedGraphicBitmap(graphics, cache, n);

  // 1. The font.
  const font = getGraphicBitmap(120)!;
  console.log(`graphic 120 is ${font.width}x${font.height}; Byte4196 ${Array.from(tables.wallTextLineY2).join(',')}`);
  check(font.width === 8 * GLYPHS && font.height === 8, 'graphic 120 is 288x8: 36 glyphs of 8x8, 144 bytes a line');

  const draw = (bytes: Uint8Array | null, rn: ObjectID): Uint8Array => {
    const viewportIndexBuffer = createPaletteIndexViewportBuffer(224, 136, UNDRAWN);
    const context: any = {
      viewportIndexBuffer,
      objectTables: tables,
      getGraphicBitmap,
      dungeonState: bytes === null ? dungeon : { getTextRecord: () => ({}), decodeWallTextBytes: () => bytes },
    };
    drawWallText(new ViewportDraw(context), rn, 12, false);
    return viewportIndexBuffer.pixels;
  };

  // 2. Every text in the dungeon, by the square it is on. A wall's is drawn as the wall
  // in front shows it.
  let wallTexts = 0;
  let mostLines = 0;
  let longestLine = 0;
  let wrong = 0;
  const pastOnWalls: string[] = [];
  const pastElsewhere: string[] = [];
  for (let z = 0; z < data.maps.length; z++) {
    const map = dungeon.getMap(z)!;
    for (let x = 0; x < map.cellFlags.length; x++) {
      for (let y = 0; y < map.cellFlags[x]!.length; y++) {
        const roomType = (map.cellFlags[x]![y]! >> 5) & 0x7;
        for (let rn = dungeon.findFirstObject(new Position(x, y, z)); rn !== OBJECT_ID_EOF; rn = dungeon.getDBRecordLink(rn)) {
          if (dungeon.rnMaps.dbType(rn) !== DBType.TEXT) continue;
          const record = dungeon.getTextRecord(rn);
          const bytes = record ? dungeon.decodeWallTextBytes(record, tables.textDecode) : null;
          if (!bytes) continue;
          const lines = linesOf(bytes);
          const past = lines.some((codes) => codes.some((code) => code >= GLYPHS));
          const name = `TEXT #${dungeon.rnMaps.idx(rn)} at map ${z} (${x},${y})`;
          if (roomType !== RoomType.STONE) {
            if (past) pastElsewhere.push(`${name}, room type ${roomType}`);
            continue;
          }
          wallTexts++;
          mostLines = Math.max(mostLines, lines.length);
          longestLine = Math.max(longestLine, ...lines.map((codes) => codes.length));
          if (past) pastOnWalls.push(name);
          const expected = new Uint8Array(224 * 136).fill(UNDRAWN);
          lines.slice(0, tables.wallTextLineY2.length).forEach((codes, line) => expectLine(font, expected, codes, tables.wallTextLineY2[line]!));
          if (Buffer.compare(draw(null, rn), expected) !== 0) {
            wrong++;
            console.log(`  ${name} is not drawn as CSBWin addresses it: ${lines.map((l) => l.join(' ')).join(' / ')}`);
          }
        }
      }
    }
  }
  console.log(`${wallTexts} visible texts on walls: ${mostLines} lines at most, ${longestLine} glyphs a line at most`);
  console.log(`a code past the font, on a wall: ${pastOnWalls.join('; ') || 'none'}; elsewhere: ${pastElsewhere.join('; ') || 'none'}`);
  check(wallTexts > 0 && wrong === 0, `every wall text of ${set} is drawn glyph for glyph as TAG0088b2 addresses graphic 120`);
  check(mostLines <= tables.wallTextLineY2.length && longestLine <= 18,
    'no wall text has more lines than Byte4196 has entries, or a line over 18 glyphs');
  check(pastOnWalls.length === 0, `no wall text of ${set} has a code past the font`);
  check(pastElsewhere.length === (set === 'dm-atari' ? 0 : 1),
    set === 'dm-atari' ? 'and no text on a square' : "the French message of map 0 (9,1) decodes to one as a wall's, and is on a teleporter");

  // 3. A code of 50 alone on a line: source x 400, which is x 112 of the row below.
  const one = draw(Uint8Array.of(50, 129), dungeon.rnMaps.rn(DBType.TEXT, 0));
  const x1 = 112 - 4;
  const y2 = tables.wallTextLineY2[0]!;
  let asGlyph14 = true;
  let drawn = 0;
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const got = one[(y2 - 7 + row) * 224 + x1 + col]!;
      const below = row < 7 ? font.pixels[(row + 1) * 288 + 8 * (50 - GLYPHS) + col]! : 10;
      if (got !== (below === 10 ? UNDRAWN : below)) asGlyph14 = false;
      if (got !== UNDRAWN) drawn++;
    }
  }
  const outside = one.reduce((n, p, i) => {
    const x = i % 224;
    const y = Math.floor(i / 224);
    return n + (p !== UNDRAWN && !(x >= x1 && x <= x1 + 7 && y >= y2 - 7 && y <= y2) ? 1 : 0);
  }, 0);
  console.log(`code 50 alone: ${drawn} pixels drawn at x ${x1}..${x1 + 7}, y ${y2 - 7}..${y2}`);
  check(asGlyph14 && outside === 0, "code 50 draws glyph 14's rows 1 to 7 one row up, and nothing in its last row or outside its cell");
  if (set === 'dm-atari') check(drawn > 0, 'which is not nothing: glyph 14 has pixels below its first row');
  console.log('');
}

finish();
