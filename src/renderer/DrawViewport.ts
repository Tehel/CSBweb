/**
 * DrawViewport - Main viewport rendering function
 * Mechanical port from CSBWin Viewport.cpp line 6694
 *
 * This function renders the 3D first-person view by:
 * 1. Calculating cell positions relative to party position/facing
 * 2. Gathering room data for each of the 21 viewport cells
 * 3. Executing bytecode programs to draw each cell
 */

import { BytecodeInterpreter, InterpreterContext } from './bytecode/BytecodeInterpreter';
import { GraphicRoomType, RoomType, SummarizeRoomData } from './bytecode/Types';
import { BytecodePrograms } from './bytecode/BytecodePrograms';
import type { DungeonState } from '../engine/DungeonState';
import { summarizeRoomInfoCsbwin } from './csbwin/SummarizeRoomInfo';
import { Position } from '@/core';

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
 * Calculate absolute x,y position from relative coordinates
 * Port from CSBWin Viewport.cpp (find in source)
 */
export function RelativeXY(
  facing: number,
  relY: number,
  relX: number,
  x: number,
  y: number
): { x: number; y: number } {
  // Port of CSBWin RelativeXY function
  // Transforms relative cell coordinates based on party facing
  let newX = x;
  let newY = y;

  switch (facing) {
    case 0: // North
      newX = x + relX;
      newY = y - relY;
      break;
    case 1: // East
      newX = x + relY;
      newY = y + relX;
      break;
    case 2: // South
      newX = x - relX;
      newY = y + relY;
      break;
    case 3: // West
      newX = x - relY;
      newY = y - relX;
      break;
  }

  return { x: newX, y: newY };
}

/**
 * Main DrawViewport function
 * Port from CSBWin Viewport.cpp line 6694
 *
 * @param context - Interpreter context with graphics and canvas
 * @param dungeonState - Dungeon state for querying cell data
 * @param facing - Party facing direction (0=N, 1=E, 2=S, 3=W)
 * @param x - Party X position in dungeon
 * @param y - Party Y position in dungeon
 */
export function DrawViewport(
  context: InterpreterContext,
  dungeonState: DungeonState,
  position: Position,
  facing: number,
): void {
  // The floor/ceiling background is composed by the caller before this runs, so the cell
  // programs below blit on top of it — see `ViewportRenderer.drawViewportFrame`, which mirrors
  // CSBWin's `FloorAndCeilingOnly()` + conditional `Mirror()`
  // (doc/CSBwin-src/Viewport.cpp:3327, doc/CSBwin-src/Viewport.cpp:6740).

  // Allocate room data for all 21 cells
  const roomData: SummarizeRoomData[] = new Array(21);

  // Initialize the bytecode interpreter
  const interpreter = new BytecodeInterpreter(context);

  // First pass: Calculate positions and gather room data for all cells
  for (let cellNum = 0; cellNum < 21; cellNum++) {
    // Calculate absolute position for this cell
    const pos = RelativeXY(facing, relativeY[cellNum], relativeX[cellNum], position.x, position.y);

    // Initialize room data structure
    roomData[cellNum] = {
      x: pos.x,
      y: pos.y,
      relativeCellNumber: cellNum,
      skinNumber: 0, // Default skin for prototype
      roomType: RoomType.STONE, // Will be overwritten by summarizeRoomInfoCsbwin
      championPortraitOrdinal: 0,
      graphicRoomType: GraphicRoomType.STONE,
      rn2: 0xfffe,
      decorations: [0, 0, 0],
      text: [0xfffe, 0xfffe, 0xfffe],
    };

    // Gather room information for this cell
    summarizeRoomInfoCsbwin(roomData[cellNum], dungeonState, position, facing, context.objectTables, context.footprints);
  }

  // Store room data in context for opcodes to access
  context.roomData = roomData;

  // Second pass: Execute bytecode programs to draw each cell
  for (let cellNum = 0; cellNum < 21; cellNum++) {
    // Get the bytecode program for this cell and room type
    const program = getBytecodeProgram(cellNum, roomData[cellNum].graphicRoomType);

    if (program) {
      // Execute the bytecode program to render this cell
      interpreter.interpret(program, cellNum);
    }
  }

  // Wall champion portraits, see-thru walls and custom backgrounds are all handled inside
  // the cell programs: `SummarizeRoomInfo` fills `championPortraitOrdinal`, and the
  // `SeeThroughWalls` opcode reads `context.seeThroughWalls`
  // (doc/CSBwin-src/Viewport.cpp:2638), both set up by `ViewportRenderer.drawViewportFrame`.
}

/** The 21 cells' names in the program table, by relative cell number. */
export const cellNames = [
  'F4L2',
  'F4R2',
  'F3L2',
  'F3R2', // place switched with F3R2 ?
  'F4L1',
  'F4R1',
  'F4',
  'F3L1',
  'F3R1',
  'F3',
  'F2L2', // place switched with F2L2 ?
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

/** The program table's name for each `GraphicRoomType`. */
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

/**
 * Get the bytecode program for a given cell and room type
 * Port from CSBWin's pStdDrawCode lookup
 */
export function getBytecodeProgram(cellNum: number, graphicRoomType: number): number[] | null {
  // Map cell number and room type to bytecode program key
  // Cell names: F0, F0L1, F0R1, F1, F1L1, F1R1, etc.
  // Room types: Stone, Open, Pit, Teleporter, StairFacing, StairEdge, DoorFacing, DoorEdge

  const cellName = cellNames[cellNum];
  const roomTypeName = roomTypeNames[graphicRoomType] || 'Stone';

  // Look up program in BytecodePrograms table
  const key = `${cellName}_${roomTypeName}`;
  const program = BytecodePrograms[key];

  if (!program) {
    // Fall back to generic program if available
    const fallbackKey = `${cellName}_Any`;
    return BytecodePrograms[fallbackKey] || null;
  }

  return program;
}
