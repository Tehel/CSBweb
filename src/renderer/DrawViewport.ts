/**
 * DrawViewport - Main viewport rendering function
 * Mechanical port from CSBWin Viewport.cpp line 6701
 *
 * This function renders the dungeon view by:
 * 1. Calculating cell positions relative to party position/facing
 * 2. Gathering room data for each of the 21 viewport cells
 * 3. Executing bytecode programs to draw each cell
 */

import { BytecodeInterpreter, type InterpreterContext } from './bytecode/BytecodeInterpreter';
import { GraphicRoomType, type SummarizeRoomData } from './bytecode/Types';
import { pStdDrawCode } from './bytecode/BytecodePrograms';
import type { DungeonState } from '../engine/DungeonState';
import { RelativeXY, type DirectionTables } from '../engine/RelativeXY';
import { summarizeRoomInfoCsbwin } from './csbwin/SummarizeRoomInfo';
import { OBJECT_ID_EOF, Position, RoomType } from '../core/types';
import { readU16LE } from '../core/bytes';

/**
 * Relative X coordinates for each cell
 * Port from CSBWin Viewport.cpp lines 361-362
 */
export const relativeX: number[] = [ -2, 2, -2, 2, -1, 1, 0, -1, 1, 0, -2, 2, -1, 1, 0, -1, 1, 0, -1, 1, 0 ];

/**
 * Relative Y coordinates for each cell
 * Port from CSBWin Viewport.cpp lines 363-364
 */
export const relativeY: number[] = [ 4, 4, 3, 3, 4, 4, 4, 3, 3, 3, 2, 2, 2, 2, 2, 1, 1, 1, 0, 0, 0 ];

/**
 * Main DrawViewport function
 * Port from CSBWin Viewport.cpp line 6694
 *
 * @param context - Interpreter context with graphics and canvas
 * @param dungeonState - Dungeon state for querying cell data
 * @param facing - Party facing direction (0=N, 1=E, 2=S, 3=W)
 * @param x - Party X position in dungeon
 * @param y - Party Y position in dungeon
 * @param directions - `d.DeltaX` / `d.DeltaY`, which `RelativeXY` steps through
 */
export function DrawViewport(
  context: InterpreterContext,
  dungeonState: DungeonState,
  position: Position,
  facing: number,
  directions: DirectionTables,
): void {
  // The floor/ceiling background is composed by the caller before this runs, so the cell
  // programs below blit on top of it — see `ViewportRenderer.drawViewportFrame`, which mirrors
  // CSBWin's `FloorAndCeilingOnly()` + conditional `Mirror()`
  // (doc/CSBwin-src/Viewport.cpp:3334, doc/CSBwin-src/Viewport.cpp:6747).

  // Allocate room data for all 21 cells
  const roomData: SummarizeRoomData[] = new Array(21);
  const level = position.z;
  context.viewParty = { x: position.x, y: position.y, z: level, facing };

  // Initialize the bytecode interpreter
  const interpreter = new BytecodeInterpreter(context);

  // First pass: Calculate positions and gather room data for all cells
  for (let cellNum = 0; cellNum < 21; cellNum++) {
    // Calculate absolute position for this cell
    const pos = RelativeXY(directions, facing, relativeY[cellNum]!, relativeX[cellNum]!, position.x, position.y);

    // The cell's skin, else the level's default, on `d.LoadedLevel`, the level drawn
    // (`doc/CSBwin-src/Viewport.cpp:6784-6793`).
    let skinNumber = dungeonState.skinCache.GetSkin(level, pos.x, pos.y);
    if (skinNumber === 0) skinNumber = dungeonState.skinCache.GetDefaultSkin(level);

    // Initialize room data structure
    const room: SummarizeRoomData = {
      x: pos.x,
      y: pos.y,
      relativeCellNumber: cellNum,
      skinNumber,
      roomType: RoomType.STONE, // Will be overwritten by summarizeRoomInfoCsbwin
      championPortraitOrdinal: 0,
      graphicRoomType: GraphicRoomType.STONE,
      rn2: OBJECT_ID_EOF,
      decorations: [0, 0, 0],
      text: [OBJECT_ID_EOF, OBJECT_ID_EOF, OBJECT_ID_EOF],
    };
    roomData[cellNum] = room;

    // Gather room information for this cell
    summarizeRoomInfoCsbwin(room, dungeonState, position, facing, context.objectTables, context.footprints,
      context.gameState?.tickCount);
    if (cellNum === 17) context.picking.cellTypeJustAhead = room.roomType;
  }

  // Store room data in context for opcodes to access
  context.roomData = roomData;

  // Second pass: Execute bytecode programs to draw each cell
  for (let cellNum = 0; cellNum < 21; cellNum++) {
    const { skinNumber, graphicRoomType } = roomData[cellNum]!;
    if (skinNumber !== 0) {
      // A skin's own program, from its cell table; a skin with none draws nothing
      // (`Viewport.cpp:6796-6813`).
      const pCode = context.backgroundLib.GetCode(skinNumber);
      if (pCode !== null) {
        const code = skinCodeWords(pCode);
        const startOffset = skinProgramStart(code, cellNum, graphicRoomType);
        context.graphicTrace?.(`  Draw Cell ${cellNum} skin ${skinNumber}`);
        interpreter.interpret(code, startOffset, cellNum);
      }
      continue;
    }

    // Get the bytecode program for this cell and room type
    const program = getBytecodeProgram(cellNum, graphicRoomType);

    if (program) {
      // Execute the bytecode program to render this cell
      interpreter.interpret(program, 0, cellNum);
    }
  }

  // Wall champion portraits, see-thru walls and custom backgrounds are all handled inside
  // the cell programs: `SummarizeRoomInfo` fills `championPortraitOrdinal`, and the
  // `SeeThroughWalls` opcode reads `context.seeThroughWalls`
  // (doc/CSBwin-src/Viewport.cpp:2645), both set up by `ViewportRenderer.drawViewportFrame`.
}

/**
 * A skin's program section as CSBWin reads it, `ui16` words in its native, little-endian
 * order (`doc/CSBWIN_RENDERING_REFERENCE.md` → "Background library"). Read once a section:
 * `BACKGROUND_LIB` keeps the section's bytes as long as the game.
 */
const skinCodes = new WeakMap<Uint8Array, Uint16Array>();
function skinCodeWords(section: Uint8Array): Uint16Array {
  let words = skinCodes.get(section);
  if (!words) {
    words = new Uint16Array(section.length >> 1);
    for (let i = 0; i < words.length; i++) words[i] = readU16LE(section, 2 * i);
    skinCodes.set(section, words);
  }
  return words;
}

/**
 * Where a skin's program draws a cell of a graphic room type: `mainOffset = pCode[0]`, then
 * `pCode[mainOffset + 8 * cell + graphicRoomType]` (`doc/CSBwin-src/Viewport.cpp:6803-6804`).
 */
export function skinProgramStart(code: ArrayLike<number>, cellNum: number, graphicRoomType: number): number {
  const mainOffset = code[0]!;
  return code[mainOffset + 8 * cellNum + graphicRoomType]!;
}

/**
 * The 21 cells' names in CSBWin's programs (`StdDrawF1L1Stone`…), by relative cell number:
 * F and the cell's `relativeY`, then L or R and the size of its `relativeX`.
 */
export const cellNames = [
  'F4L2',
  'F4R2',
  'F3L2',
  'F3R2',
  'F4L1',
  'F4R1',
  'F4',
  'F3L1',
  'F3R1',
  'F3',
  'F2L2',
  'F2R2',
  'F2L1',
  'F2R1',
  'F2',
  'F1L1',
  'F1R1',
  'F1',
  'F0L1',
  'F0R1',
  'F0',
];

/** The programs' name for each `GraphicRoomType`, `pStdDrawCode`'s second index. */
export const roomTypeNames = [
  'Stone',
  'Open',
  'Pit',
  'Teleporter',
  'DoorEdge',
  'DoorFacing',
  'StairEdge',
  'StairFacing',
];

/** CSBWin's `pStdDrawCode[cellNum][graphicRoomType]` (`Viewport.cpp:6816`); `null` is a `NOP` slot. */
export function getBytecodeProgram(cellNum: number, graphicRoomType: GraphicRoomType): readonly number[] | null {
  return pStdDrawCode[cellNum]?.[graphicRoomType] ?? null;
}
