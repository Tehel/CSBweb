/**
 * A drawing's context for a tool that draws without a `ViewportRenderer`: `members`, and for
 * everything else what a drawing reads as nothing there. No bitmap, rectangle, ornament or
 * floor decoration, no graphic (`getGraphicBitmap` answers `null`), an empty cache, an empty
 * background library and monster cache, nothing summarised, a new picking, a new drawing
 * state, and a viewport of colour 0. The tables and the dungeon are stand-ins holding
 * nothing, so a drawing that reaches one the tool did not give throws rather than draw
 * nothing. A trace prints.
 */

import type { InterpreterContext } from '../../src/renderer/bytecode/BytecodeInterpreter';
import { emptyViewportPicking } from '../../src/renderer/bytecode/Types';
import { ViewportDrawState } from '../../src/renderer/bytecode/ViewportDrawState';
import { createPaletteIndexViewportBuffer } from '../../src/renderer/csbwin/CanvasBlitter';
import { AltMonCache } from '../../src/data/AltMonGraphics';
import { BackgroundLib } from '../../src/data/BackgroundLib';
import type { DungeonState } from '../../src/engine/DungeonState';
import type { ObjectTables } from '../../src/data/tables/ObjectTables';
import type { RectPos } from '../../src/data/tables/UITables';
import { standInOf } from './standIn';

const noRect = (): RectPos => ({ x1: 0, y1: 0, x2: 0, y2: 0 });

export function viewportContextOf(members: Partial<InterpreterContext>): InterpreterContext {
  return {
    wallBitmaps: [],
    doorBitmaps: [],
    wallRectangles: [],
    floorPitRectangles: [],
    ceilingPitRectangles: [],
    teleporterRectangles: [],
    stairEdgeRectangles: [],
    stairFacingDownRectangles: [],
    stairFacingUpRectangles: [],
    doorTrackTopRectangles: [],
    doorFrameRectangles: [],
    doorRects: { F1R1: [], F1: [], F1L1: [], F2R1: [], F2: [], F2L1: [], F3R1: [], F3: [], F3L1: [] },
    seeThruWallsRect: noRect(),
    seeThruWallsRect2: noRect(),
    seeThruWallsRectUByte4: 0,
    seeThruWallsRectUByte6: 0,
    seeThruDoorEdgeRect: noRect(),
    championPortraitRect: noRect(),
    word1868: false,
    wallGraphicSet: 0,
    backgroundGraphicSet: 0,
    getGraphicBitmap: () => null,
    graphicCache: new Map(),
    objectTables: standInOf<ObjectTables>({}),
    altMonCache: new AltMonCache(),
    backgroundLib: new BackgroundLib(undefined),
    dungeonState: standInOf<DungeonState>({}),
    viewParty: { x: 0, y: 0, z: 0, facing: 0 },
    trace: (line) => console.log(line),
    frameFacing: 0,
    frameMapIndex: 0,
    doorGraphics: [],
    doorTOC: [],
    doorOrnaments: [],
    loadedFloorDecorations: [],
    // The colour maps of the tables given, as `graphics.dat` holds them, before any level's.
    monsterColorMapMedium: members.objectTables?.monsterColorMapMedium?.slice() ?? new Uint8Array(16),
    monsterColorMapFar: members.objectTables?.monsterColorMapFar?.slice() ?? new Uint8Array(16),
    numWallDecoration: 0,
    useMirrorImages: false,
    viewportIndexBuffer: createPaletteIndexViewportBuffer(224, 136, 0),
    seeThroughWalls: false,
    roomData: [],
    picking: emptyViewportPicking(),
    drawState: new ViewportDrawState(),
    // A member given as `undefined` is one the tool does not have.
    ...Object.fromEntries(Object.entries(members).filter(([, value]) => value !== undefined)),
  };
}
