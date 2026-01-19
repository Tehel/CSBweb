# CSBWin Viewport Rendering - Complete Reference

This document contains ALL data extracted from CSBWin source code needed for a mechanical port to TypeScript.

**Source**: CSBWin C++ source code in doc/CSBwin-src/
**Generated**: 2026-01-05T17:35:54.092Z
**Purpose**: Reference for literal line-by-line port

---

## 1. Cell System

### Cell Number Definitions

```typescript
const RF4L2 = 0;
const RF4R2 = 1;
const RF3L2 = 2;
const RF2L2 = 3;
const RF4L1 = 4;
const RF4R1 = 5;
const RF4 = 6;
const RF3L1 = 7;
const RF3R1 = 8;
const RF3 = 9;
const RF3R2 = 10;
const RF2R2 = 11;
const RF2L1 = 12;
const RF2R1 = 13;
const RF2 = 14;
const RF1L1 = 15;
const RF1R1 = 16;
const RF1 = 17;
const RF0L1 = 18;
const RF0R1 = 19;
const RF0 = 20;
```

### Relative Position Arrays

```typescript
const relativeX: number[] = [-2, 2, -2, 2, -1, 1, 0, -1, 1, 0, -2, 2, -1, 1, 0, -1, 1, 0, -1, 1, 0];

const relativeY: number[] = [4, 4, 3, 3, 4, 4, 4, 3, 3, 3, 2, 2, 2, 2, 2, 1, 1, 1, 0, 0, 0];
```

## 2. Opcode Definitions

All opcodes from Viewport.cpp lines 370-700:

```typescript
enum Opcode {
  Return = 60000,
  StdBltShape = 60001,
  StdDrawWallText = 60002,
  StdDrawWallDecoration = 60003,
  StdDrawFloorDecoration = 60004,
  StdDrawCeilingPit = 60005,
  StdDrawRoomObjects = 60006,
  wallDecorationLeft = 60007,
  wallDecorationFront = 60008,
  wallDecorationRight = 60009,
  StdBltShapeToViewport = 60010,
  DoorSwitch = 60011,
  StdDrawDoorSwitch = 60012,
  SeeThroughWalls = 60013,
  StdDrawSeeThruDoorEdge = 60014,
  GetDecoration0 = 60015,
  Literal = 60016,
  StdMirrorShapeToViewport = 60017,
  StdMirrorGraphicToViewport = 60018,
  StdGraphicToViewport = 60019,
  StdDrawTeleporter = 60020,
  StdStairFacingUpRectangleF3L1 = 60021,
  StdStairFacingUpRectangleF3 = 60022,
  StdStairFacingUpRectangleF3R1 = 60023,
  StdStairFacingUpRectangleF2L1 = 60024,
  StdStairFacingUpRectangleF2 = 60025,
  StdStairFacingUpRectangleF2R1 = 60026,
  StdStairFacingUpRectangleF1L1 = 60027,
  StdStairFacingUpRectangleF1 = 60028,
  StdStairFacingUpRectangleF1R1 = 60029,
  StdStairFacingUpRectangleF0L = 60030,
  StdStairFacingUpRectangleF0R = 60031,
  StdStairFacingDownRectangleF3L1 = 60032,
  StdStairFacingDownRectangleF3 = 60033,
  StdStairFacingDownRectangleF3R1 = 60034,
  StdStairFacingDownRectangleF2L1 = 60035,
  StdStairFacingDownRectangleF2 = 60036,
  StdStairFacingDownRectangleF2R1 = 60037,
  StdStairFacingDownRectangleF1L1 = 60038,
  StdStairFacingDownRectangleF1 = 60039,
  StdStairFacingDownRectangleF1R1 = 60040,
  StdStairFacingDownRectangleF0L = 60041,
  StdStairFacingDownRectangleF0R = 60042,
  FloorDecorationGraphicOrdinalF4L1 = 60043,
  FloorDecorationGraphicOrdinalF4 = 60044,
  FloorDecorationGraphicOrdinalF4R1 = 60045,
  FloorDecorationGraphicOrdinalF3L1 = 60046,
  FloorDecorationGraphicOrdinalF3 = 60047,
  FloorDecorationGraphicOrdinalF3R1 = 60048,
  FloorDecorationGraphicOrdinalF2L1 = 60049,
  FloorDecorationGraphicOrdinalF2 = 60050,
  FloorDecorationGraphicOrdinalF2R1 = 60051,
  FloorDecorationGraphicOrdinalF1L1 = 60052,
  FloorDecorationGraphicOrdinalF1 = 60053,
  FloorDecorationGraphicOrdinalF1R1 = 60054,
  FloorDecorationGraphicOrdinalF0L1 = 60055,
  FloorDecorationGraphicOrdinalF0 = 60056,
  FloorDecorationGraphicOrdinalF0R1 = 60057,
  StdFloorPitRectangleF3L1 = 60058,
  StdFloorPitRectangleF3 = 60059,
  StdFloorPitRectangleF3R1 = 60060,
  StdFloorPitRectangleF2L1 = 60061,
  StdFloorPitRectangleF2 = 60062,
  StdFloorPitRectangleF2R1 = 60063,
  StdFloorPitRectangleF1L1 = 60064,
  StdFloorPitRectangleF1 = 60065,
  StdFloorPitRectangleF1R1 = 60066,
  StdFloorPitRectangleF0L1 = 60067,
  StdFloorPitRectangleF0 = 60068,
  StdFloorPitRectangleF0R1 = 60069,
  StdTeleporterRectangleF3L1 = 60070,
  StdTeleporterRectangleF3 = 60071,
  StdTeleporterRectangleF3R1 = 60072,
  StdTeleporterRectangleF2L1 = 60073,
  StdTeleporterRectangleF2 = 60074,
  StdTeleporterRectangleF2R1 = 60075,
  StdTeleporterRectangleF1L1 = 60076,
  StdTeleporterRectangleF1 = 60077,
  StdTeleporterRectangleF1R1 = 60078,
  StdTeleporterRectangleF0L1 = 60079,
  StdTeleporterRectangleF0 = 60080,
  StdTeleporterRectangleF0R1 = 60081,
  StdWallRectangleF3L2 = 60082,
  StdWallRectangleF3L1 = 60083,
  StdWallRectangleF3 = 60084,
  StdWallRectangleF3R1 = 60085,
  StdWallRectangleF3R2 = 60086,
  StdWallRectangleF2L1 = 60087,
  StdWallRectangleF2 = 60088,
  StdWallRectangleF2R1 = 60089,
  StdWallRectangleF1L1 = 60090,
  StdWallRectangleF1 = 60091,
  StdWallRectangleF1R1 = 60092,
  StdWallRectangleF0L1 = 60093,
  StdWallRectangleF0 = 60094,
  StdWallRectangleF0R1 = 60095,
  StdDrawDoor = 60096,
  F4L1xy = 60097,
  F4xy = 60098,
  F4R1xy = 60099,
  F3L2xy = 60100,
  F3L1xy = 60101,
  F3xy = 60102,
  F3R1xy = 60103,
  F3R2xy = 60104,
  F2L1xy = 60105,
  F2xy = 60106,
  F2R1xy = 60107,
  F1L1xy = 60108,
  F1xy = 60109,
  F1R1xy = 60110,
  F0L1xy = 60111,
  F0xy = 60112,
  F0R1xy = 60113,
  F4L1Contents = 60114,
  F4Contents = 60115,
  F4R1Contents = 60116,
  F3L2Contents = 60117,
  F3L1Contents = 60118,
  F3Contents = 60119,
  F3R1Contents = 60120,
  F3R2Contents = 60121,
  F2L1Contents = 60122,
  F2Contents = 60123,
  F2R1Contents = 60124,
  F1L1Contents = 60125,
  F1Contents = 60126,
  F1R1Contents = 60127,
  F0L1Contents = 60128,
  F0Contents = 60129,
  F0R1Contents = 60130,
  F4L1 = 60131,
  F4 = 60132,
  F4R1 = 60133,
  F3L2 = 60134,
  F3L1 = 60135,
  F3 = 60136,
  F3R1 = 60137,
  F3R2 = 60138,
  F2L1 = 60139,
  F2 = 60140,
  F2R1 = 60141,
  F1L1 = 60142,
  F1 = 60143,
  F1R1 = 60144,
  F0L1 = 60145,
  F0 = 60146,
  F0R1 = 60147,
  StdStairFacingDownGraphicF3L1 = 60148,
  StdStairFacingDownGraphicF3 = 60149,
  StdStairFacingDownGraphicF3R1 = 60150,
  StdStairFacingDownGraphicF2L1 = 60151,
  StdStairFacingDownGraphicF2 = 60152,
  StdStairFacingDownGraphicF2R1 = 60153,
  StdStairFacingDownGraphicF1L1 = 60154,
  StdStairFacingDownGraphicF1 = 60155,
  StdStairFacingDownGraphicF1R1 = 60156,
  StdStairFacingDownGraphicF0 = 60157,
  StdStairFacingUpGraphicF3L1 = 60158,
  StdStairFacingUpGraphicF3 = 60159,
  StdStairFacingUpGraphicF3R1 = 60160,
  StdStairFacingUpGraphicF2L1 = 60161,
  StdStairFacingUpGraphicF2 = 60162,
  StdStairFacingUpGraphicF2R1 = 60163,
  StdStairFacingUpGraphicF1L1 = 60164,
  StdStairFacingUpGraphicF1 = 60165,
  StdStairFacingUpGraphicF1R1 = 60166,
  StdStairFacingUpGraphicF0 = 60167,
  WallF3L1Front = 60168,
  WallF3L1Right = 60169,
  WallF3Front = 60170,
  WallF3R1Left = 60171,
  WallF3R1Front = 60172,
  WallF2L1Front = 60173,
  WallF2L1Right = 60174,
  WallF2Front = 60175,
  WallF2R1Left = 60176,
  WallF2R1Front = 60177,
  WallF1L1Right = 60178,
  WallF1Front = 60179,
  WallF1R1Left = 60180,
  StdStairEdgeGraphicF2 = 60181,
  StdStairEdgeGraphicUpF1 = 60182,
  StdStairEdgeGraphicDownF1 = 60183,
  StdStairEdgeGraphicF0L1 = 60184,
  StdStairEdgeGraphicF0R1 = 60185,
  StdStairEdgeRectF2L1 = 60186,
  StdStairEdgeRectF2R1 = 60187,
  StdStairEdgeUpRectF1L1 = 60188,
  StdStairEdgeUpRectF1R1 = 60189,
  StdStairEdgeDownRectF1L1 = 60190,
  StdStairEdgeDownRectF1R1 = 60191,
  StdStairEdgeRectF0L1 = 60192,
  StdStairEdgeRectF0R1 = 60193,
  StdDoorEdgeFrameBitmapF0 = 60194,
  StdDoorFacingFrameLeftBitmapF2 = 60195,
  StdDoorFacingFrameLeftBitmapF1 = 60196,
  StdDoorFacingFrameRightBitmapF1 = 60197,
  StdDoorFacingFrameLeftBitmapF3 = 60198,
  StdDoorFacingFrameLeftBitmapF3R1 = 60199,
  StdDoorFacingFrameLeftBitmapF3L1 = 60200,
  StdDoorFacingTopTrackBitmapF1 = 60201,
  StdDoorFacingTopTrackBitmapF2 = 60202,
  F3L1DoorRecordIndex = 60203,
  F3DoorRecordIndex = 60204,
  F3R1DoorRecordIndex = 60205,
  F2L1DoorRecordIndex = 60206,
  F2DoorRecordIndex = 60207,
  F2R1DoorRecordIndex = 60208,
  F1L1DoorRecordIndex = 60209,
  F1DoorRecordIndex = 60210,
  F1R1DoorRecordIndex = 60211,
  F0DoorRecordIndex = 60212,
  F3L1DoorState = 60213,
  F3DoorState = 60214,
  F3R1DoorState = 60215,
  F2L1DoorState = 60216,
  F2DoorState = 60217,
  F2R1DoorState = 60218,
  F1L1DoorState = 60219,
  F1DoorState = 60220,
  F1R1DoorState = 60221,
  F0DoorState = 60222,
  StdDoorGraphicsF3 = 60223,
  StdDoorGraphicsF2 = 60224,
  StdDoorGraphicsF1 = 60225,
  StdDoorRectsF3L1 = 60226,
  StdDoorRectsF3 = 60227,
  StdDoorRectsF3R1 = 60228,
  StdDoorRectsF2L1 = 60229,
  StdDoorRectsF2 = 60230,
  StdDoorRectsF2R1 = 60231,
  StdDoorRectsF1L1 = 60232,
  StdDoorRectsF1 = 60233,
  StdDoorRectsF1R1 = 60234,
  StdDoorRectsF0 = 60235,
  Alcove = 60236,
  HasDecoration = 60237,
  LeaveMortarJoint = 60238,
  StdDoorEdgeFrameRectF0 = 60239,
  StdDoorFacingTopTrackRectF2L1 = 60240,
  StdDoorFacingTopTrackRectF2 = 60241,
  StdDoorFacingTopTrackRectF2R1 = 60242,
  StdDoorFacingTopTrackRectF1L1 = 60243,
  StdDoorFacingTopTrackRectF1 = 60244,
  StdDoorFacingTopTrackRectF1R1 = 60245,
  StdDoorFacingTopTrackRectF0 = 60246,
  JumpZ = 60247,
  JumpNZ = 60248,
  Jump = 60249,
  StdDoorFacingFrameRectF3L1 = 60250,
  StdDoorFacingFrameRectF3R1 = 60251,
  StdDoorFacingFrameRightRectF3 = 60252,
  StdDoorFacingFrameLeftRectF3 = 60253,
  StdDoorFacingFrameRightRectF2 = 60254,
  StdDoorFacingFrameLeftRectF2 = 60255,
  StdDoorFacingFrameRightRectF1 = 60256,
  StdDoorFacingFrameLeftRectF1 = 60257,
  StdWallBitmapF3L2 = 60258,
  StdWallBitmapF3L1 = 60259,
  StdWallBitmapF3 = 60260,
  StdWallBitmapF3R1 = 60261,
  StdWallBitmapF3R2 = 60262,
  StdWallBitmapF2L1 = 60263,
  StdWallBitmapF2 = 60264,
  StdWallBitmapF2R1 = 60265,
  StdWallBitmapF1L1 = 60266,
  StdWallBitmapF1 = 60267,
  StdWallBitmapF1R1 = 60268,
  StdWallBitmapF0L1 = 60269,
  StdWallBitmapF0R1 = 60270,
  DrawOrder00 = 60271,
  DrawOrder32 = 60272,
  DrawOrder28 = 60273,
  DrawOrder39 = 60274,
  DrawOrder41 = 60275,
  DrawOrder18 = 60276,
  DrawOrder49 = 60277,
  DrawOrder3421 = 60278,
  DrawOrder218 = 60279,
  DrawOrder349 = 60280,
  DrawOrder4312 = 60281,
  DrawOrder431 = 60282,
  DrawOrder128 = 60283,
  DrawOrder439 = 60284,
  DrawOrder321 = 60285,
  DrawOrder412 = 60286,
  DrawOrder01 = 60287,
  DrawOrder02 = 60288,
  DrawOrder21 = 60289,
  StdAllocateDerivedGraphic = 60290,
  StdBitmapViewport = 60291,
  StdBltToDerivedGraphic = 60292,
  StdSeeThruWallsRect = 60293,
  StdSeeThruWallsRectUByte4 = 60294,
  StdSeeThruWallsRectUByte6 = 60295,
  MinusOne = 60296,
  StdHoleInWallBitmap = 60297,
  Zero = 60298,
  StdDeleteDerivedGraphic = 60299,
  StdBltFromDerivedGraphic = 60300,
  StdSeeThruWallsRect2 = 60301,
  CurrentSkin = 60302,
  WallGraphicID = 60303,
  WallMaskID = 60304,
  CurrentCell = 60305,
  DrawCustomGraphic = 60306,
  DrawCustomDecoration = 60307,
  WallDecorationID = 60308,
  FloorDecorationID = 60309,
  FloorGraphicID = 60310,
  MiddleGraphicID = 60311,
  CeilingGraphicID = 60312,
  FloorMaskID = 60313,
  MiddleMaskID = 60314,
  CeilingMaskID = 60315,
  SkinNumber = 60316,
  CreateVirtualBitmap = 60317,
  SWAP = 60318,
  DROP = 60319,
  OVER = 60320,
  ROT = 60321,
  DUP = 60322,
  QuestionDUP = 60323,
  PICK = 60324,
  ROLL = 60325,
  PLUS = 60326,
  MINUS = 60327,
  GEAR = 60338,
  SLASH = 60339,
  EQUAL = 60340,
  LESS = 60341,
  GREATER = 60342,
  ULESS = 60343,
  ZEROEQUAL = 60344,
  ZEROLESS = 60345,
  ZEROGREATER = 60346,
  NOT = 60347,
  AND = 60348,
  OR = 60349,
  IsOdd = 60350,
  CreateVirtualMask = 60351,
  NeedVirtualMaskQ = 60352,
  TwoDup = 60353,
  GetMaskHeader = 60356,
  ToR = 60357,
  RTo = 60358,
  TwoDrop = 60359,
  BitmapInfo = 60360,
  CreateVirtualAffineMask = 60361,
  LSHIFT = 60362,
  DrawOrder342 = 60363,
  F4L2xy = 60364,
  F4R2xy = 60365,
  F4L2 = 60366,
  F4R2 = 60367,
}
```

## 3. Bytecode Programs

All 168 bytecode programs from Viewport.cpp lines 950-2201:

### F0 Programs

#### StdDrawF0Stone

```typescript
const StdDrawF0Stone: number[] = [
  F0,
  F0xy,
  StdDrawCeilingPit,
  F0Contents,
  F0xy,
  F0,
  DrawOrder21,
  StdDrawRoomObjects,
  Return,
];
```

#### StdDrawF0Open

```typescript
const StdDrawF0Open: number[] = [
  F0,
  F0xy,
  StdDrawCeilingPit,
  F0Contents,
  F0xy,
  F0,
  DrawOrder21,
  StdDrawRoomObjects,
  Return,
];
```

#### StdDrawF0Pit

```typescript
const StdDrawF0Pit: number[] = [
  F0,
  GetDecoration0,
  JumpZ,
    4,
  Literal,
  62,
  Jump,
    2,
  Literal,
  56,
  StdFloorPitRectangleF0,
  StdGraphicToViewport,
  F0,
  F0xy,
  StdDrawCeilingPit,
  F0Contents,
  F0xy,
  F0,
  DrawOrder21,
  StdDrawRoomObjects,
  Return,
];
```

#### StdDrawF0Teleporter

```typescript
const StdDrawF0Teleporter: number[] = [
  F0,
  F0xy,
  StdDrawCeilingPit,
  F0Contents,
  F0xy,
  F0,
  DrawOrder21,
  StdDrawRoomObjects,
  F0,
  GetDecoration0,
  JumpZ,
    3,
  StdTeleporterRectangleF0,
  StdWallRectangleF0,
  StdDrawTeleporter,
  Return,
];
```

#### StdDrawF0StairFacing

```typescript
const StdDrawF0StairFacing: number[] = [
  F0,
  GetDecoration0,
  JumpZ,
    8,
  StdStairFacingUpGraphicF0,
  StdStairFacingUpRectangleF0L,
  StdGraphicToViewport,
  StdStairFacingUpGraphicF0,
  StdStairFacingUpRectangleF0R,
  StdMirrorGraphicToViewport,
  Jump,
    6,
  StdStairFacingDownGraphicF0,
  StdStairFacingDownRectangleF0L,
  StdGraphicToViewport,
  StdStairFacingDownGraphicF0,
  StdStairFacingDownRectangleF0R,
  StdMirrorGraphicToViewport,
  F0,
  F0xy,
  StdDrawCeilingPit,
  F0Contents,
  F0xy,
  F0,
  DrawOrder21,
  StdDrawRoomObjects,
  Return,
];
```

#### StdDrawF0StairEdge

```typescript
const StdDrawF0StairEdge: number[] = [
  F0,
  F0xy,
  StdDrawCeilingPit,
  F0Contents,
  F0xy,
  F0,
  DrawOrder21,
  StdDrawRoomObjects,
  Return,
];
```

#### StdDrawF0DoorEdge

```typescript
const StdDrawF0DoorEdge: number[] = [
  SeeThroughWalls,
  JumpZ,
    3,
  StdDrawSeeThruDoorEdge,
  Jump,
    3,
  StdDoorEdgeFrameBitmapF0,
  StdDoorEdgeFrameRectF0,
  StdBltShapeToViewport,
  F0,
  F0xy,
  StdDrawCeilingPit,
  F0Contents,
  F0xy,
  F0,
  DrawOrder21,
  StdDrawRoomObjects,
  Return,
];
```

#### StdDrawF0DoorFacing

```typescript
const StdDrawF0DoorFacing: number[] = [
  F0,
  F0xy,
  StdDrawCeilingPit,
  F0Contents,
  F0xy,
  F0,
  DrawOrder21,
  StdDrawRoomObjects,
  Return,
];
```

### F0L1 Programs

#### StdDrawF0L1Stone

```typescript
const StdDrawF0L1Stone: number[] = [
  StdWallBitmapF0L1,
  StdWallRectangleF0L1,
  StdBltShape,
  Return,
];
```

#### StdDrawF0L1Open

```typescript
const StdDrawF0L1Open: number[] = [
  F0L1Contents,
  F0L1xy,
  F0L1,
  DrawOrder02,
  StdDrawRoomObjects,
  F0L1,
  F0L1xy,
  StdDrawCeilingPit,
  Return,
];
```

#### StdDrawF0L1Pit

```typescript
const StdDrawF0L1Pit: number[] = [
  F0L1,
  GetDecoration0,
  JumpZ,
    4,
  Literal,
  61,
  Jump,
    2,
  Literal,
  55,
  StdFloorPitRectangleF0L1,
  StdGraphicToViewport,
  F0L1Contents,
  F0L1xy,
  F0L1,
  DrawOrder02,
  StdDrawRoomObjects,
  F0L1,
  F0L1xy,
  StdDrawCeilingPit,
  Return,
];
```

#### StdDrawF0L1Teleporter

```typescript
const StdDrawF0L1Teleporter: number[] = [
  F0L1Contents,
  F0L1xy,
  F0L1,
  DrawOrder02,
  StdDrawRoomObjects,
  F0L1,
  F0L1xy,
  StdDrawCeilingPit,
  F0L1,
  GetDecoration0,
  JumpZ,
    3,
  StdTeleporterRectangleF0L1,
  StdWallRectangleF0L1,
  StdDrawTeleporter,
  Return,
];
```

#### StdDrawF0L1StairFacing

```typescript
const StdDrawF0L1StairFacing: number[] = [
  Return,
];
```

#### StdDrawF0L1StairEdge

```typescript
const StdDrawF0L1StairEdge: number[] = [
  StdStairEdgeGraphicF0L1,
  StdStairEdgeRectF0L1,
  StdGraphicToViewport,
  Return,
];
```

#### StdDrawF0L1DoorEdge

```typescript
const StdDrawF0L1DoorEdge: number[] = [
  F0L1,
  F0L1xy,
  StdDrawCeilingPit,
  F0L1,
  F0L1xy,
  StdDrawCeilingPit,
  Return,
];
```

#### StdDrawF0L1DoorFacing

```typescript
const StdDrawF0L1DoorFacing: number[] = [
  Return,
];
```

### F0R1 Programs

#### StdDrawF0R1Stone

```typescript
const StdDrawF0R1Stone: number[] = [
  StdWallBitmapF0R1,
  StdWallRectangleF0R1,
  StdBltShape,
  Return,
];
```

#### StdDrawF0R1Open

```typescript
const StdDrawF0R1Open: number[] = [
  F0R1,
  F0R1xy,
  StdDrawCeilingPit,
  F0R1Contents,
  F0R1xy,
  F0R1,
  DrawOrder01,
  StdDrawRoomObjects,
  Return,
];
```

#### StdDrawF0R1Pit

```typescript
const StdDrawF0R1Pit: number[] = [
  F0R1,
  GetDecoration0,
  JumpZ,
    4,
  Literal,
  61,
  Jump,
    2,
  Literal,
  55,
  StdFloorPitRectangleF0R1,
  StdMirrorGraphicToViewport,
  F0R1,
  F0R1xy,
  StdDrawCeilingPit,
  F0R1Contents,
  F0R1xy,
  F0R1,
  DrawOrder01,
  StdDrawRoomObjects,
  Return,
];
```

#### StdDrawF0R1Teleporter

```typescript
const StdDrawF0R1Teleporter: number[] = [
  F0R1,
  F0R1xy,
  StdDrawCeilingPit,
  F0R1Contents,
  F0R1xy,
  F0R1,
  DrawOrder01,
  StdDrawRoomObjects,
  F0R1,
  GetDecoration0,
  JumpZ,
    3,
  StdTeleporterRectangleF0R1,
  StdWallRectangleF0R1,
  StdDrawTeleporter,
  Return,
];
```

#### StdDrawF0R1StairFacing

```typescript
const StdDrawF0R1StairFacing: number[] = [
  Return,
];
```

#### StdDrawF0R1StairEdge

```typescript
const StdDrawF0R1StairEdge: number[] = [
  StdStairEdgeGraphicF0R1,
  StdStairEdgeRectF0R1,
  StdMirrorGraphicToViewport,
  Return,
];
```

#### StdDrawF0R1DoorEdge

```typescript
const StdDrawF0R1DoorEdge: number[] = [
  F0R1,
  F0R1xy,
  StdDrawCeilingPit,
  F0R1,
  F0R1xy,
  StdDrawCeilingPit,
  Return,
];
```

#### StdDrawF0R1DoorFacing

```typescript
const StdDrawF0R1DoorFacing: number[] = [
  Return,
];
```

### F1 Programs

#### StdDrawF1Stone

```typescript
const StdDrawF1Stone: number[] = [
  SeeThroughWalls,
  JumpZ,
    28,
  Literal,
  1,
  StdAllocateDerivedGraphic,
  StdBitmapViewport,
  1,
  112,
  48,
  1,
  48,
  48,
  10,
  StdWallBitmapF1,
  StdWallRectangleF1,
  StdBltShape,
  F1,
  wallDecorationFront,
  WallF1Front,
  StdDrawWallDecoration,
  F1,
  wallDecorationFront,
  HasDecoration,
  JumpZ,
    1,
  LeaveMortarJoint,
  F1,
  wallDecorationFront,
  WallF1Front,
  StdDrawWallText,
  Alcove,
  JumpZ,
    5,
  F1Contents,
  F1xy,
  F1,
  DrawOrder00,
  StdDrawRoomObjects,
  SeeThroughWalls,
  JumpZ,
    16,
  Literal,
  1,
  48,
  112,
  9,
  Literal,
  1,
  StdDeleteDerivedGraphic,
  Return,
];
```

#### StdDrawF1Open

```typescript
const StdDrawF1Open: number[] = [
  F1,
  FloorDecorationGraphicOrdinalF1,
  StdDrawFloorDecoration,
  F1,
  F1xy,
  StdDrawCeilingPit,
  F1Contents,
  F1xy,
  F1,
  DrawOrder3421,
  StdDrawRoomObjects,
  Return,
];
```

#### StdDrawF1Pit

```typescript
const StdDrawF1Pit: number[] = [
  F1,
  GetDecoration0,
  JumpZ,
    4,
  Literal,
  60,
  Jump,
    2,
  Literal,
  54,
  StdFloorPitRectangleF1,
  StdGraphicToViewport,
  F1,
  FloorDecorationGraphicOrdinalF1,
  StdDrawFloorDecoration,
  F1,
  F1xy,
  StdDrawCeilingPit,
  F1Contents,
  F1xy,
  F1,
  DrawOrder3421,
  StdDrawRoomObjects,
  Return,
];
```

#### StdDrawF1Teleporter

```typescript
const StdDrawF1Teleporter: number[] = [
  F1,
  FloorDecorationGraphicOrdinalF1,
  StdDrawFloorDecoration,
  F1,
  F1xy,
  StdDrawCeilingPit,
  F1Contents,
  F1xy,
  F1,
  DrawOrder3421,
  StdDrawRoomObjects,
  F1,
  GetDecoration0,
  JumpZ,
    3,
  StdTeleporterRectangleF1,
  StdWallRectangleF1,
  StdDrawTeleporter,
  Return,
];
```

#### StdDrawF1StairFacing

```typescript
const StdDrawF1StairFacing: number[] = [
  F1,
  GetDecoration0,
  JumpZ,
    5,
  StdStairFacingUpGraphicF1,
  StdStairFacingUpRectangleF1,
  StdGraphicToViewport,
  Jump,
    3,
  StdStairFacingDownGraphicF1,
  StdStairFacingDownRectangleF1,
  StdGraphicToViewport,
  F1,
  FloorDecorationGraphicOrdinalF1,
  StdDrawFloorDecoration,
  F1,
  F1xy,
  StdDrawCeilingPit,
  F1Contents,
  F1xy,
  F1,
  DrawOrder3421,
  StdDrawRoomObjects,
  Return,
];
```

#### StdDrawF1StairEdge

```typescript
const StdDrawF1StairEdge: number[] = [
  Return,
];
```

#### StdDrawF1DoorEdge

```typescript
const StdDrawF1DoorEdge: number[] = [
  Return,
];
```

#### StdDrawF1DoorFacing

```typescript
const StdDrawF1DoorFacing: number[] = [
  F1,
  FloorDecorationGraphicOrdinalF1,
  StdDrawFloorDecoration,
  F1Contents,
  F1xy,
  F1,
  DrawOrder218,
  StdDrawRoomObjects,
  StdDoorFacingTopTrackBitmapF1,
  StdDoorFacingTopTrackRectF1,
  StdBltShapeToViewport,
  StdDoorFacingFrameLeftBitmapF1,
  StdDoorFacingFrameLeftRectF1,
  StdBltShapeToViewport,
  StdDoorFacingFrameRightBitmapF1,
  StdDoorFacingFrameRightRectF1,
  StdBltShapeToViewport,
  F1,
  DoorSwitch,
  JumpZ,
    5,
  Literal,
  1,
  Literal,
  3,
  StdDrawDoorSwitch,
  F1DoorRecordIndex,
  F1DoorState,
  StdDoorGraphicsF1,
  StdDoorRectsF1,
  StdDrawDoor,
  F1Contents,
  F1xy,
  F1,
  DrawOrder349,
  StdDrawRoomObjects,
  Return,
];
```

### F1L1 Programs

#### StdDrawF1L1Stone

```typescript
const StdDrawF1L1Stone: number[] = [
  StdWallBitmapF1L1,
  StdWallRectangleF1L1,
  StdBltShape,
  F1L1,
  wallDecorationRight,
  WallF1L1Right,
  StdDrawWallText,
  F1L1,
  wallDecorationRight,
  WallF1L1Right,
  StdDrawWallDecoration,
  Return,
];
```

#### StdDrawF1L1Open

```typescript
const StdDrawF1L1Open: number[] = [
  F1L1,
  FloorDecorationGraphicOrdinalF1L1,
  StdDrawFloorDecoration,
  F1L1,
  F1L1xy,
  StdDrawCeilingPit,
  F1L1Contents,
  F1L1xy,
  F1L1,
  DrawOrder32,
  StdDrawRoomObjects,
  Return,
];
```

#### StdDrawF1L1Pit

```typescript
const StdDrawF1L1Pit: number[] = [
  F1L1,
  GetDecoration0,
  JumpZ,
    4,
  Literal,
  59,
  Jump,
    2,
  Literal,
  53,
  StdFloorPitRectangleF1L1,
  StdGraphicToViewport,
  F1L1,
  FloorDecorationGraphicOrdinalF1L1,
  StdDrawFloorDecoration,
  F1L1,
  F1L1xy,
  StdDrawCeilingPit,
  F1L1Contents,
  F1L1xy,
  F1L1,
  DrawOrder32,
  StdDrawRoomObjects,
  Return,
];
```

#### StdDrawF1L1Teleporter

```typescript
const StdDrawF1L1Teleporter: number[] = [
  F1L1,
  FloorDecorationGraphicOrdinalF1L1,
  StdDrawFloorDecoration,
  F1L1,
  F1L1xy,
  StdDrawCeilingPit,
  F1L1Contents,
  F1L1xy,
  F1L1,
  DrawOrder32,
  StdDrawRoomObjects,
  F1L1,
  GetDecoration0,
  JumpZ,
    3,
  StdTeleporterRectangleF1L1,
  StdWallRectangleF1L1,
  StdDrawTeleporter,
  Return,
];
```

#### StdDrawF1L1StairFacing

```typescript
const StdDrawF1L1StairFacing: number[] = [
  F1L1,
  GetDecoration0,
  JumpZ,
    5,
  StdStairFacingUpGraphicF1L1,
  StdStairFacingUpRectangleF1L1,
  StdGraphicToViewport,
  Jump,
    3,
  StdStairFacingDownGraphicF1L1,
  StdStairFacingDownRectangleF1L1,
  StdGraphicToViewport,
  F1L1,
  FloorDecorationGraphicOrdinalF1L1,
  StdDrawFloorDecoration,
  F1L1,
  F1L1xy,
  StdDrawCeilingPit,
  F1L1Contents,
  F1L1xy,
  F1L1,
  DrawOrder32,
  StdDrawRoomObjects,
  Return,
];
```

#### StdDrawF1L1StairEdge

```typescript
const StdDrawF1L1StairEdge: number[] = [
  F1L1,
  GetDecoration0,
  JumpZ,
    5,
  StdStairEdgeGraphicUpF1,
  StdStairEdgeUpRectF1L1,
  StdGraphicToViewport,
  Jump,
    3,
  StdStairEdgeGraphicDownF1,
  StdStairEdgeDownRectF1L1,
  StdGraphicToViewport,
  F1L1,
  FloorDecorationGraphicOrdinalF1L1,
  StdDrawFloorDecoration,
  F1L1,
  F1L1xy,
  StdDrawCeilingPit,
  F1L1Contents,
  F1L1xy,
  F1L1,
  DrawOrder32,
  StdDrawRoomObjects,
  Return,
];
```

#### StdDrawF1L1DoorEdge

```typescript
const StdDrawF1L1DoorEdge: number[] = [
  F1L1,
  FloorDecorationGraphicOrdinalF1L1,
  StdDrawFloorDecoration,
  F1L1,
  F1L1xy,
  StdDrawCeilingPit,
  F1L1Contents,
  F1L1xy,
  F1L1,
  DrawOrder32,
  StdDrawRoomObjects,
  Return,
];
```

#### StdDrawF1L1DoorFacing

```typescript
const StdDrawF1L1DoorFacing: number[] = [
  F1L1,
  FloorDecorationGraphicOrdinalF1L1,
  StdDrawFloorDecoration,
  F1L1Contents,
  F1L1xy,
  F1L1,
  DrawOrder28,
  StdDrawRoomObjects,
  StdDoorFacingTopTrackBitmapF1,
  StdDoorFacingTopTrackRectF1L1,
  StdBltShapeToViewport,
  F1L1DoorRecordIndex,
  F1L1DoorState,
  StdDoorGraphicsF1,
  StdDoorRectsF1L1,
  StdDrawDoor,
  F1L1Contents,
  F1L1xy,
  F1L1,
  DrawOrder39,
  StdDrawRoomObjects,
  Return,
];
```

### F1R1 Programs

#### StdDrawF1R1Stone

```typescript
const StdDrawF1R1Stone: number[] = [
  StdWallBitmapF1R1,
  StdWallRectangleF1R1,
  StdBltShape,
  F1R1,
  wallDecorationLeft,
  WallF1R1Left,
  StdDrawWallText,
  F1R1,
  wallDecorationLeft,
  WallF1R1Left,
  StdDrawWallDecoration,
  Return,
];
```

#### StdDrawF1R1Open

```typescript
const StdDrawF1R1Open: number[] = [
  F1R1,
  FloorDecorationGraphicOrdinalF1R1,
  StdDrawFloorDecoration,
  F1R1,
  F1R1xy,
  StdDrawCeilingPit,
  F1R1Contents,
  F1R1xy,
  F1R1,
  DrawOrder41,
  StdDrawRoomObjects,
  Return,
];
```

#### StdDrawF1R1Pit

```typescript
const StdDrawF1R1Pit: number[] = [
  F1R1,
  GetDecoration0,
  JumpZ,
    4,
  Literal,
  59,
  Jump,
    2,
  Literal,
  53,
  StdFloorPitRectangleF1R1,
  StdMirrorGraphicToViewport,
  F1R1,
  FloorDecorationGraphicOrdinalF1R1,
  StdDrawFloorDecoration,
  F1R1,
  F1R1xy,
  StdDrawCeilingPit,
  F1R1Contents,
  F1R1xy,
  F1R1,
  DrawOrder41,
  StdDrawRoomObjects,
  Return,
];
```

#### StdDrawF1R1Teleporter

```typescript
const StdDrawF1R1Teleporter: number[] = [
  F1R1,
  FloorDecorationGraphicOrdinalF1R1,
  StdDrawFloorDecoration,
  F1R1,
  F1R1xy,
  StdDrawCeilingPit,
  F1R1Contents,
  F1R1xy,
  F1R1,
  DrawOrder41,
  StdDrawRoomObjects,
  F1R1,
  GetDecoration0,
  JumpZ,
    3,
  StdTeleporterRectangleF1R1,
  StdWallRectangleF1R1,
  StdDrawTeleporter,
  Return,
];
```

#### StdDrawF1R1StairFacing

```typescript
const StdDrawF1R1StairFacing: number[] = [
  F1R1,
  GetDecoration0,
  JumpZ,
    5,
  StdStairFacingUpGraphicF1R1,
  StdStairFacingUpRectangleF1R1,
  StdMirrorGraphicToViewport,
  Jump,
    3,
  StdStairFacingDownGraphicF1R1,
  StdStairFacingDownRectangleF1R1,
  StdMirrorGraphicToViewport,
  F1R1,
  FloorDecorationGraphicOrdinalF1R1,
  StdDrawFloorDecoration,
  F1R1,
  F1R1xy,
  StdDrawCeilingPit,
  F1R1Contents,
  F1R1xy,
  F1R1,
  DrawOrder41,
  StdDrawRoomObjects,
  Return,
];
```

#### StdDrawF1R1StairEdge

```typescript
const StdDrawF1R1StairEdge: number[] = [
  F1R1,
  GetDecoration0,
  JumpZ,
    5,
  StdStairEdgeGraphicUpF1,
  StdStairEdgeUpRectF1R1,
  StdMirrorGraphicToViewport,
  Jump,
    3,
  StdStairEdgeGraphicDownF1,
  StdStairEdgeDownRectF1R1,
  StdMirrorGraphicToViewport,
  F1R1,
  FloorDecorationGraphicOrdinalF1R1,
  StdDrawFloorDecoration,
  F1R1,
  F1R1xy,
  StdDrawCeilingPit,
  F1R1Contents,
  F1R1xy,
  F1R1,
  DrawOrder41,
  StdDrawRoomObjects,
  Return,
];
```

#### StdDrawF1R1DoorEdge

```typescript
const StdDrawF1R1DoorEdge: number[] = [
  F1R1,
  FloorDecorationGraphicOrdinalF1R1,
  StdDrawFloorDecoration,
  F1R1,
  F1R1xy,
  StdDrawCeilingPit,
  F1R1Contents,
  F1R1xy,
  F1R1,
  DrawOrder41,
  StdDrawRoomObjects,
  Return,
];
```

#### StdDrawF1R1DoorFacing

```typescript
const StdDrawF1R1DoorFacing: number[] = [
  F1R1,
  FloorDecorationGraphicOrdinalF1R1,
  StdDrawFloorDecoration,
  F1R1Contents,
  F1R1xy,
  F1R1,
  DrawOrder18,
  StdDrawRoomObjects,
  StdDoorFacingTopTrackBitmapF1,
  StdDoorFacingTopTrackRectF1R1,
  StdBltShapeToViewport,
  F1R1DoorRecordIndex,
  F1R1DoorState,
  StdDoorGraphicsF1,
  StdDoorRectsF1R1,
  StdDrawDoor,
  F1R1Contents,
  F1R1xy,
  F1R1,
  DrawOrder49,
  StdDrawRoomObjects,
  Return,
];
```

### F2 Programs

#### StdDrawF2Stone

```typescript
const StdDrawF2Stone: number[] = [
  StdWallBitmapF2,
  StdWallRectangleF2,
  StdBltShape,
  F2,
  wallDecorationFront,
  WallF2Front,
  StdDrawWallText,
  F2,
  wallDecorationFront,
  WallF2Front,
  StdDrawWallDecoration,
  Alcove,
  JumpZ,
    5,
  F2Contents,
  F2xy,
  F2,
  DrawOrder00,
  StdDrawRoomObjects,
  Return,
];
```

#### StdDrawF2Open

```typescript
const StdDrawF2Open: number[] = [
  F2,
  FloorDecorationGraphicOrdinalF2,
  StdDrawFloorDecoration,
  F2,
  F2xy,
  StdDrawCeilingPit,
  F2Contents,
  F2xy,
  F2,
  DrawOrder3421,
  StdDrawRoomObjects,
  Return,
];
```

#### StdDrawF2Pit

```typescript
const StdDrawF2Pit: number[] = [
  F2,
  GetDecoration0,
  JumpZ,
    4,
  Literal,
  58,
  Jump,
    2,
  Literal,
  52,
  StdFloorPitRectangleF2,
  StdGraphicToViewport,
  F2,
  FloorDecorationGraphicOrdinalF2,
  StdDrawFloorDecoration,
  F2,
  F2xy,
  StdDrawCeilingPit,
  F2Contents,
  F2xy,
  F2,
  DrawOrder3421,
  StdDrawRoomObjects,
  Return,
];
```

#### StdDrawF2Teleporter

```typescript
const StdDrawF2Teleporter: number[] = [
  F2,
  FloorDecorationGraphicOrdinalF2,
  StdDrawFloorDecoration,
  F2,
  F2xy,
  StdDrawCeilingPit,
  F2Contents,
  F2xy,
  F2,
  DrawOrder3421,
  StdDrawRoomObjects,
  F2,
  GetDecoration0,
  JumpZ,
    3,
  StdTeleporterRectangleF2,
  StdWallRectangleF2,
  StdDrawTeleporter,
  Return,
];
```

#### StdDrawF2StairFacing

```typescript
const StdDrawF2StairFacing: number[] = [
  F2,
  GetDecoration0,
  JumpZ,
    5,
  StdStairFacingUpGraphicF2,
  StdStairFacingUpRectangleF2,
  StdGraphicToViewport,
  Jump,
    3,
  StdStairFacingDownGraphicF2,
  StdStairFacingDownRectangleF2,
  StdGraphicToViewport,
  F2,
  FloorDecorationGraphicOrdinalF2,
  StdDrawFloorDecoration,
  F2,
  F2xy,
  StdDrawCeilingPit,
  F2Contents,
  F2xy,
  F2,
  DrawOrder3421,
  StdDrawRoomObjects,
  Return,
];
```

#### StdDrawF2StairEdge

```typescript
const StdDrawF2StairEdge: number[] = [
  Return,
];
```

#### StdDrawF2DoorEdge

```typescript
const StdDrawF2DoorEdge: number[] = [
  Return,
];
```

#### StdDrawF2DoorFacing

```typescript
const StdDrawF2DoorFacing: number[] = [
  F2,
  FloorDecorationGraphicOrdinalF2,
  StdDrawFloorDecoration,
  F2Contents,
  F2xy,
  F2,
  DrawOrder218,
  StdDrawRoomObjects,
  StdDoorFacingTopTrackBitmapF2,
  StdDoorFacingTopTrackRectF2,
  StdBltShapeToViewport,
  StdDoorFacingFrameLeftBitmapF2,
  StdDoorFacingFrameLeftRectF2,
  StdBltShapeToViewport,
  StdDoorFacingFrameLeftBitmapF2,
  StdDoorFacingFrameRightRectF2,
  StdMirrorShapeToViewport,
  F2,
  DoorSwitch,
  JumpZ,
    5,
  Literal,
  1,
  Literal,
  2,
  StdDrawDoorSwitch,
  F2DoorRecordIndex,
  F2DoorState,
  StdDoorGraphicsF2,
  StdDoorRectsF2,
  StdDrawDoor,
  F2Contents,
  F2xy,
  F2,
  DrawOrder349,
  StdDrawRoomObjects,
  Return,
];
```

### F2L1 Programs

#### StdDrawF2L1Stone

```typescript
const StdDrawF2L1Stone: number[] = [
  StdWallBitmapF2L1,
  StdWallRectangleF2L1,
  StdBltShape,
  F2L1,
  wallDecorationRight,
  WallF2L1Right,
  StdDrawWallText,
  F2L1,
  wallDecorationRight,
  WallF2L1Right,
  StdDrawWallDecoration,
  F2L1,
  wallDecorationFront,
  WallF2L1Front,
  StdDrawWallText,
  F2L1,
  wallDecorationFront,
  WallF2L1Front,
  StdDrawWallDecoration,
  Alcove,
  JumpZ,
    5,
  F2L1Contents,
  F2L1xy,
  F2L1,
  DrawOrder00,
  StdDrawRoomObjects,
  Return,
];
```

#### StdDrawF2L1Open

```typescript
const StdDrawF2L1Open: number[] = [
  F2L1,
  FloorDecorationGraphicOrdinalF2L1,
  StdDrawFloorDecoration,
  F2L1,
  F2L1xy,
  StdDrawCeilingPit,
  F2L1Contents,
  F2L1xy,
  F2L1,
  DrawOrder3421,
  StdDrawRoomObjects,
  Return,
];
```

#### StdDrawF2L1Pit

```typescript
const StdDrawF2L1Pit: number[] = [
  F2L1,
  GetDecoration0,
  JumpZ,
    4,
  Literal,
  57,
  Jump,
    2,
  Literal,
  51,
  StdFloorPitRectangleF2L1,
  StdGraphicToViewport,
  F2L1,
  FloorDecorationGraphicOrdinalF2L1,
  StdDrawFloorDecoration,
  F2L1,
  F2L1xy,
  StdDrawCeilingPit,
  F2L1Contents,
  F2L1xy,
  F2L1,
  DrawOrder3421,
  StdDrawRoomObjects,
  Return,
];
```

#### StdDrawF2L1Teleporter

```typescript
const StdDrawF2L1Teleporter: number[] = [
  F2L1,
  FloorDecorationGraphicOrdinalF2L1,
  StdDrawFloorDecoration,
  F2L1,
  F2L1xy,
  StdDrawCeilingPit,
  F2L1Contents,
  F2L1xy,
  F2L1,
  DrawOrder3421,
  StdDrawRoomObjects,
  F2L1,
  GetDecoration0,
  JumpZ,
    3,
  StdTeleporterRectangleF2L1,
  StdWallRectangleF2L1,
  StdDrawTeleporter,
  Return,
];
```

#### StdDrawF2L1StairFacing

```typescript
const StdDrawF2L1StairFacing: number[] = [
  F2L1,
  GetDecoration0,
  JumpZ,
    5,
  StdStairFacingUpGraphicF2L1,
  StdStairFacingUpRectangleF2L1,
  StdGraphicToViewport,
  Jump,
    3,
  StdStairFacingDownGraphicF2L1,
  StdStairFacingDownRectangleF2L1,
  StdGraphicToViewport,
  F2L1,
  FloorDecorationGraphicOrdinalF2L1,
  StdDrawFloorDecoration,
  F2L1,
  F2L1xy,
  StdDrawCeilingPit,
  F2L1Contents,
  F2L1xy,
  F2L1,
  DrawOrder3421,
  StdDrawRoomObjects,
  Return,
];
```

#### StdDrawF2L1StairEdge

```typescript
const StdDrawF2L1StairEdge: number[] = [
  StdStairEdgeGraphicF2,
  StdStairEdgeRectF2L1,
  StdGraphicToViewport,
  F2L1,
  FloorDecorationGraphicOrdinalF2L1,
  StdDrawFloorDecoration,
  F2L1,
  F2L1xy,
  StdDrawCeilingPit,
  F2L1Contents,
  F2L1xy,
  F2L1,
  DrawOrder342,
  StdDrawRoomObjects,
  Return,
];
```

#### StdDrawF2L1DoorEdge

```typescript
const StdDrawF2L1DoorEdge: number[] = [
  F2L1,
  FloorDecorationGraphicOrdinalF2L1,
  StdDrawFloorDecoration,
  F2L1,
  F2L1xy,
  StdDrawCeilingPit,
  F2L1Contents,
  F2L1xy,
  F2L1,
  DrawOrder342,
  StdDrawRoomObjects,
  Return,
];
```

#### StdDrawF2L1DoorFacing

```typescript
const StdDrawF2L1DoorFacing: number[] = [
  F2L1,
  FloorDecorationGraphicOrdinalF2L1,
  StdDrawFloorDecoration,
  F2L1Contents,
  F2L1xy,
  F2L1,
  DrawOrder218,
  StdDrawRoomObjects,
  StdDoorFacingTopTrackBitmapF2,
  StdDoorFacingTopTrackRectF2L1,
  StdBltShapeToViewport,
  F2L1DoorRecordIndex,
  F2L1DoorState,
  StdDoorGraphicsF2,
  StdDoorRectsF2L1,
  StdDrawDoor,
  F2L1,
  F2L1xy,
  StdDrawCeilingPit,
  F2L1Contents,
  F2L1xy,
  F2L1,
  DrawOrder349,
  StdDrawRoomObjects,
  Return,
];
```

### F2R1 Programs

#### StdDrawF2R1Stone

```typescript
const StdDrawF2R1Stone: number[] = [
  StdWallBitmapF2R1,
  StdWallRectangleF2R1,
  StdBltShape,
  F2R1,
  wallDecorationLeft,
  WallF2R1Left,
  StdDrawWallText,
  F2R1,
  wallDecorationLeft,
  WallF2R1Left,
  StdDrawWallDecoration,
  F2R1,
  wallDecorationFront,
  WallF2R1Front,
  StdDrawWallText,
  F2R1,
  wallDecorationFront,
  WallF2R1Front,
  StdDrawWallDecoration,
  Alcove,
  JumpZ,
    5,
  F2R1Contents,
  F2R1xy,
  F2R1,
  DrawOrder00,
  StdDrawRoomObjects,
  Return,
];
```

#### StdDrawF2R1Open

```typescript
const StdDrawF2R1Open: number[] = [
  F2R1,
  FloorDecorationGraphicOrdinalF2R1,
  StdDrawFloorDecoration,
  F2R1,
  F2R1xy,
  StdDrawCeilingPit,
  F2R1Contents,
  F2R1xy,
  F2R1,
  DrawOrder4312,
  StdDrawRoomObjects,
  Return,
];
```

#### StdDrawF2R1Pit

```typescript
const StdDrawF2R1Pit: number[] = [
  F2R1,
  GetDecoration0,
  JumpZ,
    4,
  Literal,
  57,
  Jump,
    2,
  Literal,
  51,
  StdFloorPitRectangleF2R1,
  StdMirrorGraphicToViewport,
  F2R1,
  FloorDecorationGraphicOrdinalF2R1,
  StdDrawFloorDecoration,
  F2R1,
  F2R1xy,
  StdDrawCeilingPit,
  F2R1Contents,
  F2R1xy,
  F2R1,
  DrawOrder4312,
  StdDrawRoomObjects,
  Return,
];
```

#### StdDrawF2R1Teleporter

```typescript
const StdDrawF2R1Teleporter: number[] = [
  F2R1,
  FloorDecorationGraphicOrdinalF2R1,
  StdDrawFloorDecoration,
  F2R1,
  F2R1xy,
  StdDrawCeilingPit,
  F2R1Contents,
  F2R1xy,
  F2R1,
  DrawOrder4312,
  StdDrawRoomObjects,
  F2R1,
  GetDecoration0,
  JumpZ,
    3,
  StdTeleporterRectangleF2R1,
  StdWallRectangleF2R1,
  StdDrawTeleporter,
  Return,
];
```

#### StdDrawF2R1StairFacing

```typescript
const StdDrawF2R1StairFacing: number[] = [
  F2R1,
  GetDecoration0,
  JumpZ,
    5,
  StdStairFacingUpGraphicF2R1,
  StdStairFacingUpRectangleF2R1,
  StdMirrorGraphicToViewport,
  Jump,
    3,
  StdStairFacingDownGraphicF2R1,
  StdStairFacingDownRectangleF2R1,
  StdMirrorGraphicToViewport,
  F2R1,
  FloorDecorationGraphicOrdinalF2R1,
  StdDrawFloorDecoration,
  F2R1,
  F2R1xy,
  StdDrawCeilingPit,
  F2R1Contents,
  F2R1xy,
  F2R1,
  DrawOrder4312,
  StdDrawRoomObjects,
  Return,
];
```

#### StdDrawF2R1StairEdge

```typescript
const StdDrawF2R1StairEdge: number[] = [
  StdStairEdgeGraphicF2,
  StdStairEdgeRectF2R1,
  StdMirrorGraphicToViewport,
  F2R1,
  FloorDecorationGraphicOrdinalF2R1,
  StdDrawFloorDecoration,
  F2R1,
  F2R1xy,
  StdDrawCeilingPit,
  F2R1Contents,
  F2R1xy,
  F2R1,
  DrawOrder431,
  StdDrawRoomObjects,
  Return,
];
```

#### StdDrawF2R1DoorEdge

```typescript
const StdDrawF2R1DoorEdge: number[] = [
  F2R1,
  FloorDecorationGraphicOrdinalF2R1,
  StdDrawFloorDecoration,
  F2R1,
  F2R1xy,
  StdDrawCeilingPit,
  F2R1Contents,
  F2R1xy,
  F2R1,
  DrawOrder431,
  StdDrawRoomObjects,
  Return,
];
```

#### StdDrawF2R1DoorFacing

```typescript
const StdDrawF2R1DoorFacing: number[] = [
  F2R1,
  FloorDecorationGraphicOrdinalF2R1,
  StdDrawFloorDecoration,
  F2R1Contents,
  F2R1xy,
  F2R1,
  DrawOrder128,
  StdDrawRoomObjects,
  StdDoorFacingTopTrackBitmapF2,
  StdDoorFacingTopTrackRectF2R1,
  StdBltShapeToViewport,
  F2R1DoorRecordIndex,
  F2R1DoorState,
  StdDoorGraphicsF2,
  StdDoorRectsF2R1,
  StdDrawDoor,
  F2R1Contents,
  F2R1xy,
  F2R1,
  DrawOrder439,
  StdDrawRoomObjects,
  Return,
];
```

### F3 Programs

#### StdDrawF3Stone

```typescript
const StdDrawF3Stone: number[] = [
  StdWallBitmapF3,
  StdWallRectangleF3,
  StdBltShape,
  F3,
  wallDecorationFront,
  WallF3Front,
  StdDrawWallText,
  F3,
  wallDecorationFront,
  WallF3Front,
  StdDrawWallDecoration,
  Alcove,
  JumpZ,
    5,
  F3Contents,
  F3xy,
  F3,
  DrawOrder00,
  StdDrawRoomObjects,
  Return,
];
```

#### StdDrawF3Open

```typescript
const StdDrawF3Open: number[] = [
  F3,
  FloorDecorationGraphicOrdinalF3,
  StdDrawFloorDecoration,
  F3Contents,
  F3xy,
  F3,
  DrawOrder3421,
  StdDrawRoomObjects,
  Return,
];
```

#### StdDrawF3Pit

```typescript
const StdDrawF3Pit: number[] = [
  F3,
  GetDecoration0,
  JumpNZ,
    4,
  Literal,
  50,
  StdFloorPitRectangleF3,
  StdGraphicToViewport,
  F3,
  FloorDecorationGraphicOrdinalF3,
  StdDrawFloorDecoration,
  F3Contents,
  F3xy,
  F3,
  DrawOrder3421,
  StdDrawRoomObjects,
  Return,
];
```

#### StdDrawF3Teleporter

```typescript
const StdDrawF3Teleporter: number[] = [
  F3,
  FloorDecorationGraphicOrdinalF3,
  StdDrawFloorDecoration,
  F3Contents,
  F3xy,
  F3,
  DrawOrder3421,
  StdDrawRoomObjects,
  F3,
  GetDecoration0,
  JumpZ,
    3,
  StdTeleporterRectangleF3,
  StdWallRectangleF3,
  StdDrawTeleporter,
  Return,
];
```

#### StdDrawF3StairFacing

```typescript
const StdDrawF3StairFacing: number[] = [
  F3,
  GetDecoration0,
  JumpZ,
    5,
  StdStairFacingUpGraphicF3,
  StdStairFacingUpRectangleF3,
  StdGraphicToViewport,
  Jump,
    3,
  StdStairFacingDownGraphicF3,
  StdStairFacingDownRectangleF3,
  StdGraphicToViewport,
  F3,
  FloorDecorationGraphicOrdinalF3,
  StdDrawFloorDecoration,
  F3Contents,
  F3xy,
  F3,
  DrawOrder3421,
  StdDrawRoomObjects,
  Return,
];
```

#### StdDrawF3StairEdge

```typescript
const StdDrawF3StairEdge: number[] = [
  Return,
];
```

#### StdDrawF3DoorEdge

```typescript
const StdDrawF3DoorEdge: number[] = [
  Return,
];
```

#### StdDrawF3DoorFacing

```typescript
const StdDrawF3DoorFacing: number[] = [
  F3,
  FloorDecorationGraphicOrdinalF3,
  StdDrawFloorDecoration,
  F3Contents,
  F3xy,
  F3,
  DrawOrder218,
  StdDrawRoomObjects,
  StdDoorFacingFrameLeftBitmapF3,
  StdDoorFacingFrameLeftRectF3,
  StdBltShapeToViewport,
  StdDoorFacingFrameLeftBitmapF3,
  StdDoorFacingFrameRightRectF3,
  StdMirrorShapeToViewport,
  F3,
  DoorSwitch,
  JumpZ,
    5,
  Literal,
  1,
  Literal,
  1,
  StdDrawDoorSwitch,
  F3DoorRecordIndex,
  F3DoorState,
  StdDoorGraphicsF3,
  StdDoorRectsF3,
  StdDrawDoor,
  F3Contents,
  F3xy,
  F3,
  DrawOrder349,
  StdDrawRoomObjects,
  Return,
];
```

### F3L1 Programs

#### StdDrawF3L1Stone

```typescript
const StdDrawF3L1Stone: number[] = [
  StdWallBitmapF3L1,
  StdWallRectangleF3L1,
  StdBltShape,
  F3L1,
  wallDecorationRight,
  WallF3L1Right,
  StdDrawWallText,
  F3L1,
  wallDecorationRight,
  WallF3L1Right,
  StdDrawWallDecoration,
  F3L1,
  wallDecorationFront,
  WallF3L1Front,
  StdDrawWallText,
  F3L1,
  wallDecorationFront,
  WallF3L1Front,
  StdDrawWallDecoration,
  Alcove,
  JumpZ,
    5,
  F3L1Contents,
  F3L1xy,
  F3L1,
  DrawOrder00,
  StdDrawRoomObjects,
  Return,
];
```

#### StdDrawF3L1Open

```typescript
const StdDrawF3L1Open: number[] = [
  F3L1,
  FloorDecorationGraphicOrdinalF3L1,
  StdDrawFloorDecoration,
  F3L1Contents,
  F3L1xy,
  F3L1,
  DrawOrder3421,
  StdDrawRoomObjects,
  Return,
];
```

#### StdDrawF3L1Pit

```typescript
const StdDrawF3L1Pit: number[] = [
  F3L1,
  GetDecoration0,
  JumpNZ,
    4,
  Literal,
  49,
  StdFloorPitRectangleF3L1,
  StdGraphicToViewport,
  F3L1,
  FloorDecorationGraphicOrdinalF3L1,
  StdDrawFloorDecoration,
  F3L1Contents,
  F3L1xy,
  F3L1,
  DrawOrder3421,
  StdDrawRoomObjects,
  Return,
];
```

#### StdDrawF3L1Teleporter

```typescript
const StdDrawF3L1Teleporter: number[] = [
  F3L1,
  FloorDecorationGraphicOrdinalF3L1,
  StdDrawFloorDecoration,
  F3L1Contents,
  F3L1xy,
  F3L1,
  DrawOrder3421,
  StdDrawRoomObjects,
  F3L1,
  GetDecoration0,
  JumpZ,
    3,
  StdTeleporterRectangleF3L1,
  StdWallRectangleF3L1,
  StdDrawTeleporter,
  Return,
];
```

#### StdDrawF3L1StairFacing

```typescript
const StdDrawF3L1StairFacing: number[] = [
  F3L1,
  GetDecoration0,
  JumpZ,
    5,
  StdStairFacingUpGraphicF3L1,
  StdStairFacingUpRectangleF3L1,
  StdGraphicToViewport,
  Jump,
    3,
  StdStairFacingDownGraphicF3L1,
  StdStairFacingDownRectangleF3L1,
  StdGraphicToViewport,
  F3L1,
  FloorDecorationGraphicOrdinalF3L1,
  StdDrawFloorDecoration,
  F3L1Contents,
  F3L1xy,
  F3L1,
  DrawOrder3421,
  StdDrawRoomObjects,
  Return,
];
```

#### StdDrawF3L1StairEdge

```typescript
const StdDrawF3L1StairEdge: number[] = [
  F3L1,
  FloorDecorationGraphicOrdinalF3L1,
  StdDrawFloorDecoration,
  F3L1Contents,
  F3L1xy,
  F3L1,
  DrawOrder321,
  StdDrawRoomObjects,
  Return,
];
```

#### StdDrawF3L1DoorEdge

```typescript
const StdDrawF3L1DoorEdge: number[] = [
  F3L1,
  FloorDecorationGraphicOrdinalF3L1,
  StdDrawFloorDecoration,
  F3L1Contents,
  F3L1xy,
  F3L1,
  DrawOrder321,
  StdDrawRoomObjects,
  Return,
];
```

#### StdDrawF3L1DoorFacing

```typescript
const StdDrawF3L1DoorFacing: number[] = [
  F3L1,
  FloorDecorationGraphicOrdinalF3L1,
  StdDrawFloorDecoration,
  F3L1Contents,
  F3L1xy,
  F3L1,
  DrawOrder218,
  StdDrawRoomObjects,
  StdDoorFacingFrameLeftBitmapF3L1,
  StdDoorFacingFrameRectF3L1,
  StdBltShapeToViewport,
  F3L1DoorRecordIndex,
  F3L1DoorState,
  StdDoorGraphicsF3,
  StdDoorRectsF3L1,
  StdDrawDoor,
  F3L1Contents,
  F3L1xy,
  F3L1,
  DrawOrder349,
  StdDrawRoomObjects,
  Return,
];
```

### F3L2 Programs

#### StdDrawF3L2Stone

```typescript
const StdDrawF3L2Stone: number[] = [
  StdWallBitmapF3L2,
  StdWallRectangleF3L2,
  StdBltShape,
  Return,
];
```

### F3R1 Programs

#### StdDrawF3R1Stone

```typescript
const StdDrawF3R1Stone: number[] = [
  StdWallBitmapF3R1,
  StdWallRectangleF3R1,
  StdBltShape,
  F3R1,
  wallDecorationLeft,
  WallF3R1Left,
  StdDrawWallText,
  F3R1,
  wallDecorationLeft,
  WallF3R1Left,
  StdDrawWallDecoration,
  F3R1,
  wallDecorationFront,
  WallF3R1Front,
  StdDrawWallText,
  F3R1,
  wallDecorationFront,
  WallF3R1Front,
  StdDrawWallDecoration,
  Alcove,
  JumpZ,
    5,
  F3R1Contents,
  F3R1xy,
  F3R1,
  DrawOrder00,
  StdDrawRoomObjects,
  Return,
];
```

#### StdDrawF3R1Open

```typescript
const StdDrawF3R1Open: number[] = [
  F3R1,
  FloorDecorationGraphicOrdinalF3R1,
  StdDrawFloorDecoration,
  F3R1Contents,
  F3R1xy,
  F3R1,
  DrawOrder4312,
  StdDrawRoomObjects,
  Return,
];
```

#### StdDrawF3R1Pit

```typescript
const StdDrawF3R1Pit: number[] = [
  F3R1,
  GetDecoration0,
  JumpNZ,
    4,
  Literal,
  49,
  StdFloorPitRectangleF3R1,
  StdMirrorGraphicToViewport,
  F3R1,
  FloorDecorationGraphicOrdinalF3R1,
  StdDrawFloorDecoration,
  F3R1Contents,
  F3R1xy,
  F3R1,
  DrawOrder4312,
  StdDrawRoomObjects,
  Return,
];
```

#### StdDrawF3R1Teleporter

```typescript
const StdDrawF3R1Teleporter: number[] = [
  F3R1,
  FloorDecorationGraphicOrdinalF3R1,
  StdDrawFloorDecoration,
  F3R1Contents,
  F3R1xy,
  F3R1,
  DrawOrder4312,
  StdDrawRoomObjects,
  F3R1,
  GetDecoration0,
  JumpZ,
    3,
  StdTeleporterRectangleF3R1,
  StdWallRectangleF3R1,
  StdDrawTeleporter,
  Return,
];
```

#### StdDrawF3R1StairFacing

```typescript
const StdDrawF3R1StairFacing: number[] = [
  F3R1,
  GetDecoration0,
  JumpZ,
    5,
  StdStairFacingUpGraphicF3R1,
  StdStairFacingUpRectangleF3R1,
  StdMirrorGraphicToViewport,
  Jump,
    3,
  StdStairFacingDownGraphicF3R1,
  StdStairFacingDownRectangleF3R1,
  StdMirrorGraphicToViewport,
  F3R1,
  FloorDecorationGraphicOrdinalF3R1,
  StdDrawFloorDecoration,
  F3R1Contents,
  F3R1xy,
  F3R1,
  DrawOrder4312,
  StdDrawRoomObjects,
  Return,
];
```

#### StdDrawF3R1StairEdge

```typescript
const StdDrawF3R1StairEdge: number[] = [
  F3R1,
  FloorDecorationGraphicOrdinalF3R1,
  StdDrawFloorDecoration,
  F3R1Contents,
  F3R1xy,
  F3R1,
  DrawOrder412,
  StdDrawRoomObjects,
  Return,
];
```

#### StdDrawF3R1DoorEdge

```typescript
const StdDrawF3R1DoorEdge: number[] = [
  F3R1,
  FloorDecorationGraphicOrdinalF3R1,
  StdDrawFloorDecoration,
  F3R1Contents,
  F3R1xy,
  F3R1,
  DrawOrder412,
  StdDrawRoomObjects,
  Return,
];
```

#### StdDrawF3R1DoorFacing

```typescript
const StdDrawF3R1DoorFacing: number[] = [
  F3R1,
  FloorDecorationGraphicOrdinalF3R1,
  StdDrawFloorDecoration,
  F3R1Contents,
  F3R1xy,
  F3R1,
  DrawOrder128,
  StdDrawRoomObjects,
  StdDoorFacingFrameLeftBitmapF3R1,
  StdDoorFacingFrameRectF3R1,
  StdMirrorShapeToViewport,
  F3R1,
  DoorSwitch,
  JumpZ,
    5,
  Literal,
  1,
  Literal,
  0,
  StdDrawDoorSwitch,
  F3R1DoorRecordIndex,
  F3R1DoorState,
  StdDoorGraphicsF3,
  StdDoorRectsF3R1,
  StdDrawDoor,
  F3R1Contents,
  F3R1xy,
  F3R1,
  DrawOrder439,
  StdDrawRoomObjects,
  Return,
];
```

### F3R2 Programs

#### StdDrawF3R2Stone

```typescript
const StdDrawF3R2Stone: number[] = [
  StdWallBitmapF3R2,
  StdWallRectangleF3R2,
  StdBltShape,
  Return,
];
```

### F4 Programs

#### StdDrawF4Any

```typescript
const StdDrawF4Any: number[] = [
  F4Contents,
  F4xy,
  F4,
  DrawOrder01,
  StdDrawRoomObjects,
  Return,
];
```

### F4L1 Programs

#### StdDrawF4L1Any

```typescript
const StdDrawF4L1Any: number[] = [
  F4L1Contents,
  F4L1xy,
  F4L1,
  DrawOrder01,
  StdDrawRoomObjects,
  Return,
];
```

### F4R1 Programs

#### StdDrawF4R1Any

```typescript
const StdDrawF4R1Any: number[] = [
  F4R1Contents,
  F4R1xy,
  F4R1,
  DrawOrder01,
  StdDrawRoomObjects,
  Return,
];
```

## 4. Data Structures

### SUMMARIZEROOMDATA (CSB.h line 663)

```typescript
interface SummarizeRoomData {
  i32 x, y, relativeCellNumber;
  i32 skinNumber;
  ROOMTYPE roomType;
  i32 championPortraitOrdinal;
  GRAPHICROOMTYPE graphicRoomType;
  RN  rn2;
  i32 decorations[3]; //right, front, left
  RN text[3]; //right, front, left
}
```

### RectPos (CSB.h line 1367)

```typescript
interface RectPos {
  x1: number;
  x2: number;
  y1: number;
  y2: number;
  // Byte variants for source clipping
  srcWidth?: number;   // uByte4
  uByte5?: number;
  srcX?: number;       // uByte6
  srcY?: number;       // uByte7
}
```

## 5. Key Functions to Port

These functions from CSBWin must be ported:

### From Viewport.cpp

- `DrawViewport(i32 facing, i32 x, i32 y)` - Line 6694
- `SummarizeRoomInfo(SUMMARIZEROOMDATA *rslt, i32 facing)` - Line ~3400
- `Interpret(ui16 *pCode, SUMMARIZEROOMDATA *roomData)` - Line ~6794
- `RelativeXY(i32 facing, i32 relY, i32 relX, i32 *x, i32 *y)` - Find in source

### From CSBCode.cpp

- `BltShapeToViewport(ui8 *P1, RectPos *P2)` - Line 2930
- `GetCellFlags(i32 x, i32 y)` - Find in Code11f52.cpp


## 6. Graphics Initialization

From CSBCode.cpp lines 2877-2893:

```cpp
firstWallGraphic = 77 + 13 * newWallGraphicSet;  // = 77 for set 0

for (i=0; i<6; i++) {
  ReadAndExpandGraphic(firstWallGraphic + 7 + i, d.pWallBitmaps[i], 0, 0);
}

// Wall bitmaps mapping:
// pWallBitmaps[0] = graphic 84
// pWallBitmaps[1] = graphic 85
// pWallBitmaps[2] = graphic 86
// pWallBitmaps[3] = graphic 87
// pWallBitmaps[4] = graphic 88
// pWallBitmaps[5] = graphic 89

MakeMirror(d.pWallBitmaps[5], d.pWallBitmaps[6], ...); // Create mirrored graphic 90
```
