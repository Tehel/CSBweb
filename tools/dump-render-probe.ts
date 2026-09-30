/**
 * The render probe: every cell program, run on its own over controlled input.
 *
 * `DrawViewport` (`doc/CSBwin-src/Viewport.cpp:6694`) runs one bytecode program per
 * relative cell, chosen from `pStdDrawCode[21][8]` by the cell and its graphic room type
 * (`:1952`). 46 of the 168 slots are `NOP`, a null that `DrawViewport` skips: every type
 * at F4L2, F4R2, F2L2 and F2R2, and all but Stone at F3L2 and F3R2. F4L1, F4R1 and F4
 * run one `Any` program whatever the type. The golden frames see only the programs a few
 * fixed squares happen to reach. This runs all 122 against the real `graphics.dat`, with
 * a `ViewportRenderer` set up
 * for `dm-atari` level 0 as `drawViewportFrame` sets it up for a frame: the level's wall
 * and door graphics, its door ornaments, and the floor/ceiling mirror parity.
 *
 * For each program the viewport is cleared to 16, which is no colour (the viewport has 16,
 * and nothing in the renderer reads back what it draws over), and `roomData` is built by hand:
 * every cell open and empty, and the cell under test given one fixed summary for its type.
 *
 *   Stone, Open, DoorEdge  nothing: no decoration, no text, no objects
 *   Pit                    `decorations[0] = 0` (`cellFlags & 4` clear)
 *   Teleporter             `decorations[0] = 1` (the visible teleporter)
 *   DoorFacing             `decorations[0] = 4`, closed, `decorations[1]`: the first door
 *                          on level 0 in cell order
 *   StairEdge/StairFacing  `decorations[0] = 0` (`cellFlags & 4` clear)
 *
 * Everything runs twice: from the party's start square, and from the same square facing
 * one step clockwise, which flips `d.UseMirrorImages` (`Viewport.cpp:6740`).
 *
 * What it asserts: the port's table is null in exactly CSBWin's `NOP` slots and holds
 * the one `Any` program in each slot of F4L1, F4R1 and F4, no program reaches an
 * unimplemented opcode, and every program draws exactly what it drew when
 * `tools/reference/render-probe.tsv` was written, every pixel of it one of the 16 colours.
 * Under See-Thru-Walls, every program runs without an unimplemented opcode, and the F1
 * wall shows what is behind it through graphic 41's hole, pixel for pixel (`seeThruWalls`).
 * That file is the baseline: each row is a program's pass, cell and type, the pixels it
 * drew, and a hash of the whole
 * viewport. A deliberate renderer change rewrites it with `--update`, after looking at
 * the renders with `--png`. The teleporter's shimmer draws from `GraphicRandom`, a stream
 * the interpreter keeps across calls, so the rows depend on the order they run in.
 *
 * Run: `npx tsx tools/dump-render-probe.ts [--update] [--png]`
 *   --png     writes `tools/output/render-probe-<pass>.png`: a row a cell (F4L2 at the
 *             top, F0 at the bottom), a column a type, in the level's light-level-0
 *             viewport palette, with what a program left undrawn dark blue and a `NOP`
 *             slot magenta
 *   --update  rewrites the baseline instead of checking against it
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { atariToRGB, OBJECT_ID_EOF, Position, decodeObjectID } from '../src/core/types';
import { DungeonLoader } from '../src/data/DungeonLoader';
import { BytecodeInterpreter } from '../src/renderer/bytecode/BytecodeInterpreter';
import { BytecodePrograms } from '../src/renderer/bytecode/BytecodePrograms';
import { GraphicRoomType, RoomType, type SummarizeRoomData } from '../src/renderer/bytecode/Types';
import { extractUITables } from '../src/renderer/csbwin/UITables';
import type { IndexedBitmap } from '../src/renderer/csbwin/CanvasBlitter';
import {
  RelativeXY,
  cellNames,
  getBytecodeProgram,
  relativeX,
  relativeY,
  roomTypeNames,
} from '../src/renderer/DrawViewport';
import { getCachedGraphicBitmap } from '../src/renderer/ViewportGraphics';
import { ViewportRenderer } from '../src/renderer/ViewportRenderer';
import { check, fail, finish } from './lib/check';
import { newGame, stockGraphics } from './lib/game';
import { writeIndexedPng } from './lib/png';

const BASELINE = resolve('tools/reference/render-probe.tsv');
const OUTPUT = resolve('tools/output');
const update = process.argv.includes('--update');
const png = process.argv.includes('--png');

/** `pStdDrawCode`'s `NOP` slots (`doc/CSBwin-src/Viewport.cpp:1952-2090`): cell → the types that have none. */
const ALL_TYPES = [0, 1, 2, 3, 4, 5, 6, 7];
const NOP_SLOTS: Record<string, number[]> = {
  F4L2: ALL_TYPES,
  F4R2: ALL_TYPES,
  F3L2: ALL_TYPES.slice(1),
  F3R2: ALL_TYPES.slice(1),
  F2L2: ALL_TYPES,
  F2R2: ALL_TYPES,
};
/** The cells whose every slot is the same `StdDrawF4…Any` program. */
const ANY_CELLS = ['F4L1', 'F4R1', 'F4'];
/** What the viewport is cleared to: past the viewport's 16 colours, so every colour drawn shows. */
const UNDRAWN = 16;
/** The colour of a sheet's gutters and `NOP` tiles. */
const GUTTER = 17;

/** `graphicRoomType` → the `RoomType` `SummarizeRoomInfo` leaves beside it. */
const ROOM_TYPE: Record<GraphicRoomType, RoomType> = {
  [GraphicRoomType.STONE]: RoomType.STONE,
  [GraphicRoomType.OPEN]: RoomType.OPEN,
  [GraphicRoomType.PIT]: RoomType.PIT,
  [GraphicRoomType.TELEPORTER]: RoomType.TELEPORTER,
  [GraphicRoomType.DOOR_EDGE]: RoomType.DOOR_EDGE,
  [GraphicRoomType.DOOR_FACING]: RoomType.DOOR_FACING,
  [GraphicRoomType.STAIR_EDGE]: RoomType.STAIR_EDGE,
  [GraphicRoomType.STAIR_FACING]: RoomType.STAIR_FACING,
};

function main(): void {
  const loader = new DungeonLoader();
  loader.loadFromArray(new Uint8Array(readFileSync(resolve('static/gamefiles/dm-atari/dungeon.dat'))));
  const data = loader.getData();
  if (!data) throw new Error('dungeon.dat did not load');
  const graphics = stockGraphics();
  const game = newGame(data, graphics);
  const dungeon = game.ctx.dungeon;

  const graphicCache = new Map<string, IndexedBitmap>();
  const palette552 = extractUITables(graphics).graphic232.palette552;
  const renderer = new ViewportRenderer({
    graphicsLoader: graphics,
    dungeonState: dungeon,
    palette552,
    graphicCache,
    getGraphicBitmap: (graphicNum) => getCachedGraphicBitmap(graphics, graphicCache, graphicNum),
  });

  const start = game.ctx.party.state.position;
  const facing = game.ctx.party.state.facing & 3;
  const doorIndex = firstDoorIndex(dungeon, start.z);
  const door = dungeon.getDoorRecordByIndex(doorIndex);
  console.log(`level ${start.z}, start (${start.x},${start.y}) facing ${facing}; door ${doorIndex}: type ${door?.doorType} ornament ${door?.ornateNumber} button ${door?.hasButton}`);
  check(door !== null && door !== undefined, `level ${start.z} has a door for the DoorFacing programs`);

  const warnings: string[] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args.join(' ')); };

  const rows: string[] = [];
  let fallbacks = 0;
  for (const [pass, passFacing] of [['normal', facing], ['mirrored', (facing + 1) & 3]] as const) {
    renderer.selectLevel(start.z);
    renderer.draw(start, passFacing, false, false);
    const mirrored = renderer.context.useMirrorImages === true;
    check(mirrored === (pass === 'mirrored'), `the ${pass} pass draws with d.UseMirrorImages ${pass === 'mirrored'}`);

    const tiles: Uint8Array[] = [];
    for (let cell = 0; cell < 21; cell++) {
      for (let type = 0; type < 8; type++) {
        const program = getBytecodeProgram(cell, type);
        const name = `${cellNames[cell]}_${roomTypeNames[type]}`;
        const nop = NOP_SLOTS[cellNames[cell]]?.includes(type) ?? false;
        if (pass === 'normal') {
          check((program === null) === nop, `${name} ${nop ? 'is' : 'is not'} a NOP slot, as in CSBWin`);
          if (ANY_CELLS.includes(cellNames[cell])) {
            check(program === BytecodePrograms[`${cellNames[cell]}_Any`], `${name} runs StdDraw${cellNames[cell]}Any`);
          }
        }
        if (!program) {
          tiles.push(new Uint8Array(224 * 136).fill(GUTTER));
          continue;
        }
        if (!BytecodePrograms[name]) fallbacks++;
        const before = warnings.length;
        renderer.buffer.pixels.fill(UNDRAWN);
        renderer.context.roomData = roomDataFor(start, passFacing, cell, type as GraphicRoomType, doorIndex);
        new BytecodeInterpreter(renderer.context).interpret(program, cell);
        check(warnings.length === before, `${pass} ${name} runs without a warning: ${warnings.slice(before).join('; ')}`);

        const pixels = renderer.buffer.pixels;
        let drawn = 0;
        let stray = 0;
        for (const p of pixels) {
          if (p !== UNDRAWN) drawn++;
          if (p > UNDRAWN) stray++;
        }
        check(stray === 0, `${pass} ${name} draws only the viewport's 16 colours (${stray} pixels past them)`);
        const hash = createHash('sha256').update(pixels).digest('hex').slice(0, 16);
        rows.push([pass, cellNames[cell], roomTypeNames[type], drawn, hash].join('\t'));
        tiles.push(Uint8Array.from(pixels));
      }
    }
    if (png) writeSheet(`${OUTPUT}/render-probe-${pass}.png`, tiles, renderer.viewportPalettes?.[0] ?? palette552[0]);
  }
  seeThruWalls(renderer, start, facing, doorIndex, warnings);
  console.warn = warn;
  console.log(`${rows.length} programs run, ${fallbacks} through a cell's _Any program`);

  const header = 'pass\tcell\ttype\tdrawn\thash';
  if (update) {
    writeFileSync(BASELINE, [header, ...rows].join('\n') + '\n');
    console.log(`baseline written: ${BASELINE}`);
    check(rows.length === 2 * 122, 'every program has a row in each pass');
    return;
  }
  if (!existsSync(BASELINE)) {
    fail(`no baseline at ${BASELINE}: run with --update`);
    return;
  }
  const expected = readFileSync(BASELINE, 'utf8').trim().split('\n').slice(1);
  check(expected.length === rows.length, `the baseline has ${expected.length} rows, the run ${rows.length}`);
  let same = 0;
  rows.forEach((row, i) => {
    if (row === expected[i]) same++;
    else console.log(`  was  ${expected[i]}\n  now  ${row}`);
  });
  console.log(`${same} of ${rows.length} programs draw as the baseline does`);
  check(same === rows.length, 'every program draws what the baseline recorded (look with --png, then --update)');
}

/**
 * See-Thru-Walls (`d.SeeThruWalls`, `doc/CSBwin-src/Viewport.cpp:2639`). Every program runs
 * with it set and reaches no unimplemented opcode. Then F1 Stone, the one wall it opens
 * (`StdDrawF1Stone`, `Viewport.cpp:1048-1087`), is drawn over a patterned viewport, the
 * pattern standing for what the cells behind it drew. Inside `SeeThruWallsRect2`, the hole
 * mask (graphic 41) decides each pixel: colour 10 shows the pattern (but for the pattern's
 * own colour 9), colour 9 the wall as it is drawn without the spell, and any other colour is
 * the mask's own. Outside, nothing
 * changes. F0 DoorEdge, whose frame is drawn by `StdDrawSeeThruDoorEdge` under the spell,
 * still draws one.
 */
function seeThruWalls(renderer: ViewportRenderer, start: Position, facing: number, doorIndex: number, warnings: string[]): void {
  renderer.selectLevel(start.z);
  renderer.draw(start, facing, true, false);
  const ctx = renderer.context;
  for (let cell = 0; cell < 21; cell++) {
    for (let type = 0; type < 8; type++) {
      const program = getBytecodeProgram(cell, type);
      if (!program) continue;
      const before = warnings.length;
      renderer.buffer.pixels.fill(UNDRAWN);
      ctx.roomData = roomDataFor(start, facing, cell, type as GraphicRoomType, doorIndex);
      new BytecodeInterpreter(ctx).interpret(program, cell);
      check(warnings.length === before, `see-thru ${cellNames[cell]}_${roomTypeNames[type]} runs without a warning: ${warnings.slice(before).join('; ')}`);
    }
  }

  const f1 = cellNames.indexOf('F1');
  const pattern = Uint8Array.from({ length: 224 * 136 }, (_, i) => (i % 224 + Math.floor(i / 224)) % 16);
  const drawF1Stone = (seeThru: boolean): Uint8Array => {
    ctx.seeThroughWalls = seeThru;
    renderer.buffer.pixels.set(pattern);
    ctx.roomData = roomDataFor(start, facing, f1, GraphicRoomType.STONE, doorIndex);
    new BytecodeInterpreter(ctx).interpret(getBytecodeProgram(f1, GraphicRoomType.STONE)!, f1);
    return Uint8Array.from(renderer.buffer.pixels);
  };
  const wall = drawF1Stone(false);
  const seen = drawF1Stone(true);
  const hole = ctx.getGraphicBitmap?.(41);
  const r = ctx.seeThruWallsRect2;
  check(hole?.width === 96 && hole.height === 95, `graphic 41, the hole in the wall, is 96x95 (${hole?.width}x${hole?.height})`);
  check(r?.x1 === 64 && r.x2 === 159 && r.y1 === 19 && r.y2 === 113, `SeeThruWallsRect2 is (64..159, 19..113): ${JSON.stringify(r)}`);
  if (!hole || !r) return;
  let wrong = 0, holes = 0, rim = 0;
  for (let y = 0; y < 136; y++) {
    for (let x = 0; x < 224; x++) {
      const i = y * 224 + x;
      let expected = wall[i];
      if (x >= r.x1 && x <= r.x2 && y >= r.y1 && y <= r.y2) {
        const h = hole.pixels[(y - r.y1) * 96 + (x - r.x1)];
        // What is behind in colour 9 is lost: the last blit's transparent colour is 9.
        if (h === 10) { if (pattern[i] !== 9) expected = pattern[i]; holes++; }
        else if (h !== 9) { expected = h; rim++; }
      }
      if (seen[i] !== expected) wrong++;
    }
  }
  console.log(`see-thru F1 Stone: ${holes} pixels through the hole, ${rim} of its rim`);
  check(holes > 0 && holes < 96 * 95, 'the hole shows what is behind the F1 wall');
  check(wall.some((p, i) => p !== pattern[i]), 'without the spell the F1 wall covers what is behind it');
  check(wrong === 0, `under See-Thru-Walls every F1 Stone pixel is the wall, the hole's or what is behind (${wrong} wrong)`);

  const f0 = cellNames.indexOf('F0');
  renderer.buffer.pixels.fill(UNDRAWN);
  ctx.roomData = roomDataFor(start, facing, f0, GraphicRoomType.DOOR_EDGE, doorIndex);
  new BytecodeInterpreter(ctx).interpret(getBytecodeProgram(f0, GraphicRoomType.DOOR_EDGE)!, f0);
  const edge = renderer.buffer.pixels.filter((p) => p !== UNDRAWN).length;
  check(edge > 0, `under See-Thru-Walls F0 DoorEdge still draws its frame (${edge} pixels)`);
  ctx.seeThroughWalls = false;
}

/** The index of the first door on level `z`, scanning x then y. */
function firstDoorIndex(dungeon: ReturnType<typeof newGame>['ctx']['dungeon'], z: number): number {
  const map = dungeon.getMap(z);
  if (!map) throw new Error(`no level ${z}`);
  for (let x = 0; x < map.descriptor.width; x++) {
    for (let y = 0; y < map.descriptor.height; y++) {
      if (map.cellFlags[x][y] >> 5 !== RoomType.DOOR) continue;
      const rn = dungeon.findFirstDoor(new Position(x, y, z));
      if (rn !== OBJECT_ID_EOF) return decodeObjectID(rn).index;
    }
  }
  throw new Error(`no door on level ${z}`);
}

/** Every cell open and empty, and `target` given the fixed summary for `type`. */
function roomDataFor(position: Position, facing: number, target: number, type: GraphicRoomType, doorIndex: number): SummarizeRoomData[] {
  return Array.from({ length: 21 }, (_, cell): SummarizeRoomData => {
    const { x, y } = RelativeXY(facing, relativeY[cell], relativeX[cell], position.x, position.y);
    const graphicRoomType = cell === target ? type : GraphicRoomType.OPEN;
    const decorations: [number, number, number] = [0, 0, 0];
    if (cell === target) {
      if (type === GraphicRoomType.TELEPORTER) decorations[0] = 1;
      if (type === GraphicRoomType.DOOR_FACING) {
        decorations[0] = 4;
        decorations[1] = doorIndex;
      }
    }
    return {
      x,
      y,
      relativeCellNumber: cell,
      skinNumber: 0,
      roomType: ROOM_TYPE[graphicRoomType],
      championPortraitOrdinal: 0,
      graphicRoomType,
      rn2: OBJECT_ID_EOF,
      decorations,
      text: [OBJECT_ID_EOF, OBJECT_ID_EOF, OBJECT_ID_EOF],
    };
  });
}

/** The tiles as one sheet, eight to a row with a two-pixel gutter, over the 16-colour `palette`. */
function writeSheet(path: string, tiles: Uint8Array[], palette: number[]): void {
  const w = 224, h = 136, gap = 2, cols = 8, rowsCount = Math.ceil(tiles.length / cols);
  const width = cols * (w + gap) - gap, height = rowsCount * (h + gap) - gap;
  const sheet = new Uint8Array(width * height).fill(GUTTER);
  tiles.forEach((tile, i) => {
    const ox = (i % cols) * (w + gap), oy = Math.floor(i / cols) * (h + gap);
    for (let y = 0; y < h; y++) sheet.set(tile.subarray(y * w, (y + 1) * w), (oy + y) * width + ox);
  });
  const rgb = palette.slice(0, 16).map((c) => { const { r, g, b } = atariToRGB(c); return [r, g, b]; });
  rgb.push([0, 32, 96], [255, 0, 255]);
  mkdirSync(OUTPUT, { recursive: true });
  writeIndexedPng(path, width, height, sheet, rgb);
  console.log(`wrote ${path}`);
}

main();
finish();
